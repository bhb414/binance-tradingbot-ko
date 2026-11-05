import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFormula,formulaTimeframes} from '../public/formula.js';
import {formulaStudyResult} from '../public/chart-studies.js';
import {formulaSeries} from '../public/indicators.js';
import {nadarayaWatson} from '../public/study-calculations.js';
const near=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<=tolerance, a+' != '+b);
const rows=n=>Array.from({length:n},(_,i)=>({time:i*60,open:100+i/30+Math.sin(i/9),high:103+i/30+Math.sin(i/9),low:97+i/30+Math.cos(i/6),close:100+i/30+Math.sin(i/7)*2,volume:20+i%23}));
function stats(values,period){
 return values.map((_,i)=>{
  if(i<period-1)return null;const window=values.slice(i-period+1,i+1);
  if(!window.every(v=>typeof v==='number'&&Number.isFinite(v)))return null;
  const mean=window.reduce((a,b)=>a+b,0)/period;
  return {mean,stdev:Math.sqrt(window.reduce((sum,v)=>sum+(v-mean)**2,0)/period)};
 });
}
function same(actual,expected){assert.equal(actual.length,expected.length);expected.forEach((value,i)=>value===null?assert.equal(actual[i],null):near(actual[i],value));}

test('rolling means, population deviations and all Bollinger lines agree with independent window calculations',()=>{
 const close=Array.from({length:170},(_,i)=>Math.sin(i/3)*12+i%9);
 for(const period of [1,2,6,55,100]){
  const expected=stats(close,period),series={close};
  for(const [formula,field]of [['SMA(종가, '+period+')','mean'],['표준편차(종가, '+period+')','stdev'],['볼린저중심(종가, '+period+')','mean']]){
   const result=compileFormula(formula).evaluateSeries(series);assert.equal(result.ok,true,result.error);same(result.values,expected.map(s=>s?.[field]??null));
  }
  for(const [fn,sign]of [['볼린저상단',1],['볼린저하단',-1]]){
   const result=compileFormula(fn+'(종가, '+period+', 1.04)').evaluateSeries(series);assert.equal(result.ok,true,result.error);same(result.values,expected.map(s=>s?s.mean+sign*s.stdev*1.04:null));
  }
 }
});

test('the reported NW Bollinger formula completes all 5000 chart bars within the unchanged step budget',()=>{
 const candles=rows(5000),series=formulaSeries(candles),nw=nadarayaWatson(series.heikinClose,{lookback:100,bandwidth:8}),expected=stats(nw,55);
 const result=formulaStudyResult('볼린저상단(NW(하이킨종가, 100, 8), 55, 1.04)',candles);
 assert.equal(result.ok,true,result.error);assert.ok(result.steps<700000);same(result.values,expected.map(s=>s?s.mean+s.stdev*1.04:null));
});

test('deep MA residual deviations reuse requested source windows rather than repeatedly traversing nested history',()=>{
 const candles=rows(5000),series=formulaSeries(candles);
 for(const period of [100,500]){
  const means=stats(series.heikinClose,period).map(s=>s?.mean??null),residual=means.map((mean,i)=>mean===null?null:series.heikinClose[i]-mean),expected=stats(residual,period);
  const source='표준편차(하이킨종가-SMA(하이킨종가, '+period+'), '+period+')',result=formulaStudyResult(source,candles);
  assert.equal(result.ok,true,result.error);assert.ok(result.steps<200000);same(result.values,expected.map(s=>s?.stdev??null));
  const live=compileFormula(source).evaluate(series,4999);assert.equal(live.ok,true,live.error);near(live.value,result.values.at(-1));
 }
});

test('missing and invalid samples remain unknown until a complete fresh window is present',()=>{
 for(const gap of [null,undefined,NaN,Infinity]){
  const close=[0,0,0,gap,2,2,2,3,4],series={close};
  for(const [fn,field]of [['SMA','mean'],['표준편차','stdev']]){
   const result=compileFormula(fn+'(종가, 3)').evaluateSeries(series);assert.equal(result.ok,true);same(result.values,stats(close,3).map(s=>s?.[field]??null));
  }
 }
 const result=compileFormula('SMA(종가/거래량, 2)').evaluateSeries({close:[0,2,3,4,5],volume:[1,0,1,1,1]});
 assert.deepEqual(result.values,[null,null,null,3.5,4.5]);
});

