import {createHash,randomUUID} from 'node:crypto';
import {budgetIncluded,resolveBudgets} from '../public/budget.js';
import {isWalletStep,walletStepProjection,walletStepState,walletStepSignature,walletStepOptions} from '../public/wallet-step-budget.js';
export class WalletStepBudgets{
 constructor(engine){this.e=engine;this.plans=new Map();}
 preview(candidate,old){const e=this.e,runtime={...old?.runtime},wallet=e.accountSnapshot?.walletBalance;if(!isWalletStep(candidate)){delete runtime.walletStep;return {...candidate,runtime};}
  const saved=runtime.walletStep,valid=isWalletStep(old)&&Number.isFinite(saved?.referenceWallet)&&saved?.signature===walletStepSignature(candidate)&&saved.scope===e.state.scope;
  if(!valid)delete runtime.walletStep;
  if(valid&&old.budgetIncluded===false&&candidate.budgetIncluded!==false&&Number.isFinite(wallet)){runtime.walletStep={...saved,anchorWallet:wallet,referenceWallet:wallet,anchorBudget:saved.budget,level:0};}
  const projection=walletStepProjection({...candidate,runtime},wallet);runtime.walletStep=walletStepState(projection,{scope:e.state.scope,at:projection.steps||!valid?e.now():saved?.updatedAt});return {...candidate,runtime};
 }
 commit(root,old){if(isWalletStep(root))root.budgetStep=walletStepOptions(root);const next=this.preview(root,old);if(isWalletStep(root))root.runtime.walletStep=next.runtime.walletStep;else delete root.runtime.walletStep;}
 async inspectReference(id,input){
  const e=this.e;e.storage.healthy();if(!e.connected)throw Error('계좌를 연결한 뒤 지갑 기준을 재설정하세요.');
  const root=e.budgetSelection.root(id);if(!isWalletStep(root))throw Error('지갑 구간 예산 방식의 봇에서 사용하세요.');
  if(!input||!['current','custom'].includes(input.mode)||input.mode==='custom'&&(!Number.isFinite(input.amount)||input.amount<0||input.amount>100000000))throw Error('지갑 기준은 현재 지갑 또는 0~100,000,000 USDT 금액으로 지정하세요.');
  await e.refreshAccount(true);const wallet=e.accountSnapshot?.walletBalance;if(!Number.isFinite(wallet)||wallet<0)throw Error('전체 선물 USDT 지갑 금액을 확인하지 못했습니다.');
  const current=this.preview(root,root).runtime.walletStep,reference=input.mode==='current'?wallet:Math.round(input.amount*1e8)/1e8,at=e.now();
  const reset={...current,anchorWallet:reference,referenceWallet:reference,anchorBudget:current.budget,budget:current.budget,level:0,referenceSetAt:at,referenceSetMode:input.mode,referenceInput:reference};
  const candidate={...root,runtime:{...root.runtime,walletStep:reset}},projection=walletStepProjection(candidate,wallet),next=walletStepState(projection,{scope:e.state.scope,at});candidate.runtime.walletStep=next;
  const roots=e.budgetRoots(candidate),all=resolveBudgets(roots,wallet,e.accountSnapshot?.availableBalance),total=roots.filter(budgetIncluded).reduce((sum,b)=>sum+all.get(b.id).limit,0),increase=next.budget>current.budget+1e-8;
  const allowed=!budgetIncluded(root)||!increase||root.budgetShortfall==='available'||total<=wallet+1e-8;
  const warnings=[];if(reference!==projection.referenceWallet)warnings.push('지정한 기준과 현재 지갑의 차이에 완성된 구간이 있어 지금 '+projection.steps+'구간을 반영합니다. 남은 차액은 다음 구간으로 이어집니다.');
  if(root.runtime.runEnabled)warnings.push('현재 운용 상태를 유지합니다. 바뀐 한도는 이후 신규 진입부터 사용합니다.');
  if(!budgetIncluded(root))warnings.push('보관 중에는 구간을 누적하지 않습니다. 운용으로 이동하면 그때의 지갑을 새 기준으로 잡고 예산은 유지합니다.');
  const fingerprint=createHash('sha256').update(JSON.stringify({scope:e.state.scope,connection:e.connectionId,config:{...root,runtime:undefined},step:root.runtime.walletStep,wallet})).digest('hex');
  return {root,next,fingerprint,preview:{allowed,reason:allowed?'':'재설정 후 전체 배정예산 '+total.toFixed(2)+' USDT가 전체 선물지갑 '+wallet.toFixed(2)+' USDT를 초과합니다. 예산 부족 시 자동 축소를 선택하거나 기준을 조정하세요.',mode:input.mode,wallet,previousReference:current.referenceWallet,reference,appliedReference:projection.referenceWallet,before:current.budget,after:next.budget,effectiveBudget:all.get(root.id).limit,nextIncrease:projection.nextIncrease,nextDecrease:projection.nextDecrease,remaining:projection.remainingToIncrease,steps:projection.steps,warnings}};
 }
 async previewReference(id,input){
  const result=await this.inspectReference(id,input),now=this.e.now();for(const [key,p]of this.plans)if(p.expiresAt<=now)this.plans.delete(key);if(!result.preview.allowed)return result.preview;
  if(this.plans.size>=50)this.plans.delete(this.plans.keys().next().value);const previewId=randomUUID(),expiresAt=now+60000;
  this.plans.set(previewId,{id,input:structuredClone(input),fingerprint:result.fingerprint,expiresAt});return {...result.preview,previewId,expiresAt};
 }
 async commitReference(id,previewId){
  const plan=this.plans.get(previewId);if(!plan||plan.id!==id||plan.expiresAt<=this.e.now())throw Error('미리보기 유효시간이 지났습니다. 지갑 기준을 다시 확인하세요.');
  const result=await this.inspectReference(id,plan.input);if(!result.preview.allowed)throw Error(result.preview.reason);if(result.fingerprint!==plan.fingerprint)throw Error('지갑 금액·구간 기준 또는 봇 설정이 바뀌었습니다. 다시 미리보기를 확인하세요.');
  const {root,next,preview}=result;root.runtime.walletStep=next;if(root.kind==='multi')this.e.multi.syncBudgets(root);
  this.e.note('지갑 변동 기준 재설정',root.name+' · 기준 지갑 '+preview.previousReference.toFixed(2)+' → '+preview.reference.toFixed(2)+' USDT · 구간 예산 '+preview.before.toFixed(2)+' → '+preview.after.toFixed(2)+' USDT · 기록 유지',root.id);
  await this.e.checkpoint();this.plans.delete(previewId);return this.e.budgetSelection.view(root);
 }

 sync(){const e=this.e;if(!Number.isFinite(e.accountSnapshot?.walletBalance))return false;let changed=false;for(const root of [...e.state.bots.filter(b=>!b.multiBotId),...(e.state.multiBots||[])]){if(!isWalletStep(root)||root.budgetIncluded===false)continue;const old=root.runtime.walletStep,next=this.preview(root,root).runtime.walletStep;if(JSON.stringify(old)===JSON.stringify(next))continue;root.runtime.walletStep=next;changed=true;if(old?.budget!==next.budget)e.note('지갑 구간 예산 조정',root.name+' · '+(old?.budget??root.budget).toFixed(2)+' → '+next.budget.toFixed(2)+' USDT · 기준 지갑 '+next.referenceWallet.toFixed(2)+' USDT',root.id);if(root.kind==='multi')e.multi.syncBudgets(root);}return changed;}
}
