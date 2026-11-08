import test from 'node:test';
import assert from 'node:assert/strict';
import {createCrossTracker,crossSide} from '../public/adaptive-cycle.js';
import {average,createStudy,studyData} from '../public/chart-studies.js';
import {calculateForecastScenarios} from '../public/ma-forecast-scenarios.js';
import {FORECAST_DEFAULTS} from '../public/ma-forecast.js';
import {compileFormula} from '../public/formula.js';

test('equality plateaus retain elapsed bars and last side until a real opposite crossing',()=>{
 const tracker=createCrossTracker(),actual=[];
 for(const n of [-1,1,0,0,1,0,1,0,-1,0,0,-1,1]){
  tracker.push(n,0);actual.push([tracker.direction,tracker.elapsed]);
 }
 assert.deepEqual(actual,[[null,null],[1,0],[1,1],[1,2],[1,3],[1,4],[1,5],[1,6],[-1,0],[-1,1],[-1,2],[-1,3],[1,0]]);
});

test('an initial side, equality and return to the same side never invent a first cross',()=>{
 const tracker=createCrossTracker();
 for(const n of [0,1,0,0,1,0,1]){tracker.push(n,0);assert.equal(tracker.elapsed,null);assert.equal(tracker.direction,null);}
 tracker.push(-1,0);assert.equal(tracker.elapsed,0);assert.equal(tracker.direction,-1);
 tracker.push(null,0);tracker.push(1,0);tracker.push(1,1);tracker.push(1,0);assert.equal(tracker.elapsed,null);
});

test('arithmetic equality is relative to price scale while genuine tiny-price crossings remain visible',()=>{
 for(const scale of [1e-12,.07814,1,100000,1e12]){
  assert.equal(crossSide(scale,scale*(1+4*Number.EPSILON)),0);
  assert.equal(crossSide(scale,scale*(1+1e-12)),-1);
  assert.equal(crossSide(scale*(1+1e-12),scale),1);
 }
 assert.equal(crossSide(0,0),0);assert.equal(crossSide(1e-30,0),1);assert.equal(crossSide(null,1),null);
 const tracker=createCrossTracker(),base=.1221;
 for(const n of [-.0001,.0001,0,0,0])tracker.push(base+n,base);
 tracker.push(base,base+2.7755575615628914e-17);
 assert.equal(tracker.direction,1);assert.equal(tracker.elapsed,4);
});

test('decimal-price SMAs agree with exact integer arithmetic through flat tails and repeated touches',()=>{
 for(const [fastPeriod,slowPeriod]of [[6,13],[5,20]])for(let seed=1;seed<=20;seed++){
  let rng=seed,side=0,last=null,gap=null;
  const ticks=Array.from({length:200},(_,i)=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return i>=140?1221:1220+rng%3;});
  const prices=ticks.map(n=>n/10000),fast=average(prices,fastPeriod),slow=average(prices,slowPeriod),tracker=createCrossTracker();
  for(let i=0;i<ticks.length;i++){
   const actualGap=tracker.push(fast[i],slow[i]);if(i<slowPeriod-1){assert.equal(tracker.elapsed,null);continue;}
   const sum=n=>ticks.slice(i-n+1,i+1).reduce((a,b)=>a+b,0),current=Math.sign(sum(fastPeriod)*slowPeriod-sum(slowPeriod)*fastPeriod);
   if(current){if(side&&side!==current){if(last!==null)gap=i-last;last=i;}side=current;}
   assert.equal(tracker.elapsed,last===null?null:i-last,'elapsed '+seed+':'+i);
   assert.equal(actualGap,gap,'interval '+seed+':'+i);
  }
 }
});

// Public UAIUSDT 1m closes, 2026-11-08 16:25..16:51 KST, in 0.0001 ticks.
const ticks=[782,780,783,784,787,783,782,783,781,782,781,783,782,781,779,782,780,781,780,781,782,783,783,782,777,779,779];
const raw=ticks.map((tick,i)=>({time:Date.parse('2026-11-08T16:25:00+09:00')/1000+i*60,open:tick/10000,high:tick/10000,low:tick/10000,close:tick/10000,volume:1}));

test('UAI 5/20 keeps the 16:49 equality in golden elapsed and resets at the real 16:50 dead cross',()=>{
 const study=createStudy('CYCLE',{candle:'standard'});Object.assign(study.params,{fast:5,slow:20,reference:'theory',anchor:'live',display:'bars',predictionSource:'interval'});
 const data=studyData(study,raw);assert.equal(data.error,null);
 assert.deepEqual(data.cycle.slice(23).map(p=>[p.direction,p.elapsed]),[[1,0],[1,1],[-1,0],[-1,1]]);
 study.params.anchor='closed';const closed=studyData(study,raw);
 assert.deepEqual(closed.cycle.map(p=>[p.direction,p.elapsed]),[[null,null],...data.cycle.slice(0,-1).map(p=>[p.direction,p.elapsed])]);
 study.params.anchor='live';study.params.display='ratio';const ratios=studyData(study,raw);
 assert.equal(ratios.cycle[24].elapsed,1);assert.equal(ratios.plots.find(p=>p.key==='elapsed').data.find(p=>p.time===raw[24].time).value,1/ratios.cycle[24].basis);
});

test('forecast history retains the real prior cross when current averages touch within roundoff',()=>{
 const values=raw.map(c=>c.close),fast=average(values,5),slow=average(values,20),index=24;
 const result=calculateForecastScenarios({values,candles:raw,volumes:raw.map(c=>c.volume),lines:[{key:'ma0',slot:0,type:'SMA',period:5,values:fast},{key:'ma1',slot:1,type:'SMA',period:20,values:slow}],index,params:{...FORECAST_DEFAULTS,method:'close',horizon:5,searchBars:30,slopeBars:3,crossA:'0',crossB:'1'}});
 assert.equal(result.comparison.lastCrossIndex,23);
 assert.equal(result.comparison.lastCrossClose,raw[23].close);
 assert.equal(result.comparison.elapsedBars,1);
});

test('cross interval formulas share the corrected equality handling without changing generic cross functions',()=>{
 const close=[1,2,1,1,2,1,2,1,-1],result=compileFormula('교차간격(종가, 1)').evaluateSeries({close});
 assert.equal(result.ok,true);assert.deepEqual(result.values,[null,null,null,null,null,null,null,null,null]);
 const ordinary=compileFormula('상향돌파(종가, 1)').evaluateSeries({close:[2,1,2]});
 assert.deepEqual(ordinary.values,[null,0,1]);
});
