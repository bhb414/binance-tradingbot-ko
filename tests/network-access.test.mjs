import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {NetworkAccess,lanInterfaces,loopback} from '../backend/network-access.mjs';
import {createServer} from '../server.mjs';
import {emptyState} from '../backend/store.mjs';
import {randomId} from '../public/id.js';

const interfaces=()=>({'Wi-Fi':[{family:'IPv4',address:'192.168.1.100',netmask:'255.255.255.0',internal:false}],'vEthernet (Default Switch)':[{family:'IPv4',address:'172.22.32.1',netmask:'255.255.240.0',internal:false}]});
const listener=()=>Object.assign(new EventEmitter(),{listen(port,address,callback){this.bound={port,address};callback();},closeAllConnections(){this.disconnected=true;},close(callback){callback?.();}});
const primary={address:()=>({port:8896}),emit(){throw Error('No request expected');}};
const request=(remote='192.168.1.12',local='192.168.1.100',host='192.168.1.100:8896')=>({socket:{remoteAddress:remote,localAddress:local},headers:{host}});
test('LAN uses private physical addresses, defaults off, and validates peer subnet, host and exact origin',async()=>{
 assert.deepEqual(lanInterfaces(interfaces()).map(r=>r.address),['192.168.1.100']);assert.equal(loopback('::ffff:127.0.0.1'),true);assert.equal(loopback('192.168.1.12'),false);
 const n=await new NetworkAccess(null,{interfaces,listener}).init();await n.start(primary);
 assert.equal(n.config.enabled,false);assert.equal(n.allowed(request(),8896),false);assert.equal(n.allowed(request('127.0.0.1','127.0.0.1','localhost:8896'),8896),true);
 await n.setEnabled(true);assert.deepEqual(n.view(true).urls,['http://192.168.1.100:8896']);assert.equal(n.allowed(request(),8896),true);
 for(const r of [request('192.168.2.12'),request('8.8.8.8'),request('192.168.1.12','192.168.1.100','evil.example:8896'),request('192.168.1.12','172.22.32.1','172.22.32.1:8896')])assert.equal(n.allowed(r,8896),false);
 assert.equal(n.validOrigin({...request(),headers:{host:'192.168.1.100:8896',origin:'http://192.168.1.100:8896'}}),true);
 for(const origin of ['http://evil.example:8896','http://192.168.1.100:9000','https://192.168.1.100:8896','null'])assert.equal(n.validOrigin({...request(),headers:{host:'192.168.1.100:8896',origin}}),false);
 await n.close();
});
test('LAN pairing is rate-limited, survives restart for trusted devices, expires, and is revoked by off',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'workroom-lan-'));let now=1800000000000;
 try{
  const n=await new NetworkAccess(directory,{interfaces,listener,now:()=>now}).init();await n.start(primary);await n.setEnabled(true);
  assert.equal(n.view(false).code,null);const cookie=n.pair(n.code).split(';')[0];assert.equal(n.authenticated({headers:{cookie}}),true);
  assert.equal(n.authenticated({headers:{cookie:cookie.slice(0,-1)+'x'}}),false);
  const reloaded=await new NetworkAccess(directory,{interfaces,listener,now:()=>now}).init();assert.equal(reloaded.config.enabled,true);assert.equal(reloaded.authenticated({headers:{cookie}}),true);await reloaded.start(primary);
  for(let i=0;i<5;i++)assert.throws(()=>reloaded.pair('bad'),e=>e.httpStatus===401);assert.throws(()=>reloaded.pair(reloaded.code),e=>e.httpStatus===429);now+=60001;assert.ok(reloaded.pair(reloaded.code));
  now+=31*86400000;assert.equal(reloaded.authenticated({headers:{cookie}}),false);now-=31*86400000;
  await reloaded.setEnabled(false);await reloaded.setEnabled(true);assert.equal(reloaded.authenticated({headers:{cookie}}),false);await reloaded.setEnabled(false);assert.equal(JSON.parse(await readFile(path.join(directory,'network.json'),'utf8')).enabled,false);
  await n.close();await reloaded.close();
 }finally{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'workroom-lan-'));await rm(directory,{recursive:true,force:true});}
});
test('LAN toggling and address refresh never close the primary server; failed saves retain the old setting',async()=>{
 let rows=interfaces(),requests=0;const n=await new NetworkAccess(null,{interfaces:()=>rows,listener}).init();await n.start({address:primary.address,emit(){requests++;}});
 n.persist=async()=>{throw Error('disk full');};await assert.rejects(()=>n.setEnabled(true),/저장/);assert.equal(n.config.enabled,false);assert.equal(n.listeners.size,0);
 n.persist=async()=>{};await n.setEnabled(true);rows={'Wi-Fi':[{...interfaces()['Wi-Fi'][0],address:'192.168.1.101'}]};await n.refresh();assert.deepEqual(n.view(true).urls,['http://192.168.1.101:8896']);
 await n.setEnabled(false);assert.equal(n.listeners.size,0);assert.equal(requests,0);await n.close();
});
test('HTTP LAN requests need pairing before the app session and cannot change network access or API keys',async()=>{
 const n=await new NetworkAccess(null,{interfaces,listener}).init();
 // Only this injected test adapter marks loopback requests as simulated remote peers.
 n.local=req=>req.headers['x-test-peer']!=='lan';
 n.allowed=(req,port)=>req.headers.host==='127.0.0.1:'+port&&(n.local(req)||n.config.enabled);
 const state=emptyState(),store={state,async load(){},async save(){}},app=await createServer({store,networkAccess:n});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const base='http://127.0.0.1:'+app.server.address().port;
 try{
  const {token}=await(await fetch(base+'/api/session')).json(),headers={'Content-Type':'application/json','X-Workroom-Token':token};
  assert.equal((await fetch(base+'/api/network',{headers})).status,200);
  assert.equal((await fetch(base+'/api/network',{method:'POST',headers,body:'{"enabled":true}'})).status,200);
  assert.equal(app.engine.tradingEnabled,false);assert.deepEqual(app.engine.snapshot().bots,[]);
  const remote={'x-test-peer':'lan',...headers};
  assert.equal((await fetch(base+'/api/session',{headers:remote})).status,401);
  assert.equal((await fetch(base+'/',{headers:remote,redirect:'manual'})).status,302);
  assert.equal((await fetch(base+'/pair.js',{headers:remote})).status,200);
  assert.equal((await fetch(base+'/api/network/pair',{method:'POST',headers:{...remote,Origin:'http://evil.example'},body:JSON.stringify({code:n.code})})).status,403);
  const pair=await fetch(base+'/api/network/pair',{method:'POST',headers:remote,body:JSON.stringify({code:n.code})});assert.equal(pair.status,200);
  const cookie=pair.headers.get('set-cookie').split(';')[0],trusted={...remote,Cookie:cookie};
  assert.equal((await fetch(base+'/api/session',{headers:trusted})).status,200);
  assert.match(await(await fetch(base+'/',{headers:trusted})).text(),/봇 작업실/);
  const view=await(await fetch(base+'/api/network',{headers:trusted})).json();assert.equal(view.local,false);assert.equal(view.code,null);
  for(const pathname of ['/api/connection','/api/connection/reconnect','/api/network'])assert.equal((await fetch(base+pathname,{method:'POST',headers:trusted,body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/status',{headers:{...trusted,Origin:base.replace('http:','https:')}})).status,403);
  await fetch(base+'/api/network',{method:'POST',headers,body:'{"enabled":false}'});
  assert.equal((await fetch(base+'/api/status',{headers:trusted})).status,403);
 }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));await n.close();}
});
test('HTTP LAN browsers can create valid random UUIDs without crypto.randomUUID',()=>{
 let count=0;const crypto={getRandomValues(bytes){bytes.fill(++count);return bytes;}},a=randomId(crypto),b=randomId(crypto);
 assert.match(a,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.notEqual(a,b);
});
