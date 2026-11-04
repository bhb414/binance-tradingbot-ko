import {excursionKey,excursionView,excursionStats} from './trade-excursions.mjs';
import {createHash} from 'node:crypto';
const num=value=>Number.isFinite(Number(value))?Number(value):0;
const valid=value=>Number.isFinite(Number(value))&&Number(value)>0;
const eps=1e-9;
export function mergeCoverage(ranges){
 const sorted=ranges.filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>=r.start).map(r=>({...r})).sort((a,b)=>a.start-b.start),out=[];
 for(const r of sorted){const last=out.at(-1);if(last&&r.start<=last.end+1)last.end=Math.max(last.end,r.end);else out.push(r);}return out;
}
export function fundingRecords(rows,scope){
 return rows.filter(r=>r.incomeType==='FUNDING_FEE'&&r.symbol&&Number.isFinite(Number(r.income))&&Number.isFinite(Number(r.time))).map(r=>({id:'funding:'+createHash('sha256').update(JSON.stringify([scope,r.symbol,r.tranId??null,r.asset,Number(r.time),Number(r.income)])).digest('hex'),scope,symbol:r.symbol,at:Number(r.time),amount:Number(r.income),asset:r.asset}));
}
const covered=(ranges,start,end)=>ranges.some(r=>r.start<=start&&r.end>=end);
function executionLeverage(order,fill){
 const direct=Number(fill?.leverage||order?.leverage);if(Number.isInteger(direct)&&direct>=1&&direct<=125)return {value:direct,estimated:false};
 const quantity=num(order?.parameters?.quantity),price=num(order?.parameters?.price)||(num(order?.appliedQty)>0?num(order.appliedQuote)/num(order.appliedQty):0),ratio=quantity*price/num(order?.margin),rounded=Math.round(ratio);
 return Number.isFinite(ratio)&&rounded>=1&&rounded<=125&&Math.abs(ratio-rounded)<=Math.max(.02,rounded*.02)?{value:rounded,estimated:true}:{value:null,estimated:false};
}
function ledger(state,now){
 const scope=state.scope,orders=(state.orders||[]).filter(o=>o.scope===scope&&o.botId),byId=new Map(orders.map(o=>[o.id,o])),byExchange=new Map(),fees=new Map(),all=(state.fills||[]).filter(f=>f.scope===scope&&f.botId),seen=new Set(),groups=new Map(),orphans=[];
 for(const o of orders)if(o.orderId)byExchange.set(o.botId+':'+o.parameters.symbol+':'+o.orderId,o);
 for(const fee of all.filter(f=>f.fee!=null)){if(seen.has(fee.id))continue;seen.add(fee.id);let order=byId.get(fee.clientOrderId)||byExchange.get(fee.botId+':'+fee.symbol+':'+fee.orderId);
  if(!order){const tail=String(fee.id||''),prefix='fee:'+scope+':'+fee.symbol+':',id=tail.startsWith(prefix)?tail.slice(prefix.length).split(':')[0]:tail.match(/^fee:(\d+):/)?.[1];if(id)order=byExchange.get(fee.botId+':'+fee.symbol+':'+id);}
  if(order){if(!fees.has(order.id))fees.set(order.id,[]);fees.get(order.id).push(fee);}else orphans.push(fee);
 }
 seen.clear();
 for(const f of all.filter(f=>valid(f.quantity)&&valid(f.price))){if(seen.has(f.id))continue;seen.add(f.id);const order=byId.get(f.clientOrderId)||byId.get(String(f.id).slice(0,String(f.id).lastIndexOf(':'))),key=order?.id||f.id;
  if(!groups.has(key))groups.set(key,{order,rows:[]});groups.get(key).rows.push(f);
 }
 const events=[];
 for(const [key,group]of groups){
  const {order}=group,epochs=[...new Set(group.rows.map(f=>f.positionEpoch).filter(v=>Number.isInteger(v)))],total=group.rows.reduce((s,f)=>s+num(f.quantity),0),costs=fees.get(key)||[],actual=costs.filter(f=>valid(f.tradeQuantity)&&valid(f.tradePrice)&&valid(f.at)),sum=actual.reduce((s,f)=>s+num(f.tradeQuantity),0),precise=actual.length>0&&Math.abs(sum-total)<=Math.max(eps,total*1e-7),source=precise?actual:group.rows;
  for(const f of source){const at=precise?num(f.at):valid(f.tradeTime)?num(f.tradeTime):num(f.at),lev=executionLeverage(order,f),role=precise?order.role:f.role,direction=f.direction||order?.direction||(role==='entry'?(f.side||order?.parameters?.side)==='BUY'?'LONG':'SHORT':(f.side||order?.parameters?.side)==='SELL'?'LONG':'SHORT');
   if(!['entry','exit','take','stop'].includes(role)||at>now)continue;
   events.push({id:precise?'trade:'+f.id:f.id,botId:f.botId,symbol:f.symbol,at,earliest:precise||valid(f.tradeTime)?at:Math.min(at,num(order?.createdAt)||at),precise:precise||valid(f.tradeTime),type:role==='entry'?'entry':'exit',role,direction,quantity:num(precise?f.tradeQuantity:f.quantity),price:num(precise?f.tradePrice:f.price),positionEpoch:Number.isInteger(f.positionEpoch)?f.positionEpoch:epochs.length===1?epochs[0]:null,leverage:lev.value,leverageEstimated:lev.estimated,orderId:order?.id||null,source:order?.source==='exchange-close'?'exchange-close':(order?.source==='bot-manual'||order?.origin==='bot-manual')?'bot-manual':'bot',hedged:order?.parameters?.positionSide&&order.parameters.positionSide!=='BOTH'});
  }
 }
 for(const r of state.positionImports||[])if(r.scope===scope&&r.botId&&r.at<=now&&valid(r.quantity))events.push({id:'import:'+r.id,botId:r.botId,symbol:r.symbol,at:r.at,earliest:r.at,precise:true,type:'import',role:'import',positionEpoch:r.positionEpoch??null,additive:!!r.additive,direction:r.direction,quantity:r.quantity,price:r.entryPrice,leverage:r.leverage||null,leverageEstimated:false,orderId:null,source:'import',hedged:false});
 events.sort((a,b)=>a.at-b.at);
 return {events,orders,byId,fees,orphans};
}
function reconstruct(data,now){
 const active=new Map(),cycles=[],indexes=new Map();
 const create=(event,orphan=false)=>{
  const count=(indexes.get(event.botId)||0)+1;indexes.set(event.botId,count);
  const c={id:event.botId+':'+event.id,botId:event.botId,symbol:event.symbol,direction:event.direction,index:count,positionEpoch:event.positionEpoch,openedAt:event.at,closedAt:null,entryQuantity:0,exitQuantity:0,entryNotional:0,exitNotional:0,entryMargin:0,marginKnown:true,marginEstimated:false,remaining:0,averagePrice:0,grossRealized:0,imported:orphan,unknownEntry:orphan,inconsistent:false,hedged:!!event.hedged,events:[],orders:new Map(),funding:0,fundingEvents:[],fee:0,costReasons:[]};cycles.push(c);active.set(event.botId,c);return c;
 };
 for(const event of data.events){let c=active.get(event.botId);
  if(event.type==='entry'||event.type==='import'){
   if(c&&(c.symbol!==event.symbol||c.direction!==event.direction)){c.inconsistent=true;c.costReasons.push('보유 방향 기록 불일치');active.delete(event.botId);c=null;}
   c||=create(event);if(event.type==='import'){if(c.remaining>eps&&!event.additive)c.inconsistent=true;c.imported=true;c.marginKnown=false;}
   c.averagePrice=(c.remaining*c.averagePrice+event.quantity*event.price)/(c.remaining+event.quantity);c.remaining+=event.quantity;c.entryQuantity+=event.quantity;c.entryNotional+=event.quantity*event.price;
   if(valid(event.leverage))c.entryMargin+=event.quantity*event.price/event.leverage;else c.marginKnown=false;
   c.marginEstimated||=event.leverageEstimated;
  }else{
   if(!c)c=create(event,true);
   if(event.direction!==c.direction)c.inconsistent=true;
   const closed=Math.min(c.remaining,event.quantity);if(event.quantity>c.remaining+eps)c.unknownEntry=true;
   c.grossRealized+=(event.price-c.averagePrice)*closed*(c.direction==='LONG'?1:-1);c.exitQuantity+=event.quantity;c.exitNotional+=event.quantity*event.price;c.remaining=Math.max(0,c.remaining-event.quantity);
  }
  if(event.positionEpoch!=null){if(c.positionEpoch==null)c.positionEpoch=event.positionEpoch;else if(c.positionEpoch!==event.positionEpoch)c.excursionMismatch=true;}
  c.hedged||=event.hedged;c.events.push({...event,remaining:c.remaining});
  if(event.orderId)c.orders.set(event.orderId,(c.orders.get(event.orderId)||0)+event.quantity);
  if(c.remaining<=eps&&event.type==='exit'){c.closedAt=event.at;c.remaining=0;active.delete(event.botId);}
 }
 return cycles;
}
function applyCosts(cycles,data,funding,now,sharedEvents=[]){
 const totalByOrder=new Map();for(const c of cycles)for(const [id,q]of c.orders)totalByOrder.set(id,(totalByOrder.get(id)||0)+q);
 for(const c of cycles){
  if(c.imported)c.costReasons.push('인수 전 진입 수수료 미확인');
  if(c.events.some(event=>event.type!=='import'&&!event.orderId))c.costReasons.push('체결과 주문의 연결 기록 미확인');
  if(c.unknownEntry||c.inconsistent)c.costReasons.push('진입·정리 체결 기록 확인 필요');
  for(const [id,q]of c.orders){const order=data.byId.get(id),fees=data.fees.get(id)||[],weight=q/totalByOrder.get(id);
   if(!order?.feesFetched||!fees.length)c.costReasons.push('수수료 조회 대기');
   const measured=fees.filter(f=>valid(f.tradeQuantity));if(measured.length&&Math.abs(measured.reduce((s,f)=>s+num(f.tradeQuantity),0)-num(order?.appliedQty))>Math.max(eps,num(order?.appliedQty)*1e-7)||!measured.length&&fees.length>=1000)c.costReasons.push('일부 체결 수수료만 확인됨');
   for(const f of fees){if(f.feeAsset!=='USDT')c.costReasons.push('USDT 외 수수료 미환산');else c.fee+=num(f.fee)*weight;}
  }
  const end=c.closedAt??Math.min(now,funding.asOf||now);if(end<c.openedAt||!covered(funding.coverage,c.openedAt,end))c.costReasons.push('펀딩 조회 범위 미확인');
  if(c.hedged)c.costReasons.push('헤지 포지션 펀딩 귀속 미확인');
 }
 for(const row of funding.rows){
  const owners=cycles.filter(c=>c.symbol===row.symbol&&c.openedAt<=row.at&&(c.closedAt==null||row.at<=c.closedAt)&&c.events.filter(e=>e.at<=row.at).at(-1)?.remaining>eps),boundary=cycles.filter(c=>c.symbol===row.symbol&&c.events.some(e=>(!e.precise&&row.at>=e.earliest&&row.at<=e.at)||row.at===e.at));
  const shared=sharedEvents.filter(e=>e.symbol===row.symbol&&e.at<=row.at).at(-1),sharedTotal=shared?.pools.reduce((n,p)=>n+p.quantity,0);
  if(sharedTotal>0&&!boundary.length&&row.asset==='USDT'&&owners.every(c=>!c.hedged)){for(const c of owners){const quantity=shared.pools.filter(p=>p.botId===c.botId&&p.direction===c.direction).reduce((n,p)=>n+p.quantity,0),amount=row.amount*quantity/sharedTotal;c.funding+=amount;c.fundingEvents.push({at:row.at,amount});}}
  else if(owners.length===1&&!owners[0].hedged&&!boundary.length&&row.asset==='USDT'){owners[0].funding+=row.amount;owners[0].fundingEvents.push({at:row.at,amount:row.amount});}
  else for(const c of new Set([...owners,...boundary]))c.costReasons.push(row.asset!=='USDT'?'USDT 외 펀딩 미환산':'펀딩 시점의 소유 포지션 확인 필요');
 }
 for(const c of cycles){c.costReasons=[...new Set(c.costReasons)];c.gross=c.unknownEntry||c.inconsistent?null:c.grossRealized;c.costsComplete=!c.costReasons.length;c.net=c.closedAt&&c.costsComplete&&c.gross!=null?c.gross-c.fee+c.funding:null;c.returnPercent=c.net!=null&&c.marginKnown&&c.entryMargin>0?c.net/c.entryMargin*100:null;}
}
function statsAndCurve(trades,budget,start,now){
 const closed=trades.filter(c=>c.closedAt),known=closed.filter(c=>c.net!=null),wins=known.filter(c=>c.net>eps),losses=known.filter(c=>c.net<-eps),flat=known.length-wins.length-losses.length,net=known.reduce((s,c)=>s+c.net,0),returns=known.map(c=>c.returnPercent).filter(v=>v!=null);
 let cumulative=0,peak=budget,drawdown=0,drawdownAmount=0;
 const points=[{at:known[0]?Math.min(start,known[0].closedAt-1000):now,net:0,returnPercent:budget>0?0:null,equity:budget>0?budget:null}];
 for(const c of [...known].sort((a,b)=>a.closedAt-b.closedAt)){cumulative+=c.net;const equity=budget+cumulative;peak=Math.max(peak,equity);const dd=peak-equity;drawdownAmount=Math.max(drawdownAmount,dd);if(peak>0)drawdown=Math.max(drawdown,dd/peak*100);points.push({at:c.closedAt,net:cumulative,returnPercent:budget>0?cumulative/budget*100:null,equity:budget>0?equity:null});}
 const winning=wins.reduce((s,c)=>s+c.net,0),losing=-losses.reduce((s,c)=>s+c.net,0);
 return {summary:{closed:closed.length,confirmed:known.length,pending:closed.length-known.length,open:trades.filter(c=>!c.closedAt).length,wins:wins.length,losses:losses.length,flat,winRate:known.length?wins.length/known.length*100:null,net,returnPercent:budget>0?net/budget*100:null,fee:known.reduce((s,c)=>s+c.fee,0),funding:known.reduce((s,c)=>s+c.funding,0),gross:known.reduce((s,c)=>s+c.gross,0),averageNet:known.length?net/known.length:null,averageTradeReturn:returns.length?returns.reduce((s,v)=>s+v,0)/returns.length:null,profitFactor:losing>0?winning/losing:null,noLoss:!losses.length&&wins.length>0,best:known.length?Math.max(...known.map(c=>c.net)):null,worst:known.length?Math.min(...known.map(c=>c.net)):null,averageHoldingMs:known.length?known.reduce((s,c)=>s+c.closedAt-c.openedAt,0)/known.length:null,maxDrawdownPercent:budget>0?drawdown:null,maxDrawdownAmount:drawdownAmount,long:closed.filter(c=>c.direction==='LONG').length,short:closed.filter(c=>c.direction==='SHORT').length},curve:points};
}
export function buildTradeHistory({state,botId,now=Date.now(),range='all',page=1,pageSize=20,funding=null,account=null}){
 if(!['all','7d','30d','90d'].includes(range))throw Error('조회 기간을 확인하세요.');
 if(!Number.isInteger(page)||page<1||page>100000)throw Error('기록 페이지를 확인하세요.');
 const roots=[...(state.bots||[]).filter(b=>!b.multiBotId),...(state.multiBots||[])],bot=botId==null?{id:null,name:'봇 전체',kind:'all',budget:roots.reduce((sum,b)=>sum+num(b.budget),0)}:roots.find(b=>b.id===botId);if(!bot)throw Error('봇을 찾을 수 없습니다.');
 const scope=state.scope,savedRows=(state.fundingLedger||[]).filter(f=>f.scope===scope),extra=funding?.scope===scope?funding:null,coverage=mergeCoverage([...(state.fundingCoverage||[]).filter(r=>r.scope===scope),...(extra?.complete?[{start:extra.startTime,end:extra.endTime}]:[])]),records=new Map([...savedRows,...(extra?.rows||[])].map(r=>[r.id,r]));
 const data=ledger(state,now),all=reconstruct(data,now);applyCosts(all,data,{rows:[...records.values()],coverage,asOf:extra?.endTime||Math.max(0,...coverage.map(r=>r.end))},now,(state.sharedEvents||[]).filter(e=>e.scope===scope));
 const excursionRecords=new Map((state.tradeExcursions||[]).filter(r=>r.scope===scope).map(r=>[excursionKey(scope,r.botId,r.positionEpoch),r]));
 for(const c of all){let record=c.excursionMismatch||c.positionEpoch==null?null:excursionRecords.get(excursionKey(scope,c.botId,c.positionEpoch));if(!record&&!c.excursionMismatch&&c.positionEpoch==null&&!c.closedAt){const partials=[...excursionRecords.values()].filter(r=>r.botId===c.botId&&r.symbol===c.symbol&&r.direction===c.direction&&r.partial&&!r.closedAt&&r.observedFrom>=c.openedAt&&Math.abs(r.quantity-c.remaining)<=Math.max(eps,c.remaining*1e-7));if(partials.length===1)record=partials[0];}c.excursion=excursionView(record?.symbol===c.symbol&&record?.direction===c.direction?record:null);}
 const ids=new Set(bot.kind==='all'?all.map(c=>c.botId):bot.kind==='multi'?[bot.id,...(state.bots||[]).filter(b=>b.multiBotId===bot.id).map(b=>b.id),...all.filter(c=>c.botId.startsWith(bot.id+'_')&&/^[A-Z]$/.test(c.botId.slice(bot.id.length+1))).map(c=>c.botId)]:[bot.id]),start=Math.max(bot.statsReset?.scope===scope?bot.statsReset.at:0,range==='all'?Math.min(now,...all.filter(c=>ids.has(c.botId)).map(c=>c.openedAt)):now+({'7d':-7,'30d':-30,'90d':-90}[range])*86400000),resetFor=id=>roots.find(root=>root.id===id||root.kind==='multi'&&id.startsWith(root.id+'_')),selected=all.filter(c=>{const reset=resetFor(c.botId)?.statsReset;return ids.has(c.botId)&&(c.closedAt==null||c.closedAt>=start)&&(!(reset?.scope===scope)||c.openedAt>reset.at);}),budget=num(bot.budget),report=statsAndCurve(selected,budget,start,now),sorted=selected.sort((a,b)=>(b.closedAt??now)-(a.closedAt??now)||b.openedAt-a.openedAt),pages=Math.max(1,Math.ceil(sorted.length/pageSize)),actualPage=Math.min(page,pages);
 report.summary.excursions=excursionStats(selected);
 const trades=sorted.slice((actualPage-1)*pageSize,actualPage*pageSize).map(c=>{
  const matching=account?.positions?.find(p=>p.symbol===c.symbol&&(p.positionSide==='BOTH'||p.positionSide===c.direction)),mark=matching?num(matching.markPrice):null,unrealized=!c.closedAt&&mark>0?(mark-c.averagePrice)*c.remaining*(c.direction==='LONG'?1:-1):null;
  return {id:c.id,botId:c.botId,symbol:c.symbol,direction:c.direction,index:c.index,openedAt:c.openedAt,closedAt:c.closedAt,status:c.closedAt?'closed':'open',imported:c.imported,inconsistent:c.inconsistent||c.unknownEntry,entryQuantity:c.entryQuantity,exitQuantity:c.exitQuantity,remaining:c.remaining,entryPrice:c.entryQuantity>0?c.entryNotional/c.entryQuantity:null,exitPrice:c.exitQuantity>0?c.exitNotional/c.exitQuantity:null,entryMargin:c.marginKnown?c.entryMargin:null,marginEstimated:c.marginEstimated,gross:c.gross,fee:c.fee,funding:c.funding,net:c.net,returnPercent:c.returnPercent,unrealized,costsComplete:c.costsComplete,costReasons:c.costReasons,excursion:c.excursion,holdingMs:(c.closedAt??now)-c.openedAt,events:c.events.map(({id,at,type,role,quantity,price,leverage,source,precise})=>({id,at,type,role,quantity,price,leverage,source,timeEstimated:!precise}))};
 });
 return {bot:{id:bot.id,name:bot.name,budget,kind:bot.kind||'single',statsResetAt:bot.statsReset?.scope===scope?bot.statsReset.at:null},asOf:now,fundingAsOf:extra?.endTime||Math.max(0,...coverage.map(r=>r.end)),range,startTime:start,endTime:now,...report,trades,pagination:{page:actualPage,pages,total:sorted.length,pageSize},notes:{excursionBasis:'마크가격 관측값과 실제 체결가로 계산한 매매손익(부분 정리 실현손익 + 남은 평가손익). 수수료·펀딩 차감 전. 수익률은 각 관측 시점까지 투입한 진입 증거금 합계 대비이며 금액 최대 시점과 다를 수 있습니다.',excursionCoverage:'과거 완료 거래는 미수집. 보유 도중 적용·수동 인수·체결 대조가 필요한 거래는 부분 관측으로 구분하며 최대 손익 집계에서 제외합니다. 미관측 시점의 실제 고가·저가는 알 수 없습니다.',returnBasis:'거래별: 순손익 ÷ 진입 증거금 합계. 누적 그래프: 확인된 순손익 ÷ 현재 기준예산.',scope:'완료·비용확인 거래만 통계·그래프에 포함. 미실현손익과 현재 보유 포지션은 제외.',drawdown:'최대 낙폭은 거래 정리 시점의 확정 손익 기준입니다.',unassignedFees:data.orphans.filter(f=>ids.has(f.botId)).length}};
}
export class TradeHistory{
 constructor(engine){this.engine=engine;}
 async get(botId,options={}){
  const e=this.engine,client=e.client,scope=e.state.scope;let funding=null;
  if(botId!=null&&![...(e.state.bots||[]).filter(b=>!b.multiBotId),...(e.state.multiBots||[])].some(b=>b.id===botId))throw Error('봇을 찾을 수 없습니다.');
  if(e.connected)try{await e.positionInsights.get();funding=e.positionInsights.fundingSnapshot?.();}catch{}
  if(client!==e.client||scope!==e.state.scope)throw Error('계좌가 변경되었습니다. 기록을 다시 조회하세요.');
  return buildTradeHistory({state:e.state,botId,now:e.now(),account:e.liveAccount?.()||e.accountSnapshot,...options,funding});
 }
}

