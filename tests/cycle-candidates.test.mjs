import test from 'node:test';import assert from 'node:assert/strict';
import {cycleCandidateSeries,cyclePeriod} from '../public/adaptive-cycle.js';
import {createStudy,studyData,average} from '../public/chart-studies.js';
import {compileFormula} from '../public/formula.js';
import {cycleReferenceMessage,cycleLegendValues,cycleReadings} from '../public/cycle-reference.js';
const mixed=Array.from({length:700},(_,i)=>[14,23,37,61].reduce((sum,p)=>sum+Math.sin(2*Math.PI*i/p),0));
const sine=Array.from({length:700},(_,i)=>100+.01*i+Math.sin(2*Math.PI*i/40));
const candles=xs=>xs.map((close,i)=>({time:1700000000+i*60,open:close,high:close+.1,low:close-.1,close,volume:10}));

test('weak chart candidates remain visible while the strict formula estimator still returns unknown',()=>{
 const strict=cyclePeriod(mixed),candidate=cycleCandidateSeries(mixed).at(-1);assert.equal(strict.at(-1),null);assert.ok(candidate.period>0);assert.equal(candidate.confirmed,false);assert.equal(candidate.candidates.length,3);assert.equal(candidate.period,candidate.candidates[0].period);
 for(const p of candidate.candidates){assert.ok(p.explainedFraction>0&&p.explainedFraction<=1);assert.equal(p.confirmed,false);assert.ok(p.correlation>=-1&&p.correlation<=1);}
 assert.equal(compileFormula('주기추정(종가,200,8,100)').evaluate({close:mixed},699,{maxSteps:1000000}).value,null);
});
test('a previously confirmed cycle takes priority and keeps its strict value',()=>{
 const strict=cyclePeriod(sine),result=cycleCandidateSeries(sine);for(let i=199;i<sine.length;i++){assert.equal(result[i].period,strict[i]);assert.equal(result[i].confirmed,true);assert.equal(result[i].candidates[0].confirmed,true);}assert.equal(result.at(-1).period,40);
});
test('exploratory candidates require a clean lookback and never invent periods for flat or straight-line data',()=>{
 for(const xs of [Array(700).fill(7),Array.from({length:700},(_,i)=>100+.1*i)])assert.ok(cycleCandidateSeries(xs).every(p=>p.period===null&&p.candidates.length===0));
 const xs=[...mixed];xs[300]=null;const result=cycleCandidateSeries(xs);assert.ok(result.slice(0,199).every(p=>p.period===null));assert.ok(result.slice(300,500).every(p=>p.period===null));assert.ok(result[500].period>0);
});
test('candidate diagnostics do not repaint completed windows when later bars are appended or edited',()=>{
 const before=cycleCandidateSeries(mixed.slice(0,400)),full=cycleCandidateSeries(mixed);assert.deepEqual(full.slice(0,400),before);const changed=[...mixed];changed.fill(999,400);assert.deepEqual(cycleCandidateSeries(changed).slice(0,400),before);
});
test('candidate lists remain short and separate frequencies that the observation window can resolve',()=>{
 for(const point of cycleCandidateSeries(mixed)){assert.ok(point.candidates.length<=3);for(let i=0;i<point.candidates.length;i++)for(let j=i+1;j<point.candidates.length;j++)assert.ok(Math.abs(1/point.candidates[i].period-1/point.candidates[j].period)>=1/200);}
});
test('the native ratio chart uses a weak candidate without changing actual measured crossing lengths',()=>{
 const gain=p=>{const w=2*Math.PI/p,weights=Array.from({length:15},(_,i)=>(i<7?1/7:0)-1/15);return Math.hypot(weights.reduce((s,x,i)=>s+x*Math.cos(w*i),0),weights.reduce((s,x,i)=>s-x*Math.sin(w*i),0));};
 const prices=mixed.map((_,i)=>100+[14,23,37,61].reduce((s,p)=>s+Math.sin(2*Math.PI*i/p)/gain(p),0)),raw=candles(prices),s=createStudy('CYCLE',{candle:'standard'});s.params.anchor='live';s.params.display='ratio';const data=studyData(s,raw),meta=data.cycle.at(-1),short=average(prices,7),long=average(prices,15),difference=short.map((v,i)=>v===null||long[i]===null?null:v-long[i]);
 assert.equal(cyclePeriod(difference).at(-1),null);assert.ok(meta.period>0);assert.equal(meta.candidateConfirmed,false);assert.equal(data.plots[0].data.at(-1).value,1);assert.equal(data.plots[1].data.at(-1).value,meta.interval/meta.basis);assert.equal(data.plots[2].data.at(-1).value,meta.elapsed/meta.basis);
 const before={interval:meta.interval,elapsed:meta.elapsed};s.params.reference='theory';const theory=studyData(s,raw).cycle.at(-1);assert.deepEqual({interval:theory.interval,elapsed:theory.elapsed},before);
});
test('weak candidates are clearly labeled as references and show strengths rather than prediction probabilities',()=>{
 const s=createStudy('CYCLE');s.params.display='ratio';const point=cycleCandidateSeries(mixed).at(-1),meta={period:point.period,basis:point.period,interval:30,elapsed:5,candidateConfirmed:point.confirmed,candidates:point.candidates,available:200};
 assert.match(cycleReferenceMessage(s,meta),/참고 후보.*약함.*설명력/);assert.match(cycleLegendValues(s,meta).period,/실측 후보\(참고\)/);assert.match(cycleLegendValues(s,meta).interval,/배/);assert.match(cycleReadings(s,meta),/후보 .*설명력.*예측 확률이 아닙니다/);
});
test('closed-candle candidate ratios ignore changes to the still-forming candle',()=>{
 const raw=candles(mixed.map(v=>100+v)),s=createStudy('CYCLE',{candle:'standard'});s.params.display='ratio';const before=studyData(s,raw);const changed=structuredClone(raw);Object.assign(changed.at(-1),{open:1000,high:1200,low:900,close:1100});assert.deepEqual(studyData(s,changed).cycle.at(-1),before.cycle.at(-1));
});
