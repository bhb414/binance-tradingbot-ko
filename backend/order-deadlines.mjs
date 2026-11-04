import {isTemporary,isLocalRateLimit} from './binance-rate.mjs';
import {isStorageError} from './storage-recovery.mjs';
const eligible=new Set(['NEW','PARTIALLY_FILLED','UNKNOWN','CANCELED','EXPIRED']);
const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
export function orderDeadline(order,bot){
 if(order.kind!=='standard'||order.parameters.type!=='LIMIT'||order.fallbackDone||!eligible.has(order.status))return null;
 const seconds=Number((order.orderPolicy||bot.order)?.timeout),created=Number(order.createdAt);
 return Number.isFinite(seconds)&&seconds>=0&&Number.isFinite(created)?created+seconds*1000:null;
}
export class OrderDeadlines{
 constructor(engine){this.e=engine;this.checked=new Map();}
 candidates(handled=new Set()){
  const e=this.e,rows=[];
  for(const b of e.state.bots){
   const key=b.multiBotId?'multi:'+b.multiBotId:b.id;if(handled.has(key))continue;
   const deadlines=e.ownOrders(b).map(o=>orderDeadline(o,b)).filter(at=>at!==null);
   if(deadlines.length)rows.push({b,key,at:Math.max(Math.min(...deadlines),(this.checked.get(key)||0)+1000)});
  }
  return rows.sort((a,b)=>a.at-b.at||a.key.localeCompare(b.key));
 }
 due(){return this.e.connected&&this.e.tradingEnabled&&!this.e.storage.fault&&this.candidates().some(row=>row.at<=this.e.now());}
 async prepare(b){
  const e=this.e;
  // Query this symbol's owned executions before management decisions, just as a
  // regular tick does. Fee history does not block a deadline confirmation.
  for(const o of e.ownOrders(b).filter(o=>!terminal.has(o.status)))await e.pollTrackedOrder(o,()=>e.refreshOrder(b,o,{includeFees:false}),{force:true});
  await e.refreshAccount(true);await e.syncBotPosition(b);
 }
 async run(handled=new Set()){
  const e=this.e;if(!e.connected||!e.tradingEnabled||e.storage.fault)return handled;
  for(;;){
   const row=this.candidates(handled).find(item=>item.at<=e.now());if(!row)break;
   const {b,key}=row;handled.add(key);this.checked.set(key,e.now());let parent=null,workers=[b];
   try{
    if(b.multiBotId){parent=e.multi.get(b.multiBotId);workers=e.multi.workers(parent);}
    for(const worker of workers){for(const order of e.ownOrders(worker)){const at=orderDeadline(order,worker);if(at!==null&&at<=e.now()){order.timing||={};order.timing.deadlineAt=at;order.timing.dueObservedAt||=e.now();}}await this.prepare(worker);await e.tickBot(worker,{pendingOnly:true});}
    if(parent)await e.multi.tick(parent,{pendingOnly:true});
    for(const worker of workers)if(!worker.runtime.closeRecovery&&!worker.runtime.closePending&&!worker.runtime.guardWaiting)worker.runtime.waiting=null;
    if(parent)parent.runtime.waiting=null;
   }catch(error){
    if(isStorageError(error))throw error;
    if(isTemporary(error)){const wait=e.defer(error);if(isLocalRateLimit(error)){for(const worker of workers)worker.runtime.waiting=wait;if(parent)parent.runtime.waiting=wait;continue;}throw error;}
    if(parent){parent.runtime.runEnabled=false;parent.runtime.cancelEntries=true;parent.runtime.error=e.client.redact?.(error.message)||error.message;for(const worker of workers)worker.runtime.runEnabled=false;e.note('다중종목 확인 필요',parent.name+' · '+parent.runtime.error,parent.id,'error');}
    else{b.runtime.runEnabled=false;b.runtime.waiting=null;b.runtime.error=e.client.redact?.(error.message)||error.message;e.note('봇 확인 필요',b.name+' · '+b.runtime.error,b.id,'error');}
   }
  }
  return handled;
 }
}
