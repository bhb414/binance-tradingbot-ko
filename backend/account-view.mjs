const numeric=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
const number=value=>numeric(value)??0;
export function accountView(account,rawPositions,orders,hedge){
  const usdt=account.assets?.find(asset=>asset.asset==='USDT');
  const positions=rawPositions.filter(p=>number(p.positionAmt)!==0).map(p=>{
    const entry=account.positions?.find(row=>row.symbol===p.symbol&&row.positionSide===p.positionSide)||{},quantity=number(p.positionAmt),markPrice=number(p.markPrice),initialMargin=number(p.positionInitialMargin??p.initialMargin??entry.positionInitialMargin??entry.initialMargin),notional=Math.abs(numeric(p.notional)??quantity*markPrice),isolatedMargin=number(p.isolatedWallet??entry.isolatedWallet);
    const marginType=String(p.marginType||'').toUpperCase()==='ISOLATED'||entry.isolated===true||isolatedMargin>0?'ISOLATED':'CROSSED';
    const supplied=numeric(p.leverage??entry.leverage),inferred=initialMargin>0?notional/initialMargin:null,leverage=supplied>0?supplied:inferred>0&&Math.abs(inferred-Math.round(inferred))<.01?Math.round(inferred):null;
    return {symbol:p.symbol,positionSide:p.positionSide,quantity,entryPrice:number(p.entryPrice),markPrice,unrealizedProfit:number(p.unRealizedProfit),initialMargin,isolatedMargin,marginType,leverage,marginAsset:p.marginAsset||'USDT',notional,maintenanceMargin:numeric(p.maintMargin??entry.maintMargin),liquidationPrice:numeric(p.liquidationPrice),breakEvenPrice:numeric(p.breakEvenPrice)};
  });
  const crossWallet=numeric(usdt?.crossWalletBalance),crossPnl=numeric(usdt?.crossUnPnl),maintenance=numeric(usdt?.maintMargin),isolated=positions.filter(p=>p.marginAsset==='USDT'&&p.marginType==='ISOLATED');
  const isolatedMaintenance=isolated.every(p=>p.maintenanceMargin!==null)?isolated.reduce((sum,p)=>sum+p.maintenanceMargin,0):null;
  const crossMaintenance=maintenance!==null&&isolatedMaintenance!==null?Math.max(0,maintenance-isolatedMaintenance):null,crossBalance=crossWallet!==null&&crossPnl!==null?crossWallet+crossPnl:null;
  const crossMarginRatio=crossMaintenance!==null&&crossBalance>0?crossMaintenance/crossBalance*100:null;
  for(const p of positions){const equity=p.isolatedMargin+p.unrealizedProfit;p.marginRatio=p.marginType==='ISOLATED'?(p.maintenanceMargin!==null&&equity>0?p.maintenanceMargin/equity*100:null):p.marginAsset==='USDT'?crossMarginRatio:null;p.marginRatioScope=p.marginType==='ISOLATED'?'position':'account';}
  return {walletBalance:number(usdt?.walletBalance??account.totalWalletBalance),availableBalance:number(usdt?.availableBalance??account.availableBalance),unrealizedProfit:number(usdt?.unrealizedProfit??account.totalUnrealizedProfit),canTrade:account.canTrade!==false,positionMode:hedge?'HEDGE':'ONE_WAY',positions,orders:orders.map(o=>({symbol:o.symbol,side:o.side,positionSide:o.positionSide,status:o.status,quantity:number(o.origQty),executedQuantity:number(o.executedQty),price:number(o.price),type:o.type,clientOrderId:o.clientOrderId,orderId:o.orderId}))};
}
