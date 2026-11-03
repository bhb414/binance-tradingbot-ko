import {isTemporary} from './binance-rate.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {quantize,symbolFilters,protectiveOrders} from './orders.mjs';
import {effectiveBudget} from '../public/budget.js';

const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const active=order=>!terminal.has(order.status);
const amount=value=>{const text=String(value??'');if(!/^\d+(?:\.\d+)?$/.test(text)||text.length>40||!Number.isFinite(Number(text))||!(Number(text)>0))throw new Error('수량·금액·가격은 0보다 큰 숫자로 입력해 주세요.');return Number(text);};
const manual=order=>['manual','bot-manual'].includes(order.source);
export function manualPlan(input,context){
  if(input.market!=='usdm'||input.symbol!==context.symbol)throw new Error('수동 주문은 선택한 USDT 선물 종목에서 가능합니다.');
  if(!['OPEN','CLOSE'].includes(input.action)||!['LONG','SHORT'].includes(input.direction)||!['LIMIT','MARKET'].includes(input.type)||!['quantity','notional','margin'].includes(input.sizeMode)||!['ISOLATED','CROSSED'].includes(input.margin)||!Number.isInteger(input.leverage)||input.leverage<1||input.leverage>1000)throw new Error('주문 방향·방식·증거금·레버리지 설정을 확인해 주세요.');
  if(!['GTC','IOC','FOK','GTX'].includes(input.timeInForce))throw new Error('지정가 주문 유효기간을 확인해 주세요.');
  if(context.blockedReason)throw new Error(context.blockedReason);
  const close=input.action==='CLOSE',long=input.direction==='LONG',side=(close?!long:long)?'BUY':'SELL';
  if(close&&input.sizeMode==='margin')throw new Error('정리 주문은 수량 또는 주문 금액으로 입력해 주세요.');
  const filters=symbolFilters(context.info,input.type),bid=Number(context.bid),ask=Number(context.ask);
  if(!(bid>0&&ask>=bid))throw new Error('계좌 환경의 유효한 호가를 확인하지 못했습니다.');
  const rawPrice=input.type==='LIMIT'?amount(input.price):(side==='BUY'?ask:bid),price=input.type==='LIMIT'?quantize(String(input.price),filters.tick,side==='BUY'?'floor':'ceil'):null,estimate=price?Number(price):rawPrice;
  const priceFilter=context.info.filters.find(item=>item.filterType==='PRICE_FILTER');
  if(!(estimate>0)||Number(priceFilter.minPrice)>0&&estimate<Number(priceFilter.minPrice)||Number(priceFilter.maxPrice)>0&&estimate>Number(priceFilter.maxPrice))throw new Error('주문 가격이 거래소 허용 범위를 벗어납니다.');
  const requested=amount(input.amount),quantity=quantize(input.sizeMode==='quantity'?String(input.amount):((input.sizeMode==='margin'?requested*input.leverage:requested)/estimate).toFixed(16),filters.step),qty=Number(quantity),notional=qty*estimate;
  if(qty<filters.minQty||qty>filters.maxQty||!(qty>0)||!close&&notional<filters.minNotional)throw new Error('주문 수량·금액이 거래소 최소/최대 주문 범위를 벗어납니다.');
  const positions=context.positions,position=context.hedge?positions.find(p=>p.positionSide===input.direction):positions[0],positionQty=position?Math.abs(position.quantity):0;
  const pendingClose=context.orders.filter(order=>order.side===side&&(!context.hedge||order.positionSide===input.direction)).reduce((sum,order)=>sum+Math.max(0,order.quantity-order.executedQuantity),0);
  if(close&&(!position||Math.max(0,positionQty-pendingClose)+1e-10<qty||!context.hedge&&(position.quantity>0)!==long))throw new Error('미체결 정리 주문을 제외한 보유 수량보다 많이 주문할 수 없습니다.');
  if(!close&&!context.hedge&&positionQty&&(position.quantity>0)!==long)throw new Error('반대 방향 포지션을 먼저 정리한 뒤 진입해 주세요.');
  const changes={margin:input.margin!==context.margin,leverage:input.leverage!==context.leverage};
  if((changes.margin||changes.leverage)&&context.settingsLocked)throw new Error('보유 포지션·미체결 주문이 있어 현재 증거금 모드와 레버리지를 사용해야 합니다.');
  if(close&&(changes.margin||changes.leverage))throw new Error('정리 주문은 현재 계좌의 증거금 모드와 레버리지를 사용해 주세요.');
  const projected=positions.reduce((sum,p)=>sum+Math.abs(p.quantity)*estimate,0)+(close?0:notional)+context.orders.reduce((sum,o)=>sum+Math.max(0,o.quantity-o.executedQuantity)*(Number(o.price)||estimate),0);
  const bracket=context.brackets.find(b=>projected>=Number(b.notionalFloor||0)*context.notionalCoef&&projected<=Number(b.notionalCap??Infinity)*context.notionalCoef);
  if(!close&&(!bracket||input.leverage>Number(bracket.initialLeverage)))throw new Error('보유·미체결 주문을 합한 금액에서 허용하는 레버리지 한도를 초과합니다.');
  const estimatedMargin=close?0:notional/input.leverage;
  if(!close&&estimatedMargin*1.01>context.availableBalance)throw new Error('수수료 여유분을 포함한 주문 증거금이 가용 잔고를 초과합니다.');
  const parameters={symbol:input.symbol,side,type:input.type,quantity,positionSide:context.hedge?input.direction:'BOTH',...(close&&!context.hedge?{reduceOnly:'true'}:{}),...(price?{price,timeInForce:input.timeInForce}:{})};
  return {symbol:input.symbol,baseAsset:context.info.baseAsset,environment:context.environment,action:input.action,direction:input.direction,type:input.type,timeInForce:price?input.timeInForce:null,quantity,price,referencePrice:estimate,notional,estimatedMargin,margin:input.margin,leverage:input.leverage,positionMode:context.hedge?'HEDGE':'ONE_WAY',changes,parameters};
}

