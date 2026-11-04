import {portfolioActionFormulaPosition,portfolioFormulaPosition} from '../public/formula-position.js';
import {budgetIncluded} from '../public/budget.js';
import {managementWasEnabled} from './management-state.mjs';
import {isStorageError} from './storage-recovery.mjs';
import {makeBot,effectiveBudget} from '../public/core.js';
import {makeMultiBot,validateMulti,multiAliases,multiAllocations,memberId} from '../public/multi-bot.js';
import {isEntry,isStop,actionDirection} from '../public/actions.js';
import {evaluateRuleFormula} from '../public/formula-runtime.js';
import {EntryCapacityError,isEntryCapacityError,entryOrder,protectiveOrders} from './orders.mjs';
import {leverageCap} from '../public/leverage.js';
const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']),active=o=>!terminal.has(o.status);
const initial=()=>({runEnabled:false,managementEnabled:false,error:null,lastEvaluation:null,cancelEntries:false,closeAll:false,stopSignals:{}});
export class MultiBots{
 constructor(engine){this.e=engine;}
 get groups(){return this.e.state.multiBots||[];}
 has(id){return this.groups.some(p=>p.id===id);}
 get(id){const p=this.groups.find(p=>p.id===id);if(!p)throw Error('다중종목 봇을 찾을 수 없습니다.');return p;}
 workers(p){return p.legs.map(leg=>this.e.state.bots.find(b=>b.id===memberId(p,leg))).filter(Boolean);}
 init(){this.e.state.multiBots||=[];for(const p of this.groups){p.runtime={...initial(),...p.runtime,managementEnabled:managementWasEnabled(p.runtime)||this.workers(p).some(b=>b.runtime.managementEnabled),runEnabled:false};for(const b of this.workers(p))b.runtime.runEnabled=false;}}
 stopFlags(){for(const p of this.groups){p.runtime.runEnabled=false;for(const b of this.workers(p))b.runtime.runEnabled=false;}}
 realized(p){return this.workers(p).reduce((s,b)=>s+Number(b.runtime.realized||0),0);}
 syncBudgets(p){const allocations=multiAllocations(p,this.realized(p));for(const leg of allocations){const b=this.e.state.bots.find(b=>b.id===memberId(p,leg));if(b){b.budget=leg.budget;b.budgetMode='fixed';b.maxEntries=p.maxEntries;b.budgetIncluded=p.budgetIncluded;}}return allocations;}
 view(p){
  const members=this.workers(p).map(b=>({...this.e.decorate(b),alias:b.multiAlias,parentId:p.id})),held=members.filter(b=>b.quantity>0),realized=members.reduce((s,b)=>s+Number(b.runtime.realized||0),0),used=members.reduce((s,b)=>s+b.used,0),reserved=members.reduce((s,b)=>s+b.reserved,0),pnl=members.reduce((s,b)=>s+b.pnl,0),orders=members.some(b=>this.e.ownOrders(b).some(active));
  return {...p,statsReset:p.statsReset?.scope===this.e.state.scope?p.statsReset:null,kind:'multi',symbol:p.legs.map(l=>l.symbol).join(' / '),members,quantity:held.length,entryPrice:null,positionDirection:'MULTI',leverage:held.length?held.reduce((s,b)=>s+b.leverage,0)/held.length:3,runtime:{...p.runtime,quantity:held.length,realized,orderRetry:members.find(b=>b.runtime.orderRetry)?.runtime.orderRetry||null,entryBlocked:p.runtime.runEnabled?(members.find(b=>b.runtime.entryBlocked)?.runtime.entryBlocked||null):null,waiting:this.e.waiting||members.find(b=>b.runtime.waiting)?.runtime.waiting||null},effectiveBudget:effectiveBudget({...p,runtime:{realized}}),used,reserved,pnl,fees:members.reduce((s,b)=>s+b.fees,0),costsPending:members.some(b=>b.costsPending),status:p.runtime.runEnabled||held.length||orders?'running':'paused',entryPaused:!p.runtime.runEnabled,task:held.length?'position':orders?'waiting':'watching',error:p.runtime.error,budgetWarning:members.some(b=>b.used+b.reserved>b.budget+1e-8)?'일부 종목의 사용 증거금이 배정 비중 한도를 초과했습니다. 기존 보유분은 유지하며 새 진입만 제한합니다.':null};
 }
 snapshot(){return this.groups.map(p=>this.view(p));}
 async save(input){
  const e=this.e,old=this.groups.find(p=>p.id===input.id),base=makeMultiBot(),p={...base,...Object.fromEntries(['id','name','budget','budgetMode','budgetIncluded','maxEntries','margin','color','legs','exit','actionRules'].filter(k=>input[k]!==undefined).map(k=>[k,structuredClone(input[k])]))};p.kind='multi';p.budgetIncluded=input.budgetIncluded===undefined?old?.budgetIncluded:input.budgetIncluded;
  if(e.state.bots.some(b=>b.id===p.id)||p.legs?.some?.(leg=>e.state.bots.some(b=>b.id===memberId(p,leg)&&b.multiBotId!==p.id)))throw Error('다른 봇과 식별자가 중복됩니다.');
  const before=structuredClone(e.state),symbols=(await e.catalog()).map(s=>s.symbol),oldIds=new Set(old?this.workers(old).map(b=>b.id):[]),others=e.allocatedBudget(p.id);
  const errors=validateMulti(p,{symbols,balance:Infinity,otherAllocated:others,previous:old});if(errors.length)throw Error(errors.join('\n'));await e.budgetSelection.assertSave(p,old);
  const locked=old&&this.workers(old).some(b=>b.runtime.quantity>0||e.ownOrders(b).some(active));
  if(locked&&(old.margin!==p.margin||JSON.stringify(old.legs.map(l=>[l.alias,l.symbol]))!==JSON.stringify(p.legs.map(l=>[l.alias,l.symbol]))))throw Error('보유·미해결 주문이 있을 때는 종목·별칭·증거금 모드를 바꿀 수 없습니다.');
  p.statsReset=old?.statsReset||null;p.runtime={...initial(),...old?.runtime,runEnabled:false,cancelEntries:true};if(!budgetIncluded(p))p.runtime.managementEnabled=false;
  const keep=new Set(p.legs.map(leg=>memberId(p,leg)));e.state.bots=e.state.bots.filter(b=>!oldIds.has(b.id)||keep.has(b.id));
  for(const leg of p.legs){
   let b=e.state.bots.find(b=>b.id===memberId(p,leg));if(!b){b={...makeBot({id:memberId(p,leg),symbol:leg.symbol,actionRules:[],exit:p.exit}),runtime:{runEnabled:false,quantity:0,entryPrice:0,entries:0,realized:0,lastExitAt:0,lastEntryAt:0,ruleSignals:{},positionEpoch:0,error:null,syncHold:false}};e.state.bots.push(b);}
   Object.assign(b,{name:p.name.slice(0,24)+' · '+leg.alias,symbol:leg.symbol,margin:p.margin,exit:structuredClone(p.exit),multiBotId:p.id,multiAlias:leg.alias,actionRules:[]});b.runtime.runEnabled=false;b.runtime.orderRetries={};if(!budgetIncluded(p))b.runtime.managementEnabled=false;
   for(const rule of p.actionRules)if(JSON.stringify(old?.actionRules.find(r=>r.id===rule.id))!==JSON.stringify(rule))delete b.runtime.ruleSignals[rule.id];
  }
  if(old)e.state.multiBots[e.state.multiBots.indexOf(old)]=p;else{e.state.multiBots||=[];e.state.multiBots.push(p);}this.syncBudgets(p);
  e.note(old?'다중종목 봇 저장':'다중종목 봇 생성',p.name+' · '+p.legs.map(l=>l.symbol+' '+l.weight+'%').join(' / '),p.id);
  try{await e.checkpoint();}catch(error){e.store.state=before;throw error;}e.positionInsights.cache=null;return this.view(p);
 }
 async start(id){
  const e=this.e,p=this.get(id);e.requireTrading();if(!budgetIncluded(p))throw Error('보관 중인 봇입니다. 운용으로 이동한 뒤 시작하세요.');if(p.runtime.runEnabled)return this.view(p);const workers=this.workers(p);if(workers.length!==p.legs.length)throw Error('종목별 운용 기록이 누락되었습니다.');
  this.syncBudgets(p);
  try{
   for(const rule of p.actionRules.filter(r=>r.enabled))await e.formulaMarkets(p.legs[0].symbol,rule.formula,new Map(),multiAliases(p));
   for(const b of workers)await e.startRuntime(b.id);
   p.runtime.runEnabled=true;p.runtime.managementEnabled=true;p.runtime.stopSignals={};p.runtime.error=null;p.runtime.cancelEntries=false;p.runtime.closeAll=false;for(const b of workers)b.runtime.error=null;
  }catch(error){if(isStorageError(error)){e.storage.stop(p.id);throw error;}p.runtime.runEnabled=false;for(const b of workers)b.runtime.runEnabled=false;await e.checkpoint();throw error;}
  e.note('다중종목 감시 시작',p.name,p.id);await e.checkpoint();return this.view(p);
 }
 async cancelEntries(p){if(!this.e.tradingEnabled)return;for(const b of this.workers(p))for(const o of this.e.ownOrders(b).filter(o=>active(o)&&o.role==='entry'))await this.e.cancelStandard(b,o,true);p.runtime.cancelEntries=false;}
 async pause(id){const p=this.get(id);p.runtime.runEnabled=false;p.runtime.cancelEntries=true;for(const b of this.workers(p))b.runtime.runEnabled=false;await this.e.checkpoint();await this.cancelEntries(p);this.e.note('다중종목 신규 진입 중지',p.name+' · 보유 포지션 관리는 계속합니다.',p.id);await this.e.checkpoint();return this.view(p);}
 async remove(id){const p=this.get(id),workers=this.workers(p);if(workers.some(b=>b.runtime.quantity>0||this.e.ownOrders(b).some(active)))throw Error('보유·미해결 주문이 있으면 삭제할 수 없습니다.');const ids=new Set(workers.map(b=>b.id));this.e.state.bots=this.e.state.bots.filter(b=>!ids.has(b.id));this.e.state.multiBots=this.groups.filter(b=>b.id!==id);await this.e.checkpoint();return {ok:true};}
 async close(id){const p=this.get(id);this.e.requireTrading();p.runtime.closeAll=true;p.runtime.runEnabled=false;for(const b of this.workers(p))b.runtime.runEnabled=false;await this.e.checkpoint();await this.closePending(p);return this.view(p);}
 async closePending(p){for(const b of this.workers(p)){if(b.runtime.syncHold)throw Error(b.name+' · 포지션 원장을 확인하세요.');if(b.runtime.quantity>0||this.e.ownOrders(b).some(active))await this.e.closePosition(b,'다중종목 전체 정리');}if(this.workers(p).every(b=>!b.runtime.quantity&&!this.e.ownOrders(b).some(active)))p.runtime.closeAll=false;}
 position(p,rule=null){return rule?portfolioActionFormulaPosition(this.view(p),rule,{account:this.e.liveAccount(),positionMode:this.e.hedge?'HEDGE':'ONE_WAY'}):portfolioFormulaPosition(this.view(p));}
 async evaluate(p,rule,cache){
  const snapshots=await this.e.formulaMarkets(p.legs[0].symbol,rule.formula,cache,multiAliases(p)),result=evaluateRuleFormula(rule.formula,snapshots,this.position(p,rule),{now:this.e.now()+(this.e.client.offset||0)});
  return result;
 }
 targetItem(p,rule,target,evaluation){
  const b=this.e.state.bots.find(b=>b.id===memberId(p,{alias:target.alias})),r=b.runtime,entry=isEntry(target.action),direction=actionDirection(target.action),position=this.e.rulePosition(b,target);
  const signal=r.ruleSignals[rule.id]||={fired:false,lastBar:null,lastExecutionAt:0,epoch:position.positionEpoch};if(!entry&&signal.epoch!==position.positionEpoch){signal.fired=false;signal.lastBar=null;signal.epoch=position.positionEpoch;}
  this.e.postOnly.observe(b,{id:rule.id},evaluation.result);if(!evaluation.result.missing&&!evaluation.result.pass){signal.fired=false;if(entry&&r.entryBlocked?.ruleId===rule.id)r.entryBlocked=null;}
  signal.lastEvaluation={at:this.e.now(),bar:evaluation.bar,interval:evaluation.interval,pass:evaluation.result.pass,missing:evaluation.result.missing};
  const ready=rule.reentry.mode==='bar'?signal.lastBar!==evaluation.bar:rule.reentry.mode==='cooldown'?this.e.now()-signal.lastExecutionAt>=rule.reentry.cooldown*1000:!signal.fired;
  const eligible=entry?p.runtime.runEnabled&&(!r.quantity||r.direction===direction)&&(!p.maxEntries||r.entries<p.maxEntries)&&this.e.now()-Number(r.lastExitAt||0)>=Number(rule.reentry.afterExitCooldown||0)*1000:position.quantity>0&&(!direction||position.direction===direction);
  return {worker:b,rule:{...target,id:rule.id,reentry:rule.reentry},signal,bar:evaluation.bar,interval:evaluation.interval,ready:eligible&&ready&&!evaluation.result.missing&&evaluation.result.pass&&this.e.postOnly.ready(b,rule)};
 }
 async execute(p,item){
  const e=this.e,b=item.worker;if(isEntry(item.rule.action)&&e.ownOrders(b).some(o=>active(o)&&o.kind==='standard'))return;
  const market=await e.market(b.symbol,item.interval),outcome=await e.executeRule(b,{...item,market},await e.symbolInfo(b.symbol));
  if(b.runtime.error||e.ownOrders(b).some(o=>o.status==='UNKNOWN')){p.runtime.error=b.name+' · '+(b.runtime.error||'주문 접수 확인 중')+' · 다른 종목의 보유분은 유지합니다.';p.runtime.runEnabled=false;p.runtime.cancelEntries=true;for(const worker of this.workers(p))worker.runtime.runEnabled=false;}
  return outcome;
 }
 async tick(p){
  const e=this.e,workers=this.workers(p);this.syncBudgets(p);if(!budgetIncluded(p)||!e.tradingEnabled)return;if(p.runtime.cancelEntries)await this.cancelEntries(p);if(p.runtime.closeAll){await this.closePending(p);return;}
  const accountManagement=p.runtime.managementEnabled&&p.actionRules.some(rule=>rule.enabled&&rule.targets?.some(t=>t.enabled&&t.closeScope==='account'&&!isEntry(t.action)&&e.rulePosition(workers.find(b=>b.multiAlias===t.alias),t).quantity>0));
  if(!p.runtime.runEnabled&&!accountManagement&&!workers.some(b=>b.runtime.quantity>0||e.ownOrders(b).some(active)))return;
  if(workers.some(b=>e.shared.active(b.symbol)&&e.shared.book(b.symbol).pending))return;
  const problem=workers.find(b=>b.runtime.syncHold||b.runtime.error&&(!p.runtime.error||p.runtime.runEnabled));if(problem){p.runtime.error=problem.name+' · '+(problem.runtime.error||'포지션 확인 필요');p.runtime.runEnabled=false;p.runtime.cancelEntries=true;await this.cancelEntries(p);for(const b of workers)b.runtime.runEnabled=false;}
  const managed=new Set(workers.filter(b=>b.runtime.lastExitAt===e.now()).map(b=>b.id)),cache=new Map(),evaluations=new Map(),evaluate=async rule=>{if(!evaluations.has(rule.id))evaluations.set(rule.id,await this.evaluate(p,rule,cache));return evaluations.get(rule.id);};p.runtime.lastEvaluation={at:e.now(),rules:[]};
  for(const rule of p.actionRules.filter(r=>r.enabled&&isStop(r.action))){if(!p.runtime.runEnabled)break;const evaluation=await evaluate(rule),signal=p.runtime.stopSignals[rule.id]||={fired:false};if(!evaluation.result.missing&&!evaluation.result.pass)signal.fired=false;if(evaluation.result.pass&&!evaluation.result.missing&&!signal.fired){signal.fired=true;await this.pause(p.id);return;}}
  for(const rule of p.actionRules.filter(r=>r.enabled&&r.action==='MULTI')){
   const targets=rule.targets.filter(t=>t.enabled&&!isEntry(t.action)&&e.rulePosition(workers.find(b=>b.multiAlias===t.alias),t).quantity>0);if(!targets.length)continue;
   const evaluation=await evaluate(rule);p.runtime.lastEvaluation.rules.push({id:rule.id,...evaluation.result,at:e.now()});
   for(const target of targets){const item=this.targetItem(p,rule,target,evaluation);if(item.ready&&!managed.has(item.worker.id)){managed.add(item.worker.id);await this.execute(p,item);}}
   // Observe already loaded entry signals without requiring another symbol/timeframe request.
   for(const target of rule.targets.filter(t=>t.enabled&&isEntry(t.action)))this.targetItem(p,rule,target,evaluation);
  }
  for(const b of workers)if(!managed.has(b.id)&&!b.runtime.syncHold){await e.settlePending(b,await e.symbolInfo(b.symbol));await e.refreshAccount();await e.syncBotPosition(b);await e.ensureGuards(b,await e.symbolInfo(b.symbol));}
  if(!p.runtime.runEnabled)return;
  const batches=[],directions=new Map();
  for(const rule of p.actionRules.filter(r=>r.enabled&&r.action==='MULTI')){
   const targets=rule.targets.filter(t=>t.enabled&&isEntry(t.action));if(!targets.length)continue;const evaluation=await evaluate(rule),items=targets.map(t=>this.targetItem(p,rule,t,evaluation)).filter(item=>item.ready&&!managed.has(item.worker.id)&&!e.postOnly.pending(item.worker).some(record=>record.role==='exit')&&!e.ownOrders(item.worker).some(o=>active(o)&&o.kind==='standard'));
   p.runtime.lastEvaluation.rules.push({id:rule.id,...evaluation.result,at:e.now()});for(const item of items){const list=directions.get(item.worker.id)||new Set();list.add(actionDirection(item.rule.action));directions.set(item.worker.id,list);}batches.push(items);
  }
  for(const batch of batches){
   const items=batch.filter(item=>{if(directions.get(item.worker.id).size!==1||managed.has(item.worker.id))return false;const usage=e.decorate(item.worker);if(usage.used+usage.reserved>=item.worker.budget){if(!item.worker.runtime.entryBlocked||item.worker.runtime.entryBlocked.key!==e.entryKey(item.worker,item.rule))e.blockEntry(item.worker,item.rule,new EntryCapacityError('no-margin',{remainingBudget:0}));p.runtime.lastEvaluation.blocked=item.worker.multiAlias+' · 배정예산 부족';return false;}return true;});for(const item of batch)if(directions.get(item.worker.id).size>1){p.runtime.lastEvaluation.conflict=true;e.note('진입 신호 충돌',item.worker.name+' · 롱과 숏이 동시에 충족되어 보류합니다.',p.id);}if(!items.length)continue;
   let required=0,blocked=false;
   for(const item of items){
    const b=item.worker;if(!await e.entryRetryReady(b,item.rule)){blocked=true;break;}
    const market=await e.market(b.symbol,item.interval),info=await e.symbolInfo(b.symbol),view=e.orderView(b,item.rule,actionDirection(item.rule.action)),usage=e.decorate(b);
    if(usage.used+usage.reserved>=b.budget){e.blockEntry(b,item.rule,new EntryCapacityError('no-margin',{remainingBudget:0}));blocked=true;break;}
    const limits=await e.leverageLimits(b.symbol);if(view.leverage>leverageCap(limits,b.budget))throw Error(b.name+' · 레버리지 한도 초과');
    try{const plan=entryOrder(view,info,{...market.book,lastPrice:market.ticker.lastPrice},Infinity,e.hedge);protectiveOrders(view,info,plan.parameters.quantity,Number(plan.parameters.price||market.ticker.lastPrice),e.hedge);required+=plan.margin;}
    catch(error){if(!isEntryCapacityError(error))throw error;e.blockEntry(b,item.rule,error);blocked=true;break;}
   }
   if(blocked){p.runtime.lastEvaluation.blocked='최소 주문 기준 또는 잔여 예산 대기';continue;}
   if(required*1.01>e.accountSnapshot.availableBalance){p.runtime.lastEvaluation.blocked='배정 비중 또는 계좌 가용 증거금 부족';continue;}
   for(const item of items)await e.prepareEntryLeverage(item.worker,item.worker.runtime.quantity?item.worker.leverage:item.rule.leverage);
   for(const item of items){managed.add(item.worker.id);const outcome=await this.execute(p,item);if(!p.runtime.runEnabled||outcome?.blocked)break;}if(!p.runtime.runEnabled)break;
  }
 }
 insights(value){const botFunding={...value.botFunding};for(const p of this.groups){const parts=this.workers(p).map(b=>botFunding[b.id]);botFunding[p.id]={statsResetAt:p.statsReset?.scope===this.e.state.scope?p.statsReset.at:null,complete:parts.length>0&&parts.every(v=>v?.complete),funding:parts.every(v=>v?.complete)?parts.reduce((s,v)=>s+v.funding,0):null,reason:'일부 종목의 수수료·펀딩 조회 확인 필요'};}return {...value,botFunding};}
}
