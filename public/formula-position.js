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

export function actionFormulaPosition(bot,rule,state){
 const own=formulaPosition(bot);if(rule?.closeScope!=='account'||rule.action?.startsWith('ENTER_')||rule.action==='STOP_BOT')return own;
 const direction=rule.action==='EXIT_LONG'?'LONG':rule.action==='EXIT_SHORT'?'SHORT':null,position=state?.account?.positions?.find(p=>p.symbol===bot?.symbol&&(!direction||(p.quantity>0?'LONG':'SHORT')===direction));
 return {...own,quantity:Math.abs(position?.quantity||0),entryPrice:position?.entryPrice||0,direction:position?(position.quantity>0?'LONG':'SHORT'):direction,leverage:position?.leverage||own.leverage,syncHold:false};
}
export function portfolioActionFormulaPosition(view,rule,state){
 const members=(view?.members||view?.legs?.map(leg=>({...leg,id:view.id+'_'+leg.alias,quantity:0,entryPrice:0,leverage:3,pnl:0,used:0,runtime:{quantity:0,entryPrice:0,realized:0}}))||[]).map(member=>{const target=rule.targets?.find(t=>t.alias===member.alias);if(target?.closeScope!=='account')return member;const position=actionFormulaPosition(member,target,state),native=state?.account?.positions?.find(p=>p.symbol===member.symbol&&(p.quantity>0?'LONG':'SHORT')===position.direction),realized=Number(member.runtime?.realized)||0,unrealized=native?(native.markPrice-position.entryPrice)*position.quantity*(position.direction==='LONG'?1:-1):0;
 return {...member,quantity:position.quantity,entryPrice:position.entryPrice,positionDirection:position.direction,leverage:position.leverage,pnl:realized+unrealized,used:native?.isolatedMargin>0?native.isolatedMargin:native?.initialMargin||0,runtime:{...member.runtime,...position,realized}};});
 return portfolioFormulaPosition({...view,members,used:members.reduce((n,m)=>n+(m.used||0),0),pnl:members.reduce((n,m)=>n+(m.pnl||0),0),runtime:{...view?.runtime,realized:members.reduce((n,m)=>n+(m.runtime.realized||0),0)}});
}
