import test from 'node:test';import assert from 'node:assert/strict';
import {MA_SET_PERIODS,createStudy,validateStudy,studyData,studyPlots,studyActive,studyLabel,defaultStudies,decodeStudies} from '../public/chart-studies.js';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
const raw=Array.from({length:400},(_,i)=>({time:1700000000+i*60,open:100+Math.sin(i/5),high:102+Math.sin(i/5),low:99+Math.sin(i/5),close:101+Math.sin(i/5),volume:1+i%9}));
test('a single bundle defaults to five independently visible 5/20/60/120/220 lines',()=>{
 const s=createStudy('MA_SET');assert.deepEqual(MA_SET_PERIODS.map((_,i)=>s.params['period'+i]),[5,20,60,120,220]);assert.equal(s.params.average,'SMA');assert.deepEqual(studyPlots(s).map(p=>p.label),['5선','20선','60선','120선','220선']);assert.ok(Object.values(s.styles).every(style=>style.visible));assert.equal(new Set(Object.values(s.styles).map(style=>style.color)).size,5);assert.equal(decodeStudies(JSON.stringify({version:1,timeframeVersion:2,studies:[s]})).studies.length,1);
});
test('all five SMA, EMA and VWMA outputs match standalone indicators for raw and Heikin sources',()=>{
 for(const kind of ['SMA','EMA','VWMA'])for(const candle of ['standard','heikin'])for(const source of ['close','hl2']){
 const s=createStudy('MA_SET',{candle,source});s.params.average=kind;const before=structuredClone(raw),data=studyData(s,raw,'heikin');assert.equal(data.error,null);
 for(let i=0;i<5;i++){const standalone=createStudy(kind,{candle,source,params:{period:s.params['period'+i]}});assert.deepEqual(data.plots[i].data,studyData(standalone,raw,'heikin').plots[0].data,kind+' '+candle+' '+source+' '+i);}
 assert.deepEqual(raw,before);
 }
});
test('individual checkboxes, periods and colors survive server storage alongside existing single averages',async()=>{
 const s=createStudy('MA_SET');s.params.period0=6;s.styles.ma1.visible=false;s.styles.ma3.color='#123456';s.styles.ma4.width=3;const legacy=createStudy('SMA',{params:{period:14}}),copy=structuredClone(legacy),store=new ChartSettingsStore(null),document={version:1,timeframeVersion:2,studies:[legacy,validateStudy(s)]};
 await store.save({revision:0,document});assert.deepEqual((await store.get()).document,document);assert.deepEqual(legacy,copy);assert.equal(studyPlots(s)[0].label,'6선');assert.equal(studyActive(s,'1m'),true);assert.equal(studyLabel(s),'SMA 6 · 60 · 120 · 220');
});
test('all checkboxes may be off without losing periods or colors; timeframe and study visibility still apply',()=>{
 const s=createStudy('MA_SET');for(const style of Object.values(s.styles))style.visible=false;assert.doesNotThrow(()=>validateStudy(s));assert.equal(studyActive(s,'1m'),false);assert.match(studyLabel(s),/모두 숨김/);
 s.styles.ma4.visible=true;assert.equal(studyActive(s,'1m'),true);s.timeframes=['1h'];assert.equal(studyActive(s,'1m'),false);s.visible=false;assert.equal(studyActive(s,'1h'),false);
});
test('invalid periods and kinds are rejected and zero-volume VWMA never invents values',()=>{
 const s=createStudy('MA_SET');for(const period of [0,-1,1.5,301,NaN])assert.throws(()=>validateStudy({...s,params:{...s.params,period4:period}}));assert.throws(()=>validateStudy({...s,params:{...s.params,average:'unknown'}}));
 s.params.average='VWMA';const data=studyData(s,raw.map(c=>({...c,volume:0})));assert.equal(data.error,null);assert.ok(data.plots.every(p=>p.data.length===0));
});
test('adding and editing a bundle never changes existing default or standalone average settings',()=>{
 const before=defaultStudies(),copy=structuredClone(before),bundle=createStudy('MA_SET');bundle.styles.ma0.visible=false;bundle.params.period4=250;validateStudy(bundle);assert.deepEqual(before,copy);assert.deepEqual(defaultStudies(),copy);assert.equal(studyData(before[0],raw).plots.length,1);
});
