import test from 'node:test';
import assert from 'node:assert/strict';
import {CHART_HEIGHT_KEY,chartHeightForViewport,installChartHeight} from '../public/chart-height.js';
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
const classes=()=>({values:new Set(),add(key){this.values.add(key);},remove(key){this.values.delete(key);},contains(key){return this.values.has(key);}});
const event=(target,type,props={})=>{const e=Object.assign(new Event(type,{cancelable:true}),props);target.dispatchEvent(e);return e;};
function setup(storage=memory()){
 const win=Object.assign(new EventTarget(),{innerHeight:1000,localStorage:storage}),doc=new EventTarget(),style=new Map(),attributes=new Map(),captures=new Set(),frames=new Map();let next=0;
 doc.defaultView=win;doc.documentElement={classList:classes()};
 const body={getBoundingClientRect:()=>({height:Number.parseFloat(style.get('--chart-body-height'))})};
 const panel={ownerDocument:doc,classList:classes(),style:{setProperty:(key,value)=>style.set(key,value)},querySelector:()=>body};
 const handle=Object.assign(new EventTarget(),{setAttribute:(key,value)=>attributes.set(key,value),getAttribute:key=>attributes.get(key),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)});
 const options={storage,window:win,frame:callback=>{frames.set(++next,callback);return next;},cancel:id=>frames.delete(id)};
 const control=installChartHeight(panel,handle,options);
 return {win,doc,panel,handle,storage,control,frames,captures,height:()=>body.getBoundingClientRect().height,tick(){for(const [id,callback]of frames){frames.delete(id);callback();}}};
}
test('chart height fits the viewport independently of study count and bounds manual sizes',()=>{
 assert.equal(chartHeightForViewport(1000),650);assert.equal(chartHeightForViewport(800),520);assert.equal(chartHeightForViewport(2000),1000);
 assert.equal(chartHeightForViewport(300),260);assert.equal(chartHeightForViewport(1000,1.5),1500);
 for(const bad of [NaN,Infinity,-1,0,4,'1'])assert.equal(chartHeightForViewport(1000,bad),650);
});
test('outer drag batches frames, flushes the last movement on release outside, and saves a responsive ratio',()=>{
 const s=setup();event(s.handle,'pointerdown',{button:0,pointerId:7,clientY:500});assert(s.captures.has(7));
 event(s.doc,'pointermove',{pointerId:7,clientY:550});event(s.doc,'pointermove',{pointerId:7,clientY:650});assert.equal(s.frames.size,1);assert.equal(s.height(),650);
 event(s.doc,'pointerup',{pointerId:8});assert(s.captures.has(7));event(s.doc,'pointerup',{pointerId:7});assert.equal(s.height(),800);assert.equal(s.frames.size,0);assert.equal(s.captures.size,0);
 assert.equal(s.doc.documentElement.classList.contains('chart-height-dragging'),false);assert.deepEqual(JSON.parse(s.storage.getItem(CHART_HEIGHT_KEY)),{version:1,ratio:.8});
 const reload=setup(s.storage);assert.equal(reload.height(),800);reload.win.innerHeight=750;event(reload.win,'resize');assert.equal(reload.height(),600);assert.equal(JSON.parse(reload.storage.getItem(CHART_HEIGHT_KEY)).ratio,.8);
});
test('keyboard resizing, minimum height, double click and Home reset persist without altering pane layout storage',()=>{
 const s=setup();s.storage.setItem('fw-chart-workspace-v1','pane ratios');
 event(s.handle,'keydown',{key:'ArrowDown'});assert.equal(s.height(),674);event(s.handle,'keydown',{key:'ArrowUp',shiftKey:true});assert.equal(s.height(),594);
 event(s.handle,'pointerdown',{button:0,pointerId:1,clientY:500});event(s.doc,'pointermove',{pointerId:1,clientY:-5000});s.tick();event(s.doc,'pointercancel',{pointerId:1});assert.equal(s.height(),260);
 event(s.handle,'keydown',{key:'Home'});assert.equal(s.height(),650);assert.equal(s.storage.getItem(CHART_HEIGHT_KEY),undefined);
 event(s.handle,'keydown',{key:'ArrowDown'});event(s.handle,'dblclick');assert.equal(s.height(),650);assert.equal(s.storage.getItem('fw-chart-workspace-v1'),'pane ratios');
});
test('fullscreen ignores the outer handle, retains the normal height, and disposing removes drag listeners',()=>{
 const s=setup();event(s.handle,'keydown',{key:'ArrowDown'});s.panel.classList.add('is-chart-fullscreen');
 event(s.handle,'pointerdown',{button:0,pointerId:1,clientY:500});event(s.doc,'pointermove',{pointerId:1,clientY:700});event(s.handle,'keydown',{key:'ArrowUp'});event(s.handle,'dblclick');assert.equal(s.height(),674);assert.equal(s.captures.size,0);
 s.panel.classList.remove('is-chart-fullscreen');s.control.refresh();assert.equal(s.height(),674);
 event(s.handle,'pointerdown',{button:2,pointerId:2,clientY:500});assert.equal(s.captures.size,0);
 s.control.destroy();event(s.handle,'pointerdown',{button:0,pointerId:1,clientY:500});event(s.doc,'pointermove',{pointerId:1,clientY:700});assert.equal(s.frames.size,0);assert.equal(s.height(),674);
});
test('unavailable or corrupt local storage leaves the chart and height control usable',()=>{
 for(const storage of [{getItem(){return '{broken';},setItem(){throw Error();},removeItem(){throw Error();}},{getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}}]){
  const s=setup(storage);assert.equal(s.height(),650);event(s.handle,'keydown',{key:'ArrowDown'});assert.equal(s.height(),674);event(s.handle,'keydown',{key:'Home'});assert.equal(s.height(),650);
 }
});
