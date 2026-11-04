export const BUDGET_MODES=Object.freeze({fixed:'고정 한도',pnl:'손익 반영',capped:'원금 한도 유지'});
export const BUDGET_OPTIONS=Object.freeze([['fixed','고정 한도 (손실이 나도 설정한 한도 유지)'],['pnl','손익 반영 (손실 차감 · 수익도 재투자)'],['capped','원금 한도 유지 (손실 차감 · 수익은 원금까지만 복구)']]);
export const BUDGET_TYPES=Object.freeze([['amount','금액 · USDT'],['walletPercent','선물 USDT 지갑 잔고의 비율 · %']]);
export const SHORTFALL_OPTIONS=Object.freeze([['strict','설정 한도 확보 후 운용 · 기존 방식'],['available','부족하면 가용 한도까지 자동 축소']]);
export const budgetIncluded=bot=>bot?.budgetIncluded!==false;
export const reinvestPercent=bot=>bot.profitReinvestPercent??100;
export const withheldProfit=(bot,gross)=>Math.max(0,gross)*(1-reinvestPercent(bot)/100);
export function budgetRealized(bot){const r=bot.runtime||{},base=r.budgetBaseline||{};return (Number(r.realized)||0)-(Number(r.budgetWithheld)||0)-(Number(base.realized)||0)+(Number(base.withheld)||0);}
export function budgetSettingsErrors(bot){const errors=[];if(!['amount','walletPercent'].includes(bot.budgetType||'amount'))errors.push('예산 지정 기준을 확인하세요.');if(!['strict','available'].includes(bot.budgetShortfall||'strict'))errors.push('예산 부족 시 운용 방식을 확인하세요.');if(bot.budgetType==='walletPercent'){if(!Number.isFinite(bot.budgetPercent)||bot.budgetPercent<=0||bot.budgetPercent>100)errors.push('지갑 잔고 비율은 0보다 크고 100% 이하로 입력하세요.');}else if(!Number.isFinite(bot.budget)||bot.budget<10||bot.budget>100000000)errors.push('운용 예산은 10 USDT 이상이어야 합니다.');return errors;}
export function requestedBudget(bot,walletBalance=bot.budgetAllocation?.wallet){
 if(bot.budgetType==='walletPercent')return Number.isFinite(walletBalance)?Math.max(0,walletBalance)*Math.max(0,Number(bot.budgetPercent)||0)/100:0;
 const base=Math.max(0,Number(bot.budget)||0),realized=budgetRealized(bot),mode=bot.budgetMode||'fixed';if(mode==='fixed')return base;const current=Math.max(0,base+realized);return mode==='capped'?Math.min(base,current):current;
}
export const budgetSignature=bot=>JSON.stringify([bot.budget,bot.budgetType||'amount',bot.budgetPercent??null,bot.budgetShortfall||'strict',bot.budgetMode||'fixed',budgetIncluded(bot),budgetRealized(bot)]);
export function effectiveBudget(bot){const allocation=bot.budgetAllocation;return allocation&&allocation.signature===budgetSignature(bot)?allocation.limit:requestedBudget(bot);}
export const allocatedAmount=bot=>budgetIncluded(bot)?effectiveBudget(bot):0;
// Strict targets retain their existing allocation. Flexible bots reserve current usage
// first, then share remaining wallet headroom proportionally to their unmet targets.
export function resolveBudgets(bots,walletBalance=Infinity){
 const wallet=Number.isFinite(walletBalance)?Math.max(0,walletBalance):Infinity,rows=bots.filter(b=>!b.multiBotId).map(b=>({bot:b,target:requestedBudget(b,wallet),commit:0,limit:0})),flex=rows.filter(r=>budgetIncluded(r.bot)&&r.bot.budgetShortfall==='available');
 const strict=rows.filter(r=>budgetIncluded(r.bot)&&r.bot.budgetShortfall!=='available').reduce((s,r)=>s+r.target,0),pool=Math.max(0,wallet-strict);
 for(const r of rows){r.limit=r.target;if(flex.includes(r))r.commit=Math.min(r.target,Math.max(0,Number(r.bot.used)||0)+Math.max(0,Number(r.bot.reserved)||0));}
 const committed=flex.reduce((s,r)=>s+r.commit,0);
 if(pool<committed){for(const r of flex)r.limit=committed?pool*r.commit/committed:0;}else{let available=pool,free=[...flex];while(free.length){const weight=free.reduce((sum,r)=>sum+r.target,0),floors=free.filter(r=>r.commit>available*r.target/weight+1e-8);if(!floors.length){for(const r of free)r.limit=Math.min(r.target,weight?available*r.target/weight:0);break;}for(const r of floors){r.limit=r.commit;available-=r.commit;}free=free.filter(r=>!floors.includes(r));}}
 return new Map(rows.map(r=>[r.bot.id,{wallet:Number.isFinite(wallet)?wallet:null,target:r.target,limit:Math.max(0,r.limit),signature:budgetSignature(r.bot),reduced:r.limit+1e-8<r.target}]));
}
export function withBudgetAllocation(bot,bots,walletBalance){const saved=bots.find(b=>b.id===bot.id),view={...saved,...bot,runtime:bot.runtime??saved?.runtime,used:bot.used??saved?.used,reserved:bot.reserved??saved?.reserved},roots=[...bots.filter(b=>b.id!==bot.id),view];return {...view,budgetAllocation:resolveBudgets(roots,walletBalance).get(bot.id)};}

export const budgetReference=(bot,wallet=bot.budgetAllocation?.wallet)=>bot.budgetType==='walletPercent'?requestedBudget(bot,wallet):Math.max(0,Number(bot.budget)||0);
