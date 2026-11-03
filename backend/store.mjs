import * as fileSystem from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
export const emptyState=()=>({version:2,environment:'live',scope:null,orderPermission:null,nextIntent:1,bots:[],orders:[],fills:[],logs:[]});
const transient=new Set(['EPERM','EACCES','EBUSY','EAGAIN','ETIMEDOUT','EMFILE','ENFILE']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class StateStore{
 constructor(directory,{fs=fileSystem,delay=sleep,retryDelays=[50,150,350,750]}={}){
  this.directory=path.resolve(directory);this.filename=path.join(this.directory,'state.json');this.state=emptyState();this.tail=Promise.resolve();this.fs=fs;this.delay=delay;this.retryDelays=retryDelays;this.lastSerialized=null;
 }
 async load(){
  await this.fs.mkdir(this.directory,{recursive:true});
  try{const parsed=JSON.parse(await this.fs.readFile(this.filename,'utf8'));if(parsed.version!==2||!['testnet','live'].includes(parsed.environment)||!Array.isArray(parsed.bots)||!Array.isArray(parsed.orders)||!Array.isArray(parsed.fills)||!Array.isArray(parsed.logs))throw Error('저장된 실행 원장 형식을 확인해 주세요. 원본 파일은 보존했습니다.');this.state=parsed;}
  catch(error){if(error.code!=='ENOENT')throw error;}return this.state;
 }
 async save(){
  const serialized=JSON.stringify(this.state);
  const run=async()=>{
   for(let attempt=0;;attempt++){
    const temp=this.filename+'.'+process.pid+'.'+randomUUID()+'.tmp';let file;
    try{file=await this.fs.open(temp,'wx',0o600);await file.writeFile(serialized,'utf8');await file.sync();await file.close();file=null;await this.fs.rename(temp,this.filename);this.lastSerialized=serialized;return;}
    catch(error){error.storageAttempts=attempt+1;if(!transient.has(error.code)||attempt>=this.retryDelays.length)throw error;}
    finally{if(file)await file.close().catch(()=>{});await this.fs.unlink(temp).catch(()=>{});}
    await this.delay(this.retryDelays[attempt]);
   }
  };
  const result=this.tail.then(run,run);this.tail=result.catch(()=>{});return result;
 }
 async verify(){if(this.lastSerialized===null||await this.fs.readFile(this.filename,'utf8')!==this.lastSerialized)throw Object.assign(Error('저장한 원장과 파일 내용이 다릅니다.'),{code:'EVERIFY',syscall:'readback',path:this.filename});}
 async recordStorageEvent(event){try{await this.fs.appendFile(path.join(this.directory,'storage-errors.log'),JSON.stringify(event)+'\n',{mode:0o600});return true;}catch{return false;}}
}
