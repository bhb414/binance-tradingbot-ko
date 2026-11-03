import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CredentialStore} from '../backend/credentials.mjs';
import {TradingEngine} from '../backend/engine.mjs';
import {emptyState} from '../backend/store.mjs';
import {createServer} from '../server.mjs';
import {makeBot} from '../public/core.js';

// Fabricated keys and a read-only fake exchange; these tests never contact Binance.
const credentials={environment:'live',apiKey:'fabricated-workroom-key-1234',secret:'fabricated-workroom-secret-5678'};
const memoryStore=(state=emptyState())=>({state:structuredClone(state),async load(){return this.state;},async save(){}});
function clientHarness(){
  const calls=[],clients=[];let fail=false;
  const factory=options=>{
    const client={...options,offset:0,clearCredentials(){this.apiKey='';this.secret='';},redact(message){return String(message).replaceAll(credentials.apiKey,'[private]').replaceAll(credentials.secret,'[private]');}};
    for(const [method,result] of Object.entries({syncTime:1,account:{canTrade:true,assets:[{asset:'USDT',walletBalance:'1000',availableBalance:'1000'}]},positions:[],positionMode:{dualSidePosition:false},openOrders:[]}))client[method]=async()=>{calls.push(method);if(fail)throw new Error(credentials.secret+' rejected');return structuredClone(result);};
    clients.push(client);return client;
  };
  return {factory,calls,clients,setFail(value){fail=value;}};
}
const memoryCredentials=()=>({saved:false,value:null,async load(){return this.value&&{...this.value};},async save(value){this.value={...value};this.saved=true;},async clear(){this.value=null;this.saved=false;}});
async function temporary(run){const directory=await mkdtemp(path.join(os.tmpdir(),'fw-credentials-test-'));try{await run(directory);}finally{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'fw-credentials-test-'));await rm(directory,{recursive:true,force:true});}}

test('Windows DPAPI saves only ciphertext, survives a new store instance, preserves old keys on failure, and deletes them',{skip:process.platform!=='win32'},()=>temporary(async directory=>{
  const store=new CredentialStore(directory);assert.equal(await store.load(),null);
  await store.save({...credentials,allowTrading:true});const ciphertext=await readFile(store.filename);
  assert.equal(ciphertext.includes(Buffer.from(credentials.apiKey)),false);assert.equal(ciphertext.includes(Buffer.from(credentials.secret)),false);
  assert.deepEqual(await new CredentialStore(directory).load(),credentials);
  const broken=new CredentialStore(directory,{protect:async()=>{throw new Error('failed');}});await assert.rejects(()=>broken.save({...credentials,apiKey:'another-fabricated-key-0000'}),/암호화 저장/);
  assert.deepEqual(await new CredentialStore(directory).load(),credentials);assert.deepEqual(await readdir(directory),['credentials.dpapi']);
  const corrupt=Buffer.from(ciphertext);corrupt[corrupt.length-10]^=255;await writeFile(store.filename,corrupt);
  await assert.rejects(()=>store.load(),/복호화/);assert.equal(store.saved,true);
  await store.clear();assert.equal(store.saved,false);assert.equal(await store.load(),null);assert.deepEqual(await readdir(directory),[]);
}));

