export const orderDirection=(side,reduceOnly=false)=>side==='BUY'?(reduceOnly?'SHORT':'LONG'):(reduceOnly?'LONG':'SHORT');
export function previewSize(mode,amount,leverage,nativeMargin=true){
  if(mode!=='margin'||nativeMargin)return {sizeMode:mode,amount};
  if(!/^\d+(?:\.\d+)?$/.test(amount)||!(Number(amount)>0)||!Number.isFinite(Number(amount)*leverage))throw new Error('초기 증거금을 0보다 큰 숫자로 입력해 주세요.');
  return {sizeMode:'notional',amount:(Number(amount)*leverage).toFixed(12).replace(/\.?0+$/,'')};
}
export function orderEstimate(amount,mode,price,leverage){
  const value=Number(amount),p=Number(price),l=Number(leverage);if(!(value>0&&p>0&&l>0))return null;
  const notional=mode==='quantity'?value*p:mode==='margin'?value*l:value;
  return {notional,margin:notional/l,quantity:notional/p};
}
export function orderCapacity(context,{side='BUY',reduceOnly=false,price,leverage}){
  if(!context?.connected||!(price>0&&leverage>0))return null;
  const positions=context.positions||[],orders=context.orders||[],direction=orderDirection(side,reduceOnly);
  if(reduceOnly){const p=context.hedge?positions.find(p=>p.positionSide===direction):positions.find(p=>(p.quantity>0)===(direction==='LONG'));
    const pending=orders.filter(o=>o.side===side&&(!context.hedge||o.positionSide===direction)).reduce((sum,o)=>sum+Math.max(0,o.quantity-o.executedQuantity),0),quantity=Math.max(0,Math.abs(p?.quantity||0)-pending);
    return {quantity,notional:quantity*price,margin:0};
  }
  const existing=positions.reduce((sum,p)=>sum+Math.abs(p.quantity)*price,0)+orders.reduce((sum,o)=>sum+Math.max(0,o.quantity-o.executedQuantity)*(Number(o.price)||price),0);
  const cap=Math.max(0,...(context.brackets||[]).filter(b=>Number(b.initialLeverage)>=leverage).map(b=>Number(b.notionalCap)*(context.notionalCoef||1))),notional=Math.max(0,Math.min(Number(context.availableBalance||0)*.98*leverage,cap-existing));
  return {quantity:notional/price,notional,margin:notional/leverage};
}
