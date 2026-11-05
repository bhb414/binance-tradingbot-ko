import test from 'node:test';import assert from 'node:assert/strict';
import {compileFormula,formulaTimeframes,formulaMarketRequests} from '../public/formula.js';
import {formulaSeries,heikinAshi} from '../public/indicators.js';
import {createStudy,validateStudy,studyData,decodeStudies} from '../public/chart-studies.js';
import {signatureAt} from '../public/formula-signature.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,a+' != '+b);
const candles=Array.from({length:220},(_,i)=>({time:i*60,open:100+Math.sin(i/5),high:103+Math.cos(i/5),low:97+Math.sin(i/7),close:100+Math.cos(i/3),volume:1+i%17}));
const reference=(prices,volume,n)=>prices.map((_,i)=>{if(i<n-1)return null;let sum=0,total=0;for(let k=i-n+1;k<=i;k++){if(!Number.isFinite(prices[k])||!Number.isFinite(volume[k])||volume[k]<0)return null;sum+=prices[k]*volume[k];total+=volume[k];}return total>0?sum/total:null;});
const compare=(a,b)=>{assert.equal(a.length,b.length);b.forEach((v,i)=>v===null?assert.equal(a[i],null):near(a[i],v));};

test('VWMA aliases use volume weights and match independently summed complete windows',()=>{
 for(const alias of ['VWMA','vwma','거래량가중이평','거래량가중이동평균'])near(compileFormula(alias+'(종가, 3)').evaluate({close:[10,20,30],volume:[1,2,3]},2).value,140/6);
 const series=formulaSeries(candles);for(const n of [1,6,20,100]){const result=compileFormula('VWMA(하이킨종가, '+n+')').evaluateSeries(series);assert.equal(result.ok,true,result.error);compare(result.values,reference(series.heikinClose,series.volume,n));}
});

test('chart VWMA uses the selected raw or Heikin source and raw candle volume',()=>{
 for(const candle of ['standard','heikin'])for(const source of ['close','high','hlc3']){
  const study=createStudy('VWMA',{candle,source});study.params.period=6;const data=studyData(validateStudy(study),candles),rows=candle==='heikin'?heikinAshi(candles):candles,prices=rows.map(c=>source==='hlc3'?(c.high+c.low+c.close)/3:c[source]),expected=reference(prices,candles.map(c=>c.volume),6);
  assert.equal(data.error,null);for(const point of data.plots[0].data)near(point.value,expected[point.time/60]);
 }
 const study=createStudy('VWMA'),saved=decodeStudies(JSON.stringify({version:1,timeframeVersion:2,studies:[study]}));assert.equal(saved.studies[0].type,'VWMA');
});

test('missing or negative volume and zero total volume stay unknown; individual zero-volume bars remain valid',()=>{
 for(const volume of [[0,0,0],[1,null,1],[1,undefined,1],[1,NaN,1],[1,Infinity,1],[1,-1,1]]){const r=compileFormula('VWMA(종가, 3)').evaluate({close:[10,20,30],volume},2);assert.equal(r.ok,true);assert.equal(r.value,null);}
 near(compileFormula('VWMA(종가, 3)').evaluate({close:[10,20,30],volume:[0,0,2]},2).value,30);
 assert.equal(compileFormula('VWMA(종가, 3)').evaluate({close:[10,20,30]},2).value,null);
 const series={close:[10,20,30,40,50],volume:[1,-1,1,1,1]};compare(compileFormula('VWMA(종가, 3)').evaluateSeries(series).values,[null,null,null,null,40]);
});

