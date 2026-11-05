import {effectiveBudget} from '../public/budget.js';
import {protectionEnabled,hasProtection,protectionBasis,protectionPricePercent} from '../public/protection.js';

export class EntryCapacityError extends Error{
 constructor(reason,details={}){
  const n=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:8});
  const message=reason==='cost-data'?'진입 주문의 마크가격·수수료율 확인을 기다립니다.':reason==='no-margin'?'새 진입에 사용할 증거금이 부족합니다.':reason==='min-quantity'?'예상 주문 수량 '+n(details.quantity)+'가 거래소 최소 수량 '+n(details.minQty)+'보다 작습니다.':'예상 주문금액 '+n(details.notional)+' USDT가 거래소 최소 주문금액 '+n(details.minNotional)+' USDT보다 작습니다.';
  super(message);this.name='EntryCapacityError';this.code='ENTRY_CAPACITY';this.reason=reason;this.details=details;
 }
}
export const isEntryCapacityError=error=>error instanceof EntryCapacityError;
// Only a definitive rejected entry may be retried. Never infer rejection from
// an HTTP 5xx, timeout, reduce-only order, or an unrelated exchange error.
export const isEntryMarginRejection=(error,order)=>order.kind==='standard'&&order.role==='entry'&&![true,'true'].includes(order.parameters.reduceOnly)&&Number(error?.code)===-2019&&!error.uncertain&&!error.temporary&&(!error.status||error.status>=400&&error.status<500&&![418,429].includes(error.status));

