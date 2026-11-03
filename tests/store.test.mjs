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
