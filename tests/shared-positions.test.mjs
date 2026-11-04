import test from 'node:test';
import assert from 'node:assert/strict';
import {TradingEngine} from '../backend/engine.mjs';
import {BinanceError} from '../backend/binance.mjs';
import {emptyState} from '../backend/store.mjs';
import {makeBot} from '../public/core.js';
import {makeMultiBot,multiRule,multiTarget} from '../public/multi-bot.js';
import {makeActionRule} from '../public/actions.js';
import {buildTradeHistory} from '../backend/trade-history.mjs';
const off={takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'};
const rule=(action='ENTER_LONG',closeScope='bot')=>makeActionRule({action,formula:'TRUE@1m',closeScope,sizePercent:100,leverage:2,order:{type:'MARKET',price:'bid',ticks:0,timeout:10,remainder:'cancel',postOnly:false},reentry:{mode:'rearm',cooldown:0,afterExitCooldown:0}});
async function harness(){
 const x={now:1800000000000,quantity:0,entry:0,price:100,orders:new Map(),trades:[],calls:[],revision:0,next:1,config:{symbol:'BTCUSDT',marginType:'CROSSED',leverage:2}};
 const info={symbol:'BTCUSDT',baseAsset:'BTC',status:'TRADING',quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL',filters:[{filterType:'PRICE_FILTER',tickSize:'0.1'},{filterType:'LOT_SIZE',minQty:'0.001',maxQty:'10000',stepSize:'0.001'},{filterType:'MARKET_LOT_SIZE',minQty:'0.001',maxQty:'10000',stepSize:'0.001'},{filterType:'MIN_NOTIONAL',notional:'5'}]};
 const trade=(side,quantity,{owner=null,reduceOnly=false}={})=>{
  x.now+=1000;const old=x.quantity,delta=quantity*(side==='BUY'?1:-1),closed=old&&Math.sign(old)!==Math.sign(delta)?Math.min(Math.abs(old),quantity):0,realized=(x.price-x.entry)*closed*(old>0?1:-1),orderId=x.next++,clientOrderId=owner||'outside-'+orderId;
  if(!old||Math.sign(old)===Math.sign(delta))x.entry=(Math.abs(old)*x.entry+quantity*x.price)/(Math.abs(old)+quantity);else if(quantity>Math.abs(old))x.entry=x.price;
  x.quantity=old+delta;if(Math.abs(x.quantity)<1e-8){x.quantity=0;x.entry=0;}
  const row={id:x.trades.length+1,orderId,symbol:'BTCUSDT',positionSide:'BOTH',side,qty:String(quantity),price:String(x.price),realizedPnl:String(realized),commission:String(quantity*x.price*.0004),commissionAsset:'USDT',time:x.now};x.trades.push(row);
  const order={orderId,clientOrderId,symbol:'BTCUSDT',side,positionSide:'BOTH',reduceOnly,status:'FILLED',type:'MARKET',origQty:String(quantity),executedQty:String(quantity),cumQuote:String(quantity*x.price),avgPrice:String(x.price),time:x.now,updateTime:x.now};x.orders.set(clientOrderId,order);x.revision++;return {...order};
 };
 const client={offset:0,get accountRevision(){return x.revision;},clearCredentials(){},redact:s=>s,async syncTime(){return x.now;},async exchangeInfo(){return {symbols:[info]};},async account(){return {canTrade:true,assets:[{asset:'USDT',walletBalance:'5000',availableBalance:'4000'}]};},async positions(){return x.quantity?[{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:String(x.quantity),entryPrice:String(x.entry),markPrice:String(x.price),positionInitialMargin:String(Math.abs(x.quantity)*x.price/x.config.leverage),unRealizedProfit:String((x.price-x.entry)*x.quantity)}]:[];},async positionMode(){return {dualSidePosition:false};},
 async openOrders(){return [];},async openAlgoOrders(){return [];},async symbolConfig(){return [{...x.config}];},async leverageBrackets(){return [{brackets:[{initialLeverage:125,notionalFloor:0,notionalCap:1000000}]}];},async changeMargin(s,margin){x.config.marginType=margin;return{};},async changeLeverage(s,leverage){x.config.leverage=leverage;return{leverage};},
 async tickers(){return [{symbol:'BTCUSDT',lastPrice:String(x.price)}];},async book(){return {bids:[[String(x.price),'100']],asks:[[String(x.price),'100']]};},async premium(){return {markPrice:String(x.price)};},async klines(){return Array.from({length:600},(_,i)=>({time:(x.now-(600-i)*60000)/1000,closeTime:x.now-(599-i)*60000-1,open:100,high:101,low:99,close:100,volume:1}));},
 async placeOrder(p){x.calls.push({...p});return trade(p.side,Number(p.quantity),{owner:p.newClientOrderId,reduceOnly:p.reduceOnly==='true'});},async queryOrder(s,id){const found=typeof id==='object'?[...x.orders.values()].find(o=>String(o.orderId)===String(id.orderId)):x.orders.get(id);if(!found)throw Error('missing native order');return {...found};},
 async trades(s,orderId){return x.trades.filter(t=>t.symbol===s&&(orderId==null||String(t.orderId)===String(orderId))).map(t=>({...t}));},async tradesAfter(s,id){return x.trades.filter(t=>t.symbol===s&&t.id>=id).map(t=>({...t}));},async income(){return[];},
 };
 const state=emptyState(),store={state,async load(){return this.state;},fail:false,async save(){if(this.fail)throw Object.assign(Error('fake disk full'),{code:'ENOSPC'});}},e=await new TradingEngine(store,{now:()=>x.now,clientFactory:()=>client}).init();await e.connect({environment:'testnet',apiKey:'fabricated-shared-key',secret:'fabricated-shared-secret',allowTrading:true});
 return {e,x,client,trade,store};
}
async function twoBots(){const h=await harness();for(const id of ['a','b'])await h.e.saveBot(makeBot({id,name:id,symbol:'BTCUSDT',budget:100,maxEntries:1,leverage:2,margin:'CROSSED',exit:off,actionRules:[rule()]}));for(const id of ['a','b'])await h.e.startBot(id);await h.e.tick();return {...h,a:h.e.bot('a'),b:h.e.bot('b')};}
test('two bots may enter the same symbol and each uses its own budget and virtual quantity',async()=>{
 const h=await twoBots();assert.equal(h.a.runtime.runEnabled,true);assert.equal(h.b.runtime.runEnabled,true);assert.ok(h.a.runtime.quantity>0);assert.equal(h.a.runtime.quantity,h.b.runtime.quantity);assert.ok(Math.abs(h.x.quantity-h.a.runtime.quantity-h.b.runtime.quantity)<1e-8);
 assert.equal(h.a.runtime.error,null);assert.equal(h.b.runtime.error,null);assert.ok(h.e.decorate(h.a).used<=100);assert.ok(h.e.decorate(h.b).used<=100);assert.equal(h.x.calls.length,2);assert.equal(h.e.shared.book('BTCUSDT').pending,false);
});
test('external additions remain manual and external reductions are proportionally allocated without stopping either bot',async()=>{
 const h=await twoBots(),q=h.a.runtime.quantity;h.trade('BUY',q);await h.e.tick();assert.ok(Math.abs(h.e.shared.book('BTCUSDT').manual.LONG.quantity-q)<1e-8);assert.equal(h.a.runtime.quantity,q);assert.equal(h.b.runtime.quantity,q);
 h.trade('SELL',q*1.5,{reduceOnly:true});await h.e.tick();assert.ok(Math.abs(h.a.runtime.quantity-q/2)<.0011);assert.ok(Math.abs(h.b.runtime.quantity-q/2)<.0011);assert.ok(Math.abs(h.e.shared.book('BTCUSDT').manual.LONG.quantity-q/2)<.0011);assert.equal(h.a.runtime.runEnabled,true);assert.equal(h.b.runtime.runEnabled,true);assert.equal(h.a.runtime.error,null);assert.equal(h.b.runtime.error,null);
 h.trade('SELL',h.x.quantity,{reduceOnly:true});await h.e.tick();assert.equal(h.a.runtime.quantity,0);assert.equal(h.b.runtime.quantity,0);assert.equal(h.a.runtime.error,null);assert.equal(h.x.calls.length,2);
});
test('bot-scoped close leaves other bots and manual quantities intact',async()=>{
 const h=await twoBots(),q=h.a.runtime.quantity;h.trade('BUY',q);await h.e.tick();await h.e.saveBot({...h.a,actionRules:[rule('EXIT_LONG','bot')]});h.a=h.e.bot('a');await h.e.tick();assert.equal(h.a.runtime.quantity,0);assert.equal(h.b.runtime.quantity,q);assert.ok(Math.abs(h.x.quantity-q*2)<1e-8);assert.equal(h.b.runtime.error,null);
});
test('account-scoped close closes every bot and manual share of the symbol',async()=>{
 const h=await twoBots(),q=h.a.runtime.quantity;h.trade('BUY',q);await h.e.tick();await h.e.saveBot({...h.a,actionRules:[rule('EXIT_LONG','account')]});h.a=h.e.bot('a');await h.e.tick();assert.equal(h.a.runtime.quantity,0);assert.equal(h.b.runtime.quantity,0);assert.equal(h.x.quantity,0);assert.equal(h.b.runtime.runEnabled,true);assert.equal(h.b.runtime.error,null);assert.ok(Math.abs(Number(h.x.calls.at(-1).quantity)-q*3)<1e-8);
});
test('a flat bot may close account holdings and native reversal closes bot shares before recording a manual opposite holding',async()=>{
 const h=await twoBots(),q=h.x.quantity;h.trade('SELL',q+1);await h.e.tick();assert.equal(h.a.runtime.quantity,0);assert.equal(h.b.runtime.quantity,0);assert.equal(h.e.shared.book('BTCUSDT').manual.SHORT.quantity,1);assert.equal(h.a.runtime.error,null);assert.equal(h.b.runtime.error,null);
 await h.e.saveBot({...h.a,actionRules:[rule('EXIT_SHORT','account')]});await h.e.tick();assert.equal(h.x.quantity,0);assert.equal(h.e.shared.book('BTCUSDT').manual.SHORT.quantity,0);
});
test('shared history fees sum once across bot allocations and funding weights include the manual share',async()=>{
 const h=await twoBots(),q=h.a.runtime.quantity;h.trade('BUY',q);await h.e.tick();const time=h.x.now;assert.ok(Math.abs(h.e.shared.fundingShare('a','BTCUSDT',time)-1/3)<1e-8);
 h.x.price=110;h.trade('SELL',h.x.quantity,{reduceOnly:true});await h.e.tick();h.e.state.fundingCoverage=[{scope:h.e.state.scope,start:0,end:h.x.now}];const report=buildTradeHistory({state:h.e.state,now:h.x.now});assert.equal(report.summary.closed,2);assert.equal(report.summary.pending,0);const botFees=h.e.state.fills.filter(f=>f.fee!=null).reduce((n,f)=>n+f.fee,0);assert.ok(Math.abs(report.summary.fee-botFees)<1e-8);assert.equal(h.e.state.fills.filter(f=>f.quantity&&f.role==='exit').length,2);
 const before=h.e.state.fills.length;await h.e.tick();assert.equal(h.e.state.fills.length,before);assert.equal(h.a.runtime.error,null);
});

test('manual sharing is available even while another bot holds the symbol',async()=>{
 const h=await twoBots(),q=h.a.runtime.quantity,preview=await h.e.manual.preview({market:'usdm',symbol:'BTCUSDT',action:'OPEN',direction:'LONG',type:'MARKET',sizeMode:'quantity',amount:'0.5',margin:'CROSSED',leverage:2,price:'100',timeInForce:'GTC'});await h.e.manual.submit(preview.id);await h.e.tick();assert.equal(h.a.runtime.quantity,q);assert.equal(h.b.runtime.quantity,q);assert.ok(Math.abs(h.e.shared.book('BTCUSDT').manual.LONG.quantity-.5)<1e-8);
});
test('shared funding is divided by actual ownership and manual ownership does not become bot profit',async()=>{
 const h=await twoBots(),q=h.a.runtime.quantity;h.trade('BUY',q);await h.e.tick();h.x.now+=500;const at=h.x.now,scope=h.e.state.scope;h.trade('SELL',h.x.quantity,{reduceOnly:true});await h.e.tick();h.e.state.fundingCoverage=[{scope,start:0,end:h.x.now}];h.e.state.fundingLedger=[{id:'shared-funding',scope,symbol:'BTCUSDT',at,amount:-3,asset:'USDT'}];const r=buildTradeHistory({state:h.e.state,now:h.x.now});assert.ok(Math.abs(r.summary.funding+2)<1e-8);
 const view=h.e.positionInsights.botFunding([{symbol:'BTCUSDT',incomeType:'FUNDING_FEE',time:at,income:-3,asset:'USDT'}],0,true);assert.ok(Math.abs(view.a.funding+1)<1e-8);assert.ok(Math.abs(view.b.funding+1)<1e-8);
});
test('a delayed native trade feed holds new entries temporarily without stopping bots or repeating accepted orders',async()=>{
 const h=await harness();for(const id of ['a','b'])await h.e.saveBot(makeBot({id,name:id,budget:100,maxEntries:1,leverage:2,margin:'CROSSED',exit:off,actionRules:[rule()]}));for(const id of ['a','b'])await h.e.startBot(id);const load=h.client.tradesAfter;let hidden=true;h.client.tradesAfter=async(...args)=>hidden?[]:load(...args);await h.e.tick();assert.equal(h.x.calls.length,1);assert.equal(h.e.shared.book('BTCUSDT').pending,true);assert.equal(h.e.bot('a').runtime.runEnabled,true);assert.equal(h.e.bot('b').runtime.runEnabled,true);
 hidden=false;h.x.now+=2000;await h.e.tick();assert.equal(h.x.calls.length,2);assert.equal(h.e.shared.book('BTCUSDT').pending,false);assert.equal(h.e.bot('a').runtime.error,null);assert.equal(h.e.bot('b').runtime.error,null);
});
test('temporary native history limits resume shared management with each reduction recorded once',async()=>{
 const h=await twoBots();h.trade('SELL',h.x.quantity,{reduceOnly:true});const load=h.client.tradesAfter;let limited=true;h.client.tradesAfter=async(...args)=>{if(limited)throw new BinanceError('limited',{code:-1003,status:429,retryAt:h.x.now+5000});return load(...args);};await h.e.tick();assert.equal(h.a.runtime.runEnabled,true);assert.equal(h.b.runtime.runEnabled,true);limited=false;h.x.now+=6000;await h.e.tick();assert.equal(h.a.runtime.quantity,0);assert.equal(h.b.runtime.quantity,0);const count=h.e.state.fills.length;await h.e.tick();assert.equal(h.e.state.fills.length,count);
});
test('shared state and pending exchange reconciliation recover after a persistence failure without sending any extra order',async()=>{
 const h=await twoBots();h.trade('SELL',h.x.quantity,{reduceOnly:true});h.store.fail=true;await assert.rejects(()=>h.e.tick(),e=>e.storage);assert.equal(h.e.tradingEnabled,false);h.store.fail=false;h.x.now+=6000;assert.equal(await h.e.storage.recover({force:true}),true);assert.equal(h.e.bot('a').runtime.quantity,0);assert.equal(h.e.bot('b').runtime.quantity,0);assert.equal(h.e.tradingEnabled,true);assert.equal(h.x.calls.length,2);
});
test('shared cursor survives restart without duplicating trades or fees',async()=>{
 const h=await twoBots(),count=h.e.state.fills.length,cursor=h.e.shared.book('BTCUSDT').cursor,restarted=await new TradingEngine(h.store,{now:()=>h.x.now,clientFactory:()=>h.client}).init();await restarted.connect({environment:'testnet',apiKey:'fabricated-shared-key',secret:'fabricated-shared-secret',allowTrading:true});await restarted.startBot('a');await restarted.tick();assert.equal(restarted.state.fills.length,count);assert.equal(restarted.shared.book('BTCUSDT').cursor,cursor);assert.equal(restarted.bot('a').runtime.error,null);assert.equal(h.x.calls.length,2);
});
test('unassigned manual quantity can be transferred into an existing same-symbol bot without taking other bots shares',async()=>{
 const h=await twoBots(),q=h.a.runtime.quantity;h.trade('BUY',q);await h.e.tick();await h.e.pauseBot('a');const context=await h.e.positionImports.context();assert.equal(context.positions[0].quantity,q);const p=await h.e.positionImports.preview({positionKey:'BTCUSDT:LONG',botId:'a'});assert.ok(p.warnings.length>0);await h.e.positionImports.commit(p.id);assert.ok(Math.abs(h.e.bot('a').runtime.quantity-q*2)<1e-8);assert.equal(h.b.runtime.quantity,q);assert.equal(h.e.shared.book('BTCUSDT').manual.LONG.quantity,0);assert.equal(h.x.calls.length,2);await h.e.shared.sync('BTCUSDT',{force:true});assert.equal(h.e.bot('a').runtime.error,null);
});
test('opposite-side bot entries net the same account position and all bots retain their own budget limit',async()=>{
 const h=await harness();for(const [id,action]of [['a','ENTER_LONG'],['b','ENTER_SHORT']])await h.e.saveBot(makeBot({id,name:id,budget:100,maxEntries:1,leverage:2,margin:'CROSSED',exit:off,actionRules:[rule(action)]}));await h.e.startBot('a');await h.e.startBot('b');await h.e.tick();assert.equal(h.e.bot('a').runtime.quantity,0);assert.equal(h.e.bot('b').runtime.quantity,0);assert.equal(h.x.quantity,0);assert.equal(h.e.bot('a').runtime.error,null);assert.equal(h.e.bot('b').runtime.error,null);assert.equal(h.x.calls.length,2);
});

test('account-scoped rearm detects a new account position cycle without repeating on a partial close',async()=>{const h=await twoBots();await h.e.saveBot({...h.a,actionRules:[rule('EXIT_LONG','account')]});await h.e.tick();assert.equal(h.x.quantity,0);const count=h.x.calls.length;h.trade('BUY',1);await h.e.tick();assert.equal(h.x.quantity,0);assert.equal(h.x.calls.length,count+1);assert.equal(h.e.bot('a').runtime.error,null);});

test('single account-scoped current return uses the physical account entry and leverage',async()=>{const h=await twoBots();h.x.price=110;h.x.revision++;await h.e.refreshAccount(true);const b=h.e.bot('a'),p=h.e.rulePosition(b,rule('EXIT_LONG','account'));assert.ok(Math.abs(p.quantity-h.x.quantity)<1e-8);assert.equal(p.entryPrice,h.x.entry);assert.equal(p.leverage,2);});

test('account-scoped limit remainder keeps the same proportional scope on market fallback',async()=>{
 const h=await twoBots(),q=h.a.runtime.quantity;h.trade('BUY',q);await h.e.tick();
 h.client.placeOrder=async p=>{h.x.calls.push({...p});const data=h.trade(p.side,p.type==='LIMIT'?1:Number(p.quantity),{owner:p.newClientOrderId,reduceOnly:p.reduceOnly==='true'});if(p.type==='LIMIT'){Object.assign(data,{status:'PARTIALLY_FILLED',origQty:p.quantity,type:'LIMIT'});Object.assign(h.x.orders.get(data.clientOrderId),data);}return data;};
 h.client.cancelOrder=async(s,id)=>{const data=h.x.orders.get(id);data.status='CANCELED';return {...data};};
 const exit=rule('EXIT_LONG','account');exit.sizePercent=50;exit.order={type:'LIMIT',price:'ask',ticks:0,timeout:1,remainder:'market',postOnly:false};
 await h.e.saveBot({...h.a,actionRules:[exit]});await h.e.tick();h.x.now+=2000;await h.e.tick();
 assert.equal(h.x.calls.at(-1).type,'MARKET');assert.equal(h.e.state.orders.filter(o=>o.kind==='standard'&&o.parent).at(-1).closeScope,'account');
 assert.ok(Math.abs(h.e.bot('a').runtime.quantity-q/2)<.002);assert.ok(Math.abs(h.b.runtime.quantity-q/2)<.002);assert.ok(Math.abs(h.e.shared.book('BTCUSDT').manual.LONG.quantity-q/2)<.002);
});
test('a paused multi-symbol bot may close an account target without owning that position',async()=>{
 const h=await twoBots(),q=h.a.runtime.quantity;h.trade('BUY',q);await h.e.tick();const original=h.client.exchangeInfo;
 h.client.exchangeInfo=async()=>{const data=await original();return {symbols:[...data.symbols,{...data.symbols[0],symbol:'ETHUSDT',baseAsset:'ETH'}]};};
 const legs=[{alias:'A',symbol:'BTCUSDT',weight:50},{alias:'B',symbol:'ETHUSDT',weight:50}],targets=[multiTarget('A',{...rule('EXIT_LONG','account'),alias:'A'}),multiTarget('B',{...rule('EXIT_LONG'),alias:'B',enabled:false})];
 await h.e.saveBot(makeMultiBot({id:'multi-account',name:'shared multi',budget:20,legs,margin:'CROSSED',exit:off,actionRules:[multiRule(legs,{formula:'TRUE@1m',targets})]}));
 assert.deepEqual(h.e.multi.get('multi-account').actionRules[0].targets.map(t=>t.closeScope),['account','bot']);
 await h.e.tick();assert.ok(h.x.quantity>0,'saving a new multi manager must not execute exits');await h.e.startBot('multi-account');await h.e.pauseBot('multi-account');await h.e.tick();assert.equal(h.x.quantity,0);assert.equal(h.a.runtime.quantity,0);assert.equal(h.b.runtime.quantity,0);assert.equal(h.e.multi.get('multi-account').runtime.runEnabled,false);assert.equal(h.e.multi.get('multi-account').runtime.error,null);
});

test('unstarted account-exit bots and copied settings cannot manage account positions before first start',async()=>{
 const h=await harness();await h.e.saveBot(makeBot({id:'source-exit',name:'source',budget:100,margin:'CROSSED',exit:off,actionRules:[rule('EXIT_LONG','account')]}));h.trade('BUY',1);await h.e.refreshAccount(true);await h.e.tick();
 assert.equal(h.x.calls.length,0,'saving a bot must not activate account exits');assert.equal(h.x.quantity,1);
 await h.e.startBot('source-exit');await h.e.pauseBot('source-exit');await h.e.tick();assert.equal(h.x.quantity,0,'an explicitly started manager continues exits after entry pause');
});
test('a shared partial limit fill and its market remainder count as one entry',async()=>{
 const h=await harness();
 h.client.placeOrder=async p=>{h.x.calls.push({...p});const data=h.trade(p.side,p.type==='LIMIT'?1:Number(p.quantity),{owner:p.newClientOrderId,reduceOnly:p.reduceOnly==='true'});if(p.type==='LIMIT'){Object.assign(data,{status:'PARTIALLY_FILLED',origQty:p.quantity,type:'LIMIT'});Object.assign(h.x.orders.get(data.clientOrderId),data);}return data;};
 h.client.cancelOrder=async(s,id)=>{const data=h.x.orders.get(id);data.status='CANCELED';return {...data};};
 const enter=rule();enter.order={type:'LIMIT',price:'bid',ticks:0,timeout:1,remainder:'market',postOnly:false};
 await h.e.saveBot(makeBot({id:'entry-remainder',budget:100,maxEntries:1,margin:'CROSSED',exit:off,actionRules:[enter]}));await h.e.startBot('entry-remainder');await h.e.tick();h.e.shared.book('BTCUSDT').entryOrders=h.e.state.orders.filter(o=>o.kind==='standard'&&o.role==='entry').map(o=>o.botId+':'+o.orderId);h.x.now+=2000;await h.e.tick();
 assert.equal(h.x.calls.length,2);assert.equal(h.e.bot('entry-remainder').runtime.entries,1);
});
test('a direct full close leaves no lot-sized dust after proportional external reductions',async()=>{
 const h=await twoBots();h.trade('SELL',1.32,{reduceOnly:true});await h.e.tick();await h.e.closeBot('a');
 assert.equal(h.e.bot('a').runtime.quantity,0);assert.ok(Math.abs(h.e.bot('b').runtime.quantity-1.32)<1e-9);
});
test('shared bootstrap derives the unassigned manual entry separately from existing bot entries',async()=>{
 const h=await twoBots(),q=h.a.runtime.quantity;h.x.price=120;h.trade('BUY',q);delete h.e.state.sharedPositions[h.e.shared.key('BTCUSDT')];await h.e.shared.ensure('BTCUSDT');
 const manual=h.e.shared.book('BTCUSDT').manual.LONG;assert.ok(Math.abs(manual.quantity-q)<1e-9);assert.ok(Math.abs(manual.entryPrice-120)<1e-9);
});

test('additive manual imports retain funding ownership after a partial reduction',async()=>{
 const h=await twoBots(),q=h.a.runtime.quantity;h.trade('BUY',q);await h.e.tick();await h.e.pauseBot('a');const plan=await h.e.positionImports.preview({positionKey:'BTCUSDT:LONG',botId:'a'});await h.e.positionImports.commit(plan.id);
 h.trade('SELL',4,{reduceOnly:true});await h.e.tick();h.x.now+=500;const at=h.x.now,share=h.e.shared.fundingShare('a','BTCUSDT',at),view=h.e.positionInsights.botFunding([{symbol:'BTCUSDT',incomeType:'FUNDING_FEE',time:at,income:-3,asset:'USDT'}],0,true);
 assert.ok(h.e.bot('a').runtime.quantity>0);assert.ok(Math.abs(view.a.funding+3*share)<1e-9);
});
test('copied account-wide exits remain inactive until the copy itself is started',async()=>{
 const h=await harness();await h.e.saveBot(makeBot({id:'source-copy',budget:100,margin:'CROSSED',exit:off,actionRules:[rule('EXIT_LONG','account')]}));await h.e.startBot('source-copy');await h.e.pauseBot('source-copy');
 const source=h.e.bot('source-copy');await h.e.saveBot({...source,actionRules:source.actionRules.map(r=>({...r,formula:'FALSE@1m'}))});
 const {copyBotSettings}=await import('../public/bot-tools.js'),copy=copyBotSettings(h.e.bot('source-copy'));copy.actionRules[0].formula='TRUE@1m';await h.e.saveBot(copy);h.trade('BUY',1);await h.e.refreshAccount(true);await h.e.tick();
 assert.equal(h.x.calls.length,0);assert.equal(h.e.bot(copy.id).runtime.managementEnabled,false);assert.equal(h.x.quantity,1);
});

test('legacy started managers recover management state while newly copied managers remain unarmed',async()=>{
 const h=await harness();for(const id of ['legacy-manager','never-started'])await h.e.saveBot(makeBot({id,name:id,budget:100,margin:'CROSSED',exit:off,actionRules:[rule('EXIT_LONG','account')]}));
 for(const bot of h.e.state.bots)delete bot.runtime.managementEnabled;h.e.bot('legacy-manager').runtime.lastEvaluation={at:h.x.now,rules:[]};
 const e=await new TradingEngine(h.store,{now:()=>h.x.now,clientFactory:()=>h.client}).init();await e.connect({environment:'testnet',apiKey:'fabricated-shared-key',secret:'fabricated-shared-secret',allowTrading:true});
 assert.equal(e.bot('legacy-manager').runtime.managementEnabled,true);assert.equal(e.bot('never-started').runtime.managementEnabled,false);
 h.trade('BUY',1);await e.refreshAccount(true);await e.tick();assert.equal(h.x.quantity,0);assert.equal(h.x.calls.length,1);
});

test('saved profiles do not reserve wallet capital and legacy bots remain included',async()=>{
 const h=await harness(),b=await h.e.saveBot(makeBot({id:'live-budget',budget:100,leverage:2,margin:'CROSSED',exit:off,actionRules:[rule()]}));
 const profile=await h.e.saveBot(makeBot({id:'saved-profile',budget:9000,budgetIncluded:false,leverage:2,margin:'CROSSED',exit:off,actionRules:[rule()]}));
 assert.equal(h.e.allocatedBudget(),100);assert.equal(b.budgetIncluded,undefined);assert.equal(profile.budgetIncluded,false);
 await assert.rejects(()=>h.e.startBot(profile.id),/보관/);await h.e.tick();assert.equal(h.x.calls.length,0);
 const oldClient={...profile,budget:15000};delete oldClient.budgetIncluded;await h.e.saveBot(oldClient);assert.equal(h.e.bot(profile.id).budgetIncluded,false);assert.equal(h.e.allocatedBudget(),100);
});
test('moving into operation checks a fresh wallet and leaves settings and flags unchanged on refusal',async()=>{
 const h=await harness(),b=await h.e.saveBot(makeBot({id:'candidate',budget:100,budgetIncluded:false,leverage:2,margin:'CROSSED',exit:off,actionRules:[rule()]}));
 h.client.account=async()=>({canTrade:true,assets:[{asset:'USDT',walletBalance:'90',availableBalance:'90'}]});
 const preview=await h.e.budgetSelection.preview({...b,budgetIncluded:true});assert.equal(preview.allowed,false);assert.equal(preview.available,90);assert.match(preview.message,/90.00/);
 await assert.rejects(()=>h.e.serial(()=>h.e.budgetSelection.set(b.id,true)),/운용예산/);assert.equal(h.e.bot(b.id).budgetIncluded,false);assert.equal(h.e.bot(b.id).runtime.runEnabled,false);
 await assert.rejects(()=>h.e.saveBot({...b,budgetIncluded:true}),/운용예산/);assert.equal(h.e.allocatedBudget(),0);
 await h.e.saveBot({...b,budget:50});await h.e.serial(()=>h.e.budgetSelection.set(b.id,true));assert.equal(h.e.allocatedBudget(),50);assert.equal(h.e.bot(b.id).runtime.runEnabled,false);assert.equal(h.x.calls.length,0);
});
test('archiving an idle running bot disarms account-wide management and re-inclusion does not restart it',async()=>{
 const h=await harness(),exit=rule('CLOSE_ALL','account'),b=await h.e.saveBot(makeBot({id:'idle-manager',budget:100,leverage:2,margin:'CROSSED',exit:off,actionRules:[exit]}));await h.e.startBot(b.id);
 await h.e.serial(()=>h.e.budgetSelection.set(b.id,false));const saved=h.e.bot(b.id);assert.equal(saved.runtime.runEnabled,false);assert.equal(saved.runtime.managementEnabled,false);assert.equal(h.e.allocatedBudget(),0);
 h.trade('BUY',1);await h.e.tick();assert.equal(h.x.calls.length,0);
 await h.e.serial(()=>h.e.budgetSelection.set(b.id,true));await h.e.tick();assert.equal(h.x.calls.length,0);assert.equal(saved.runtime.managementEnabled,false);
});
test('owned holdings and unsettled orders prevent archiving without changing ownership or placing orders',async()=>{
 const h=await twoBots(),calls=h.x.calls.length;
 await assert.rejects(()=>h.e.serial(()=>h.e.budgetSelection.set(h.a.id,false)),/보유 포지션/);assert.notEqual(h.a.budgetIncluded,false);assert.equal(h.a.runtime.runEnabled,true);assert.equal(h.x.calls.length,calls);
 const idle=await h.e.saveBot(makeBot({id:'unsettled',budget:100,leverage:2,margin:'CROSSED',exit:off,actionRules:[rule()]}));
 const order={id:'unsettled-order',botId:idle.id,scope:h.e.state.scope,status:'UNKNOWN',parameters:{symbol:'BTCUSDT',type:'LIMIT'},orderPolicy:{remainder:'market'},appliedQty:0};h.e.state.orders.push(order);
 await assert.rejects(()=>h.e.serial(()=>h.e.budgetSelection.set(idle.id,false)),/미체결/);order.status='CANCELED';
 await assert.rejects(()=>h.e.serial(()=>h.e.budgetSelection.set(idle.id,false)),/잔량/);order.fallbackDone=true;
 await h.e.serial(()=>h.e.budgetSelection.set(idle.id,false));assert.equal(h.e.bot(idle.id).budgetIncluded,false);assert.equal(h.x.calls.length,calls);
});
test('saved profiles cannot bypass budget selection with a direct bot-attributed entry',async()=>{
 const h=await harness(),b=await h.e.saveBot(makeBot({id:'manual-profile',budget:100,budgetIncluded:false,leverage:2,margin:'CROSSED',exit:off,actionRules:[rule()]}));
 assert.throws(()=>h.e.manual.validateBotPlan({action:'OPEN',margin:'CROSSED',leverage:2,direction:'LONG'}, {botId:b.id}),/보관/);
 await assert.rejects(()=>h.e.serial(()=>h.e.budgetSelection.set(b.id,'true')),/선택/);assert.equal(h.x.calls.length,0);
});

test('maker rejection during a shared-position exit keeps all bots running and retries only the owner share',async()=>{
 const h=await twoBots(),q=h.a.runtime.quantity,exit=makeActionRule({action:'EXIT_LONG',formula:'TRUE@1m',sizePercent:100,closeScope:'bot',order:{type:'LIMIT',price:'ask',ticks:0,timeout:5,remainder:'cancel',postOnly:true}});h.a.actionRules=[exit];
 const send=h.client.placeOrder.bind(h.client),attempts=[];h.client.placeOrder=async p=>{attempts.push({...p});if(attempts.length===1)throw new BinanceError('maker',{code:-5022,status:400});return send(p);};
 await h.e.tick();assert.equal(h.a.runtime.runEnabled,true);assert.equal(h.b.runtime.runEnabled,true);assert.equal(h.a.runtime.error,null);assert.equal(h.a.runtime.quantity,q);assert.equal(h.b.runtime.quantity,q);assert.equal(h.e.decorate(h.a).runtime.orderRetry.role,'exit');
 h.x.now+=4999;await h.e.tick();assert.equal(attempts.length,1);h.x.now++;await h.e.tick();assert.equal(attempts.length,2);assert.equal(Number(attempts[1].quantity),q);assert.equal(h.a.runtime.quantity,0);assert.equal(h.b.runtime.quantity,q);assert.equal(h.a.runtime.error,null);assert.equal(h.a.runtime.runEnabled,true);assert.equal(h.e.decorate(h.a).runtime.orderRetry,null);
});