test('same-account permission survives restart while bot starts stay paused and keys stay private',async()=>{
  const vault=memoryCredentials(),fake=clientHarness(),store=memoryStore(),engine=await new TradingEngine(store,{clientFactory:fake.factory,credentialStore:vault}).init();
  await engine.connect({...credentials,allowTrading:true,liveAcknowledgement:'실전 주문 허용'});assert.equal(engine.tradingEnabled,true);assert.equal(vault.saved,true);
  // Permission comes from the scoped journal preference, not extra fields in the key vault.
  vault.value.allowTrading=true;vault.value.liveAcknowledgement='실전 주문 허용';
  store.state.bots.push(makeBot({runtime:{runEnabled:true,quantity:0}}));
  const recovered=await new TradingEngine(memoryStore(store.state),{clientFactory:fake.factory,credentialStore:vault}).init();
  assert.equal(recovered.connected,true);assert.equal(recovered.tradingEnabled,true);assert.equal(recovered.state.bots[0].runtime.runEnabled,false);
  await recovered.tick();assert.ok(fake.calls.every(call=>['syncTime','account','positions','positionMode','openOrders'].includes(call)));
  const serialized=JSON.stringify({status:recovered.snapshot(),journal:recovered.state});assert.ok(!serialized.includes(credentials.apiKey));assert.ok(!serialized.includes(credentials.secret));
  await recovered.disconnect();assert.equal(vault.saved,false);assert.equal(recovered.connected,false);assert.equal(await vault.load(),null);
});

test('invalid keys and failed encrypted writes never replace an existing working connection or saved key',async()=>{
  const vault=memoryCredentials(),fake=clientHarness(),engine=await new TradingEngine(memoryStore(),{clientFactory:fake.factory,credentialStore:vault}).init();
  await engine.connect(credentials);const previous=engine.client;
  fake.setFail(true);await assert.rejects(()=>engine.connect({...credentials,apiKey:'different-fabricated-key-0000'}),error=>!error.message.includes(credentials.secret));
  assert.equal(engine.client,previous);assert.deepEqual(vault.value,credentials);assert.equal(engine.connected,true);
  fake.setFail(false);vault.save=async()=>{throw new Error('API 키를 암호화 저장하지 못했습니다.');};
  await assert.rejects(()=>engine.connect({...credentials,secret:'different-fabricated-secret-0000',allowTrading:true,liveAcknowledgement:'실전 주문 허용'}),/암호화 저장/);
  assert.equal(engine.client,previous);assert.equal(engine.tradingEnabled,false);assert.equal(fake.clients.at(-1).secret,'');assert.deepEqual(vault.value,credentials);
});

test('failed startup connections can retry safely and corrupt credentials keep the app available for replacement or deletion',async()=>{
  const vault=memoryCredentials(),fake=clientHarness();await vault.save(credentials);fake.setFail(true);let now=1000;
  const engine=await new TradingEngine(memoryStore(),{clientFactory:fake.factory,credentialStore:vault,now:()=>now}).init();
  assert.equal(engine.connected,false);assert.equal(engine.reconnectAt,31000);assert.equal(vault.saved,true);assert.ok(!JSON.stringify(engine.snapshot()).includes(credentials.secret));
  fake.setFail(false);now=31000;await engine.restoreConnection();assert.equal(engine.connected,true);assert.equal(engine.tradingEnabled,false);assert.equal(engine.reconnectAt,0);
  vault.load=async()=>{throw new Error('저장된 키를 복호화하지 못했습니다.');};
  const corrupt=await new TradingEngine(memoryStore(),{clientFactory:fake.factory,credentialStore:vault}).init();
  assert.equal(corrupt.connected,false);assert.equal(corrupt.snapshot().credentials.saved,true);assert.match(corrupt.snapshot().credentials.error,/복호화/);
  await corrupt.disconnect();assert.equal(vault.saved,false);
});

