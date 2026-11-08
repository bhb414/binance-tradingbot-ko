import {randomUUID} from 'node:crypto';
import {actionDirection} from '../public/actions.js';
import {budgetIncluded} from '../public/budget.js';
import {leverageCap} from '../public/leverage.js';

const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const active=o=>!terminal.has(o.status);
const directionName=direction=>direction==='LONG'?'롱':'숏';

// The signal starts one durable operation. Its close and entry legs may finish
// on different bars, but an accepted/uncertain entry is never submitted twice.
export class SwitchPositionFlow{
 constructor(engine){this.e=engine;}
 wait(b,phase,detail=''){
  const p=b.runtime.switchPending;if(!p)return false;
  if(phase==='entry'&&b.runtime.entryBlocked)p.retryAt=Math.max(p.retryAt||0,b.runtime.entryBlocked.retryAt||0);
  p.phase=phase;p.message=directionName(p.direction)+' 전환 · '+detail;
  b.runtime.waiting={kind:'switch',message:p.message,retryAt:p.retryAt||this.e.now()+1000};
  return false;
 }
 async finish(b,detail){
  const r=b.runtime,p=r.switchPending;if(!p)return true;
  delete r.switchPending;if(r.waiting?.kind==='switch')r.waiting=null;
  this.e.note('스위칭 종료',b.name+' · '+directionName(p.direction)+' 전환 · '+detail,b.id);
  await this.e.checkpoint();return true;
 }
 async request(b,item){
  const e=this.e,r=b.runtime,direction=actionDirection(item.rule.action);
  if(r.switchPending)return this.advance(b);
  if(!r.runEnabled||r.stopPending||r.quantity&&r.direction===direction)return false;
  const {rule,signal,bar,interval}=item;
  r.switchPending={id:randomUUID(),scope:e.state.scope,at:e.now(),bar,interval,direction,fromDirection:r.direction,fromEpoch:r.positionEpoch,held:r.quantity>0,phase:r.quantity?'closing':'entry',retryAt:0,rule:structuredClone({...rule,action:'ENTER_'+direction,closeScope:'bot'})};
  signal.fired=true;signal.lastBar=bar;signal.lastExecutionAt=e.now();
  e.note('스위칭 시작',b.name+' · '+directionName(direction)+' 전환 · 이 봇 반대 보유분 전량 정리 후 진입',b.id);
  await e.checkpoint();return this.advance(b);
 }
 async advance(b){
  const e=this.e,r=b.runtime,p=r.switchPending;
  if(!p||!r.runEnabled||r.stopPending||!e.tradingEnabled||!e.connected||!budgetIncluded(b))return false;
  if(p.scope!==e.state.scope)return this.finish(b,'계좌 변경 · 새 주문 없음');
  const revision=e.client.accountRevision||0;
  if(e.now()<p.retryAt&&p.revision===revision)return false;p.revision=revision;p.retryAt=e.now()+1000;
  if(p.phase==='closing'){
   if(r.quantity&&(r.direction!==p.fromDirection||r.positionEpoch!==p.fromEpoch))return this.finish(b,'보유 포지션 변경 · 새 주문 없음');
   const done=r.closePending?await e.closeFlow.advance(b):await e.closeFlow.request(b,'스위칭 · '+directionName(p.direction)+' 전환');
   if(!done||r.closePending||r.syncHold||r.quantity)return this.wait(b,'closing','반대 포지션 정리 체결·잔량 확인 중');
   p.phase='entry';await e.checkpoint();
  }
  const placed=()=>e.ownOrders(b).filter(o=>o.switchIntentId===p.id);
  if(p.phase==='entering'){
   if(placed().some(active)){
    await e.settlePending(b,await e.symbolInfo(b.symbol));
    await e.refreshAccount();await e.syncBotPosition(b,true);await e.ensureGuards(b,await e.symbolInfo(b.symbol));
    if(placed().some(active))return this.wait(b,'entering','반대 진입 주문 체결 확인 중');
   }
   const orders=placed();
   if(orders.some(o=>Number(o.appliedQty)>0))return this.finish(b,'반대 진입 체결 확인');
   if(orders.some(o=>o.status==='REJECTED'&&['entry-margin','post-only'].includes(o.errorKind)||o.status==='REJECTED'&&o.retryable))p.phase='entry';
   else if(orders.length)return this.finish(b,'진입 주문 종료 · 자동 중복 주문 없음');
   else p.phase='entry';
  }
  if(r.closePending||r.closeRecovery||r.syncHold)return this.wait(b,'entry','정리 결과 대조 중');
  // Fetch the released margin before *any* capacity/minimum-order calculation.
  await e.refreshAccount(true);await e.syncBotPosition(b,true);
  if(r.syncHold)return this.wait(b,'entry','포지션 대조 중');
  if(r.quantity)return this.finish(b,r.direction===p.direction?'목표 방향 보유 확인 · 추가 진입 없음':'새 보유 포지션 확인 · 추가 주문 없음');
  if(e.ownOrders(b).some(active))return this.wait(b,'entry','기존 주문 결과 확인 중');
  const cooldown=Number(p.rule.reentry.afterExitCooldown||0)*1000;
  if(e.now()-Number(r.lastExitAt||0)<cooldown)return this.wait(b,'entry','설정한 전량 정리 후 진입 대기 중');
  if(!await e.entryRetryReady(b,p.rule)||!e.postOnly.ready(b,p.rule))return this.wait(b,'entry',r.entryBlocked?.message||'반대 진입 재확인 대기');
  if(b.maxEntries&&r.entries>=b.maxEntries)return this.wait(b,'entry','최대 진입 횟수 확인 필요');
  const info=await e.symbolInfo(b.symbol),limits=await e.leverageLimits(b.symbol);
  if(p.rule.leverage>leverageCap(limits,e.budgetLimit(b)))return this.wait(b,'entry','현재 예산의 레버리지 한도 확인 필요');
  const market=await e.market(b.symbol,p.interval),signal=r.ruleSignals[p.rule.id]||={fired:true,lastBar:p.bar,lastExecutionAt:p.at,epoch:r.positionEpoch};
  p.phase='entering';await e.checkpoint();
  await e.executeRule(b,{rule:p.rule,signal,bar:p.bar,interval:p.interval,market,switchIntentId:p.id},info);
  if(!r.switchPending)return true;
  if(placed().some(active))return this.wait(b,'entering','반대 진입 주문 체결 확인 중');
  if(placed().some(o=>Number(o.appliedQty)>0))return this.finish(b,'반대 진입 체결 확인');
  return this.wait(b,'entry',r.entryBlocked?.message||r.orderRetry?.message||'반대 진입 대기 · 잔고·예산 재확인');
 }
}
