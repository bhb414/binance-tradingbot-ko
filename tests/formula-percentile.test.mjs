import test from 'node:test';import assert from 'node:assert/strict';
import {compileFormula,formulaTimeframes,formulaMarketRequests} from '../public/formula.js';
import {formulaSeries} from '../public/indicators.js';import {nadarayaWatson} from '../public/study-calculations.js';
import {formulaStudyResult,createStudy,decodeStudies} from '../public/chart-studies.js';import {signatureAt} from '../public/formula-signature.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,a+' != '+b);
const upper='NW(하이킨종가, 100, 8) + 백분위수(하이킨종가 - NW(하이킨종가, 100, 8), 100, 95)[1]',lower=upper.replace(', 95)',', 5)');
const rows=Array.from({length:330},(_,i)=>({time:i*60,open:100+Math.sin(i/9),high:102+Math.sin(i/9),low:98+Math.cos(i/6),close:100+Math.sin(i/7)*2,volume:100}));
const reference=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b),at=(sorted.length-1)*p/100,a=Math.floor(at),b=Math.ceil(at);return sorted[a]+(sorted[b]-sorted[a])*(at-a);};

test('empirical percentiles use hand-calculated linear ranks, endpoint bounds and case-insensitive aliases',()=>{
 for(const name of ['백분위수','백분위','Percentile','PERCENTILE']){const compiled=compileFormula(name+'(종가, 4, 25)');near(compiled.evaluate({close:[30,0,20,10]},3).value,7.5);}
 for(const [p,value]of [[0,0],[50,15],[95,28.5],[100,30]])near(compileFormula('백분위수(종가, 4, '+p+')').evaluate({close:[0,10,20,30]},3).value,value);
 near(compileFormula('백분위수(종가, 1, 37.5)').evaluate({close:[-10]},0).value,-10);assert.equal(compileFormula('백분위수(종가, 3, 95)').evaluate({close:[7,7,7]},2).value,7);
});

test('rolling percentile insertion and removal handles duplicate, negative and random-order lagged requests',()=>{
 const close=[0,-2,4,4,-1,3,0,7,-2,8,8,8,1,0,0],formula=compileFormula('백분위수(종가, 4, 37.5)'),series=formula.evaluateSeries({close});assert.equal(series.ok,true);for(let i=3;i<close.length;i++)near(series.values[i],reference(close.slice(i-3,i+1),37.5));
 const lagged=compileFormula('백분위수(종가, 4, 37.5) + 백분위수(종가, 4, 37.5)[2]');near(lagged.evaluate({close},10).value,series.values[10]+series.values[8]);
 const original=structuredClone(close);formula.evaluateSeries({close});assert.deepEqual(close,original);
});

test('a complete window is required and missing observations never disappear from the denominator',()=>{
 const close=[1,2,3,null,5,6,7,8],r=compileFormula('백분위수(종가, 3, 50)').evaluateSeries({close});assert.equal(r.ok,true);assert.deepEqual(r.values,[null,null,2,null,null,null,6,7]);for(const value of [undefined,NaN,Infinity])assert.equal(compileFormula('백분위수(종가, 3, 50)').evaluate({close:[1,value,3]},2).value,null);
});

test('NW residual channels use each candle contemporaneous NW and add both signed percentile bounds',()=>{
 const series=formulaSeries(rows),nw=nadarayaWatson(series.heikinClose,{lookback:100,bandwidth:8}),residual=series.heikinClose.map((v,i)=>nw[i]===null?null:v-nw[i]),u=formulaStudyResult(upper,rows),l=formulaStudyResult(lower,rows);assert.equal(u.ok,true,u.error);assert.equal(l.ok,true,l.error);assert.deepEqual(u.values.slice(0,199),Array(199).fill(null));for(let i=199;i<rows.length;i++){const window=residual.slice(i-100,i);near(u.values[i],nw[i]+reference(window,95));near(l.values[i],nw[i]+reference(window,5));assert.ok(l.values[i]<=u.values[i]);}
 const falling=rows.map((c,i)=>({...c,open:400-i,high:401-i,low:399-i,close:400-i})),middle=formulaStudyResult('NW(하이킨종가, 100, 8)',falling).values,u2=formulaStudyResult(upper,falling).values,l2=formulaStudyResult(lower,falling).values;assert.ok(u2.at(-1)<middle.at(-1));assert.ok(l2.at(-1)<middle.at(-1));
});

