import {access,readFile,lstat,cp,rename,rm,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {git,REPOSITORY,BRANCH} from './app-update.mjs';

export const protectedSourcePath=file=>/^(?:\.runtime|\.migration-backup|previews|asset-sources|node_modules|dist)\/|(?:^|\/)\.env(?:\.|$)|\.(?:dpapi|pem|key)$/i.test(file);
export const safeSourcePath=file=>typeof file==='string'&&!path.isAbsolute(file)&&!/[\\:\0]/.test(file)&&file.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part!=='.git');
export const exists=async file=>{try{await access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
export function versionTag(version){if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))throw Error('설치 버전 형식을 확인할 수 없습니다.');return 'v'+version;}
const sameContent=(a,b)=>a.includes(0)||b.includes(0)?a.equals(b):a.toString('utf8').replace(/\r\n/g,'\n')===b.toString('utf8').replace(/\r\n/g,'\n');
export async function bootstrapRepository(root,{onProgress=console.log,gitImpl=git}={}){
 root=path.resolve(root);if(await exists(path.join(root,'.git')))return false;
 const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')),tag=versionTag(pkg.version);
 if(pkg.name!=='binance-tradingbot-ko')throw Error('공식 앱 패키지인지 확인해 주세요.');
 const stage=await mkdtemp(path.join(os.tmpdir(),'binance-workroom-bootstrap-')),candidate=path.join(stage,'candidate'),metadata=path.join(root,'.git-bootstrap-'+randomUUID());
 try{
  onProgress('ZIP 설치본을 확인하고 업데이트용 Git 기록을 준비합니다…');
  await gitImpl(root,['clone','--quiet','--no-checkout','--single-branch','--branch',BRANCH,REPOSITORY,candidate]);
  let revision;try{revision=await gitImpl(candidate,['rev-parse','refs/tags/'+tag+'^{commit}']);}catch{throw Error('설치 버전의 공개 태그를 찾지 못했습니다. GitHub Releases의 ZIP을 받아 주세요.');}
  await gitImpl(candidate,['merge-base','--is-ancestor',revision,'refs/remotes/origin/'+BRANCH]);
  await gitImpl(candidate,['config','core.autocrlf','input']);
  await gitImpl(candidate,['checkout','--quiet','--detach',revision]);
  const files=(await gitImpl(candidate,['ls-files','-z'])).split('\0').filter(Boolean);
  if(!files.length||files.some(file=>!safeSourcePath(file)||protectedSourcePath(file)))throw Error('배포본의 파일 목록을 확인할 수 없습니다.');
  for(const file of files){
   const local=path.join(root,file),original=path.join(candidate,file);let localInfo;
   try{localInfo=await lstat(local);}catch{throw Error('ZIP 설치 파일이 없거나 변경되었습니다: '+file);}
   if(!localInfo.isFile()||localInfo.isSymbolicLink()||!(await lstat(original)).isFile()||!sameContent(await readFile(local),await readFile(original)))throw Error('로컬 소스 변경이 있습니다: '+file+'. 현재 파일을 덮어쓰지 않습니다.');
  }
  await gitImpl(candidate,['symbolic-ref','HEAD','refs/heads/'+BRANCH]);await gitImpl(candidate,['reset','--mixed',revision]);
  await cp(path.join(candidate,'.git'),metadata,{recursive:true,errorOnExist:true,force:false});
  if(await exists(path.join(root,'.git')))throw Error('다른 작업이 Git 기록을 생성했습니다. 다시 업데이트해 주세요.');
  await rename(metadata,path.join(root,'.git'));
  // Refresh the copied index against this folder, including equivalent Windows line endings.
  await gitImpl(root,['diff','--exit-code']);
  onProgress('ZIP 설치본 확인 완료 · 키와 실행 기록은 변경하지 않았습니다.');return true;
 }finally{
  if(!metadata.startsWith(root+path.sep)||!path.basename(metadata).startsWith('.git-bootstrap-'))throw Error('Git 준비 경로 확인 실패');
  await rm(metadata,{recursive:true,force:true,maxRetries:3});
  const safe=path.resolve(stage);if(!safe.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(safe).startsWith('binance-workroom-bootstrap-'))throw Error('임시 경로 확인 실패');
  await rm(safe,{recursive:true,force:true,maxRetries:3});
 }
}
