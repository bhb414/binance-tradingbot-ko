import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudy,studyData,validateStudy,decodeStudies} from '../public/chart-studies.js';
import {projectCycleProgress,projectionVisibleRange} from '../public/cycle-projection.js';
import {CycleSegments,cycleSegmentData} from '../public/cycle-segments.js';
import {studyChartHit} from '../public/chart-hit.js';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
const raw=Array.from({length:150},(_,i)=>({time:1700000000+i*60,open:100+Math.sin(i/7),high:102+Math.sin(i/7),low:98+Math.sin(i/7),close:100+Math.sin(i/7+.3),volume:3+i%13}));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(b)),a+' != '+b);
function study(){const s=createStudy('CYCLE',{candle:'standard'});Object.assign(s.params,{fast:13,slow:26,reference:'theory',predictionSource:'remaining',anchor:'live',projectionBars:10});return s;}

test('cycle projection adds one elapsed bar per future candle and freezes the selected target at its current height',()=>{
 const s=study(),meta={elapsed:8,prediction:12.5,basis:20,direction:-1};s.params.display='ratio';
 const p=projectCycleProgress(s,raw,[meta],'1m'),elapsed=p.plots[0].data,target=p.plots[1].data;
 assert.equal(elapsed.length,11);assert.equal(p.meetingBars,4.5);assert.equal(p.withinHorizon,true);
 for(let h=0;h<=10;h++){assert.equal(elapsed[h].time,raw.at(-1).time+h*60);near(elapsed[h].value,(8+h)/20);near(target[h].value,12.5/20);assert.equal(elapsed[h].color,s.styles.elapsed.negative);}
 near((elapsed[4].value+elapsed[5].value)/2,target[0].value);
 s.params.display='bars';const bars=projectCycleProgress(s,raw,[meta]);near(bars.plots[0].data[10].value,18);near(bars.plots[1].data[10].value,12.5);assert.equal(bars.meetingBars,4.5);
});

test('extensions start exactly at the displayed live or closed observation without an extra lag or changed historical values',()=>{
 for(const anchor of ['closed','live'])for(const display of ['bars','ratio']){
  const s=study();Object.assign(s.params,{anchor,display});const d=studyData(s,raw),p=d.cycleProjection,meta=d.cycle.at(-1);
  for(const plot of p.plots){const history=d.plots.find(x=>x.key===plot.parent).data.at(-1);assert.equal(plot.data[0].time,history.time);near(plot.data[0].value,history.value);}
  near(p.meetingBars,meta.forecastRemaining);
  if(anchor==='closed'){const changed=structuredClone(raw);Object.assign(changed.at(-1),{open:500,high:600,low:400,close:550,volume:999});assert.deepEqual(studyData(s,changed).cycleProjection,p);}
  s.params.showProjection=false;const off=studyData(s,raw);assert.deepEqual(off.plots,d.plots);assert.deepEqual(off.cycle,d.cycle);assert.deepEqual(off.cycleProjection.plots,[]);
 }
});

test('changing the ratio basis scales both projected lines equally and never changes their meeting time',()=>{
 const s=study();s.params.display='ratio';const full=studyData(s,raw);s.params.basis='half';const half=studyData(s,raw);
 assert.equal(half.cycleProjection.meetingBars,full.cycleProjection.meetingBars);
 for(let i=0;i<2;i++)for(let h=0;h<=10;h++)near(half.cycleProjection.plots[i].data[h].value,full.cycleProjection.plots[i].data[h].value*2);
});

test('horizontal reference uses the selected slot, hides with its parent and does not invent a future meeting after the level is exceeded',()=>{
 const s=study(),meta={elapsed:8,prediction:12,interval:5,basis:20,direction:1};s.params.predictionSource='interval';
 let p=projectCycleProgress(s,raw,[meta]);assert.equal(p.meetingBars,null);assert.ok(p.plots[1].data.every(x=>x.value===5));
 s.params.predictionSource='previous';p=projectCycleProgress(s,raw,[meta]);assert.equal(p.meetingBars,4);assert.ok(p.plots[1].data.every(x=>x.value===12));
 s.styles.elapsed.visible=false;p=projectCycleProgress(s,raw,[meta]);assert.deepEqual(p.plots[0].data,[]);assert.ok(p.plots[1].data.length);
 s.params.display='ratio';assert.deepEqual(projectCycleProgress(s,raw,[{...meta,basis:null}]).plots,[]);
});

test('future candle timestamps honor monthly calendars and the configured display horizon',()=>{
 const s=study();s.params.projectionBars=3;const monthly=[{time:Date.UTC(2026,10,1)/1000}];
 const p=projectCycleProgress(s,monthly,[{elapsed:2,prediction:7,basis:1}],'1M');assert.equal(p.withinHorizon,false);assert.equal(p.meetingBars,5);
 assert.deepEqual(p.plots[0].data.map(x=>x.time),[Date.UTC(2026,10,1),Date.UTC(2026,11,1),Date.UTC(2027,0,1),Date.UTC(2027,1,1)].map(x=>x/1000));
 assert.deepEqual(projectCycleProgress(s,[],[]).plots,[]);
});

