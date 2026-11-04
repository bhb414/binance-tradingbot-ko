import {isTemporary} from './binance-rate.mjs';
const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const active=o=>!terminal.has(o.status),number=v=>Number(v)||0,eps=1e-9;
export function pendingMarketRemainder(order,bot){return order.kind==='standard'&&order.parameters.type==='LIMIT'&&!order.fallbackDone&&['CANCELED','EXPIRED'].includes(order.status)&&(order.orderPolicy||bot.order)?.remainder==='market'&&number(order.parameters.quantity)-number(order.appliedQty)>eps;}
export function definiteReduceOnlyRejection(error,order){return order.kind==='standard'&&order.role!=='entry'&&[true,'true'].includes(order.parameters.reduceOnly)&&Number(error?.code)===-2022&&!error.uncertain&&!error.temporary&&(!error.status||error.status>=400&&error.status<500&&![418,429].includes(error.status));}
export class CloseOrderRecovery{
 constructor(engine){this.e=engine;}
 position(b,o){return this.e.rulePosition(b,{closeScope:o.closeScope||'bot',action:'EXIT_'+(o.direction||b.runtime.direction)});}
 stale(b,o){const p=this.position(b,o);return !(p.quantity>eps)||o.direction&&p.direction!==o.direction||o.positionEpoch!=null&&p.positionEpoch!=null&&o.positionEpoch!==p.positionEpoch||o.positionEpoch==null&&o.closeScope!=='account'&&number(b.runtime.lastExitAt)>o.createdAt;}
 begin(b,o,{legacy=false}={}){const r=b.runtime;o.errorKind='reduce-only-reconcile';o.fallbackDone=true;o.feesFetched=true;r.closeRecovery={orderId:o.id,at:this.e.now(),retryAt:0,deadline:this.e.now()+15000,previousError:legacy?r.error:null};r.syncHold=true;this.wait(b);}
 recoverLegacy(){for(const b of this.e.state.bots){const r=b.runtime;if(r.quantity||r.closeRecovery||!r.error)continue;const o=[...this.e.ownOrders(b)].reverse().find(o=>o.status==='REJECTED'&&Number(o.errorCode)===-2022&&definiteReduceOnlyRejection({code:-2022},o));if(o&&[o.error,'조건 주문이 거절되었습니다: '+o.error].includes(r.error))this.begin(b,o,{legacy:true});}}
 wait(b){b.runtime.syncHold=true;b.runtime.waiting={kind:'reconciliation',message:'정리 체결 대조 중 · 확인 후 자동 재개',retryAt:b.runtime.closeRecovery.retryAt||this.e.now()+1000};}
 async rejected(b,o,error){if(!definiteReduceOnlyRejection(error,o))return false;this.begin(b,o);await this.e.checkpoint();await this.reconcile(b);return true;}
 async reconcile(b){
  const e=this.e,r=b.runtime,record=r.closeRecovery;if(!record)return true;if(!e.connected||e.now()<record.retryAt){this.wait(b);return false;}
  const o=e.ownOrders(b).find(o=>o.id===record.orderId);if(!o){r.runEnabled=false;r.error='정리 거절 주문의 원장을 확인해 주세요.';delete r.closeRecovery;return false;}
  record.retryAt=e.now()+3000;
  try{
   for(const other of e.ownOrders(b).filter(other=>other!==o&&active(other)))await e.refreshOrder(b,other);
   await e.refreshAccount(true);await e.syncBotPosition(b,true);
   if(r.syncHold||e.ownOrders(b).some(other=>other!==o&&other.status==='UNKNOWN')){this.wait(b);return false;}
   const position=this.position(b,o),flat=this.stale(b,o);
   const covering=e.ownOrders(b).filter(other=>other!==o&&other.kind==='standard'&&other.role!=='entry'&&active(other)&&other.parameters.symbol===b.symbol&&other.parameters.side===o.parameters.side&&(other.closeScope||'bot')===(o.closeScope||'bot'));
   const covered=covering.reduce((sum,other)=>sum+Math.max(0,number(other.parameters.quantity)-number(other.appliedQty)),0)>=number(position.quantity)-eps&&covering.length>0;
   if(flat||covered){o.errorKind='reduce-only-resolved';o.closeResolution=flat?'already-closed':'covered-by-existing-close';o.resolvedAt=e.now();if([record.previousError,o.error,'조건 주문이 거절되었습니다: '+o.error].filter(Boolean).includes(r.error))r.error=null;r.waiting=null;r.syncHold=false;delete r.closeRecovery;e.note('정리 주문 대조 완료',b.name+' · '+(flat?'이미 정리된 보유분 확인 · 추가 주문 없음':'기존 정리 주문 확인 · 중복 전송 없음'),b.id);await e.checkpoint();return true;}
   if(e.now()<record.deadline){this.wait(b);return false;}
   r.error=o.error;r.runEnabled=false;r.waiting=null;r.syncHold=false;o.errorKind='reduce-only-unresolved';delete r.closeRecovery;e.note('정리 주문 확인 필요',b.name+' · 거래소에 보유 수량이 남아 있습니다. '+o.error,b.id,'error');await e.checkpoint();return false;
  }catch(error){if(isTemporary(error)){record.retryAt=Math.max(record.retryAt,Number(error.retryAt)||0);e.defer(error);this.wait(b);await e.checkpoint();return false;}throw error;}
 }
}
