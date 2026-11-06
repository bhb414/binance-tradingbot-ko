import {isWalletStep,walletStepProjection,walletStepState,walletStepSignature,walletStepOptions} from '../public/wallet-step-budget.js';
export class WalletStepBudgets{
 constructor(engine){this.e=engine;}
 preview(candidate,old){const e=this.e,runtime={...old?.runtime},wallet=e.accountSnapshot?.walletBalance;if(!isWalletStep(candidate)){delete runtime.walletStep;return {...candidate,runtime};}
  const saved=runtime.walletStep,valid=isWalletStep(old)&&Number.isFinite(saved?.referenceWallet)&&saved?.signature===walletStepSignature(candidate)&&saved.scope===e.state.scope;
  if(!valid)delete runtime.walletStep;
  if(valid&&old.budgetIncluded===false&&candidate.budgetIncluded!==false&&Number.isFinite(wallet)){runtime.walletStep={...saved,anchorWallet:wallet,referenceWallet:wallet,anchorBudget:saved.budget,level:0};}
  const projection=walletStepProjection({...candidate,runtime},wallet);runtime.walletStep=walletStepState(projection,{scope:e.state.scope,at:projection.steps||!valid?e.now():saved?.updatedAt});return {...candidate,runtime};
 }
 commit(root,old){if(isWalletStep(root))root.budgetStep=walletStepOptions(root);const next=this.preview(root,old);if(isWalletStep(root))root.runtime.walletStep=next.runtime.walletStep;else delete root.runtime.walletStep;}
 sync(){const e=this.e;if(!Number.isFinite(e.accountSnapshot?.walletBalance))return false;let changed=false;for(const root of [...e.state.bots.filter(b=>!b.multiBotId),...(e.state.multiBots||[])]){if(!isWalletStep(root)||root.budgetIncluded===false)continue;const old=root.runtime.walletStep,next=this.preview(root,root).runtime.walletStep;if(JSON.stringify(old)===JSON.stringify(next))continue;root.runtime.walletStep=next;changed=true;if(old?.budget!==next.budget)e.note('지갑 구간 예산 조정',root.name+' · '+(old?.budget??root.budget).toFixed(2)+' → '+next.budget.toFixed(2)+' USDT · 기준 지갑 '+next.referenceWallet.toFixed(2)+' USDT',root.id);if(root.kind==='multi')e.multi.syncBudgets(root);}return changed;}
}