test('projection settings migrate, validate and persist without altering existing styles or selected forecast methods',async()=>{
 const s=study(),legacy=structuredClone(s);delete legacy.params.showProjection;delete legacy.params.projectionBars;
 const migrated=validateStudy(legacy);assert.equal(migrated.params.showProjection,true);assert.equal(migrated.params.projectionBars,26);assert.deepEqual(migrated.styles,s.styles);assert.equal(migrated.params.forecastMethod,s.params.forecastMethod);
 s.params.showProjection=false;s.params.projectionBars=48;const document={version:1,timeframeVersion:2,studies:[s]},store=new ChartSettingsStore(null);await store.save({revision:0,document});assert.deepEqual((await store.get()).document,document);assert.deepEqual(decodeStudies(JSON.stringify(document)),document);
 for(const [key,value]of [['projectionBars',0],['projectionBars',301],['projectionBars',1.5],['showProjection','true']])assert.throws(()=>validateStudy({...s,params:{...s.params,[key]:value}}));
});


test('both elapsed and nonzero forecasts break at actual crosses without losing timestamps, values or colors',()=>{
 const elapsed=[0,1,2,0,1,0,0,1],direction=[1,1,1,-1,-1,1,-1,-1],cycle=elapsed.map((value,i)=>({time:i,elapsed:value,direction:direction[i]}));
 for(const values of [elapsed,[3,4,5,6,7,2,9,10]]){
  const data=values.map((value,i)=>({time:i,value,color:direction[i]===1?'#00ff00':'#ff0000'})),original=structuredClone(data),segmented=cycleSegmentData(data,cycle),drawn=[];
  assert.deepEqual(data,original);assert.deepEqual(segmented.map(({breakBefore,...p})=>p),data);
  assert.deepEqual(segmented.map(p=>p.breakBefore),[false,false,false,true,false,true,true,false]);
  const primitive=new CycleSegments(),chart={timeScale:()=>({getVisibleRange:()=>({from:0,to:7}),timeToCoordinate:t=>t*30})},series={priceToCoordinate:v=>v*30};
  let start;const ctx={save(){},restore(){},setLineDash(){},beginPath(){},moveTo(x,y){start=[x,y];},lineTo(x,y){drawn.push({from:start,to:[x,y],color:this.strokeStyle});},stroke(){}};
  primitive.attached({chart,series,requestUpdate(){}});primitive.update(segmented,{color:'#ff0000',width:2,lineStyle:0});primitive.updateAllViews();primitive.paneViews()[0].renderer().draw({useMediaCoordinateSpace:f=>f({context:ctx})});
  assert.deepEqual(drawn.map(p=>p.from[0]/30),[0,1,3,6]);assert.deepEqual(drawn.map(p=>p.color),['#00ff00','#00ff00','#ff0000','#ff0000']);
  primitive.update([],{color:'#ff0000'});primitive.updateAllViews();assert.deepEqual(primitive.points,[]);primitive.detached();assert.equal(primitive.series,null);
 }
});

test('ratio changes without crosses stay connected and missing data cannot bridge a segment',()=>{
 const cycle=[{time:1,elapsed:8,direction:1},{time:2,elapsed:9,direction:1},{time:3,elapsed:10,direction:1},{time:4,elapsed:null,direction:null}],data=[{time:1,value:.4},{time:2,value:.5},{time:3,value:.45},{time:4}];
 const segmented=cycleSegmentData(data,cycle);assert.ok(segmented.every(p=>!p.breakBefore));assert.deepEqual(segmented.map(({breakBefore,...p})=>p),data);
});

test('tooltip geometry skips disconnected cycle strokes while keeping both boundary points selectable',()=>{
 const series={priceToCoordinate:v=>v*20},chart={timeScale:()=>({timeToCoordinate:t=>t*40,options:()=>({barSpacing:40})})},data=[{time:1,value:4},{time:2,value:1,breakBefore:true},{time:3,value:2}],plot={key:'elapsed',series,data,segments:{}},row={pane:1,study:{styles:{}},plots:[plot]};
 const hit=(x,y)=>studyChartHit(chart,[row],{time:Math.round(x/40),point:{x,y},paneIndex:1,hoveredSeries:series});
 assert.equal(hit(60,50),false);assert.equal(hit(40,80),true);assert.equal(hit(80,20),true);
 assert.equal(studyChartHit(chart,[row],{time:2,point:{x:100,y:30},paneIndex:1}),true);
});

test('future range keeps history and the anchoring observation on narrow screens without changing historical browsing',()=>{
 assert.deepEqual(projectionVisibleRange({from:501,to:526},500,26),{from:487,to:529});
 assert.deepEqual(projectionVisibleRange({from:400,to:500},500,26),{from:400,to:529});
 const old={from:20,to:100};assert.equal(projectionVisibleRange(old,500,26),old);
 const visible={from:450,to:540};assert.deepEqual(projectionVisibleRange(visible,500,26),visible);
 assert.equal(projectionVisibleRange(visible,500,0),visible);
});
