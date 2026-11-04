export const positionPercent=(value,base)=>Number.isFinite(value)&&Number.isFinite(base)&&base>0?Number((value/base*100).toFixed(12)):undefined;
export const POSITION_FIELDS=Object.freeze(['profit','averagePrice','currentReturn','priceChange','currentPnl','hasPosition']);
export function formulaPosition(bot){
 const r=bot?.runtime||{};
 return {...r,quantity:Number(bot?.quantity??r.quantity)||0,entryPrice:Number(bot?.entryPrice??r.entryPrice)||0,direction:bot?.positionDirection||r.direction,leverage:Number(bot?.leverage),syncHold:!!r.syncHold};
}
export function portfolioFormulaPosition(view){
 const members=view?.members||[],symbols={},held=members.filter(m=>Number(m.quantity??m.runtime?.quantity)>0);
 for(const member of members){const p=formulaPosition(member);symbols[member.alias]=p;symbols[member.symbol]=p;}
 const ready=held.length>0&&held.every(m=>{const p=formulaPosition(m);return !p.syncHold&&['LONG','SHORT'].includes(p.direction)&&p.entryPrice>0&&p.leverage>0&&Number.isFinite(p.leverage)&&Number.isFinite(m.pnl)&&Number.isFinite(m.runtime?.realized);});
 const pnl=ready?held.reduce((sum,m)=>sum+m.pnl-m.runtime.realized,0):null,notional=ready?held.reduce((sum,m)=>{const p=formulaPosition(m);return sum+p.quantity*p.entryPrice;},0):0,margin=ready?held.reduce((sum,m)=>{const p=formulaPosition(m);return sum+p.quantity*p.entryPrice/p.leverage;},0):0;
 return {quantity:held.length,syncHold:held.some(m=>m.runtime?.syncHold),profitValue:view?.used>0?(view.pnl-view.runtime.realized)/view.used*100:undefined,currentReturnValue:ready&&margin>0?positionPercent(pnl,margin):undefined,priceChangeValue:ready&&notional>0?positionPercent(pnl,notional):undefined,currentPnlValue:ready?pnl:undefined,symbols};
}
