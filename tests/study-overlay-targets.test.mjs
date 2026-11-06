import test from 'node:test';import assert from 'node:assert/strict';
import {createStudy,withStudySource,validateStudy,studyData,studyPlots} from '../public/chart-studies.js';
import {overlayTarget,overlayRows,indicatorAnchor,hasPaneOverlays,StudyPaneOverlays} from '../public/study-overlay-targets.js';
import {studySignalMarkers,StudySignals} from '../public/study-signals.js';
import {backgroundLayers,StudyBackgrounds} from '../public/study-backgrounds.js';
import {CustomStudyStore} from '../backend/custom-studies.mjs';import {ChartSettingsStore} from '../backend/chart-settings.mjs';
const source='선("기울기20", 변화율(SMA(종가, 20), 1))\n선("기울기6", 변화율(SMA(종가, 6), 1))\n화살표("전환", 종가 > 0)\n화살표("확인", 종가 > 0)\n배경("구간", 종가 > 0)';
const custom=s=>validateStudy(withStudySource(createStudy('FORMULA'),s));
const raw=Array.from({length:50},(_,i)=>({time:1700000000+i*60,open:100+i,high:101+i,low:99+i,close:100+i,volume:10}));

test('legacy overlays keep price targets and per-output panel choices survive library and chart settings',async()=>{
 const old=custom(source),copy=structuredClone(old);assert.equal(overlayTarget(old.styles.line2),'price');assert.deepEqual(validateStudy(old),copy);assert.ok(!('target' in old.styles.bg0));
 const s=structuredClone(old);s.params.placement='pane';s.styles.line2={...s.styles.line2,target:'study',anchor:'line1',order:2};s.styles.line3.target='price';s.styles.bg0.target='study';const checked=validateStudy(s),library=new CustomStudyStore(null),layout=new ChartSettingsStore(null);await library.update({revision:0,action:'save',study:checked});assert.deepEqual((await library.get()).studies[0],checked);const doc={version:1,timeframeVersion:2,studies:[checked]};assert.deepEqual((await layout.save({revision:0,document:doc})).document,doc);assert.deepEqual(old,copy);
});
test('mixed price and pane overlays route once to their own owners without changing conditions or market data',()=>{
 const s=custom(source);s.params.placement='pane';s.styles.line2.target='study';s.styles.bg0.target='study';const data=studyData(s,raw),entry={study:s,data,active:true},before=structuredClone(entry),price=overlayRows([entry],'price'),pane=overlayRows([entry],'study');assert.deepEqual(price[0].data.plots.map(p=>p.key),['line3']);assert.deepEqual(pane[0].data.plots.map(p=>p.key),['line2','bg0']);assert.equal(studySignalMarkers(price).length,raw.length);assert.equal(studySignalMarkers(pane).length,raw.length);assert.equal(backgroundLayers(price).length,0);assert.equal(backgroundLayers(pane).length,1);assert.deepEqual(entry,before);
 assert.deepEqual(studySignalMarkers(overlayRows([{...entry,active:false}],'study')),[]);assert.deepEqual(backgroundLayers(overlayRows([{...entry,data:{...data,error:'failed'}}],'study')),[]);
});
test('indicator anchors prefer the selected line even if hidden, otherwise the first visible line, and zero when no line exists',()=>{
 const s=custom(source),plots=studyPlots(s);s.styles.line0.visible=false;assert.equal(indicatorAnchor(s,plots).key,'line1');assert.equal(indicatorAnchor(s,plots,{anchor:'line0'}).key,'line0');assert.equal(indicatorAnchor(s,plots,{anchor:'line2'}).key,'line1');const no=custom('화살표("信号", 1)\n배경("x", 1)');assert.equal(indicatorAnchor(no,studyPlots(no)),null);no.params.placement='pane';no.styles.line0.target='study';assert.equal(hasPaneOverlays(no,studyPlots(no)),true);no.styles.line0.visible=false;assert.equal(hasPaneOverlays(no,studyPlots(no)),false);
});
test('pane overlay groups preserve stacking on shared anchors and detach all primitives before series removal',()=>{
 const s=custom(source);s.params.placement='pane';s.styles.line2={...s.styles.line2,target:'study',anchor:'line1'};s.styles.line3={...s.styles.line3,target:'study',anchor:'line1'};s.styles.bg0.target='study';const records=[],owners=new Map(),resolve=p=>{const key=p?.key||'zero';if(!owners.has(key))owners.set(key,{});return owners.get(key);};
 const createSignals=owner=>{const record={kind:'signal',owner};records.push(record);return {update:r=>record.value=studySignalMarkers(r),clear:()=>record.value=[],dispose:()=>record.disposed=true};};const createBackgrounds=owner=>{const record={kind:'background',owner};records.push(record);return {update:r=>record.value=backgroundLayers(r),clear:()=>record.value=[],dispose:()=>record.disposed=true};};
 const overlays=new StudyPaneOverlays(s,studyPlots(s),resolve,{createSignals,createBackgrounds});assert.equal(overlays.groups.length,1);assert.equal(records[0].owner,owners.get('line1'));assert.equal(records[1].owner,owners.get('line0'));overlays.update(studyData(s,raw));assert.equal(records[0].value.length,raw.length*2);assert.equal(records[1].value.length,1);overlays.clear();assert.deepEqual(records[0].value,[]);assert.deepEqual(records[1].value,[]);overlays.dispose();assert.ok(records.every(r=>r.disposed));
});
test('overlay-only panels receive a zero anchor and individual hidden or transparent outputs do not create owners',()=>{
 const s=custom('화살표("신호", 1)\n배경("강조", 1)');s.params.placement='pane';s.styles.line0.target='study';s.styles.bg0.target='study';const anchors=[],empty=()=>({update(){},clear(){},dispose(){}}),o=new StudyPaneOverlays(s,studyPlots(s),p=>{anchors.push(p);return {};},{createSignals:empty,createBackgrounds:empty});assert.ok(anchors.every(a=>a===null));assert.equal(anchors.length,2);o.dispose();s.styles.line0.visible=false;s.styles.bg0.transparency=100;assert.equal(hasPaneOverlays(s,studyPlots(s)),false);
});
test('invalid destinations are rejected and deleted source anchors safely fall back to automatic selection',()=>{
 const s=custom(source);for(const key of ['line2','bg0'])assert.throws(()=>validateStudy({...s,styles:{...s.styles,[key]:{...s.styles[key],target:'other'}}}));s.styles.line2.target='study';assert.throws(()=>validateStudy(s),/별도 패널/);s.params.placement='pane';s.styles.line2.anchor='line5';assert.equal(validateStudy(s).styles.line2.anchor,'');s.styles.line2.anchor='../bad';assert.throws(()=>validateStudy(s),/기준선/);
});
test('overlay disposal releases its current series owner without touching other panels',()=>{
 let signalDetached=0,backgroundDetached=0;const a={attachPrimitive(){},detachPrimitive(){backgroundDetached++;}},b={attachPrimitive(){},detachPrimitive(){backgroundDetached++;}},signal=new StudySignals(a,{createMarkers:()=>({setMarkers(){},detach(){signalDetached++;}})}),background=new StudyBackgrounds(a);signal.setSeries(b);background.setSeries(b);signal.dispose();background.dispose();assert.equal(signalDetached,2);assert.equal(backgroundDetached,2);assert.equal(background.series,null);assert.equal(signal.plugin,null);
});