// Quantization uses integer decimal arithmetic, including non-power-of-ten steps.
function decimal(value){let text=String(value);if(/e/i.test(text))text=Number(text).toFixed(16);if(!/^\d+(?:\.\d+)?$/.test(text))throw new Error('양의 소수 값이 필요합니다.');const [whole,fraction='']=text.split('.');return {integer:BigInt(whole+fraction),scale:fraction.length};}
export function quantize(value,step,mode='floor'){
  const a=decimal(value),b=decimal(step),scale=Math.max(a.scale,b.scale);const n=a.integer*10n**BigInt(scale-a.scale),s=b.integer*10n**BigInt(scale-b.scale);if(s===0n)throw new Error('거래소 주문 단위를 확인할 수 없습니다.');let units=n/s;if(mode==='ceil'&&n%s!==0n)units++;const result=String(units*s).padStart(scale+1,'0');return scale?(result.slice(0,-scale)+'.'+result.slice(-scale)).replace(/\.?0+$/,'')||'0':result;
}
export function symbolFilters(info,type='LIMIT'){
  const get=name=>info.filters.find(f=>f.filterType===name),lot=get('LOT_SIZE'),market=get('MARKET_LOT_SIZE');
  const quantity=type==='MARKET'&&Number(market?.stepSize)>0?market:lot;
  if(!quantity||!get('PRICE_FILTER'))throw new Error('종목의 주문 규격이 없습니다.');
  return {tick:get('PRICE_FILTER').tickSize,step:quantity.stepSize,minQty:Number(quantity.minQty),maxQty:Number(quantity.maxQty),minNotional:Number(get('MIN_NOTIONAL')?.notional??get('NOTIONAL')?.minNotional??0)};
}
export function entryOrder(bot,info,book,freeMargin,hedge=false){
  const filters=symbolFilters(info,bot.order.type),side=bot.direction==='LONG'?'BUY':'SELL';
  const bid=Number(book.bids[0]?.[0]),ask=Number(book.asks[0]?.[0]);if(!(bid>0&&ask>=bid))throw new Error('유효한 호가가 없습니다.');
  const reference=bot.order.price==='ask'?ask:bot.order.price==='last'?Number(book.lastPrice||((bid+ask)/2)):bid;
  const raw=reference+bot.order.ticks*Number(filters.tick);if(!(raw>0))throw new Error('주문 가격이 0 이하입니다.');
  const limit=quantize(raw.toFixed(16),filters.tick,side==='BUY'?'floor':'ceil');
  const estimate=bot.order.type==='MARKET'?(side==='BUY'?ask:bid):Number(limit);
  // Keep 1% headroom after estimated opening costs for price changes and rounding.
  const capital=effectiveBudget(bot);
  if(![capital,bot.used,bot.reserved,bot.entryPercent,bot.leverage].every(Number.isFinite)||capital<0||bot.used<0||bot.reserved<0||bot.entryPercent<=0||bot.entryPercent>100||!Number.isInteger(bot.leverage)||bot.leverage<1||!(Number.isFinite(freeMargin)||freeMargin===Infinity))throw new Error('진입 예산·비율·배수 계산 값을 확인해 주세요.');
  const margin=Math.min(capital*bot.entryPercent/100,capital-bot.used-bot.reserved,freeMargin)*.99;
  if(!(margin>0))throw new EntryCapacityError('no-margin',{remainingBudget:Math.max(0,capital-bot.used-bot.reserved)});
  let perUnit=estimate/bot.leverage,cost=null;
  if(book.openingCost){
    const mark=Number(book.openingCost.markPrice),feeRate=Number(book.openingCost.feeRate),last=Number(book.lastPrice);
    if(![mark,last,feeRate].every(Number.isFinite)||!(mark>0)||!(last>0)||!Number.isFinite(feeRate)||feeRate<0||feeRate>1)throw new EntryCapacityError('cost-data');
    // https://www.binance.com/en/support/faq/detail/87fa7ee33b574f7084d42bd2ce2e463b
    // Binance's published assuming price includes 0.15% for market orders and
    // short limit orders. Also reserve the adverse mark-to-execution difference
    // at the visible book, rather than assuming it is covered by the margin.
    const assuming=bot.order.type==='MARKET'||side==='SELL'?Math.max(estimate,last*1.0015,side==='SELL'?mark:0):estimate;
    const initial=assuming/bot.leverage,openLoss=side==='BUY'?Math.max(0,assuming-mark):Math.max(0,mark-estimate),fee=Math.max(assuming,estimate)*feeRate;
    perUnit=initial+openLoss+fee;cost={markPrice:mark,lastPrice:last,estimate,assumingPrice:assuming,feeRate,initialPerUnit:initial,openLossPerUnit:openLoss,feePerUnit:fee};
  }
  const quantity=quantize((margin/perUnit).toFixed(16),filters.step);
  if(Number(quantity)>filters.maxQty)throw new Error('설정한 진입 금액이 거래소의 최대 주문 수량을 초과합니다.');
  if(Number(quantity)<filters.minQty||Number(quantity)*estimate<filters.minNotional)throw new EntryCapacityError(Number(quantity)<filters.minQty?'min-quantity':'min-notional',{quantity:Number(quantity),notional:Number(quantity)*estimate,minQty:filters.minQty,minNotional:filters.minNotional,margin,remainingBudget:Math.max(0,capital-bot.used-bot.reserved)});
  const parameters={symbol:bot.symbol,side,type:bot.order.type,quantity,positionSide:hedge?bot.direction:'BOTH'};
  if(bot.order.type==='LIMIT'){parameters.price=limit;parameters.timeInForce=bot.order.postOnly?'GTX':'GTC';}
  return {parameters,margin:Number(quantity)*estimate/bot.leverage,...(cost?{entryCost:{...cost,quantity:Number(quantity),initialMargin:Number(quantity)*cost.initialPerUnit,openLoss:Number(quantity)*cost.openLossPerUnit,fee:Number(quantity)*cost.feePerUnit,required:Number(quantity)*perUnit}}:{})};
}

