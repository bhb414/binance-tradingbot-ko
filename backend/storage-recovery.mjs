import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {isTemporary} from './binance-rate.mjs';
import {MAX_LEVERAGE} from '../public/leverage.js';
const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']),active=o=>!terminal.has(o.status);
const reasons={EPERM:'파일 교체 권한 또는 잠금',EACCES:'파일 접근 권한 또는 잠금',EBUSY:'다른 프로그램이 파일 사용 중',ENOSPC:'디스크 공간 부족',EIO:'디스크 입출력 오류',EROFS:'읽기 전용 디스크',EDQUOT:'디스크 할당량 초과',EMFILE:'열린 파일 한도 초과',ENFILE:'시스템 파일 한도 초과',ETIMEDOUT:'디스크 응답 지연',EVERIFY:'저장 파일 대조 실패'};
export const isStorageError=error=>error?.storage===true;
export class StorageRecovery{
 constructor(engine){this.e=engine;this.durable=null;this.binding=null;this.fault=null;this.events=[];this.stops=new Map();this.off=false;this.checking=false;this.lastAttempt=0;}
 capture(){this.durable=structuredClone(this.e.state);this.bind();}
 bind(){this.binding={scope:this.e.state.scope,connectionId:this.e.connectionId};}
 blocked(){return Object.assign(Error(this.e.writeError||'원장 저장·주문 대조가 끝날 때까지 주문을 보류합니다.'),{storage:true});}
 healthy(){if(this.fault)throw this.blocked();}
 applyStops(){
  if(this.off)this.e.state.orderPermission={scope:this.e.state.scope,enabled:false};
  for(const b of [...this.e.state.bots,...this.e.multi.groups]){const stop=this.stops.get(b.id);if(stop)Object.assign(b.runtime,stop);if(this.off)b.runtime.runEnabled=false;}
 }
 rememberStops(){
  if(this.e.state.orderPermission?.enabled===false||this.e.state.orderPermission===null&&this.durable?.orderPermission?.enabled===true)this.off=true;
  for(const b of [...this.e.state.bots,...this.e.multi.groups]){const old=[...(this.durable?.bots||[]),...(this.durable?.multiBots||[])].find(old=>old.id===b.id);if(old?.runtime.runEnabled&&!b.runtime.runEnabled)this.stops.set(b.id,{runEnabled:false,error:b.runtime.error||null,syncHold:b.runtime.syncHold||false});}
 }
 rewind(){if(this.durable)this.e.store.state=structuredClone(this.durable);this.applyStops();for(const event of this.events)if(!this.e.state.logs.some(log=>log.id===event.id))this.e.state.logs.unshift(event);this.e.state.logs=this.e.state.logs.slice(0,1000);}
 event(title,message,level='error'){
  const event={id:randomUUID(),at:this.e.now(),title,message,botId:null,level};this.events.push(event);this.events=this.events.slice(-20);this.e.state.logs.unshift(event);return event;
 }
 async diagnostic(event){const value={at:this.e.now(),event,...this.fault};delete value.resume;const saved=await this.e.store.recordStorageEvent?.(value);if(saved===false)process.stderr.write('[storage] '+JSON.stringify(value)+'\n');}
 updateMessage(message){this.e.writeError=message;this.fault.message=message;}
 async failed(error){
  this.rememberStops();
  const first=!this.fault,code=String(error.code||'UNKNOWN').slice(0,40),syscall=String(error.syscall||'save').slice(0,40),file=path.basename(String(error.path||this.e.store.filename||'state.json')).slice(0,100);
  if(first)this.fault={firstAt:this.e.now(),resume:this.e.tradingEnabled===true,attempts:0};
  this.e.tradingEnabled=false;Object.assign(this.fault,{lastAt:this.e.now(),code,syscall,file,reason:reasons[code]||'원장 저장 실패',phase:'saving',retryAt:this.e.now()+5000,saveAttempts:error.storageAttempts||1});
  this.rewind();this.updateMessage('원장 저장 오류 ('+code+' · '+this.fault.reason+') · 주문 보류 · 저장 회복 후 주문·포지션 대조');
  if(first){this.event('원장 저장 오류',code+' · '+syscall+' · '+file+' · 주문 전송 보류');await this.diagnostic('failed');}
  return this.blocked();
 }
 async checkpoint(){
  this.healthy();
  try{await this.e.store.save();this.capture();}
  catch(error){throw await this.failed(error);}
 }
 stop(id=null){
  if(!this.fault)return false;
  const targets=id?(this.e.multi.has(id)?[this.e.multi.get(id),...this.e.multi.workers(this.e.multi.get(id))]:[this.e.bot(id)]):[...this.e.state.bots,...this.e.multi.groups];
  if(!id){this.off=true;this.e.tradingEnabled=false;this.e.state.orderPermission={scope:this.e.state.scope,enabled:false};}
  for(const b of targets){this.stops.set(b.id,{runEnabled:false,error:b.runtime.error||null,syncHold:b.runtime.syncHold||false});b.runtime.runEnabled=false;}
  this.event('저장 대기 중 정지 요청',id?(targets[0].name+' · 신규 진입 정지 · 저장 복구 후 미체결 진입 취소 확인'):'주문 허용 꺼짐 · 저장 복구 후에도 꺼짐 유지','info');return true;
 }
 status(){if(!this.fault)return null;const{resume,...view}=this.fault;return {...view,offRequested:this.off};}
 async reconnectReadOnly(){
  const e=this.e,keys=await e.credentialStore?.load();if(!keys||typeof keys.apiKey!=='string'||typeof keys.secret!=='string')throw Error('저장된 키로 계좌를 확인하지 못했습니다.');
  const scope=keys.environment+':'+createHash('sha256').update(keys.apiKey.trim()).digest('hex').slice(0,32);if(scope!==e.state.scope)throw Error('저장된 키가 원장 계좌와 다릅니다.');
  const candidate=e.clientFactory(keys);let account,positions,mode,orders;
  try{await candidate.syncTime();[account,positions,mode,orders]=await Promise.all([candidate.account(),candidate.positions(),candidate.positionMode(),candidate.openOrders()]);if(Boolean(mode.dualSidePosition)!==e.hedge&&e.hasExposure())throw Error('계좌 포지션 모드가 변경되었습니다.');}
  catch(error){const message=candidate.redact?.(error.message)||'계좌 재연결 확인 필요';candidate.clearCredentials();throw Error(message);}
  const previous=e.client;e.client=candidate;previous?.clearCredentials();e.connected=true;e.connectionId=randomUUID();e.hedge=Boolean(mode.dualSidePosition);e.accountSnapshot=e.normalizeAccount(account,positions,orders);e.accountAt=e.now();e.lastTimeSync=e.now();this.bind();
  if(!this.off&&e.state.orderPermission?.scope===scope&&e.state.orderPermission.enabled===true)this.fault.resume=true;
 }
 async verifyExchange(){
  const e=this.e;
  if(!e.connected&&e.hasExposure())await this.reconnectReadOnly();
  if(!e.connected)return;
  if(e.state.scope!==this.binding?.scope||e.connectionId!==this.binding?.connectionId)throw Error('오류 전 계좌 연결과 달라 계좌 확인이 필요합니다.');
  const mode=await e.client.positionMode(),hedge=Boolean(mode.dualSidePosition);
  if(hedge!==e.hedge&&e.hasExposure())throw Error('계좌 포지션 모드가 변경되었습니다.');e.hedge=hedge;
  e.manual.recoverInterrupted();await e.manual.refreshPending();
  for(const b of e.state.bots)for(const o of e.ownOrders(b).filter(o=>o.scope===e.state.scope&&(active(o)||!o.feesFetched&&o.orderId))){delete o.lastQueryError;await e.refreshOrder(b,o);}
  await e.refreshAccount(true);
  const pending=e.state.orders.filter(o=>o.scope===e.state.scope&&active(o));
  if(pending.some(o=>o.status==='UNKNOWN'||o.lastQueryError))throw Error('접수 여부가 확인되지 않은 주문이 있습니다. 같은 주문을 다시 보내지 않고 조회합니다.');
  for(const b of e.state.bots.filter(b=>b.runtime.runEnabled||b.runtime.quantity>0||e.ownOrders(b).some(o=>o.scope===e.state.scope&&active(o)))){
   await e.syncBotPosition(b,true);if(b.runtime.syncHold)throw Error(b.name+' · 거래소 포지션과 원장이 달라 자동 복구를 보류합니다.');
   const rows=await e.client.symbolConfig(b.symbol),config=Array.isArray(rows)?rows.find(row=>row.symbol===b.symbol)||rows[0]:rows,leverage=Number(config?.leverage);
   if(String(config?.marginType).toUpperCase()!==b.margin||!Number.isInteger(leverage)||leverage<1||leverage>MAX_LEVERAGE||b.runtime.quantity>0&&leverage!==b.leverage)throw Error(b.name+' · 증거금 모드·레버리지 확인이 필요합니다.');
   if(!b.runtime.quantity)b.leverage=leverage;
   const known=new Set(e.ownOrders(b).filter(o=>o.scope===e.state.scope).map(o=>o.id)),algos=await e.client.openAlgoOrders(b.symbol),algoRows=Array.isArray(algos)?algos:algos.orders||[];
   if(!e.shared.supported&&(e.accountSnapshot.orders.some(o=>o.symbol===b.symbol&&!known.has(o.clientOrderId))||algoRows.some(o=>!known.has(o.clientAlgoId))))throw Error(b.name+' · 봇 소유가 아닌 미체결 주문이 있습니다.');
  }
  if(!e.accountSnapshot.canTrade&&this.fault.resume&&!this.off)throw Error('계좌의 주문 권한을 확인하지 못했습니다.');
 }
 async recover({force=false}={}){
  if(!this.fault)return true;
  const now=this.e.now();if(this.checking||now<this.lastAttempt+1000||!force&&now<this.fault.retryAt)return false;
  this.checking=true;this.lastAttempt=now;this.fault.attempts++;const e=this.e,incident=this.fault;let completion=null;
  try{
   this.rewind();this.fault.phase='saving';await e.store.save();await e.store.verify?.();
   this.fault.phase='checking';this.updateMessage('원장 저장 정상화 · 거래소 주문·포지션 대조 중 · 주문 보류');
   await this.verifyExchange();this.applyStops();
   // Explicitly rejected throttled orders may retry; unknown orders never rearm here.
   for(const b of e.state.bots){for(const [id,signal]of Object.entries(b.runtime.ruleSignals)){const last=e.ownOrders(b).filter(o=>o.scope===e.state.scope&&o.ruleId===id).at(-1);if(last?.status==='REJECTED'&&last.retryable)Object.assign(signal,{fired:false,lastBar:null,lastExecutionAt:0});}}
   const restored=this.fault.resume&&!this.off&&e.connected&&e.state.orderPermission?.scope===e.state.scope&&e.state.orderPermission.enabled===true&&e.accountSnapshot?.canTrade!==false;
   e.state.storageHealth={firstAt:this.fault.firstAt,lastAt:this.fault.lastAt,recoveredAt:e.now(),code:this.fault.code,reason:this.fault.reason,syscall:this.fault.syscall,file:this.fault.file};
   completion=this.event('원장 저장 복구',this.fault.code+' · 저장 파일·거래소 주문·포지션 대조 완료 · '+(restored?'기존 주문 허용 상태 복원':'주문 허용 꺼짐 유지'),'info');
   this.fault.phase='saving';await e.store.save();await e.store.verify?.();this.capture();await this.diagnostic('recovered');
   this.fault=null;this.events=[];e.writeError=null;e.connectionError=null;e.tradingEnabled=!!restored;this.off=false;
   const stopped=[...this.stops.keys()];this.stops.clear();
   if(e.tradingEnabled)for(const b of e.state.bots.filter(b=>stopped.includes(b.id)))try{await e.pauseRuntime(b);}catch(error){if(isStorageError(error))throw error;b.runtime.error=e.client.redact?.(error.message)||'정지 후 미체결 확인 필요';e.note('정지 후 미체결 확인',b.name+' · '+b.runtime.error,b.id,'error');}
   return true;
  }catch(error){
   if(completion&&this.fault===incident){this.events=this.events.filter(event=>event.id!==completion.id);e.state.logs=e.state.logs.filter(event=>event.id!==completion.id);if(this.durable?.storageHealth)e.state.storageHealth=structuredClone(this.durable.storageHealth);else delete e.state.storageHealth;}
   e.tradingEnabled=false;
   if(isStorageError(error))return false;
   if(this.fault.phase==='saving'||error.code==='EVERIFY'){this.fault.phase='saving';this.fault.code=String(error.code||'UNKNOWN');this.fault.reason=reasons[error.code]||'원장 저장 실패';this.fault.lastAt=e.now();this.fault.syscall=String(error.syscall||'save').slice(0,40);this.fault.file=path.basename(String(error.path||e.store.filename||'state.json')).slice(0,100);}
   else this.fault.phase='verification';
   this.fault.retryAt=Math.max(e.now()+5000,Number(error.retryAt)||0);
   const detail=this.fault.phase==='saving'?this.fault.code+' · '+this.fault.reason:(e.client.redact?.(error.message)||error.message);
   if(this.fault.lastReason!==detail){this.fault.lastReason=detail;this.event('원장 복구 대기',detail);await this.diagnostic('waiting');}
   this.updateMessage((this.fault.phase==='saving'?'원장 저장 재시도 대기 · ':'원장 대조 확인 필요 · ')+detail+' · 주문 보류');
   if(isTemporary(error))e.waiting=null;
   return false;
  }finally{this.checking=false;}
 }
}
