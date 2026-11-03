import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore } from '../backend/store.mjs';
test('the journal persists intent and execution state atomically and reloads it',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'fw-test-'));
  try{const store=new StateStore(directory);await store.load();store.state.orders.push({id:'intent-before-post',status:'UNKNOWN'});await store.save();store.state.orders[0].status='FILLED';await store.save();const reopened=new StateStore(directory);await reopened.load();assert.equal(reopened.state.orders[0].status,'FILLED');assert.equal(JSON.parse(await readFile(path.join(directory,'state.json'),'utf8')).version,2);}
  finally{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'fw-test-'));await rm(directory,{recursive:true,force:true});}
});

test('transient Windows replacement locks retry with distinct temp files and leave a valid old journal on exhaustion',async()=>{
 const fs=await import('node:fs/promises'),directory=await mkdtemp(path.join(os.tmpdir(),'fw-store-retry-'));let failures=0;const waits=[],temps=[];
 try{
  const adapter={...fs,async rename(from,to){temps.push(from);if(failures>0){failures--;throw Object.assign(Error('locked'),{code:'EPERM',syscall:'rename',path:from});}return fs.rename(from,to);}},store=new StateStore(directory,{fs:adapter,delay:async ms=>waits.push(ms),retryDelays:[1,2]});
  await store.load();store.state.orders.push({id:'original',status:'NEW'});await store.save();const original=await readFile(store.filename,'utf8');
  failures=2;store.state.orders[0].status='FILLED';await store.save();await store.verify();assert.deepEqual(waits,[1,2]);assert.equal(new Set(temps).size,temps.length);
  const stable=await readFile(store.filename,'utf8');failures=10;store.state.orders[0].status='CANCELED';await assert.rejects(()=>store.save(),e=>e.code==='EPERM'&&e.storageAttempts===3);assert.equal(await readFile(store.filename,'utf8'),stable);assert.notEqual(original,stable);assert.deepEqual(await fs.readdir(directory),['state.json']);
 }finally{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'fw-store-retry-'));await rm(directory,{recursive:true,force:true});}
});
test('disk-full errors do not spin, verification detects changed bytes and diagnostic records contain cause and time',async()=>{
 const fs=await import('node:fs/promises'),directory=await mkdtemp(path.join(os.tmpdir(),'fw-store-full-'));let fail=false,attempts=0;
 try{
  const store=new StateStore(directory,{fs:{...fs,async open(...args){attempts++;if(fail)throw Object.assign(Error('full'),{code:'ENOSPC',syscall:'open',path:args[0]});return fs.open(...args);}},delay:async()=>{throw Error('no retry for disk full');}});
  await store.load();await store.save();fail=true;await assert.rejects(()=>store.save(),e=>e.code==='ENOSPC'&&e.storageAttempts===1);assert.equal(attempts,2);
  assert.equal(await store.recordStorageEvent({at:123,event:'failed',code:'ENOSPC',syscall:'open',file:'state.json'}),true);assert.equal(JSON.parse((await fs.readFile(path.join(directory,'storage-errors.log'),'utf8')).trim()).code,'ENOSPC');
  await fs.writeFile(store.filename,'changed');await assert.rejects(()=>store.verify(),e=>e.code==='EVERIFY');
 }finally{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'fw-store-full-'));await rm(directory,{recursive:true,force:true});}
});
