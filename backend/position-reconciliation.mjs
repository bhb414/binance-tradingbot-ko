import {createHash} from 'node:crypto';
import {isTemporary} from './binance-rate.mjs';
const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const near=(a,b)=>Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*1e-8);
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const positive=v=>finite(v)&&Number(v)>0;
export function externalReductionPlan({bot,state,trades,actual,now}){
 const r=bot.runtime;if(!(r.quantity>actual&&actual>=0)||!['LONG','SHORT'].includes(r.direction)||!positive(r.entryPrice)||!Array.isArray(trades)||!trades.length||trades.length>=1000)return null;
 const rows=[...trades].sort((a,b)=>Number(a.time)-Number(b.time)||Number(a.id)-Number(b.id)),ids=new Set();
 for(const t of rows){if(t.symbol!==bot.symbol||t.positionSide!=='BOTH'||!Number.isSafeInteger(Number(t.id))||!Number.isSafeInteger(Number(t.orderId))||!positive(t.qty)||!positive(t.price)||!positive(t.time)||!finite(t.realizedPnl)||!finite(t.commission)||typeof t.commissionAsset!=='string'||!t.commissionAsset||ids.has(String(t.id)))return null;ids.add(String(t.id));}
 const fills=state.fills.filter(f=>f.scope===state.scope&&f.botId===bot.id&&f.symbol===bot.symbol&&f.positionEpoch===r.positionEpoch&&positive(f.quantity)),owned=state.orders.filter(o=>o.scope===state.scope&&o.botId===bot.id&&o.parameters.symbol===bot.symbol&&fills.some(f=>f.clientOrderId===o.id)),known=new Set(owned.map(o=>String(o.orderId)));
 const imported=(state.positionImports||[]).find(p=>p.scope===state.scope&&p.id===r.imported?.id&&p.botId===bot.id&&p.symbol===bot.symbol&&p.direction===r.direction&&r.lastExitAt<p.at);
 const expected=(imported?.quantity||0)+fills.reduce((n,f)=>n+(f.role==='entry'?1:-1)*f.quantity,0);
 if(!near(expected,r.quantity)||!fills.some(f=>f.role==='entry')&&!imported||fills.some(f=>!owned.some(o=>o.id===f.clientOrderId)))return null;
 for(const o of owned){const found=rows.filter(t=>String(t.orderId)===String(o.orderId));if(!terminal.has(o.status)||!found.length||!near(found.reduce((n,t)=>n+Number(t.qty),0),Number(o.appliedQty))||found.some(t=>t.side!==o.parameters.side))return null;}
 const ownedRows=rows.filter(t=>known.has(String(t.orderId))),entryRows=ownedRows.filter(t=>owned.find(o=>String(o.orderId)===String(t.orderId))?.role==='entry'),start=imported?.at||Math.min(...entryRows.map(t=>Number(t.time))),last=Math.max(imported?.at||0,...ownedRows.map(t=>Number(t.time)));
 if(!positive(start)||now-start>7*86400000||start>now||ownedRows.some(t=>Number(t.time)>now))return null;
 const outside=rows.filter(t=>Number(t.time)>=start&&!known.has(String(t.orderId)));if(!outside.length||outside.some(t=>Number(t.time)<=last))return null;
 const target=r.quantity-actual,side=r.direction==='LONG'?'SELL':'BUY',selected=[];let total=0;
 for(const t of outside){const quantity=Number(t.qty),price=Number(t.price),pnl=(price-r.entryPrice)*quantity*(r.direction==='LONG'?1:-1);
  if(t.side!==side||Number(t.time)>now||total+quantity>target+1e-9||Math.abs(Number(t.realizedPnl)-pnl)>Math.max(1e-6,Math.abs(pnl)*1e-6))return null;
  selected.push(t);total+=quantity;if(near(total,target))break;
 }
 if(!near(total,target)||actual>0&&selected.length!==outside.length)return null;
 const orders=[];for(const id of new Set(selected.map(t=>String(t.orderId))))orders.push({orderId:id,trades:selected.filter(t=>String(t.orderId)===id)});
 return {orders,quantity:total,remaining:actual,closedAt:Number(selected.at(-1).time)};
}
export class PositionReconciliation{
 constructor(engine){this.e=engine;this.checks=new WeakMap();}
 async reconcile(b,mismatchError){
  const e=this.e,r=b.runtime;if(!e.connected||e.hedge||!r.quantity||r.importPending||r.error&&r.error!==mismatchError||e.manual.records.some(o=>!terminal.has(o.status)&&o.parameters.symbol===b.symbol)||e.state.bots.some(other=>other!==b&&other.symbol===b.symbol&&(other.runtime.quantity||other.runtime.runEnabled||e.ownOrders(other).some(o=>!terminal.has(o.status)))))return false;
  const migrating=e.shared.supported&&!e.shared.active(b.symbol),own=e.ownOrders(b);if(own.some(o=>!terminal.has(o.status)&&(o.kind==='standard'||o.status==='UNKNOWN')||o.parameters.type==='LIMIT'&&!o.fallbackDone&&(o.orderPolicy||b.order).remainder==='market'&&['CANCELED','EXPIRED'].includes(o.status)))return false;
  const position=()=>e.accountSnapshot?.positions.find(p=>p.symbol===b.symbol&&Math.abs(p.quantity)>0),p=position(),actual=Math.abs(p?.quantity||0);
  if(!migrating&&(actual>=r.quantity||p&&((p.quantity>0)!==(r.direction==='LONG')||!near(p.entryPrice,r.entryPrice))))return false;
  const key=JSON.stringify([e.state.scope,r.positionEpoch,r.quantity,r.entryPrice,r.lastExitAt,actual]),old=this.checks.get(b);if(old?.client===e.client&&old.key===key&&e.now()-old.at<30000)return false;
  this.checks.set(b,{client:e.client,key,at:e.now()});
  try{
   const trades=await e.client.trades(b.symbol),plan=(migrating?externalReductionPlan({bot:b,state:e.state,trades,actual:0,now:e.now()+(e.client.offset||0)}):null)||externalReductionPlan({bot:b,state:e.state,trades,actual,now:e.now()+(e.client.offset||0)});if(!plan)return false;
   const open=await e.client.openOrders(b.symbol),response=await e.client.openAlgoOrders(b.symbol),algos=Array.isArray(response)?response:response?.orders;
   if(!Array.isArray(open)||!Array.isArray(algos)||!migrating&&(open.length||algos.some(a=>!own.some(o=>o.id===a.clientAlgoId&&o.kind==='algo'&&o.status!=='UNKNOWN'))))return false;
   for(const group of plan.orders){
    const o=await e.client.queryOrder(b.symbol,{orderId:group.orderId}),q=group.trades.reduce((n,t)=>n+Number(t.qty),0),quote=group.trades.reduce((n,t)=>n+Number(t.qty)*Number(t.price),0);
    if(!o||o.symbol!==b.symbol||String(o.orderId)!==group.orderId||!terminal.has(o.status)||o.side!==(r.direction==='LONG'?'SELL':'BUY')||o.positionSide!=='BOTH'||o.reduceOnly!==true||!near(Number(o.executedQty),q)||!near(Number(o.cumQuote),quote)||e.state.orders.some(saved=>saved.scope===e.state.scope&&saved.parameters.symbol===b.symbol&&String(saved.orderId)===group.orderId))return false;group.native=o;
   }
   await e.refreshAccount(true);const current=position();if(!migrating&&(!near(Math.abs(current?.quantity||0),actual)||current&&((current.quantity>0)!==(r.direction==='LONG')||!near(current.entryPrice,r.entryPrice))))return false;
   for(const group of plan.orders){
    const native=group.native,id='fw_external_'+createHash('sha256').update(e.state.scope+':'+b.id+':'+b.symbol+':'+group.orderId).digest('hex').slice(0,20),o={id,botId:b.id,scope:e.state.scope,kind:'standard',role:'exit',source:'exchange-close',parameters:{symbol:b.symbol,side:native.side,type:native.type,quantity:String(native.executedQty),positionSide:'BOTH',reduceOnly:'true'},margin:0,group:id,status:'NEW',createdAt:Number(native.time),appliedQty:0,appliedQuote:0,feesFetched:true,fallbackDone:true,orderId:native.orderId,exchangeClientOrderId:native.clientOrderId,direction:r.direction,leverage:b.leverage,marginType:b.margin};e.state.orders.push(o);
    let quantity=0,quote=0;for(const t of group.trades){quantity+=Number(t.qty);quote+=Number(t.qty)*Number(t.price);await e.applyOrder(b,o,{orderId:native.orderId,executedQty:String(quantity),cumQuote:String(quote),status:native.status,updateTime:Number(t.time)});const fill=e.state.fills.at(-1);if(fill?.clientOrderId===id&&fill.role==='exit')fill.at=Number(t.time);const fee=Number(t.commission);if(t.commissionAsset==='USDT')r.realized-=fee;e.state.fills.push({id:'fee:'+o.scope+':'+b.symbol+':'+o.orderId+':'+t.id,scope:o.scope,botId:b.id,at:Number(t.time),symbol:b.symbol,fee,feeAsset:t.commissionAsset,clientOrderId:id,orderId:o.orderId,tradeId:t.id,tradeQuantity:Number(t.qty),tradePrice:Number(t.price),leverage:b.leverage,direction:r.direction,exchangeRealizedPnl:Number(t.realizedPnl)});}
   }
   if(!r.quantity)r.lastExitAt=Math.min(e.now(),plan.closedAt-(e.client.offset||0));r.syncHold=false;r.mismatchSince=0;r.error=null;r.waiting=null;r.guardKey=null;r.lastEvaluation=null;r.reconciledReduction={at:e.now(),closedAt:plan.closedAt,quantity:plan.quantity,remaining:r.quantity,orderIds:plan.orders.map(o=>o.orderId)};
   if(b.multiBotId){const parent=e.multi.get(b.multiBotId);if([b.name+' · '+mismatchError,b.name+' · 포지션 확인 필요'].includes(parent.runtime.error)&&e.multi.workers(parent).every(member=>!member.runtime.syncHold&&!member.runtime.error))parent.runtime.error=null;}
   if(migrating&&!e.storage.checking)await e.shared.ensure(b.symbol);
   e.positionInsights.cache=null;e.note('외부 정리 체결 반영',b.name+' · 거래소에서 정리한 '+plan.quantity+'개와 실제 수수료 반영 · 남은 보유 '+r.quantity+'개',b.id);if(!e.storage.checking)await e.checkpoint();return true;
  }catch(error){if(isTemporary(error))this.checks.delete(b);throw error;}
 }
}
