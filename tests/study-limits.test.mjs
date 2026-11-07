import test from 'node:test';import assert from 'node:assert/strict';
import {MAX_STUDIES,MAX_SCRIPT_PLOTS,MAX_SCRIPT_BACKGROUNDS} from '../public/study-limits.js';
import {createStudy,validateStudy,decodeStudies,withStudySource,studyData,studyPlots} from '../public/chart-studies.js';
import {compileStudyScript} from '../public/study-script.js';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
import {ChartWorkspace} from '../public/chart-workspace.js';
const outputs=n=>Array.from({length:n},(_,i)=>'선("선'+i+'", SMA(종가, '+(i+1)+'))').join('\n');
const raw=Array.from({length:100},(_,i)=>({time:1700000000+i*60,open:i+1,high:i+1,low:i+1,close:i+1,volume:i+1}));
test('thirty chart studies round-trip through server persistence and the next item is rejected',async()=>{
 const studies=Array.from({length:MAX_STUDIES},(_,i)=>createStudy(i%2?'EMA':'SMA',{id:'limit-'+i})),document={version:1,timeframeVersion:2,studies};
 const store=new ChartSettingsStore(null);await store.save({revision:0,document});assert.deepEqual((await store.get()).document,document);
 await assert.rejects(()=>store.save({revision:1,document:{...document,studies:[...studies,createStudy('SMA')]}}));assert.equal((await store.get()).document.studies.length,30);
});
test('twenty mixed script outputs calculate and keep their own styles; twenty-first is rejected',()=>{
 const source=Array.from({length:MAX_SCRIPT_PLOTS},(_,i)=>(i%2?'막대':'선')+'("선'+i+'", SMA(종가, '+(i+1)+'))').join('\n');
 const s=validateStudy(withStudySource(createStudy('FORMULA'),source)),data=studyData(s,raw);assert.equal(data.error,null);assert.equal(data.plots.length,20);assert.equal(studyPlots(s)[19].histogram,true);assert.equal(data.plots[19].data.at(-1).value,90.5);assert.ok(studyPlots(s).every(p=>/^#[a-f0-9]{6}$/i.test(s.styles[p.key].color)));
 assert.throws(()=>compileStudyScript(source+'\n선("초과", 종가)'),/최대 20/);
});
test('legacy six-slot script styles retain their exact saved values without padding unused new slots',()=>{
 const old=createStudy('SCRIPT');for(const key of Object.keys(old.styles))if(Number(key.slice(4))>=6)delete old.styles[key];old.styles.line0.color='#123456';
 assert.equal(Object.keys(old.styles).length,6);assert.deepEqual(validateStudy(old),old);assert.deepEqual(decodeStudies(JSON.stringify({version:1,timeframeVersion:2,studies:[old]})).studies,[old]);
 const expanded=validateStudy(withStudySource(old,outputs(20)));assert.equal(Object.keys(expanded.styles).length,20);assert.equal(expanded.styles.line0.color,'#123456');assert.ok(expanded.styles.line19);
 delete expanded.styles.line19;assert.throws(()=>validateStudy(expanded),/스타일/);
});
test('expanded script slots support panel signal anchors beyond the old six slots and reject out-of-range anchors',()=>{
 const s=withStudySource(createStudy('FORMULA',{params:{name:'앵커',placement:'pane',formula:'종가'}}),outputs(19)+'\n화살표("교차", 1)');s.styles.line19.target='study';s.styles.line19.anchor='line18';
 assert.equal(validateStudy(s).styles.line19.anchor,'line18');s.styles.line19.anchor='line20';assert.throws(()=>validateStudy(s),/기준선/);
});
test('all thirty study-pane heights survive workspace save and reload',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},workspace=new ChartWorkspace(storage),panes={price:.25};
 for(let i=0;i<MAX_STUDIES;i++)panes['pane-'+i]=.025;workspace.remember('usdm','SOXLUSDT','1m',{range:{from:20,to:120},count:120,panes});
 assert.deepEqual(new ChartWorkspace(storage).view('usdm','SOXLUSDT','1m').panes,panes);
});
test('twenty outputs and six backgrounds coexist while keeping the independent background limit',()=>{
 const source=outputs(MAX_SCRIPT_PLOTS)+'\n'+Array.from({length:MAX_SCRIPT_BACKGROUNDS},(_,i)=>'배경("배경'+i+'", 종가 > 0)').join('\n'),program=compileStudyScript(source);
 assert.equal(program.plots.length,20);assert.equal(program.backgrounds.length,6);assert.throws(()=>compileStudyScript(source+'\n배경("초과", 1)'),/최대 6/);
});
