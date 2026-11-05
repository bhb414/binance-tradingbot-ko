import {randomUUID} from 'node:crypto';
import {isStorageError} from './storage-recovery.mjs';
const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const active=o=>!terminal.has(o.status);
export const automationEnabled=r=>Boolean(r?.runEnabled||r?.managementEnabled);
// A stop never closes a holding. Only this bot's recorded exchange orders are
// canceled, and unconfirmed cancellations remain durable across restarts.
export class BotStop{
 constructor(engine){this.e=engine;}
 mark(b){const r=b.runtime;r.stopRequestId=randomUUID();r.runEnabled=false;r.managementEnabled=false;r.entryBlocked=null;r.orderRetries={};r.guardKey=null;delete r.closePending;delete r.closeRecovery;delete r.guardWaiting;
  for(const o of this.e.ownOrders(b))if(o.kind==='standard'&&o.parameters.type==='LIMIT')o.fallbackDone=true;
  r.stopPending=this.e.ownOrders(b).some(active)?{at:this.e.now(),retryAt:0}:null;r.waiting=null;if(r.stopPending)this.wait(b);
 }
 wait(b,message='봇 정지 · 미체결·TP/SL 취소 확인 중'){b.runtime.waiting={kind:'bot-stop',message,retryAt:b.runtime.stopPending.retryAt};return false;}
 due(){return this.e.connected&&this.e.state.bots.some(b=>b.runtime.stopPending&&this.e.now()>=b.runtime.stopPending.retryAt);}
 async advance(b,{force=false}={}){const e=this.e,r=b.runtime,p=r.stopPending;if(!p)return true;if(!e.connected||!force&&e.now()<p.retryAt)return this.wait(b);p.retryAt=e.now()+3000;await e.checkpoint();
  try{for(const o of e.ownOrders(b).filter(active)){
   if(o.status==='UNKNOWN'||o.childOrderId||o.kind==='standard'&&o.parameters.type==='MARKET'||['TRIGGERING','TRIGGERED'].includes(o.algoStatus)){await e.refreshOrder(b,o);if(!active(o))continue;}
   if(o.status==='UNKNOWN'||o.childOrderId||o.kind==='standard'&&o.parameters.type==='MARKET'||['TRIGGERING','TRIGGERED'].includes(o.algoStatus))continue;
   if(o.kind==='algo')await e.cancelGuard(b,o);else await e.cancelStandard(b,o,true);
  }
  if(e.ownOrders(b).some(active)){this.wait(b);await e.checkpoint();return false;}
  r.stopPending=null;if(r.waiting?.kind==='bot-stop')r.waiting=null;e.note('봇 정지 완료',b.name+' · 자동 매매 중지 · 미체결·TP/SL 취소 확인 · 보유 포지션 유지',b.id);await e.checkpoint();return true;
  }catch(error){if(isStorageError(error))throw error;p.retryAt=Math.max(p.retryAt,Number(error.retryAt)||0);this.wait(b,'봇 정지 · 주문 취소 재확인 대기: '+(e.client.redact?.(error.message)||error.message));await e.checkpoint();return false;}
 }
 async run(){for(const b of this.e.state.bots)if(b.runtime.stopPending)await this.advance(b);}
}
