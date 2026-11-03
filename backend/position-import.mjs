import {createHash,randomUUID} from 'node:crypto';
import {makeBot,validateBot,positionMargin,effectiveBudget} from '../public/core.js';
import {makeActionRule} from '../public/actions.js';
const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']),active=order=>!terminal.has(order.status);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sideOf=position=>position.positionSide==='LONG'||position.positionSide==='SHORT'?position.positionSide:position.quantity>0?'LONG':'SHORT';
const keyOf=position=>position.symbol+':'+sideOf(position);
const money=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});

// Import only records ownership. It never sends, cancels or changes an exchange order.
export class PositionImports{
  constructor(engine){this.engine=engine;this.plans=new Map();}
  requireAccount(){if(!this.engine.connected)throw new Error('계좌를 먼저 연결해 주세요.');if(this.engine.writeError)throw new Error(this.engine.writeError);}
  async context(){
    this.requireAccount();const e=this.engine;await e.refreshAccount(true);const symbols=new Set((await e.catalog()).map(item=>item.symbol));
    return {environment:e.state.environment,positions:e.accountSnapshot.positions.filter(position=>Math.abs(position.quantity)>0).map(position=>{
      const owner=e.state.bots.find(bot=>bot.symbol===position.symbol&&bot.runtime.quantity>0&&(!e.hedge||bot.runtime.direction===sideOf(position)));
      return {...position,key:keyOf(position),direction:sideOf(position),quantity:Math.abs(position.quantity),supported:symbols.has(position.symbol),owner:owner?{id:owner.id,name:owner.name,pending:owner.runtime.importPending===true}:null};
    }),bots:e.state.bots.map(bot=>({id:bot.id,name:bot.name,symbol:bot.symbol,budget:bot.budget,eligible:!bot.runtime.runEnabled&&(!bot.runtime.quantity||bot.runtime.importPending===true)&&!e.ownOrders(bot).some(active)}))};
  }
  async inspect(input,newCandidate=null){
    this.requireAccount();const e=this.engine;
    if(typeof input?.positionKey!=='string'||!/^\w{2,40}:(LONG|SHORT)$/.test(input.positionKey))throw new Error('가져올 포지션을 선택해 주세요.');
    const mode=await e.client.positionMode();if(Boolean(mode.dualSidePosition)!==e.hedge)throw new Error('계좌 포지션 모드가 변경되었습니다. 계좌를 다시 연결해 주세요.');
    await e.refreshAccount(true);const position=e.accountSnapshot.positions.find(item=>keyOf(item)===input.positionKey);
    if(!position||!Number.isFinite(position.entryPrice)||position.entryPrice<=0||!Number.isFinite(position.quantity)||!position.quantity)throw new Error('포지션이 없거나 수량·평균 진입가를 확인할 수 없습니다.');
    const info=await e.symbolInfo(position.symbol),direction=sideOf(position),target=input.botId?e.bot(input.botId):null;
    if(target&&(target.symbol!==position.symbol||target.runtime.runEnabled||target.runtime.quantity>0&&!target.runtime.importPending||e.ownOrders(target).some(active)))throw new Error('같은 종목의 관리 시작 전 봇이나 포지션이 없는 정지 봇을 선택하세요.');
    if(target?.runtime.quantity>0&&target.runtime.direction!==direction)throw new Error('기존에 가져온 포지션과 방향이 다릅니다.');
    if(e.state.bots.some(bot=>bot!==target&&bot.symbol===position.symbol&&(bot.runtime.runEnabled||bot.runtime.quantity>0||e.ownOrders(bot).some(active))))throw new Error('이 종목을 이미 담당하는 다른 봇이 있습니다.');
    const [configs,standard,algoResponse]=await Promise.all([e.client.symbolConfig(position.symbol),e.client.openOrders(position.symbol),e.client.openAlgoOrders(position.symbol)]);
    const config=Array.isArray(configs)?configs.find(item=>item.symbol===position.symbol)||configs[0]:configs,margin=String(config?.marginType||'').toUpperCase(),leverage=Number(config?.leverage);
    if(!['ISOLATED','CROSSED'].includes(margin)||!Number.isInteger(leverage)||leverage<1||leverage>1000)throw new Error('현재 계좌의 증거금 모드·레버리지를 확인하지 못했습니다.');
    const algos=Array.isArray(algoResponse)?algoResponse:algoResponse?.orders||[],orders=[...standard,...algos];
    const candidate=target?{...structuredClone(target),margin,leverage}:newCandidate?structuredClone(newCandidate):makeBot({name:String(input.name||info.baseAsset+' 관리'),symbol:position.symbol,budget:input.budget,budgetMode:input.budgetMode||'fixed',margin,leverage,actionRules:[makeActionRule({action:'CLOSE_ALL',formula:'FALSE',sizePercent:100,order:{type:'MARKET',price:'bid',ticks:0,timeout:15,remainder:'cancel',postOnly:false}})]});
    if(!target){candidate.margin=margin;candidate.leverage=leverage;}
    const errors=validateBot(candidate,e.state.bots,{balance:Infinity,symbols:[position.symbol],maxLeverage:125,enforceAllocationLimit:false});if(errors.length)throw new Error(errors.join('\n'));
    const quantity=Math.abs(position.quantity),estimatedMargin=positionMargin(position,leverage,margin),warnings=[];
    if(estimatedMargin>effectiveBudget(candidate))warnings.push(`보유 포지션 증거금 약 ${money(estimatedMargin)} USDT가 운용예산 ${money(effectiveBudget(candidate))} USDT를 초과합니다. 가져오기는 가능하며 새 진입은 남은 예산 안에서만 가능합니다.`);
    if(e.state.bots.filter(bot=>bot.id!==candidate.id).reduce((sum,bot)=>sum+effectiveBudget(bot),0)+effectiveBudget(candidate)>e.accountSnapshot.walletBalance)warnings.push('봇 운용예산 합계가 계좌 잔고보다 큽니다. 새 진입 전 예산을 확인하세요.');
    if(orders.length)warnings.push(`이 종목에 미체결·조건부 주문 ${orders.length}건이 남아 있습니다. 기존 주문은 그대로 유지하며, 봇 시작 전 확인·정리가 필요합니다.`);
    if(target&&(target.margin!==margin||target.leverage!==leverage))warnings.push(`봇의 설정값을 현재 계좌의 ${margin==='ISOLATED'?'격리':'크로스'} · ${leverage}배로 맞춥니다. 거래소 설정은 변경하지 않습니다.`);
    const original=target?{name:target.name,symbol:target.symbol,budget:target.budget,budgetMode:target.budgetMode,margin:target.margin,leverage:target.leverage,actionRules:target.actionRules,exit:target.exit,quantity:target.runtime.quantity,direction:target.runtime.direction,pending:target.runtime.importPending,epoch:target.runtime.positionEpoch}:null;
    const fingerprint=digest({scope:e.state.scope,environment:e.state.environment,hedge:e.hedge,position:{key:input.positionKey,quantity,entryPrice:position.entryPrice},margin,leverage,original,orders:orders.map(order=>[order.clientOrderId||order.clientAlgoId||order.orderId||order.algoId,order.status||order.algoStatus,order.origQty||order.quantity,order.executedQty]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))});
    return {candidate,quantity,entryPrice:position.entryPrice,direction,estimatedMargin,warnings,fingerprint,environment:e.state.environment,scope:e.state.scope,orderCount:orders.length};
  }
  async preview(input){
    for(const [id,plan] of this.plans)if(plan.expiresAt<=this.engine.now())this.plans.delete(id);
    if(this.plans.size>=100)throw new Error('확인 창이 너무 많습니다. 잠시 후 다시 시도하세요.');
    const inspected=await this.inspect(input),id=randomUUID(),plan={...inspected,id,input:structuredClone(input),expiresAt:this.engine.now()+60000};this.plans.set(id,plan);return this.publicPlan(plan);
  }
  publicPlan(plan){const bot=plan.candidate;return {id:plan.id,expiresAt:plan.expiresAt,environment:plan.environment,bot:{id:bot.id,name:bot.name,symbol:bot.symbol,budget:bot.budget,budgetMode:bot.budgetMode||'fixed',effectiveBudget:effectiveBudget(bot),margin:bot.margin,leverage:bot.leverage,exit:bot.exit},direction:plan.direction,quantity:plan.quantity,entryPrice:plan.entryPrice,estimatedMargin:plan.estimatedMargin,warnings:plan.warnings,newBot:!plan.input.botId,orderCount:plan.orderCount};}
  async commit(id){
    this.requireAccount();const e=this.engine,records=e.state.positionImports||[],completed=records.find(record=>record.id===id&&record.scope===e.state.scope);
    if(completed)return {bot:e.decorate(e.bot(completed.botId)),importId:id};
    const plan=this.plans.get(id);if(!plan||plan.expiresAt<=e.now())throw new Error('포지션 확인 내용이 만료되었습니다. 다시 확인해 주세요.');
    const current=await this.inspect(plan.input,plan.input.botId?null:plan.candidate);
    if(current.fingerprint!==plan.fingerprint)throw new Error('포지션·계좌 설정·주문 또는 봇 설정이 변경되었습니다. 다시 확인해 주세요.');
    const before=structuredClone(e.state),existing=e.state.bots.find(bot=>bot.id===plan.candidate.id),bot=current.candidate;
    bot.runtime={...(existing?.runtime||{}),runEnabled:false,importPending:true,quantity:current.quantity,entryPrice:current.entryPrice,direction:current.direction,entries:1,realized:existing?.runtime.realized||0,positionEpoch:(existing?.runtime.positionEpoch||0)+1,ruleSignals:{},lastSignal:null,lastBar:null,lastEntryAt:0,lastExitAt:0,lastEvaluation:null,error:null,guardKey:null,mismatchSince:0,syncHold:false,imported:{id,at:e.now(),scope:e.state.scope}};
    delete bot.used;delete bot.reserved;delete bot.pnl;delete bot.quantity;delete bot.entryPrice;delete bot.positionDirection;
    if(existing)e.state.bots[e.state.bots.indexOf(existing)]=bot;else e.state.bots.push(bot);
    e.state.positionImports||=[];e.state.positionImports.push({id,scope:e.state.scope,botId:bot.id,symbol:bot.symbol,direction:current.direction,quantity:current.quantity,entryPrice:current.entryPrice,at:e.now()});
    e.note('수동 포지션 가져오기',`${bot.name} · ${bot.symbol} · ${current.direction} ${current.quantity} · 관리 시작 대기`,bot.id);
    try{await e.checkpoint();}catch(error){e.store.state=before;throw error;}
    this.plans.delete(id);return {bot:e.decorate(bot),importId:id};
  }
}
