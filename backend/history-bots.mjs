import {budgetReference,isPercentBudget,percentBudgetBasis} from '../public/budget.js';
const sources=state=>[...(state.orders||[]),...(state.fills||[]),...(state.positionImports||[])];
const symbolsFor=(state,ids,initial=[],scope=state.scope)=>[...new Set([...initial,...sources(state).filter(row=>row.scope===scope&&ids.has(row.botId)).map(row=>row.symbol||row.parameters?.symbol)].filter(s=>typeof s==='string'&&/^[A-Z0-9_]{2,80}$/.test(s)))];
const workerOf=(id,parent)=>id.startsWith(parent+'_')&&/^[A-Z]$/.test(id.slice(parent.length+1));
export function historyMemberIds(root,state,recordIds=sources(state).filter(row=>row.scope===state.scope).map(row=>row.botId).filter(Boolean)){
 return root.kind==='multi'?[...new Set([root.id,...(root.memberIds||[]),...(state.bots||[]).filter(b=>b.multiBotId===root.id).map(b=>b.id),...recordIds.filter(id=>workerOf(id,root.id))])]:[root.id];
}
export function rememberDeletedBot(state,root,members,{now=Date.now(),walletBalance=null,availableBalance=null}={}){
 const ids=new Set(historyMemberIds({...root,memberIds:members.map(b=>b.id)},state,sources(state).map(row=>row.botId).filter(Boolean))),rows=sources(state).filter(row=>ids.has(row.botId)),scopes=new Set([state.scope,...rows.map(row=>row.scope)]);
 const budget=isPercentBudget(root)&&percentBudgetBasis(root,walletBalance,availableBalance)===null?null:budgetReference(root,walletBalance,availableBalance),records=[];
 for(const scope of scopes)records.push({id:root.id,scope,name:root.name||'봇',kind:root.kind==='multi'?'multi':'single',deletedAt:now,historyBudget:scope===state.scope&&Number.isFinite(budget)&&budget>0?budget:null,statsReset:root.statsReset?.scope===scope?structuredClone(root.statsReset):null,memberIds:[...ids],symbols:symbolsFor(state,ids,scope===state.scope?[root.symbol,...(root.legs||[]).map(leg=>leg.symbol)]:[],scope)});
 state.deletedBots=[...(state.deletedBots||[]).filter(old=>old.id!==root.id||!scopes.has(old.scope)),...records];
 return records;
}
export function historyRoots(state){
 const active=[...(state.bots||[]).filter(b=>!b.multiBotId),...(state.multiBots||[])],activeIds=new Set(active.map(b=>b.id)),rows=sources(state).filter(row=>row.scope===state.scope&&typeof row.botId==='string'),ids=[...new Set(rows.map(row=>row.botId))],roots=active.map(root=>({...root,deleted:false,budgetKnown:true})),claimed=new Set((state.bots||[]).map(b=>b.id));
 for(const root of active)for(const id of historyMemberIds(root,state,ids))claimed.add(id);
 for(const saved of state.deletedBots||[]){
  if(saved.scope!==state.scope||activeIds.has(saved.id))continue;
  const root={...saved,deleted:true,budget:Number(saved.historyBudget)||0,budgetType:'amount',budgetKnown:Number(saved.historyBudget)>0};
  roots.push(root);for(const id of historyMemberIds(root,state,ids))claimed.add(id);
 }
 const orphanGroups=new Map();
 for(const id of ids){
  if(claimed.has(id))continue;
  const match=/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_[A-Z]$/i.exec(id),rootId=match?.[1]||id;
  if(activeIds.has(rootId)||roots.some(root=>root.id===rootId))continue;
  if(!orphanGroups.has(rootId))orphanGroups.set(rootId,{id:rootId,kind:match?'multi':'single',members:[]});orphanGroups.get(rootId).members.push(id);
 }
 for(const item of orphanGroups.values()){
  const memberIds=item.members,symbols=symbolsFor(state,new Set(memberIds)),deleted=(state.logs||[]).find(log=>log.botId===item.id&&log.title==='봇 삭제'&&String(log.message).endsWith('의 설정을 삭제했습니다.')),name=deleted?deleted.message.slice(0,-'의 설정을 삭제했습니다.'.length):((symbols.join(' / ')||'이전 봇')+' · '+item.id.slice(0,8));
  roots.push({id:item.id,kind:item.kind,name,memberIds,symbols,deleted:true,recovered:true,deletedAt:deleted?.at||null,budget:0,budgetKnown:false,statsReset:null});
 }
 return roots;
}
export function historyBotCatalog(state){
 return historyRoots(state).map(root=>({id:root.id,name:root.name,kind:root.kind||'single',deleted:!!root.deleted,deletedAt:root.deletedAt||null,budgetKnown:root.deleted?root.budgetKnown!==false:true,symbols:root.symbols||symbolsFor(state,new Set(historyMemberIds(root,state)),[root.symbol,...(root.legs||[]).map(leg=>leg.symbol)])}));
}