test('lagged and crossover queries keep correct windows when the same cache is visited backwards',()=>{
 const close=Array.from({length:160},(_,i)=>100+Math.sin(i/4)*7),a=stats(close,6),b=stats(close,20),series={close};
 const cross=compileFormula('상향돌파(SMA(종가, 6), SMA(종가, 20))').evaluateSeries(series);
 const lagged=compileFormula('SMA(종가, 6)[4] + SMA(종가, 6)[1] - 표준편차(종가, 6)[2]').evaluateSeries(series);
 assert.equal(cross.ok,true);assert.equal(lagged.ok,true);
 same(cross.values,close.map((_,i)=>i<20?null:a[i-1].mean<=b[i-1].mean&&a[i].mean>b[i].mean?1:0));
 same(lagged.values,close.map((_,i)=>i<9?null:a[i-4].mean+a[i-1].mean-a[i-2].stdev));
});

test('rolling central moments retain tiny variance around large prices without cumulative rolling drift',()=>{
 const close=Array.from({length:1200},(_,i)=>1e12+(i%11)/8),period=55;
 const expected=close.map((_,i)=>{if(i<period-1)return null;const window=close.slice(i-period+1,i+1).map(v=>v-1e12),mean=window.reduce((s,v)=>s+v,0)/period;return Math.sqrt(window.reduce((s,v)=>s+(v-mean)**2,0)/period);});
 const result=compileFormula('표준편차(종가, 55)').evaluateSeries({close});assert.equal(result.ok,true);same(result.values,expected);
 const flat=compileFormula('표준편차(종가, 55)').evaluateSeries({close:Array(1200).fill(1e12)});assert.equal(flat.values.at(-1),0);
});

test('new and edited live candles never reuse a previous evaluation or change already calculated past values',()=>{
 const candles=rows(240),original=structuredClone(candles),source='볼린저상단(SMA(하이킨종가, 6), 20, 2)',before=formulaStudyResult(source,candles);
 assert.equal(before.ok,true);assert.deepEqual(formulaStudyResult(source,candles.slice(0,180)).values,before.values.slice(0,180));
 candles.at(-1).close+=40;candles.at(-1).high+=40;const changed=formulaStudyResult(source,candles);
 assert.deepEqual(changed.values.slice(0,-1),before.values.slice(0,-1));assert.notEqual(changed.values.at(-1),before.values.at(-1));
 assert.deepEqual(formulaStudyResult(source,original).values,before.values);
});

test('identical expressions share calculation within a feed while symbols and timeframes stay isolated',()=>{
 const close=Array.from({length:500},(_,i)=>100+Math.sin(i/3)),series={close},one=compileFormula('SMA(종가, 100)').evaluateSeries(series),two=compileFormula('SMA(종가, 100)+SMA(종가, 100)').evaluateSeries(series);
 assert.equal(two.ok,true);same(two.values,one.values.map(v=>v===null?null:v*2));assert.ok(two.steps<one.steps*1.5);
 const frames={'1m':{close:[1,2,3],symbols:{A:{close:[4,6,8]}}},'3m':{close:[10,20,30],symbols:{A:{close:[40,60,80]}}}};
 const source='(SMA(종가, 3)+SMA(A.종가, 3))@1m + (SMA(종가, 3)+SMA(A.종가, 3))@3m';
 assert.deepEqual(formulaTimeframes(source),['1m','3m']);const result=compileFormula(source).evaluate(frames['1m'],2,{frames,maxSteps:1000});assert.equal(result.ok,true,result.error);assert.equal(result.value,88);
});

test('work limits remain enforced after memoization and chart errors identify the indicator calculation',()=>{
 const source='표준편차(하이킨종가-SMA(하이킨종가, 100), 100)',candles=rows(300);
 const result=formulaStudyResult(source,candles,{maxSteps:50});assert.equal(result.ok,false);assert.deepEqual(result.values,[]);assert.match(result.error,/지표 계산량/);assert.ok(result.steps<=51);
 assert.equal(compileFormula('SMA(종가, 500)').evaluateSeries({close:Array(5001).fill(1)}).ok,false);
 assert.throws(()=>compileFormula('SMA(종가, 501)'));assert.throws(()=>compileFormula('표준편차(종가, 0)'));
});
