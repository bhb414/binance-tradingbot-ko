import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartWorkspace} from '../public/chart-workspace.js';
import {capturePaneRatios,restorePaneRatios,installPaneResizePersistence} from '../public/chart-pane-layout.js';
import {installChartFullscreen} from '../public/chart-fullscreen.js';
import {cycleRatioGridRows} from '../public/cycle-ratio-grid.js';

const memory=()=>{const values=new Map();return {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};};
const pane=height=>({height,factor:1,getHeight(){return this.height;},setStretchFactor(value){this.factor=value;}});
test('saved panel ratios survive temporary default studies and restore when the shared study list arrives',()=>{
 const storage=memory(),workspace=new ChartWorkspace(storage),rows=[{pane:1,study:{id:'saved-cycle'}},{pane:2,study:{id:'saved-volume'}}],panes=[pane(500),pane(300),pane(200)],chart={panes:()=>panes};
 workspace.remember('usdm','KORUUSDT','1m',{count:500,range:{from:350,to:500},panes:capturePaneRatios(chart,rows)});
 // A reload can draw local defaults before receiving the shared settings.
 workspace.remember('usdm','KORUUSDT','1m',{count:500,range:{from:350,to:500},panes:{price:.8,'default-volume':.2}});
 const restored=new ChartWorkspace(storage).view('usdm','KORUUSDT','1m').panes;
 assert.ok(Math.abs(restored['saved-cycle']-.48)<1e-10);assert.ok(Math.abs(restored['saved-volume']-.32)<1e-10);
 restorePaneRatios(chart,rows,restored);assert.ok(Math.abs(panes[1].factor/panes[0].factor-.3/.5)<1e-10);
 assert.ok(Math.abs(panes[2].factor/panes[0].factor-.2/.5)<1e-10);
 const changedRows=[rows[1],rows[0]].map((row,index)=>({...row,pane:index+1}));restorePaneRatios(chart,changedRows,restored);
 assert.ok(Math.abs(panes[1].factor/panes[0].factor-.2/.5)<1e-10,'restore by study ID, not old pane index');
});

test('pane drag completion saves after the library resize frame, including release outside the chart',()=>{
 const element=new EventTarget(),doc=new EventTarget(),frames=[];let value=10,saved=null;
 const dispose=installPaneResizePersistence(element,()=>{saved=value;},{document:doc,frame:callback=>frames.push(callback)});
 element.dispatchEvent(new Event('pointerdown'));doc.dispatchEvent(new Event('pointerup'));value=40;assert.equal(saved,null);frames.shift()();assert.equal(saved,40);
 doc.dispatchEvent(new Event('pointerup'));assert.equal(frames.length,0);
 element.dispatchEvent(new Event('pointerdown'));doc.dispatchEvent(new Event('pointercancel'));value=60;frames.shift()();assert.equal(saved,60);
 dispose();element.dispatchEvent(new Event('pointerdown'));doc.dispatchEvent(new Event('pointerup'));assert.equal(frames.length,0);
});

function fakeFullscreen({supported=true,fail=false}={}){
 const classes=()=>({values:new Set(),toggle(key,enabled){enabled?this.values.add(key):this.values.delete(key);},contains(key){return this.values.has(key);}});
 const doc=new EventTarget(),panel={classList:classes()},button=Object.assign(new EventTarget(),{attributes:{},setAttribute(key,value){this.attributes[key]=value;}});
 doc.documentElement={classList:classes()};doc.fullscreenElement=null;doc.dialog=false;doc.querySelector=()=>doc.dialog?{}:null;
 if(supported)doc.documentElement.requestFullscreen=async()=>{if(fail)throw Error('denied');doc.fullscreenElement=doc.documentElement;doc.dispatchEvent(new Event('fullscreenchange'));};
 doc.exitFullscreen=async()=>{doc.fullscreenElement=null;doc.dispatchEvent(new Event('fullscreenchange'));};
 const control=installChartFullscreen(panel,button,{document:doc});return {doc,panel,button,control};
}
test('full screen expands the current chart, exits with browser Escape and leaves another native full-screen owner alone',async()=>{
 const {doc,panel,button,control}=fakeFullscreen();await control.enter();assert.equal(doc.fullscreenElement,doc.documentElement);assert.equal(control.active,true);assert.equal(button.attributes['aria-label'],'차트 전체화면 해제');assert.equal(panel.classList.contains('is-chart-fullscreen'),true);
 await doc.exitFullscreen();assert.equal(control.active,false);assert.equal(panel.classList.contains('is-chart-fullscreen'),false);
 const other={};doc.fullscreenElement=other;await control.enter();await control.exit();assert.equal(doc.fullscreenElement,other);assert.equal(button.attributes['aria-pressed'],'false');
});

test('unsupported or denied native fullscreen retains a usable full-window mode and does not consume Escape from a settings dialog',async()=>{
 for(const options of [{supported:false},{fail:true}]){
  const {doc,panel,control}=fakeFullscreen(options);await control.enter();assert.equal(control.active,true);assert.equal(panel.classList.contains('is-chart-fullscreen'),true);
  const escape=()=>{const e=new Event('keydown',{cancelable:true});e.key='Escape';doc.dispatchEvent(e);};
  doc.dialog=true;escape();assert.equal(control.active,true);doc.dialog=false;escape();assert.equal(control.active,false);
 }
});

test('mobile and touch screens expand only inside the browser and never request native fullscreen that hides navigation',async()=>{
 const {doc,panel,control}=fakeFullscreen();let queries=0;
 doc.defaultView={matchMedia(query){assert.equal(query,'(pointer:coarse), (max-width:900px)');queries++;return {matches:true};}};
 await control.enter();assert.equal(queries,1);assert.equal(doc.fullscreenElement,null);assert.equal(control.active,true);assert.equal(panel.classList.contains('is-chart-fullscreen'),true);
 await control.exit();assert.equal(doc.fullscreenElement,null);assert.equal(control.active,false);
});

test('cycle grid includes every visible half multiple above one, follows zoom, and remains bounded by viewport pixels',()=>{
 const series=(lo,hi,height)=>({priceToCoordinate:value=>(hi-value)/(hi-lo)*height,coordinateToPrice:y=>hi-y/height*(hi-lo)});
 assert.deepEqual(cycleRatioGridRows(series(0,8,400),400).map(p=>p.value).sort((a,b)=>a-b),[.25,.5,.75,...Array.from({length:15},(_,i)=>1+i*.5)]);
 assert.deepEqual(cycleRatioGridRows(series(.7,.8,400),400).map(p=>p.value),[.75]);
 assert.deepEqual(cycleRatioGridRows(series(5,10,400),400).map(p=>p.value).sort((a,b)=>a-b),Array.from({length:11},(_,i)=>5+i*.5));
 const large=cycleRatioGridRows(series(0,1e9,300),300);assert.ok(large.length<=301);assert.ok(large.every(p=>p.value<1||p.value*2===Math.round(p.value*2)));
 assert.deepEqual(cycleRatioGridRows(series(0,8,400),0),[]);
});
