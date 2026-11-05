import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MAX_CUSTOM_STUDIES,validateCustomStudy,migrateCustomStudies} from '../public/custom-studies.js';
const checked=value=>{if(!Number.isSafeInteger(value?.revision)||value.revision<0||!Array.isArray(value.studies)||value.studies.length>MAX_CUSTOM_STUDIES||!Number.isFinite(value.updatedAt))throw Error('저장된 내 지표 목록 형식을 확인해 주세요.');const studies=value.studies.map(validateCustomStudy);if(new Set(studies.map(s=>s.id)).size!==studies.length)throw Error('저장된 내 지표 식별자가 중복됐습니다.');return {revision:value.revision,updatedAt:value.updatedAt,studies};};
export class CustomStudyStore{
 constructor(directory,{readLegacy=async()=>[],now=Date.now}={}){this.filename=directory?path.join(directory,'custom-studies.json'):null;this.readLegacy=readLegacy;this.now=now;this.value=null;this.loading=null;this.recovered=false;this.tail=Promise.resolve();}
 async load(){if(this.value)return this.value;if(this.loading)return this.loading;this.loading=this.loadInitial();try{return await this.loading;}finally{this.loading=null;}}
 async loadInitial(){
  if(this.filename){try{return this.value=checked(JSON.parse(await fs.readFile(this.filename,'utf8')));}catch(error){if(error.code!=='ENOENT'){if(error.code)throw error;try{this.value=checked(JSON.parse(await fs.readFile(this.filename+'.bak','utf8')));this.recovered=true;return this.value;}catch{throw Error('내 지표 목록을 읽지 못했습니다. 원본 파일은 보존했습니다.');}}}}
  const studies=migrateCustomStudies(await this.readLegacy()),value={revision:studies.length?1:0,updatedAt:this.now(),studies};if(studies.length)await this.persist(value,null);return this.value=value;
 }
 async persist(next,current){if(!this.filename)return;await fs.mkdir(path.dirname(this.filename),{recursive:true});const temp=this.filename+'.'+randomUUID()+'.tmp';try{if(current?.revision&&!this.recovered)await fs.copyFile(this.filename,this.filename+'.bak');await fs.writeFile(temp,JSON.stringify(next),{flag:'wx',mode:0o600});for(let attempt=0;;attempt++){try{await fs.rename(temp,this.filename);break;}catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt===3)throw error;await new Promise(resolve=>setTimeout(resolve,[50,150,350][attempt]));}}}finally{await fs.unlink(temp).catch(()=>{});}}
 async get(){await this.tail;if(this.value?.revision===0)this.value=null;return {...structuredClone(await this.load()),recovered:this.recovered};}
 update(input){const run=async()=>{const current=await this.load();if(!Number.isSafeInteger(input?.revision)||input.revision!==current.revision)throw Object.assign(Error('다른 화면에서 내 지표가 변경됐습니다. 서버 설정 불러오기를 누른 뒤 다시 수정해 주세요.'),{httpStatus:409});let studies=[...current.studies];
  if(input.action==='save'){const study=validateCustomStudy(input.study),index=studies.findIndex(s=>s.id===study.id);if(index<0){if(studies.length>=MAX_CUSTOM_STUDIES)throw Error('내 지표는 최대 '+MAX_CUSTOM_STUDIES+'개까지 저장할 수 있습니다.');studies.push(study);}else studies[index]=study;}
  else if(input.action==='delete'){if(typeof input.id!=='string'||!studies.some(s=>s.id===input.id))throw Error('목록에서 지표를 찾을 수 없습니다.');studies=studies.filter(s=>s.id!==input.id);}
  else throw Error('내 지표 저장 작업을 확인해 주세요.');
  const next=checked({revision:current.revision+1,updatedAt:this.now(),studies});await this.persist(next,current);this.value=next;this.recovered=false;return structuredClone(next);};const result=this.tail.then(run,run);this.tail=result.catch(()=>{});return result;}
}
