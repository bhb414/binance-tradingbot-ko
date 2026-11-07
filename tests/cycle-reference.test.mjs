import test from 'node:test';import assert from 'node:assert/strict';
import {theoreticalCyclePeriod,cycleReferenceMessage,cycleReadings,cycleLegendValues} from '../public/cycle-reference.js';
import {createStudy,studyData,decodeStudies,validateStudy,studyPlots} from '../public/chart-studies.js';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
const near=(a,b,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const raw=Array.from({length:700},(_,i)=>({time:1700000000+i*60,open:100+Math.sin(i*Math.PI/20)-.1,high:101+Math.sin(i*Math.PI/20),low:99+Math.sin(i*Math.PI/20),close:100+Math.sin(i*Math.PI/20),volume:10+i%7}));
const last=data=>data.plots.map(p=>p.data.at(-1)?.value??null);
function referenceWMA(xs,n){return xs.map((_,i)=>i<n-1?null:xs.slice(i-n+1,i+1).reduce((sum,x,j)=>sum+x*(j+1),0)/(n*(n+1)/2));}
function referenceHullImpulse(n){const xs=[...Array(600).fill(0),1,...Array(600).fill(0)],a=referenceWMA(xs,Math.max(1,Math.floor(n/2))),b=referenceWMA(xs,n),difference=a.map((v,i)=>v===null||b[i]===null?0:2*v-b[i]);return referenceWMA(difference,Math.max(1,Math.floor(Math.sqrt(n)))).slice(600,600+n+Math.floor(Math.sqrt(n)));}
const magnitude=(xs,w)=>Math.hypot(xs.reduce((sum,x,i)=>sum+x*Math.cos(w*i),0),xs.reduce((sum,x,i)=>sum-x*Math.sin(w*i),0));

test('SMA 7/15 theory uses the complex difference response rather than either MA or a crossing count',()=>{
 near(theoreticalCyclePeriod('SMA',7,15),20.1535014848,.0001);
 const period=theoreticalCyclePeriod('SMA',7,15),w=2*Math.PI/period,weights=Array.from({length:15},(_,i)=>(i<7?1/7:0)-1/15),peak=magnitude(weights,w);
 for(let i=1;i<=3000;i++)assert.ok(magnitude(weights,i*Math.PI/3000)<=peak+1e-9);
});
test('EMA theoretical periods agree with the independent analytic maximum including the Nyquist boundary',()=>{
 for(const [fast,slow]of [[1,2],[7,15],[20,60],[299,300]]){const a=2/(fast+1),b=2/(slow+1),q=(1-a)*(1-b),t=q?a*b/(2*Math.sqrt(q)):2,expected=2*Math.PI/Math.acos(1-Math.min(2,t));near(theoreticalCyclePeriod('EMA',fast,slow),expected,.001);}
});
test('Hull theoretical periods maximize independently generated causal impulse responses',()=>{
 for(const [fast,slow]of [[1,2],[7,15],[20,60]]){const a=referenceHullImpulse(fast),b=referenceHullImpulse(slow),weights=Array.from({length:Math.max(a.length,b.length)},(_,i)=>(a[i]||0)-(b[i]||0)),period=theoreticalCyclePeriod('HMA',fast,slow),peak=magnitude(weights,2*Math.PI/period);assert.ok(period>=2);for(let i=1;i<=1000;i++)assert.ok(magnitude(weights,i*Math.PI/1000)<=peak+1e-8);}
});
test('time-varying weighted averages and invalid period pairs never get a fabricated theoretical period',()=>{
 for(const kind of ['VWMA','KAMA','other'])assert.equal(theoreticalCyclePeriod(kind,7,15),null);
 for(const pair of [[0,15],[7,7],[15,7],[1.5,15],[7,501],[NaN,15]])assert.equal(theoreticalCyclePeriod('SMA',...pair),null);
});
test('switching references changes the denominator and reference line while leaving measured crossings unchanged',()=>{
 const s=createStudy('CYCLE',{candle:'standard'}),estimated=studyData(s,raw);assert.equal(last(estimated)[0],40);
 s.params.reference='theory';const theory=studyData(s,raw);near(last(theory)[0],20.1535014848,.0001);assert.deepEqual(last(theory).slice(1),last(estimated).slice(1));assert.match(theory.caption,/이론 주기/);
 s.params.display='ratio';const ratios=studyData(s,raw),meta=theory.cycle.at(-1);assert.equal(last(ratios)[0],1);near(last(ratios)[1],meta.interval/meta.period);near(last(ratios)[2],meta.elapsed/meta.period);
 s.params.basis='half';const half=studyData(s,raw);near(last(half)[1],last(ratios)[1]*2);near(half.cycle.at(-1).basis,meta.period/2);assert.match(studyPlots(s)[0].label,/배/);
});
test('theory remains available on nonperiodic prices while estimated mode correctly stays unknown',()=>{
 const flat=raw.map(c=>({...c,open:100,high:100,low:100,close:100})),s=createStudy('CYCLE',{candle:'standard'}),estimated=studyData(s,flat);assert.equal(last(estimated)[0],null);assert.match(cycleReferenceMessage(s,estimated.cycle.at(-1)),/반복성/);
 s.params.reference='theory';s.params.display='ratio';const theory=studyData(s,flat);assert.equal(last(theory)[0],1);assert.ok(theory.cycle.at(-1).basis>0);assert.equal(cycleReferenceMessage(s,theory.cycle.at(-1)),'');
});
test('closed-candle observations and theoretical history stay causal under append and current-price edits',()=>{
 const s=createStudy('CYCLE',{candle:'standard'});s.params.reference='theory';s.params.display='ratio';const before=studyData(s,raw.slice(0,400)),full=studyData(s,raw);assert.deepEqual(full.cycle.slice(0,400),before.cycle);
 const changed=structuredClone(raw);Object.assign(changed.at(-1),{open:1000,high:1100,low:900,close:1050});assert.deepEqual(last(studyData(s,changed)),last(full));
});
test('unsupported theoretical averages explain the missing denominator without hiding raw measurements',()=>{
 const s=createStudy('CYCLE');s.params.reference='theory';s.params.average='VWMA';s.params.display='ratio';const data=studyData(s,raw),meta=data.cycle.at(-1);assert.equal(meta.period,null);assert.match(data.caption,/가중치가 봉마다/);assert.match(cycleReferenceMessage(s,meta),/실측 후보/);assert.match(cycleLegendValues(s,{period:null,basis:null,interval:14,elapsed:4}).interval,/14봉.*배수 대기/);
});
test('missing-data messages distinguish insufficient candles from failed periodicity checks',()=>{
 const s=createStudy('CYCLE');assert.match(cycleReferenceMessage(s,{period:null,available:37}),/37 \/ 200봉/);assert.match(cycleReferenceMessage(s,{period:null,available:200}),/반복성/);assert.equal(cycleReferenceMessage(s,{period:40}),'');
});
test('legend and historical readings name the selected reference and explicitly show the optional half scale',()=>{
 const s=createStudy('CYCLE');s.params.reference='theory';s.params.display='ratio';const meta={period:20,basis:20,interval:30,elapsed:5};assert.equal(cycleLegendValues(s,meta).period,'이론 1배 20봉');assert.equal(cycleLegendValues(s,meta).interval,'간격 1.5배');assert.match(cycleReadings(s,meta),/이론 주기 20봉.*1배 기준 20봉/);
 s.params.reference='estimated';s.params.basis='half';assert.match(cycleLegendValues(s,{...meta,basis:10}).period,/실측 후보 ½ 1배 10봉/);assert.match(cycleReadings(s,{...meta,basis:10}),/선택 주기의 ½/);
});
test('legacy cycle settings gain only the estimated reference default and retain every previous selection',()=>{
 const legacy=createStudy('CYCLE');delete legacy.params.reference;legacy.params.basis='half';legacy.params.anchor='live';legacy.styles.elapsed.visible=false;const previous=structuredClone(legacy),decoded=decodeStudies(JSON.stringify({version:1,timeframeVersion:2,studies:[legacy]})).studies[0];assert.equal(decoded.params.reference,'estimated');delete decoded.params.reference;assert.deepEqual(decoded,previous);assert.deepEqual(legacy,previous);assert.throws(()=>validateStudy({...legacy,params:{...legacy.params,reference:'invalid'}}));
});
test('both reference choices survive server persistence without touching unrelated indicators',async()=>{
 const bb=createStudy('BB'),s=createStudy('CYCLE'),store=new ChartSettingsStore(null);let revision=0;
 for(const reference of ['theory','estimated']){s.params.reference=reference;const document={version:1,timeframeVersion:2,studies:[bb,s]};await store.save({revision,document});const saved=await store.get();assert.deepEqual(saved.document,document);revision=saved.revision;}
});
