export function normalizeBrackets(response,symbol){
  const item=Array.isArray(response)?response.find(row=>row.symbol===symbol)||response.find(row=>!row.symbol):response;
  const tiers=(item?.brackets||[]).map(row=>({leverage:Number(row.initialLeverage),floor:Number(row.notionalFloor),cap:Number(row.notionalCap)}));
  if(item?.symbol&&item.symbol!==symbol||!tiers.length||tiers.some(row=>!Number.isInteger(row.leverage)||row.leverage<1||row.leverage>MAX_LEVERAGE||!Number.isFinite(row.floor)||row.floor<0||!Number.isFinite(row.cap)||row.cap<=row.floor))throw new Error('거래소 레버리지 한도를 확인하지 못했습니다.');
  return {maxLeverage:Math.max(...tiers.map(row=>row.leverage)),tiers};
}
export function leverageCap(limits,budget){
  if(!limits?.available)return 125;
  let cap=0;
  for(let leverage=1;leverage<=limits.maxLeverage;leverage++){
    const maximum=notionalCap(limits,leverage);
    if(!Number.isFinite(maximum)||Number(budget)*leverage<=maximum)cap=leverage;
  }
  return cap;
}
export function notionalCap(limits,leverage){
  const caps=(limits?.tiers||[]).filter(row=>row.leverage>=leverage&&Number.isFinite(row.cap)&&row.cap>0).map(row=>row.cap);
  return caps.length?Math.max(...caps):null;
}
// Bound malformed responses; actual limits always come from the account's symbol tiers.
export const MAX_LEVERAGE=1000;
