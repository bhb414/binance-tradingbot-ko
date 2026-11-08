import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartLabelPreferences,normalizeChartLabels,applyStudyAxisLabels,applyStudyCrosshairDots} from '../public/chart-labels.js';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
import {StudyPersistence} from '../public/study-persistence.js';
import {createStudy,decodeStudies} from '../public/chart-studies.js';
import {CurrentPriceLine} from '../public/chart-readout.js';
import {PositionPriceLines} from '../public/chart-positions.js';
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};};
const client=store=>new StudyPersistence({storage:memory(),request:async(_,options)=>options?.method==='POST'?store.save(options.body):store.get()});
test('legacy chart documents retain their shape and labels reject invalid types',()=>{
 const doc={version:1,timeframeVersion:2,studies:[]};assert.deepEqual(decodeStudies(JSON.stringify(doc)),doc);
 assert.deepEqual(normalizeChartLabels(undefined),{studies:true,current:true,positions:true});
 for(const value of [null,[],1,{studies:'false'},{current:0},{positions:null}])assert.throws(()=>normalizeChartLabels(value));
});
test('label settings survive indicator edits and restore in another browser from the server',async()=>{
 const store=new ChartSettingsStore(null),a=client(store),bb=createStudy('BB');await a.load();await a.save([bb]);
 const labels={studies:false,current:true,positions:false};await a.save(a.document.studies,labels);
 assert.deepEqual(a.document.studies,[bb]);const ema=createStudy('EMA');await a.save([bb,ema]);assert.deepEqual(a.document.labels,labels);
 const b=client(store);await b.load();assert.deepEqual(b.document,a.document);
 await assert.rejects(()=>b.save(b.document.studies,{studies:'no'}));assert.deepEqual((await store.get()).document,a.document);
});
test('failed and stale label saves do not erase the last successful settings or indicator layout',async()=>{
 const store=new ChartSettingsStore(null),a=client(store),b=client(store);await a.load();await a.save([]);await b.load();
 await a.save([],{studies:false,current:true,positions:true});const previous=structuredClone(b.document);
 await assert.rejects(()=>b.save([],{studies:true,current:false,positions:false}),/다른 화면/);assert.deepEqual(b.document,previous);
 const preferences=new ChartLabelPreferences();preferences.configure(()=>Promise.reject(Error('offline')));
 await assert.rejects(()=>preferences.set('studies',false),/offline/);assert.equal(preferences.value.studies,true);assert.equal(preferences.busy,false);
});
test('current and entry labels can hide independently while keeping price lines and surviving series replacement',()=>{
 const labels=new ChartLabelPreferences(),make=()=>({lines:[],removed:[],createPriceLine(options){const line={options,applyOptions(patch){this.options={...this.options,...patch};}};this.lines.push(line);return line;},removePriceLine(line){this.removed.push(line);}}),a=make(),current=new CurrentPriceLine(a,{labels}),positions=new PositionPriceLines(a,{labels});
 current.update(100,99);positions.update([{key:'long',price:95,title:'롱 평단',color:'#123456'}]);
 labels.apply({studies:false,current:false,positions:true});assert.equal(a.lines[0].options.axisLabelVisible,false);assert.equal(a.lines[1].options.axisLabelVisible,true);assert.ok(a.lines.every(line=>line.options.lineVisible));
 const b=make();current.setSeries(b);positions.setSeries(b);current.update(101,99);assert.equal(b.lines.length,2);assert.equal(b.lines[1].options.axisLabelVisible,false);
 labels.apply({studies:false,current:true,positions:false});assert.equal(b.lines[1].options.axisLabelVisible,true);assert.equal(b.lines[0].options.axisLabelVisible,false);assert.equal(b.lines.length,2);
 current.destroy();positions.destroy();assert.equal(labels.listeners.size,0);
});
test('hiding study axis titles leaves data untouched and never reveals transparent fill or arrow anchors',()=>{
 const line={data:[1,2,3],applyOptions(options){this.options=options;}},helper={applyOptions(options){this.options=options;}},rows=[{plots:[{series:line,axisTitle:'BB 40 상단선'},{series:helper,fillOnly:true}]}];
 applyStudyAxisLabels(rows,false);assert.equal(line.options.title,'');assert.deepEqual(line.data,[1,2,3]);
 applyStudyAxisLabels(rows,true);assert.equal(line.options.title,'BB 40 상단선');assert.equal(helper.options.title,'');assert.equal(helper.options.lastValueVisible,false);
});

