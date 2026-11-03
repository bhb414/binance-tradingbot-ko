// Missing fields retain the price-based protection of existing bots.
export const protectionEnabled=(exit,kind)=>exit?.[kind+'Enabled']!==false;
export const hasProtection=exit=>protectionEnabled(exit,'takeProfit')||protectionEnabled(exit,'stopLoss');
export const protectionBasis=exit=>exit?.basis??'price';
export const PROTECTION_BASES=Object.freeze([['price','종목 가격 기준'],['leveraged','진입 증거금 기준']]);
export function protectionPricePercent(exit,kind,leverage){
 const basis=protectionBasis(exit),amount=Number(exit?.[kind]);
 if(!['price','leveraged'].includes(basis))throw Error('TP·SL 계산 기준을 확인해 주세요.');
 if(basis==='price')return amount;
 if(!Number.isInteger(Number(leverage))||Number(leverage)<1||Number(leverage)>125)throw Error('TP·SL 계산에 사용할 보유 포지션 레버리지를 확인해 주세요.');
 return amount/Number(leverage);
}
export function protectionSummary(exit){
 const value=kind=>(kind==='stopLoss'?'-':'+')+Number(exit?.[kind]).toLocaleString('ko-KR',{maximumFractionDigits:4})+'%';
 if(!hasProtection(exit))return 'TP/SL 꺼짐 · 조건식 정리만 사용';
 return '익절 '+(protectionEnabled(exit,'takeProfit')?value('takeProfit'):'꺼짐')+' / 손절 '+(protectionEnabled(exit,'stopLoss')?value('stopLoss'):'꺼짐')+' · '+(PROTECTION_BASES.find(([key])=>key===protectionBasis(exit))?.[1]||'기준 확인 필요');
}
