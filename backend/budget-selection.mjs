import {budgetIncluded,allocatedAmount,budgetSettingsErrors,resolveBudgets,requestedBudget} from '../public/budget.js';
const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
export class BudgetSelection{
 constructor(engine){this.e=engine;}
 root(id){if(this.e.multi.has(id))return this.e.multi.get(id);const b=this.e.bot(id);if(b.multiBotId)throw Error('다중종목 봇 전체의 운용·보관을 선택하세요.');return b;}
 members(root){return root.kind==='multi'?this.e.multi.workers(root):[root];}
 view(root){return root.kind==='multi'?this.e.multi.view(root):this.e.decorate(root);}
 blocked(root){const members=this.members(root);if(members.some(b=>b.runtime.closePending))return '정리 체결·취소 대조가 끝난 뒤 보관해 주세요.';if(root.kind==='multi'&&members.length!==root.legs.length)return '종목별 운용 기록을 확인한 뒤 보관해 주세요.';if(members.some(b=>b.runtime.quantity>0))return '보유 포지션이 있어 보관할 수 없습니다. 포지션을 정리한 뒤 이동하세요.';if(members.some(b=>b.runtime.syncHold))return '포지션 수량을 확인 중이어서 보관할 수 없습니다.';if(members.some(b=>this.e.ownOrders(b).some(o=>!terminal.has(o.status)||o.parameters.type==='LIMIT'&&(o.orderPolicy||b.order).remainder==='market'&&!o.fallbackDone&&['CANCELED','EXPIRED'].includes(o.status))))return '미체결·접수 확인 중인 주문 또는 잔량 처리가 남아 있어 보관할 수 없습니다.';return null;}
 async inspect(input,{fresh=true}={}){
  if(!input||typeof input.id!=='string'||typeof input.budgetIncluded!=='boolean'||budgetSettingsErrors(input).length||!['fixed','pnl','capped','floor'].includes(input.budgetMode||'fixed'))throw Error('운용예산과 포함 여부를 확인해 주세요.');
  const e=this.e,root=e.multi.has(input.id)?e.multi.get(input.id):e.state.bots.find(b=>b.id===input.id);if(root?.multiBotId)throw Error('다중종목 봇 전체에서 선택하세요.');
  if(fresh&&e.connected){await e.refreshAccount(true);if(root&&!input.budgetIncluded)for(const b of this.members(root))await e.syncBotPosition(b,true);}
  const wallet=e.accountSnapshot?.walletBalance??Infinity,roots=e.budgetRoots({...root,...input}),all=resolveBudgets(roots,wallet),allocation=all.get(input.id),otherAllocated=roots.filter(b=>b.id!==input.id&&budgetIncluded(b)).reduce((s,b)=>s+all.get(b.id).limit,0),requested=allocation.target,available=Math.max(0,wallet-otherAllocated),blocked=root?this.blocked(root):null;
  const message=!input.budgetIncluded?blocked:input.budgetShortfall!=='available'&&allocation.limit+otherAllocated>wallet+1e-8?'운용예산 '+requested.toFixed(2)+' USDT를 포함할 수 없습니다. 지갑 잔고에서 다른 운용 봇 배정 후 남은 한도는 '+available.toFixed(2)+' USDT입니다.':'';
  return {allowed:!message,message:message||'',requested,effectiveBudget:allocation.limit,budgetAllocation:allocation,otherAllocated,available:Number.isFinite(available)?available:null,canExclude:!blocked};
 }
 async preview(input){if(input?.budgetIncluded&&!this.e.connected)return {allowed:false,message:'계좌를 연결한 뒤 운용예산에 포함해 주세요.',canExclude:true};return this.inspect(input);}
 async assertSave(candidate,old){const prior=old?this.view(old):null,increase=budgetIncluded(candidate)&&(!prior||!budgetIncluded(prior)||requestedBudget({...candidate,runtime:prior.runtime},this.e.accountSnapshot?.walletBalance)>requestedBudget(prior,this.e.accountSnapshot?.walletBalance)+1e-8||['budgetType','budgetPercent','budgetShortfall','budgetFloor'].some(k=>candidate[k]!==old?.[k])),exclude=old&&budgetIncluded(old)&&!budgetIncluded(candidate);if(increase||exclude){const result=await this.inspect({...candidate,budgetIncluded:budgetIncluded(candidate)});if(!result.allowed)throw Error(result.message);}}
 async set(id,included){
  const e=this.e;e.storage.healthy();if(typeof included!=='boolean')throw Error('운용·보관 선택을 확인하세요.');const root=this.root(id);if(budgetIncluded(root)===included)return this.view(root);
  if(included&&!e.connected)throw Error('계좌를 연결한 뒤 운용으로 이동해 주세요.');const result=await this.inspect({...root,budgetIncluded:included});if(!result.allowed)throw Error(result.message);
  root.budgetIncluded=included;root.runtime.runEnabled=false;root.runtime.managementEnabled=false;for(const b of this.members(root)){b.budgetIncluded=included;b.runtime.runEnabled=false;b.runtime.managementEnabled=false;b.runtime.entryBlocked=null;}
  e.note(included?'운용으로 이동':'보관으로 이동',root.name+(included?' · 예산 포함 · 시작 대기':' · 예산 미포함'),root.id);await e.checkpoint();return this.view(root);
 }
}
