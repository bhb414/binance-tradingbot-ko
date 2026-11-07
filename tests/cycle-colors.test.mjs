import test from 'node:test';
import assert from 'node:assert/strict';
import {createCrossTracker} from '../public/adaptive-cycle.js';
import {createStudy,studyData,validateStudy,decodeStudies} from '../public/chart-studies.js';
import {cycleReadings,cycleLegendValues,cycleElapsedColor} from '../public/cycle-reference.js';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
const candles=prices=>prices.map((close,i)=>({time:1700000000+i*60,open:close,high:close+.1,low:close-.1,close,volume:3+i%5}));
const sample=candles([3,2,1,2,3,3,3,2,1,1,2,3]);
function study(){const s=createStudy('CYCLE',{candle:'standard'});Object.assign(s.params,{fast:1,slow:2,reference:'theory',anchor:'live'});Object.assign(s.styles.elapsed,{color:'#12ab34',negative:'#ab1234'});return s;}
const elapsedPlot=data=>data.plots.find(p=>p.key==='elapsed').data;

test('cross direction follows accepted alternating events, survives equality and resets across missing inputs',()=>{
 const tracker=createCrossTracker(),directions=[],elapsed=[];
 for(const n of [-1,1,0,1,0,-1,-1,1,1,-1]){tracker.push(n,0);directions.push(tracker.direction);elapsed.push(tracker.elapsed);}
 assert.deepEqual(directions,[null,1,1,1,1,-1,-1,1,1,-1]);assert.deepEqual(elapsed,[null,0,1,2,3,0,1,0,1,0]);
 tracker.push(null,0);assert.equal(tracker.direction,null);assert.equal(tracker.elapsed,null);
 tracker.push(1,0);assert.equal(tracker.direction,null);tracker.push(-1,0);assert.equal(tracker.direction,-1);assert.equal(tracker.elapsed,0);
});

test('elapsed line carries independently chosen golden and dead colors at the correct bars, including zero and equality',()=>{
 const s=study(),data=studyData(s,sample),expectedDirections=[null,null,null,1,1,1,1,-1,-1,-1,1,1];
 assert.deepEqual(data.cycle.map(p=>p.direction),expectedDirections);
 assert.deepEqual(data.cycle.map(p=>p.elapsed),[null,null,null,0,1,2,3,0,1,2,0,1]);
 assert.equal(data.plots.length,3);
 for(const point of elapsedPlot(data)){if(!Number.isFinite(point.value))continue;const index=sample.findIndex(c=>c.time===point.time);assert.equal(point.color,expectedDirections[index]===1?'#12ab34':'#ab1234');}
 const changed=structuredClone(s);Object.assign(changed.styles.elapsed,{color:'#112233',negative:'#aabbcc'});const recolored=studyData(changed,sample);
 assert.deepEqual(recolored.cycle,data.cycle);assert.deepEqual(elapsedPlot(recolored).map(({color,...p})=>p),elapsedPlot(data).map(({color,...p})=>p));
});

test('closed anchors lag phase and elapsed together and ignore live-candle price edits; ratio units retain the same phases',()=>{
 const s=study(),live=studyData(s,sample);s.params.anchor='closed';const closed=studyData(s,sample);
 assert.deepEqual(closed.cycle.map(p=>p.direction),[null,...live.cycle.slice(0,-1).map(p=>p.direction)]);
 assert.deepEqual(closed.cycle.map(p=>p.elapsed),[null,...live.cycle.slice(0,-1).map(p=>p.elapsed)]);
 const changed=structuredClone(sample);Object.assign(changed.at(-1),{open:500,high:600,low:400,close:500});assert.deepEqual(elapsedPlot(studyData(s,changed)),elapsedPlot(closed));
 s.params.display='ratio';s.params.basis='half';const ratios=studyData(s,sample);assert.deepEqual(ratios.cycle.map(p=>p.direction),closed.cycle.map(p=>p.direction));
 assert.deepEqual(elapsedPlot(ratios).filter(p=>Number.isFinite(p.value)).map(p=>p.color),elapsedPlot(closed).filter(p=>Number.isFinite(p.value)).map(p=>p.color));
 const prefix=studyData(s,sample.slice(0,8));assert.deepEqual(ratios.cycle.slice(0,8),prefix.cycle);
});

test('legend names and swatches identify golden or dead phases without classifying an unknown initial side',()=>{
 const s=study(),data=studyData(s,sample);
 for(const [index,name,color]of [[6,'골든','#12ab34'],[9,'데드','#ab1234']]){const meta=data.cycle[index];assert.match(cycleLegendValues(s,meta).elapsed,new RegExp(name+' 경과'));assert.match(cycleReadings(s,meta),new RegExp(name+'크로스 이후 경과'));assert.equal(cycleElapsedColor(s,meta),color);}
 assert.equal(cycleLegendValues(s,data.cycle[1]).elapsed,'경과 미확인');assert.doesNotMatch(cycleReadings(s,data.cycle[1]),/크로스 이후/);
});

test('both colors survive validation, browser decoding and shared server settings without changing legacy selections',async()=>{
 const s=study(),bb=createStudy('BB'),store=new ChartSettingsStore(null),document={version:1,timeframeVersion:2,studies:[bb,s]};
 assert.deepEqual(validateStudy(s),s);assert.deepEqual(decodeStudies(JSON.stringify(document)),document);
 await store.save({revision:0,document});assert.deepEqual((await store.get()).document,document);
 assert.throws(()=>validateStudy({...s,styles:{...s.styles,elapsed:{...s.styles.elapsed,negative:'invalid'}}}),/스타일/);
});
