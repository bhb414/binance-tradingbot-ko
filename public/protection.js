// Missing switches preserve protection on bots saved before optional TP/SL existed.
export const protectionEnabled=(exit,kind)=>exit?.[kind+'Enabled']!==false;
export const hasProtection=exit=>protectionEnabled(exit,'takeProfit')||protectionEnabled(exit,'stopLoss');
export function protectionSummary(exit){
  const value=kind=>Number(exit?.[kind]).toLocaleString('ko-KR',{maximumFractionDigits:4})+'%';
  if(!hasProtection(exit))return 'TP/SL 꺼짐 · 조건식 정리만 사용';
  return '익절 '+(protectionEnabled(exit,'takeProfit')?value('takeProfit'):'꺼짐')+' / 손절 '+(protectionEnabled(exit,'stopLoss')?value('stopLoss'):'꺼짐');
}
