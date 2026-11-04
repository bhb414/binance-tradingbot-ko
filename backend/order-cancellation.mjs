const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b);
export class OrderCancellation{
 constructor(engine){this.e=engine;}
 async cancel(input){
  const e=this.e;e.requireCancellation();
  if(!input||input.connectionId!==e.connectionId)throw Error('계좌 연결이 바뀌었습니다. 미체결 목록을 새로고침하세요.');
  const {symbol,clientOrderId,orderId}=input;
  if(typeof symbol!=='string'||!/^[A-Z0-9_]{2,40}$/.test(symbol)||clientOrderId!=null&&(typeof clientOrderId!=='string'||clientOrderId.length<1||clientOrderId.length>160)||orderId!=null&&!/^\d{1,24}$/.test(String(orderId))||!clientOrderId&&orderId==null)throw Error('취소할 주문을 확인해 주세요.');
  const tracked=e.state.orders.find(o=>o.scope===e.state.scope&&o.parameters.symbol===symbol&&(clientOrderId&&same(o.id,clientOrderId)||orderId!=null&&same(o.orderId,orderId)));
  if(tracked){
   if(tracked.kind==='algo')throw Error('봇 보호 주문은 보호 설정에서 변경해 주세요.');
   if(clientOrderId&&!same(tracked.id,clientOrderId)||orderId!=null&&tracked.orderId!=null&&!same(tracked.orderId,orderId))throw Error('주문 식별 정보가 바뀌었습니다. 목록을 새로고침하세요.');
   if(tracked.botId)await e.cancelBotOrderRuntime(tracked.botId,tracked.id);else {await e.manual.cancel(tracked.id);await e.refreshAccount(true);}
   return {status:tracked.status,pending:!terminal.has(tracked.status),symbol};
  }
  const selector=orderId!=null?{orderId:String(orderId)}:{origClientOrderId:clientOrderId};let current;
  try{current=await e.client.queryOrder(symbol,selector);}catch(error){if(![-2011,-2013].includes(error.code))throw error;await e.refreshAccount(true);return {status:'NOT_OPEN',pending:false,symbol};}
  if(current.symbol!==symbol||clientOrderId&&!same(current.clientOrderId,clientOrderId)||orderId!=null&&!same(current.orderId,orderId))throw Error('거래소 주문 정보가 목록과 다릅니다. 새로고침 후 다시 시도하세요.');
  if(!terminal.has(current.status)){
   try{current=await e.client.cancelOrder(symbol,selector);}catch(error){if(!error.uncertain&&![-2011,-2013].includes(error.code))throw error;current=await e.client.queryOrder(symbol,selector);}
  }
  await e.refreshAccount(true);e.note('사용자 미체결 취소',symbol+' · 거래소 일반 주문 · '+current.status);await e.checkpoint();
  return {status:current.status,pending:!terminal.has(current.status),symbol};
 }
}