test('completed-bar residual ranges cannot widen from the current live spike and future bars never revise older values',()=>{
 const before=formulaStudyResult(upper,rows),center=formulaStudyResult('NW(하이킨종가, 100, 8)',rows),changed=structuredClone(rows);changed.at(-1).close+=500;changed.at(-1).high+=500;const after=formulaStudyResult(upper,changed),centerAfter=formulaStudyResult('NW(하이킨종가, 100, 8)',changed);assert.deepEqual(after.values.slice(0,-1),before.values.slice(0,-1));near(before.values.at(-1)-center.values.at(-1),after.values.at(-1)-centerAfter.values.at(-1));
 for(const count of [200,250,300])assert.deepEqual(formulaStudyResult(upper,rows.slice(0,count)).values,before.values.slice(0,count));
});

test('the same generic distribution can measure MA residuals or standalone price quantiles',()=>{
 for(const source of ['SMA(하이킨종가, 6) + 백분위수(하이킨종가-SMA(하이킨종가, 6), 100, 95)[1]','백분위수(하이킨종가, 100, 50)','발생횟수(종가 > 백분위수(종가, 20, 95), 10)']){const result=formulaStudyResult(source,rows);assert.equal(result.ok,true,result.error);assert.ok(Number.isFinite(result.values.at(-1)));}
});

test('percentile operations require whole-frame scope, respect offsets and isolate named market feeds',()=>{
 assert.deepEqual(formulaTimeframes('백분위수(하이킨종가-NW(하이킨종가, 100, 8), 100, 95)@1m[1]'),['1m']);assert.throws(()=>formulaTimeframes('백분위수(종가, 100, 95)'),/주기/);assert.throws(()=>formulaTimeframes('백분위수(종가@1m, 100, 95)@5m'),/함수 전체/);
 const a={close:[1,2,3,4]},b={close:[10,20,30,40]},feed={...a,symbols:{A:a,B:b}},r=compileFormula('(백분위수(A.종가, 3, 50)+백분위수(B.종가, 3, 50))@1m[1]').evaluate(a,3,{frames:{'1m':feed}});assert.equal(r.value,22);
 assert.deepEqual(formulaMarketRequests('SOXLUSDT','백분위수(A.종가, 100, 95)@1m',{A:'KORUUSDT'}).map(r=>r.key),['SOXLUSDT@1m','KORUUSDT@1m']);
});

test('invalid percentiles, dynamic arguments, missing arities and non-historical sources are rejected',()=>{
 for(const source of ['백분위수(종가, 100)','백분위수(종가, 100, 95, 5)','백분위수(종가, 0, 95)','백분위수(종가, 501, 95)','백분위수(종가, 3.5, 95)','백분위수(종가, 100, 101)','백분위수(종가, 100, -1)','백분위수(종가, 100, 종가)','백분위수(종가, ATR(14), 95)','백분위수(현재수익률(), 100, 95)','백분위수(요일(), 100, 95)','백분위수(수익률, 100, 95)'])assert.throws(()=>compileFormula(source),undefined,source);
});

test('large windows stay bounded and a live-only request does not evaluate unrelated history',()=>{
 const close=Array.from({length:5000},(_,i)=>Math.sin(i/7)*100+i%9),compiled=compileFormula('백분위수(종가, 500, 95)'),full=compiled.evaluateSeries({close});assert.equal(full.ok,true,full.error);assert.ok(full.steps<150000);near(full.values.at(-1),reference(close.slice(-500),95));const live=compiled.evaluate({close},4999);assert.equal(live.ok,true,live.error);assert.ok(live.steps<10000);assert.equal(compiled.evaluateSeries({close},{maxSteps:100}).ok,false);const band=formulaStudyResult(upper,rows);assert.ok(band.steps<200000);
});

test('custom channels round-trip without replacing other studies and signature help explains signed bounds and offsets',()=>{
 const study=createStudy('FORMULA',{params:{name:'NW 중앙 90% 상단',formula:upper,placement:'overlay'}}),document={version:1,timeframeVersion:2,studies:[createStudy('BB'),study]};assert.equal(decodeStudies(JSON.stringify(document)).studies[1].params.formula,upper);const text='백분위수(하이킨종가-NW(하이킨종가, 100, 8), 100, ';const help=signatureAt(text,text.length);assert.equal(help.argument,2);assert.match(help.help[2],/미래 포함 확률/);
});
