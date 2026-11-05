const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const sameQuantity=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-12,Math.max(Math.abs(a),Math.abs(b))*Number.EPSILON*8);
export const sharedQuantityPending=(executed,recorded)=>executed>recorded&&!sameQuantity(executed,recorded);
// A completed shared allocation already includes its exchange commission.
// Recover only confirmation metadata, never apply another fill or fee debit.
export function reconcileConfirmedSharedFees(state,order){
 if(!order.sharedManaged||(!terminal.has(order.status)&&order.status!=='PARTIALLY_FILLED')||!(order.appliedQty>0)||!order.orderId||order.feesFetched&&!order.sharedPending)return false;
 const symbol=order.parameters.symbol,match=row=>row.scope===order.scope&&row.symbol===symbol&&String(row.orderId)===String(order.orderId);
 const ledgers=state.orders.filter(row=>row.kind==='ledger'&&row.parent===order.id&&row.scope===order.scope&&row.parameters.symbol===symbol&&String(row.orderId)===String(order.orderId));
 if(!ledgers.length||ledgers.some(row=>row.status!=='FILLED'||!row.feesFetched))return false;
 const byId=new Map(state.fills.map(row=>[row.id,row]));let total=0;
 for(const ledger of ledgers){
  const trades=state.fills.filter(row=>row.clientOrderId===ledger.id&&row.botId===ledger.botId&&row.quantity>0&&match(row));
  if(!trades.length||new Set(trades.map(row=>row.id)).size!==trades.length)return false;
  let quantity=0;
  for(const trade of trades){
   const fee=byId.get('fee:'+trade.id);
   if(!Number.isFinite(trade.quantity)||!fee||!match(fee)||fee.botId!==trade.botId||fee.clientOrderId!==ledger.id||typeof fee.fee!=='number'||!Number.isFinite(fee.fee)||typeof fee.feeAsset!=='string'||!fee.feeAsset||!sameQuantity(fee.tradeQuantity,trade.quantity))return false;
   quantity+=trade.quantity;
  }
  if(!sameQuantity(quantity,ledger.appliedQty))return false;total+=quantity;
 }
 if(!sameQuantity(total,order.appliedQty))return false;
 order.sharedRecordedQty=order.appliedQty;order.sharedPending=false;order.feesFetched=true;
 if(order.lastQueryError===-2013)delete order.lastQueryError;
 return true;
}
