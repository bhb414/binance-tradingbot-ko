import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {git,REPOSITORY,checkUpdate} from '../backend/app-update.mjs';
import {updateApplication} from '../tools/update.mjs';
test('update validates a candidate checkout before fast-forward and never replaces the local trading journal',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'fw-update-flow-')),remote=path.join(directory,'remote.git'),producer=path.join(directory,'producer'),app=path.join(directory,'app');
  try{
    await mkdir(producer);await git(directory,['init','--bare',remote]);await git(producer,['init','-b','main']);await git(producer,['config','user.name','Update Test']);await git(producer,['config','user.email','test@example.invalid']);
    await writeFile(path.join(producer,'package.json'),JSON.stringify({type:'module',version:'1.0.0'}));await writeFile(path.join(producer,'.gitignore'),'.runtime/\n');await writeFile(path.join(producer,'server.mjs'),'export const version=1;\n');await mkdir(path.join(producer,'tests'));await writeFile(path.join(producer,'tests','version.test.mjs'),"import test from 'node:test';test('candidate',()=>{});\n");
    // Include the real lock fixture in the candidate to exercise the updater's inherited environment.
    for(const file of ['backend/app-lifecycle.mjs','backend/app-update.mjs','backend/release-update.mjs','backend/source-package.mjs','tools/update.mjs','tests/app-update.test.mjs']){await mkdir(path.dirname(path.join(producer,file)),{recursive:true});await writeFile(path.join(producer,file),await readFile(new URL('../'+file,import.meta.url)));}
    await git(producer,['add','.']);await git(producer,['commit','-qm','first']);await git(producer,['remote','add','origin',remote]);await git(producer,['push','-qu','origin','main']);await git(directory,['clone','-b','main',remote,app]);
    await git(app,['remote','set-url','origin',REPOSITORY]);
    // Keep production's fixed remote identity; redirect only this test repository's transport locally.
    await git(app,['config','url.'+remote+'.insteadOf',REPOSITORY]);
    await mkdir(path.join(app,'.runtime'));await writeFile(path.join(app,'.runtime','state.json'),'private-local-journal');
    assert.equal((await checkUpdate(app)).available,false);
    await writeFile(path.join(producer,'package.json'),JSON.stringify({type:'module',version:'1.1.0'}));await git(producer,['add','.']);await git(producer,['commit','-qm','second']);await git(producer,['push','-q']);
    assert.equal((await checkUpdate(app)).available,true);const result=await updateApplication(app,{dataDirectory:path.join(app,'.runtime'),port:0,onProgress(){}});assert.equal(result.updated,true);assert.equal(JSON.parse(await readFile(path.join(app,'package.json'),'utf8')).version,'1.1.0');assert.equal(await readFile(path.join(app,'.runtime','state.json'),'utf8'),'private-local-journal');
    const backups=await readdir(path.join(app,'.runtime','backups'));assert.equal(backups.length,1);assert.equal(await readFile(path.join(app,'.runtime','backups',backups[0]),'utf8'),'private-local-journal');
    const previous=await git(app,['rev-parse','HEAD']);await writeFile(path.join(producer,'tests','version.test.mjs'),"throw Error('broken candidate');\n");await git(producer,['add','.']);await git(producer,['commit','-qm','broken']);await git(producer,['push','-q']);
    await assert.rejects(()=>updateApplication(app,{dataDirectory:path.join(app,'.runtime'),port:0,onProgress(){}}),/검증 실패/);assert.equal(await git(app,['rev-parse','HEAD']),previous);assert.equal(await readFile(path.join(app,'.runtime','state.json'),'utf8'),'private-local-journal');
  }finally{const safe=path.resolve(directory);assert.ok(safe.startsWith(path.resolve(os.tmpdir())+path.sep+'fw-update-flow-'));await rm(safe,{recursive:true,force:true,maxRetries:3});}
});