test('named sources infer their own volume while mixed markets require explicit weights',()=>{
 const series={close:[1,2,4],volume:[100,100,100],symbols:{A:{close:[20,30,40],volume:[3,2,1]},B:{close:[1,2,4],volume:[1,5,9]}}};
 near(compileFormula('VWMA(A.종가, 3)').evaluate(series,2).value,160/6);
 near(compileFormula('VWMA(A.종가/B.종가, 3, A.거래량)').evaluate(series,2).value,100/6);
 near(compileFormula('VWMA(A.종가, 3, B.거래량)').evaluate(series,2).value,530/15);
 for(const source of ['VWMA(A.종가/B.종가, 3)','VWMA(A.종가+종가, 3)','VWMA(A.종가+ATR(2), 3)'])assert.throws(()=>compileFormula(source),/세 번째/);
});

test('VWMA supports completed-bar lags, distinct feed scopes, crossovers and occurrence counts',()=>{
 const frames={'1m':{close:[10,20,30,40],volume:[1,2,3,4]},'3m':{close:[100,200,300,400],volume:[4,3,2,1]}};
 const source='VWMA(종가, 3)@1m[1] + VWMA(종가, 3)@3m';assert.deepEqual(formulaTimeframes(source),['1m','3m']);near(compileFormula(source).evaluate(frames['1m'],3,{frames}).value,140/6+1600/6);
 assert.deepEqual(formulaMarketRequests('BTCUSDT','VWMA(A.종가, 6)@3m',{A:'ETHUSDT'}).map(r=>r.symbol),['BTCUSDT','ETHUSDT']);
 assert.equal(compileFormula('상향돌파(종가, VWMA(종가, 2))').evaluate({close:[3,2,1,4],volume:[1,1,1,1]},3).pass,true);
 assert.equal(compileFormula('발생횟수(종가>VWMA(종가, 2), 2)').evaluate({close:[3,2,1,4],volume:[1,1,1,1]},3).value,1);
});

test('VWMA cannot reinterpret current positions or calendar data as historical observations',()=>{
 for(const source of ['VWMA(현재수익률(),6)','VWMA(종가,6,시각())','VWMA(종가,0)','VWMA(종가,501)','VWMA(종가,1.5)','VWMA(종가,RSI(종가,6))','VWMA(종가)'])assert.throws(()=>compileFormula(source),source);
 assert.throws(()=>formulaTimeframes('VWMA(종가,6)'));assert.throws(()=>formulaTimeframes('VWMA(종가@1m,6)@3m'));
});

test('full-size VWMA and nested residual calculations stay bounded and do not repaint earlier bars',()=>{
 const rows=Array.from({length:5000},(_,i)=>candles[i%candles.length]),series=formulaSeries(rows),source='표준편차(하이킨종가 - VWMA(하이킨종가, 500), 500)',result=compileFormula(source).evaluateSeries(series);assert.equal(result.ok,true,result.error);assert.ok(result.steps<400000);
 const small=formulaSeries(candles),formula=compileFormula('VWMA(하이킨종가, 6)'),before=formula.evaluateSeries(small);compare(formula.evaluateSeries(formulaSeries(candles.slice(0,120))).values,before.values.slice(0,120));
 const changed=structuredClone(small);changed.heikinClose[changed.heikinClose.length-1]+=10;changed.volume[changed.volume.length-1]+=20;const after=formula.evaluateSeries(changed);assert.deepEqual(after.values.slice(0,-1),before.values.slice(0,-1));assert.notEqual(after.values.at(-1),before.values.at(-1));
 assert.equal(formula.evaluateSeries(small,{maxSteps:10}).ok,false);
});

test('VWMA signature explains the optional volume source and chart and formula support share one definition',()=>{
 const text='VWMA(A.종가/B.종가, 6, ';const help=signatureAt(text,text.length);assert.equal(help.argument,2);assert.match(help.help[2],/거래량/);assert.match(help.help[2],/0/);
 const input=structuredClone(candles),study=createStudy('VWMA',{candle:'heikin'});study.params.period=6;const chart=studyData(study,input).plots[0].data,formula=compileFormula('VWMA(하이킨종가,6)').evaluateSeries(formulaSeries(input));for(const p of chart)near(p.value,formula.values[p.time/60]);assert.deepEqual(input,candles);
});
