import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm,readdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {git,REPOSITORY,repositoryInfo,checkUpdate} from '../backend/app-update.mjs';
import {bootstrapRepository,exists,safeSourcePath,protectedSourcePath} from '../backend/source-package.mjs';
import {updateApplication} from '../tools/update.mjs';
import {packageRelease} from '../tools/package-release.mjs';
async function harness(run){
 const base=await mkdtemp(path.join(os.tmpdir(),'fw-source-package-')),producer=path.join(base,'producer'),remote=path.join(base,'remote.git'),app=path.join(base,'app');
 try{
  await mkdir(producer);await mkdir(app);await git(base,['init','--bare',remote]);await git(producer,['init','-b','main']);await git(producer,['config','user.name','Package Test']);await git(producer,['config','user.email','test@example.invalid']);
  await writeFile(path.join(producer,'package.json'),JSON.stringify({name:'binance-tradingbot-ko',version:'1.0.0',type:'module'}));await writeFile(path.join(producer,'.gitignore'),'.runtime/\ndist/\n.git-bootstrap-*/\n');await writeFile(path.join(producer,'server.mjs'),'export const version=1;\n');await writeFile(path.join(producer,'run.cmd'),'@echo off\r\nnode server.mjs\r\n');await writeFile(path.join(producer,'README.md'),'Source package\n');await mkdir(path.join(producer,'tests'));await writeFile(path.join(producer,'tests','smoke.test.mjs'),"import test from 'node:test';test('candidate',()=>{});\n");
  await git(producer,['add','.']);await git(producer,['commit','-qm','first']);await git(producer,['tag','v1.0.0']);await git(producer,['remote','add','origin',remote]);await git(producer,['push','-qu','origin','main','--tags']);
  const files=(await git(producer,['ls-files','-z'])).split('\0').filter(Boolean);for(const file of files){await mkdir(path.dirname(path.join(app,file)),{recursive:true});await cp(path.join(producer,file),path.join(app,file));}
  await mkdir(path.join(app,'.runtime'));await writeFile(path.join(app,'.runtime','state.json'),'private-journal');await writeFile(path.join(app,'.runtime','credentials.dpapi'),'fabricated-ciphertext');
  const gitImpl=(root,args)=>git(root,['-c','url.'+remote+'.insteadOf='+REPOSITORY,...args]);
  await run({base,producer,remote,app,gitImpl});
 }finally{const safe=path.resolve(base);assert.ok(safe.startsWith(path.resolve(os.tmpdir())+path.sep+'fw-source-package-'));await rm(safe,{recursive:true,force:true,maxRetries:3});}
}
test('a verified source ZIP becomes an isolated Git install and updates while preserving its private data',()=>harness(async({producer,remote,app,gitImpl})=>{
 await writeFile(path.join(app,'run.cmd'),'@echo off\nnode server.mjs\n');
 assert.equal(await bootstrapRepository(app,{gitImpl,onProgress(){}}),true);assert.equal((await repositoryInfo(app)).branch,'main');assert.equal(await git(app,['status','--porcelain']),'',await git(app,['diff','--cached','--stat'])+' '+await git(app,['ls-files','--eol'])+' '+await git(app,['rev-parse','HEAD']));
 assert.equal(await bootstrapRepository(app,{onProgress(){}}),false);
 await git(app,['config','url.'+remote+'.insteadOf',REPOSITORY]);assert.equal((await checkUpdate(app)).available,false);
 await writeFile(path.join(producer,'package.json'),JSON.stringify({name:'binance-tradingbot-ko',version:'1.1.0',type:'module'}));await git(producer,['add','.']);await git(producer,['commit','-qm','next']);await git(producer,['push','-q']);
 const result=await updateApplication(app,{method:'source',dataDirectory:path.join(app,'.runtime'),port:0,onProgress(){}});assert.equal(result.updated,true);assert.equal(JSON.parse(await readFile(path.join(app,'package.json'),'utf8')).version,'1.1.0');
 assert.equal(await readFile(path.join(app,'.runtime','state.json'),'utf8'),'private-journal');assert.equal(await readFile(path.join(app,'.runtime','credentials.dpapi'),'utf8'),'fabricated-ciphertext');
}));
test('modified or incomplete source ZIPs are rejected before creating Git metadata or touching local state',()=>harness(async({app,gitImpl})=>{
 await writeFile(path.join(app,'README.md'),'my edits');await assert.rejects(()=>bootstrapRepository(app,{gitImpl,onProgress(){}}),/로컬 소스 변경/);assert.equal(await exists(path.join(app,'.git')),false);
 assert.equal(await readFile(path.join(app,'README.md'),'utf8'),'my edits');assert.equal(await readFile(path.join(app,'.runtime','state.json'),'utf8'),'private-journal');assert.equal((await readdir(app)).some(name=>name.startsWith('.git-bootstrap-')),false);
}));
test('release ZIP contains only committed source, excludes runtime and emits a matching SHA256 checksum',()=>harness(async({producer})=>{
 await git(producer,['remote','set-url','origin',REPOSITORY]);await mkdir(path.join(producer,'.runtime'));await writeFile(path.join(producer,'.runtime','credentials.dpapi'),'fabricated-private-file');
 const result=await packageRelease(producer),zip=await readFile(result.filename),end=zip.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));let offset=zip.readUInt32LE(end+16);const names=[];
 for(let i=0;i<zip.readUInt16LE(end+10);i++){assert.equal(zip.readUInt32LE(offset),0x02014b50);const length=zip.readUInt16LE(offset+28);names.push(zip.subarray(offset+46,offset+46+length).toString());offset+=46+length+zip.readUInt16LE(offset+30)+zip.readUInt16LE(offset+32);}
 assert.ok(names.includes('binance-tradingbot-ko/run.cmd'));assert.ok(names.includes('binance-tradingbot-ko/server.mjs'));assert.ok(names.every(name=>!name.includes('.runtime/')&&!name.includes('/.git/')));
 assert.equal(result.sha256,createHash('sha256').update(zip).digest('hex'));assert.match(await readFile(path.join(producer,'dist','SHA256SUMS.txt'),'utf8'),new RegExp('^'+result.sha256));
 await writeFile(path.join(producer,'README.md'),'local edits');await assert.rejects(()=>packageRelease(producer),/커밋되지 않은/);
}));
test('source paths reject traversals and explicitly exclude personal/runtime files',()=>{
 for(const file of ['../state.json','x/../../key','C:/key','/tmp/key','a\\b','.git/config'])assert.equal(safeSourcePath(file),false);
 for(const file of ['.runtime/state.json','.env','a/.env.local','private.key','dist/app.zip'])assert.equal(protectedSourcePath(file),true);
 assert.equal(safeSourcePath('public/room-assets/parts/03Hair-1.svg'),true);
});

