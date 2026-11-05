import test from 'node:test';import assert from 'node:assert/strict';
import {readSourceZip,validReleasePath,downloadReleasePackage,packageName,RELEASE_PREFIX} from '../backend/release-package.mjs';
import {zipFiles,sources,releaseFetch,digest} from './helpers/release-fixture.mjs';
test('release ZIP reader validates stored and deflated files, CRC and paths',()=>{
 const files=sources('1.0.0',{'public/한글.js':'// 한글\n'});for(const method of [0,8])assert.deepEqual(readSourceZip(zipFiles([...files],{method})),files);
 const bad=zipFiles([...files]);bad[32]^=1;assert.throws(()=>readSourceZip(bad),/ZIP/);
 const corrupted=zipFiles([['file','x']],{method:0});corrupted[30+Buffer.byteLength('binance-tradingbot-ko/file')]^=1;assert.throws(()=>readSourceZip(corrupted),/무결성/);
 assert.throws(()=>readSourceZip(Buffer.alloc(22)),/ZIP/);assert.throws(()=>readSourceZip(zipFiles([...files]),{maxFiles:1}),/구조/);
 assert.throws(()=>readSourceZip(zipFiles([['big','a'.repeat(10000)]]),{maxEntry:100}),/크기/);
 assert.throws(()=>readSourceZip(zipFiles([['a','abc'],['b','abc']]),{maxBytes:5}),/크기/);
});
test('ZIP rejects Windows aliases, private files, traversal, symlinks and case collisions',()=>{
 for(const name of ['../evil','x/../../evil','/absolute','C:/evil','x\\evil','.GIT/config','.git/config','.runtime/state.json','.env','a/.env.local','secret.key','dist/file','NUL.txt','a/COM1','a/space.','a/trailing ','a/file:stream','a//b']){
  assert.equal(validReleasePath(name),false,name);assert.throws(()=>readSourceZip(zipFiles([[name,'bad']])),undefined,name);
 }
 assert.throws(()=>readSourceZip(zipFiles([{name:'binance-tradingbot-ko/link',data:'target',mode:0xa1ff}])),/링크/);
 assert.throws(()=>readSourceZip(zipFiles([['A','a'],['a','b']])),/중복/);
 assert.throws(()=>readSourceZip(zipFiles([['a','x'],['a/b','y']])),/충돌/);
 assert.throws(()=>readSourceZip(zipFiles([{name:'other/file',data:'x'}])),/공식 배포/);
});
test('official downloads require matching checksum, package identity and all required files',async()=>{
 const files=sources('1.0.0'),zip=zipFiles([...files]),fetchImpl=releaseFetch(new Map([['1.0.0',zip]]));
 const result=await downloadReleasePackage('1.0.0',{fetchImpl});assert.deepEqual(result.files,files);assert.equal(result.sha256,digest(zip));
 await assert.rejects(()=>downloadReleasePackage('1.0.0',{fetchImpl:async()=>new Response('0'.repeat(64)+'  '+packageName('1.0.0')+'\n')}),/체크섬이 다릅니다/);
 await assert.rejects(()=>downloadReleasePackage('1.0.0',{fetchImpl:async()=>new Response('bad')}),/체크섬/);
 await assert.rejects(()=>downloadReleasePackage('1.0.0',{fetchImpl:async()=>{throw Error('offline');}}),/인터넷/);
 await assert.rejects(()=>downloadReleasePackage('1.0.0',{fetchImpl:async()=>new Response('',{status:404})}),/HTTP 404/);
 for(const edit of [f=>f.delete('run.cmd'),f=>f.set('package.json',Buffer.from(JSON.stringify({name:'other',version:'1.0.0',type:'module'}))),f=>f.set('package.json',Buffer.from(JSON.stringify({name:'binance-tradingbot-ko',version:'1.0.0',type:'module',dependencies:{unsafe:'*'}})))]){
  const invalid=new Map(files);edit(invalid);await assert.rejects(()=>downloadReleasePackage('1.0.0',{fetchImpl:releaseFetch(new Map([['1.0.0',zipFiles([...invalid])]]))}),/필수 파일|정보|추가 설치/);
 }
 assert.throws(()=>packageName('../bad'),/버전/);
});
test('release downloads bound size and refuse redirects away from HTTPS GitHub assets',async()=>{
 const zip=zipFiles([...sources('1.0.0')]),fetchImpl=releaseFetch(new Map([['1.0.0',zip]]));
 await assert.rejects(()=>downloadReleasePackage('1.0.0',{fetchImpl,maxDownload:10}),/크기/);
 for(const location of ['http://github.com/file','https://example.invalid/file','https://user:pass@github.com/file','https://github.com:444/file'])await assert.rejects(()=>downloadReleasePackage('1.0.0',{fetchImpl:async()=>new Response(null,{status:302,headers:{location}})}),/공식 GitHub/);
 let redirects=0;await assert.rejects(()=>downloadReleasePackage('1.0.0',{fetchImpl:async()=>{redirects++;return new Response(null,{status:302,headers:{location:RELEASE_PREFIX+'loop'}});}}),/이동 횟수/);assert.equal(redirects,6);
});
