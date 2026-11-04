// Local UI test fixture. Authenticated requests never leave this fake client.
import {createServer} from '../server.mjs';
import {emptyState} from '../backend/store.mjs';
import {makeBot} from '../public/core.js';
import {makeActionRule} from '../public/actions.js';
const symbolInfo=(symbol,baseAsset,type='PERPETUAL')=>({symbol,baseAsset,quoteAsset:'USDT',marginAsset:'USDT',contractType:type,status:'TRADING',filters:[{filterType:'PRICE_FILTER',tickSize:'0.1'},{filterType:'LOT_SIZE',minQty:'0.001',maxQty:'10000',stepSize:'0.001'},{filterType:'MARKET_LOT_SIZE',minQty:'0.001',maxQty:'10000',stepSize:'0.001'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
const infos=[symbolInfo('BTCUSDT','BTC'),symbolInfo('ETHUSDT','ETH'),symbolInfo('INTCUSDT','INTC','TRADIFI_PERPETUAL'),symbolInfo('SKHYUSDT','SKHY','TRADIFI_PERPETUAL')],orders=new Map(),positions=new Map(),configs=new Map(infos.map(info=>[info.symbol,{symbol:info.symbol,marginType:'ISOLATED',leverage:3}]));let nextOrder=1;
class FakeClient{
  constructor(){this.offset=0;}
  clearCredentials(){}redact(value){return String(value);}async syncTime(){return Date.now();}
  async exchangeInfo(){return {symbols:infos};}async tickers(){return infos.map(info=>({symbol:info.symbol,lastPrice:'100',priceChangePercent:'0',quoteVolume:'100000'}));}
  async book(){return {bids:[['100','10']],asks:[['100.1','10']]};}
  async premium(){return {markPrice:'100'};}async klines(symbol,interval){const seconds=Number(interval.slice(0,-1))*({m:60,h:3600,d:86400,w:604800,M:2592000}[interval.at(-1)]),last=Math.floor(Date.now()/1000/seconds)*seconds;return Array.from({length:600},(_,i)=>({time:last-(599-i)*seconds,closeTime:(last-(598-i)*seconds)*1000-1,open:100,high:102,low:99,close:100+Math.sin(i/5),volume:10}));}
  async account(){return {canTrade:true,assets:[{asset:'USDT',walletBalance:'1000',availableBalance:'1000'}]};}
  async positions(){return [...positions].filter(([,quantity])=>quantity).map(([symbol,quantity])=>({symbol,positionSide:'BOTH',positionAmt:String(quantity),entryPrice:'100',markPrice:'100',unRealizedProfit:'0',initialMargin:'10',marginType:configs.get(symbol).marginType,isolatedWallet:configs.get(symbol).marginType==='ISOLATED'?'10':'0',liquidationPrice:'120'}));}
  async positionMode(){return {dualSidePosition:false};}async openOrders(symbol){return [...orders.values()].filter(order=>(!symbol||order.symbol===symbol)&&order.status==='NEW');}async openAlgoOrders(){return [];}
  async income(){return process.argv.includes('--manage')?[{symbol:'BTCUSDT',incomeType:'REALIZED_PNL',asset:'USDT',income:'2.40',time:Date.now()-1800000,tranId:1},{symbol:'BTCUSDT',incomeType:'COMMISSION',asset:'USDT',income:'-0.08',time:Date.now()-1800000,tranId:1},{symbol:'BTCUSDT',incomeType:'FUNDING_FEE',asset:'USDT',income:'-0.03',time:Date.now()-1800000,tranId:1}]:[];}
  async trades(){return [{id:1,time:Date.now(),commission:'0.01',commissionAsset:'USDT'}];}async symbolConfig(symbol){return symbol?[configs.get(symbol)]:[...configs.values()];}async leverageBrackets(symbol){return [{symbol,brackets:[{initialLeverage:symbol==='BTCUSDT'?125:20,notionalFloor:0,notionalCap:100000}]}];}
  async changeMargin(symbol,margin){configs.get(symbol).marginType=margin;return {code:200};}async changeLeverage(symbol,leverage){configs.get(symbol).leverage=leverage;return {leverage};}
  async placeOrder(parameters){const quantity=Number(parameters.quantity),market=parameters.type==='MARKET',order={...parameters,clientOrderId:parameters.newClientOrderId,origQty:parameters.quantity,executedQty:market?parameters.quantity:'0',cumQuote:market?String(quantity*100):'0',avgPrice:market?'100':'0',status:market?'FILLED':'NEW',orderId:nextOrder++};orders.set(parameters.newClientOrderId,order);if(market)positions.set(parameters.symbol,(positions.get(parameters.symbol)||0)+(parameters.side==='BUY'?quantity:-quantity));return order;}
  async queryOrder(symbol,id){const order=typeof id==='object'?[...orders.values()].find(o=>o.symbol===symbol&&(id.orderId?String(o.orderId)===String(id.orderId):o.clientOrderId===id.origClientOrderId)):orders.get(id);if(!order)throw Object.assign(Error('not found'),{code:-2013});return {...order};}async cancelOrder(symbol,id){const order=typeof id==='object'?[...orders.values()].find(o=>o.symbol===symbol&&(id.orderId?String(o.orderId)===String(id.orderId):o.clientOrderId===id.origClientOrderId)):orders.get(id);order.status='CANCELED';return {...order};}
}
if(process.argv.includes('--shared'))FakeClient.prototype.tradesAfter=async()=>[];
if(process.argv.includes('--chart-readout')){const original=FakeClient.prototype.klines;FakeClient.prototype.klines=async function(...args){const rows=await original.apply(this,args);return rows.map((r,i)=>({...r,open:120+Math.round(Math.sin(i/5)*10)/10,high:123,low:118,close:120.4+Math.round(Math.sin(i/5)*10)/10,...(i===rows.length-1?{open:121.2,high:124,low:120,close:123.2}: {})}));};}
const publicClient=new FakeClient(),marketData={async catalog(){return {symbols:infos.map(info=>({...info,market:'usdm',name:info.baseAsset,tickSize:'0.1',price:100,change:0})),errors:[],asOf:Date.now()};},async quote(market,symbol,interval){return {market,instrument:{...infos.find(info=>info.symbol===symbol),market,tickSize:'0.1'},environment:'live',asOf:Date.now(),candles:await publicClient.klines(symbol,interval),book:await publicClient.book(symbol),premium:await publicClient.premium(symbol),ticker:{symbol,lastPrice:process.argv.includes('--chart-readout')?123.4:100,priceChangePercent:0,highPrice:102,lowPrice:99,quoteVolume:100000}};}};
const state=emptyState(),store={state,async load(){return state;},async save(){}},app=await createServer({store,marketData,clientFactory:()=>new FakeClient()});
await app.engine.connect({environment:'testnet',apiKey:'fabricated-ui-preview-key',secret:'fabricated-ui-preview-secret',allowTrading:true});const originalSnapshot=app.engine.snapshot.bind(app.engine);app.engine.snapshot=()=>({...originalSnapshot(),error:'UI 검증용 모의계좌 · 외부 주문 전송 없음'});
if(process.argv.includes('--home-orders')){await app.engine.client.placeOrder({symbol:'ETHUSDT',side:'BUY',type:'LIMIT',quantity:'1',price:'90',newClientOrderId:'external-ui-order'});const b=await app.engine.saveBot(makeBot({id:'ui-pending-bot',name:'미체결 검증 봇',symbol:'BTCUSDT',budget:100,leverage:3,exit:{takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'}}));const preview=await app.engine.serial(()=>app.engine.manual.preview({market:'usdm',symbol:'BTCUSDT',botId:b.id,action:'OPEN',direction:'LONG',type:'LIMIT',sizeMode:'quantity',amount:'1',price:'90',leverage:3,margin:'ISOLATED',timeInForce:'GTC'}));await app.engine.serial(()=>app.engine.manual.submit(preview.id));await app.engine.refreshAccount(true);}
if(process.argv.includes('--chart-positions')){positions.set('BTCUSDT',1);positions.set('ETHUSDT',-2);await app.engine.refreshAccount(true);}
if(process.argv.includes('--import')){
  const exit={takeProfit:3,stopLoss:1.5,price:'MARK_PRICE',takeProfitEnabled:false,stopLossEnabled:false},actionRules=[makeActionRule({action:'EXIT_LONG',formula:'(하이킨종가 < 볼린저하단(하이킨종가, 55, 1.04))@1h[1]',sizePercent:100})];
  await app.engine.saveBot(makeBot({id:'ui-existing-btc',name:'기존 BTC 전략',symbol:'BTCUSDT',budget:100,exit,actionRules}));
  await app.engine.saveBot(makeBot({id:'ui-existing-eth',name:'기존 ETH 전략',symbol:'ETHUSDT',budget:100,exit,actionRules}));
  positions.set('BTCUSDT',1);await app.engine.refreshAccount(true);
}
if(process.argv.includes('--manage')){
 const exit={takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'},actionRules=[makeActionRule({action:'EXIT_LONG',formula:'FALSE',sizePercent:100})];
 await app.engine.saveBot(makeBot({id:'ui-owned-btc',name:'BTC 추세',symbol:'BTCUSDT',budget:100,exit,actionRules}));
 await app.engine.saveBot(makeBot({id:'ui-flat-eth',name:'ETH 전략',symbol:'ETHUSDT',budget:100,exit,actionRules}));
 positions.set('BTCUSDT',1);const bot=app.engine.bot('ui-owned-btc');Object.assign(bot.runtime,{quantity:1,entryPrice:100,direction:'LONG',entries:1,realized:2.32,positionEpoch:1});
 state.positionImports=[{id:'fixture-import',scope:state.scope,botId:bot.id,symbol:bot.symbol,direction:'LONG',quantity:1,entryPrice:100,at:Date.now()-3600000}];
 state.fills.push({id:'fixture-fee',scope:state.scope,botId:bot.id,at:Date.now()-1800000,symbol:bot.symbol,fee:.08,feeAsset:'USDT'});
 await app.engine.refreshAccount(true);
}


if(process.argv.includes('--history')){
 const demoNow=Date.now(),income=[],off={takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'};
 const add=(bot,symbol,at,direction,gains,leverage)=>{
  let realized=0;
  for(const [i,gain]of gains.entries()){
   const open=at+i*12*3600000,entry=symbol==='BTCUSDT'?100+i*2:50+i,quantity=2,close=entry+gain/quantity*(direction==='LONG'?1:-1),exitTime=open+2*3600000;
   for(const [role,time,price]of [['entry',open,entry],['exit',exitTime,close]]){
    const id='fixture-history-'+bot.id+'-'+i+'-'+role,orderId=9000+state.orders.length;
    state.orders.push({id,botId:bot.id,scope:state.scope,kind:'standard',role,direction,leverage,margin:role==='entry'?quantity*price/leverage:0,status:'FILLED',createdAt:time-100,appliedQty:quantity,appliedQuote:quantity*price,feesFetched:true,orderId,parameters:{symbol,side:direction==='LONG'?(role==='entry'?'BUY':'SELL'):(role==='entry'?'SELL':'BUY'),type:'MARKET',positionSide:'BOTH',quantity:String(quantity)}});
    state.fills.push({id:id+':2',scope:state.scope,botId:bot.id,symbol,at:time,tradeTime:time,role,direction,quantity,price,leverage,clientOrderId:id,positionEpoch:i+1});
    state.fills.push({id:'fixture-history-fee-'+orderId,scope:state.scope,botId:bot.id,symbol,at:time,fee:.08,feeAsset:'USDT',clientOrderId:id,orderId,tradeQuantity:quantity,tradePrice:price,leverage,positionEpoch:i+1});
   }
   income.push({symbol,incomeType:'FUNDING_FEE',asset:'USDT',income:String(i%3===0?.03:-.02),time:open+3600000,tranId:90000+income.length});
   if(i>0){const margin=quantity*entry/leverage,profit=Math.max(0,gain)+4,loss=Math.min(0,gain)-2;state.tradeExcursions||=[];state.tradeExcursions.push({scope:state.scope,botId:bot.id,symbol,direction,positionEpoch:i+1,openedAt:open,observedFrom:open+(i===1?3600000:0),closedAt:exitTime,lastObservedAt:exitTime,maxProfit:profit,maxLoss:loss,maxProfitPercent:profit/margin*100,maxLossPercent:loss/margin*100,maxProfitAt:open+4000000,maxLossAt:open+5000000,partial:i===1,marginKnown:i!==1,samples:7200,markSamples:7198,gaps:i===2?1:0});}
   realized+=gain-.16;
  }
  bot.runtime.realized=realized;
 };
 const btc=await app.engine.saveBot(makeBot({id:'ui-history-btc',name:'BTC 기록 예시',symbol:'BTCUSDT',budget:500,exit:off,actionRules:[makeActionRule({formula:'FALSE@1m'})]})),eth=await app.engine.saveBot(makeBot({id:'ui-history-eth',name:'ETH 기록 예시',symbol:'ETHUSDT',budget:300,exit:off,actionRules:[makeActionRule({formula:'FALSE@1m'})]}));
 add(app.engine.bot(btc.id),'BTCUSDT',demoNow-6*86400000,'LONG',[8,-4,11,-7,5,9,-3,12,-5,7],20);
 add(app.engine.bot(eth.id),'ETHUSDT',demoNow-5*86400000,'SHORT',[5,-3,8,-2,6],10);
 app.engine.client.income=async({startTime,endTime})=>income.filter(row=>row.time>=startTime&&row.time<=endTime);
 await app.engine.checkpoint();
}


if(process.argv.includes('--position-costs')){
 const t=Date.now()-3600000,off={takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'};
 for(const [i,symbol,name,pnl,fee]of [[0,'BTCUSDT','BTC 추세',.05,.05],[1,'ETHUSDT','ETH 전략',1.2,.05]]){
  const b=await app.engine.saveBot(makeBot({id:'ui-cost-'+i,name,symbol,budget:100,exit:off,actionRules:[makeActionRule({formula:'FALSE@1m'})]})),bot=app.engine.bot(b.id),id='ui-entry-'+i,orderId=8800+i;
  positions.set(symbol,1);Object.assign(bot.runtime,{quantity:1,entryPrice:100,direction:'LONG',entries:1,realized:-fee,positionEpoch:1,lastEntryAt:t,runEnabled:true});
  state.orders.push({id,botId:bot.id,scope:state.scope,kind:'standard',role:'entry',direction:'LONG',leverage:20,margin:5,status:'FILLED',createdAt:t-100,appliedQty:1,appliedQuote:100,feesFetched:true,orderId,parameters:{symbol,side:'BUY',type:'MARKET',positionSide:'BOTH',quantity:'1'}});
  state.fills.push({id:id+':fill',clientOrderId:id,scope:state.scope,botId:bot.id,symbol,at:t,tradeTime:t,role:'entry',direction:'LONG',quantity:1,price:100,leverage:20});
  state.fills.push({id:id+':fee',clientOrderId:id,orderId,scope:state.scope,botId:bot.id,symbol,at:t,fee,feeAsset:'USDT',tradeQuantity:1,tradePrice:100});
  configs.set(symbol,{symbol,marginType:'CROSSED',leverage:20});
 }
 app.engine.client.positions=async()=>[...positions].map(([symbol,quantity])=>{const pnl=symbol==='BTCUSDT'?.05:1.2;return {symbol,positionSide:'BOTH',positionAmt:String(quantity),entryPrice:'100',markPrice:String(100+pnl),unRealizedProfit:String(pnl),initialMargin:'5',marginType:'cross',isolatedWallet:'0',liquidationPrice:'50'};});
 app.engine.client.commissionRate=async symbol=>({symbol,takerCommissionRate:symbol==='BTCUSDT'?'.0005':'.0004'});
 await app.engine.refreshAccount(true);
}


if(process.argv.includes('--calendar')){
 const off={takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'};
 await app.engine.saveBot(makeBot({id:'ui-calendar',name:'요일·시간 예시',symbol:'BTCUSDT',budget:100,exit:off,actionRules:[makeActionRule({formula:'요일() <= 금요일 AND 시간범위(900, 1800)\nAND (종가 > 0)@15m[1]'})]}));
 const {makeMultiBot,multiRule}=await import('../public/multi-bot.js'),legs=[{alias:'A',symbol:'ETHUSDT',weight:50},{alias:'B',symbol:'INTCUSDT',weight:50}];
 await app.engine.saveBot(makeMultiBot({id:'ui-calendar-multi',name:'다중종목 시간 예시',budget:100,legs,exit:off,actionRules:[multiRule(legs,{formula:'요일(미국동부) <= 금요일 AND 시간범위(930, 1600, 미국동부)\nAND (A.종가 >= B.종가)@15m[1]'})]}));
}


if(process.argv.includes('--position-conditions')){
 const off={takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'},at=Date.now()-3600000;
 const single=await app.engine.saveBot(makeBot({id:'ui-return',name:'현재수익률 예시',symbol:'BTCUSDT',budget:100,margin:'CROSSED',exit:off,actionRules:[makeActionRule({action:'EXIT_LONG',formula:'현재수익률() >= 15 OR 현재수익률() <= -5',sizePercent:100})]}));
 const {makeMultiBot,multiRule,multiTarget}=await import('../public/multi-bot.js'),legs=[{alias:'A',symbol:'ETHUSDT',weight:50},{alias:'B',symbol:'INTCUSDT',weight:50}];
 const parent=await app.engine.saveBot(makeMultiBot({id:'ui-return-multi',name:'합산 수익률 예시',budget:100,margin:'CROSSED',legs,exit:off,actionRules:[multiRule(legs,{formula:'현재수익률() >= 20 AND A.현재수익률 > 0',targets:[multiTarget('A',{action:'EXIT_LONG',sizePercent:100}),multiTarget('B',{action:'EXIT_SHORT',sizePercent:100})]})]}));
 const specs=[{id:single.id,symbol:'BTCUSDT',quantity:2,leverage:20,mark:100.5},{id:parent.id+'_A',symbol:'ETHUSDT',quantity:2,leverage:10,mark:101},{id:parent.id+'_B',symbol:'INTCUSDT',quantity:-1,leverage:20,mark:98}],bySymbol=new Map(specs.map(row=>[row.symbol,row]));
 state.positionImports||=[];
 for(const row of specs){const bot=app.engine.bot(row.id),direction=row.quantity>0?'LONG':'SHORT';positions.set(row.symbol,row.quantity);configs.set(row.symbol,{symbol:row.symbol,marginType:'CROSSED',leverage:row.leverage});bot.leverage=row.leverage;Object.assign(bot.runtime,{quantity:Math.abs(row.quantity),entryPrice:100,direction,entries:1,realized:0,positionEpoch:1,lastEntryAt:at,runEnabled:false});state.positionImports.push({id:'ui-return-import-'+row.id,scope:state.scope,botId:row.id,symbol:row.symbol,direction,quantity:Math.abs(row.quantity),entryPrice:100,leverage:row.leverage,at});}
 app.engine.client.positions=async()=>[...positions].filter(([,q])=>q).map(([symbol,q])=>{const row=bySymbol.get(symbol);return {symbol,positionSide:'BOTH',positionAmt:String(q),entryPrice:'100',markPrice:String(row.mark),unRealizedProfit:String((row.mark-100)*q),positionInitialMargin:String(Math.abs(q)*100/row.leverage),marginType:'cross',isolatedWallet:'0'};});
 app.engine.client.premium=async symbol=>({markPrice:String(bySymbol.get(symbol)?.mark||100)});
 await app.engine.refreshAccount(true);
}


if(process.argv.includes('--entry-capacity')){
 const off={takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'},order={type:'MARKET',price:'ask',ticks:0,timeout:15,remainder:'cancel',postOnly:false},reentry={mode:'cooldown',cooldown:0,afterExitCooldown:0};
 app.engine.client.positions=async()=>[...positions].filter(([,q])=>q).map(([symbol,q])=>({symbol,positionSide:'BOTH',positionAmt:String(q),entryPrice:'100',markPrice:'100',unRealizedProfit:'0',positionInitialMargin:String(Math.abs(q)*100/configs.get(symbol).leverage),marginType:configs.get(symbol).marginType,isolatedWallet:configs.get(symbol).marginType==='ISOLATED'?String(Math.abs(q)*100/configs.get(symbol).leverage):'0'}));
 app.engine.client.commissionRate=async symbol=>({symbol,takerCommissionRate:'.0004'});
 const bot=await app.engine.saveBot(makeBot({id:'ui-entry-wait',name:'잔여 예산 대기 예시',symbol:'BTCUSDT',budget:40,leverage:3,exit:off,actionRules:[makeActionRule({formula:'TRUE@1m',sizePercent:100,leverage:3,order,reentry}),makeActionRule({action:'EXIT_LONG',formula:'FALSE@1m',sizePercent:100,order})]}));
 await app.engine.startBot(bot.id);await app.engine.tick();await app.engine.tick();
 const {makeMultiBot,multiRule}=await import('../public/multi-bot.js'),legs=[{alias:'A',symbol:'ETHUSDT',weight:60},{alias:'B',symbol:'INTCUSDT',weight:40}],p=makeMultiBot({id:'ui-multi-entry-wait',name:'다중종목 진입 대기',budget:10,legs,exit:off,actionRules:[multiRule(legs,{formula:'TRUE@1m',reentry,targets:[{alias:'A',enabled:true,action:'ENTER_LONG',sizePercent:100,leverage:2,order},{alias:'B',enabled:true,action:'ENTER_SHORT',sizePercent:100,leverage:4,order}]})]});
 await app.engine.saveBot(p);await app.engine.startBot(p.id);await app.engine.tick();await app.engine.tick();
}

if(process.argv.includes('--bot-tools')){
 const {makeMultiBot,multiRule}=await import('../public/multi-bot.js'),off={takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'};
 const single=await app.engine.saveBot(makeBot({id:'ui-tools-single',name:'복사·초기화 예시',symbol:'BTCUSDT',budget:100,budgetMode:'pnl',profitReinvestPercent:50,exit:off,actionRules:[makeActionRule({formula:'FALSE@1m'})]}));app.engine.bot(single.id).runtime.realized=-12;
 const legs=[{alias:'A',symbol:'ETHUSDT',weight:40},{alias:'B',symbol:'INTCUSDT',weight:40}];await app.engine.saveBot(makeMultiBot({id:'ui-tools-multi',name:'여러 종목 예시',budget:100,legs,exit:off,actionRules:[multiRule(legs)]}));
}

if(process.argv.includes('--storage-outage')){
 const save=store.save.bind(store);let blocked=true;
 store.save=async()=>{if(blocked)throw Object.assign(Error('UI-only fabricated disk full'),{code:'ENOSPC',syscall:'open',path:'state.json'});return save();};
 await app.engine.checkpoint().catch(()=>{});
 process.stdin.setEncoding('utf8');process.stdin.on('data',input=>{if(input.trim()==='recover'){blocked=false;app.engine.serial(()=>app.engine.storage.recover({force:true})).then(ok=>console.log('Mock storage recovery: '+ok));}});
}
if(process.argv.includes('--shared')){for(const b of state.bots.filter(b=>!b.multiBotId))b.actionRules=[makeActionRule({action:'EXIT_LONG',formula:'FALSE@1m',sizePercent:100,closeScope:'bot'})];for(const p of state.multiBots||[])for(const rule of p.actionRules)for(const target of rule.targets||[]){target.action='EXIT_LONG';target.sizePercent=100;target.closeScope='bot';}}
if(process.argv.includes('--post-only')){
 const {BinanceError}=await import('../backend/binance.mjs');
 const bot=await app.engine.saveBot(makeBot({id:'ui-post-only',name:'메이커 재시도 예시',symbol:'BTCUSDT',budget:40,exit:{takeProfitEnabled:false,stopLossEnabled:false},actionRules:[makeActionRule({formula:'TRUE@1m',order:{type:'LIMIT',price:'bid',ticks:0,timeout:5,remainder:'cancel',postOnly:true}})]}));
 app.engine.client.placeOrder=async()=>{throw new BinanceError('Post Only rejected',{code:-5022,status:400});};await app.engine.startBot(bot.id);await app.engine.tick();
}
if(process.argv.includes('--tools-refresh-failure')){const commit=app.engine.budgetBaselines.commit.bind(app.engine.budgetBaselines),snapshot=app.engine.snapshot.bind(app.engine);let failUntil=0;app.engine.budgetBaselines.commit=async(...args)=>{const result=await commit(...args);failUntil=Date.now()+5000;return result;};app.engine.snapshot=()=>{if(Date.now()<failUntil)throw Error('UI 검증용 갱신 실패');return snapshot();};}
if(process.argv.includes('--tools-expired-preview')){const preview=app.engine.budgetBaselines.preview.bind(app.engine.budgetBaselines);app.engine.budgetBaselines.preview=async(...args)=>{const result=await preview(...args);if(result.previewId)app.engine.budgetBaselines.plans.get(result.previewId).expiresAt=0;return result;};}
if(process.argv.includes('--executions')){
 const base=Math.floor(Date.now()/1000/900)*900*1000;
 for(const [i,symbol]of ['BTCUSDT','ETHUSDT'].entries())for(const [j,ago,side,role,direction]of [[0,8,'BUY','entry','LONG'],[1,6,'SELL','exit','LONG'],[2,4,'SELL','entry','SHORT'],[3,2,'BUY','exit','SHORT']]){
  const at=base-ago*900000+120000,id='ui-chart-'+i+'-'+j,botId=null,price=120+Math.sin(j)*2;
  state.orders.push({id,scope:state.scope,botId,orderId:9800+i*10+j,role,direction,status:'FILLED',appliedQty:1,feesFetched:true,parameters:{symbol,side,type:'MARKET'}});
  state.fills.push({id:id+':1',scope:state.scope,botId,symbol,side,role,direction,quantity:1,price,at:at+1000,tradeTime:at,clientOrderId:id});
  state.fills.push({id:'fee:'+id,scope:state.scope,botId,symbol,fee:.05,tradeId:9900+i*10+j,orderId:9800+i*10+j,tradeQuantity:1,tradePrice:price,at,clientOrderId:id});
 }
}
app.server.listen(8897,'127.0.0.1',()=>console.log('UI mock, no external orders: http://127.0.0.1:8897/#home'));
process.once('SIGINT',()=>{process.stdin.pause();app.server.close();});
