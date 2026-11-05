import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {CustomStudyStore} from '../backend/custom-studies.mjs';
import {CustomStudyPersistence,customStudyCopy,customChartCopy,customStudyKey,migrateCustomStudies,MAX_CUSTOM_STUDIES} from '../public/custom-studies.js';
import {createStudy,decodeStudies} from '../public/chart-studies.js';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
import {StudyPersistence} from '../public/study-persistence.js';
import {createServer} from '../server.mjs';import {emptyState} from '../backend/store.mjs';
const formula=(name='NW 상단')=>createStudy('FORMULA',{params:{name,formula:'NW(하이킨종가, 100, 8) + ATR(14) * 1.5',placement:'overlay'}});
const documentFor=studies=>({version:1,timeframeVersion:2,studies});
const requestFor=store=>async(_route,options)=>options?.method==='POST'?store.update(options.body):store.get();
const client=store=>new CustomStudyPersistence({request:requestFor(store)});
async function fixture(run){const directory=await mkdtemp(path.join(os.tmpdir(),'fw-custom-studies-'));try{await run(directory);}finally{const absolute=path.resolve(directory);assert.ok(absolute.startsWith(path.resolve(os.tmpdir())+path.sep+'fw-custom-studies-'));await rm(absolute,{recursive:true,force:true,maxRetries:3});}}

test('existing formula indicators migrate into reusable definitions once without changing original chart studies',async()=>{
 const a=formula(),b=formula('NW 하단');b.params.formula=b.params.formula.replace(' + ',' - ');const rows=[createStudy('BB'),a,{...structuredClone(a),id:'another-copy'},b],original=structuredClone(rows),saved=migrateCustomStudies(rows);assert.equal(saved.length,2);assert.notEqual(saved[0].id,a.id);assert.deepEqual(rows,original);assert.equal(customStudyKey(a),customStudyKey(saved[0]));
 let calls=0;const store=new CustomStudyStore(null,{readLegacy:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return rows;}}),results=await Promise.all([store.get(),store.get(),store.get()]);assert.equal(calls,1);assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
});

test('saving and editing definitions is independent from chart layout and all chart copies have distinct identities',async()=>{
 const store=new CustomStudyStore(null),library=client(store);await library.load();const original=customStudyCopy(formula());await library.save(original);const first=customChartCopy(library.studies[0]),second=customChartCopy(library.studies[0]);assert.notEqual(first.id,second.id);assert.notEqual(first.id,original.id);assert.equal(first.params.formula,original.params.formula);
 first.params.name='차트 개별 이름';first.styles.main.color='#123456';assert.notEqual(library.studies[0].params.name,first.params.name);assert.notEqual(second.styles.main.color,first.styles.main.color);
 const edited=structuredClone(original);edited.params.formula='SMA(하이킨종가, 6)';await library.save(edited);assert.equal(library.studies.length,1);assert.equal(second.params.formula,original.params.formula);assert.notEqual(library.studies[0].params.formula,second.params.formula);
});

test('definitions restore across server restarts and devices while chart and trading files remain byte-identical',()=>fixture(async directory=>{
 const layout=JSON.stringify(documentFor([formula()]));await writeFile(path.join(directory,'chart-settings.json'),layout);await writeFile(path.join(directory,'state.json'),'private-journal');const first=new CustomStudyStore(directory,{readLegacy:async()=>[]}),a=client(first);await a.load();await a.save(customStudyCopy(formula()));
 const b=client(new CustomStudyStore(directory));await b.load();assert.deepEqual(b.studies,a.studies);assert.equal(await readFile(path.join(directory,'chart-settings.json'),'utf8'),layout);assert.equal(await readFile(path.join(directory,'state.json'),'utf8'),'private-journal');
}));

test('deleting a saved definition keeps chart copies and an intentionally empty catalog never reimports old formulas',()=>fixture(async directory=>{
 const old=[formula()],store=new CustomStudyStore(directory,{readLegacy:async()=>old}),first=await store.get(),copy=customChartCopy(first.studies[0]);await store.update({revision:first.revision,action:'delete',id:first.studies[0].id});const restarted=await new CustomStudyStore(directory,{readLegacy:async()=>old}).get();assert.deepEqual(restarted.studies,[]);assert.equal(copy.params.formula,old[0].params.formula);assert.equal(restarted.revision,2);
}));

test('initially empty libraries can still import a legacy chart uploaded after the first read',async()=>{
 let legacy=[];const store=new CustomStudyStore(null,{readLegacy:async()=>legacy});assert.deepEqual((await store.get()).studies,[]);legacy=[formula()];assert.equal((await store.get()).studies.length,1);
});

test('concurrent devices reject stale revisions without overwriting edits or recreating deleted definitions',async()=>{
 const store=new CustomStudyStore(null),a=client(store),b=client(store);await Promise.all([a.load(),b.load()]);const f=customStudyCopy(formula());await a.save(f);await assert.rejects(()=>b.save(customStudyCopy(formula('다른 지표'))),/다른 화면/);assert.equal(b.studies.length,0);await b.load();await b.remove(f.id);await assert.rejects(()=>a.save({...f,params:{...f.params,name:'오래된 화면'}}),/다른 화면/);assert.deepEqual((await store.get()).studies,[]);
});

