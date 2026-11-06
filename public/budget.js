import {isWalletStep,walletStepErrors,walletStepProjection,walletStepSignature} from './wallet-step-budget.js';
export const BUDGET_MODES=Object.freeze({fixed:'고정 한도',pnl:'손익 반영',capped:'원금 한도 유지',floor:'최소 한도 유지 + 손익 반영'});
export const BUDGET_OPTIONS=Object.freeze([['fixed','고정 한도 (손실이 나도 설정한 한도 유지)'],['pnl','손익 반영 (손실 차감 · 수익도 재투자)'],['capped','원금 한도 유지 (손실 차감 · 수익은 원금까지만 복구)'],['floor','최소 한도 유지 + 손익 반영 (과거 손실 복구 후 증가)']]);
export const LOSS_CARRY_OPTIONS=Object.freeze([['carry','음수 손실 계속 누적 · 기존 방식'],['zero','계산 예산은 0에서 멈춤 · 초과 손실 이월 안 함']]);
export const RECOVERY_OPTIONS=Object.freeze([['ratio','손실 복구에도 설정한 이익 비율 적용 · 기존 방식'],['full','손실 복구분은 100% · 남은 이익에만 설정 비율 적용']]);
export const BUDGET_TYPES=Object.freeze([['amount','금액 · USDT'],['walletStep','지갑 증가 구간마다 예산 조정 · USDT'],['walletPercent','전체 선물 USDT 지갑 금액의 비율 · %'],['availablePercent','현재 주문 가능 금액의 비율 · %'],['unallocatedPercent','다른 봇 배정 후 남은 예산의 비율 · %']]);
export const SHORTFALL_OPTIONS=Object.freeze([['strict','설정 한도 확보 후 운용 · 기존 방식'],['available','부족하면 가용 한도까지 자동 축소']]);
export const isPercentBudget=bot=>['walletPercent','availablePercent','unallocatedPercent'].includes(bot?.budgetType);
export const isDynamicBudget=bot=>isPercentBudget(bot)||isWalletStep(bot);
export function percentBudgetBasis(bot,wallet=bot.budgetAllocation?.wallet,available=bot.budgetAllocation?.available){
 if(bot.budgetType==='unallocatedPercent'){const a=bot.budgetAllocation;return a?.signature===budgetSignature(bot)&&a.wallet===wallet&&Number.isFinite(a.basis)?a.basis:null;}
 if(bot.budgetType==='walletPercent')return Number.isFinite(wallet)?Math.max(0,wallet):null;
 if(bot.budgetType!=='availablePercent'||!Number.isFinite(available))return null;
 // Restore only this bot's committed margin so its own fills/reservations do not count twice.
 const committed=Math.max(0,Number(bot.used??bot.budgetAllocation?.used)||0)+Math.max(0,Number(bot.reserved??bot.budgetAllocation?.reserved)||0),base=Math.max(0,available)+committed;
 return Number.isFinite(wallet)?Math.min(Math.max(0,wallet),base):base;
}
export const budgetIncluded=bot=>bot?.budgetIncluded!==false;
export const reinvestPercent=bot=>bot.profitReinvestPercent??100;
export const withheldProfit=(bot,gross)=>Math.max(0,gross)*(1-reinvestPercent(bot)/100);
export function budgetRealized(bot){const r=bot.runtime||{},base=r.budgetBaseline||{};return (Number(r.realized)||0)-(Number(r.budgetWithheld)||0)+(Number(r.budgetLossCredit)||0)-(Number(base.realized)||0)+(Number(base.withheld)||0)-(Number(base.lossCredit)||0);}
export function budgetSettingsErrors(bot){const errors=[];if(!['carry','zero'].includes(bot.budgetLossCarry===undefined?'carry':bot.budgetLossCarry))errors.push('계산 예산의 음수 처리 방식을 확인하세요.');if(!['ratio','full'].includes(bot.budgetRecovery===undefined?'ratio':bot.budgetRecovery))errors.push('손실 복구 중 이익 반영 방식을 확인하세요.');if(!['amount','walletPercent','availablePercent','unallocatedPercent','walletStep'].includes(bot.budgetType||'amount'))errors.push('예산 지정 기준을 확인하세요.');if(!['strict','available'].includes(bot.budgetShortfall||'strict'))errors.push('예산 부족 시 운용 방식을 확인하세요.');if(isPercentBudget(bot)){if(!Number.isFinite(bot.budgetPercent)||bot.budgetPercent<=0||bot.budgetPercent>100)errors.push('잔액 비율은 0보다 크고 100% 이하로 입력하세요.');}else if(!Number.isFinite(bot.budget)||bot.budget<10||bot.budget>100000000)errors.push('운용 예산은 10 USDT 이상이어야 합니다.');if(!isDynamicBudget(bot)&&bot.budgetMode==='floor'&&(!Number.isFinite(bot.budgetFloor)||bot.budgetFloor<0||bot.budgetFloor>bot.budget))errors.push('최소 운용한도는 0 이상, 기준 운용예산 이하의 USDT 금액으로 입력하세요.');errors.push(...walletStepErrors(bot));return errors;}
export function requestedBudget(bot,walletBalance=bot.budgetAllocation?.wallet,availableBalance=bot.budgetAllocation?.available){
 if(isWalletStep(bot))return walletStepProjection(bot,walletBalance).budget;
 if(isPercentBudget(bot))return (percentBudgetBasis(bot,walletBalance,availableBalance)??0)*Math.max(0,Number(bot.budgetPercent)||0)/100;
 const base=Math.max(0,Number(bot.budget)||0),realized=budgetRealized(bot),mode=bot.budgetMode||'fixed';if(mode==='fixed')return base;if(mode==='floor')return Math.max(Number(bot.budgetFloor)||0,base+realized);const current=Math.max(0,base+realized);return mode==='capped'?Math.min(base,current):current;
}
export const budgetSignature=bot=>JSON.stringify([bot.budget,bot.budgetType||'amount',bot.budgetPercent??null,bot.budgetShortfall||'strict',bot.budgetMode||'fixed',bot.budgetFloor??null,bot.budgetLossCarry??'carry',bot.budgetRecovery??'ratio',budgetIncluded(bot),budgetRealized(bot),...(isWalletStep(bot)?[walletStepSignature(bot),bot.runtime?.walletStep||null]:[])]);
export function effectiveBudget(bot){const allocation=bot.budgetAllocation;return allocation&&allocation.signature===budgetSignature(bot)?allocation.limit:requestedBudget(bot);}
export const allocatedAmount=bot=>budgetIncluded(bot)?effectiveBudget(bot):0;
// Strict targets retain their existing allocation. Flexible bots reserve current usage
// first, then share remaining wallet headroom proportionally to their unmet targets.
function resolveStandardBudgets(bots,walletBalance=Infinity,availableBalance=null){
 const wallet=Number.isFinite(walletBalance)?Math.max(0,walletBalance):Infinity,rows=bots.filter(b=>!b.multiBotId).map(b=>({bot:b,target:requestedBudget(b,wallet,availableBalance),commit:0,limit:0})),flex=rows.filter(r=>budgetIncluded(r.bot)&&r.bot.budgetShortfall==='available');
 const strict=rows.filter(r=>budgetIncluded(r.bot)&&r.bot.budgetShortfall!=='available').reduce((s,r)=>s+r.target,0),pool=Math.max(0,wallet-strict);
 for(const r of rows){r.limit=r.target;if(flex.includes(r))r.commit=Math.min(r.target,Math.max(0,Number(r.bot.used)||0)+Math.max(0,Number(r.bot.reserved)||0));}
 const committed=flex.reduce((s,r)=>s+r.commit,0);
 if(pool<committed){for(const r of flex)r.limit=committed?pool*r.commit/committed:0;}else{let available=pool,free=[...flex];while(free.length){const weight=free.reduce((sum,r)=>sum+r.target,0),floors=free.filter(r=>r.commit>available*r.target/weight+1e-8);if(!floors.length){for(const r of free)r.limit=Math.min(r.target,weight?available*r.target/weight:0);break;}for(const r of floors){r.limit=r.commit;available-=r.commit;}free=free.filter(r=>!floors.includes(r));}}
 return new Map(rows.map(r=>[r.bot.id,{wallet:Number.isFinite(wallet)?wallet:null,available:Number.isFinite(availableBalance)?Math.max(0,availableBalance):null,used:Math.max(0,Number(r.bot.used)||0),reserved:Math.max(0,Number(r.bot.reserved)||0),basis:percentBudgetBasis(r.bot,wallet,availableBalance),...(isWalletStep(r.bot)?{step:walletStepProjection(r.bot,wallet)}:{}),target:r.target,limit:Math.max(0,r.limit),signature:budgetSignature(r.bot),reduced:r.limit+1e-8<r.target}]));
}
// All residual-percentage roots share one pool, calculated after existing budget modes.
// Resolve the group together; neither input order nor the group's own usage shrinks its basis.
export function unallocatedPercentError(bots){
 const total=bots.filter(b=>!b.multiBotId&&budgetIncluded(b)&&b.budgetType==='unallocatedPercent').reduce((sum,b)=>sum+(Number(b.budgetPercent)||0),0);
 return total>100+1e-8?'‘다른 봇 배정 후 남은 예산의 비율’ 방식의 운용 봇 비율 합계 '+Number(total.toFixed(8))+'%가 100%를 초과합니다. 비율을 줄이거나 일부 봇을 보관해 주세요.':'';
}
export function resolveBudgets(bots,walletBalance=Infinity,availableBalance=null){
 const roots=bots.filter(b=>!b.multiBotId),group=roots.filter(b=>b.budgetType==='unallocatedPercent');
 if(!group.length)return resolveStandardBudgets(roots,walletBalance,availableBalance);
 const standard=roots.filter(b=>b.budgetType!=='unallocatedPercent'),allocations=resolveStandardBudgets(standard,walletBalance,availableBalance),wallet=Number.isFinite(walletBalance)?Math.max(0,walletBalance):null;
 const otherAllocated=standard.filter(budgetIncluded).reduce((sum,b)=>sum+allocations.get(b.id).limit,0),basis=wallet===null?null:Math.max(0,wallet-otherAllocated),totalPercent=group.filter(budgetIncluded).reduce((sum,b)=>sum+Math.max(0,Number(b.budgetPercent)||0),0);
 for(const b of group){const percent=Math.max(0,Number(b.budgetPercent)||0),target=(basis??0)*percent/100,limit=budgetIncluded(b)?(basis??0)*percent/Math.max(100,totalPercent):target;
  allocations.set(b.id,{wallet,available:Number.isFinite(availableBalance)?Math.max(0,availableBalance):null,used:Math.max(0,Number(b.used)||0),reserved:Math.max(0,Number(b.reserved)||0),basis,otherAllocated,totalPercent,target,limit,signature:budgetSignature(b),reduced:limit+1e-8<target});
 }
 return new Map(roots.map(b=>[b.id,allocations.get(b.id)]));
}
export function withBudgetAllocation(bot,bots,walletBalance,availableBalance=null){const saved=bots.find(b=>b.id===bot.id),view={...saved,...bot,runtime:bot.runtime??saved?.runtime,used:bot.used??saved?.used,reserved:bot.reserved??saved?.reserved},roots=[...bots.filter(b=>b.id!==bot.id),view];return {...view,budgetAllocation:resolveBudgets(roots,walletBalance,availableBalance).get(bot.id)};}

export const budgetReference=(bot,wallet=bot.budgetAllocation?.wallet,available=bot.budgetAllocation?.available)=>isDynamicBudget(bot)?requestedBudget(bot,wallet,available):Math.max(0,Number(bot.budget)||0);
