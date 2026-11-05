import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {FavoritesStore} from '../backend/favorites-store.mjs';
import {FavoritesPersistence,FAVORITES_BACKUP_KEY,FAVORITES_COLLECTION_KEY} from '../public/favorites-persistence.js';
import {FAVORITES_KEY,defaultFavorites,validateFavorites,decodeFavorites,setFavorite} from '../public/favorites.js';
import {createServer} from '../server.mjs';import {emptyState} from '../backend/store.mjs';
const memory=initial=>{const data=new Map(Object.entries(initial||{}));return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),data};};
const requestFor=store=>async(_path,options)=>options?.method==='POST'?store.update(options.body):store.get();
const client=(store,storage=memory(),extra={})=>new FavoritesPersistence({storage,request:requestFor(store),...extra});
async function fixture(run){const directory=await mkdtemp(path.join(os.tmpdir(),'fw-favorites-'));try{await run(directory);}finally{const target=path.resolve(directory);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep+'fw-favorites-'));await rm(target,{recursive:true,force:true,maxRetries:3});}}

test('favorites validate independent markets, explicit empties and bounded desired membership',()=>{
 assert.deepEqual(decodeFavorites('[]'),[]);assert.throws(()=>decodeFavorites('null'));assert.throws(()=>decodeFavorites('broken'));assert.deepEqual(validateFavorites(['usdm:BTCUSDT','spot:BTCUSDT','usdm:BTCUSDT']),['usdm:BTCUSDT','spot:BTCUSDT']);
 assert.deepEqual(setFavorite([], 'usdm:KORUUSDT',true),['usdm:KORUUSDT']);assert.deepEqual(setFavorite(['usdm:KORUUSDT'],'usdm:KORUUSDT',true),['usdm:KORUUSDT']);assert.deepEqual(setFavorite([],'usdm:KORUUSDT',false),[]);for(const key of ['https://example.com','usdm:<script>','spot:btc','usdm:BTC/USDT'])assert.throws(()=>setFavorite([],key,true));assert.throws(()=>setFavorite([],'usdm:BTCUSDT',1));assert.throws(()=>validateFavorites(Array.from({length:501},(_,i)=>'spot:T'+i)));
});
test('new browsers do not upload generated defaults and respect an explicitly empty server list',async()=>{
 const store=new FavoritesStore(null),local=memory(),a=client(store,local);await a.load();assert.deepEqual(a.keys,defaultFavorites());assert.equal((await store.get()).keys,null);assert.equal(local.getItem(FAVORITES_KEY),null);
 await store.update({action:'import',keys:[]});const b=client(store);await b.load();assert.deepEqual(b.keys,[]);assert.deepEqual((await store.get()).keys,[]);await b.set('spot:BTCUSDT',true);await b.set('spot:BTCUSDT',false);await a.load();assert.deepEqual(a.keys,[]);
});
test('first legacy import seeds the exact list and distinct devices merge once without restoring removed stars',async()=>{
 const store=new FavoritesStore(null),one=memory({[FAVORITES_KEY]:JSON.stringify(['usdm:KORUUSDT'])}),two=memory({[FAVORITES_KEY]:JSON.stringify(['spot:KORUBUSDT','usdm:SOXLUSDT'])}),a=client(store,one),b=client(store,two);
 await a.load();assert.deepEqual((await store.get()).keys,['usdm:KORUUSDT']);await b.load();await a.load();assert.deepEqual(a.keys,['usdm:KORUUSDT','spot:KORUBUSDT','usdm:SOXLUSDT']);assert.equal(a.keys.length,b.keys.length);assert.equal(one.getItem(FAVORITES_BACKUP_KEY),JSON.stringify(['usdm:KORUUSDT']));
 await a.set('usdm:KORUUSDT',false);await b.load();assert.equal(b.keys.includes('usdm:KORUUSDT'),false);await client(store,one).load();const stale=memory({[FAVORITES_KEY]:JSON.stringify(['usdm:KORUUSDT'])});await client(store,stale).load();assert.equal((await store.get()).keys.includes('usdm:KORUUSDT'),false);const third=client(store,memory({[FAVORITES_KEY]:JSON.stringify(['usdm:KORUUSDT','spot:NEW'])}));await third.load();assert.equal(third.keys.includes('usdm:KORUUSDT'),false);assert.ok(third.keys.includes('spot:NEW'));await a.set('usdm:KORUUSDT',true);await b.load();assert.ok(b.keys.includes('usdm:KORUUSDT'));
});
test('migration deduplication survives a server restart and preserves deletions even if a browser loses its marker',()=>fixture(async directory=>{
 const store=new FavoritesStore(directory);await store.update({action:'import',keys:['spot:AAA','spot:BBB']});await store.update({action:'set',key:'spot:AAA',enabled:false});const restarted=new FavoritesStore(directory),old=memory({[FAVORITES_KEY]:JSON.stringify(['spot:BBB','spot:AAA'])});await client(restarted,old).load();assert.deepEqual((await restarted.get()).keys,['spot:BBB']);
}));
test('concurrent desired membership updates merge different symbols and repeated requests never toggle twice',async()=>{
 const store=new FavoritesStore(null);await store.update({action:'import',keys:[]});const a=client(store),b=client(store);await Promise.all([a.load(),b.load()]);await Promise.all([a.set('usdm:BTCUSDT',true),b.set('spot:BTCUSDT',true)]);assert.deepEqual((await store.get()).keys,['usdm:BTCUSDT','spot:BTCUSDT']);const revision=(await store.get()).revision;await Promise.all([store.update({action:'set',key:'usdm:BTCUSDT',enabled:true}),store.update({action:'set',key:'usdm:BTCUSDT',enabled:true})]);assert.equal((await store.get()).revision,revision);await b.set('usdm:BTCUSDT',false);await a.load();assert.deepEqual(a.keys,['spot:BTCUSDT']);
});
test('an old tab cannot replace a newer full list while changing one star',async()=>{
 const store=new FavoritesStore(null);await store.update({action:'import',keys:['spot:AAA','spot:BBB']});const old=client(store),fresh=client(store);await Promise.all([old.load(),fresh.load()]);await fresh.set('spot:AAA',false);await fresh.set('spot:CCC',true);await old.set('spot:DDD',true);assert.deepEqual((await store.get()).keys,['spot:BBB','spot:CCC','spot:DDD']);
});
test('failed requests preserve browser data and never claim successful saves',async()=>{
 const local=memory({[FAVORITES_KEY]:JSON.stringify(['usdm:KORUUSDT'])}),status=[],offline=new FavoritesPersistence({storage:local,request:async()=>{throw Error('offline');},onStatus:m=>status.push(m)});await assert.rejects(()=>offline.load(),/offline/);assert.equal(offline.ready,false);assert.equal(local.getItem(FAVORITES_KEY),JSON.stringify(['usdm:KORUUSDT']));assert.match(status.at(-1),/실패/);
 const store=new FavoritesStore(null),request=requestFor(store);let fail=false;const online=client(store,local,{request:async(...args)=>{if(fail)throw Error('offline');return request(...args);}});await online.load();const saved=local.getItem(FAVORITES_KEY);fail=true;await assert.rejects(()=>online.set('spot:BTCUSDT',true),/offline/);assert.equal(local.getItem(FAVORITES_KEY),saved);assert.deepEqual(online.keys,['usdm:KORUUSDT']);assert.equal(online.saving,false);
});
test('a lost import response cannot resurrect a later removal during retry',async()=>{
 const store=new FavoritesStore(null),request=requestFor(store),local=memory({[FAVORITES_KEY]:JSON.stringify(['spot:AAA'])});let lose=true;const a=client(store,local,{request:async(...args)=>{const result=await request(...args);if(lose&&args[1]?.body.action==='import'){lose=false;throw Error('lost reply');}return result;}});await assert.rejects(()=>a.load(),/lost reply/);await store.update({action:'set',key:'spot:AAA',enabled:false});await a.load();assert.deepEqual(a.keys,[]);assert.equal(local.getItem(FAVORITES_KEY),'[]');
});
test('blocked browser storage still reads and writes shared favorites and invalid local data is never migrated',async()=>{
 const store=new FavoritesStore(null),bad=memory({[FAVORITES_KEY]:'broken'}),invalid=client(store,bad);await invalid.load();assert.equal((await store.get()).keys,null);assert.equal(bad.getItem(FAVORITES_KEY),'broken');
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},a=client(store,blocked);await a.load();await a.set('usdm:KORUUSDT',true);assert.ok((await store.get()).keys.includes('usdm:KORUUSDT'));const b=client(store);await b.load();assert.ok(b.keys.includes('usdm:KORUUSDT'));
});
test('set operations queue behind reads so a delayed snapshot cannot undo a completed star update',async()=>{
 const store=new FavoritesStore(null),request=requestFor(store);await store.update({action:'import',keys:[]});const a=client(store);await a.load();let release,seen;const ready=new Promise(resolve=>seen=resolve);a.request=async(p,options)=>{if(options)return request(p,options);const old=await request(p);seen();await new Promise(resolve=>release=resolve);return old;};const load=a.load();await ready;const set=a.set('spot:AAA',true);release();await Promise.all([load,set]);assert.deepEqual(a.keys,['spot:AAA']);
});
test('malformed and over-limit writes are atomic, read results are independent copies and private journals remain untouched',()=>fixture(async directory=>{
 await writeFile(path.join(directory,'state.json'),'private-trading-journal');const store=new FavoritesStore(directory),keys=Array.from({length:500},(_,i)=>'spot:T'+i);await store.update({action:'import',keys});const before=await readFile(path.join(directory,'favorites.json'),'utf8');await assert.rejects(()=>store.update({action:'set',key:'spot:EXTRA',enabled:true}),/500/);await assert.rejects(()=>store.update({action:'import',keys:['spot:EXTRA']}));await assert.rejects(()=>store.update({action:'replace',keys:[]}));assert.equal(await readFile(path.join(directory,'favorites.json'),'utf8'),before);const view=await store.get();view.keys.length=0;assert.equal((await store.get()).keys.length,500);assert.equal(await readFile(path.join(directory,'state.json'),'utf8'),'private-trading-journal');assert.equal((await readdir(directory)).some(name=>name.endsWith('.tmp')),false);
}));
test('atomic favorites snapshots recover the prior valid backup without overwriting it with corrupt content',()=>fixture(async directory=>{
 const store=new FavoritesStore(directory);await store.update({action:'import',keys:['spot:AAA']});await store.update({action:'set',key:'spot:BBB',enabled:true});const originalBackup=await readFile(path.join(directory,'favorites.json.bak'),'utf8');await writeFile(path.join(directory,'favorites.json'),'broken');const recovered=new FavoritesStore(directory);assert.equal((await recovered.get()).recovered,true);assert.deepEqual((await recovered.get()).keys,['spot:AAA']);await recovered.update({action:'set',key:'spot:CCC',enabled:true});assert.equal(await readFile(path.join(directory,'favorites.json.bak'),'utf8'),originalBackup);assert.deepEqual((await new FavoritesStore(directory).get()).keys,['spot:AAA','spot:CCC']);
}));
test('favorites endpoints require a session, reject foreign origins and support independent client updates',async()=>{
 const state=emptyState(),store={state,async load(){return state;},async save(){}},app=await createServer({store,marketData:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 try{const base='http://127.0.0.1:'+app.server.address().port;assert.equal((await fetch(base+'/api/favorites')).status,403);const {token}=await(await fetch(base+'/api/session')).json(),headers={'X-Workroom-Token':token,'Content-Type':'application/json'},post=(body,extra={})=>fetch(base+'/api/favorites',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
 assert.equal((await post({action:'import',keys:[]},{Origin:'https://example.invalid'})).status,403);assert.equal((await post({action:'import',keys:[]})).status,200);await Promise.all([post({action:'set',key:'usdm:KORUUSDT',enabled:true}),post({action:'set',key:'spot:KORUBUSDT',enabled:true})]);const current=await(await fetch(base+'/api/favorites',{headers})).json();assert.deepEqual(new Set(current.keys),new Set(['usdm:KORUUSDT','spot:KORUBUSDT']));assert.equal((await post({action:'set',key:'usdm:BTCUSDT',enabled:'true'})).status,400);assert.equal((await post({action:'replace',keys:[]})).status,400);
 }finally{await new Promise(resolve=>app.server.close(resolve));}
});

test('simultaneous first connections share one collection identity and retain the first persisted changes',()=>fixture(async directory=>{
 const store=new FavoritesStore(directory),reads=await Promise.all(Array.from({length:12},()=>store.get()));assert.equal(new Set(reads.map(r=>r.collectionId)).size,1);await Promise.all([store.update({action:'import',keys:['spot:AAA']}),store.update({action:'set',key:'spot:BBB',enabled:true}),store.get()]);const saved=await new FavoritesStore(directory).get();assert.equal(saved.collectionId,reads[0].collectionId);assert.deepEqual(saved.keys,['spot:AAA','spot:BBB']);
}));
