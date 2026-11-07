import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudy,studyData,studyPlots,validateStudy,decodeStudies} from '../public/chart-studies.js';
import {cycleLegendValues,cycleReadings} from '../public/cycle-reference.js';
import {cycleForecastReadings} from '../public/cycle-forecast.js';
const raw=Array.from({length:150},(_,i)=>({time:1700000000+i*60,open:100+Math.sin(i/7),high:102+Math.sin(i/7),low:98+Math.sin(i/7),close:100+Math.sin(i/7+.3)+Math.cos(i/19)*.2,volume:3+i%13}));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7*Math.max(1,Math.abs(b)),a+' != '+b);
function cycle(source='current',method='fastest-range'){
 const s=createStudy('CYCLE',{candle:'standard'});Object.assign(s.params,{fast:13,slow:26,anchor:'live',reference:'theory',predictionSource:source,forecastMethod:method,forecastSearchBars:35});return s;
}

test('the existing interval slot switches between old spacing, previous completed peak and current forecast without adding lines',()=>{
 const s=cycle('interval'),original=studyData(s,raw);assert.equal(original.plots.length,3);
 s.params.predictionSource='previous';const previous=studyData(s,raw);assert.equal(previous.plots.length,3);
 for(const p of previous.cycle)if(Number.isFinite(p.interval))assert.equal(p.prediction,p.interval-1);
 assert.match(studyPlots(s)[1].label,/이전경과/);assert.match(cycleLegendValues(s,previous.cycle.at(-1)).interval,/이전경과/);
 s.params.predictionSource='current';const current=studyData(s,raw);assert.equal(current.plots.length,3);
 for(const p of current.cycle)if(Number.isFinite(p.forecastEnd)){assert.equal(p.prediction,p.forecastEnd);near(p.forecastEnd,p.elapsed+p.forecastRemaining-1);}
 assert.deepEqual(current.cycle.map(p=>p.elapsed),original.cycle.map(p=>p.elapsed));assert.deepEqual(current.cycle.map(p=>p.interval),original.cycle.map(p=>p.interval));
});

test('elapsed-aligned forecasts change each candle and are not replaced by a one-step elapsed counter',()=>{
 const s=cycle('remaining','mean-bars'),d=studyData(s,raw);assert.match(studyPlots(s)[1].label,/평균 예상경과/);
 const points=d.cycle.filter(p=>Number.isFinite(p.prediction));assert.ok(points.length>40);assert.ok(new Set(points.map(p=>p.prediction)).size>5);
 assert.ok(points.some((p,i)=>i&&p.elapsed===points[i-1].elapsed+1&&Math.abs(p.prediction-points[i-1].prediction-1)>.01));
 assert.match(cycleReadings(s,d.cycle.at(-1)),/예상 교차 경과.*남은/);
});

test('remaining mode plots elapsed plus remaining with no one-bar deduction for every forecast aggregate, anchor and ratio basis',()=>{
 for(const method of ['fastest','mean-bars','mean-price'])for(const anchor of ['live','closed'])for(const display of ['bars','ratio'])for(const basis of ['full','half']){
  const s=cycle('remaining',method);Object.assign(s.params,{anchor,display,basis});const data=studyData(s,raw),plot=new Map(data.plots[1].data.map(p=>[p.time,p.value]));let checked=0;
  for(const meta of data.cycle){
   if(Number.isFinite(meta.elapsed)&&Number.isFinite(meta.forecastRemaining)){
    const target=meta.elapsed+meta.forecastRemaining;near(meta.forecastTarget,target);near(meta.prediction,target);near(plot.get(meta.time),display==='bars'?target:target/meta.basis);near(meta.forecastEnd,target-1);checked++;
   }else{assert.ok(!Number.isFinite(meta.prediction));assert.ok(!Number.isFinite(plot.get(meta.time)));}
  }
  assert.ok(checked>30,method+' '+anchor+' '+display+' '+basis);
 }
});

