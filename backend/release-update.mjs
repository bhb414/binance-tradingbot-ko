import {readFile} from 'node:fs/promises';
import path from 'node:path';

export const RELEASES_URL='https://github.com/bhb414/binance-tradingbot-ko/releases';
export const LATEST_RELEASE_API='https://api.github.com/repos/bhb414/binance-tradingbot-ko/releases/latest';
const stable=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function parseVersion(value,{local=false}={}){
 const text=String(value||''),match=(local?/^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/:stable).exec(text);
 if(!match)throw Error(local?'설치 버전 형식을 확인해 주세요.':'GitHub 릴리즈 버전을 확인하지 못했습니다.');
 const parts=(local?match[1]:text).split('.').map(Number);
 if(!parts.every(Number.isSafeInteger))throw Error('프로그램 버전 형식을 확인해 주세요.');
 return {parts,prerelease:local&&Boolean(match[2])};
}
function compareStableToLocal(latest,current){
 const a=parseVersion(latest),b=parseVersion(current,{local:true});
 for(let i=0;i<3;i++){if(a.parts[i]!==b.parts[i])return a.parts[i]>b.parts[i]?1:-1;}
 return b.prerelease?1:0;
}
export function createReleaseChecker({fetchImpl=globalThis.fetch,now=Date.now,cacheMs=300000,timeoutMs=10000}={}){
 let cached=null,pending=null;
 async function load(){
  if(cached&&now()-cached.checkedAt<cacheMs)return cached;
  if(pending)return pending;
  pending=(async()=>{
   let response;
   try{response=await fetchImpl(LATEST_RELEASE_API,{headers:{Accept:'application/vnd.github+json','User-Agent':'binance-tradingbot-ko-update-check'},signal:AbortSignal.timeout(timeoutMs),redirect:'error'});}
   catch{throw Error('GitHub에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');}
   if(!response.ok){
    if(response.status===404)throw Error('공개된 릴리즈가 없습니다. GitHub 릴리즈 페이지를 확인해 주세요.');
    if([403,429].includes(response.status))throw Error('GitHub 조회 한도에 도달했습니다. 잠시 후 다시 확인해 주세요.');
    throw Error('GitHub 릴리즈를 조회하지 못했습니다 (HTTP '+response.status+').');
   }
   let release;try{release=await response.json();}catch{throw Error('GitHub 릴리즈 응답을 확인하지 못했습니다.');}
   const latest=typeof release.tag_name==='string'&&release.tag_name.startsWith('v')?release.tag_name.slice(1):'';
   parseVersion(latest);
   if(release.draft||release.prerelease)throw Error('정식 공개 릴리즈를 확인하지 못했습니다.');
   const releaseUrl=RELEASES_URL+'/tag/v'+latest,expected=RELEASES_URL+'/download/v'+latest+'/binance-tradingbot-ko-v'+latest+'-windows.zip';
   const downloadUrl=Array.isArray(release.assets)&&release.assets.some(asset=>asset.name==='binance-tradingbot-ko-v'+latest+'-windows.zip'&&asset.browser_download_url===expected)?expected:null;
   cached={latest,releaseUrl,downloadUrl,checkedAt:now()};return cached;
  })();
  try{return await pending;}finally{pending=null;}
 }
 return async function checkReleaseUpdate(root){
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  if(pkg.name!=='binance-tradingbot-ko')throw Error('앱 설치 폴더를 확인해 주세요.');
  parseVersion(pkg.version,{local:true});
  const remote=await load(),comparison=compareStableToLocal(remote.latest,pkg.version);
  return {version:pkg.version,...remote,available:comparison>0,ahead:comparison<0,source:'github-release',applyRequiresGit:false,command:'update.cmd'};
 };
}
export const checkReleaseUpdate=createReleaseChecker();
