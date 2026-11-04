import {STUDY_KEY,decodeStudies,defaultStudies} from './chart-studies.js';
export const STUDY_BACKUP_KEY=STUDY_KEY+'-before-server';
const documentFor=studies=>decodeStudies(JSON.stringify({version:1,timeframeVersion:2,studies}));
export class StudyPersistence{
 constructor({storage,request,onChange=()=>{},onStatus=()=>{}}){
  this.storage=storage;this.request=request;this.onChange=onChange;this.onStatus=onStatus;this.ready=false;this.busy=false;this.revision=0;
  try{this.local=decodeStudies(storage?.getItem(STUDY_KEY));}catch{this.local=null;}
  this.document=this.local||documentFor(defaultStudies());
 }
 backup(){try{return decodeStudies(this.storage?.getItem(STUDY_BACKUP_KEY));}catch{return null;}}
 cache(document){
  try{
   const old=this.storage?.getItem(STUDY_KEY),next=JSON.stringify(document);
   if(old&&old!==next&&!this.storage.getItem(STUDY_BACKUP_KEY))this.storage.setItem(STUDY_BACKUP_KEY,old);
   this.storage?.setItem(STUDY_KEY,next);
  }catch{}
 }
 apply(result){this.revision=result.revision;this.document=decodeStudies(JSON.stringify(result.document));this.cache(this.document);this.onChange(structuredClone(this.document.studies));}
 async load(){
  if(this.busy)throw Error('지표 설정을 저장 중입니다. 잠시 후 다시 시도해 주세요.');
  this.ready=false;this.busy=true;this.onStatus('지표 설정 불러오는 중…');
  try{
   let result=await this.request('/chart-settings');
   if(!result.document&&this.local)result=await this.request('/chart-settings',{method:'POST',body:{revision:result.revision,document:this.local}});
   if(result.document)this.apply(result);else{this.revision=result.revision;this.onChange(structuredClone(this.document.studies));}
   this.ready=true;this.onStatus(result.recovered?'이전 서버 백업에서 지표를 복원했습니다.':result.document?'서버에 저장됨 · 접속 주소가 바뀌어도 복원':'지표 변경 시 서버에 저장 · 접속 주소가 바뀌어도 복원');return this.document.studies;
  }catch(error){this.onStatus('지표 불러오기 실패 · '+error.message);throw error;}finally{this.busy=false;}
 }
 async save(studies){
  if(!this.ready)throw Error('먼저 서버 지표 설정을 불러와 주세요.');
  if(this.busy)throw Error('지표 설정을 저장 중입니다. 잠시 후 다시 시도해 주세요.');
  const document=documentFor(studies);this.busy=true;this.onStatus('서버에 지표 저장 중…');
  try{const result=await this.request('/chart-settings',{method:'POST',body:{revision:this.revision,document}});this.apply(result);this.local=this.document;this.onStatus('서버에 저장됨 · 접속 주소가 바뀌어도 복원');return this.document.studies;}
  catch(error){this.onStatus('지표 저장 실패 · '+error.message);throw error;}finally{this.busy=false;}
 }
}