test('HTTP permission toggle persists across restart and key deletion clears it',{skip:process.platform!=='win32'},()=>temporary(async directory=>{
  const fake=clientHarness();let app,base,headers;
  const start=async()=>{app=await createServer({dataDirectory:directory,clientFactory:fake.factory});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;const {token}=await(await fetch(base+'/api/session')).json();headers={'X-Workroom-Token':token,'Content-Type':'application/json'};};
  const stop=async()=>{await new Promise(resolve=>app.server.close(resolve));await app.engine.stopTimer();app=null;};
  const status=async()=>{const response=await fetch(base+'/api/status',{headers});assert.equal(response.status,200);return response.json();};
  try{
    await start();assert.equal((await fetch(base+'/api/connection/reconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    const connected=await fetch(base+'/api/connection',{method:'POST',headers,body:JSON.stringify({...credentials,allowTrading:true,liveAcknowledgement:'실전 주문 허용'})});assert.equal(connected.status,200);assert.equal((await status()).credentials.saved,true);
    assert.equal((await fetch(base+'/.runtime/credentials.dpapi')).status,404);assert.equal((await fetch(base+'/../backend/credentials.mjs')).status,404);
    const journal=await readFile(path.join(directory,'state.json'),'utf8');assert.ok(!journal.includes(credentials.apiKey));assert.ok(!journal.includes(credentials.secret));
    await stop();await start();const restored=await status();assert.equal(restored.connected,true);assert.equal(restored.environment,'live');assert.equal(restored.tradingEnabled,true);assert.equal(restored.credentials.saved,true);
    assert.equal(restored.credentials.storagePath,path.join(directory,'credentials.dpapi'));
    assert.ok(!JSON.stringify(restored).includes(credentials.apiKey));assert.ok(!JSON.stringify(restored).includes(credentials.secret));
    const deleted=await fetch(base+'/api/connection',{method:'DELETE',headers,body:'{}'});assert.equal(deleted.status,200);assert.equal((await status()).credentials.saved,false);
    await stop();const before=fake.calls.length;await start();assert.equal((await status()).connected,false);assert.equal(fake.calls.length,before);
  }finally{if(app)await stop();}
}));

test('permission is never granted by vault extras or carried into a different account, and off survives reconnect',async()=>{
 const vault=memoryCredentials(),fake=clientHarness(),store=memoryStore(),engine=await new TradingEngine(store,{clientFactory:fake.factory,credentialStore:vault}).init();
 await engine.connect(credentials);vault.value.allowTrading=true;vault.value.liveAcknowledgement='실전 주문 허용';
 let recovered=await new TradingEngine(memoryStore(store.state),{clientFactory:fake.factory,credentialStore:vault}).init();assert.equal(recovered.tradingEnabled,false);
 await recovered.setTrading(true);await recovered.connect(credentials);assert.equal(recovered.tradingEnabled,true);
 await recovered.setTrading(false);recovered=await new TradingEngine(memoryStore(recovered.state),{clientFactory:fake.factory,credentialStore:vault}).init();assert.equal(recovered.tradingEnabled,false);
 await recovered.setTrading(true);await recovered.connect({...credentials,apiKey:'a-different-fabricated-key-0000'});assert.equal(recovered.tradingEnabled,false);assert.equal(recovered.state.orderPermission.enabled,false);
 await recovered.disconnect();assert.equal(recovered.state.orderPermission,null);
});
test('toggle enable is idempotent, disable is local even offline with exposure, and failed enable cannot grant permission',async()=>{
 const vault=memoryCredentials(),fake=clientHarness(),store=memoryStore(),engine=await new TradingEngine(store,{clientFactory:fake.factory,credentialStore:vault}).init();
 await engine.connect(credentials);await assert.rejects(()=>engine.setTrading('true'),/켜짐 또는 꺼짐/);
 await engine.setTrading(true);const bot=makeBot({runtime:{runEnabled:true,quantity:1,entryPrice:100}});engine.state.bots.push(bot);
 const calls=fake.calls.length;await engine.setTrading(true);assert.equal(bot.runtime.runEnabled,true);assert.equal(fake.calls.length,calls);
 fake.setFail(true);await engine.setTrading(false);assert.equal(engine.tradingEnabled,false);assert.equal(bot.runtime.runEnabled,false);assert.equal(bot.runtime.quantity,1);assert.equal(fake.calls.length,calls);
 await assert.rejects(()=>engine.setTrading(true));assert.equal(engine.tradingEnabled,false);assert.equal(engine.state.orderPermission.enabled,false);
});
