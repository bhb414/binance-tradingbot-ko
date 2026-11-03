import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {acquireLock,lockActive,acquireServerLock} from '../backend/app-lifecycle.mjs';
import {normalizeRemote,REPOSITORY} from '../backend/app-update.mjs';
import {validateUpdate,updateApplication} from '../tools/update.mjs';
test('updates reject edits, other branches and tracked local secrets without overwriting files',()=>{
  assert.doesNotThrow(()=>validateUpdate({branch:'main',dirty:'',protectedPaths:[]}));
  assert.throws(()=>validateUpdate({branch:'feature',dirty:'',protectedPaths:[]}),/main/);
  assert.throws(()=>validateUpdate({branch:'main',dirty:' M server.mjs',protectedPaths:[]}),/로컬 소스/);
  assert.throws(()=>validateUpdate({branch:'main',dirty:'',protectedPaths:['.runtime/state.json']}),/저장 키/);
  assert.equal(normalizeRemote(REPOSITORY),normalizeRemote('https://github.com/bhb414/binance-tradingbot-ko/'));
});
test('server and updater locks exclude concurrent work, recover dead processes and preserve unrelated local files',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'fw-update-test-')),data=path.join(root,'.runtime');
  try{
    await mkdir(data);const lock=path.join(data,'server.lock'),release=await acquireLock(lock);
    assert.equal(await lockActive(lock),true);await assert.rejects(()=>acquireLock(lock),/이미 실행/);
    await assert.rejects(()=>updateApplication(root,{port:0,onProgress(){}}),/프로그램이 실행 중/);assert.equal(await lockActive(path.join(data,'update.lock')),false);
    await release();assert.equal(await lockActive(lock),false);
    await writeFile(lock,JSON.stringify({pid:1234567}));assert.equal(await lockActive(lock,{alive:()=>false}),false);
    const releaseUpdate=await acquireLock(path.join(data,'update.lock'));await assert.rejects(()=>acquireServerLock(root,data,0),/업데이트 중/);assert.equal(await lockActive(lock),false);await releaseUpdate();
    await writeFile(path.join(data,'state.json'),'local-journal');const unlock=await acquireServerLock(root,data,0);await unlock();assert.equal(await readFile(path.join(data,'state.json'),'utf8'),'local-journal');
  }finally{const target=path.resolve(root);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep+'fw-update-test-'));await rm(target,{recursive:true,force:true});}
});
