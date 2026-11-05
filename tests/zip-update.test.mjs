import test from 'node:test';import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,readdir,access,symlink} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {updateApplication} from '../tools/update.mjs';import {recoverSourceUpdate,validateReleaseCandidate} from '../backend/zip-update.mjs';import {acquireServerLock,acquireLock} from '../backend/app-lifecycle.mjs';
import {fixture,updates,sources,materialize,digest} from './helpers/release-fixture.mjs';
const exec=promisify(execFile),opts=(root,value)=>({...value,dataDirectory:path.join(root,'.runtime')});
async function absent(file){await assert.rejects(()=>access(file),{code:'ENOENT'});}
test('default release update needs no Git, preserves private/unowned data and replaces only verified source',()=>fixture(async root=>{
 const {old,next,options}=updates(sources('1.0.0',{'old.js':'// remove me\n'}),sources('1.1.0',{'new.js':'// added\n'}));await materialize(root,old);
 const privateFiles=new Map([['.runtime/state.json','journal'],['.runtime/credentials.dpapi','ciphertext'],['.runtime/chart-settings.json','chart'],['.runtime/favorites.json','stars'],['.runtime/custom-studies.json','studies'],['.git/config','git metadata'],['my-notes.txt','unowned']].map(([f,s])=>[f,Buffer.from(s)]));await materialize(root,privateFiles);
 const result=await updateApplication(root,opts(root,options));assert.equal(result.updated,true);assert.equal(result.method,'release');assert.equal(result.version,'1.1.0');
 for(const [name,data]of [...next,...privateFiles])assert.deepEqual(await readFile(path.join(root,name)),data,name);
 await absent(path.join(root,'old.js'));await absent(path.join(root,'.runtime/source-update.json'));await absent(path.join(root,'.runtime/update.lock'));assert.equal(await readFile(path.join(result.backup,'state.json'),'utf8'),'journal');assert.deepEqual(await readFile(path.join(result.backup,'source/package.json')),old.get('package.json'));
}));
test('Node-only subprocess updates a clean ZIP with no Git executable on PATH',()=>fixture(async root=>{
 const {old}=updates();await materialize(root,old);
 const helper=new URL('./helpers/release-fixture.mjs',import.meta.url).href,updater=new URL('../tools/update.mjs',import.meta.url).href;
 const code='import {spawnSync} from "node:child_process";import {updates} from '+JSON.stringify(helper)+';import {updateApplication} from '+JSON.stringify(updater)+';if(spawnSync("git",["--version"]).status===0)throw Error("Git unexpectedly exists");const root=process.argv[1],{options}=updates();await updateApplication(root,{...options,dataDirectory:root+"/.runtime"});console.log("NODE_ONLY_UPDATED");';
 const env={...process.env,PATH:path.dirname(process.execPath)};delete env.NODE_TEST_CONTEXT;
 const {stdout}=await exec(process.execPath,['--input-type=module','-e',code,root],{env,windowsHide:true,timeout:30000});assert.match(stdout,/NODE_ONLY_UPDATED/);assert.equal(JSON.parse(await readFile(path.join(root,'package.json'))).version,'1.1.0');await absent(path.join(root,'.git'));
}));
test('source edits and conflicting local files are refused without changing private files',()=>fixture(async root=>{
 const {old,options}=updates(sources('1.0.0'),sources('1.1.0',{'new.js':'new'}));await materialize(root,old);await writeFile(path.join(root,'public/app.js'),'my code');
 await assert.rejects(()=>updateApplication(root,opts(root,options)),/ローカル|로컬 소스/);assert.equal(await readFile(path.join(root,'public/app.js'),'utf8'),'my code');
 await materialize(root,old);await writeFile(path.join(root,'new.js'),'my new file');await assert.rejects(()=>updateApplication(root,opts(root,options)),/충돌/);assert.equal(await readFile(path.join(root,'new.js'),'utf8'),'my new file');assert.deepEqual(await readFile(path.join(root,'package.json')),old.get('package.json'));
}));
test('CRLF normalization is accepted but binary changes are not',()=>fixture(async root=>{
 const {old,options}=updates(sources('1.0.0',{'image.bin':Buffer.from([0,1,2])}),sources('1.1.0'));await materialize(root,old);await writeFile(path.join(root,'server.mjs'),old.get('server.mjs').toString().replace(/\n/g,'\r\n'));await writeFile(path.join(root,'image.bin'),Buffer.from([0,1,3]));await assert.rejects(()=>updateApplication(root,opts(root,options)),/로컬 소스/);await writeFile(path.join(root,'image.bin'),old.get('image.bin'));assert.equal((await updateApplication(root,opts(root,options))).updated,true);
}));
test('failed candidate validation and concurrent edits leave old source untouched',()=>fixture(async root=>{
 const {old,options}=updates();await materialize(root,old);
 await assert.rejects(()=>updateApplication(root,opts(root,{...options,validateCandidate:async()=>{throw Error('fixture validation failed');}})),/validation failed/);assert.deepEqual(await readFile(path.join(root,'package.json')),old.get('package.json'));await absent(path.join(root,'.runtime/source-update.json'));
 await assert.rejects(()=>updateApplication(root,opts(root,{...options,validateCandidate:async()=>{await writeFile(path.join(root,'public/app.js'),'edit during validation');}})),/검증 중 파일/);assert.equal(await readFile(path.join(root,'public/app.js'),'utf8'),'edit during validation');assert.deepEqual(await readFile(path.join(root,'package.json')),old.get('package.json'));
}));
test('partial file replacement rolls back updates, additions and removals exactly',()=>fixture(async root=>{
 const {old,next,options}=updates(sources('1.0.0',{'old.js':'// old'}),sources('1.1.0',{'new.js':'// new'}));await materialize(root,old);await materialize(root,new Map([['.runtime/state.json',Buffer.from('journal')]]));
 await assert.rejects(()=>updateApplication(root,opts(root,{...options,afterFile:async file=>{if(file==='new.js')throw Error('simulated write failure');}})),/기존 버전으로 복구/);
 for(const [file,bytes]of old)assert.deepEqual(await readFile(path.join(root,file)),bytes,file);for(const file of next.keys())if(!old.has(file))await absent(path.join(root,file));assert.equal(await readFile(path.join(root,'.runtime/state.json'),'utf8'),'journal');await absent(path.join(root,'.runtime/source-update.json'));
}));
async function crashMarker(root,{committed=false,unexpected=false}={}){
 const dataDirectory=path.join(root,'.runtime'),id=Date.now()+'-'+randomUUID(),before=Buffer.from('original'),after=Buffer.from('replacement'),backup=path.join(dataDirectory,'backups','source-update-'+id,'source');await materialize(backup,new Map([['server.mjs',before]]));await writeFile(path.join(root,'server.mjs'),unexpected?'later user edit':after);
 const marker={id,root,dataDirectory,committed,files:[{file:'server.mjs',before:digest(before),after:digest(after)}]};await writeFile(path.join(dataDirectory,'source-update.json'),JSON.stringify(marker));return {dataDirectory,before,after};
}
test('interrupted updates block startup until recovery; completed markers are finalized',()=>fixture(async root=>{
 const {dataDirectory,before}=await crashMarker(root);await assert.rejects(()=>acquireServerLock(root,dataDirectory,0),/중단된 업데이트/);await absent(path.join(dataDirectory,'server.lock'));assert.equal(await recoverSourceUpdate(root,dataDirectory,{onProgress(){}}),true);assert.deepEqual(await readFile(path.join(root,'server.mjs')),before);const release=await acquireServerLock(root,dataDirectory,0);await release();
 const completed=await crashMarker(root,{committed:true});assert.equal(await recoverSourceUpdate(root,dataDirectory,{onProgress(){}}),true);assert.deepEqual(await readFile(path.join(root,'server.mjs')),completed.after);
}));
test('recovery never overwrites later user edits or trusts altered backups',()=>fixture(async root=>{
 const {dataDirectory}=await crashMarker(root,{unexpected:true});await assert.rejects(()=>recoverSourceUpdate(root,dataDirectory,{onProgress(){}}),/자동 복구하지/);assert.equal(await readFile(path.join(root,'server.mjs'),'utf8'),'later user edit');await access(path.join(dataDirectory,'source-update.json'));
 const marker=JSON.parse(await readFile(path.join(dataDirectory,'source-update.json')));await writeFile(path.join(root,'server.mjs'),'replacement');await writeFile(path.join(dataDirectory,'backups','source-update-'+marker.id,'source/server.mjs'),'bad backup');await assert.rejects(()=>recoverSourceUpdate(root,dataDirectory,{onProgress(){}}),/원본 백업/);assert.equal(await readFile(path.join(root,'server.mjs'),'utf8'),'replacement');
}));
test('release updater rejects active locks using the explicitly supplied data directory',()=>fixture(async root=>{
 const {old,options}=updates();await materialize(root,old);const dataDirectory=path.join(root,'external-runtime'),unlock=await acquireLock(path.join(dataDirectory,'server.lock'));try{await assert.rejects(()=>updateApplication(root,{...options,dataDirectory}),/프로그램이 실행 중/);}finally{await unlock();}await absent(path.join(root,'.runtime/update.lock'));
 const release=await acquireLock(path.join(root,'.runtime/update.lock'));try{await assert.rejects(()=>updateApplication(root,opts(root,options)),/이미 실행/);}finally{await release();}
}));
test('latest or ahead installations do not download, bootstrap Git or modify source',()=>fixture(async root=>{
 const {old,options}=updates();await materialize(root,old);for(const ahead of [false,true]){let calls=0;const result=await updateApplication(root,opts(root,{...options,checkRelease:async()=>({available:false,ahead}),fetchImpl:async()=>{calls++;throw Error('unexpected download');}}));assert.equal(result.updated,false);assert.equal(result.ahead,ahead);assert.equal(calls,0);}assert.deepEqual(await readFile(path.join(root,'package.json')),old.get('package.json'));await absent(path.join(root,'.git'));
}));
test('release validation rejects syntax and import errors before touching installed files',()=>fixture(async root=>{
 const {old,options}=updates(sources('1.0.0'),sources('1.1.0',{'server.mjs':'export function createServer( {'}));await materialize(root,old);await assert.rejects(()=>updateApplication(root,opts(root,options)),/검증 실패/);assert.deepEqual(await readFile(path.join(root,'package.json')),old.get('package.json'));
}));
test('Windows junctions and case-only release renames cannot redirect source replacement',()=>fixture(async root=>{
 const {old,options}=updates(sources('1.0.0',{'Name.txt':'old'}),sources('1.1.0',{'name.txt':'next'}));await materialize(root,old);await assert.rejects(()=>updateApplication(root,opts(root,options)),/대소문자/);
 const clean=updates();await materialize(root,clean.old);const external=path.join(root,'external');await mkdir(external);await writeFile(path.join(external,'app.js'),'external');const {unlink,rmdir}=await import('node:fs/promises');await unlink(path.join(root,'public/app.js'));await unlink(path.join(root,'public/index.html'));await rmdir(path.join(root,'public'));await symlink(external,path.join(root,'public'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>updateApplication(root,opts(root,clean.options)),/링크/);assert.equal(await readFile(path.join(external,'app.js'),'utf8'),'external');
}));

test('a killed updater leaves a durable recovery journal and the next update restores old source first',()=>fixture(async root=>{
 const {old,options}=updates();await materialize(root,old);const helper=new URL('./helpers/release-fixture.mjs',import.meta.url).href,updater=new URL('../tools/update.mjs',import.meta.url).href;
 const code='import {updates} from '+JSON.stringify(helper)+';import {updateApplication} from '+JSON.stringify(updater)+';const root=process.argv[1],{options}=updates();await updateApplication(root,{...options,dataDirectory:root+"/.runtime",afterFile:()=>{process.kill(process.pid,"SIGKILL");}});';
 const env={...process.env};delete env.NODE_TEST_CONTEXT;await assert.rejects(()=>exec(process.execPath,['--input-type=module','-e',code,root],{env,windowsHide:true,timeout:30000}));await access(path.join(root,'.runtime/source-update.json'));
 await assert.rejects(()=>updateApplication(root,opts(root,{...options,checkRelease:async()=>{throw Error('stop after recovery');}})),/stop after recovery/);for(const [file,bytes]of old)assert.deepEqual(await readFile(path.join(root,file)),bytes,file);await absent(path.join(root,'.runtime/source-update.json'));await absent(path.join(root,'.runtime/update.lock'));
}));
