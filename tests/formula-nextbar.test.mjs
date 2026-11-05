import test from 'node:test';import assert from 'node:assert/strict';
import {compileFormula,formulaTimeframes,formulaMarketRequests} from '../public/formula.js';
import {formulaStudyResult,createStudy,decodeStudies} from '../public/chart-studies.js';
import {formulaSeries} from '../public/indicators.js';import {signatureAt} from '../public/formula-signature.js';import {formulaSnippets} from '../public/formula-snippets.js';
const rows=Array.from({length:180},(_,i)=>({time:i*60,open:100+Math.sin(i/4)*3,high:106+Math.cos(i/9),low:94+Math.sin(i/7),close:100+Math.cos(i/5)*4,volume:10+i%17}));
const assumed={time:10800,open:102,high:111,low:96,close:107,volume:28};
const source=(expression,volume=true)=>'다음봉('+expression+',102,111,96,107'+(volume?',28':'')+')';
const near=(a,b)=>a===null||b===null?assert.equal(a,b):assert.ok(Math.abs(a-b)<1e-9,a+' != '+b);

test('assumed OHLC and volume match appending an explicit real candle for every supported indicator family',()=>{
 const expressions=['시가','고가','저가','종가','거래량','하이킨시가','하이킨고가','하이킨저가','하이킨종가','SMA(하이킨종가,6)','이평5','이평20','이평60','표준편차(종가,20)','볼린저상단(하이킨종가,55,1.04)','EMA(하이킨종가,6)','RSI(종가,14)','ATR(14)','VWMA(하이킨종가,6)','NW(하이킨종가,100,8)','백분위수(종가,20,95)','발생횟수(종가>시가,10)','상향돌파(하이킨종가,SMA(하이킨종가,6))'];
 for(const count of [1,5,6,14,15,56,100,180])for(const expression of expressions){const candles=rows.slice(0,count),actual=compileFormula(source(expression)).evaluate(formulaSeries(candles),count-1),expected=compileFormula(expression).evaluate(formulaSeries([...candles,assumed]),count);assert.equal(actual.ok,true,expression+': '+actual.error);near(actual.value,expected.value);}
});

test('assumption inputs may be arbitrary current indicators and are evaluated before adding the virtual candle',()=>{
 const formula='다음봉(SMA(하이킨종가,6), 종가, 최대(종가,SMA(하이킨종가,6)), 최소(종가,SMA(하이킨종가,6)), SMA(하이킨종가,6), SMA(거래량,20))',series=formulaSeries(rows),close=compileFormula('SMA(하이킨종가,6)').evaluate(series,179).value,volume=compileFormula('SMA(거래량,20)').evaluate(series,179).value,open=rows.at(-1).close;
 const expected=compileFormula('SMA(하이킨종가,6)').evaluate(formulaSeries([...rows,{open,high:Math.max(open,close),low:Math.min(open,close),close,volume}]),180),actual=compileFormula(formula).evaluate(series,179);assert.equal(actual.ok,true,actual.error);near(actual.value,expected.value);
});

test('all historical forecast points depend only on that point and never on actual later candles',()=>{
 for(const expression of ['EMA(하이킨종가,6)','RSI(종가,14)','ATR(14)','SMA(종가,6)','NW(하이킨종가,20,8)']){
  const formula=source(expression),full=formulaStudyResult(formula,rows);assert.equal(full.ok,true,full.error);
  for(const length of [1,6,20,60,179]){const prefix=formulaStudyResult(formula,rows.slice(0,length));assert.equal(prefix.ok,true,prefix.error);prefix.values.forEach((v,i)=>near(v,full.values[i]));}
  const changed=structuredClone(rows);for(let i=80;i<changed.length;i++){changed[i].close+=300;changed[i].high+=300;}
  const altered=formulaStudyResult(formula,changed);assert.equal(altered.ok,true,altered.error);altered.values.slice(0,80).forEach((v,i)=>near(v,full.values[i]));
 }
});

test('missing volume stays unknown rather than silently copying current volume or inventing a VWMA',()=>{
 for(const expression of ['거래량','VWMA(하이킨종가,6)']){const result=compileFormula(source(expression,false)).evaluate(formulaSeries(rows),179);assert.equal(result.ok,true);assert.equal(result.value,null);}
 assert.ok(Number.isFinite(compileFormula(source('SMA(하이킨종가,6)',false)).evaluate(formulaSeries(rows),179).value));
 const zero=compileFormula('다음봉(VWMA(종가,6),102,111,96,107,0)').evaluate(formulaSeries(rows),179),expected=compileFormula('VWMA(종가,6)').evaluate(formulaSeries([...rows,{...assumed,volume:0}]),180);near(zero.value,expected.value);
});

