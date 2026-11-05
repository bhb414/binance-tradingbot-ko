import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {compileFormula,formulaTimeframes,formulaMarketRequests} from '../public/formula.js';
import {nadarayaWatson} from '../public/study-calculations.js';
import {formulaSeries} from '../public/indicators.js';
import {createStudy,validateStudy,studyData,formulaStudyResult,decodeStudies} from '../public/chart-studies.js';
import {signatureAt} from '../public/formula-signature.js';
import {formulaEditorMarkup,formulaExamples} from '../public/formula-editor.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,a+' != '+b);
const rows=Array.from({length:260},(_,i)=>({time:i*60,open:100+i/50+Math.sin(i/5),high:103+i/50+Math.cos(i/4),low:97+i/50-Math.sin(i/6),close:100+i/50+Math.cos(i/7)*2,volume:10+i}));
const make=(type,params,extra={})=>{const study=createStudy(type,extra);study.params={...study.params,...params};return validateStudy(study);};
const values=(data,key)=>data.plots.find(p=>p.key===key).data;

test('NW formula uses independently calculated Gaussian weights and normalized full windows',()=>{
 const w1=Math.exp(-.5),w2=Math.exp(-2),expected=(14+12*w1+10*w2)/(1+w1+w2);
 for(const name of ['NW','nw','나다라야왓슨','NadarayaWatson'])near(compileFormula(name+'(종가, 3, 1)').evaluate({close:[10,12,14]},2).value,expected);
 assert.equal(compileFormula('NW(종가, 3, 1)').evaluate({close:[10,12]},1).value,null);
 near(compileFormula('NW(종가, 3, .1)').evaluate({close:[10,12,14]},2).value,14);
});

test('custom NW agrees with the built-in Gaussian center for raw and Heikin sources at every plotted candle',()=>{
 for(const candle of ['standard','heikin']){
  const source=candle==='heikin'?'하이킨종가':'종가',study=make('NW',{lookback:100,bandwidth:8},{candle}),plot=values(studyData(study,rows),'middle'),result=formulaStudyResult('NW('+source+', 100, 8)',rows);
  assert.equal(result.ok,true);for(let i=0;i<99;i++)assert.equal(result.values[i],null);for(const point of plot)near(result.values[point.time/60],point.value);
 }
 const series=formulaSeries(rows),data=series.high.map((v,i)=>(v+series.low[i])/2),expected=nadarayaWatson(data,{lookback:15,bandwidth:4}),actual=compileFormula('NW((고가+저가)/2, 15, 4)').evaluateSeries(series);
 assert.equal(actual.ok,true);expected.forEach((value,i)=>value===null?assert.equal(actual.values[i],null):near(actual.values[i],value));
});

test('missing observations stay missing and require a new complete window without treating zero as unknown',()=>{
 const source='NW(종가, 3, 1)',result=compileFormula(source).evaluateSeries({close:[0,0,0,null,2,3,4,5]});assert.equal(result.ok,true);assert.deepEqual(result.values.slice(0,6),[null,null,0,null,null,null]);assert.ok(Number.isFinite(result.values[6]));
 for(const missing of [undefined,NaN,Infinity])assert.equal(compileFormula(source).evaluate({close:[1,missing,3]},2).value,null);
});

test('NW plus raw ATR is a separate channel and matches its components even on Heikin charts',()=>{
 const source='NW(하이킨종가, 100, 8) + ATR(14) * 1.5',upper=formulaStudyResult(source,rows),lower=formulaStudyResult(source.replace(' + ',' - '),rows),center=formulaStudyResult('NW(하이킨종가, 100, 8)',rows),atr=values(studyData(make('ATR',{period:14,average:'RMA'},{candle:'standard'}),rows,'heikin'),'main');assert.equal(upper.ok,true);assert.equal(lower.ok,true);
 for(const point of atr){const i=point.time/60;if(center.values[i]!==null){near(upper.values[i],center.values[i]+point.value*1.5);near(lower.values[i],center.values[i]-point.value*1.5);}}
});

test('future bars and live candle mutation never revise older custom NW channel values',()=>{
 const source='NW(하이킨종가, 100, 8) + ATR(14) * 1.5',full=formulaStudyResult(source,rows);for(const count of [100,150,200])assert.deepEqual(formulaStudyResult(source,rows.slice(0,count)).values,full.values.slice(0,count));
 const changed=structuredClone(rows);changed.at(-1).close+=500;changed.at(-1).high+=500;assert.deepEqual(formulaStudyResult(source,changed).values.slice(0,-1),full.values.slice(0,-1));assert.notEqual(formulaStudyResult(source,changed).values.at(-1),full.values.at(-1));
 const shifted=compileFormula('NW(하이킨종가, 100, 8)').evaluateSeries(formulaSeries(rows.slice(20))).values;assert.deepEqual(shifted.slice(99),formulaStudyResult('NW(하이킨종가, 100, 8)',rows).values.slice(119));
});