export function buildOpenPositionCosts({state,now=Date.now(),funding=null}){
 const scope=state.scope,extra=funding?.scope===scope?funding:null,coverage=mergeCoverage([...(state.fundingCoverage||[]).filter(r=>r.scope===scope),...(extra?.complete?[{start:extra.startTime,end:extra.endTime}]:[])]),rows=new Map([...(state.fundingLedger||[]).filter(r=>r.scope===scope),...(extra?.rows||[])].map(r=>[r.id,r])),asOf=Math.min(now,Math.max(0,...coverage.map(r=>r.end))),data=ledger(state,now),cycles=reconstruct(data,now),result={};
 applyCosts(cycles,data,{rows:[...rows.values()],coverage,asOf},now,(state.sharedEvents||[]).filter(e=>e.scope===scope));
 const orderQuantities=new Map();for(const event of data.events)if(event.type==='entry'&&event.orderId)orderQuantities.set(event.orderId,(orderQuantities.get(event.orderId)||0)+event.quantity);
 for(const c of cycles.filter(c=>c.closedAt==null&&c.remaining>eps)){
  const reasons=c.costReasons.filter(r=>!['수수료 조회 대기','USDT 외 수수료 미환산','일부 체결 수수료만 확인됨'].includes(r));
  if(asOf<c.openedAt||now-asOf>90000)reasons.push('최근 펀딩 내역 조회 대기');
  const entryOrders=new Set(c.events.filter(e=>e.type==='entry').map(e=>e.orderId).filter(Boolean)),feesByOrder=new Map();
  for(const id of entryOrders){const order=data.byId.get(id),fees=data.fees.get(id)||[];
   if(!order?.feesFetched||!fees.length)reasons.push('진입 수수료 조회 대기');
   const measured=fees.filter(f=>valid(f.tradeQuantity));if(measured.length&&Math.abs(measured.reduce((s,f)=>s+num(f.tradeQuantity),0)-num(order?.appliedQty))>Math.max(eps,num(order?.appliedQty)*1e-7)||!measured.length&&fees.length>=1000)reasons.push('일부 진입 수수료만 확인됨');
   if(fees.some(f=>f.feeAsset!=='USDT'))reasons.push('USDT 외 진입 수수료 미환산');
   feesByOrder.set(id,fees.filter(f=>f.feeAsset==='USDT').reduce((sum,f)=>sum+num(f.fee),0));
  }
  let quantity=0,entryFee=0,heldFunding=0;
  const timeline=[...c.events,...(c.fundingEvents||[]).map(f=>({...f,type:'funding'}))].sort((a,b)=>a.at-b.at);
  for(const event of timeline){
   if(event.type==='funding'){heldFunding+=event.amount;continue;}
   if(event.type==='entry'||event.type==='import'){quantity+=event.quantity;if(event.type==='entry'&&event.orderId)entryFee+=(feesByOrder.get(event.orderId)||0)*event.quantity/(orderQuantities.get(event.orderId)||event.quantity);}
   else {const remaining=Math.max(0,quantity-event.quantity),weight=quantity>0?remaining/quantity:0;entryFee*=weight;heldFunding*=weight;quantity=remaining;}
  }
  const bot=(state.bots||[]).find(b=>b.id===c.botId);
  if(!bot||bot.runtime?.syncHold||Math.abs(num(bot.runtime?.quantity)-c.remaining)>Math.max(eps,c.remaining*1e-7))reasons.push('보유 수량 동기화 확인 필요');
  result[c.botId]={symbol:c.symbol,direction:c.direction,quantity:c.remaining,entryPrice:c.averagePrice,positionEpoch:bot?.runtime?.positionEpoch??null,openedAt:c.openedAt,entryFee,funding:heldFunding,fundingAsOf:asOf,complete:reasons.length===0,reasons:[...new Set(reasons)]};
 }
 return result;
}