// Compute trigger ticks as a rational decimal so 100 × 1.005 cannot lose a tick to floating point.
function protectionTrigger(exit,kind,leverage,entryPrice,tick,sign,rounding){
  protectionPricePercent(exit,kind,leverage); // Validate the selected basis and leverage.
  const entry=decimal(entryPrice),amount=decimal(exit[kind]),step=decimal(tick),factor=100n*BigInt(protectionBasis(exit)==='leveraged'?Number(leverage):1)*10n**BigInt(amount.scale);
  const numerator=entry.integer*(factor+BigInt(sign)*amount.integer)*10n**BigInt(step.scale),denominator=10n**BigInt(entry.scale)*factor*step.integer;
  if(numerator<=0n||denominator<=0n)throw new Error('청산 목표 가격이 0 이하입니다.');
  let units=numerator/denominator;if(rounding==='ceil'&&numerator%denominator)units++;
  const text=String(units*step.integer).padStart(step.scale+1,'0');
  return step.scale?(text.slice(0,-step.scale)+'.'+text.slice(-step.scale)).replace(/\.?0+$/,'')||'0':text;
}

export function protectiveOrders(bot,info,quantity,entryPrice,hedge=false){
  if(!hasProtection(bot.exit))return [];
  const {tick,step}=symbolFilters(info,'MARKET'),long=bot.direction==='LONG',side=long?'SELL':'BUY';
  const qty=quantize(String(quantity),step);if(Number(qty)<=0)throw new Error('보호 주문 수량이 주문 단위보다 작습니다.');
  const plans=[];
  if(protectionEnabled(bot.exit,'stopLoss'))plans.push(['stop','STOP_MARKET','stopLoss',long?-1:1]);
  if(protectionEnabled(bot.exit,'takeProfit'))plans.push(['take','TAKE_PROFIT_MARKET','takeProfit',long?1:-1]);
  return plans.map(([role,type,kind,sign])=>{
    const triggerPrice=protectionTrigger(bot.exit,kind,bot.leverage,entryPrice,tick,sign,long?'floor':'ceil');
    const favorable=(Number(triggerPrice)-entryPrice)*(long?1:-1);
    if(role==='take'?favorable<=0:favorable>=0)throw new Error('익절·손절 간격이 거래소 가격 단위보다 작습니다.');
    return {role,parameters:{algoType:'CONDITIONAL',symbol:bot.symbol,side,type,quantity:qty,positionSide:hedge?bot.direction:'BOTH',...(!hedge?{reduceOnly:'true'}:{}),triggerPrice,workingType:bot.exit.price}};
  });
}
export function exitOrder(bot,info,book,quantity,hedge=false){
  const filters=symbolFilters(info,bot.order.type),long=bot.direction==='LONG',side=long?'SELL':'BUY';
  const step=Number(filters.step),scaled=Number(quantity)/step,units=Math.round(scaled),places=(String(filters.step).split('.')[1]||'').length,normalized=Math.abs(scaled-units)<1e-6?(units*step).toFixed(places):String(quantity);
  const qty=quantize(normalized,filters.step);
  if(Number(qty)<filters.minQty||Number(qty)>filters.maxQty)throw new Error('정리 수량이 거래소 수량 범위를 벗어납니다.');
  const parameters={symbol:bot.symbol,side,type:bot.order.type,quantity:qty,positionSide:hedge?bot.direction:'BOTH',...(!hedge?{reduceOnly:'true'}:{})};
  if(bot.order.type==='LIMIT'){
    const bid=Number(book.bids[0]?.[0]),ask=Number(book.asks[0]?.[0]);if(!(bid>0&&ask>=bid))throw new Error('유효한 호가가 없습니다.');
    const reference=bot.order.price==='ask'?ask:bot.order.price==='last'?Number(book.lastPrice):bid;
    const raw=reference+bot.order.ticks*Number(filters.tick);if(!(raw>0))throw new Error('정리 가격이 0 이하입니다.');
    parameters.price=quantize(raw.toFixed(16),filters.tick,side==='BUY'?'floor':'ceil');parameters.timeInForce=bot.order.postOnly?'GTX':'GTC';
  }
  return parameters;
}
