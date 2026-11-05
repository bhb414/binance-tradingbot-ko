import {createHash} from 'node:crypto';
import {isTemporary} from './binance-rate.mjs';
import {sharedQuantityPending,reconcileConfirmedSharedFees} from './confirmed-shared-fees.mjs';
const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const number=v=>Number(v||0),near=(a,b)=>Math.abs(a-b)<=Math.max(1e-8,Math.abs(b)*1e-8);
const fields=['quantity','entryPrice','entries','realized','lastEntryAt','lastExitAt','positionEpoch','direction'];
const finance=b=>Object.fromEntries(fields.map(k=>[k,b.runtime[k]??(k==='direction'?null:0)]));
const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,24);
function lotQuantity(value,step){
 const units=Math.round(value/step),[base,exponent='0']=String(step).toLowerCase().split('e'),places=Math.max(0,(base.split('.')[1]||'').length-Number(exponent));
 if(!(step>0)||!Number.isSafeInteger(units))throw Error('공유 수량 단위를 확인하세요.');
 const quantity=Number((units*step).toFixed(places));if(Math.abs(value-quantity)>Math.max(1e-10,step*1e-7))throw Error('공유 수량 단위를 확인하세요.');return quantity;
}
function portions(pools,quantity,step,preferred){
 const units=Math.round(quantity/step),eligible=pools.filter(p=>p.quantity>1e-10),out=new Map();if(!Number.isSafeInteger(units))throw Error('공유 수량 단위를 확인하세요.');
 let remaining=units;const first=preferred&&eligible.find(p=>p.id===preferred);
 if(first){const take=Math.min(remaining,Math.round(first.quantity/step));out.set(first.id,take);remaining-=take;}
 const rest=eligible.filter(p=>!first||p.id!==first.id),total=rest.reduce((n,p)=>n+Math.round(p.quantity/step),0);
 if(remaining&&total){const ranked=rest.map(p=>{const exact=remaining*Math.round(p.quantity/step)/total,floor=Math.floor(exact);out.set(p.id,floor);return {id:p.id,remainder:exact-floor};}).sort((a,b)=>b.remainder-a.remainder||String(a.id).localeCompare(String(b.id)));let missing=remaining-ranked.reduce((n,p)=>n+out.get(p.id),0);for(const item of ranked){if(!missing--)break;out.set(item.id,out.get(item.id)+1);}}
 return eligible.map(p=>({pool:p,quantity:lotQuantity((out.get(p.id)||0)*step,step)})).filter(p=>p.quantity>1e-10);
}
export function replayShared(book,trades,parents,step){
 const members=structuredClone(book.members),manual=structuredClone(book.manual),allocations=[],events=[],epochs={LONG:0,SHORT:0,...book.epochs},entryOrders=new Set(book.entryOrders||[]);
 for(const pool of [...Object.values(members),...Object.values(manual)])pool.quantity=lotQuantity(pool.quantity,step);
 // Migrate old native-order keys for the currently held cycle to logical groups.
 for(const parent of parents.values()){const member=members[parent.botId];if(member?.quantity>0&&parent.createdAt>=member.lastExitAt&&entryOrders.has(parent.botId+':'+parent.orderId))entryOrders.add(parent.botId+':'+member.positionEpoch+':'+(parent.group||parent.id||parent.orderId));}
 const poolFor=(id,direction)=>{if(id){const p=members[id];if(!p)throw Error('공유 봇 기록을 확인하세요.');return p;}return manual[direction]||=( {id:null,direction,quantity:0,entryPrice:0} );};
 const rows=[...trades].sort((a,b)=>number(a.time)-number(b.time)||number(a.id)-number(b.id)),seen=new Set();
 for(const t of rows){
  if(t.symbol!==book.symbol||seen.has(String(t.id))||!(number(t.id)>0)||!(number(t.orderId)>0)||!Number.isSafeInteger(number(t.id))||!Number.isSafeInteger(number(t.orderId))||!(number(t.qty)>0&&number(t.price)>0&&number(t.time)>0)||!['BUY','SELL'].includes(t.side)||!['BOTH','LONG','SHORT'].includes(t.positionSide)||t.commission==null||t.commission===''||!Number.isFinite(Number(t.commission))||typeof t.commissionAsset!=='string'||!t.commissionAsset)throw Error('공유 체결 응답을 확인하세요.');seen.add(String(t.id));lotQuantity(number(t.qty),step);
  const parent=parents.get(String(t.orderId)),owner=parent?.botId&&members[parent.botId]?parent.botId:null,openDirection=t.side==='BUY'?'LONG':'SHORT',closeDirection=t.positionSide==='BOTH'?(openDirection==='LONG'?'SHORT':'LONG'):t.positionSide,isClose=t.positionSide==='BOTH'||openDirection!==t.positionSide;
  const closing=isClose?[...Object.values(members),...Object.values(manual)].filter(p=>p.direction===closeDirection&&p.quantity>1e-10):[],total=closing.reduce((n,p)=>n+p.quantity,0),closed=Math.min(number(t.qty),total);
  if(closed>1e-10)for(const part of portions(closing,closed,step,parent&&parent.role!=='entry'&&parent.closeScope!=='account'?owner:null)){
   const p=part.pool,quantity=part.quantity,fee=number(t.commission)*quantity/number(t.qty);
   if(p.id){const grossPnl=(number(t.price)-p.entryPrice)*quantity*(p.direction==='LONG'?1:-1);p.realized+=grossPnl;if(t.commissionAsset==='USDT')p.realized-=fee;allocations.push({botId:p.id,role:'exit',direction:p.direction,quantity,price:number(t.price),grossPnl,fee,trade:t,parent,epoch:p.positionEpoch,beforeQuantity:p.quantity,beforePrice:p.entryPrice});}
   p.quantity=lotQuantity(Math.max(0,p.quantity-quantity),step);if(p.quantity<step*.1){p.quantity=0;p.entryPrice=0;if(p.id){p.entries=0;p.lastExitAt=number(t.time);}}
  }
  const opened=lotQuantity(number(t.qty)-closed,step);
  if(opened>step*.1){if(t.positionSide!=='BOTH'&&isClose)throw Error('계좌 정리 수량을 확인하세요.');const direction=t.positionSide==='BOTH'?openDirection:t.positionSide,p=poolFor(owner,direction),fee=number(t.commission)*opened/number(t.qty),beforeQuantity=p.quantity,beforePrice=p.entryPrice;if(![...Object.values(members),...Object.values(manual)].some(pool=>pool.direction===direction&&pool.quantity>1e-10))epochs[direction]++;if(p.quantity>0&&p.direction!==direction)throw Error('공유 포지션 방향 대조 대기');if(!p.quantity&&p.id)p.positionEpoch++;p.direction=direction;p.entryPrice=(p.quantity*p.entryPrice+opened*number(t.price))/(p.quantity+opened);p.quantity=lotQuantity(p.quantity+opened,step);
   if(p.id){const key=p.id+':'+p.positionEpoch+':'+(parent?.group||parent?.id||t.orderId);if(!entryOrders.has(key)){p.entries++;entryOrders.add(key);}p.lastEntryAt=number(t.time);if(t.commissionAsset==='USDT')p.realized-=fee;allocations.push({botId:p.id,role:'entry',direction,quantity:opened,price:number(t.price),fee,trade:t,parent,epoch:p.positionEpoch,beforeQuantity,beforePrice});}
  }
  events.push({at:number(t.time),tradeId:number(t.id),pools:[...Object.values(members),...Object.values(manual)].filter(p=>p.quantity>1e-10).map(p=>({botId:p.id,direction:p.direction,quantity:p.quantity}))});
 }
 return {members,manual,allocations,events,epochs,entryOrders:[...entryOrders]};
}
export class SharedPositions{
 constructor(engine){this.e=engine;this.busy=new Set();this.checks=new Map();}
 get supported(){return typeof this.e.client?.tradesAfter==='function';}
 get books(){return this.e.state.sharedPositions||={};}
 key(symbol){return this.e.state.scope+'|'+symbol;}
 book(symbol){return this.books[this.key(symbol)];}
 active(symbol){return this.supported&&!!this.book(symbol);}
 holdings(symbol){return this.e.accountSnapshot?.positions.filter(p=>p.symbol===symbol&&Math.abs(p.quantity)>1e-10)||[];}
 exposure(symbol){return this.holdings(symbol).length>0||this.e.accountSnapshot?.orders.some(o=>o.symbol===symbol);}
 leverage(b,desired){const p=this.holdings(b.symbol)[0];return this.exposure(b.symbol)?number(p?.leverage)||b.leverage:desired;}
 syncSettings(symbol,config){for(const b of this.e.state.bots.filter(b=>b.symbol===symbol)){b.margin=String(config.marginType||config.margin).toUpperCase();b.leverage=number(config.leverage);}}
 actual(symbol){return this.holdings(symbol).map(p=>({direction:p.quantity>0?'LONG':'SHORT',quantity:Math.abs(p.quantity),entryPrice:p.entryPrice}));}
 matches(symbol,sim){const actual=this.actual(symbol);for(const direction of ['LONG','SHORT']){const expected=[...Object.values(sim.members),...Object.values(sim.manual)].filter(p=>p.direction===direction).reduce((n,p)=>n+p.quantity,0),observed=actual.filter(p=>p.direction===direction).reduce((n,p)=>n+p.quantity,0);if(!near(expected,observed))return false;}return true;}
 async ensure(symbol){
  if(!this.supported)return false;if(this.book(symbol))return true;const e=this.e,all=e.state.bots.filter(b=>b.symbol===symbol);
  for(const b of all.filter(b=>b.runtime.quantity&&!e.positionMatches(b)&&(!b.runtime.error||b.runtime.error===e.positionMismatchError))){await e.positionReconciliation.reconcile(b,e.positionMismatchError);if(this.book(symbol))return true;}
  if(e.state.orders.some(o=>o.scope===e.state.scope&&o.parameters.symbol===symbol&&o.kind==='standard'&&!terminal.has(o.status)))return false;
  await e.refreshAccount(true);const before=JSON.stringify(this.actual(symbol)),rows=await e.client.trades(symbol);await e.refreshAccount(true);if(before!==JSON.stringify(this.actual(symbol)))return false;if(!Array.isArray(rows))throw Error('공유 계좌 체결 조회 대기');
  const step=number((await e.symbolInfo(symbol)).filters.find(f=>f.filterType==='LOT_SIZE')?.stepSize);if(!(step>0))throw Error('공유 수량 단위 확인 필요');
  const book={scope:e.state.scope,symbol,cursor:Math.max(0,...rows.map(t=>number(t.id))),at:e.now(),members:Object.fromEntries(all.map(b=>[b.id,{id:b.id,...finance(b)}])),manual:{},epochs:{LONG:this.actual(symbol).some(p=>p.direction==='LONG')?1:0,SHORT:this.actual(symbol).some(p=>p.direction==='SHORT')?1:0},entryOrders:[],pending:false};
  for(const direction of ['LONG','SHORT']){const p=this.actual(symbol).find(p=>p.direction===direction),held=all.filter(b=>b.runtime.direction===direction).reduce((n,b)=>n+b.runtime.quantity,0);if(held>(p?.quantity||0)+1e-8)return false;const quantity=lotQuantity((p?.quantity||0)-held,step);if(quantity>0){const botCost=all.filter(b=>b.runtime.direction===direction).reduce((n,b)=>n+b.runtime.quantity*b.runtime.entryPrice,0),entryPrice=((p?.quantity||0)*(p?.entryPrice||0)-botCost)/quantity;if(!(entryPrice>0&&Number.isFinite(entryPrice)))throw Error('수동 보유분의 평균 진입가를 확인할 수 없습니다.');book.manual[direction]={id:null,direction,quantity,entryPrice};}}
  this.books[this.key(symbol)]=book;e.state.sharedEvents||=[];e.state.sharedEvents.push({scope:e.state.scope,symbol,at:e.now(),pools:[...Object.values(book.members),...Object.values(book.manual)].filter(p=>p.quantity>1e-10).map(p=>({botId:p.id,direction:p.direction,quantity:p.quantity}))});await e.checkpoint();return true;
 }
 async accepted(b,o,data){
  const q=number(data.executedQty),quote=number(data.cumQuote||data.cumQuoteQty)||q*number(data.avgPrice);if(q+1e-12<o.appliedQty)throw Error('주문 누적 체결 수량이 감소했습니다.');
  const confirmed=o.feesFetched&&!o.sharedPending&&!sharedQuantityPending(q,number(o.appliedQty))&&!sharedQuantityPending(number(o.appliedQty),q);
  o.orderId=data.orderId||o.orderId;o.status=data.status||o.status;o.sharedManaged=true;o.sharedPending=sharedQuantityPending(q,number(o.sharedRecordedQty));o.appliedQty=q;o.appliedQuote=quote;o.feesFetched=q===0||confirmed&&!o.sharedPending;if(q>0&&!o.sharedPending&&!o.feesFetched)reconcileConfirmedSharedFees(this.e.state,o);
  try{await this.sync(o.parameters.symbol,{force:o.sharedPending});}catch(error){if(!isTemporary(error))throw error;this.e.defer(error);}
  if(q>0&&!o.feesFetched)reconcileConfirmedSharedFees(this.e.state,o);
 }
 watched(book){const e=this.e,symbol=book.symbol;return book.pending||this.exposure(symbol)||Object.values(book.members).some(p=>p.quantity>1e-10)||Object.values(book.manual).some(p=>p.quantity>1e-10)||e.state.bots.some(b=>b.symbol===symbol&&(b.runtime.runEnabled||b.runtime.quantity||b.runtime.syncHold))||e.state.orders.some(o=>o.scope===e.state.scope&&o.parameters.symbol===symbol&&(!terminal.has(o.status)||o.parameters.type==='LIMIT'&&!o.fallbackDone&&['CANCELED','EXPIRED'].includes(o.status)&&(o.orderPolicy?.remainder||'cancel')==='market'));}
 async syncAll({beforeEach=async()=>{}}={}){for(const book of Object.values(this.books).filter(b=>b.scope===this.e.state.scope)){await beforeEach();await this.sync(book.symbol);}}
 async sync(symbol,{force=false}={}){
  const e=this.e,book=this.book(symbol);if(!book||this.busy.has(symbol))return !!book&&!book.pending;
  const check=this.checks.get(symbol),watched=this.watched(book),revision=e.client.accountRevision||0,interval=book.pending?1000:e.client.userStream?.status==='connected'?30000:(e.state.dataTransport?.restIntervalSeconds||15)*1000;
  if(!force&&!watched&&check&&e.now()-check.at<300000)return true;
  if(!force&&check?.revision===revision&&e.now()-check.at<interval&&(book.pending||this.matches(symbol,book)))return !book.pending;this.checks.set(symbol,{at:e.now(),revision});this.busy.add(symbol);
  try{
   for(const b of e.state.bots.filter(b=>b.symbol===symbol))if(!book.members[b.id]){if(b.runtime.quantity)throw Error('공유 봇 배정 수량 확인 필요');book.members[b.id]={id:b.id,...finance(b)};}
   for(const id of Object.keys(book.members))if(!e.state.bots.some(b=>b.id===id&&b.symbol===symbol)){if(book.members[id].quantity)throw Error('공유 보유 봇 설정 확인 필요');delete book.members[id];}
   const rows=[];let from=book.cursor+1;
   for(let page=0;page<5;page++){const batch=await e.client.tradesAfter(symbol,from);if(!Array.isArray(batch))throw Error('공유 체결 응답 확인 필요');rows.push(...batch);if(batch.length<1000)break;from=Math.max(...batch.map(t=>number(t.id)))+1;if(page===4)throw Error('공유 체결 대조 범위를 확인하세요.');}
   const parents=new Map();for(const o of e.state.orders.filter(o=>o.scope===e.state.scope&&o.kind!=='ledger'&&o.parameters.symbol===symbol&&o.orderId))parents.set(String(o.orderId),o);
   for(const id of new Set(rows.map(t=>String(t.orderId))))if(!parents.has(id)){const native=await e.client.queryOrder(symbol,{orderId:id}),known=e.state.orders.find(o=>o.scope===e.state.scope&&o.id===native.clientOrderId&&o.parameters.symbol===symbol);if(known){known.orderId=native.orderId;known.status=native.status;known.appliedQty=number(native.executedQty);known.appliedQuote=number(native.cumQuote);known.sharedManaged=true;known.sharedPending=true;parents.set(id,known);}}
   for(const o of parents.values())if(o.sharedPending){const nativeQty=rows.filter(t=>String(t.orderId)===String(o.orderId)).reduce((n,t)=>n+number(t.qty),0);if(nativeQty+number(o.sharedRecordedQty)+1e-8<o.appliedQty){book.pending=true;return false;}}
   const step=number((await e.symbolInfo(symbol)).filters.find(f=>f.filterType==='LOT_SIZE')?.stepSize);if(!(step>0))throw Error('공유 수량 단위 확인 필요');
   const sim=replayShared(book,rows,parents,step),push=e.client.userStream?.status==='connected';if(rows.length||book.pending||!push||!this.matches(symbol,sim)||e.now()-e.accountAt>=30000||e.accountRevisionAt!==e.client.accountRevision)await e.refreshAccount(true);const config=this.holdings(symbol)[0];if(config?.leverage&&config.marginType)this.syncSettings(symbol,config);if(!this.matches(symbol,sim)){book.pending=true;return false;}
   const budgetOffsets=new Map();
   for(const allocation of sim.allocations){
    const {trade:t,parent}=allocation,b=e.bot(allocation.botId),id='fw_share_'+digest(e.state.scope+':'+symbol+':'+t.orderId+':'+b.id+':'+allocation.role+':'+allocation.direction);let order=e.state.orders.find(o=>o.id===id);
    if(!order){order={id,scope:e.state.scope,botId:b.id,kind:'ledger',source:parent?.botId?'shared-allocation':'exchange-close',origin:parent?.source||null,role:allocation.role,direction:allocation.direction,leverage:parent?.leverage||b.leverage,marginType:b.margin,parent:parent?.id||null,orderId:t.orderId,status:'FILLED',parameters:{symbol,side:t.side,type:parent?.parameters.type||'MARKET',quantity:'0',positionSide:t.positionSide},margin:0,createdAt:number(t.time),appliedQty:0,appliedQuote:0,feesFetched:true,fallbackDone:true};e.state.orders.push(order);}
    const key=id+':trade:'+t.id;if(e.state.fills.some(f=>f.id===key))continue;const root=b.multiBotId?e.multi.get(b.multiBotId):b,rootId=root.id;let offset=budgetOffsets.get(rootId)||0;const realizedBefore=()=> (b.multiBotId?e.multi.realized(root):number(b.runtime.realized))+offset;if(allocation.role==='exit'){e.recordBudgetProfit(b,allocation.grossPnl,{realizedBefore:realizedBefore()});offset+=allocation.grossPnl;}if(t.commissionAsset==='USDT'){e.recordBudgetFee(b,allocation.fee,{realizedBefore:realizedBefore()});offset-=allocation.fee;}budgetOffsets.set(rootId,offset);order.appliedQty+=allocation.quantity;order.appliedQuote+=allocation.quantity*allocation.price;order.parameters.quantity=String(order.appliedQty);
    e.state.fills.push({id:key,scope:e.state.scope,botId:b.id,symbol,at:number(t.time),tradeTime:number(t.time),role:allocation.role,action:(allocation.role==='entry'?'ENTER_':'EXIT_')+allocation.direction,side:t.side,direction:allocation.direction,quantity:allocation.quantity,price:allocation.price,clientOrderId:id,orderId:t.orderId,leverage:order.leverage,positionEpoch:allocation.epoch});
    e.state.fills.push({id:'fee:'+key,scope:e.state.scope,botId:b.id,symbol,at:number(t.time),fee:allocation.fee,feeAsset:t.commissionAsset,tradeId:t.id,tradeQuantity:allocation.quantity,tradePrice:allocation.price,clientOrderId:id,orderId:t.orderId,direction:allocation.direction,leverage:order.leverage,positionEpoch:allocation.epoch,exchangeRealizedPnl:number(t.realizedPnl)*allocation.quantity/number(t.qty)});
    e.excursions?.fill(b,{epoch:allocation.epoch,role:allocation.role,quantity:allocation.quantity,price:allocation.price,direction:allocation.direction,leverage:order.leverage,at:number(t.time),beforeQuantity:allocation.beforeQuantity,beforePrice:allocation.beforePrice});
    e.note(parent?'공유 계좌 체결 반영':'외부 정리 체결 반영',b.name+' · '+(allocation.role==='entry'?'진입 ':'정리 ')+allocation.quantity+' · '+allocation.price,b.id);
   }
   for(const [id,value] of Object.entries(sim.members)){const b=e.bot(id),old=book.members[id];for(const field of fields)if(field!=='realized')b.runtime[field]=value[field];b.runtime.realized+=value.realized-old.realized;if(b.runtime.error===e.positionMismatchError){b.runtime.error=null;}b.runtime.syncHold=false;if(!b.runtime.quantity)b.runtime.entryBlocked=null;b.runtime.mismatchSince=0;}
   for(const o of parents.values()){const quantity=rows.filter(t=>String(t.orderId)===String(o.orderId)).reduce((n,t)=>n+number(t.qty),0);if(quantity){o.sharedRecordedQty=number(o.sharedRecordedQty)+quantity;o.sharedPending=false;o.feesFetched=true;o.sharedManaged=true;}}
   book.members=sim.members;book.manual=sim.manual;book.epochs=sim.epochs;book.entryOrders=sim.entryOrders;book.pending=false;
   if(rows.length){book.cursor=Math.max(book.cursor,...rows.map(t=>number(t.id)));book.at=e.now();e.state.sharedEvents||=[];e.state.sharedEvents.push(...sim.events.map(event=>({...event,scope:e.state.scope,symbol})));e.positionInsights.cache=null;if(!e.storage.checking)await e.checkpoint();}
   return true;
  }catch(error){book.pending=true;this.checks.delete(symbol);throw error;}finally{this.busy.delete(symbol);}
 }
 fundingShare(botId,symbol,at){const event=(this.e.state.sharedEvents||[]).filter(v=>v.scope===this.e.state.scope&&v.symbol===symbol&&v.at<=at).at(-1);if(!event)return null;const total=event.pools.reduce((n,p)=>n+p.quantity,0),own=event.pools.filter(p=>p.botId===botId).reduce((n,p)=>n+p.quantity,0);return total>0?own/total:0;}
}
