import {mkdtemp,readdir,readFile,mkdir,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {git,repositoryInfo,checkUpdate,BRANCH} from '../backend/app-update.mjs';
import {acquireLock,lockActive,serverAt} from '../backend/app-lifecycle.mjs';
export function validateUpdate({branch,dirty,protectedPaths}){
  if(branch!==BRANCH)throw Error('main 브랜치에서만 업데이트할 수 있습니다. 현재 브랜치를 먼저 확인해 주세요.');
  if(dirty)throw Error('로컬 소스 변경이 있습니다. 변경을 커밋하거나 별도로 보관한 뒤 다시 실행해 주세요. 자동으로 덮어쓰지 않습니다.');
  if(protectedPaths.length)throw Error('저장 키·실행 기록·환경 파일이 Git 추적 대상에 포함되어 업데이트를 중단했습니다.');
}
async function runNode(cwd,args){
  const env={...process.env,WORKROOM_DATA_DIR:path.join(cwd,'.runtime')};delete env.NODE_TEST_CONTEXT;
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd,env,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('새 버전 검증 실패 · 현재 버전을 유지합니다.')));});
}
async function ensureStopped(root,dataDirectory,port){
  if(await lockActive(path.join(dataDirectory,'server.lock'))||await serverAt(port))throw Error('프로그램이 실행 중입니다. run.cmd 실행 창을 종료한 뒤 update.cmd를 다시 실행해 주세요. 봇·보호 주문은 임의로 중지하지 않습니다.');
}
export async function updateApplication(root,{checkOnly=false,dataDirectory=process.env.WORKROOM_DATA_DIR||path.join(root,'.runtime'),port=process.env.PORT||8896,onProgress=console.log}={}){
  if(checkOnly){const status=await checkUpdate(root);onProgress('현재 '+status.version+' ('+status.revision+') · GitHub '+status.latest+' · '+(status.available?'새 버전 있음':'최신 버전'));return status;}
  const release=await acquireLock(path.join(root,'.runtime','update.lock'));let stage=null;
  try{
    await ensureStopped(root,dataDirectory,port);
    const local=await repositoryInfo(root),dirty=await git(root,['status','--porcelain','--untracked-files=normal']),tracked=(await git(root,['ls-files','-z'])).split('\0');
    validateUpdate({...local,dirty,protectedPaths:tracked.filter(file=>/^\.runtime\/|(?:^|\/)\.env(?:\.|$)|\.(?:dpapi|pem|key)$/.test(file))});
    onProgress('GitHub에서 업데이트를 확인합니다…');await git(root,['fetch','origin',BRANCH]);
    const target=await git(root,['rev-parse','refs/remotes/origin/'+BRANCH]);if(target===local.revision){onProgress('이미 최신 버전입니다.');return {updated:false,revision:local.revision};}
    const incoming=(await git(root,['ls-tree','-r','--name-only',target])).split('\n');validateUpdate({branch:BRANCH,dirty:'',protectedPaths:incoming.filter(file=>/^\.runtime\/|(?:^|\/)\.env(?:\.|$)|\.(?:dpapi|pem|key)$/.test(file))});
    try{await git(root,['merge-base','--is-ancestor',local.revision,target]);}catch{throw Error('로컬과 GitHub 기록이 갈라져 자동 업데이트할 수 없습니다. 현재 파일을 유지합니다.');}
    stage=await mkdtemp(path.join(os.tmpdir(),'binance-workroom-update-'));const candidate=path.join(stage,'candidate');
    await git(root,['clone','--quiet','--no-hardlinks','--no-checkout',root,candidate]);await git(candidate,['checkout','--quiet','--detach',target]);
    const pkg=JSON.parse(await readFile(path.join(candidate,'package.json'),'utf8'));if(Object.keys(pkg.dependencies||{}).length||Object.keys(pkg.devDependencies||{}).length)throw Error('새 버전에 추가 설치 항목이 있습니다. 설치 안내를 확인해 주세요. 현재 버전을 유지합니다.');
    const tests=(await readdir(path.join(candidate,'tests'))).filter(file=>file.endsWith('.test.mjs')).map(file=>path.join('tests',file));if(!tests.length)throw Error('새 버전의 검증 파일을 확인하지 못했습니다.');
    onProgress('별도 임시 폴더에서 새 버전을 검증합니다…');await runNode(candidate,['--check','server.mjs']);await runNode(candidate,['--test',...tests]);
    await ensureStopped(root,dataDirectory,port);
    if(await git(root,['rev-parse','HEAD'])!==local.revision||await git(root,['status','--porcelain','--untracked-files=normal']))throw Error('검증 중 로컬 파일이 바뀌었습니다. 다시 업데이트해 주세요.');
    // Keep the current trading journal local and opaque; credentials are never read or changed.
    const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backups=path.join(dataDirectory,'backups');await mkdir(backups,{recursive:true});
    try{await copyFile(path.join(dataDirectory,'state.json'),path.join(backups,'state-before-update-'+stamp+'.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    await git(root,['update-ref','refs/workroom-backups/'+stamp,local.revision]);await git(root,['merge','--ff-only',target]);
    onProgress('업데이트 완료: '+pkg.version+' ('+target.slice(0,7)+'). run.cmd로 실행해 주세요. 저장 키·봇 설정·매매 기록은 유지됩니다.');return {updated:true,revision:target,previous:local.revision};
  }finally{
    try{if(stage){const safe=path.resolve(stage),base=path.resolve(os.tmpdir())+path.sep;if(!safe.startsWith(base)||!path.basename(safe).startsWith('binance-workroom-update-'))throw Error('임시 폴더 경로 확인 실패');await rm(safe,{recursive:true,force:true,maxRetries:3});}}
    finally{await release();}
  }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const root=fileURLToPath(new URL('../',import.meta.url));try{await updateApplication(root,{checkOnly:process.argv.includes('--check')});}catch(error){console.error('업데이트 중단: '+(error.message||'실패'));process.exitCode=1;}
}