test('repository identity accepts Windows directory aliases for the same physical checkout',()=>harness(async({base,producer})=>{await git(producer,['remote','set-url','origin',REPOSITORY]);const alias=path.join(base,'alias');await symlink(producer,alias,process.platform==='win32'?'junction':'dir');assert.equal((await repositoryInfo(alias)).revision,await git(producer,['rev-parse','HEAD']));}));

test('Windows release ZIP CRLF files stay byte-identical and clean after bootstrap',()=>harness(async({app,gitImpl})=>{const files=['.gitignore','README.md','run.cmd','server.mjs','package.json','tests/smoke.test.mjs'],before=new Map();for(const file of files){const value=(await readFile(path.join(app,file),'utf8')).replace(/\r?\n/g,'\r\n');await writeFile(path.join(app,file),value);before.set(file,value);}await bootstrapRepository(app,{gitImpl,onProgress(){}});assert.equal(await git(app,['status','--porcelain']),'');for(const [file,value]of before)assert.equal(await readFile(path.join(app,file),'utf8'),value);}));

test('untagged source ZIPs match their original main version and can update after main advances',()=>harness(async({producer,remote,app,gitImpl})=>{
 const original=await git(producer,['rev-parse','HEAD']);await git(producer,['tag','-d','v1.0.0']);await git(producer,['push','-q','origin',':refs/tags/v1.0.0']);
 await writeFile(path.join(producer,'package.json'),JSON.stringify({name:'binance-tradingbot-ko',version:'1.1.0',type:'module'}));await writeFile(path.join(producer,'README.md'),'next source');await git(producer,['add','.']);await git(producer,['commit','-qm','next without release tag']);await git(producer,['push','-q']);
 const check=await checkUpdate(app,{gitImpl});assert.equal(check.requiresVerification,true);assert.equal(check.available,null);assert.equal(await exists(path.join(app,'.git')),false);
 assert.equal(await bootstrapRepository(app,{gitImpl,onProgress(){}}),true);assert.equal(await git(app,['rev-parse','HEAD']),original);assert.equal(await git(app,['status','--porcelain']),'');
 await git(app,['config','url.'+remote+'.insteadOf',REPOSITORY]);assert.equal((await updateApplication(app,{method:'source',dataDirectory:path.join(app,'.runtime'),port:0,onProgress(){}})).updated,true);
 assert.equal(JSON.parse(await readFile(path.join(app,'package.json'),'utf8')).version,'1.1.0');assert.equal(await readFile(path.join(app,'.runtime','state.json'),'utf8'),'private-journal');assert.equal(await readFile(path.join(app,'.runtime','credentials.dpapi'),'utf8'),'fabricated-ciphertext');
}));
test('untagged ZIP verification still rejects changed source and preserves private files',()=>harness(async({producer,app,gitImpl})=>{
 await git(producer,['tag','-d','v1.0.0']);await git(producer,['push','-q','origin',':refs/tags/v1.0.0']);await writeFile(path.join(app,'server.mjs'),'my source changes');
 await assert.rejects(()=>bootstrapRepository(app,{gitImpl,onProgress(){}}),/로컬 소스 변경/);assert.equal(await exists(path.join(app,'.git')),false);assert.equal(await readFile(path.join(app,'.runtime','credentials.dpapi'),'utf8'),'fabricated-ciphertext');
}));

test('releases publish a standalone two-file repair ZIP with its own checksum',()=>harness(async({producer})=>{
 await git(producer,['remote','set-url','origin',REPOSITORY]);await writeFile(path.join(producer,'repair.cmd'),'@echo off\r\n');await writeFile(path.join(producer,'repair.ps1'),'# repair\n');await git(producer,['add','repair.cmd','repair.ps1']);await git(producer,['commit','-qm','repair fixture']);const result=await packageRelease(producer);assert.ok(result.repairFilename?.endsWith('-repair.zip'));
 const zip=await readFile(result.repairFilename),end=zip.lastIndexOf(Buffer.from([80,75,5,6]));let offset=zip.readUInt32LE(end+16);const names=[];for(let i=0;i<zip.readUInt16LE(end+10);i++){const length=zip.readUInt16LE(offset+28);names.push(zip.subarray(offset+46,offset+46+length).toString());offset+=46+length+zip.readUInt16LE(offset+30)+zip.readUInt16LE(offset+32);}assert.deepEqual(names,['repair.cmd','repair.ps1']);const checks=await readFile(path.join(producer,'dist/SHA256SUMS.txt'),'utf8');assert.ok(checks.includes(createHash('sha256').update(zip).digest('hex')+'  '+path.basename(result.repairFilename)));
}));
