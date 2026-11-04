import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
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
    await assert.rejects(()=>updateApplication(root,{dataDirectory:data,port:0,onProgress(){}}),/프로그램이 실행 중/);assert.equal(await lockActive(path.join(data,'update.lock')),false);
    await release();assert.equal(await lockActive(lock),false);
    await writeFile(lock,JSON.stringify({pid:1234567}));assert.equal(await lockActive(lock,{alive:()=>false}),false);
    const releaseUpdate=await acquireLock(path.join(data,'update.lock'));await assert.rejects(()=>acquireServerLock(root,data,0),/업데이트 중/);assert.equal(await lockActive(lock),false);await releaseUpdate();
    await writeFile(path.join(data,'state.json'),'local-journal');const unlock=await acquireServerLock(root,data,0);await unlock();assert.equal(await readFile(path.join(data,'state.json'),'utf8'),'local-journal');
  }finally{const target=path.resolve(root);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep+'fw-update-test-'));await rm(target,{recursive:true,force:true});}
});

// Real update validation runs tests with a candidate-owned WORKROOM_DATA_DIR.
test('lock fixture remains isolated when candidate validation sets WORKROOM_DATA_DIR',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'fw-update-env-')),foreign=path.join(directory,'candidate-runtime');
 try{await mkdir(foreign);await writeFile(path.join(foreign,'state.json'),'validation-sentinel');await exec(process.execPath,['--test','--test-name-pattern=^server and updater locks exclude',fileURLToPath(import.meta.url)],{env:{...process.env,WORKROOM_DATA_DIR:foreign},windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});assert.equal(await readFile(path.join(foreign,'state.json'),'utf8'),'validation-sentinel');}
 finally{const safe=path.resolve(directory);assert.ok(safe.startsWith(path.resolve(os.tmpdir())+path.sep+'fw-update-env-'));await rm(safe,{recursive:true,force:true,maxRetries:3});}
});