test('NW uses whole-function frame scope, completed-bar offsets and isolated symbol feeds',()=>{
 assert.deepEqual(formulaTimeframes('(하이킨종가 > NW(하이킨종가, 100, 8) + ATR(14) * 1.5)@1m[1]'),['1m']);
 assert.throws(()=>formulaTimeframes('NW(종가, 100, 8)'),/주기/);assert.throws(()=>formulaTimeframes('NW(종가@5m, 100, 8)@1h'),/함수 전체/);
 const series=formulaSeries(rows),feed={...series,symbols:{A:series,B:{...series,heikinClose:series.heikinClose.map(v=>v*2)}}},compiled=compileFormula('(NW(A.하이킨종가, 100, 8) + NW(B.하이킨종가, 100, 8))@1m[1]'),expected=compileFormula('NW(하이킨종가, 100, 8)').evaluate(series,rows.length-2).value;
 near(compiled.evaluate(series,rows.length-1,{frames:{'1m':feed}}).value,expected*3);
 assert.deepEqual(formulaMarketRequests('SOXLUSDT','NW(A.하이킨종가, 100, 8)@1m',{A:'KORUUSDT'}).map(p=>p.key),['SOXLUSDT@1m','KORUUSDT@1m']);
});

test('crossovers and occurrence windows can use NW without changing their past-candle semantics',()=>{
 const series=formulaSeries(rows),line=compileFormula('NW(하이킨종가, 20, 5)').evaluateSeries(series).values,cross=compileFormula('상향돌파(하이킨종가, NW(하이킨종가, 20, 5))'),counts=compileFormula('발생횟수(상향돌파(하이킨종가, NW(하이킨종가, 20, 5)), 10)').evaluateSeries(series);assert.equal(counts.ok,true);
 for(let i=30;i<rows.length;i++){const expected=series.heikinClose[i]>line[i]&&series.heikinClose[i-1]<=line[i-1]?1:0;assert.equal(cross.evaluate(series,i).value,expected);const n=Array.from({length:10},(_,offset)=>cross.evaluate(series,i-offset).value).reduce((a,b)=>a+b,0);assert.equal(counts.values[i],n);}
});

test('invalid kernel parameters and non-historical position or clock sources are rejected clearly',()=>{
 for(const source of ['NW(종가)','NW(종가, 100)','NW(종가, 100, 8, 1)','NW(종가, 1, 8)','NW(종가, 501, 8)','NW(종가, 20.5, 8)','NW(종가, 20, 0)','NW(종가, 20, 301)','NW(종가, 20, 종가)','NW(종가, ATR(14), 8)','NW(현재수익률(), 20, 8)','NW(요일(), 20, 8)','NW(평균매수가, 20, 8)'])assert.throws(()=>compileFormula(source),undefined,source);
 for(const source of ['NW(하이킨고가, 2, .1)','NW(하이킨저가, 500, 300)','NW(종가[1], 100, 20)'])assert.doesNotThrow(()=>compileFormula(source));
});

test('kernel calculation is bounded, caches nested histories and only calculates the requested live window',()=>{
 const close=Array.from({length:5000},(_,i)=>100+Math.sin(i/3)),compiled=compileFormula('NW(종가, 100, 8)'),full=compiled.evaluateSeries({close});assert.equal(full.ok,true,full.error);assert.ok(full.steps<600000);near(full.values.at(-1),compiled.evaluate({close},4999).value);
 const live=compileFormula('NW(종가, 500, 20)').evaluate({close},4999);assert.equal(live.ok,true);assert.ok(live.steps<1100);assert.equal(compiled.evaluateSeries({close},{maxSteps:100}).ok,false);
 const nested=compileFormula('NW(NW(종가, 20, 5), 20, 5)').evaluateSeries({close:close.slice(0,200)});assert.equal(nested.ok,true);assert.deepEqual(nested.values.slice(0,38),Array(38).fill(null));assert.ok(nested.steps<10000);
});

test('saved custom formulas preserve expressions and editor examples explain Gaussian NW versus ATR width',async()=>{
 const source='NW(하이킨종가, 100, 8) + ATR(14) * 1.5',study=make('FORMULA',{name:'NW ATR 상단',placement:'overlay',formula:source}),saved=decodeStudies(JSON.stringify({version:1,timeframeVersion:2,studies:[study]}));assert.equal(saved.studies[0].params.formula,source);assert.equal(formulaStudyResult(source,rows).ok,true);
 assert.match(formulaEditorMarkup({formula:''}),/NW · 가우시안 중심선/);for(const example of formulaExamples)assert.doesNotThrow(()=>formulaTimeframes(example.value));
 const text='NW(하이킨종가, 100, ';const help=signatureAt(text,text.length);assert.equal(help.argument,2);assert.match(help.help[2],/Bandwidth|부드러움/);
 const ui=await fs.readFile(new URL('../public/study-ui.js',import.meta.url),'utf8');assert.ok(ui.includes(source));assert.ok(ui.includes(source.replace(' + ',' - ')));
});
