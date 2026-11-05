import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
import {StudyPersistence,STUDY_BACKUP_KEY} from '../public/study-persistence.js';
import {createStudy,STUDY_KEY,decodeStudies} from '../public/chart-studies.js';
import {createServer} from '../server.mjs';
import {emptyState} from '../backend/store.mjs';
const documentFor=studies=>({version:1,timeframeVersion:2,studies});
const bb=()=>createStudy('BB',{params:{period:55,multiplier:1.04,basis:'SMA'},candle:'heikin',fill:{visible:true,color:'#123456',transparency:73}});
const memory=()=>{const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
const requestFor=store=>async(_route,options)=>options?.method==='POST'?store.save(options.body):store.get();
async function fixture(run){
 const directory=await mkdtemp(path.join(os.tmpdir(),'fw-chart-settings-'));
 try{await run(directory);}finally{const safe=path.resolve(directory);assert.ok(safe.startsWith(path.resolve(os.tmpdir())+path.sep+'fw-chart-settings-'));await rm(safe,{recursive:true,force:true,maxRetries:3});}
}
test('legacy indicators migrate once and restore from another origin after a server restart',()=>fixture(async directory=>{
 const local=memory(),legacy=documentFor([bb(),createStudy('FORMULA',{params:{name:'나의 평균',placement:'overlay',formula:'종가[0:3]/3'}})]);
 local.setItem(STUDY_KEY,JSON.stringify(legacy));await writeFile(path.join(directory,'state.json'),'private-trading-journal');
 const store=new ChartSettingsStore(directory),first=new StudyPersistence({storage:local,request:requestFor(store)});await first.load();assert.equal(first.ready,true);assert.deepEqual((await store.get()).document,decodeStudies(JSON.stringify(legacy)));
 const other=memory(),restarted=new ChartSettingsStore(directory),second=new StudyPersistence({storage:other,request:requestFor(restarted)});await second.load();assert.deepEqual(second.document,first.document);assert.deepEqual(JSON.parse(other.getItem(STUDY_KEY)),first.document);assert.equal(await readFile(path.join(directory,'state.json'),'utf8'),'private-trading-journal');
}));
test('a fresh origin never uploads generated defaults or replaces existing server studies',async()=>{
 const store=new ChartSettingsStore(null),storage=memory(),client=new StudyPersistence({storage,request:requestFor(store)});await client.load();assert.equal((await store.get()).revision,0);assert.equal(storage.getItem(STUDY_KEY),null);
 const document=documentFor([bb()]);await store.save({revision:0,document});const defaults=new StudyPersistence({storage:memory(),request:requestFor(store)});await defaults.load();assert.deepEqual(defaults.document,document);assert.equal((await store.get()).revision,1);
});
test('empty indicator layouts are saved and a new browser keeps them empty',async()=>{
 const store=new ChartSettingsStore(null),first=new StudyPersistence({storage:memory(),request:requestFor(store)});await first.load();await first.save([]);
 const second=new StudyPersistence({storage:memory(),request:requestFor(store)});await second.load();assert.deepEqual(second.document.studies,[]);assert.equal(second.ready,true);
});
test('different old local settings remain recoverable instead of overwriting the server on load',async()=>{
 const store=new ChartSettingsStore(null),saved=documentFor([bb()]),local=memory(),previous=documentFor([createStudy('EMA',{params:{period:89}})]);await store.save({revision:0,document:saved});local.setItem(STUDY_KEY,JSON.stringify(previous));
 const client=new StudyPersistence({storage:local,request:requestFor(store)});await client.load();assert.deepEqual(client.document,saved);assert.deepEqual(client.backup(),previous);assert.equal(local.getItem(STUDY_BACKUP_KEY),JSON.stringify(previous));await client.save(client.backup().studies);assert.deepEqual((await store.get()).document,previous);
});
test('concurrent old tabs cannot overwrite a newer indicator save',async()=>{
 const store=new ChartSettingsStore(null);await store.save({revision:0,document:documentFor([bb()])});const a=new StudyPersistence({storage:memory(),request:requestFor(store)}),b=new StudyPersistence({storage:memory(),request:requestFor(store)});await Promise.all([a.load(),b.load()]);
 const next=bb();next.params.period=70;await a.save([next]);await assert.rejects(()=>b.save([]),/다른 화면/);assert.equal((await store.get()).document.studies[0].params.period,70);assert.equal(b.document.studies.length,1);await b.load();assert.equal(b.document.studies[0].params.period,70);
});
test('failed reads and writes preserve the original browser settings; blocked browser storage still supports server persistence',async()=>{
 const storage=memory(),original=JSON.stringify(documentFor([bb()]));storage.setItem(STUDY_KEY,original);const offline=new StudyPersistence({storage,request:async()=>{throw Error('offline');}});await assert.rejects(()=>offline.load(),/offline/);assert.equal(storage.getItem(STUDY_KEY),original);assert.equal(offline.ready,false);
 const store=new ChartSettingsStore(null),request=requestFor(store);let fail=false;const online=new StudyPersistence({storage,request:async(...args)=>{if(fail)throw Error('offline');return request(...args);}});await online.load();fail=true;await assert.rejects(()=>online.save([]),/offline/);assert.equal(online.document.studies.length,1);assert.equal((await store.get()).document.studies.length,1);
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},client=new StudyPersistence({storage:blocked,request});await client.load();assert.equal(client.document.studies[0].params.period,55);await client.save([]);assert.deepEqual((await store.get()).document.studies,[]);
});
test('invalid saved browser data never becomes a default indicator upload',async()=>{
 const store=new ChartSettingsStore(null),storage=memory();storage.setItem(STUDY_KEY,'broken');const client=new StudyPersistence({storage,request:requestFor(store)});await client.load();assert.equal((await store.get()).document,null);assert.equal(storage.getItem(STUDY_KEY),'broken');
});
test('server settings preserve one prior backup, reject malformed changes and recover a corrupt current file',()=>fixture(async directory=>{
 const store=new ChartSettingsStore(directory),first=documentFor([bb()]);await store.save({revision:0,document:first});const second=documentFor([]);await store.save({revision:1,document:second});
 await assert.rejects(()=>store.save({revision:2,document:{version:1,studies:[{...bb(),styles:{}}]}}));assert.equal((await store.get()).revision,2);assert.deepEqual((await store.get()).document,second);assert.equal((await readdir(directory)).filter(name=>name.endsWith('.tmp')).length,0);
 await writeFile(path.join(directory,'chart-settings.json'),'broken');const recovered=new ChartSettingsStore(directory);assert.equal((await recovered.get()).recovered,true);assert.deepEqual((await recovered.get()).document,first);await recovered.save({revision:1,document:second});assert.deepEqual((await new ChartSettingsStore(directory).get()).document,second);assert.deepEqual(JSON.parse(await readFile(path.join(directory,'chart-settings.json.bak'),'utf8')).document,first);
}));
test('indicator HTTP persistence requires a session and rejects cross-origin and stale writes',async()=>{
 const state=emptyState(),store={state,async load(){return state;},async save(){}},app=await createServer({store,marketData:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+app.server.address().port;assert.equal((await fetch(base+'/api/chart-settings')).status,403);const {token}=await(await fetch(base+'/api/session')).json(),headers={'X-Workroom-Token':token,'Content-Type':'application/json'},body=JSON.stringify({revision:0,document:documentFor([bb()])});
  assert.equal((await fetch(base+'/api/chart-settings',{method:'POST',headers:{...headers,Origin:'https://example.invalid'},body})).status,403);
  assert.equal((await fetch(base+'/api/chart-settings',{method:'POST',headers,body})).status,200);const saved=await(await fetch(base+'/api/chart-settings',{headers})).json();assert.equal(saved.document.studies[0].params.period,55);assert.equal((await fetch(base+'/api/chart-settings',{method:'POST',headers,body})).status,409);
 }finally{await new Promise(resolve=>app.server.close(resolve));}
});

test('extended indicator settings survive a server reload and restore in a second browser without replacing existing bands',()=>fixture(async directory=>{
 const original=bb(),studies=[original,...['DMI','ADX','CCI','MFI','BBW','BBP'].map(type=>createStudy(type,{candle:'heikin'}))],first=new ChartSettingsStore(directory);const saved=await first.save({revision:0,document:documentFor(studies)});const storage=memory(),second=new StudyPersistence({storage,request:requestFor(new ChartSettingsStore(directory))});await second.load();assert.deepEqual(second.document,saved.document);assert.deepEqual(second.document.studies[0],original);assert.equal(second.document.studies.find(s=>s.type==='DMI').styles.minus.color,'#d36579');assert.equal(second.document.studies.length,7);
}));