test('the legend retains remaining length separately from the plotted target in both bars and multiples',()=>{
 const s=cycle('remaining','fastest'),meta={period:100,basis:100,elapsed:29,forecastRemaining:17,forecastTarget:46,prediction:46,forecastEnd:45};
 s.params.display='ratio';assert.equal(cycleLegendValues(s,meta).interval,'최단 예상경과 0.46배 · 남은 0.17배');assert.match(cycleForecastReadings(s,meta),/현재 경과 0.29배 \+ 예상 남은 0.17배 ≈ 예상 교차 경과 0.46배/);
 s.params.display='bars';assert.equal(cycleLegendValues(s,meta).interval,'최단 예상경과 46봉 · 남은 17봉');assert.match(cycleReadings(s,meta),/예상 교차 경과 46봉 · 남은 17봉/);
});

test('theory full and half scales convert the same predicted crossing time instead of changing its calculation',()=>{
 const s=cycle('current');s.params.display='ratio';const full=studyData(s,raw);s.params.basis='half';const half=studyData(s,raw);
 for(let i=0;i<raw.length;i++){assert.equal(half.cycle[i].forecastRemaining,full.cycle[i].forecastRemaining);if(Number.isFinite(full.cycle[i].prediction))near(half.plots[1].data.find(p=>p.time===raw[i].time).value,full.plots[1].data.find(p=>p.time===raw[i].time).value*2);}
});

test('historical forecasts are causal under append, live edits with a closed anchor, cache reuse and old-bar corrections',()=>{
 for(const average of ['SMA','EMA','VWMA','KAMA','HMA']){
  const s=cycle('current','mean-price');s.params.average=average;s.params.anchor='closed';const before=studyData(s,raw.slice(0,100)),full=studyData(s,raw);
  assert.deepEqual(full.cycle.slice(0,100),before.cycle,average);
  const live=structuredClone(raw);Object.assign(live.at(-1),{open:1000,high:1100,low:900,close:1050,volume:99999});assert.deepEqual(studyData(s,live).cycle.at(-1),full.cycle.at(-1),average);
  const corrected=structuredClone(raw);corrected[90].close+=5;const changed=studyData(s,corrected);assert.notDeepEqual(changed.cycle.slice(90,120),full.cycle.slice(90,120),average);
  assert.deepEqual(studyData(s,raw).cycle,full.cycle,average);
 }
});

test('prediction source and scenario controls are validated and saved without silently changing old interval settings',()=>{
 const s=cycle('current','mean-bars');s.params.forecastUseHigh=false;const decoded=decodeStudies(JSON.stringify({version:1,timeframeVersion:2,studies:[s]})).studies[0];assert.deepEqual(decoded,s);
 const legacy=cycle('interval');for(const key of Object.keys(legacy.params))if(key==='predictionSource'||key.startsWith('forecast'))delete legacy.params[key];const value=validateStudy(legacy);assert.equal(value.params.predictionSource,'interval');assert.deepEqual(value.styles,legacy.styles);
 for(const [key,bad]of [['predictionSource','other'],['forecastMethod','other'],['forecastRangeBars',0],['forecastSearchBars',501],['forecastUseHigh','true']])assert.throws(()=>validateStudy({...s,params:{...s.params,[key]:bad}}));
});

test('previous completed elapsed is a separate reference and never enters current minimum or average candidates',()=>{
 for(const method of ['fastest','mean-bars','mean-price']){
  const s=cycle('current',method),forecast=createStudy('MA_FORECAST',{candle:'standard'});
  Object.assign(forecast.params,{method,anchor:'live',period0:13,period1:26,showCrossing:true,searchBars:35,rangeBars:26,slopeBars:3});
  const predicted=studyData(forecast,raw).forecast,cycleNow=studyData(s,raw).cycle.at(-1);
  assert.equal(cycleNow.forecastRemaining,predicted.comparison.crossBars);
  assert.ok(predicted.candidates.every(c=>!['previous','interval','elapsed'].includes(c.id)));
  assert.ok(predicted.candidates.some(c=>c.id==='cross-close'),'past cross PRICE remains a valid separate candidate');
  s.params.predictionSource='previous';const old=studyData(s,raw).cycle.at(-1);assert.equal(old.prediction,old.interval-1);
  s.params.predictionSource='current';assert.equal(studyData(s,raw).cycle.at(-1).forecastRemaining,cycleNow.forecastRemaining);
 }
});
