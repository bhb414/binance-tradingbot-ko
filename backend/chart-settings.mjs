import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {decodeStudies} from '../public/chart-studies.js';

const empty=()=>({revision:0,document:null,updatedAt:null});
function checked(value){
 if(!Number.isSafeInteger(value?.revision)||value.revision<1||!Number.isFinite(value.updatedAt))throw Error('저장된 지표 설정 형식을 확인해 주세요.');
 return {revision:value.revision,updatedAt:value.updatedAt,document:decodeStudies(JSON.stringify(value.document))};
}
export class ChartSettingsStore{
 constructor(directory,{now=Date.now}={}){this.filename=directory?path.join(directory,'chart-settings.json'):null;this.now=now;this.value=null;this.tail=Promise.resolve();this.recovered=false;}
 async load(){
  if(this.value)return this.value;
  if(!this.filename)return this.value=empty();
  try{this.value=checked(JSON.parse(await fs.readFile(this.filename,'utf8')));}
  catch(error){
   if(error.code==='ENOENT'){this.value=empty();return this.value;}
   if(error.code)throw error;
   try{this.value=checked(JSON.parse(await fs.readFile(this.filename+'.bak','utf8')));this.recovered=true;}
   catch{throw Error('저장된 지표 설정을 읽지 못했습니다. 원본 파일은 보존했습니다.');}
  }
  return this.value;
 }
 async get(){await this.tail;return {...structuredClone(await this.load()),recovered:this.recovered};}
 save(input){
  const run=async()=>{
   const current=await this.load();if(!Number.isSafeInteger(input?.revision)||input.revision!==current.revision)throw Object.assign(Error('다른 화면에서 지표 설정이 변경됐습니다. 서버 설정을 다시 불러온 뒤 수정해 주세요.'),{httpStatus:409});
   const serialized=JSON.stringify(input.document);if(!serialized||Buffer.byteLength(serialized)>400000)throw Error('지표 설정 크기를 확인해 주세요.');
   const next={revision:current.revision+1,document:decodeStudies(serialized),updatedAt:this.now()};
   if(this.filename){
    await fs.mkdir(path.dirname(this.filename),{recursive:true});const temp=this.filename+'.'+randomUUID()+'.tmp';
    try{
     if(current.revision&&!this.recovered)await fs.copyFile(this.filename,this.filename+'.bak');
     await fs.writeFile(temp,JSON.stringify(next),{flag:'wx',mode:0o600});
     for(let i=0;;i++){try{await fs.rename(temp,this.filename);break;}catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||i===3)throw error;await new Promise(resolve=>setTimeout(resolve,[50,150,350][i]));}}
    }finally{await fs.unlink(temp).catch(()=>{});}
   }
   this.value=next;this.recovered=false;return structuredClone(next);
  };
  const result=this.tail.then(run,run);this.tail=result.catch(()=>{});return result;
 }
}
