import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const exec=promisify(execFile);
export const REPOSITORY='https://github.com/bhb414/binance-tradingbot-ko.git';
export const BRANCH='main';
export const normalizeRemote=value=>String(value||'').trim().replace(/\/$/,'').replace(/\.git$/,'').toLowerCase();
export async function git(root,args,options={}){return (await exec('git',args,{cwd:root,windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'},...options})).stdout.trim();}
export async function repositoryInfo(root){
  const top=await git(root,['rev-parse','--show-toplevel']);if(path.resolve(top).toLowerCase()!==path.resolve(root).toLowerCase())throw Error('앱 전용 Git 저장소가 아닙니다. 지정 저장소에서 설치해 주세요.');
  const remote=await git(root,['config','--get','remote.origin.url']);if(normalizeRemote(remote)!==normalizeRemote(REPOSITORY))throw Error('업데이트 저장소 주소가 지정된 GitHub 주소와 다릅니다.');
  return {revision:await git(root,['rev-parse','HEAD']),branch:await git(root,['branch','--show-current'])};
}
export async function checkUpdate(root){
  const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const local=await repositoryInfo(root),output=await git(root,['ls-remote','origin','refs/heads/'+BRANCH]),latest=output.split(/\s/)[0];
  if(!/^[a-f0-9]{40,64}$/.test(latest))throw Error('GitHub의 main 브랜치를 확인하지 못했습니다.');
  return {version,revision:local.revision.slice(0,7),branch:local.branch,latest:latest.slice(0,7),available:latest!==local.revision,repository:REPOSITORY,command:'update.cmd'};
}
