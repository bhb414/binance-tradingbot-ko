import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,access,realpath} from 'node:fs/promises';
import path from 'node:path';
const exec=promisify(execFile);
export const REPOSITORY='https://github.com/bhb414/binance-tradingbot-ko.git';
export const BRANCH='main';
export const normalizeRemote=value=>String(value||'').trim().replace(/\/$/,'').replace(/\.git$/,'').toLowerCase();
export async function git(root,args,options={}){try{return (await exec('git',args,{cwd:root,windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'},...options})).stdout.trim();}catch(error){if(error.code==='ENOENT')throw Error('업데이트에는 Git for Windows가 필요합니다. 설치 후 다시 실행해 주세요.');throw error;}}
export async function repositoryInfo(root){
  const top=await git(root,['rev-parse','--show-toplevel']);if((await realpath(top)).toLowerCase()!==(await realpath(root)).toLowerCase())throw Error('앱 전용 Git 저장소가 아닙니다. 지정 저장소에서 설치해 주세요.');
  const remote=await git(root,['config','--get','remote.origin.url']);if(normalizeRemote(remote)!==normalizeRemote(REPOSITORY))throw Error('업데이트 저장소 주소가 지정된 GitHub 주소와 다릅니다.');
  return {revision:await git(root,['rev-parse','HEAD']),branch:await git(root,['branch','--show-current'])};
}
export async function checkUpdate(root,{gitImpl=git}={}){
 const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));let hasGit;
 try{await access(path.join(root,'.git'));hasGit=true;}catch(error){if(error.code!=='ENOENT')throw error;hasGit=false;}
 if(!hasGit){
  if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))throw Error('설치 버전 형식을 확인해 주세요.');
  const tag='refs/tags/v'+version,refs=(await gitImpl(root,['ls-remote',REPOSITORY,'refs/heads/'+BRANCH,tag,tag+'^{}'])).split('\n').map(row=>row.split(/\s/)),latest=refs.find(row=>row[1]==='refs/heads/'+BRANCH)?.[0],revision=refs.find(row=>row[1]===tag+'^{}')?.[0]||refs.find(row=>row[1]===tag)?.[0];
  if(!latest||!/^[a-f0-9]{40,64}$/.test(latest))throw Error('GitHub의 main 브랜치를 확인하지 못했습니다.');
  if(!revision)return {version,revision:null,branch:BRANCH,latest:latest.slice(0,7),available:null,requiresVerification:true,installation:'zip',repository:REPOSITORY,command:'update.cmd'};
  return {version,revision:revision.slice(0,7),branch:BRANCH,latest:latest.slice(0,7),available:revision!==latest,installation:'zip',repository:REPOSITORY,command:'update.cmd'};
 }
 const local=await repositoryInfo(root),output=await git(root,['ls-remote','origin','refs/heads/'+BRANCH]),latest=output.split(/\s/)[0];
 if(!/^[a-f0-9]{40,64}$/.test(latest))throw Error('GitHub의 main 브랜치를 확인하지 못했습니다.');
 return {version,revision:local.revision.slice(0,7),branch:local.branch,latest:latest.slice(0,7),available:latest!==local.revision,installation:'git',repository:REPOSITORY,command:'update.cmd'};
}
