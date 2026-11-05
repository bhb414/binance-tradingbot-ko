import {FAVORITES_KEY,defaultFavorites,decodeFavorites,validateFavorites,validFavorite} from './favorites.js';
export const FAVORITES_BACKUP_KEY=FAVORITES_KEY+'-before-server';
export const FAVORITES_COLLECTION_KEY=FAVORITES_KEY+'-server-collection';
const decode=value=>{try{return decodeFavorites(value);}catch{return null;}};
export class FavoritesPersistence{
 constructor({storage,request,onChange=()=>{},onStatus=()=>{}}){
  this.storage=storage;this.request=request;this.onChange=onChange;this.onStatus=onStatus;this.ready=false;this.saving=false;this.tail=Promise.resolve();this.loading=null;this.marker=null;this.legacy=null;
  try{this.marker=storage?.getItem(FAVORITES_COLLECTION_KEY);this.legacy=decode(storage?.getItem(FAVORITES_KEY))??decode(storage?.getItem(FAVORITES_BACKUP_KEY));}catch{}
  this.keys=this.legacy??defaultFavorites();
 }
 serial(run){const result=this.tail.then(run,run);this.tail=result.catch(()=>{});return result;}
 cache(view){
  this.marker=view.collectionId;
  try{const old=this.storage?.getItem(FAVORITES_KEY);if(old!==null&&old!==undefined&&!this.storage.getItem(FAVORITES_BACKUP_KEY))this.storage.setItem(FAVORITES_BACKUP_KEY,old);this.storage?.setItem(FAVORITES_COLLECTION_KEY,view.collectionId);this.storage?.setItem(FAVORITES_KEY,JSON.stringify(view.keys));}catch{}
 }
 apply(view){
  if(typeof view?.collectionId!=='string'||!Number.isSafeInteger(view.revision)||view.revision<0||view.keys===null&&view.revision!==0)throw Error('서버 즐겨찾기 응답을 확인해 주세요.');
  const keys=view.keys===null?defaultFavorites():validateFavorites(view.keys);if(view.keys!==null)this.cache(view);
  this.keys=keys;this.ready=true;this.onChange([...keys]);return keys;
 }
 load(){
  if(this.loading)return this.loading;
  const run=this.serial(async()=>{
   if(!this.ready)this.onStatus('즐겨찾기 서버 연결 중…');
   try{
    let view=await this.request('/favorites');
    if(this.legacy&&this.marker!==view.collectionId)view=await this.request('/favorites',{method:'POST',body:{action:'import',keys:this.legacy}});
    const keys=this.apply(view);this.onStatus(view.recovered?'즐겨찾기 서버 백업에서 복원됨':view.keys===null?'즐겨찾기 PC·휴대폰 공유 · 별을 누르면 서버에 저장':'즐겨찾기 서버 저장됨 · PC·휴대폰 공유');return keys;
   }catch(error){this.onStatus('즐겨찾기 동기화 실패 · '+error.message+' · 기존 목록 유지');throw error;}
  });
  this.loading=run.finally(()=>{this.loading=null;});return this.loading;
 }
 set(key,enabled){
  return this.serial(async()=>{
   if(!this.ready)throw Error('먼저 서버 즐겨찾기를 불러와 주세요.');if(!validFavorite(key)||typeof enabled!=='boolean')throw Error('즐겨찾기 종목과 선택 여부를 확인해 주세요.');
   this.saving=true;this.onStatus('즐겨찾기 서버 저장 중…');
   try{const keys=this.apply(await this.request('/favorites',{method:'POST',body:{action:'set',key,enabled}}));this.onStatus('즐겨찾기 서버 저장됨 · PC·휴대폰 공유');return keys;}
   catch(error){this.onStatus('즐겨찾기 저장 실패 · '+error.message+' · 기존 목록 유지');throw error;}
   finally{this.saving=false;this.onChange([...this.keys]);}
  });
 }
}