test('price graph visibility is optional for old documents and syncs with existing labels across devices',async()=>{
 const store=new ChartSettingsStore(null),a=client(store),b=client(store);await a.load();const bb=createStudy('BB');await a.save([bb],{studies:false,current:true,positions:true});
 const prefs=new ChartLabelPreferences();prefs.apply(a.document.labels);prefs.configure(labels=>a.save(a.document.studies,labels));await prefs.set('price',false);
 await b.load();assert.deepEqual(b.document.labels,{studies:false,current:true,positions:true,price:false});assert.deepEqual(b.document.studies,[bb]);
 await b.save([bb,createStudy('SMA')]);await a.load();assert.equal(a.document.labels.price,false);assert.equal(a.document.labels.studies,false);
 for(const price of [null,'false',0,[],{}])assert.throws(()=>normalizeChartLabels({price}));
 prefs.configure(()=>Promise.reject(Error('offline')));await assert.rejects(()=>prefs.set('price',true),/offline/);assert.equal(prefs.value.price,false);assert.equal(prefs.busy,false);
});

test('study crosshair dots are optional for legacy documents, persist independently and restore across devices and indicator edits',async()=>{
 assert.equal(normalizeChartLabels(undefined).studyCrosshairDots,undefined);
 const store=new ChartSettingsStore(null),a=client(store),b=client(store);await a.load();const bb=createStudy('BB');await a.save([bb],{studies:false,current:true,positions:true,price:false});
 const prefs=new ChartLabelPreferences();prefs.apply(a.document.labels);prefs.configure(labels=>a.save(a.document.studies,labels));await prefs.set('studyCrosshairDots',false);
 await b.load();assert.deepEqual(b.document.labels,{studies:false,current:true,positions:true,price:false,studyCrosshairDots:false});await b.save([bb,createStudy('CYCLE')]);await a.load();assert.equal(a.document.labels.studyCrosshairDots,false);assert.equal(a.document.studies.length,2);
 for(const value of [null,'false',0,[],{}])assert.throws(()=>normalizeChartLabels({studyCrosshairDots:value}));
 prefs.configure(()=>Promise.reject(Error('offline')));await assert.rejects(()=>prefs.set('studyCrosshairDots',true),/offline/);assert.equal(prefs.value.studyCrosshairDots,false);
});

test('toggling study dots preserves line data and never reveals histogram, fill, arrow-anchor or disabled forecast dots',()=>{
 const make=()=>({data:[1,2],options:{lineVisible:true},applyOptions(patch){Object.assign(this.options,patch);}}),plots=[{crosshairDots:true},{histogram:true},{fillOnly:true},{anchorOnly:true},{projection:true},{projection:true,crosshairDots:true}].map(p=>({...p,series:make()})),rows=[{plots}],primary=make();
 applyStudyCrosshairDots(rows,false);assert.ok(plots.every(p=>p.series.options.crosshairMarkerVisible===false));assert.equal(primary.options.crosshairMarkerVisible,undefined);
 applyStudyCrosshairDots(rows,true);assert.deepEqual(plots.map(p=>p.series.options.crosshairMarkerVisible),[true,false,false,false,false,true]);
 assert.ok(plots.every(p=>p.series.options.lineVisible===true));for(const p of plots)assert.deepEqual(p.series.data,[1,2]);
});
