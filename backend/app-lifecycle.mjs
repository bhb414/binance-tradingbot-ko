import {mkdir,open,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
export function processAlive(pid){if(!Number.isInteger(pid)||pid<=0)return true;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
export async function lockActive(filename,{alive=processAlive}={}){
  try{const value=JSON.parse(await readFile(filename,'utf8'));if(!Number.isInteger(value.pid)||value.pid<1)throw Error('잠금 파일 형식 확인 필요');if(alive(value.pid))return true;await unlink(filename);return false;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
export async function acquireLock(filename,{alive=processAlive}={}){
  await mkdir(path.dirname(filename),{recursive:true});
  for(let attempt=0;attempt<2;attempt++){
    let file;try{file=await open(filename,'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;if(await lockActive(filename,{alive}))throw Error('프로그램 또는 업데이트가 이미 실행 중입니다. 먼저 종료해 주세요.');continue;}
    const value={pid:process.pid,createdAt:Date.now()};await file.writeFile(JSON.stringify(value));await file.close();
    let released=false;return async()=>{if(released)return;released=true;try{const current=JSON.parse(await readFile(filename,'utf8'));if(current.pid===value.pid&&current.createdAt===value.createdAt)await unlink(filename);}catch(error){if(error.code!=='ENOENT')throw error;}};
  }
  throw Error('프로그램 잠금을 확보하지 못했습니다.');
}
export async function serverAt(port){
  if(!(Number(port)>0))return false;
  try{const response=await fetch('http://127.0.0.1:'+Number(port)+'/health',{signal:AbortSignal.timeout(1500)});return response.ok&&(await response.json()).ok===true;}catch{return false;}
}
export async function acquireServerLock(root,dataDirectory,port){
  if(await serverAt(port))throw Error('이미 실행 중입니다. 브라우저에서 http://127.0.0.1:'+port+' 을 열어 주세요.');
  const release=await acquireLock(path.join(dataDirectory,'server.lock'));
  try{if(await lockActive(path.join(root,'.runtime','update.lock')))throw Error('업데이트 중입니다. 완료 후 실행해 주세요.');try{await readFile(path.join(root,'.runtime','source-update.json'));throw Error('중단된 업데이트가 있습니다. update.cmd를 실행해 복구한 뒤 시작해 주세요.');}catch(error){if(error.code!=='ENOENT')throw error;}return release;}catch(error){await release();throw error;}
}
