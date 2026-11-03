import {effectiveBudget} from '../public/budget.js';
import {protectionEnabled,hasProtection} from '../public/protection.js';
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
  // Hold 1% of the requested margin for fees and rounding, independently of exchange free margin.
  const capital=effectiveBudget(bot),margin=Math.min(capital*bot.entryPercent/100,capital-bot.used-bot.reserved,freeMargin)*.99;
  if(!(margin>0))throw new Error('진입할 가용 예산이 없습니다.');
  const quantity=quantize((margin*bot.leverage/estimate).toFixed(16),filters.step);
  if(Number(quantity)<filters.minQty||Number(quantity)>filters.maxQty||Number(quantity)*estimate<filters.minNotional)throw new Error('설정한 진입 금액이 거래소의 최소 주문금액·수량 또는 최대 수량 범위를 벗어납니다.');
  const parameters={symbol:bot.symbol,side,type:bot.order.type,quantity,positionSide:hedge?bot.direction:'BOTH'};
  if(bot.order.type==='LIMIT'){parameters.price=limit;parameters.timeInForce=bot.order.postOnly?'GTX':'GTC';}
  return {parameters,margin:Number(quantity)*estimate/bot.leverage};
}
export function protectiveOrders(bot,info,quantity,entryPrice,hedge=false){
  if(!hasProtection(bot.exit))return [];
  const {tick,step}=symbolFilters(info,'MARKET'),long=bot.direction==='LONG',side=long?'SELL':'BUY';
  const qty=quantize(String(quantity),step);if(Number(qty)<=0)throw new Error('보호 주문 수량이 주문 단위보다 작습니다.');
  const plans=[];
  if(protectionEnabled(bot.exit,'stopLoss'))plans.push(['stop','STOP_MARKET',entryPrice*(1+(long?-1:1)*bot.exit.stopLoss/100)]);
  if(protectionEnabled(bot.exit,'takeProfit'))plans.push(['take','TAKE_PROFIT_MARKET',entryPrice*(1+(long?1:-1)*bot.exit.takeProfit/100)]);
  return plans.map(([role,type,value])=>{
    if(!(value>0))throw new Error('청산 목표 가격이 0 이하입니다.');
    const triggerPrice=quantize(value.toFixed(16),tick,long?'floor':'ceil');
    const favorable=(Number(triggerPrice)-entryPrice)*(long?1:-1);
    if(role==='take'?favorable<=0:favorable>=0)throw new Error('익절·손절 간격이 거래소 가격 단위보다 작습니다.');
    return {role,parameters:{algoType:'CONDITIONAL',symbol:bot.symbol,side,type,quantity:qty,positionSide:hedge?bot.direction:'BOTH',...(!hedge?{reduceOnly:'true'}:{}),triggerPrice,workingType:bot.exit.price}};
  });
}
export function exitOrder(bot,info,book,quantity,hedge=false){
  const filters=symbolFilters(info,bot.order.type),long=bot.direction==='LONG',side=long?'SELL':'BUY';
  const qty=quantize(String(quantity),filters.step);
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
