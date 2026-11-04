import {randomUUID} from 'node:crypto';
import {quantize,symbolFilters} from './orders.mjs';
export const knownOrderSettlement=o=>o.kind==='algo'&&o.status==='UNKNOWN'&&(!!o.childOrderId||['TRIGGERING','TRIGGERED'].includes(o.algoStatus));
export const LEGACY_CLOSE_WAIT='기존 주문의 취소·체결 결과를 확인한 뒤 청산합니다.';
const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const active=o=>!terminal.has(o.status),number=v=>Number(v)||0;
export class ClosePositionFlow{
 constructor(engine){this.e=engine;}
 recoverLegacy(){for(const b of this.e.state.bots)if(b.runtime.error===LEGACY_CLOSE_WAIT&&!b.runtime.closePending)this.begin(b,'이전 정리 결과 대조',{legacy:true});}
 begin(b,reason,{legacy=false}={}){const r=b.runtime;if(r.closePending)return r.closePending;const intent={id:randomUUID(),at:this.e.now(),retryAt:0,reason,epoch:r.positionEpoch,direction:r.direction,held:r.quantity>0,legacy,orders:this.e.ownOrders(b).filter(active).map(o=>o.id),cancelAt:{}};r.closePending=intent;return intent;}
 wait(b){const intent=b.runtime.closePending;b.runtime.waiting={kind:'order-settlement',message:'정리 체결·취소 확인 중 · 확인 후 자동 계속',retryAt:intent.retryAt};return false;}
 async finish(b,{stale=false}={}){const e=this.e,r=b.runtime,intent=r.closePending;for(const o of e.ownOrders(b).filter(o=>intent.orders.includes(o.id)&&o.parameters.type==='LIMIT'))o.fallbackDone=true;if(r.error===LEGACY_CLOSE_WAIT)r.error=null;if(r.waiting?.kind==='order-settlement')r.waiting=null;delete r.closePending;if(!r.quantity){r.guardKey=null;e.clearGuardWait(b);}e.note('정리 결과 대조 완료',b.name+' · '+(stale?'이전 포지션 정리 종료 · 현재 포지션 추가 주문 없음':'보유 수량·미체결 대조 완료 · 중복 청산 없음'),b.id);await e.checkpoint();return true;}
 async request(b,reason){this.e.requireTrading();const existing=!!b.runtime.closePending;this.begin(b,reason);if(!existing)await this.e.checkpoint();return this.advance(b,{force:!existing});}
 async advance(b,{force=false}={}){
  const e=this.e,r=b.runtime,intent=r.closePending;if(!intent)return true;if(!e.connected||!force&&e.now()<intent.retryAt)return this.wait(b);intent.retryAt=e.now()+3000;
  const owned=e.ownOrders(b),submitted=owned.filter(o=>o.closeIntentId===intent.id);for(const o of owned.filter(active)){const check=e.orderChecks.get(o);if(!check||e.now()-check.at>=1000||check.revision!==(e.client.accountRevision||0))await e.pollTrackedOrder(o,()=>e.refreshOrder(b,o),{force:true});}
  await e.refreshAccount(true);await e.syncBotPosition(b,true);
  if(r.syncHold)return this.wait(b);
  if((intent.held||intent.legacy)&&r.positionEpoch!==intent.epoch||intent.held&&r.quantity&&r.direction!==intent.direction){const old=e.ownOrders(b).filter(o=>active(o)&&(intent.orders.includes(o.id)||o.closeIntentId===intent.id));for(const o of old){if(!e.tradingEnabled||o.status==='UNKNOWN'||o.childOrderId||o.parameters.type==='MARKET')continue;if(o.kind==='algo')await e.cancelGuard(b,o);else await e.cancelStandard(b,o,true);}if(old.some(active))return this.wait(b);return this.finish(b,{stale:true});}
  if(intent.legacy){if(!r.quantity&&!e.ownOrders(b).some(active))return this.finish(b);return this.wait(b);}
  if(submitted.some(o=>o.status==='REJECTED'&&!['reduce-only-resolved'].includes(o.errorKind))){if(r.closeRecovery)return this.wait(b);return false;}
  if(!e.tradingEnabled){if(!r.quantity&&!e.ownOrders(b).some(active))return this.finish(b);return this.wait(b);}
  for(const o of e.ownOrders(b).filter(active)){
   // Already-triggering protective orders and accepted market closes are read-only
   // until their result is known. Never race them with a replacement market order.
   if(o.status==='UNKNOWN'||o.childOrderId||o.kind==='algo'&&['TRIGGERING','TRIGGERED'].includes(o.algoStatus)||o.kind==='standard'&&o.parameters.type==='MARKET')continue;
   if(!intent.orders.includes(o.id))intent.orders.push(o.id);if(e.now()<Number(intent.cancelAt[o.id]||0))continue;intent.cancelAt[o.id]=e.now()+5000;await e.checkpoint();
   if(o.kind==='algo')await e.cancelGuard(b,o);else await e.cancelStandard(b,o,true);
  }
  if(e.ownOrders(b).some(active))return this.wait(b);
  for(const o of e.ownOrders(b).filter(o=>o.parameters.type==='LIMIT'&&!o.fallbackDone))o.fallbackDone=true;
  await e.refreshAccount(true);await e.syncBotPosition(b,true);if(r.syncHold)return this.wait(b);
  if(!r.quantity)return this.finish(b);
  if(intent.held&&(r.positionEpoch!==intent.epoch||r.direction!==intent.direction))return this.finish(b,{stale:true});
  if(!intent.held){intent.held=true;intent.epoch=r.positionEpoch;intent.direction=r.direction;}
  const info=await e.symbolInfo(b.symbol),filters=symbolFilters(info,'MARKET'),quantity=quantize(String(r.quantity),filters.step);if(number(quantity)<=0)throw Error('보유 수량이 거래소 청산 수량 단위보다 작습니다.');
  await e.checkpoint();e.note('전량 청산 요청',b.name+' · '+intent.reason,b.id);
  const order=await e.submit(b,{symbol:b.symbol,side:r.direction==='LONG'?'SELL':'BUY',type:'MARKET',quantity,positionSide:e.hedge?r.direction:'BOTH',...(!e.hedge?{reduceOnly:'true'}:{})},{role:'exit',closeIntentId:intent.id});
  if(order.status==='REJECTED'||order.status==='UNKNOWN')return this.wait(b);
  await e.refreshAccount(true);await e.syncBotPosition(b,true);if(!r.syncHold&&!r.quantity&&!e.ownOrders(b).some(active))return this.finish(b);return this.wait(b);
 }
}
