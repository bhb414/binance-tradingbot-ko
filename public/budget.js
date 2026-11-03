export const BUDGET_MODES=Object.freeze({fixed:'고정 한도',pnl:'손익 반영',capped:'원금 한도 유지'});
export const BUDGET_OPTIONS=Object.freeze([
  ['fixed','고정 한도 (손실이 나도 설정한 한도 유지)'],
  ['pnl','손익 반영 (손실 차감 · 수익도 재투자)'],
  ['capped','원금 한도 유지 (손실 차감 · 수익은 원금까지만 복구)']
]);
export function effectiveBudget(bot){
  const base=Math.max(0,Number(bot.budget)||0),realized=Number(bot.runtime?.realized)||0,mode=bot.budgetMode||'fixed';
  if(mode==='fixed')return base;
  const current=Math.max(0,base+realized);
  return mode==='capped'?Math.min(base,current):current;
}