export class ManualTrading {
  constructor(engine){this.engine=engine;this.plans=new Map();}
  get records(){return this.engine.state.orders.filter(order=>manual(order)&&order.scope===this.engine.state.scope);}
  recoverInterrupted(){for(const order of this.engine.state.orders.filter(manual)){if(active(order)&&order.stage==='CONFIGURING'){order.status='REJECTED';order.error='설정 처리 중 서버가 종료되었습니다. 주문은 전송하지 않았습니다. 현재 거래소 설정을 다시 확인해 주세요.';}}}
  blocked(symbol,botId=null){const e=this.engine,bot=e.state.bots.find(b=>b.id!==botId&&b.symbol===symbol&&(b.runtime.runEnabled||b.runtime.quantity>0||e.ownOrders(b).some(active)));if(bot)return bot.name+' 봇이 이 종목을 관리 중입니다. 정지는 신규 진입만 중지합니다. 주문 귀속에서 이 봇을 선택해 추가 진입·정리하거나, 보유 포지션·주문을 모두 정리한 뒤 별도 주문을 사용하세요.';if(this.records.some(o=>o.parameters.symbol===symbol&&o.status==='UNKNOWN'))return '접수 여부가 확인되지 않은 수동 주문이 있어 상태 확인이 먼저 필요합니다.';return null;}
  async context(symbol,botId=null){
    const e=this.engine;if(typeof symbol!=='string'||!/^[A-Z0-9_]{2,40}$/.test(symbol))throw new Error('주문 종목을 확인해 주세요.');
    const info=(await e.client.exchangeInfo()).symbols.find(s=>s.symbol===symbol&&s.status==='TRADING'&&s.quoteAsset==='USDT'&&s.marginAsset==='USDT');if(!info)throw new Error('현재 계좌 환경에서 주문할 수 있는 USDT 선물 종목이 아닙니다.');
    const book=await e.client.book(symbol),common={symbol,info,environment:e.state.environment,bid:Number(book.bids[0]?.[0]),ask:Number(book.asks[0]?.[0]),connected:e.connected,tradingEnabled:e.tradingEnabled,baseAsset:info.baseAsset,filters:{LIMIT:symbolFilters(info),MARKET:symbolFilters(info,'MARKET')}};
    if(!e.connected)return {...common,availableBalance:null,positions:[],orders:[],margin:null,leverage:null,maxLeverage:null,settingsLocked:true,blockedReason:'설정에서 계좌를 연결해 주세요.'};
    const [configRows,bracketRows,mode]=await Promise.all([e.client.symbolConfig(symbol),e.client.leverageBrackets(symbol),e.client.positionMode(),e.refreshAccount(true)]),config=Array.isArray(configRows)?configRows.find(c=>c.symbol===symbol)||configRows[0]:configRows,bracket=Array.isArray(bracketRows)?bracketRows.find(b=>b.symbol===symbol)||bracketRows[0]:bracketRows;
    const hedge=Boolean(mode.dualSidePosition);if(hedge!==e.hedge&&e.hasExposure())throw new Error('계좌 포지션 모드가 변경되었습니다. 포지션·주문을 확인한 뒤 같은 계좌로 다시 연결해 주세요.');e.hedge=hedge;
    const positions=e.accountSnapshot.positions.filter(p=>p.symbol===symbol),orders=e.accountSnapshot.orders.filter(o=>o.symbol===symbol),brackets=bracket?.brackets||[],leverage=Number(config?.leverage),margin=String(config?.marginType||'').toUpperCase();
    if(!leverage||!['CROSSED','ISOLATED'].includes(margin)||!brackets.length)throw new Error('계좌의 종목 설정과 레버리지 한도를 확인하지 못했습니다.');
    const bot=botId?e.bot(botId):null;if(bot&&bot.symbol!==symbol)throw new Error('주문 종목과 같은 종목의 봇을 선택해 주세요.');
    let botError=null;
    if(bot){
      for(const order of e.ownOrders(bot).filter(active))await e.refreshOrder(bot,order);
      await e.refreshAccount(true);await e.syncBotPosition(bot,true);
      const known=new Set(e.ownOrders(bot).map(o=>o.id));
      if(bot.runtime.importPending)botError='가져온 포지션은 봇을 한 번 시작해 관리를 시작한 뒤 주문해 주세요.';
      else if(bot.runtime.syncHold)botError=bot.runtime.error||'봇과 계좌의 포지션 수량을 확인해 주세요.';
      else if(e.ownOrders(bot).some(o=>active(o)&&o.kind==='standard'))botError='이 봇의 미체결 일반 주문을 먼저 취소하거나 체결을 기다려 주세요.';
      else if(orders.some(o=>!known.has(o.clientOrderId)))botError='이 종목에 봇 소유가 아닌 미체결 주문이 있습니다.';
      const algo=await e.client.openAlgoOrders(symbol),rows=Array.isArray(algo)?algo:algo.orders||[];
      if(rows.some(o=>!known.has(o.clientAlgoId)))botError='이 종목에 봇 소유가 아닌 보호 주문이 있습니다.';
    }
    return {...common,hedge,availableBalance:e.accountSnapshot.availableBalance,positions:e.accountSnapshot.positions.filter(p=>p.symbol===symbol),orders,margin,leverage,brackets,notionalCoef:Number(bracket.notionalCoef)||1,maxLeverage:Math.max(...brackets.map(b=>Number(b.initialLeverage))),settingsLocked:positions.length>0||orders.length>0||this.records.some(o=>active(o)&&o.parameters.symbol===symbol),botId:bot?.id||null,botName:bot?.name||null,botBudget:bot?Math.max(0,effectiveBudget(bot)-e.decorate(bot).used-e.decorate(bot).reserved):null,blockedReason:!e.accountSnapshot.canTrade?'현재 API 키의 주문 권한을 확인해 주세요.':botError||this.blocked(symbol,botId)};
  }
  validateBotPlan(plan,context){
    if(!context.botId)return plan;const e=this.engine,b=e.bot(context.botId),r=b.runtime;
    if(plan.margin!==b.margin||r.quantity>0&&plan.leverage!==b.leverage)throw new Error('봇의 증거금 모드와 보유 포지션 레버리지를 사용해 주세요.');
    if(r.quantity>0&&r.direction!==plan.direction)throw new Error('현재 봇의 반대 방향 포지션을 먼저 정리해 주세요.');
    if(plan.action==='OPEN'){
      if(b.maxEntries&&r.entries>=b.maxEntries)throw new Error('봇의 포지션당 진입 횟수 한도에 도달했습니다.');
      if(plan.estimatedMargin*1.01>context.botBudget)throw new Error('수수료 여유분을 포함한 증거금이 봇의 남은 운용예산을 초과합니다.');
      const quantity=r.quantity+Number(plan.quantity),price=(r.quantity*r.entryPrice+Number(plan.quantity)*plan.referencePrice)/quantity;
      protectiveOrders({...b,direction:plan.direction},context.info,quantity,price,context.hedge);
    }else if(Number(plan.quantity)>r.quantity+1e-10)throw new Error('봇의 보유 수량보다 많이 정리할 수 없습니다.');
    return {...plan,botId:b.id,botName:b.name,botPosition:[r.quantity,r.entryPrice,r.direction,r.positionEpoch]};
  }
  async preview(input){
    this.engine.requireTrading();if(input?.market!=='usdm')throw new Error('수동 주문은 USDT 선물에서 지원합니다.');
    const context=await this.context(input.symbol,input.botId||null),plan=this.validateBotPlan(manualPlan(input,context),context),now=this.engine.now();
    for(const [id,item] of this.plans)if(item.expiresAt<now)this.plans.delete(id);if(this.plans.size>=50)throw new Error('열린 주문 확인이 많습니다. 잠시 후 다시 확인해 주세요.');
    const id=randomUUID(),entry={...plan,id,expiresAt:now+60000,scope:this.engine.state.scope,input:{...input}};this.plans.set(id,entry);return this.viewPlan(entry);
  }
  viewPlan(plan){const {scope,input,parameters,...view}=plan;return view;}
  view(order){return {id:order.id,requestId:order.requestId,botId:order.botId||null,botName:order.botId?this.engine.state.bots.find(b=>b.id===order.botId)?.name:null,environment:order.environment,symbol:order.parameters.symbol,action:order.action,direction:order.direction,side:order.parameters.side,type:order.parameters.type,quantity:order.parameters.quantity,price:order.parameters.price||null,status:order.status,stage:order.stage,error:order.error||null,executedQuantity:order.appliedQty||0,averagePrice:order.averagePrice||null,createdAt:order.createdAt,canCancel:['NEW','PARTIALLY_FILLED'].includes(order.status)&&order.stage==='ORDER_SENT'};}
  snapshot(){return this.records.slice(-30).reverse().map(order=>this.view(order));}
  async submit(id){
    if(typeof id!=='string'||!/^[\da-f-]{36}$/.test(id))throw new Error('주문 확인 번호를 확인해 주세요.');
    const e=this.engine,existing=this.records.find(order=>order.requestId===id);if(existing)return this.view(existing);
    e.requireTrading();const plan=this.plans.get(id);if(!plan||plan.expiresAt<e.now()||plan.scope!==e.state.scope||plan.environment!==e.state.environment)throw new Error('주문 확인이 만료되었거나 계좌가 바뀌었습니다. 다시 확인해 주세요.');
    const context=await this.context(plan.symbol,plan.botId||null);if((context.hedge?'HEDGE':'ONE_WAY')!==plan.positionMode)throw new Error('포지션 모드가 바뀌었습니다. 주문 내용을 다시 확인해 주세요.');
    const fresh=this.validateBotPlan(manualPlan({...plan.input,sizeMode:'quantity',amount:plan.quantity,price:plan.price},context),context);
    if(plan.botId&&JSON.stringify(plan.botPosition)!==JSON.stringify(fresh.botPosition))throw new Error('확인 중 봇의 보유 포지션이 바뀌었습니다. 주문을 다시 확인해 주세요.');
    if(JSON.stringify(fresh.parameters)!==JSON.stringify(plan.parameters))throw new Error('거래소 주문 규격이 달라졌습니다. 주문을 다시 확인해 주세요.');
    if(this.records.filter(active).length>=20)throw new Error('이 앱의 수동 미해결 주문은 20개까지 지원합니다.');
    const sequence=e.state.nextIntent++,clientId='fw_m_'+createHash('sha256').update(e.state.scope).digest('hex').slice(0,8)+'_'+sequence;
    const order={id:clientId,requestId:id,source:plan.botId?'bot-manual':'manual',botId:plan.botId||null,scope:e.state.scope,environment:e.state.environment,kind:'standard',role:plan.botId?(plan.action==='OPEN'?'entry':'exit'):'manual',action:plan.action,direction:plan.direction,parameters:plan.parameters,margin:fresh.estimatedMargin,stage:'CONFIGURING',status:'UNKNOWN',createdAt:e.now(),appliedQty:0,appliedQuote:0,feesFetched:!plan.botId,fallbackDone:true};
    e.state.orders.push(order);await e.checkpoint();
    try{
      if(plan.botId&&plan.action==='CLOSE'){
        const b=e.bot(plan.botId);for(const guard of e.ownOrders(b).filter(o=>o!==order&&active(o)&&o.kind==='algo'))await e.cancelGuard(b,guard);
        if(e.ownOrders(b).some(o=>o!==order&&active(o)))throw new Error('기존 보호 주문의 취소·체결 확인이 필요합니다. 주문은 보내지 않았습니다.');
        await e.refreshAccount(true);await e.syncBotPosition(b,true);if(b.runtime.syncHold)throw new Error(b.runtime.error);
        if(JSON.stringify([b.runtime.quantity,b.runtime.entryPrice,b.runtime.direction,b.runtime.positionEpoch])!==JSON.stringify(plan.botPosition))throw new Error('보호 주문 처리 중 보유 포지션이 바뀌었습니다. 다시 주문을 확인해 주세요.');
      }
      if(fresh.changes.margin){try{await e.client.changeMargin(plan.symbol,plan.margin);}catch(error){if(error.code!==-4046)throw error;}}
      if(fresh.changes.leverage)await e.client.changeLeverage(plan.symbol,plan.leverage);
      if(fresh.changes.margin||fresh.changes.leverage){const rows=await e.client.symbolConfig(plan.symbol),config=Array.isArray(rows)?rows.find(row=>row.symbol===plan.symbol)||rows[0]:rows;if(Number(config?.leverage)!==plan.leverage||String(config?.marginType).toUpperCase()!==plan.margin)throw new Error('거래소의 증거금 모드·레버리지 적용을 확인하지 못했습니다.');await e.refreshAccount(true);if(plan.action==='OPEN'&&fresh.estimatedMargin*1.01>e.accountSnapshot.availableBalance)throw new Error('설정 변경 후 가용 증거금이 부족합니다.');}
    }catch(error){order.status='REJECTED';order.error='주문 미전송 · '+(e.client.redact?.(error.message)||'종목 설정 확인 실패')+' · 계좌의 현재 종목 설정을 다시 확인해 주세요.';if(plan.botId){const b=e.bot(plan.botId);try{if(!b.runtime.syncHold)await e.ensureGuards(b,context.info);}catch(problem){if(isTemporary(problem))e.defer(problem);else{b.runtime.runEnabled=false;b.runtime.error=e.client.redact?.(problem.message)||'보호 주문 확인 필요';}}}await e.checkpoint();return this.view(order);}
    if(plan.botId){const b=e.bot(plan.botId);b.leverage=plan.leverage;b.runtime.error=null;}
    order.stage='ORDER_SENT';await e.checkpoint();
    try{const result=await e.client.placeOrder({...order.parameters,newClientOrderId:order.id,newOrderRespType:'RESULT'});if(plan.botId)await e.applyOrder(e.bot(plan.botId),order,result);else this.apply(order,result);}
    catch(error){order.error=e.client.redact?.(error.message)||'주문 응답 확인 실패';if(!error.uncertain)order.status='REJECTED';}
    e.note(order.status==='UNKNOWN'?'수동 주문 접수 확인 중':'수동 주문',order.parameters.symbol+' · '+order.parameters.side+' '+order.parameters.quantity+' · '+order.status,null,order.status==='REJECTED'?'error':'info');await e.checkpoint();
    try{await e.refreshAccount(true);}catch{e.connectionError='주문 후 계좌 갱신을 확인하지 못했습니다. 주문 접수 상태를 조회합니다.';}
    if(plan.botId){const b=e.bot(plan.botId);try{await this.refresh(order);await e.refreshAccount(true);await e.syncBotPosition(b,true);if(!b.runtime.syncHold&&order.status!=='UNKNOWN')await e.ensureGuards(b,context.info);}catch(error){if(isTemporary(error))e.defer(error);else{b.runtime.runEnabled=false;b.runtime.error=e.client.redact?.(error.message)||'주문 후 포지션·보호 주문 확인 필요';}}await e.checkpoint();}
    return this.view(order);
  }
  apply(order,data){
    const e=this.engine,quantity=Number(data.executedQty||0),quote=Number(data.cumQuote||data.cumQuoteQty||0)||quantity*Number(data.avgPrice||0);
    if(quantity+1e-12<order.appliedQty)throw new Error('수동 주문 누적 체결 수량을 확인해 주세요.');
    if(quantity>order.appliedQty+1e-12){const delta=quantity-order.appliedQty,value=quote-order.appliedQuote;e.state.fills.push({id:order.id+':'+quantity,source:'manual',scope:order.scope,botId:null,at:e.now(),symbol:order.parameters.symbol,side:order.parameters.side,role:'manual',action:order.action+'_'+order.direction,quantity:delta,price:value>0?value/delta:null});}
    order.appliedQty=quantity;order.appliedQuote=quote;order.averagePrice=quantity&&quote?quote/quantity:null;order.status=data.status||order.status;order.orderId=data.orderId||order.orderId;if(order.status!=='UNKNOWN')order.error=null;
  }
  async refresh(order){if(order.stage!=='ORDER_SENT')return;if(order.botId){await this.engine.refreshOrder(this.engine.bot(order.botId),order);return;}try{this.apply(order,await this.engine.client.queryOrder(order.parameters.symbol,order.id));}catch(error){if(![-2013,-2011].includes(error.code))throw error;order.error='거래소에서 아직 접수 여부를 확인하지 못했습니다. 같은 주문을 다시 전송하지 않고 조회합니다.';}}
  async refreshPending(){for(const order of this.records.filter(o=>active(o)&&!o.botId))await this.refresh(order);}
  async requestStatus(id){const order=this.records.find(order=>order.requestId===id);if(!order)return {found:false};if(this.engine.connected){await this.refresh(order);await this.engine.checkpoint();}return {found:true,order:this.view(order)};}
  async cancel(id){
    const e=this.engine;e.requireTrading();const order=this.records.find(order=>order.id===id);if(!order)throw new Error('이 계좌에서 앱으로 만든 수동 주문이 아닙니다.');
    await this.refresh(order);if(!active(order))return this.view(order);if(order.status==='UNKNOWN')throw new Error('주문 접수 여부를 먼저 확인해야 합니다.');
    order.cancelRequestedAt=e.now();await e.checkpoint();
    try{const result=await e.client.cancelOrder(order.parameters.symbol,order.id);if(order.botId)await e.applyOrder(e.bot(order.botId),order,result);else this.apply(order,result);}catch(error){order.error=e.client.redact?.(error.message)||'취소 응답을 확인하지 못했습니다.';if(error.uncertain)order.status='UNKNOWN';else throw error;}
    await e.checkpoint();return this.view(order);
  }
}
