import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createReleaseChecker,LATEST_RELEASE_API,RELEASES_URL} from '../backend/release-update.mjs';
import {updateApplication} from '../tools/update.mjs';
const release=(version='0.4.36')=>({tag_name:'v'+version,draft:false,prerelease:false,assets:[{name:'binance-tradingbot-ko-v'+version+'-windows.zip',browser_download_url:RELEASES_URL+'/download/v'+version+'/binance-tradingbot-ko-v'+version+'-windows.zip'}]});
const ok=data=>({ok:true,status:200,json:async()=>data});
async function fixture(run){
 const root=await mkdtemp(path.join(os.tmpdir(),'fw-release-check-'));
 try{await writeFile(path.join(root,'package.json'),JSON.stringify({name:'binance-tradingbot-ko',version:'0.4.35'}));await run(root);}
 finally{const safe=path.resolve(root);assert.ok(safe.startsWith(path.resolve(os.tmpdir())+path.sep+'fw-release-check-'));await rm(safe,{recursive:true,force:true,maxRetries:3});}
}
test('ZIP release checks use public HTTPS without Git metadata or changing private data',()=>fixture(async root=>{
 await mkdir(path.join(root,'.runtime'));await writeFile(path.join(root,'.runtime','state.json'),'private-journal');
 const before=await readdir(root);let calls=0;
 const check=createReleaseChecker({fetchImpl:async(url,options)=>{calls++;assert.equal(url,LATEST_RELEASE_API);assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);assert.equal(options.headers.Authorization,undefined);return ok(release());}});
 const status=await check(root);assert.equal(status.version,'0.4.35');assert.equal(status.latest,'0.4.36');assert.equal(status.available,true);assert.equal(status.applyRequiresGit,false);assert.equal(status.downloadUrl,release().assets[0].browser_download_url);assert.deepEqual(await readdir(root),before);assert.equal(await readFile(path.join(root,'.runtime','state.json'),'utf8'),'private-journal');assert.equal(calls,1);
}));
test('release versions compare numerically and never offer a downgrade',()=>fixture(async root=>{
 const check=createReleaseChecker({fetchImpl:async()=>ok(release('0.4.10'))});
 for(const [version,available,ahead]of [['0.4.9',true,false],['0.4.10',false,false],['0.4.10-beta.1',true,false],['0.4.10+build.1',false,false],['0.4.11',false,true],['0.5.0',false,true]]){
  await writeFile(path.join(root,'package.json'),JSON.stringify({name:'binance-tradingbot-ko',version}));const status=await check(root);assert.equal(status.available,available,version);assert.equal(status.ahead,ahead,version);
 }
}));
test('concurrent checks share one request, expire their cache and reread the installed version',()=>fixture(async root=>{
 let calls=0,time=1000,finish;const check=createReleaseChecker({now:()=>time,cacheMs:100,fetchImpl:async()=>{calls++;if(calls===1)await new Promise(resolve=>{finish=resolve;});return ok(release());}});
 const a=check(root),b=check(root);while(!finish)await new Promise(resolve=>setImmediate(resolve));finish();assert.equal((await a).available,true);await b;assert.equal(calls,1);
 await writeFile(path.join(root,'package.json'),JSON.stringify({name:'binance-tradingbot-ko',version:'0.4.36'}));assert.equal((await check(root)).available,false);assert.equal(calls,1);time+=101;await check(root);assert.equal(calls,2);
}));
test('failed requests can be retried and cannot masquerade as up to date',()=>fixture(async root=>{
 let calls=0;const check=createReleaseChecker({fetchImpl:async()=>{calls++;if(calls===1)throw Error('offline');return ok(release());}});
 await assert.rejects(()=>check(root),/인터넷 연결/);assert.equal((await check(root)).available,true);assert.equal(calls,2);
 for(const [status,message]of [[404,/공개된 릴리즈/],[403,/조회 한도/],[429,/조회 한도/],[500,/HTTP 500/]])await assert.rejects(()=>createReleaseChecker({fetchImpl:async()=>({ok:false,status})})(root),message);
 const timeout=createReleaseChecker({timeoutMs:5,fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture hung')),200);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});})});await assert.rejects(()=>timeout(root),/인터넷 연결/);
}));
test('only official stable release assets become download links',()=>fixture(async root=>{
 for(const data of [{...release(),tag_name:'v../bad'},{...release(),prerelease:true},{...release(),draft:true}])await assert.rejects(()=>createReleaseChecker({fetchImpl:async()=>ok(data)})(root),/릴리즈/);
 for(const assets of [[],[{name:'binance-tradingbot-ko-v0.4.36-windows.zip',browser_download_url:'https://example.invalid/unsafe.zip'}]]){
  const result=await createReleaseChecker({fetchImpl:async()=>ok({...release(),assets})})(root);assert.equal(result.downloadUrl,null);assert.equal(result.releaseUrl,RELEASES_URL+'/tag/v0.4.36');
 }
 await assert.rejects(()=>createReleaseChecker({fetchImpl:async()=>({ok:true,json:async()=>{throw Error('bad JSON');}})})(root),/응답/);
}));
test('CLI check-only delegates to HTTPS and does not acquire update locks or bootstrap Git',()=>fixture(async root=>{
 const lines=[],checkRelease=createReleaseChecker({fetchImpl:async()=>ok(release())});
 const status=await updateApplication(root,{checkOnly:true,checkRelease,onProgress:line=>lines.push(line)});
 assert.equal(status.available,true);assert.match(lines.join('\n'),/0\.4\.36/);assert.match(lines.join('\n'),/Git 불필요/);assert.deepEqual((await readdir(root)).sort(),['package.json']);
}));
