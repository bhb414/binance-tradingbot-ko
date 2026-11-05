import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {acquireLock,lockActive,serverAt} from './app-lifecycle.mjs';
import {checkReleaseUpdate} from './release-update.mjs';
import {downloadReleasePackage,validReleasePath} from './release-package.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
const contentSame=(a,b)=>{if(a.equals(b))return true;const x=a.toString('utf8'),y=b.toString('utf8');return !a.includes(0)&&!b.includes(0)&&Buffer.from(x).equals(a)&&Buffer.from(y).equals(b)&&x.replace(/\r\n/g,'\n')===y.replace(/\r\n/g,'\n');};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function atomicWrite(filename,data){
 await fs.mkdir(path.dirname(filename),{recursive:true});const temp=filename+'.update-'+randomUUID()+'.tmp';let handle;
 try{handle=await fs.open(temp,'wx',0o600);await handle.writeFile(data);await handle.sync();await handle.close();handle=null;for(let i=0;;i++){try{await fs.rename(temp,filename);break;}catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||i===3)throw error;await delay([50,150,350][i]);}}}
 finally{if(handle)await handle.close().catch(()=>{});await fs.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function sourceFile(root,file){
 if(!validReleasePath(file))throw Error('업데이트 경로를 사용할 수 없습니다: '+file);
 const parts=file.split('/');let current=root;
 for(let i=0;i<parts.length;i++){
  current=path.resolve(current,parts[i]);if(!current.startsWith(root+path.sep))throw Error('업데이트 대상 폴더를 벗어났습니다.');
  try{const info=await fs.lstat(current);if(info.isSymbolicLink()||(i<parts.length-1?!info.isDirectory():!info.isFile()))throw Error('파일·폴더 링크 또는 경로 충돌을 확인해 주세요: '+file);}
  catch(error){if(error.code==='ENOENT')return {filename:path.resolve(root,...parts),data:null};throw error;}
 }
 return {filename:current,data:await fs.readFile(current)};
}
async function stopped(root,dataDirectory,port){
 if(await lockActive(path.join(dataDirectory,'server.lock'))||await serverAt(port))throw Error('프로그램이 실행 중입니다. run.cmd 실행 창을 종료한 뒤 update.cmd를 다시 실행해 주세요. 봇·보호 주문은 임의로 중지하지 않습니다.');
}
export async function validateReleaseCandidate(candidate,files){
 const scripts=[...files.keys()].filter(name=>/\.(?:mjs|js)$/.test(name)&&!name.startsWith('tests/')&&!name.startsWith('public/vendor/'));
 const command="import {spawnSync} from 'node:child_process';try{for(const name of JSON.parse(process.argv[1])){const r=spawnSync(process.execPath,['--check',name],{cwd:process.cwd(),windowsHide:true,encoding:'utf8'});if(r.error||r.status!==0)throw Error('새 버전 문법 검증 실패: '+name+' '+(r.stderr||r.error?.message||''));}const app=await import('./server.mjs');if(typeof app.createServer!=='function')throw Error('서버 모듈을 확인하지 못했습니다.');}catch(error){console.error(error.message);process.exitCode=1;}";
 const env={...process.env,WORKROOM_DATA_DIR:path.join(candidate,'.runtime')};delete env.NODE_TEST_CONTEXT;delete env.BINANCE_API_KEY;delete env.BINANCE_SECRET;
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',command,JSON.stringify(scripts)],{cwd:candidate,env,windowsHide:true,timeout:120000,stdio:['ignore','pipe','pipe']});child.stdout.resume();let error='';child.stderr.on('data',data=>{if(error.length<16000)error+=data.toString();});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('새 버전 검증 실패 · 기존 버전을 유지합니다. '+error.slice(0,300))));});
}
async function loadTransaction(root,dataDirectory){
 const filename=path.join(root,'.runtime','source-update.json');let value;try{value=JSON.parse(await fs.readFile(filename,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw Error('업데이트 복구 정보를 확인하지 못했습니다. 백업 파일을 보존했습니다.');}
 if(value.root!==root||value.dataDirectory!==dataDirectory||!/^\d{13}-[a-f0-9-]{36}$/.test(value.id)||typeof value.committed!=='boolean'||!Array.isArray(value.files)||!value.files.length||value.files.length>10000)throw Error('업데이트 복구 경로를 확인해 주세요. 기존 데이터 저장 경로를 사용해야 합니다.');
 const names=new Set();for(const item of value.files){if(!validReleasePath(item.file)||names.has(item.file.toLowerCase())||![item.before,item.after].every(v=>v===null||/^[a-f0-9]{64}$/.test(v)))throw Error('업데이트 복구 파일 목록을 확인하지 못했습니다.');names.add(item.file.toLowerCase());}
 return value;
}
export async function recoverSourceUpdate(root,dataDirectory,{onProgress=console.log}={}){
 const transaction=await loadTransaction(root,dataDirectory);if(!transaction)return false;
 const backup=path.join(dataDirectory,'backups','source-update-'+transaction.id,'source'),plan=[];
 for(const item of transaction.files){
  const current=await sourceFile(root,item.file),digest=current.data?hash(current.data):null;
  if(transaction.committed){if(digest!==item.after)throw Error('업데이트 완료 후 파일이 변경되었습니다: '+item.file);continue;}
  if(digest!==item.before&&digest!==item.after)throw Error('업데이트 중 파일이 변경되어 자동 복구하지 않았습니다: '+item.file+'. 백업을 보존했습니다.');
  let data=null;if(item.before!==null){const saved=await sourceFile(backup,item.file);data=saved.data;if(!data||hash(data)!==item.before)throw Error('업데이트 원본 백업을 확인하지 못했습니다: '+item.file);}
  plan.push({...current,data});
 }
 if(!transaction.committed){onProgress('중단된 업데이트를 복구합니다…');for(const item of plan.reverse()){if(item.data===null)await fs.unlink(item.filename).catch(error=>{if(error.code!=='ENOENT')throw error;});else await atomicWrite(item.filename,item.data);}}
 await fs.unlink(path.join(root,'.runtime','source-update.json'));return true;
}
export async function updateReleaseApplication(installation,{checkRelease=checkReleaseUpdate,fetchImpl=globalThis.fetch,dataDirectory=process.env.WORKROOM_DATA_DIR||path.join(installation,'.runtime'),port=process.env.PORT||8896,onProgress=console.log,validateCandidate=validateReleaseCandidate,afterFile=null}={}){
 const root=await fs.realpath(installation);dataDirectory=path.resolve(dataDirectory);
 const unlock=await acquireLock(path.join(root,'.runtime','update.lock'));let stage=null;
 try{
  await stopped(root,dataDirectory,port);await recoverSourceUpdate(root,dataDirectory,{onProgress});
  const localPackage=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));if(localPackage.name!=='binance-tradingbot-ko')throw Error('앱 설치 폴더를 확인해 주세요.');
  onProgress('공식 릴리즈를 확인합니다… (Git 불필요)');const status=await checkRelease(root);
  if(!status.available){onProgress(status.ahead?'설치 버전이 정식 릴리즈보다 앞서 있습니다. 기존 버전을 유지합니다.':'이미 최신 정식 릴리즈입니다.');return {updated:false,version:localPackage.version,ahead:status.ahead||false,method:'release'};}
  if(!status.downloadUrl)throw Error('정식 Windows ZIP이 아직 준비되지 않았습니다. 잠시 후 다시 확인해 주세요.');
  onProgress('새 버전 ZIP과 체크섬을 내려받습니다…');const target=await downloadReleasePackage(status.latest,{fetchImpl});
  onProgress('현재 설치 파일을 원본 배포본과 대조합니다…');const baseline=await downloadReleasePackage(localPackage.version,{fetchImpl});
  const paths=new Map();for(const file of [...baseline.files.keys(),...target.files.keys()]){const key=file.toLowerCase();if(paths.has(key)&&paths.get(key)!==file)throw Error('대소문자만 다른 배포 경로를 확인해 주세요: '+file);paths.set(key,file);}
  const originals=new Map();for(const [file,data]of baseline.files){const current=await sourceFile(root,file);if(!current.data||!contentSame(current.data,data))throw Error('로컬 소스가 변경되었거나 누락되었습니다: '+file+'. 자동으로 덮어쓰지 않습니다.');originals.set(file,current.data);}
  for(const file of target.files.keys())if(!baseline.files.has(file)){const current=await sourceFile(root,file);if(current.data!==null)throw Error('추가된 배포 파일이 기존 로컬 파일과 충돌합니다: '+file);}
  stage=await fs.mkdtemp(path.join(os.tmpdir(),'binance-workroom-release-'));const candidate=path.join(stage,'candidate');
  for(const [file,data]of target.files){const filename=path.resolve(candidate,...file.split('/'));if(!filename.startsWith(candidate+path.sep))throw Error('검증 파일 경로 확인 실패');await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,data,{flag:'wx'});}
  onProgress('별도 임시 폴더에서 새 버전을 검증합니다…');await validateCandidate(candidate,target.files);
  await stopped(root,dataDirectory,port);
  const names=[...new Set([...baseline.files.keys(),...target.files.keys()])],changes=[];
  for(const file of names){const current=await sourceFile(root,file),old=originals.get(file)||null;if((current.data?hash(current.data):null)!==(old?hash(old):null))throw Error('검증 중 파일이 변경되었습니다: '+file);const next=target.files.get(file)||null;if(!old||!next||!old.equals(next))changes.push({file,before:old?hash(old):null,after:next?hash(next):null});}
  if(!changes.length)return {updated:false,version:localPackage.version,method:'release'};
  const id=Date.now()+'-'+randomUUID(),backup=path.join(dataDirectory,'backups','source-update-'+id),marker=path.join(root,'.runtime','source-update.json');
  await fs.mkdir(backup,{recursive:true});
  for(const item of changes)if(item.before!==null){const filename=path.resolve(backup,'source',...item.file.split('/'));if(!filename.startsWith(backup+path.sep+'source'+path.sep))throw Error('백업 경로 확인 실패');await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,originals.get(item.file),{flag:'wx'});}
  try{await fs.copyFile(path.join(dataDirectory,'state.json'),path.join(backup,'state.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const transaction={id,root,dataDirectory,committed:false,version:target.version,previous:localPackage.version,files:changes};await atomicWrite(marker,JSON.stringify(transaction));
  try{
   // Install the startup recovery guard first and the version number last.
   changes.sort((a,b)=>(a.file==='backend/app-lifecycle.mjs'?-1:a.file==='package.json'?1:0)-(b.file==='backend/app-lifecycle.mjs'?-1:b.file==='package.json'?1:0));
   for(let i=0;i<changes.length;i++){const item=changes[i],current=await sourceFile(root,item.file);if((current.data?hash(current.data):null)!==item.before)throw Error('교체 중 파일이 변경되었습니다: '+item.file);if(item.after===null)await fs.unlink(current.filename);else await atomicWrite(current.filename,target.files.get(item.file));await afterFile?.(item.file,i);}
   for(const item of changes){const current=await sourceFile(root,item.file);if((current.data?hash(current.data):null)!==item.after)throw Error('교체 결과 검증 실패: '+item.file);}
   transaction.committed=true;await atomicWrite(marker,JSON.stringify(transaction));await fs.unlink(marker);
  }catch(error){try{await recoverSourceUpdate(root,dataDirectory,{onProgress});}catch(recovery){throw Error(error.message+' 자동 복구를 마치지 못했습니다: '+recovery.message+' · update.cmd를 다시 실행해 주세요.');}throw Error(error.message+' · 기존 버전으로 복구했습니다.');}
  onProgress('업데이트 완료: v'+target.version+'. run.cmd로 실행해 주세요. 저장 키·봇 설정·매매 기록은 유지됩니다.');return {updated:true,version:target.version,previous:localPackage.version,method:'release',backup};
 }finally{
  try{if(stage){const safe=path.resolve(stage),base=path.resolve(os.tmpdir())+path.sep;if(!safe.startsWith(base)||!path.basename(safe).startsWith('binance-workroom-release-'))throw Error('임시 폴더 경로 확인 실패');await fs.rm(safe,{recursive:true,force:true,maxRetries:3});}}
  finally{await unlock();}
 }
}