test('catalog capacity is independent from the twelve active chart indicators',async()=>{
 const store=new CustomStudyStore(null);let revision=0;for(let i=0;i<MAX_CUSTOM_STUDIES;i++){const result=await store.update({revision,action:'save',study:customStudyCopy(formula('지표 '+i))});revision=result.revision;}assert.equal((await store.get()).studies.length,50);await assert.rejects(()=>store.update({revision,action:'save',study:customStudyCopy(formula('초과'))}),/최대/);
 const sample=(await store.get()).studies[0];await store.update({revision,action:'save',study:{...sample,params:{...sample.params,name:'수정은 가능'}}});assert.throws(()=>decodeStudies(JSON.stringify(documentFor(Array.from({length:13},()=>customChartCopy(sample))))));
});

test('invalid definition types, formulas, styles and actions leave the previous catalog intact',async()=>{
 const store=new CustomStudyStore(null),f=customStudyCopy(formula());await store.update({revision:0,action:'save',study:f});for(const input of [{action:'save',study:createStudy('BB')},{action:'save',study:{...f,params:{...f.params,formula:'unknown()'}}},{action:'save',study:{...f,styles:{}}},{action:'delete',id:'missing'},{action:'replace',studies:[]}])await assert.rejects(()=>store.update({revision:1,...input}));assert.equal((await store.get()).revision,1);assert.deepEqual((await store.get()).studies,[f]);
});

test('corrupt library files recover from the prior good backup and never silently become an empty catalog',()=>fixture(async directory=>{
 const store=new CustomStudyStore(directory),f=customStudyCopy(formula());await store.update({revision:0,action:'save',study:f});await store.update({revision:1,action:'save',study:customStudyCopy(formula('추가'))});await writeFile(path.join(directory,'custom-studies.json'),'broken');const recovered=new CustomStudyStore(directory),value=await recovered.get();assert.equal(value.recovered,true);assert.deepEqual(value.studies,[f]);await recovered.update({revision:1,action:'save',study:customStudyCopy(formula('복구 후 추가'))});assert.equal((await new CustomStudyStore(directory).get()).studies.length,2);assert.equal((await readdir(directory)).filter(n=>n.endsWith('.tmp')).length,0);
 await writeFile(path.join(directory,'custom-studies.json'),'broken');await writeFile(path.join(directory,'custom-studies.json.bak'),'also broken');await assert.rejects(()=>new CustomStudyStore(directory).get(),/원본 파일은 보존/);assert.equal(await readFile(path.join(directory,'custom-studies.json'),'utf8'),'broken');
}));

test('client load and write failures retain saved entries and never report an optimistic successful save',async()=>{
 const store=new CustomStudyStore(null),f=customStudyCopy(formula());await store.update({revision:0,action:'save',study:f});let fail=false;const library=new CustomStudyPersistence({request:async(...args)=>{if(fail)throw Error('offline');return requestFor(store)(...args);}});await library.load();fail=true;await assert.rejects(()=>library.save(customStudyCopy(formula('실패'))),/offline/);assert.deepEqual(library.studies,[f]);assert.equal(library.busy,false);await assert.rejects(()=>library.load(),/offline/);assert.deepEqual(library.studies,[f]);assert.equal(library.ready,false);await assert.rejects(()=>library.remove(f.id),/먼저/);
});

test('old chart-only clients can still save their layout without touching the custom catalog',()=>fixture(async directory=>{
 const charts=new ChartSettingsStore(directory),catalog=new CustomStudyStore(directory),library=client(catalog);await library.load();await library.save(customStudyCopy(formula()));const before=await readFile(path.join(directory,'custom-studies.json'),'utf8'),old=new StudyPersistence({request:async(_path,options)=>options?.method==='POST'?charts.save(options.body):charts.get()});await old.load();await old.save([createStudy('BB')]);assert.equal(await readFile(path.join(directory,'custom-studies.json'),'utf8'),before);assert.equal(old.document.studies[0].type,'BB');
}));

test('custom catalog API shares session, origin and revision checks with the existing chart API',async()=>{
 const state=emptyState(),store={state,async load(){return state;},async save(){}},app=await createServer({store,marketData:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));try{const base='http://127.0.0.1:'+app.server.address().port;assert.equal((await fetch(base+'/api/custom-studies')).status,403);const {token}=await(await fetch(base+'/api/session')).json(),headers={'X-Workroom-Token':token,'Content-Type':'application/json'},payload={revision:0,action:'save',study:customStudyCopy(formula())},body=JSON.stringify(payload);assert.equal((await fetch(base+'/api/custom-studies',{method:'POST',headers:{...headers,Origin:'https://example.invalid'},body})).status,403);assert.equal((await fetch(base+'/api/custom-studies',{method:'POST',headers,body})).status,200);assert.equal((await fetch(base+'/api/custom-studies',{method:'POST',headers,body})).status,409);const saved=await(await fetch(base+'/api/custom-studies',{headers})).json();assert.equal(saved.studies[0].params.name,'NW 상단');const charts=await(await fetch(base+'/api/chart-settings',{headers})).json();assert.equal(charts.document,null);}finally{await new Promise(resolve=>app.server.close(resolve));}
});