test('invalid candles, positions, calendar targets and nested future assumptions are rejected without altering source data',()=>{
 const series=formulaSeries(rows),before=structuredClone(series);for(const formula of ['다음봉(종가,102,100,96,107)','다음봉(종가,102,111,104,107)','다음봉(종가,102,111,96,107,-1)']){const result=compileFormula(formula).evaluate(series,179);assert.equal(result.ok,false);assert.match(result.error,/다음봉/);}
 for(const expression of ['현재수익률()','요일()','평균매수가'])assert.throws(()=>compileFormula(source(expression)),/시각·포지션/);
 assert.throws(()=>compileFormula(source(source('종가'))),/중첩/);assert.deepEqual(series,before);
 for(const values of Object.values(series))if(Array.isArray(values))Object.freeze(values);assert.equal(compileFormula(source('SMA(종가,6)')).evaluate(series,179).ok,true);
});

test('single named market assumptions use that market HA history and volume while mixed markets remain explicit',()=>{
 const a=rows.map(c=>({...c,open:c.open*2,high:c.high*2,low:c.low*2,close:c.close*2,volume:c.volume*3})),series=formulaSeries(rows);series.symbols={A:formulaSeries(a),B:formulaSeries(rows)};
 for(const expression of ['A.이평20','SMA(A.하이킨종가,6)','VWMA(A.하이킨종가,6)','EMA(A.종가,6)','RSI(A.종가,14)']){const actual=compileFormula(source(expression)).evaluate(series,179),expected=compileFormula(expression.replaceAll('A.','')).evaluate(formulaSeries([...a,assumed]),180);assert.equal(actual.ok,true,actual.error);near(actual.value,expected.value);}
 assert.throws(()=>compileFormula(source('A.종가+B.종가')),/한 종목/);assert.throws(()=>compileFormula(source('A.종가+종가')),/한 종목/);
 assert.deepEqual(formulaMarketRequests('BTCUSDT',source('SMA(A.종가,6)')+'@3m',{A:'ETHUSDT'}).map(r=>r.symbol),['BTCUSDT','ETHUSDT']);
});

test('frame and lag syntax applies to the complete assumed-bar calculation and retains genuine past offsets',()=>{
 const formula=source('SMA(종가,6)')+'@1m[1]';assert.deepEqual(formulaTimeframes(formula),['1m']);const frames={'1m':formulaSeries(rows)},actual=compileFormula(formula).evaluate(frames['1m'],179,{frames}),expected=compileFormula(source('SMA(종가,6)')).evaluate(formulaSeries(rows.slice(0,-1)),178);near(actual.value,expected.value);
 assert.throws(()=>formulaTimeframes(source('SMA(종가,6)')));assert.throws(()=>formulaTimeframes('다음봉(SMA(종가,6),종가@3m,111,96,107)@1m'));
 assert.throws(()=>compileFormula('종가[-1]'));
});

test('completed and current forecasts remain isolated through repeated expressions, mutations and input data gaps',()=>{
 const series=formulaSeries(rows),expression=source('SMA(종가,6)'),twice=compileFormula(expression+'+'+expression).evaluate(series,179),one=compileFormula(expression).evaluate(series,179);near(twice.value,one.value*2);
 for(const key of ['close','high','low'])series[key][178]=null;
 for(const target of ['SMA(종가,6)','EMA(종가,6)','RSI(종가,14)','ATR(14)']){const value=compileFormula(source(target)).evaluate(series,179);assert.equal(value.ok,true,value.error);assert.equal(value.value,null);}
});

test('forecast series and live evaluation are bounded and reuse actual historical indicator calculations',()=>{
 const candles=Array.from({length:5000},(_,i)=>({...rows[i%rows.length],time:i*60})),series=formulaSeries(candles);
 for(const expression of ['SMA(하이킨종가,500)','EMA(하이킨종가,100)','RSI(종가,100)','ATR(100)','VWMA(하이킨종가,100)','NW(하이킨종가,100,8)']){const formula=compileFormula(source(expression)),result=formula.evaluateSeries(series);assert.equal(result.ok,true,expression+': '+result.error);assert.ok(result.steps<1000000);const live=formula.evaluate(series,4999,{maxSteps:200000});assert.equal(live.ok,true,live.error);near(live.value,result.values.at(-1));}
 const limited=compileFormula(source('SMA(하이킨종가,100)')).evaluateSeries(series,{maxSteps:20});assert.equal(limited.ok,false);assert.deepEqual(limited.values,[]);
});

test('forecast formulas persist and snippet/signature help distinguish hypothetical prices from actual future data',()=>{
 const formula=source('SMA(하이킨종가,6)'),study=createStudy('FORMULA');study.params.formula=formula;assert.equal(decodeStudies(JSON.stringify({version:1,timeframeVersion:2,studies:[study]})).studies[0].params.formula,formula);
 const text='다음봉(SMA(하이킨종가,6),102,111,96,107, ';const help=signatureAt(text,text.length);assert.equal(help.argument,5);assert.match(help.help[0],/실제 미래 데이터/);assert.match(help.help[5],/생략/);assert.ok(formulaSnippets({chart:true}).some(s=>s.insert==='다음봉()'));
});
