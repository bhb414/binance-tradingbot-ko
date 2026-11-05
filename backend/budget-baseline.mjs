import {randomUUID,createHash} from 'node:crypto';
import {budgetIncluded,budgetRealized,effectiveBudget} from '../public/budget.js';
const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const active=o=>!terminal.has(o.status);
const unfinishedEntry=(o,b)=>o.role==='entry'&&(active(o)||o.parameters.type==='LIMIT'&&(o.orderPolicy||b.order)?.remainder==='market'&&!o.fallbackDone&&['CANCELED','EXPIRED'].includes(o.status));
export class BudgetBaselines{
 constructor(engine){this.e=engine;this.plans=new Map();}
 checkOrders(members){
  for(const b of members)for(const o of this.e.ownOrders(b)){
   if(o.status==='UNKNOWN')throw Error('접수 여부를 확인 중인 주문이 있습니다. 주문 확인 후 다시 시도하세요.');
   if(unfinishedEntry(o,b))throw Error('미체결 진입 주문 또는 잔량 처리가 남아 있습니다. 체결·취소 확인 후 다시 시도하세요.');
  }
 }
 fingerprint(root,members){
  return createHash('sha256').update(JSON.stringify({scope:this.e.state.scope,connection:this.e.connectionId,config:{...root,runtime:undefined},baseline:root.runtime.budgetBaseline||null,withheld:root.runtime.budgetWithheld||0,running:root.runtime.runEnabled,members:members.map(b=>({id:b.id,realized:b.runtime.realized,quantity:b.runtime.quantity,entryPrice:b.runtime.entryPrice,direction:b.runtime.direction,epoch:b.runtime.positionEpoch,leverage:b.leverage,running:b.runtime.runEnabled,orders:this.e.ownOrders(b).map(o=>[o.id,o.status,o.appliedQty,o.feesFetched,o.fallbackDone])}))})).digest('hex');
 }
 async inspect(id){
  const e=this.e;e.storage.healthy();if(!e.connected)throw Error('계좌를 연결한 뒤 예산 기준을 재설정하세요.');
  const root=e.budgetSelection.root(id),members=e.budgetSelection.members(root);
  if(root.kind==='multi'&&members.length!==root.legs.length)throw Error('종목별 운용 기록이 누락되어 재설정할 수 없습니다.');
  this.checkOrders(members);await e.refreshAccount(true);
  for(const b of members){
   await e.syncBotPosition(b,true);
   for(const o of e.ownOrders(b).filter(o=>o.appliedQty>0&&!o.feesFetched))await e.refreshOrder(b,o);
  }
  this.checkOrders(members);
  if(members.some(b=>b.runtime.syncHold||e.shared.active(b.symbol)&&e.shared.book(b.symbol).pending))throw Error('포지션·체결 원장을 대조 중입니다. 확인이 끝난 뒤 다시 시도하세요.');
  const pending=members.flatMap(b=>e.ownOrders(b)).find(o=>o.appliedQty>0&&!o.feesFetched);if(pending)throw Error(pending.parameters.symbol+' · 주문 '+(pending.orderId||pending.id)+'의 체결 수수료 확인이 끝난 뒤 재설정하세요.');
  const view=e.budgetSelection.view(root),realized=Number(view.runtime.realized)||0,before=effectiveBudget(view),after=e.budgetLimit({...view,runtime:{...view.runtime,budgetBaseline:{realized,withheld:view.runtime.budgetWithheld||0}}}),other=e.allocatedBudget(root.id),wallet=e.accountSnapshot?.walletBalance;
  if(!Number.isFinite(wallet))throw Error('선물지갑 잔고를 확인하지 못했습니다.');
  const increase=budgetIncluded(root)&&after>before+1e-8,allowed=root.budgetShortfall==='available'||!increase||other+after<=wallet+1e-8,warnings=[],running=!!root.runtime.runEnabled||members.some(b=>b.runtime.runEnabled),held=members.some(b=>b.runtime.quantity>0);
  if(running)warnings.push('운용 상태를 유지합니다. 늘어난 한도는 이후 조건 주문에 사용될 수 있습니다.');
  if(held)warnings.push('보유 포지션은 유지합니다. 나중에 정리하면서 확정되는 손익은 예산에 반영됩니다.');
  if(view.used+view.reserved>after+1e-8)warnings.push('현재 사용·예약 증거금이 새 한도를 넘습니다. 기존 보유분은 유지하고 새 진입만 남은 한도로 제한합니다.');
  return {root,members,fingerprint:this.fingerprint(root,members),preview:{allowed,reason:allowed?'':'재설정 후 전체 배정예산 '+(other+after).toFixed(2)+' USDT가 선물지갑 '+wallet.toFixed(2)+' USDT를 초과합니다.',before,after,base:root.budget,mode:root.budgetMode||'fixed',budgetFloor:root.budgetFloor,profitReinvestPercent:root.profitReinvestPercent??100,withheld:view.runtime.budgetWithheld||0,realized,budgetPnl:budgetRealized(view),used:view.used,reserved:view.reserved,running,held,warnings,currentBaselineAt:root.runtime.budgetBaseline?.at||null}};
 }
 async preview(id){
  const result=await this.inspect(id),now=this.e.now();for(const [key,p]of this.plans)if(p.expiresAt<=now)this.plans.delete(key);
  if(!result.preview.allowed)return result.preview;
  if(this.plans.size>=50)this.plans.delete(this.plans.keys().next().value);
  const previewId=randomUUID(),expiresAt=now+60000;this.plans.set(previewId,{id,fingerprint:result.fingerprint,expiresAt});
  return {...result.preview,previewId,expiresAt};
 }
 async commit(id,previewId){
  const plan=this.plans.get(previewId);if(!plan||plan.id!==id||plan.expiresAt<=this.e.now())throw Error('미리보기 유효시간이 지났습니다. 예산 기준을 다시 확인하세요.');
  const result=await this.inspect(id);
  if(!result.preview.allowed)throw Error(result.preview.reason);
  if(result.fingerprint!==plan.fingerprint)throw Error('확정손익·설정 또는 운용 상태가 바뀌었습니다. 예산 기준을 다시 확인하세요.');
  const {root,preview}=result;root.runtime.budgetBaseline={at:this.e.now(),scope:this.e.state.scope,realized:preview.realized,withheld:preview.withheld};
  if(root.kind==='multi')this.e.multi.syncBudgets(root);
  this.e.note('예산 손익 기준 재설정',root.name+' · '+preview.before.toFixed(2)+' → '+preview.after.toFixed(2)+' USDT · 매매 기록·통계 유지',root.id);
  await this.e.checkpoint();this.plans.delete(previewId);return this.e.budgetSelection.view(root);
 }
}
