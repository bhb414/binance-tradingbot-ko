import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {defaultFavorites,validateFavorites,setFavorite,validFavorite} from '../public/favorites.js';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const empty=()=>({collectionId:randomUUID(),revision:0,keys:null,imports:[],removed:[],updatedAt:null});
function checked(value){
 if(!uuid(value?.collectionId)||!Number.isSafeInteger(value.revision)||value.revision<1||!Number.isFinite(value.updatedAt)||!Array.isArray(value.imports)||value.imports.length>2000||value.imports.some(id=>typeof id!=='string'||!/^[0-9a-f]{64}$/.test(id)))throw Error('저장된 즐겨찾기 형식을 확인해 주세요.');
 const removed=value.removed??[];if(!Array.isArray(removed)||removed.length>10000||!removed.every(validFavorite))throw Error('저장된 즐겨찾기 삭제 기록을 확인해 주세요.');
 return {collectionId:value.collectionId,revision:value.revision,keys:validateFavorites(value.keys),imports:[...new Set(value.imports)],removed:[...new Set(removed)],updatedAt:value.updatedAt};
}
export class FavoritesStore{
 constructor(directory,{now=Date.now}={}){this.filename=directory?path.join(directory,'favorites.json'):null;this.now=now;this.value=null;this.tail=Promise.resolve();this.recovered=false;this.loading=null;}
 view(){const {imports,removed,...value}=this.value;return {...structuredClone(value),recovered:this.recovered};}
 load(){if(this.value)return Promise.resolve(this.value);this.loading??=this.readInitial().finally(()=>{this.loading=null;});return this.loading;}
 async readInitial(){
  if(this.value)return this.value;if(!this.filename)return this.value=empty();
  try{this.value=checked(JSON.parse(await fs.readFile(this.filename,'utf8')));}
  catch(error){if(error.code==='ENOENT'){this.value=empty();return this.value;}if(error.code)throw error;try{this.value=checked(JSON.parse(await fs.readFile(this.filename+'.bak','utf8')));this.recovered=true;}catch{throw Error('즐겨찾기를 읽지 못했습니다. 원본 파일은 보존했습니다.');}}
  return this.value;
 }
 async get(){await this.tail;await this.load();return this.view();}
 update(input){
  const run=async()=>{
   const current=await this.load();let keys,imports=current.imports,removed=current.removed;
   if(input?.action==='import'){
    const incoming=validateFavorites(input.keys),digest=createHash('sha256').update(JSON.stringify([...incoming].sort())).digest('hex');
    if(imports.includes(digest))return this.view();if(imports.length>=2000)throw Error('이전 즐겨찾기 가져오기 기록 한도를 확인해 주세요.');
    const accepted=incoming.filter(key=>!removed.includes(key));keys=validateFavorites(current.keys===null?accepted:[...new Set([...current.keys,...accepted])]);imports=[...imports,digest];
   }else if(input?.action==='set'){keys=setFavorite(current.keys??defaultFavorites(),input.key,input.enabled);if(input.enabled&&removed.includes(input.key))removed=removed.filter(key=>key!==input.key);else if(!input.enabled&&!removed.includes(input.key)){if(removed.length>=10000)throw Error('즐겨찾기 삭제 기록 한도를 확인해 주세요.');removed=[...removed,input.key];}}
   else throw Error('즐겨찾기 변경 방식을 확인해 주세요.');
   if(JSON.stringify(keys)===JSON.stringify(current.keys)&&imports===current.imports&&removed===current.removed)return this.view();
   const next={collectionId:current.collectionId,revision:current.revision+1,keys,imports,removed,updatedAt:this.now()};
   if(this.filename){
    await fs.mkdir(path.dirname(this.filename),{recursive:true});const temp=this.filename+'.'+randomUUID()+'.tmp';
    try{if(current.revision&&!this.recovered)await fs.copyFile(this.filename,this.filename+'.bak');await fs.writeFile(temp,JSON.stringify(next),{flag:'wx',mode:0o600});for(let i=0;;i++){try{await fs.rename(temp,this.filename);break;}catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||i===3)throw error;await new Promise(resolve=>setTimeout(resolve,[50,150,350][i]));}}}
    finally{await fs.unlink(temp).catch(()=>{});}
   }
   this.value=next;this.recovered=false;return this.view();
  };
  const result=this.tail.then(run,run);this.tail=result.catch(()=>{});return result;
 }
}
