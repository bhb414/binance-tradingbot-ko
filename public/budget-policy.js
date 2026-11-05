import {budgetRealized,withheldProfit,isPercentBudget} from './budget.js';
const n=v=>Number(v)||0,lossMode=b=>b.budgetLossCarry??'carry',recoveryMode=b=>b.budgetRecovery??'ratio';
export function budgetRecoveryDebt(bot,realized=n(bot.runtime?.realized)){
 const r=bot.runtime||{};return Number.isFinite(r.budgetRecoveryDebt)?Math.max(0,r.budgetRecoveryDebt):Math.max(0,-budgetRealized({...bot,runtime:{...r,realized}}));
}
export function prepareBudgetPolicy(bot,realized=n(bot.runtime?.realized)){
 const r=bot.runtime||={};r.budgetRecoveryDebt=budgetRecoveryDebt(bot,realized);
 if(!isPercentBudget(bot)&&(bot.budgetMode||'fixed')!=='fixed'&&lossMode(bot)==='zero'){
  const excess=Math.max(0,-(n(bot.budget)+budgetRealized({...bot,runtime:{...r,realized}})));
  r.budgetLossCredit=n(r.budgetLossCredit)+excess;r.budgetRecoveryDebt=Math.max(0,r.budgetRecoveryDebt-excess);
 }
}
// Called with the lifetime PnL immediately before this one settled result.
// Budget-only credits never modify actual realized PnL, fills, wallet or statistics.
export function recordBudgetResult(bot,amount,{realizedBefore=n(bot.runtime?.realized),profit=true}={}){
 if(!Number.isFinite(amount)||!Number.isFinite(realizedBefore))throw Error('예산 손익 반영 값을 확인하세요.');
 prepareBudgetPolicy(bot,realizedBefore);const r=bot.runtime,before=n(bot.budget)+budgetRealized({...bot,runtime:{...r,realized:realizedBefore}}),debt=r.budgetRecoveryDebt;
 const recover=profit&&recoveryMode(bot)==='full'&&!isPercentBudget(bot)&&(bot.budgetMode||'fixed')!=='fixed'?Math.min(Math.max(0,amount),debt):0;
 const withheld=profit?withheldProfit(bot,Math.max(0,amount)-recover):0,credited=amount-withheld;
 const forgiven=!isPercentBudget(bot)&&(bot.budgetMode||'fixed')!=='fixed'&&lossMode(bot)==='zero'?Math.max(0,-(before+credited)):0;
 r.budgetWithheld=n(r.budgetWithheld)+withheld;r.budgetLossCredit=n(r.budgetLossCredit)+forgiven;
 r.budgetRecoveryDebt=Math.max(0,debt-credited-forgiven);
 return {credited:credited+forgiven,withheld,forgiven,recovery:recover,debt:r.budgetRecoveryDebt};
}
export function previewBudgetPolicy(bot){const view={...bot,runtime:{...bot.runtime}};prepareBudgetPolicy(view);return view;}
export function budgetPolicyDescription(bot){
 const percent=bot.profitReinvestPercent??100;
 return (recoveryMode(bot)==='full'?'손실로 줄어든 계산 예산을 복구하는 이익은 100% 반영하고, 복구 후 남은 이익의 '+percent+'%를 더합니다.':'손실을 복구할 때도 각 매매이익의 '+percent+'%를 예산에 더합니다.')+' 손실·USDT 수수료는 전액 차감합니다. '+(lossMode(bot)==='zero'?'계산 예산은 0에서 멈추며 0을 넘는 초과 손실은 이후 이익과 상계하지 않습니다. 거래 기록·통계의 실제 손실은 유지합니다.':'계산 예산이 0 아래가 돼도 손실을 계속 남겨 이후 반영되는 이익과 상계합니다.');
}
