import {validateStudy} from './chart-studies.js';
import {randomId} from './id.js';
export const MAX_CUSTOM_STUDIES=50;
export function validateCustomStudy(value){if(!['FORMULA','SCRIPT'].includes(value?.type))throw Error('내 지표에는 수식·스크립트 지표만 저장할 수 있습니다.');return validateStudy(value);}
export const customStudyKey=study=>JSON.stringify([study.params.name.trim(),(study.params.script||study.params.formula).trim(),study.params.placement]);
export function customStudyCopy(study){return validateCustomStudy({...structuredClone(study),id:'custom-'+randomId(),visible:true});}
export function customChartCopy(study){return validateCustomStudy({...structuredClone(study),id:'study-'+randomId(),visible:true});}
export function migrateCustomStudies(studies){const keys=new Set(),saved=[];for(const study of studies||[]){if(!['FORMULA','SCRIPT'].includes(study.type))continue;const checked=validateCustomStudy(study),key=customStudyKey(checked);if(keys.has(key))continue;keys.add(key);saved.push(customStudyCopy(checked));if(saved.length===MAX_CUSTOM_STUDIES)break;}return saved;}
export class CustomStudyPersistence{
 constructor({request,onChange=()=>{},onStatus=()=>{}}){this.request=request;this.onChange=onChange;this.onStatus=onStatus;this.studies=[];this.revision=0;this.ready=false;this.busy=false;}
 apply(result){if(!Number.isSafeInteger(result.revision)||result.revision<0||!Array.isArray(result.studies)||result.studies.length>MAX_CUSTOM_STUDIES)throw Error('내 지표 목록 형식을 확인해 주세요.');const studies=result.studies.map(validateCustomStudy);if(new Set(studies.map(s=>s.id)).size!==studies.length)throw Error('내 지표 식별자가 중복됐습니다.');this.revision=result.revision;this.studies=studies;this.onChange(structuredClone(studies));}
 async load(){if(this.busy)throw Error('내 지표를 저장 중입니다. 잠시 후 다시 시도해 주세요.');this.busy=true;this.ready=false;this.onStatus('내 지표 불러오는 중…');try{this.apply(await this.request('/custom-studies'));this.ready=true;this.onStatus('내 지표 '+this.studies.length+'개 · 기기 공통');return this.studies;}catch(error){this.onStatus('내 지표 불러오기 실패 · '+error.message);throw error;}finally{this.busy=false;}}
 async update(action,studyOrId){if(!this.ready)throw Error('먼저 내 지표 목록을 불러와 주세요.');if(this.busy)throw Error('내 지표를 저장 중입니다. 잠시 후 다시 시도해 주세요.');const body={revision:this.revision,action,...(action==='save'?{study:validateCustomStudy(studyOrId)}:{id:studyOrId})};this.busy=true;try{this.apply(await this.request('/custom-studies',{method:'POST',body}));this.onStatus('내 지표 '+this.studies.length+'개 · 기기 공통');return this.studies;}catch(error){this.onStatus('내 지표 저장 실패 · '+error.message);throw error;}finally{this.busy=false;}}
 save(study){return this.update('save',study);}remove(id){return this.update('delete',id);}
}
