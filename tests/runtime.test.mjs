import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { BinanceClient,BinanceError,signParameters } from '../backend/binance.mjs';
import { emptyState } from '../backend/store.mjs';
import { TradingEngine } from '../backend/engine.mjs';
import { entryOrder,protectiveOrders,quantize } from '../backend/orders.mjs';
import { makeBot } from '../public/core.js';
import { makeActionRule, upgradeActions } from '../public/actions.js';
import { createServer } from '../server.mjs';

const info={symbol:'BTCUSDT',baseAsset:'BTC',status:'TRADING',quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL',filters:[{filterType:'PRICE_FILTER',tickSize:'0.10'},{filterType:'LOT_SIZE',minQty:'0.001',maxQty:'1000',stepSize:'0.001'},{filterType:'MARKET_LOT_SIZE',minQty:'0.001',maxQty:'1000',stepSize:'0.001'},{filterType:'MIN_NOTIONAL',notional:'5'}]};
class MemoryStore{constructor(state=emptyState()){this.state=structuredClone(state);this.saved=[];this.fail=false;}async load(){return this.state;}async save(){if(this.fail)throw new Error('disk full');this.saved.push(structuredClone(this.state));}}
class Exchange{
  constructor(){this.now=1800000000000;this.orders=new Map();this.algos=new Map();this.quantity=0;this.calls=[];this.mutations=[];this.config={marginType:'ISOLATED',leverage:3};this.next=1;this.uncertain=false;this.guardUncertain=false;}
  fill(id,amount){const o=this.orders.get(id),delta=amount-Number(o.executedQty||0),price=this.fillPrice||100;this.quantity+=delta*(o.side==='BUY'?1:-1);o.executedQty=String(amount);o.cumQuote=String(amount*price);o.avgPrice=String(price);o.status=amount>=Number(o.origQty)-1e-9?'FILLED':'PARTIALLY_FILLED';return o;}
}
class FakeClient{
  constructor(exchange){this.e=exchange;this.offset=0;this.environment='testnet';}
  clearCredentials(){}redact(s){return s;}async syncTime(){return this.e.now;}
  async exchangeInfo(){return {symbols:[info]};}async tickers(){return [{symbol:'BTCUSDT',lastPrice:'100',highPrice:'101',lowPrice:'99',priceChangePercent:'0',quoteVolume:'100000'}];}
  async klines(symbol,interval){if(this.e.frameBars?.[interval])return structuredClone(this.e.frameBars[interval]);return Array.from({length:600},(_,i)=>({time:(this.e.now-(600-i)*900000)/1000,closeTime:this.e.now-(599-i)*900000-1,open:100,high:101,low:99,close:this.e.signalClose??100,volume:10}));}
  async book(){return {bids:[['99.9','10']],asks:[['100','10']]};}async premium(){return {markPrice:'100',lastFundingRate:'0.0001'};}
  async account(){return {canTrade:true,assets:[{asset:'USDT',walletBalance:'5000',availableBalance:'4000'}]};}
  async positionMode(){return {dualSidePosition:this.e.hedge||false};}
  async positions(){return this.e.quantity?[{symbol:'BTCUSDT',positionSide:this.e.hedge?(this.e.quantity>0?'LONG':'SHORT'):'BOTH',positionAmt:String(this.e.quantity),entryPrice:'100',markPrice:'100',positionInitialMargin:String(Math.abs(this.e.quantity)*100/this.e.config.leverage),unRealizedProfit:'0'}]:[];}
  async openOrders(){return [...this.e.orders.values()].filter(o=>['NEW','PARTIALLY_FILLED'].includes(o.status));}
  async openAlgoOrders(){return [...this.e.algos.values()].filter(o=>o.algoStatus==='NEW');}
  async symbolConfig(){return [this.e.config];}async leverageBrackets(){return [{brackets:[{initialLeverage:125,notionalFloor:0,notionalCap:1000000}]}];}
  async changeMargin(s,margin){this.e.mutations.push('changeMargin');this.e.config.marginType=margin;return {code:200};}async changeLeverage(s,leverage){this.e.mutations.push('changeLeverage');this.e.config.leverage=leverage;return {leverage};}
  async placeOrder(p){this.e.calls.push({method:'placeOrder',parameters:structuredClone(p)});this.e.beforeSend?.(p);const o={...p,clientOrderId:p.newClientOrderId,orderId:this.e.next++,origQty:p.quantity,executedQty:'0',cumQuote:'0',status:'NEW'};this.e.orders.set(p.newClientOrderId,o);if(this.e.uncertain){this.e.uncertain=false;throw new BinanceError('timeout',{uncertain:true});}if(p.type==='MARKET')this.e.fill(p.newClientOrderId,Number(p.quantity));return structuredClone(o);}
  async queryOrder(s,id){const o=typeof id==='object'?[...this.e.orders.values()].find(o=>o.orderId===id.orderId):this.e.orders.get(id);if(!o)throw new BinanceError('not found',{code:-2013});return structuredClone(o);}
  async cancelOrder(s,id){this.e.mutations.push('cancelOrder');const o=this.e.orders.get(id);if(o.status!=='FILLED')o.status='CANCELED';return structuredClone(o);}
  async placeAlgo(p){this.e.calls.push({method:'placeAlgo',parameters:structuredClone(p)});const o={...p,algoId:this.e.next++,algoStatus:'NEW'};this.e.algos.set(p.clientAlgoId,o);if(this.e.guardUncertain){this.e.guardUncertain=false;throw new BinanceError('unknown',{uncertain:true});}return structuredClone(o);}
  async queryAlgo(id){return structuredClone(this.e.algos.get(id));}async cancelAlgo(id){this.e.mutations.push('cancelAlgo');this.e.algos.get(id).algoStatus='CANCELED';return {code:200};}async trades(){return [];}
}
async function harness(){const exchange=new Exchange(),store=new MemoryStore(),engine=await new TradingEngine(store,{now:()=>exchange.now,clientFactory:()=>new FakeClient(exchange)}).init();await engine.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});const b=await engine.saveBot(makeBot({name:'runtime',formula:'TRUE',budget:500,order:{type:'MARKET',price:'ask',ticks:0,timeout:10,remainder:'cancel',postOnly:false}}));return {exchange,store,engine,id:b.id};}

test('signed requests use HMAC over the exact encoded query and redact secrets',async()=>{
  const p={symbol:'BTCUSDT',timestamp:1234},query='symbol=BTCUSDT&timestamp=1234';assert.equal(signParameters(p,'secret'),query+'&signature='+createHmac('sha256','secret').update(query).digest('hex'));
  let sent;const client=new BinanceClient({apiKey:'private-key',secret:'private-secret',minGap:0,now:()=>1000,fetchImpl:async(url,options)=>{sent={url,options};return new Response(JSON.stringify({code:-2015,msg:'private-key private-secret denied'}),{status:400});}});
  await assert.rejects(()=>client.account(),e=>!e.message.includes('private-key')&&!e.message.includes('private-secret'));assert.equal(sent.options.headers['X-MBX-APIKEY'],'private-key');assert.match(sent.url,/signature=/);
  assert.throws(()=>new BinanceClient({environment:'https://attacker.invalid'}));
});
test('decimal steps, budget reserves, hedge parameters and invalid protective prices are enforced',()=>{
  assert.equal(quantize('1.234','0.005'),'1.23');assert.equal(quantize('1.234','0.005','ceil'),'1.235');assert.equal(quantize('100','0.10'),'100');
  const b={...makeBot({budget:100}),used:50,reserved:30};const plan=entryOrder(b,info,{bids:[['99.9','1']],asks:[['100','1']]},100,true);assert.ok(plan.margin<=20);assert.equal(plan.parameters.positionSide,'LONG');
  const guards=protectiveOrders(b,info,'1',100,true);assert.equal(guards[0].parameters.reduceOnly,undefined);assert.equal(guards[0].parameters.side,'SELL');
  assert.throws(()=>protectiveOrders({...b,exit:{...b.exit,stopLoss:.00001,takeProfit:.00001}},info,1,100));
});
test('a persisted order intent precedes transmission, and a steady signal cannot duplicate an entry',async()=>{
  const {engine,exchange,store,id}=await harness();exchange.beforeSend=p=>assert.ok(store.saved.at(-1).orders.some(o=>o.id===p.newClientOrderId&&o.status==='UNKNOWN'));
  await engine.startBot(id);await engine.tick();await engine.tick();
  assert.equal(exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(exchange.calls.filter(c=>c.method==='placeAlgo').length,2);assert.ok(engine.bot(id).runtime.quantity>0);assert.equal(engine.bot(id).runtime.entries,1);
  await engine.pauseBot(id);assert.equal(engine.bot(id).runtime.runEnabled,false);assert.equal(engine.decorate(engine.bot(id)).task,'position');assert.equal(engine.decorate(engine.bot(id)).status,'paused');
  assert.ok(!JSON.stringify(store.state).includes('test-secret'));assert.ok(!JSON.stringify(store.state).includes('test-key-1234567890'));
});
test('an accepted order with a lost response is queried and recovered without resending, including after restart',async()=>{
  const {engine,exchange,store,id}=await harness();exchange.uncertain=true;await engine.startBot(id);await engine.tick();const intent=store.state.orders.find(o=>o.role==='entry');assert.equal(intent.status,'UNKNOWN');
  const recoveredStore=new MemoryStore(store.state),recovered=await new TradingEngine(recoveredStore,{now:()=>exchange.now,clientFactory:()=>new FakeClient(exchange)}).init();
  await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});exchange.fill(intent.id,Number(intent.parameters.quantity));await recovered.tick();await recovered.tick();
  assert.equal(exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(recovered.bot(id).runtime.quantity,Number(intent.parameters.quantity));assert.equal(recovered.bot(id).runtime.runEnabled,false);assert.equal(exchange.calls.filter(c=>c.method==='placeAlgo').length,0);
});
test('partial LIMIT cancellation converts only the remaining quantity and counts one logical entry',async()=>{
  const {engine,exchange,id}=await harness();const b=engine.bot(id);b.actionRules[0].order={type:'LIMIT',price:'bid',ticks:0,timeout:10,remainder:'market',postOnly:true};await engine.startBot(id);await engine.tick();
  const first=engine.ownOrders(b).find(o=>o.role==='entry'),total=Number(first.parameters.quantity);exchange.fill(first.id,Number(quantize(String(total*.4),'0.001')));exchange.now+=15000;await engine.tick();
  const placements=exchange.calls.filter(c=>c.method==='placeOrder');assert.equal(placements.length,2);assert.ok(Math.abs(Number(placements[1].parameters.quantity)-(total-first.appliedQty))<.0011);assert.equal(b.runtime.entries,1);
  await engine.tick();assert.equal(exchange.calls.filter(c=>c.method==='placeOrder').length,2);
});
test('unknown protection registration is reconciled, and a storage failure prevents transmission',async()=>{
  const {engine,exchange,store,id}=await harness();exchange.guardUncertain=true;await engine.startBot(id);await engine.tick();await engine.tick();assert.equal(exchange.calls.filter(c=>c.method==='placeAlgo'&&c.parameters.type==='STOP_MARKET').length,1);
  const h=await harness();await h.engine.startBot(h.id);h.store.fail=true;await assert.rejects(()=>h.engine.tick());assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,0);
});
test('manual positions and duplicate symbol ownership are rejected; permission accepts boolean only',async()=>{
  const h=await harness();h.exchange.quantity=1;await assert.rejects(()=>h.engine.startBot(h.id),/포지션/);assert.equal(h.exchange.calls.length,0);
  h.exchange.quantity=0;await h.engine.startBot(h.id);const second=await h.engine.saveBot(makeBot({formula:'TRUE',budget:100}));await assert.rejects(()=>h.engine.startBot(second.id),/한 봇/);
  await assert.rejects(()=>h.engine.connect({environment:'live',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:'true'}),/켜짐 또는 꺼짐/);
});
test('an exchange-triggered protective fill closes the owned position and cancels its sibling without a new entry',async()=>{
  const {engine,exchange,id}=await harness();await engine.startBot(id);await engine.tick();
  const stop=[...exchange.algos.values()].find(a=>a.type==='STOP_MARKET');const child={...stop,clientOrderId:'exchange-trigger',newClientOrderId:'exchange-trigger',orderId:987,origQty:stop.quantity,executedQty:'0',cumQuote:'0',status:'NEW'};
  exchange.orders.set('exchange-trigger',child);exchange.fill('exchange-trigger',Number(child.origQty));stop.actualOrderId=987;stop.algoStatus='FINISHED';
  await engine.tick();await engine.tick();assert.equal(engine.bot(id).runtime.quantity,0);assert.equal(exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.ok([...exchange.algos.values()].every(o=>o.algoStatus!=='NEW'));
});

const marketRule=(action,formula='TRUE',extra={})=>makeActionRule({action,formula:`(${formula})@15m`,sizePercent:action.startsWith('ENTER')?25:100,order:{type:'MARKET',price:'bid',ticks:0,timeout:10,remainder:'cancel',postOnly:false},reentry:{mode:'rearm',cooldown:0},...extra});
async function actionHarness(rules){const h=await harness();await h.engine.saveBot({...h.engine.bot(h.id),actionRules:rules});return h;}

test('protection plans can omit both or either side without using disabled percentages or trigger settings',()=>{
  const b={...makeBot(),direction:'LONG'};assert.equal(protectiveOrders(b,info,'1',100).length,2);
  assert.deepEqual(protectiveOrders({...b,exit:{takeProfitEnabled:false,stopLossEnabled:false}},null,0,0),[]);
  const take=protectiveOrders({...b,exit:{...b.exit,stopLossEnabled:false,stopLoss:null}},info,'1',100);assert.equal(take.length,1);assert.equal(take[0].role,'take');assert.equal(take[0].parameters.triggerPrice,'103');
  const stop=protectiveOrders({...b,direction:'SHORT',exit:{...b.exit,takeProfitEnabled:false,takeProfit:null}},info,'1',100);assert.equal(stop.length,1);assert.equal(stop[0].role,'stop');assert.equal(stop[0].parameters.triggerPrice,'101.5');
});

test('with both protections disabled, crossing old TP levels keeps the position and formula exits still close it',async()=>{
  const h=await actionHarness([marketRule('ENTER_LONG','종가 > 100'),marketRule('EXIT_LONG','종가 < 100')]);await h.engine.saveBot({...h.engine.bot(h.id),exit:{takeProfitEnabled:false,stopLossEnabled:false}});
  h.exchange.signalClose=101;await h.engine.startBot(h.id);await h.engine.tick();assert.ok(h.exchange.quantity>0);assert.equal(h.exchange.calls.filter(c=>c.method==='placeAlgo').length,0);
  h.engine.client.premium=async()=>({markPrice:'120'});await h.engine.tick();assert.ok(h.exchange.quantity>0);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
  h.exchange.signalClose=99;await h.engine.tick();assert.equal(h.exchange.quantity,0);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);
});

test('single-sided protection reacts only to the enabled TP or SL for both long and short positions',async()=>{
  for(const direction of ['LONG','SHORT'])for(const enabled of ['takeProfit','stopLoss']){
    const h=await actionHarness([marketRule('ENTER_'+direction)]),b=h.engine.bot(h.id);await h.engine.saveBot({...b,exit:{...b.exit,takeProfitEnabled:enabled==='takeProfit',stopLossEnabled:enabled==='stopLoss'}});await h.engine.startBot(h.id);await h.engine.tick();
    const guard=h.exchange.calls.filter(c=>c.method==='placeAlgo');assert.equal(guard.length,1);assert.equal(guard[0].parameters.type,enabled==='takeProfit'?'TAKE_PROFIT_MARKET':'STOP_MARKET');
    const profit=direction==='LONG'?110:90,loss=direction==='LONG'?90:110;let price=enabled==='takeProfit'?loss:profit;h.engine.client.premium=async()=>({markPrice:String(price)});await h.engine.tick();assert.notEqual(h.exchange.quantity,0);
    price=enabled==='takeProfit'?profit:loss;await h.engine.tick();assert.equal(h.exchange.quantity,0);
  }
});

test('saving stops and cancels guards; explicit start applies the remaining enabled protection',async()=>{
  const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();const quantity=h.exchange.quantity;
  await h.engine.saveBot({...h.engine.bot(h.id),exit:{...h.engine.bot(h.id).exit,stopLossEnabled:false}});assert.equal([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').length,0);await h.engine.startBot(h.id);await h.engine.tick();let active=[...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW');assert.equal(active.length,1);assert.equal(active[0].type,'TAKE_PROFIT_MARKET');
  await h.engine.saveBot({...h.engine.bot(h.id),exit:{...h.engine.bot(h.id).exit,takeProfitEnabled:false}});await h.engine.tick();active=[...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW');assert.equal(active.length,0);assert.equal(h.exchange.quantity,quantity);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(h.engine.bot(h.id).runtime.guardKey,null);
});

test('unconfirmed cancellation is surfaced and retried before declaring protections removed',async()=>{
  const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();const cancel=h.engine.client.cancelAlgo.bind(h.engine.client);h.engine.client.cancelAlgo=async()=>({code:200});
  await h.engine.saveBot({...h.engine.bot(h.id),exit:{...h.engine.bot(h.id).exit,takeProfitEnabled:false,stopLossEnabled:false}});await h.engine.tick();assert.equal(h.engine.bot(h.id).runtime.error,null);assert.match(h.engine.bot(h.id).runtime.waiting.message,/취소 확인/);assert.equal([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').length,2);
  h.engine.client.cancelAlgo=cancel;h.exchange.now+=3000;await h.engine.tick();assert.equal([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').length,0);assert.equal(h.engine.bot(h.id).runtime.error,null);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});

test('saving also cancels guards with new-order permission off, and disabled protection survives restart',async()=>{
  const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();h.engine.tradingEnabled=false;const mutations=h.exchange.mutations.length;
  await h.engine.saveBot({...h.engine.bot(h.id),exit:{...h.engine.bot(h.id).exit,takeProfitEnabled:false,stopLossEnabled:false}});await h.engine.tick();assert.equal(h.exchange.mutations.length,mutations+2);assert.equal([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').length,0);
  const recovered=await new TradingEngine(new MemoryStore(h.store.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();assert.equal(recovered.bot(h.id).exit.takeProfitEnabled,false);assert.equal(recovered.bot(h.id).exit.stopLossEnabled,false);
  await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});await recovered.tick();assert.equal([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').length,0);assert.ok(h.exchange.quantity>0);
});

test('new bots have unlimited entries, while legacy rule leverage, waits and finite limits migrate unchanged',()=>{
  assert.equal(makeBot().maxEntries,0);assert.equal(makeActionRule().reentry.afterExitCooldown,0);
  const legacy=makeBot({maxEntries:3,leverage:9,actionRules:[{...marketRule('ENTER_LONG'),leverage:undefined,reentry:{mode:'bar',cooldown:120}}]});
  const upgraded=upgradeActions(legacy);assert.equal(upgraded.maxEntries,3);assert.equal(upgraded.actionRules[0].leverage,9);assert.equal(upgraded.actionRules[0].reentry.afterExitCooldown,120);assert.equal(upgradeActions(upgraded),upgraded);
});

test('unlimited entries exceed twenty additions within budget; a finite limit resets only after a full exit',async()=>{
  const rule=marketRule('ENTER_LONG','TRUE',{sizePercent:1,reentry:{mode:'bar',cooldown:0,afterExitCooldown:0}}),h=await actionHarness([rule]);
  await h.engine.startBot(h.id);for(let i=0;i<25;i++){h.exchange.now+=900000;await h.engine.tick();}assert.equal(h.engine.bot(h.id).runtime.entries,25);
  const finite=await actionHarness([rule]);await finite.engine.saveBot({...finite.engine.bot(finite.id),maxEntries:2});await finite.engine.startBot(finite.id);
  for(let i=0;i<4;i++){finite.exchange.now+=900000;await finite.engine.tick();}assert.equal(finite.engine.bot(finite.id).runtime.entries,2);assert.equal(finite.exchange.calls.filter(c=>c.method==='placeOrder').length,2);
  await finite.engine.closeBot(finite.id);assert.equal(finite.engine.bot(finite.id).runtime.entries,0);finite.exchange.now+=900000;await finite.engine.startBot(finite.id);await finite.engine.tick();assert.equal(finite.engine.bot(finite.id).runtime.entries,1);
});

test('entry conditions apply different leverage only when flat, retain the held leverage on additions, and persist it',async()=>{
  const rules=[marketRule('ENTER_LONG','종가 > 100',{leverage:7,reentry:{mode:'bar',cooldown:0,afterExitCooldown:0}}),marketRule('ENTER_SHORT','종가 < 100',{leverage:2}),marketRule('EXIT_LONG','종가 < 100')],h=await actionHarness(rules);
  const changes=[],change=h.engine.client.changeLeverage.bind(h.engine.client);h.engine.client.changeLeverage=async(s,l)=>{changes.push(l);return change(s,l);};
  h.exchange.signalClose=101;await h.engine.startBot(h.id);assert.deepEqual(changes,[]);await h.engine.tick();const b=h.engine.bot(h.id),first=b.runtime.quantity;assert.equal(b.leverage,7);
  b.actionRules[0].leverage=11;h.exchange.now+=900000;await h.engine.tick();assert.ok(b.runtime.quantity>first);assert.equal(b.leverage,7);assert.deepEqual(changes,[7]);
  h.exchange.signalClose=99;await h.engine.tick();assert.equal(b.runtime.quantity,0);await h.engine.tick();assert.ok(h.exchange.quantity<0);assert.equal(b.leverage,2);assert.deepEqual(changes,[7,2]);
  const recovered=await new TradingEngine(new MemoryStore(h.store.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();assert.equal(recovered.bot(h.id).leverage,2);assert.equal(recovered.bot(h.id).actionRules[0].leverage,11);assert.equal(recovered.bot(h.id).actionRules[1].leverage,2);
});

test('uncertain or unconfirmed leverage changes and newly appearing exposure prevent an entry order',async()=>{
  for(const kind of ['uncertain','readback','external']){
    const h=await actionHarness([marketRule('ENTER_LONG','TRUE',{leverage:8})]);await h.engine.startBot(h.id);
    if(kind==='uncertain')h.engine.client.changeLeverage=async()=>{throw new BinanceError('timeout',{uncertain:true});};
    if(kind==='readback')h.engine.client.changeLeverage=async()=>({leverage:8});
    if(kind==='external'){const read=h.engine.client.symbolConfig.bind(h.engine.client);h.engine.client.symbolConfig=async()=>{h.engine.accountSnapshot.orders.push({symbol:'BTCUSDT'});return read();};}
    await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,0);assert.equal(h.engine.bot(h.id).runtime.runEnabled,false);
  }
});

test('a returned 150x bracket permits a 150x entry condition and sizes the first order at that verified leverage',async()=>{
  const h=await harness();h.engine.client.leverageBrackets=async()=>[{symbol:'BTCUSDT',brackets:[{initialLeverage:150,notionalFloor:0,notionalCap:300000}]}];
  await h.engine.saveBot({...h.engine.bot(h.id),actionRules:[marketRule('ENTER_LONG','TRUE',{leverage:150})]});await h.engine.startBot(h.id);await h.engine.tick();const b=h.engine.bot(h.id),order=h.engine.ownOrders(b).find(o=>o.role==='entry');
  assert.equal(b.leverage,150);assert.equal(h.exchange.config.leverage,150);assert.ok(Math.abs(Number(order.parameters.quantity)*100/150-500*.25*.99)<.001);
});

test('the post-exit wait is independent of the same-condition execution interval and zero disables only that wait',async()=>{
  const entry=marketRule('ENTER_LONG','종가 > 100',{reentry:{mode:'cooldown',cooldown:0,afterExitCooldown:120}}),h=await actionHarness([entry,marketRule('EXIT_LONG','종가 < 100')]);
  h.exchange.signalClose=101;await h.engine.startBot(h.id);await h.engine.tick();h.exchange.signalClose=99;await h.engine.tick();assert.equal(h.exchange.quantity,0);
  h.exchange.signalClose=101;h.exchange.now+=119000;await h.engine.tick();assert.equal(h.exchange.quantity,0);h.exchange.now+=1000;await h.engine.tick();assert.ok(h.exchange.quantity>0);
  const immediate=await actionHarness([marketRule('ENTER_LONG','종가 > 100',{reentry:{mode:'rearm',cooldown:600,afterExitCooldown:0}}),marketRule('EXIT_LONG','종가 < 100')]);immediate.exchange.signalClose=101;await immediate.engine.startBot(immediate.id);await immediate.engine.tick();immediate.exchange.signalClose=99;await immediate.engine.tick();immediate.exchange.signalClose=101;await immediate.engine.tick();assert.ok(immediate.exchange.quantity>0);
});

test('one bot selects long and short entries and side-specific exits from independent formula actions',async()=>{
  const h=await actionHarness([marketRule('ENTER_LONG','종가 > 100'),marketRule('ENTER_SHORT','종가 < 100'),marketRule('EXIT_LONG','종가 <= 100'),marketRule('EXIT_SHORT','종가 >= 100')]);
  h.exchange.signalClose=101;await h.engine.startBot(h.id);await h.engine.tick();assert.ok(h.exchange.quantity>0);assert.equal(h.engine.bot(h.id).runtime.direction,'LONG');
  h.exchange.signalClose=99;await h.engine.tick();assert.equal(h.exchange.quantity,0);await h.engine.tick();assert.ok(h.exchange.quantity<0);assert.equal(h.engine.bot(h.id).runtime.direction,'SHORT');
  h.exchange.signalClose=101;await h.engine.tick();assert.equal(h.exchange.quantity,0);
  const orders=h.exchange.calls.filter(c=>c.method==='placeOrder');assert.deepEqual(orders.map(c=>c.parameters.side),['BUY','SELL','SELL','BUY']);assert.equal(orders[1].parameters.reduceOnly,'true');assert.equal(orders[3].parameters.reduceOnly,'true');assert.equal(orders[2].parameters.reduceOnly,undefined);
});

test('exit-only conditions never open a position, and simultaneous opposing entry signals are held',async()=>{
  const h=await actionHarness([marketRule('EXIT_LONG'),marketRule('EXIT_SHORT'),marketRule('CLOSE_ALL')]);await h.engine.startBot(h.id);await h.engine.tick();assert.equal(h.exchange.calls.length,0);
  await h.engine.saveBot({...h.engine.bot(h.id),actionRules:[marketRule('ENTER_LONG'),marketRule('ENTER_SHORT')]});await h.engine.startBot(h.id);await h.engine.tick();await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,0);assert.equal(h.engine.bot(h.id).runtime.lastEvaluation.conflict,true);
});

test('partial exits have their own signal latch, keep protective quantities, and take priority over adding entries',async()=>{
  const rules=[marketRule('ENTER_LONG','TRUE',{reentry:{mode:'bar',cooldown:0}}),marketRule('EXIT_LONG','종가 > 100',{sizePercent:50})],h=await actionHarness(rules);await h.engine.startBot(h.id);await h.engine.tick();const original=h.engine.bot(h.id).runtime.quantity;
  h.exchange.now+=900000;h.exchange.signalClose=101;await h.engine.tick();const remaining=h.engine.bot(h.id).runtime.quantity;assert.ok(Math.abs(remaining-original*.5)<.0011);assert.equal(h.engine.ownOrders(h.engine.bot(h.id)).filter(o=>o.role==='entry').length,1);
  await h.engine.pauseBot(h.id);await h.engine.tick();assert.equal(h.engine.bot(h.id).runtime.quantity,remaining);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);
  assert.ok([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').every(o=>Math.abs(Number(o.quantity)-remaining)<.00001));
});

test('LIMIT exits use their own policy and convert only the confirmed unfilled residual',async()=>{
  const close=marketRule('EXIT_LONG','종가 > 100',{sizePercent:50,order:{type:'LIMIT',price:'ask',ticks:1,timeout:10,remainder:'market',postOnly:false}}),h=await actionHarness([marketRule('ENTER_LONG'),close]);await h.engine.startBot(h.id);await h.engine.tick();const b=h.engine.bot(h.id),original=b.runtime.quantity;
  h.exchange.signalClose=101;await h.engine.tick();const limit=h.engine.ownOrders(b).find(o=>o.role==='exit');assert.equal(limit.parameters.type,'LIMIT');assert.equal(limit.parameters.reduceOnly,'true');assert.equal(limit.parameters.price,'100.1');assert.equal(limit.ruleId,close.id);
  h.exchange.fill(limit.id,Number(quantize(String(Number(limit.parameters.quantity)*.4),'0.001')));h.exchange.now+=15000;await h.engine.tick();
  const placements=h.exchange.calls.filter(c=>c.method==='placeOrder');assert.equal(placements.length,3);assert.equal(placements[2].parameters.type,'MARKET');assert.ok(Math.abs(Number(placements[2].parameters.quantity)-(Number(limit.parameters.quantity)-limit.appliedQty))<.0011);assert.ok(Math.abs(b.runtime.quantity-original*.5)<.0011);await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,3);
});

test('rule execution latches survive restart and side-specific conditions cannot close the opposite side',async()=>{
  const h=await actionHarness([marketRule('ENTER_SHORT'),marketRule('EXIT_LONG')]);await h.engine.startBot(h.id);await h.engine.tick();assert.ok(h.exchange.quantity<0);await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
  const recovered=await new TradingEngine(new MemoryStore(h.store.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});await recovered.startBot(h.id);await recovered.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(recovered.bot(h.id).runtime.direction,'SHORT');
});

test('legacy fixed-side settings migrate to equivalent action rules without enabling extra strategies',()=>{
  const legacy=makeBot({direction:'SHORT',formula:'종가 < EMA(종가, 20)',entryPercent:17}),upgraded=upgradeActions(legacy);assert.equal(upgraded.actionRules[0].action,'ENTER_SHORT');assert.equal(upgraded.actionRules[0].sizePercent,17);assert.equal(upgraded.actionRules[0].formula,'('+legacy.formula+')@15m[1]');assert.equal(upgraded.actionRules.filter(r=>r.enabled).length,1);assert.deepEqual(upgraded.actionRules[0].order,legacy.order);assert.equal(upgradeActions(upgraded),upgraded);
});

test('action rules reject invalid actions, percentages, duplicate ids, missing formulas and multi-frame expressions',async()=>{
  const h=await harness(),valid=marketRule('ENTER_LONG');
  for(const rule of [{...valid,action:'BUY_ANYTHING'},{...valid,sizePercent:0},{...valid,sizePercent:101},{...valid,action:'CLOSE_ALL',sizePercent:50},{...valid,formula:''},{...valid,formula:'봉(종가, 60, 0) > 0'}])await assert.rejects(()=>h.engine.saveBot({...h.engine.bot(h.id),actionRules:[rule]}));
  await assert.rejects(()=>h.engine.saveBot({...h.engine.bot(h.id),actionRules:[valid,{...valid}]}));await assert.rejects(()=>h.engine.saveBot({...h.engine.bot(h.id),actionRules:[null]}));
});

test('an exit signal cancels a partial entry before its pending market fallback can add exposure',async()=>{
  const entry=marketRule('ENTER_LONG','TRUE',{order:{type:'LIMIT',price:'bid',ticks:0,timeout:10,remainder:'market',postOnly:true}}),h=await actionHarness([entry,marketRule('EXIT_LONG','종가 > 100')]);await h.engine.startBot(h.id);await h.engine.tick();const b=h.engine.bot(h.id),intent=h.engine.ownOrders(b).find(o=>o.role==='entry');h.exchange.fill(intent.id,1);h.exchange.now+=15000;h.exchange.signalClose=101;await h.engine.tick();await h.engine.tick();
  const orders=h.exchange.calls.filter(c=>c.method==='placeOrder');assert.deepEqual(orders.map(c=>c.parameters.side),['BUY','SELL']);assert.equal(orders[1].parameters.quantity,'1');assert.equal(h.exchange.quantity,0);assert.equal(intent.fallbackDone,true);
});

test('pausing cancels the residual plan permanently, including after starting the same bot again',async()=>{
  const entry=marketRule('ENTER_LONG','TRUE',{order:{type:'LIMIT',price:'bid',ticks:0,timeout:10,remainder:'market',postOnly:true}}),h=await actionHarness([entry]);await h.engine.startBot(h.id);await h.engine.tick();await h.engine.pauseBot(h.id);h.exchange.now+=15000;await h.engine.startBot(h.id);await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(h.exchange.quantity,0);
});

test('hedge accounts use the owned LONG or SHORT side for condition exits without reduceOnly',async()=>{
  const h=await actionHarness([marketRule('ENTER_SHORT','종가 < 100'),marketRule('EXIT_SHORT','종가 >= 100')]);h.exchange.hedge=true;await h.engine.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});h.exchange.signalClose=99;await h.engine.startBot(h.id);await h.engine.tick();h.exchange.signalClose=101;await h.engine.tick();assert.equal(h.exchange.quantity,0);const orders=h.exchange.calls.filter(c=>c.method==='placeOrder');assert.equal(orders.length,2);assert.equal(orders[1].parameters.side,'BUY');assert.equal(orders[1].parameters.positionSide,'SHORT');assert.equal(orders[1].parameters.reduceOnly,undefined);
});

test('historical sum slices work in condition rules without repeating a held entry signal',async()=>{
  const h=await actionHarness([marketRule('ENTER_LONG','종가[0:3]/3 > 50')]);await h.engine.startBot(h.id);await h.engine.tick();await h.engine.tick();
  assert.equal(h.exchange.calls.filter(call=>call.method==='placeOrder').length,1);assert.ok(h.exchange.quantity>0);
});

test('mixed-frame rules use explicit prior candles and reentry follows the shortest frame',async()=>{
  const rule=makeActionRule({action:'ENTER_LONG',formula:'(종가[1] > 100)@5m AND 종가@1h[1] > 50',order:{type:'MARKET',price:'bid',ticks:0,timeout:10,remainder:'cancel',postOnly:false},reentry:{mode:'bar',cooldown:0}}),h=await actionHarness([rule]);
  const bars=(values,seconds)=>{const end=Math.floor(h.exchange.now/1000/seconds)*seconds;return values.map((close,i)=>({time:end-(values.length-1-i)*seconds,closeTime:(end-(values.length-2-i)*seconds)*1000-1,open:close,high:close+1,low:close-1,close,volume:10}));};
  h.exchange.frameBars={'5m':bars([99,101,1],300),'1h':bars([40,60,1],3600)};
  await h.engine.startBot(h.id);await h.engine.tick();await h.engine.tick();assert.equal(h.exchange.calls.filter(call=>call.method==='placeOrder').length,1);
  h.exchange.now+=300000;h.exchange.frameBars['5m']=bars([99,101,102,1],300);await h.engine.tick();
  assert.equal(h.exchange.calls.filter(call=>call.method==='placeOrder').length,2);assert.equal(h.engine.bot(h.id).runtime.lastEvaluation.rules[0].interval,'5m');
  const recovered=await new TradingEngine(new MemoryStore(h.store.saved.at(-1)),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();
  assert.equal(recovered.bot(h.id).actionRules[0].formula,rule.formula);assert.equal(recovered.bot(h.id).runtime.runEnabled,false);
});

test('symbol leverage limits reject oversized configuration before any exchange mutation',async()=>{
  const h=await harness();h.engine.client.leverageBrackets=async()=>[{symbol:'BTCUSDT',brackets:[{initialLeverage:20,notionalFloor:0,notionalCap:10000}]}];
  await assert.rejects(()=>h.engine.saveBot({...h.engine.bot(h.id),actionRules:[marketRule('ENTER_LONG','TRUE',{leverage:21})]}),/레버리지/);
  await assert.rejects(()=>h.engine.saveBot({...h.engine.bot(h.id),budget:1000,actionRules:[marketRule('ENTER_LONG','TRUE',{leverage:20})]}),/레버리지/);
  assert.equal(h.exchange.calls.length,0);
});

test('stop conditions work without a position and win over a simultaneous entry until explicit restart',async()=>{
  const h=await actionHarness([marketRule('ENTER_LONG'),marketRule('STOP_BOT')]);await h.engine.startBot(h.id);await h.engine.tick();
  assert.equal(h.engine.bot(h.id).runtime.runEnabled,false);assert.equal(h.exchange.calls.length,0);
  await h.engine.tick();assert.equal(h.store.state.logs.filter(log=>log.title==='조건 정지').length,1);
  await h.engine.startBot(h.id);await h.engine.tick();assert.equal(h.engine.bot(h.id).runtime.runEnabled,false);assert.equal(h.exchange.calls.length,0);
});

test('stop condition cancels partial entry residual permanently, preserves holdings, and stops protective management',async()=>{
  const entry=marketRule('ENTER_LONG','TRUE',{order:{type:'LIMIT',price:'bid',ticks:0,timeout:10,remainder:'market',postOnly:true}}),h=await actionHarness([entry,marketRule('STOP_BOT','종가 > 100')]);
  await h.engine.startBot(h.id);await h.engine.tick();const b=h.engine.bot(h.id),order=h.engine.ownOrders(b).find(o=>o.role==='entry');h.exchange.fill(order.id,1);h.exchange.signalClose=101;h.exchange.now+=15000;await h.engine.tick();
  assert.equal(b.runtime.runEnabled,false);assert.equal(b.runtime.quantity,1);assert.equal(order.status,'CANCELED');assert.equal(order.fallbackDone,true);
  await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').length,0);
  h.exchange.signalClose=100;await h.engine.startBot(h.id);await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});

test('position import reviews an oversized manual holding and records ownership without sending, cancelling or configuring anything',async()=>{
  const h=await harness();h.exchange.quantity=30;const context=await h.engine.positionImports.context();assert.equal(context.positions[0].key,'BTCUSDT:LONG');
  const plan=await h.engine.positionImports.preview({positionKey:'BTCUSDT:LONG',botId:h.id});assert.ok(plan.warnings.some(w=>w.includes('초과')));
  const result=await h.engine.positionImports.commit(plan.id),b=h.engine.bot(h.id);assert.equal(result.bot.quantity,30);assert.equal(b.runtime.entryPrice,100);assert.equal(b.runtime.importPending,true);assert.equal(b.runtime.runEnabled,false);
  assert.equal(h.store.state.orders.length,0);assert.equal(h.store.state.fills.length,0);await h.engine.tick();assert.equal(h.exchange.calls.length,0);assert.deepEqual(h.exchange.mutations,[]);
  await h.engine.startBot(h.id);await h.engine.tick();assert.equal(b.runtime.importPending,false);assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.lastEvaluation.budgetBlocked,true);
  assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,0);assert.equal(h.exchange.calls.filter(c=>c.method==='placeAlgo').length,2);assert.deepEqual(h.exchange.mutations,[]);
});

test('new imported bots default to no entry, keep actual isolated margin, and import remains pending across restart',async()=>{
  const h=await harness();h.exchange.quantity=-2;const positions=h.engine.client.positions.bind(h.engine.client);h.engine.client.positions=async()=> (await positions()).map(p=>({...p,isolatedWallet:'250'}));
  const plan=await h.engine.positionImports.preview({positionKey:'BTCUSDT:SHORT',name:'수동 숏 관리',budget:100});assert.equal(plan.estimatedMargin,250);
  const {bot}=await h.engine.positionImports.commit(plan.id);assert.equal(bot.used,250);assert.equal(bot.positionDirection,'SHORT');assert.ok(bot.budgetWarning);assert.equal(h.engine.bot(bot.id).actionRules[0].action,'CLOSE_ALL');assert.equal(h.engine.bot(bot.id).actionRules[0].formula,'FALSE');
  const recovered=await new TradingEngine(new MemoryStore(h.store.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});await recovered.tick();
  assert.equal(recovered.bot(bot.id).runtime.importPending,true);const repeat=await recovered.positionImports.commit(plan.id);assert.equal(repeat.bot.id,bot.id);assert.equal(recovered.state.positionImports.length,1);assert.equal(recovered.state.bots.length,2);assert.equal(h.exchange.calls.length,0);assert.deepEqual(h.exchange.mutations,[]);
});

test('import confirmation rejects changed quantity, average price, account scope, mode, configuration, orders, or target settings',async()=>{
  const changes=[h=>{h.exchange.quantity=2;},h=>{const get=h.engine.client.positions.bind(h.engine.client);h.engine.client.positions=async()=> (await get()).map(p=>({...p,entryPrice:'101'}));},h=>{h.engine.state.scope='different-account';},h=>{h.exchange.hedge=true;},h=>{h.exchange.config.leverage=5;},h=>{h.exchange.orders.set('manual',{clientOrderId:'manual',status:'NEW',origQty:'1',symbol:'BTCUSDT'});},h=>{h.engine.bot(h.id).budget=400;}];
  for(const change of changes){const h=await harness();h.exchange.quantity=1;const plan=await h.engine.positionImports.preview({positionKey:'BTCUSDT:LONG',botId:h.id});change(h);await assert.rejects(()=>h.engine.positionImports.commit(plan.id),/변경|없거나/);assert.equal(h.engine.bot(h.id).runtime.quantity,0);assert.equal(h.exchange.calls.length,0);assert.deepEqual(h.exchange.mutations,[]);}
});

test('import expiry, duplicate ownership and failed persistence cannot claim or trade a manual position',async()=>{
  const h=await harness();h.exchange.quantity=1;const plan=await h.engine.positionImports.preview({positionKey:'BTCUSDT:LONG',botId:h.id});h.exchange.now+=60001;await assert.rejects(()=>h.engine.positionImports.commit(plan.id),/만료/);
  const fresh=await h.engine.positionImports.preview({positionKey:'BTCUSDT:LONG',botId:h.id});h.store.fail=true;await assert.rejects(()=>h.engine.positionImports.commit(fresh.id),/저장/);assert.equal(h.engine.bot(h.id).runtime.quantity,0);assert.equal(h.engine.state.positionImports,undefined);assert.equal(h.exchange.calls.length,0);assert.deepEqual(h.exchange.mutations,[]);
  const other=await harness();other.exchange.quantity=1;const p=await other.engine.positionImports.preview({positionKey:'BTCUSDT:LONG',botId:other.id});await other.engine.positionImports.commit(p.id);await assert.rejects(()=>other.engine.positionImports.preview({positionKey:'BTCUSDT:LONG',name:'duplicate',budget:100}),/담당/);
});

test('existing exchange orders survive import and must be resolved by the user before managed start',async()=>{
  const h=await harness();h.exchange.quantity=1;h.exchange.algos.set('external-tp',{clientAlgoId:'external-tp',algoStatus:'NEW',type:'TAKE_PROFIT_MARKET'});h.exchange.orders.set('external-limit',{clientOrderId:'external-limit',status:'NEW',symbol:'BTCUSDT',origQty:'1'});
  const plan=await h.engine.positionImports.preview({positionKey:'BTCUSDT:LONG',botId:h.id});assert.equal(plan.orderCount,2);assert.ok(plan.warnings.some(w=>w.includes('기존 주문')));await h.engine.positionImports.commit(plan.id);await h.engine.tick();await assert.rejects(()=>h.engine.startBot(h.id),/소유가 아닌/);assert.deepEqual(h.exchange.mutations,[]);assert.equal(h.exchange.calls.length,0);
});

test('import supports TradFi and selects a hedge side without adopting or closing the opposite manual position',async()=>{
  const h=await harness();h.exchange.hedge=true;h.exchange.quantity=-1;await h.engine.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});
  h.engine.client.exchangeInfo=async()=>({symbols:[{...info,contractType:'TRADIFI_PERPETUAL'}]});const positions=h.engine.client.positions.bind(h.engine.client);h.engine.client.positions=async()=>[...await positions(),{symbol:'BTCUSDT',positionSide:'LONG',positionAmt:'2',entryPrice:'100',markPrice:'100',positionInitialMargin:'66.67'}];
  const plan=await h.engine.positionImports.preview({positionKey:'BTCUSDT:SHORT',botId:h.id});await h.engine.positionImports.commit(plan.id);await h.engine.startBot(h.id);await h.engine.tick();assert.equal(h.engine.bot(h.id).runtime.syncHold,false);assert.equal(h.engine.bot(h.id).runtime.quantity,1);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,0);assert.ok(h.exchange.calls.every(c=>c.parameters.positionSide==='SHORT'));
});

test('held bot budgets remain editable below current margin; exchange mode and leverage stay locked',async()=>{
  const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();const b=h.engine.bot(h.id),held=b.runtime.quantity,mutations=h.exchange.mutations.length;
  const saved=await h.engine.saveBot({...b,budget:10});assert.equal(saved.budget,10);assert.equal(saved.quantity,held);assert.ok(saved.budgetWarning);assert.equal(saved.runtime.runEnabled,false);assert.equal(saved.runtime.managementEnabled,false);assert.equal(h.exchange.mutations.length,mutations+2);
  await assert.rejects(()=>h.engine.saveBot({...h.engine.bot(h.id),leverage:4}),/변경할 수 없습니다/);await assert.rejects(()=>h.engine.saveBot({...h.engine.bot(h.id),margin:'CROSSED'}),/변경할 수 없습니다/);
  await h.engine.startBot(h.id);await h.engine.tick();assert.equal(h.engine.bot(h.id).runtime.quantity,held);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});

test('import HTTP routes require the local token, review-only access works, and commit needs a current server-issued plan',async()=>{
  const h=await harness();h.exchange.quantity=1;const app=await createServer({store:h.store,clientFactory:()=>new FakeClient(h.exchange)});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  try{
    const base='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(base+'/api/session')).json(),headers={'X-Workroom-Token':token,'Content-Type':'application/json'},post=(route,body)=>fetch(base+route,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await fetch(base+'/api/position-import/context')).status,403);assert.equal((await post('/api/position-import/commit',{previewId:'invented'})).status,400);
    await app.engine.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:false});
    assert.equal((await fetch(base+'/api/position-import/context',{headers})).status,200);const response=await post('/api/position-import/preview',{positionKey:'BTCUSDT:LONG',botId:h.id});assert.equal(response.status,200);const plan=await response.json();assert.equal(app.engine.bot(h.id).runtime.quantity,0);
    assert.equal((await post('/api/position-import/commit',{previewId:plan.id})).status,200);assert.equal((await post('/api/position-import/commit',{previewId:plan.id})).status,200);assert.equal(app.engine.state.positionImports.length,1);assert.equal(app.engine.bot(h.id).runtime.importPending,true);assert.equal(app.engine.tradingEnabled,false);assert.equal(h.exchange.calls.length,0);assert.deepEqual(h.exchange.mutations,[]);
  }finally{await new Promise(resolve=>app.server.close(resolve));await app.engine.stopTimer();}
});

test('realized trading losses shrink later entries only in selected budget modes and profits obey the cap',async()=>{
  for(const mode of ['fixed','pnl','capped'])for(const exitPrice of [90,110]){
    const h=await actionHarness([marketRule('ENTER_LONG','종가 > 90')]);await h.engine.saveBot({...h.engine.bot(h.id),budgetMode:mode});await h.engine.startBot(h.id);await h.engine.tick();const b=h.engine.bot(h.id),quantity=b.runtime.quantity;
    h.exchange.fillPrice=exitPrice;await h.engine.closeBot(h.id);await h.engine.tick();const realized=(exitPrice-100)*quantity;assert.ok(Math.abs(b.runtime.realized-realized)<1e-8);
    const limit=mode==='fixed'?500:mode==='pnl'?500+realized:Math.min(500,500+realized);assert.ok(Math.abs(h.engine.decorate(b).effectiveBudget-limit)<1e-8);
    h.exchange.fillPrice=100;h.exchange.signalClose=50;await h.engine.startBot(h.id);await h.engine.tick();h.exchange.signalClose=100;await h.engine.tick();const entry=h.exchange.calls.filter(c=>c.method==='placeOrder'&&c.parameters.side==='BUY').at(-1),margin=Number(entry.parameters.quantity)*100/3;
    assert.ok(margin<=limit*.25*.99+1e-8);assert.ok(margin>limit*.25*.99-.04);
  }
});

test('USDT fees and loss-based budget mode survive restart; exhausted budgets keep guards and exits available',async()=>{
  const h=await actionHarness([marketRule('ENTER_LONG','종가 > 90')]);await h.engine.saveBot({...h.engine.bot(h.id),budgetMode:'pnl'});await h.engine.startBot(h.id);await h.engine.tick();const b=h.engine.bot(h.id);
  h.engine.client.trades=async()=>[{id:1,commission:'1',commissionAsset:'USDT'},{id:2,commission:'.01',commissionAsset:'BNB'}];await h.engine.tick();assert.equal(b.runtime.realized,-1);assert.equal(h.engine.decorate(b).effectiveBudget,499);
  await h.engine.tick();assert.equal(b.runtime.realized,-1);b.runtime.realized=-600;await h.engine.checkpoint();await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').length,2);
  const recovered=await new TradingEngine(new MemoryStore(h.store.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();assert.equal(recovered.bot(h.id).budgetMode,'pnl');assert.equal(recovered.decorate(recovered.bot(h.id)).effectiveBudget,0);assert.equal(recovered.bot(h.id).runtime.runEnabled,false);
  await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});await recovered.startBot(h.id);await recovered.closeBot(h.id);assert.equal(recovered.bot(h.id).runtime.quantity,0);
});

test('rate-limited market reads preserve start state, wait without requests and resume without duplicate entries',async()=>{
 const h=await harness(),b=h.engine.bot(h.id);await h.engine.startBot(h.id);
 const original=h.engine.client.klines.bind(h.engine.client);let calls=0;
 h.engine.client.klines=async(...args)=>{calls++;if(calls===1)throw new BinanceError('Too many requests',{status:429,retryAt:h.exchange.now+5000});return original(...args);};
 await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.equal(h.engine.snapshot().waiting.kind,'rate-limit');assert.equal(h.exchange.calls.length,0);
 await h.engine.tick();assert.equal(calls,1);h.exchange.now+=5000;await h.engine.tick();await h.engine.tick();
 assert.equal(b.runtime.waiting,null);assert.equal(h.engine.snapshot().waiting,null);assert.equal(b.runtime.runEnabled,true);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});
test('account rate limits recover automatically while a user pause remains paused',async()=>{
 const h=await harness(),b=h.engine.bot(h.id);await h.engine.startBot(h.id);const original=h.engine.client.account.bind(h.engine.client);let failed=false;
 h.engine.client.account=async()=>{if(!failed){failed=true;throw new BinanceError('limited',{status:429,retryAt:h.exchange.now+5000});}return original();};
 await h.engine.tick();assert.equal(b.runtime.runEnabled,true);await h.engine.pauseBot(h.id);h.exchange.now+=5000;await h.engine.tick();
 assert.equal(b.runtime.runEnabled,false);assert.equal(h.exchange.calls.length,0);assert.equal(h.engine.snapshot().waiting,null);
});
test('an explicitly rate-rejected entry restores its rule latch and retries only after recovery',async()=>{
 const h=await harness(),b=h.engine.bot(h.id);await h.engine.startBot(h.id);const original=h.engine.client.placeOrder.bind(h.engine.client);let failed=false;
 h.engine.client.placeOrder=async p=>{if(!failed){failed=true;throw new BinanceError('limited',{status:429,retryAt:h.exchange.now+5000});}return original(p);};
 await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.ruleSignals[b.actionRules[0].id].fired,false);assert.equal(h.store.state.orders[0].status,'REJECTED');assert.equal(h.store.state.orders[0].retryable,true);
 h.exchange.now+=5000;await h.engine.tick();await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(b.runtime.entries,1);
});
test('a rate-rejected protection order retries without another entry and permanent failures still pause',async()=>{
 const h=await harness(),b=h.engine.bot(h.id);await h.engine.startBot(h.id);const original=h.engine.client.placeAlgo.bind(h.engine.client);let failed=false;
 h.engine.client.placeAlgo=async p=>{if(!failed){failed=true;throw new BinanceError('limited',{status:429,retryAt:h.exchange.now+5000});}return original(p);};
 await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.ok(b.runtime.quantity>0);h.exchange.now+=5000;await h.engine.tick();
 assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(h.exchange.calls.filter(c=>c.method==='placeAlgo').length,2);assert.equal(b.runtime.error,null);
 const fatal=await harness();await fatal.engine.startBot(fatal.id);fatal.engine.client.klines=async()=>{throw new BinanceError('invalid API permissions',{status:401,code:-2015});};await fatal.engine.tick();assert.equal(fatal.engine.bot(fatal.id).runtime.runEnabled,false);assert.match(fatal.engine.bot(fatal.id).runtime.error,/permissions/);
});

test('post-fill account limits preserve the accepted entry and restore protection after recovery',async()=>{
 const h=await harness(),b=h.engine.bot(h.id);await h.engine.startBot(h.id);const original=h.engine.client.account.bind(h.engine.client);let failed=false;
 h.engine.client.account=async()=>{if(h.exchange.quantity>0&&!failed){failed=true;throw new BinanceError('limited',{status:429,retryAt:h.exchange.now+5000});}return original();};
 await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
 h.exchange.now+=5000;await h.engine.tick();await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(h.exchange.calls.filter(c=>c.method==='placeAlgo').length,2);
});
test('a shared chart cooldown is visible without outgoing requests and never re-enables uncertain-order pauses',async()=>{
 const h=await harness(),b=h.engine.bot(h.id);await h.engine.startBot(h.id);h.exchange.uncertain=true;await h.engine.tick();assert.equal(b.runtime.runEnabled,false);
 h.engine.client.rate={blockedUntil:h.exchange.now+5000,snapshot(){return {blockedUntil:this.blockedUntil};}};
 let reads=0;const original=h.engine.client.account.bind(h.engine.client);h.engine.client.account=async()=>{reads++;return original();};
 await h.engine.tick();assert.equal(reads,0);assert.equal(h.engine.snapshot().waiting.kind,'rate-limit');
 h.exchange.now+=5000;await h.engine.tick();assert.equal(b.runtime.runEnabled,false);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});

test('entry-only data failures cannot block a ready position exit or trigger entry reads while paused',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG','종가 > 0'),marketRule('EXIT_LONG','FALSE')]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();assert.ok(b.runtime.quantity>0);
 b.actionRules[0].formula='(종가 > 0)@4h';b.actionRules[1].formula='TRUE@15m';
 const original=h.engine.client.klines.bind(h.engine.client),calls=[];h.engine.client.klines=async(symbol,interval)=>{calls.push(interval);if(interval==='4h')throw new BinanceError('entry history unavailable',{temporary:true});return original(symbol,interval);};
 await h.engine.tick();assert.equal(b.runtime.quantity,0);assert.equal(calls.includes('4h'),false);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);
 await h.engine.pauseBot(h.id);calls.length=0;await h.engine.tick();assert.equal(calls.length,0);
});
test('a stop condition is handled before reading a failing entry timeframe',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG','종가 > 0'),marketRule('STOP_BOT','TRUE')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);b.actionRules[0].formula='(종가 > 0)@4h';
 const original=h.engine.client.klines.bind(h.engine.client);h.engine.client.klines=async(symbol,interval)=>{if(interval==='4h')throw Error('should not read entry');return original(symbol,interval);};
 await h.engine.tick();assert.equal(b.runtime.runEnabled,false);assert.equal(b.runtime.error,null);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,0);
});

test('storage recovery retries an unsent signal only after file and exchange verification, with one atomic intent',async()=>{
 const h=await harness(),save=h.store.save.bind(h.store);await h.engine.startBot(h.id);let fail=true;
 h.store.save=async()=>{if(fail&&h.store.state.orders.some(o=>o.role==='entry')){fail=false;throw Object.assign(Error('locked'),{code:'EACCES',syscall:'rename',path:'state.json'});}return save();};
 await assert.rejects(()=>h.engine.tick(),e=>e.storage);assert.equal(h.exchange.calls.length,0);assert.equal(h.engine.bot(h.id).runtime.runEnabled,true);assert.equal(h.engine.bot(h.id).runtime.ruleSignals['legacy-entry'].fired,false);
 assert.equal(h.engine.snapshot().storageFault.code,'EACCES');assert.equal(h.engine.snapshot().bots[0].runtime.waiting.kind,'storage');
 h.exchange.beforeSend=p=>{const saved=h.store.saved.at(-1);assert.ok(saved.orders.some(o=>o.id===p.newClientOrderId));assert.equal(saved.bots[0].runtime.ruleSignals['legacy-entry'].fired,true);};
 h.exchange.now+=6000;await h.engine.tick();await h.engine.tick();assert.equal(h.engine.writeError,null);assert.equal(h.engine.tradingEnabled,true);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.ok(h.store.state.storageHealth.recoveredAt);
});
test('a lost post-fill journal write recovers the accepted fill and protection without another entry',async()=>{
 const h=await harness(),save=h.store.save.bind(h.store);await h.engine.startBot(h.id);let fail=true;
 h.store.save=async()=>{if(fail&&h.store.state.orders.some(o=>o.role==='entry'&&o.status==='FILLED')){fail=false;throw Object.assign(Error('disk'),{code:'ENOSPC'});}return save();};
 await assert.rejects(()=>h.engine.tick(),e=>e.storage);assert.ok(h.exchange.quantity>0);assert.equal(h.engine.bot(h.id).runtime.quantity,0);assert.equal(h.engine.ownOrders(h.engine.bot(h.id))[0].status,'UNKNOWN');
 h.exchange.now+=6000;await h.engine.tick();await h.engine.tick();assert.equal(h.engine.bot(h.id).runtime.quantity,h.exchange.quantity);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(h.exchange.calls.filter(c=>c.method==='placeAlgo').length,2);
 assert.equal(h.store.state.fills.filter(f=>f.role==='entry').length,1);assert.equal(h.engine.storage.fault,null);
});
test('protection accepted before a storage failure is queried and never registered twice',async()=>{
 const h=await harness(),save=h.store.save.bind(h.store);await h.engine.startBot(h.id);let fail=true;
 h.store.save=async()=>{if(fail&&h.store.state.orders.some(o=>o.kind==='algo'&&o.status==='NEW')){fail=false;throw Object.assign(Error('busy'),{code:'EBUSY'});}return save();};
 await assert.rejects(()=>h.engine.tick(),e=>e.storage);h.exchange.now+=6000;await h.engine.tick();await h.engine.tick();
 assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(h.exchange.calls.filter(c=>c.method==='placeAlgo').length,2);assert.equal(h.engine.storage.fault,null);
});
test('an uncertain-order safety pause survives storage recovery even when its fill can be confirmed',async()=>{
 const h=await harness(),save=h.store.save.bind(h.store);await h.engine.startBot(h.id);h.exchange.uncertain=true;let fail=true;
 h.store.save=async()=>{if(fail&&h.store.state.bots[0].runtime.error?.includes('timeout')){fail=false;throw Object.assign(Error('busy'),{code:'EBUSY'});}return save();};
 await assert.rejects(()=>h.engine.tick(),e=>e.storage);const intent=h.engine.ownOrders(h.engine.bot(h.id))[0];h.exchange.fill(intent.id,Number(intent.parameters.quantity));
 h.exchange.now+=6000;await h.engine.tick();await h.engine.tick();assert.equal(h.engine.storage.fault,null);assert.equal(h.engine.bot(h.id).runtime.runEnabled,false);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});
test('unknown exchange acceptance holds recovery and never resends a missing client order id',async()=>{
 const h=await harness();await h.engine.startBot(h.id);h.exchange.uncertain=true;await h.engine.tick();const intent=h.engine.ownOrders(h.engine.bot(h.id))[0],actual=h.exchange.orders.get(intent.id);h.exchange.orders.delete(intent.id);
 h.store.fail=true;await assert.rejects(()=>h.engine.checkpoint(),e=>e.storage);h.store.fail=false;h.exchange.now+=6000;await h.engine.tick();
 assert.equal(h.engine.tradingEnabled,false);assert.equal(h.engine.snapshot().storageFault.phase,'verification');assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
 h.exchange.orders.set(intent.id,actual);h.exchange.fill(intent.id,Number(intent.parameters.quantity));h.exchange.now+=6000;await h.engine.tick();assert.equal(h.engine.storage.fault,null);assert.equal(h.engine.bot(h.id).runtime.runEnabled,false);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});
test('a mismatched exchange holding cannot release the storage stop; restoring the match can',async()=>{
 const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();const original=h.exchange.quantity;
 h.store.fail=true;await assert.rejects(()=>h.engine.checkpoint(),e=>e.storage);h.store.fail=false;h.exchange.quantity=original+1;h.exchange.now+=6000;await h.engine.tick();assert.equal(h.engine.tradingEnabled,false);assert.equal(h.engine.snapshot().storageFault.phase,'verification');
 h.exchange.quantity=original;h.exchange.now+=6000;await h.engine.tick();assert.equal(h.engine.storage.fault,null);assert.equal(h.engine.bot(h.id).runtime.runEnabled,true);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});
test('user pause and permission off during storage failure remain effective after automatic recovery',async()=>{
 for(const off of [false,true]){
  const h=await harness();await h.engine.startBot(h.id);h.store.fail=true;await assert.rejects(()=>h.engine.checkpoint(),e=>e.storage);
  if(off)await h.engine.setTrading(false);else await h.engine.pauseBot(h.id);
  h.store.fail=false;h.exchange.now+=6000;await h.engine.tick();assert.equal(h.engine.storage.fault,null);assert.equal(h.engine.bot(h.id).runtime.runEnabled,false);assert.equal(h.engine.tradingEnabled,!off);assert.equal(h.exchange.calls.length,0);assert.equal(h.store.saved.at(-1).orderPermission.enabled,!off);
 }
});
test('rate-limited recovery reads wait without permanent bot stops or duplicate entries',async()=>{
 const h=await harness();await h.engine.startBot(h.id);h.store.fail=true;await assert.rejects(()=>h.engine.checkpoint(),e=>e.storage);h.store.fail=false;
 const mode=h.engine.client.positionMode.bind(h.engine.client);let calls=0,fail=true;h.engine.client.positionMode=async()=>{calls++;if(fail)throw new BinanceError('rate',{status:429,code:-1003,retryAt:h.exchange.now+60000});return mode();};
 h.exchange.now+=6000;await h.engine.tick();assert.equal(h.engine.bot(h.id).runtime.runEnabled,true);await h.engine.tick();assert.equal(calls,1);assert.equal(h.exchange.calls.length,0);
 h.exchange.now+=61000;fail=false;await h.engine.tick();assert.equal(h.engine.storage.fault,null);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});
test('recovery completion is not announced if its final journal commit fails',async()=>{
 const h=await harness(),save=h.store.save.bind(h.store);await h.engine.startBot(h.id);h.store.fail=true;await assert.rejects(()=>h.engine.checkpoint(),e=>e.storage);h.store.fail=false;let fail=true;
 h.store.save=async()=>{if(fail&&h.store.state.storageHealth?.recoveredAt){fail=false;throw Object.assign(Error('full'),{code:'ENOSPC'});}return save();};
 h.exchange.now+=6000;await h.engine.tick();assert.equal(h.engine.tradingEnabled,false);assert.equal(h.engine.snapshot().storageFault.phase,'saving');assert.equal(h.store.state.logs.filter(l=>l.title==='원장 저장 복구').length,0);assert.equal(h.exchange.calls.length,0);
 h.exchange.now+=6000;await h.engine.tick();assert.equal(h.engine.storage.fault,null);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});

test('a failed exit-fill save recovers the close exactly once and does not reopen a steady entry signal',async()=>{
 const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();const b=h.engine.bot(h.id);b.actionRules.push(makeActionRule({action:'CLOSE_ALL',sizePercent:100,formula:'TRUE@1m',formulaVersion:2,order:{type:'MARKET',price:'bid',ticks:0,timeout:10,remainder:'cancel',postOnly:false}}));await h.engine.checkpoint();
 const save=h.store.save.bind(h.store);let fail=true;h.store.save=async()=>{if(fail&&h.store.state.orders.some(o=>o.role==='exit'&&o.status==='FILLED')){fail=false;throw Object.assign(Error('full'),{code:'ENOSPC'});}return save();};
 await assert.rejects(()=>h.engine.tick(),e=>e.storage);assert.equal(h.exchange.quantity,0);h.exchange.now+=6000;await h.engine.tick();await h.engine.tick();assert.equal(h.engine.storage.fault,null);assert.equal(h.engine.bot(h.id).runtime.quantity,0);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);assert.equal(h.store.state.fills.filter(f=>f.role==='exit').length,1);
});
test('failed connection-state persistence leaves the working client and account binding intact',async()=>{
 const h=await harness(),client=h.engine.client,scope=h.engine.state.scope,connectionId=h.engine.connectionId;h.store.fail=true;
 await assert.rejects(()=>h.engine.connect({environment:'testnet',apiKey:'other-key-1234567890',secret:'other-secret-1234567890',allowTrading:true}),e=>e.storage);assert.equal(h.engine.client,client);assert.equal(h.engine.connectionId,connectionId);assert.equal(h.engine.state.scope,scope);
 h.store.fail=false;h.exchange.now+=6000;await h.engine.tick();assert.equal(h.engine.storage.fault,null);assert.equal(h.engine.state.scope,scope);assert.equal(h.engine.bot(h.id).runtime.runEnabled,false);
});

test('disconnect requested during a failing final write never restores order permission',async()=>{
 const h=await harness();h.store.fail=true;await assert.rejects(()=>h.engine.disconnect(),e=>e.storage);assert.equal(h.engine.connected,false);
 h.store.fail=false;h.exchange.now+=6000;await h.engine.tick();assert.equal(h.engine.storage.fault,null);assert.equal(h.engine.tradingEnabled,false);assert.equal(h.engine.snapshot().orderPermission.enabled,false);
});

test('recovery can reconnect the same saved account read-only before verifying owned exposure',async()=>{
 const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();h.store.fail=true;await assert.rejects(()=>h.engine.checkpoint(),e=>e.storage);h.store.fail=false;h.engine.connected=false;
 h.engine.credentialStore={async load(){return {environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890'};}};
 h.exchange.now+=6000;await h.engine.tick();assert.equal(h.engine.storage.fault,null);assert.equal(h.engine.connected,true);assert.equal(h.engine.tradingEnabled,true);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});

test('leveraged TP/SL translates ROI to the same native trigger for long and short and retains legacy price percentages',()=>{
 const fine={...info,filters:info.filters.map(f=>f.filterType==='PRICE_FILTER'?{...f,tickSize:'0.01'}:f)},exit={basis:'leveraged',takeProfit:5,stopLoss:5,price:'MARK_PRICE'},b={...makeBot(),leverage:20,exit};
 for(const direction of ['LONG','SHORT']){const orders=protectiveOrders({...b,direction},fine,'1',100),stop=orders.find(p=>p.role==='stop'),take=orders.find(p=>p.role==='take');assert.equal(take.parameters.triggerPrice,direction==='LONG'?'100.25':'99.75');assert.equal(stop.parameters.triggerPrice,direction==='LONG'?'99.75':'100.25');}
 const price={...exit};delete price.basis;assert.equal(protectiveOrders({...b,direction:'LONG',exit:price},fine,'1',100).find(p=>p.role==='take').parameters.triggerPrice,'105');
 assert.throws(()=>protectiveOrders({...b,direction:'LONG',leverage:0},fine,'1',100),/레버리지/);
});
test('leveraged software protection closes only at the requested return for each direction and enabled side',async()=>{
 for(const direction of ['LONG','SHORT'])for(const kind of ['takeProfit','stopLoss']){
  const h=await actionHarness([marketRule('ENTER_'+direction,'TRUE',{leverage:20})]),b=h.engine.bot(h.id);await h.engine.saveBot({...b,exit:{basis:'leveraged',price:'MARK_PRICE',takeProfit:10,stopLoss:10,takeProfitEnabled:kind==='takeProfit',stopLossEnabled:kind==='stopLoss'}});
  await h.engine.startBot(h.id);await h.engine.tick();assert.equal(h.engine.bot(h.id).leverage,20);
  const sign=(direction==='LONG'?1:-1)*(kind==='takeProfit'?1:-1);let price=100+sign*.2;h.engine.client.premium=async()=>({markPrice:String(price)});await h.engine.tick();assert.notEqual(h.exchange.quantity,0);
  price=100+sign*.6;await h.engine.tick();assert.equal(h.exchange.quantity,0);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);
 }
});
test('saved price basis applies guards only after explicit start and persists after restart',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG','TRUE',{leverage:20})]),b=h.engine.bot(h.id);delete b.exit.basis;await h.engine.startBot(h.id);await h.engine.tick();const before=h.exchange.calls.filter(c=>c.method==='placeAlgo').length,qty=h.exchange.quantity;
 await h.engine.saveBot({...h.engine.bot(h.id),exit:{...b.exit,basis:'price'}});await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeAlgo').length,before);
 await h.engine.saveBot({...h.engine.bot(h.id),exit:{...b.exit,basis:'leveraged',takeProfit:10,stopLoss:10}});await h.engine.startBot(h.id);await h.engine.tick();
 const active=[...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW');assert.deepEqual(active.map(o=>o.triggerPrice).sort(),['100.5','99.5']);assert.equal(h.exchange.quantity,qty);
 const restored=await new TradingEngine(new MemoryStore(h.store.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();assert.equal(restored.bot(h.id).exit.basis,'leveraged');assert.equal(restored.bot(h.id).runtime.runEnabled,false);
});

test('calendar exits wait for explicit restart when the bot is stopped',async()=>{
 const entry=marketRule('ENTER_LONG','TRUE',{formula:'요일() = 월요일 AND 시간범위(900, 1000)'}),exit=marketRule('EXIT_LONG','TRUE',{formula:'시각() >= 901'}),h=await actionHarness([entry,exit]);
 h.exchange.now=Date.parse('2026-01-04T23:59:59Z');await h.engine.startBot(h.id);await h.engine.tick();assert.equal(h.exchange.quantity,0);
 h.exchange.now=Date.parse('2026-01-05T00:00:00Z');await h.engine.tick();assert.ok(h.exchange.quantity>0);
 await h.engine.pauseBot(h.id);const held=h.exchange.quantity;h.exchange.now=Date.parse('2026-01-05T00:01:00Z');await h.engine.tick();assert.equal(h.exchange.quantity,held);assert.equal(h.engine.bot(h.id).runtime.runEnabled,false);await h.engine.startBot(h.id);await h.engine.tick();assert.equal(h.exchange.quantity,0);
});

test('single-bot calendar evaluates current clock instead of a reused snapshot time',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG','TRUE',{formula:'시각() >= 901'})]);h.exchange.now=Date.parse('2026-01-05T00:00:00Z');await h.engine.startBot(h.id);
 const bot=h.engine.bot(h.id),snapshots=await h.engine.formulaMarkets(bot.symbol,bot.actionRules[0].formula);h.engine.formulaMarkets=async()=>snapshots;h.exchange.now+=60000;
 assert.equal((await h.engine.evaluateRules(bot))[0].ready,true);
});

async function delayedCloseHarness(){
 const exit=marketRule('EXIT_LONG','종가 > 100',{order:{type:'LIMIT',price:'ask',ticks:0,timeout:600,remainder:'cancel',postOnly:true}}),h=await actionHarness([marketRule('ENTER_LONG'),exit]),b=h.engine.bot(h.id);
 b.exit={takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'};await h.engine.startBot(h.id);await h.engine.tick();
 h.engine.client.transport={mode:'websocket',restIntervalSeconds:15};h.engine.client.userStream={status:'connected',revision:0};h.engine.client.accountRevision=0;
 h.exchange.signalClose=101;h.exchange.now+=1000;await h.engine.tick();await h.engine.tick();
 const order=h.engine.ownOrders(b).find(o=>o.role==='exit');assert.equal(order.status,'NEW');
 return {...h,b,order};
}
test('missing private fill notifications reconcile the owned exit before a false position mismatch pause',async()=>{
 const h=await delayedCloseHarness(),original=h.b.runtime.quantity;h.exchange.fill(h.order.id,original);h.exchange.now+=1000;await h.engine.refreshAccount(true);
 await h.engine.tick();assert.equal(h.order.status,'FILLED');assert.equal(h.b.runtime.quantity,0);assert.equal(h.b.runtime.runEnabled,true);assert.equal(h.b.runtime.syncHold,false);assert.equal(h.b.runtime.error,null);
 const count=h.exchange.calls.filter(c=>c.method==='placeOrder').length;h.exchange.now+=20000;await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,count);assert.equal(h.engine.state.fills.filter(f=>f.role==='exit').length,1);
});
test('partial and final owned fills reconcile independently inside the normal polling interval',async()=>{
 const h=await delayedCloseHarness(),original=h.b.runtime.quantity;h.exchange.fill(h.order.id,original/2);h.exchange.now+=1000;await h.engine.refreshAccount(true);await h.engine.tick();
 assert.ok(Math.abs(h.b.runtime.quantity-original/2)<1e-8);assert.equal(h.order.status,'PARTIALLY_FILLED');assert.equal(h.b.runtime.syncHold,false);assert.equal(h.b.runtime.runEnabled,true);
 h.exchange.fill(h.order.id,original);h.exchange.now+=1000;await h.engine.refreshAccount(true);await h.engine.tick();assert.equal(h.b.runtime.quantity,0);assert.equal(h.order.status,'FILLED');assert.equal(h.b.runtime.runEnabled,true);assert.equal(h.engine.state.fills.filter(f=>f.role==='exit').length,2);
});
test('a stale account read is refreshed before pausing a correctly tracked held position',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();
 h.engine.accountSnapshot={...h.engine.accountSnapshot,positions:[]};await h.engine.syncBotPosition(b,true);assert.equal(b.runtime.syncHold,false);assert.equal(b.runtime.runEnabled,true);assert.ok(b.runtime.quantity>0);
});
test('an unexplained external close stays blocked, with bounded reconciliation reads instead of adopting the account quantity',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();const owned=b.runtime.quantity;
 h.engine.client.transport={mode:'websocket'};h.engine.client.userStream={status:'connected'};h.exchange.quantity=0;await h.engine.refreshAccount(true);
 let reads=0;const positions=h.engine.client.positions.bind(h.engine.client);h.engine.client.positions=async()=>{reads++;return positions();};const began=h.exchange.now;
 for(let sec=1;sec<=4;sec++){h.exchange.now=began+sec*1000;await h.engine.tick();}
 assert.equal(reads,1);assert.equal(b.runtime.syncHold,true);assert.equal(b.runtime.quantity,owned);
 h.exchange.now=began+18000;await h.engine.tick();assert.equal(reads,2);assert.equal(b.runtime.runEnabled,false);assert.match(b.runtime.error,/거래소 포지션/);assert.equal(b.runtime.quantity,owned);
});
test('unknown order acceptance cannot release a mismatch or resend the entry',async()=>{
 const h=await delayedCloseHarness(),owned=h.b.runtime.quantity,count=h.exchange.calls.filter(c=>c.method==='placeOrder').length;h.exchange.quantity=0;h.exchange.orders.delete(h.order.id);h.order.status='UNKNOWN';h.exchange.now+=1000;await h.engine.refreshAccount(true);await h.engine.tick();
 assert.equal(h.b.runtime.syncHold,true);assert.equal(h.order.status,'UNKNOWN');assert.equal(h.b.runtime.quantity,owned);
 h.exchange.now+=16000;await h.engine.tick();assert.equal(h.b.runtime.runEnabled,false);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,count);
});
test('a rate limit during mismatch reconciliation waits and later records the fill once without a permanent stop',async()=>{
 const h=await delayedCloseHarness(),owned=h.b.runtime.quantity,query=h.engine.client.queryOrder.bind(h.engine.client);h.exchange.fill(h.order.id,owned);h.exchange.now+=1000;await h.engine.refreshAccount(true);let fail=true;
 h.engine.client.queryOrder=async(...args)=>{if(fail)throw new BinanceError('slow down',{code:-1003,status:429,retryAt:h.exchange.now+5000});return query(...args);};
 await h.engine.tick();assert.equal(h.b.runtime.runEnabled,true);assert.equal(h.engine.waiting.kind,'rate-limit');
 fail=false;h.exchange.now+=6000;await h.engine.tick();assert.equal(h.b.runtime.quantity,0);assert.equal(h.b.runtime.syncHold,false);assert.equal(h.b.runtime.runEnabled,true);assert.equal(h.b.runtime.error,null);assert.equal(h.engine.state.fills.filter(f=>f.role==='exit').length,1);
});
test('an old mismatch warning clears after a confirmed flat match without restarting a stopped bot or clearing unrelated errors',async()=>{
 const h=await harness(),b=h.engine.bot(h.id);Object.assign(b.runtime,{quantity:0,runEnabled:false,syncHold:true,mismatchSince:h.exchange.now-60000,error:'거래소 포지션과 봇 체결 원장이 다릅니다. 수동 거래·다른 봇의 포지션을 자동 인수하지 않습니다.'});
 await h.engine.tick();assert.equal(b.runtime.syncHold,false);assert.equal(b.runtime.error,null);assert.equal(b.runtime.runEnabled,false);assert.equal(h.exchange.calls.length,0);
 Object.assign(b.runtime,{syncHold:true,error:'주문 접수 여부 확인 필요'});await h.engine.tick();assert.equal(b.runtime.error,'주문 접수 여부 확인 필요');assert.equal(b.runtime.runEnabled,false);
});

test('current-return predicates combine TP and SL using held leverage and mark even when candle prices do not change',async()=>{
 for(const direction of ['LONG','SHORT'])for(const mode of ['take','stop']){
  const entry=marketRule('ENTER_'+direction,'TRUE',{leverage:20}),exit=marketRule('EXIT_'+direction,'TRUE',{formula:'현재수익률() >= 10 OR 현재수익률() <= -5'}),h=await actionHarness([entry,exit]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};let mark=100;
  h.engine.client.premium=async()=>({markPrice:String(mark)});await h.engine.startBot(h.id);await h.engine.tick();assert.ok(Math.abs(h.exchange.quantity)>0);
  const sign=direction==='LONG'?1:-1;mark=mode==='take'?100+sign*.49:100-sign*.24;h.exchange.now+=1000;await h.engine.tick();assert.ok(Math.abs(h.exchange.quantity)>0);
  mark=mode==='take'?100+sign*.5:100-sign*.25;h.exchange.now+=1000;await h.engine.tick();assert.equal(h.exchange.quantity,0);assert.equal(h.engine.ownOrders(b).filter(o=>o.role==='exit').length,1);assert.equal(b.runtime.error,null);
 }
});

async function capacityHolding(direction='LONG',exitPercent=100){
 const entry=marketRule('ENTER_'+direction,'TRUE',{sizePercent:100,leverage:3,reentry:{mode:'cooldown',cooldown:0,afterExitCooldown:0}}),exit=marketRule('EXIT_'+direction,'종가 > 100',{sizePercent:exitPercent}),h=await actionHarness([entry,exit]),b=h.engine.bot(h.id);
 b.budget=40;b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();
 h.engine.state.dataTransport={mode:'websocket',restIntervalSeconds:15};h.engine.client.transport={mode:'websocket'};h.engine.client.userStream={status:'connected'};h.engine.client.accountRevision=0;
 h.exchange.now+=1000;await h.engine.tick();assert.ok(b.runtime.entryBlocked);return {...h,b,entry,exit};
}
test('minimum-size add-ons wait without stopping long or short bots or consuming their rule signal',async()=>{
 for(const direction of ['LONG','SHORT']){
  const h=await capacityHolding(direction),r=h.b.runtime,quantity=r.quantity,calls=h.exchange.calls.filter(c=>c.method==='placeOrder').length,signal={...r.ruleSignals[h.entry.id]};
  assert.equal(r.runEnabled,true);assert.equal(r.error,null);assert.equal(r.entryBlocked.reason,'min-notional');assert.equal(r.lastEvaluation.budgetBlocked,true);
  h.exchange.now+=1000;await h.engine.tick();assert.equal(r.quantity,quantity);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,calls);assert.equal(r.ruleSignals[h.entry.id].lastExecutionAt,signal.lastExecutionAt);assert.equal(r.ruleSignals[h.entry.id].lastBar,signal.lastBar);
  assert.equal(h.store.state.bots.find(b=>b.id===h.id).runtime.entryBlocked.reason,'min-notional');
 }
});
test('budget waits throttle forced account reads and duplicate logs while preserving condition monitoring',async()=>{
 const h=await capacityHolding(),began=h.exchange.now,account=h.engine.client.account.bind(h.engine.client);let reads=0;h.engine.client.account=async()=>{reads++;return account();};
 const logs=h.engine.state.logs.filter(l=>l.title==='진입 대기').length;
 for(let second=1;second<=10;second++){h.exchange.now=began+second*1000;await h.engine.tick();}
 assert.equal(reads,0);h.exchange.now=began+16000;await h.engine.tick();assert.equal(reads,1);assert.equal(h.b.runtime.runEnabled,true);assert.equal(h.b.runtime.error,null);assert.equal(h.engine.state.logs.filter(l=>l.title==='진입 대기').length,logs);
});
test('a full-capacity imported position waits without sending an entry or stopping management',async()=>{
 const h=await harness();h.exchange.quantity=30;const plan=await h.engine.positionImports.preview({positionKey:'BTCUSDT:LONG',botId:h.id});await h.engine.positionImports.commit(plan.id);await h.engine.startBot(h.id);await h.engine.tick();
 const b=h.engine.bot(h.id);assert.equal(b.runtime.entryBlocked.reason,'no-margin');assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,0);
});
test('exit rules execute during entry waits and a partial close makes new capacity usable automatically',async()=>{
 for(const percentage of [100,50]){
  const h=await capacityHolding('LONG',percentage),original=h.b.runtime.quantity;h.exchange.signalClose=101;h.exchange.now+=1000;await h.engine.tick();
  assert.equal(h.b.runtime.runEnabled,true);assert.equal(h.b.runtime.error,null);assert.equal(h.engine.ownOrders(h.b).filter(o=>o.role==='exit').length,1);
  if(percentage===100){assert.equal(h.b.runtime.quantity,0);assert.equal(h.b.runtime.entryBlocked,null);}
  else {assert.ok(h.b.runtime.quantity<original);const after=h.b.runtime.quantity;h.exchange.signalClose=100;h.exchange.now+=1000;await h.engine.tick();assert.ok(h.b.runtime.quantity>after);assert.equal(h.b.runtime.entryBlocked,null);}
 }
});
test('available margin returning restarts a waiting signal without a bot restart',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);
 const account=h.engine.client.account.bind(h.engine.client);let available=0;h.engine.client.account=async()=>{const value=await account();value.assets[0].availableBalance=String(available);return value;};
 await h.engine.refreshAccount(true);await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.entryBlocked.reason,'no-margin');assert.equal(h.exchange.quantity,0);
 available=4000;h.exchange.now+=1000;await h.engine.refreshAccount(true);await h.engine.tick();assert.ok(h.exchange.quantity>0);assert.equal(b.runtime.entryBlocked,null);assert.equal(b.runtime.error,null);
});
test('capacity disappearing between preflight and submission cannot pause the bot or consume a signal',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);
 const account=h.engine.client.account.bind(h.engine.client);h.engine.client.account=async()=>{const value=await account();value.assets[0].availableBalance='0';return value;};
 await h.engine.tick();assert.equal(h.exchange.quantity,0);assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.equal(b.runtime.entryBlocked.reason,'no-margin');assert.equal(b.runtime.ruleSignals[b.actionRules[0].id].fired,false);
});
test('market remainder fallback that has no margin ends the remainder without stopping the bot',async()=>{
 const entry=marketRule('ENTER_LONG','TRUE',{order:{type:'LIMIT',price:'bid',ticks:0,timeout:1,remainder:'market',postOnly:true}}),h=await actionHarness([entry]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();
 const order=h.engine.ownOrders(b).find(o=>o.role==='entry'),account=h.engine.client.account.bind(h.engine.client);h.engine.client.account=async()=>{const value=await account();value.assets[0].availableBalance='0';return value;};
 h.exchange.now+=2000;await h.engine.tick();assert.equal(order.status,'CANCELED');assert.equal(order.fallbackDone,true);assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});
test('a condition clearing removes an entry wait and user pause never auto-resumes',async()=>{
 const h=await capacityHolding();h.b.actionRules[0].formula='(종가 < 100)@15m';h.exchange.signalClose=100;h.exchange.now+=1000;await h.engine.tick();assert.equal(h.b.runtime.entryBlocked,null);
 h.b.actionRules[0].formula='TRUE@15m';h.exchange.now+=1000;await h.engine.tick();assert.ok(h.b.runtime.entryBlocked);await h.engine.pauseBot(h.id);assert.equal(h.b.runtime.entryBlocked,null);h.exchange.now+=30000;await h.engine.tick();assert.equal(h.b.runtime.runEnabled,false);
});
test('real exchange rejections, malformed plans and maximum quantity breaches remain errors',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]);await h.engine.startBot(h.id);h.engine.client.placeOrder=async()=>{throw new BinanceError('genuine rejection',{code:-2010});};await h.engine.tick();assert.equal(h.engine.bot(h.id).runtime.runEnabled,false);assert.match(h.engine.bot(h.id).runtime.error,/genuine rejection/);
 const invalid={...makeBot({budget:100}),used:0,reserved:0};assert.throws(()=>entryOrder({...invalid,used:NaN},info,{bids:[['100','1']],asks:[['100','1']]},100),/계산 값/);
 const smallMax=structuredClone(info);for(const f of smallMax.filters.filter(f=>f.filterType==='MARKET_LOT_SIZE'||f.filterType==='LOT_SIZE'))f.maxQty='.001';
 assert.throws(()=>entryOrder(invalid,smallMax,{bids:[['100','1']],asks:[['100','1']]},100),/최대 주문 수량/);
});

test('a 20x bot can fill two entries then wait on sub-lot dust instead of creating an invalid third order',async()=>{
 const entry=marketRule('ENTER_SHORT','TRUE',{sizePercent:100,leverage:20,reentry:{mode:'cooldown',cooldown:0,afterExitCooldown:0}}),h=await actionHarness([entry]),b=h.engine.bot(h.id);b.budget=40;b.exit={takeProfitEnabled:false,stopLossEnabled:false};
 await h.engine.startBot(h.id);for(let n=0;n<3;n++){h.exchange.now+=1000;await h.engine.tick();}
 assert.equal(b.runtime.entries,2);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);assert.equal(b.runtime.entryBlocked.reason,'min-quantity');assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.ok(h.exchange.quantity<0);
});

test('statistics reset preserves the trading ledger and loss-adjusted capital and survives a subsequent save',async()=>{
 const h=await harness();await h.engine.saveBot({...h.engine.bot(h.id),budgetMode:'pnl'});const b=h.engine.bot(h.id);b.runtime.realized=-25;
 h.engine.state.fills.push({id:'old-fee',scope:h.engine.state.scope,botId:b.id,symbol:b.symbol,fee:.2,feeAsset:'USDT',at:h.exchange.now-100});await h.engine.checkpoint();
 const oldLedger=structuredClone({fills:h.engine.state.fills,orders:h.engine.state.orders}),before=h.engine.decorate(b).effectiveBudget,view=await h.engine.resetBotStatistics(b.id);
 assert.equal(view.runtime.realized,-25);assert.equal(view.effectiveBudget,before);assert.equal(view.statsReset.realized,-25);assert.equal(view.statsReset.at,h.exchange.now);assert.equal(view.fees,0);assert.equal(view.runtime.runEnabled,false);assert.deepEqual({fills:h.engine.state.fills,orders:h.engine.state.orders},oldLedger);assert.equal(h.exchange.calls.length,0);assert.equal(h.exchange.mutations.length,0);
 const saved=await h.engine.saveBot({...view,statsReset:{at:1,realized:500},runtime:{quantity:99}});assert.deepEqual(saved.statsReset,view.statsReset);assert.equal(saved.runtime.realized,-25);assert.equal(saved.runtime.quantity,0);
 const restarted=await new TradingEngine(h.store,{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();assert.deepEqual(restarted.bot(b.id).statsReset,view.statsReset);
});
test('statistics reset refuses running bots, held or external positions, uncertain orders and offline accounts',async()=>{
 const h=await harness(),b=h.engine.bot(h.id);b.runtime.runEnabled=true;await assert.rejects(()=>h.engine.resetBotStatistics(b.id),/정지/);b.runtime.runEnabled=false;b.runtime.quantity=1;await assert.rejects(()=>h.engine.resetBotStatistics(b.id),/보유/);b.runtime.quantity=0;
 h.exchange.quantity=1;await assert.rejects(()=>h.engine.resetBotStatistics(b.id),/실제 보유/);h.exchange.quantity=0;
 h.engine.state.orders.push({id:'unknown',scope:h.engine.state.scope,botId:b.id,status:'UNKNOWN',parameters:{symbol:b.symbol,type:'MARKET'}});await assert.rejects(()=>h.engine.resetBotStatistics(b.id),/미해결/);h.engine.state.orders.pop();
 h.exchange.orders.set('outside',{symbol:b.symbol,status:'NEW',clientOrderId:'outside'});await assert.rejects(()=>h.engine.resetBotStatistics(b.id),/미체결/);h.exchange.orders.clear();
 h.engine.connected=false;await assert.rejects(()=>h.engine.resetBotStatistics(b.id),/계좌/);assert.equal(b.statsReset,null);assert.equal(h.exchange.calls.length,0);assert.equal(h.exchange.mutations.length,0);
});

test('saving a copy never inherits exposure and still rejects competing ownership on start',async()=>{const {copyBotSettings}=await import('../public/bot-tools.js'),h=await harness(),original=h.engine.bot(h.id);Object.assign(original.runtime,{runEnabled:true,quantity:2,entryPrice:100,direction:'LONG',realized:10});h.exchange.quantity=2;const copied=await h.engine.saveBot(copyBotSettings(h.engine.decorate(original)));assert.equal(copied.runtime.quantity,0);assert.equal(copied.runtime.realized,0);assert.equal(copied.runtime.runEnabled,false);assert.equal(original.runtime.quantity,2);assert.equal(original.runtime.runEnabled,true);await assert.rejects(()=>h.engine.startBot(copied.id),/보관/);await h.engine.serial(()=>h.engine.budgetSelection.set(copied.id,true));await assert.rejects(()=>h.engine.startBot(copied.id),/한 봇/);assert.equal(h.exchange.calls.length,0);});

test('past cancel-only orders allow statistics reset while an unconsumed market fallback still blocks it',async()=>{const h=await harness(),b=h.engine.bot(h.id),o={id:'past-limit',scope:h.engine.state.scope,botId:b.id,status:'CANCELED',appliedQty:0,parameters:{symbol:b.symbol,type:'LIMIT'},orderPolicy:{remainder:'cancel'}};h.engine.state.orders.push(o);await h.engine.resetBotStatistics(b.id);h.exchange.now++;o.orderPolicy.remainder='market';await assert.rejects(()=>h.engine.resetBotStatistics(b.id),/미해결/);assert.equal(b.statsReset.at,h.exchange.now-1);assert.equal(h.exchange.calls.length,0);});

async function externalCloseHarness(direction='LONG'){
 const h=await actionHarness([marketRule('ENTER_'+direction)]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();const original=b.runtime.quantity,order=h.engine.ownOrders(b).find(o=>o.role==='entry'),at=h.exchange.now;
 const rows=[{symbol:b.symbol,id:1,orderId:order.orderId,positionSide:'BOTH',side:direction==='LONG'?'BUY':'SELL',qty:String(original),price:'100',realizedPnl:'0',commission:'0',commissionAsset:'USDT',time:at}],native=new Map();h.engine.client.trades=async(symbol,orderId)=>structuredClone(orderId==null?rows:rows.filter(t=>String(t.orderId)===String(orderId)));const query=h.engine.client.queryOrder.bind(h.engine.client);
 h.engine.client.queryOrder=async(symbol,id)=>typeof id==='object'&&native.has(String(id.orderId))?structuredClone(native.get(String(id.orderId))):query(symbol,id);
 const close=(qty,price=110,fee=.1)=>{h.exchange.now+=1000;const id=1000+native.size,side=direction==='LONG'?'SELL':'BUY',time=h.exchange.now,trade={symbol:b.symbol,id:100+rows.length,orderId:id,positionSide:'BOTH',side,qty:String(qty),price:String(price),realizedPnl:String((price-100)*qty*(direction==='LONG'?1:-1)),commission:String(fee),commissionAsset:'USDT',time};rows.push(trade);native.set(String(id),{symbol:b.symbol,orderId:id,clientOrderId:'outside-'+id,status:'FILLED',side,positionSide:'BOTH',reduceOnly:true,executedQty:String(qty),cumQuote:String(qty*price),type:'MARKET',time});h.exchange.quantity+=(direction==='LONG'?-1:1)*qty;h.engine.client.accountRevision=(h.engine.client.accountRevision||0)+1;return trade;};
 return {...h,b,original,rows,native,close};
}
test('external partial and full reductions reconcile native fees and preserve a running long or short bot without resending',async()=>{
 for(const direction of ['LONG','SHORT']){const h=await externalCloseHarness(direction),before=h.b.runtime.realized,calls=h.exchange.calls.length,part=h.original/2,first=h.close(part,110,.1);await h.engine.tick();assert.ok(Math.abs(h.b.runtime.quantity-part)<1e-8);assert.equal(h.b.runtime.runEnabled,true);assert.equal(h.b.runtime.error,null);assert.equal(h.b.runtime.syncHold,false);
 h.close(part,105,.2);await h.engine.tick();assert.equal(h.b.runtime.quantity,0);assert.equal(h.b.runtime.entries,0);assert.equal(h.b.runtime.runEnabled,true);assert.ok(Math.abs(h.b.runtime.realized-(before+part*15*(direction==='LONG'?1:-1)-.3))<1e-8);assert.equal(h.exchange.calls.length,calls);assert.equal(h.engine.state.fills.find(f=>f.role==='exit').at,first.time);
 await h.engine.tick();assert.equal(h.engine.state.orders.filter(o=>o.source==='exchange-close').length,2);assert.equal(h.exchange.calls.length,calls);}
});
test('an externally closed stopped bot clears its stale mismatch without claiming later manual cycles or restarting',async()=>{
 const h=await externalCloseHarness('SHORT');await h.engine.pauseBot(h.id);Object.assign(h.b.runtime,{syncHold:true,error:'거래소 포지션과 봇 체결 원장이 다릅니다. 수동 거래·다른 봇의 포지션을 자동 인수하지 않습니다.'});h.close(h.original,110,.25);h.rows.push({...h.rows[0],id:9001,orderId:9001,qty:'10',time:h.exchange.now+1},{...h.rows[0],id:9002,orderId:9002,side:'BUY',qty:'10',realizedPnl:'50',time:h.exchange.now+2});h.exchange.now+=100;await h.engine.tick();
 assert.equal(h.b.runtime.quantity,0);assert.equal(h.b.runtime.runEnabled,false);assert.equal(h.b.runtime.error,null);assert.equal(h.engine.state.orders.filter(o=>o.source==='exchange-close').length,1);assert.ok(Math.abs(h.b.runtime.realized-(-h.original*10-.25))<1e-8);
});
test('missing fees, incomplete history, mixed external entries and non-reduce-only orders cannot release a mismatch',async()=>{
 for(const mode of ['fees','missing-own','mixed-entry','not-reduce','pnl','capped','unknown']){const h=await externalCloseHarness(),t=h.close(h.original);await h.engine.pauseBot(h.id);if(mode==='fees')delete t.commission;if(mode==='missing-own')h.rows.shift();if(mode==='mixed-entry')h.rows.splice(1,0,{...t,id:999,orderId:999,side:'BUY',realizedPnl:'0',time:t.time-1});if(mode==='not-reduce')h.native.get(String(t.orderId)).reduceOnly=false;if(mode==='pnl')t.realizedPnl='900';if(mode==='capped')while(h.rows.length<1000)h.rows.push({...h.rows[0],id:10000+h.rows.length});if(mode==='unknown')h.engine.state.orders.push({id:'pending',botId:h.id,scope:h.engine.state.scope,status:'UNKNOWN',kind:'standard',parameters:{symbol:h.b.symbol,type:'MARKET'}});
 await h.engine.refreshAccount(true);await h.engine.syncBotPosition(h.b,true);assert.equal(h.b.runtime.quantity,h.original,mode);assert.equal(h.b.runtime.syncHold,true,mode);assert.equal(h.engine.state.orders.filter(o=>o.source==='exchange-close').length,0,mode);}
});
test('external reduction history retries are bounded and unrelated errors stay visible',async()=>{
 const h=await externalCloseHarness();h.exchange.quantity=0;await h.engine.pauseBot(h.id);let reads=0;h.engine.client.trades=async()=>{reads++;return [];};await h.engine.refreshAccount(true);for(let i=0;i<5;i++){await h.engine.syncBotPosition(h.b,true);h.exchange.now+=1000;}assert.equal(reads,1);h.exchange.now+=30000;await h.engine.syncBotPosition(h.b,true);assert.equal(reads,2);
 h.b.runtime.error='보호 주문 거절';h.close(h.original);h.exchange.quantity=0;h.exchange.now+=30000;await h.engine.positionReconciliation.reconcile(h.b,'거래소 포지션과 봇 체결 원장이 다릅니다. 수동 거래·다른 봇의 포지션을 자동 인수하지 않습니다.');assert.equal(h.b.runtime.error,'보호 주문 거절');assert.equal(h.b.runtime.quantity,h.original);
});
test('rate-limited external-close history resumes and records the confirmed reduction once',async()=>{
 const h=await externalCloseHarness();h.close(h.original,110,.1);const load=h.engine.client.trades;let blocked=true;h.engine.client.trades=async(...args)=>{if(blocked)throw new BinanceError('slow down',{code:-1003,status:429,retryAt:h.exchange.now+5000});return load(...args);};await h.engine.tick();assert.equal(h.b.runtime.runEnabled,true);assert.equal(h.engine.waiting.kind,'rate-limit');blocked=false;h.exchange.now+=6000;await h.engine.tick();assert.equal(h.b.runtime.quantity,0);assert.equal(h.b.runtime.error,null);assert.equal(h.engine.state.orders.filter(o=>o.source==='exchange-close').length,1);
});

test('legacy externally closed holdings migrate to sharing without claiming a later manual position',async()=>{const h=await externalCloseHarness('SHORT');await h.engine.pauseBot(h.id);h.close(h.original,110,.1);h.rows.push({...h.rows[0],id:9001,orderId:9001,side:'BUY',qty:'10',price:'100',time:h.exchange.now+1});h.exchange.quantity=10;h.exchange.now+=100;h.engine.client.tradesAfter=async(s,id)=>h.rows.filter(t=>Number(t.id)>=id);await h.engine.refreshAccount(true);await h.engine.syncBotPosition(h.b,true);assert.equal(h.b.runtime.quantity,0);assert.equal(h.b.runtime.error,null);assert.equal(h.b.runtime.runEnabled,false);assert.equal(h.engine.shared.book(h.b.symbol).manual.LONG.quantity,10);});

const makerRule=(action='ENTER_LONG',formula='TRUE',extra={})=>marketRule(action,formula,{order:{type:'LIMIT',price:action==='ENTER_LONG'?'bid':'ask',ticks:0,timeout:2,remainder:'market',postOnly:true},...extra});
test('definite maker rejection keeps all reentry modes running and retries a fresh price without consuming the signal',async()=>{
 for(const mode of ['rearm','bar','cooldown']){
  const entry=makerRule('ENTER_LONG','TRUE',{reentry:{mode,cooldown:1,afterExitCooldown:0}}),h=await actionHarness([entry]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};
  const send=h.engine.client.placeOrder.bind(h.engine.client),attempts=[];h.engine.client.placeOrder=async p=>{attempts.push({...p});if(attempts.length===1)throw new BinanceError('Post Only rejected',{code:-5022,status:400});return send(p);};
  await h.engine.startBot(h.id);await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.equal(b.runtime.ruleSignals[entry.id].fired,false);assert.equal(b.runtime.lastEntryAt,0);assert.equal(b.runtime.entries,0);
  const rejected=h.engine.ownOrders(b)[0];assert.equal(rejected.status,'REJECTED');for(const state of h.store.saved.filter(s=>s.orders.some(o=>o.id===rejected.id&&o.status==='REJECTED')))assert.equal(state.bots.find(x=>x.id===b.id).runtime.ruleSignals[entry.id].fired,false);assert.equal(rejected.errorCode,-5022);assert.equal(rejected.appliedQty,0);assert.equal(rejected.fallbackDone,true);assert.equal(h.engine.decorate(b).reserved,0);assert.match(h.engine.decorate(b).runtime.orderRetry.label,/메이커/);
  h.exchange.now+=4999;await h.engine.tick();assert.equal(attempts.length,1);
  h.engine.client.book=async()=>({bids:[['99.5','10']],asks:[['99.6','10']]});h.exchange.now++;await h.engine.tick();assert.equal(attempts.length,2);assert.equal(attempts[1].price,'99.5');assert.equal(attempts[1].timeInForce,'GTX');assert.notEqual(attempts[0].newClientOrderId,attempts[1].newClientOrderId);
  assert.equal(h.engine.decorate(b).runtime.orderRetry,null);assert.equal(b.runtime.ruleSignals[entry.id].fired,true);assert.equal(h.engine.state.orders.filter(o=>o.parent===rejected.id).length,0);
  await h.engine.tick();assert.equal(attempts.length,2);
 }
});
test('maker retry backoff is bounded and repeated rejected orders never reserve capital or spam each tick',async()=>{
 const entry=makerRule(),h=await actionHarness([entry]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};let attempts=0;
 h.engine.client.placeOrder=async()=>{attempts++;throw new BinanceError('Post Only rejected',{code:-5022,status:400});};await h.engine.startBot(h.id);await h.engine.tick();
 for(const seconds of [5,10,20,30,30]){const r=b.runtime.orderRetries[entry.id];assert.equal(r.retryAt-h.exchange.now,seconds*1000);h.exchange.now=r.retryAt-1;await h.engine.tick();const before=attempts;h.exchange.now++;await h.engine.tick();assert.equal(attempts,before+1);}
 assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.equal(h.engine.decorate(b).reserved,0);assert.ok(h.engine.state.logs.filter(l=>l.title==='메이커 주문 재시도 대기').length<=3);
});
test('a false condition cancels a deferred maker attempt instead of sending at its deadline',async()=>{
 const entry=makerRule('ENTER_LONG','종가 > 99'),h=await actionHarness([entry]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};let attempts=0;
 h.engine.client.placeOrder=async()=>{attempts++;throw new BinanceError('maker',{code:-5022,status:400});};await h.engine.startBot(h.id);await h.engine.tick();h.exchange.signalClose=98;h.exchange.now+=6000;await h.engine.tick();
 assert.equal(attempts,1);assert.equal(b.runtime.runEnabled,true);assert.equal(h.engine.decorate(b).runtime.orderRetry,null);assert.equal(b.runtime.orderRetries[entry.id],undefined);
});
test('an exit maker retry retains the holding, blocks fresh entries and preserves the accepted limit timeout policy',async()=>{
 const entry=marketRule('ENTER_LONG','TRUE',{reentry:{mode:'cooldown',cooldown:0,afterExitCooldown:0}}),exit=makerRule('EXIT_LONG','종가 > 100'),h=await actionHarness([entry,exit]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();const held=b.runtime.quantity;
 const send=h.engine.client.placeOrder.bind(h.engine.client),attempts=[];let rejected=false;h.engine.client.placeOrder=async p=>{attempts.push({...p});if(p.side==='SELL'&&!rejected){rejected=true;throw new BinanceError('maker',{code:-5022,status:400});}return send(p);};
 h.exchange.signalClose=101;h.exchange.now+=1000;await h.engine.tick();assert.equal(b.runtime.quantity,held);assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);
 h.exchange.now+=4000;await h.engine.tick();assert.equal(attempts.length,1);assert.equal(b.runtime.quantity,held);
 h.exchange.now+=1000;await h.engine.tick();assert.equal(attempts.length,2);assert.equal(attempts[1].type,'LIMIT');
 h.exchange.now+=3000;await h.engine.tick();assert.equal(attempts.length,3);assert.equal(attempts[2].type,'MARKET');assert.equal(attempts[2].quantity,String(held));assert.equal(b.runtime.quantity,0);assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);
});
test('maker retry timestamps survive restart without an early resend',async()=>{
 const entry=makerRule(),h=await actionHarness([entry]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};h.engine.client.placeOrder=async()=>{throw new BinanceError('maker',{code:-5022,status:400});};
 await h.engine.startBot(h.id);await h.engine.tick();const recovered=await new TradingEngine(new MemoryStore(h.store.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});await recovered.startBot(h.id);await recovered.tick();assert.equal(h.exchange.calls.length,0);
 h.exchange.now+=5000;await recovered.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(recovered.bot(h.id).runtime.error,null);
});
test('an uncertain maker response still pauses and reconciles acceptance without resending',async()=>{
 const entry=makerRule(),h=await actionHarness([entry]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};const send=h.engine.client.placeOrder.bind(h.engine.client);
 h.engine.client.placeOrder=async p=>{await send(p);throw new BinanceError('unknown acceptance',{code:-5022,status:503,uncertain:true});};await h.engine.startBot(h.id);await h.engine.tick();const order=h.engine.ownOrders(b)[0];
 assert.equal(order.status,'UNKNOWN');assert.equal(order.errorKind,undefined);assert.equal(b.runtime.runEnabled,false);assert.equal(b.runtime.orderRetries?.[entry.id],undefined);
 h.exchange.fill(order.id,Number(order.parameters.quantity));h.exchange.now+=60000;await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(b.runtime.quantity,Number(order.parameters.quantity));
});

test('legacy confirmed maker errors clear on upgrade without starting bots or hiding unknown acceptance',async()=>{
 const h=await actionHarness([makerRule()]),b=h.engine.bot(h.id),message='Due to the order could not be executed as maker, the Post Only order will be rejected. The order will not be recorded in the order history';b.runtime.runEnabled=false;b.runtime.error='조건 주문이 거절되었습니다: '+message;
 h.engine.state.orders.push({id:'legacy-maker',botId:b.id,scope:h.engine.state.scope,kind:'standard',status:'REJECTED',error:message,appliedQty:0,parameters:{symbol:b.symbol,type:'LIMIT',timeInForce:'GTX'},fallbackDone:true,feesFetched:true});
 const state=structuredClone(h.store.state),recovered=await new TradingEngine(new MemoryStore(state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();assert.equal(recovered.bot(h.id).runtime.error,null);assert.equal(recovered.bot(h.id).runtime.runEnabled,false);assert.equal(h.exchange.calls.length,0);
 const unknown=structuredClone(state);unknown.orders.push({...unknown.orders[0],id:'unknown-order',status:'UNKNOWN'});const held=await new TradingEngine(new MemoryStore(unknown),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();assert.match(held.bot(h.id).runtime.error,/거절/);
 const mismatch=structuredClone(state);mismatch.bots[0].runtime.syncHold=true;const mismatched=await new TradingEngine(new MemoryStore(mismatch),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();assert.match(mismatched.bot(h.id).runtime.error,/거절/);
 const unrelated=structuredClone(state);unrelated.bots[0].runtime.error='포지션 수량 불일치';const preserved=await new TradingEngine(new MemoryStore(unrelated),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();assert.equal(preserved.bot(h.id).runtime.error,'포지션 수량 불일치');
});

test('non-shared partial closes apply the selected profit fraction once and later losses remain full',async()=>{
 const {engine,id}=await harness(),b=engine.bot(id);b.budget=200;b.budgetMode='pnl';b.profitReinvestPercent=50;Object.assign(b.runtime,{quantity:2,entryPrice:100,direction:'LONG'});
 const o={id:'reinvest-exit',scope:engine.state.scope,botId:id,kind:'standard',role:'exit',direction:'LONG',status:'NEW',appliedQty:0,appliedQuote:0,parameters:{symbol:'BTCUSDT',type:'LIMIT',side:'SELL',quantity:'2'}};engine.state.orders.push(o);
 await engine.applyOrder(b,o,{executedQty:'1',cumQuote:'200',status:'PARTIALLY_FILLED'});assert.equal(engine.decorate(b).effectiveBudget,250);
 await engine.applyOrder(b,o,{executedQty:'1',cumQuote:'200',status:'PARTIALLY_FILLED'});assert.equal(engine.decorate(b).effectiveBudget,250);
 await engine.applyOrder(b,o,{executedQty:'2',cumQuote:'260',status:'FILLED'});assert.equal(engine.decorate(b).effectiveBudget,210);assert.equal(b.runtime.realized,60);assert.equal(b.runtime.budgetWithheld,50);
});

const remainderExit=()=>marketRule('EXIT_LONG','종가 > 100',{order:{type:'LIMIT',price:'ask',ticks:0,timeout:2,remainder:'market',postOnly:false},reentry:{mode:'cooldown',cooldown:0,afterExitCooldown:0}});
test('a cancelled exit with an unconsumed remainder blocks a new limit exit and converts once',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),remainderExit()]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();h.exchange.signalClose=101;await h.engine.tick();const original=h.engine.ownOrders(b).find(o=>o.role==='exit');h.exchange.orders.get(original.id).status='CANCELED';h.exchange.now+=3000;await h.engine.tick();await h.engine.tick();const exits=h.exchange.calls.filter(c=>c.method==='placeOrder'&&c.parameters.side==='SELL');assert.deepEqual(exits.map(c=>c.parameters.type),['LIMIT','MARKET']);assert.equal(exits[1].parameters.quantity,original.parameters.quantity);assert.equal(original.fallbackDone,true);assert.equal(b.runtime.quantity,0);assert.equal(b.runtime.error,null);assert.equal(b.runtime.runEnabled,true);
});
test('a close that fills during cancellation never sends a market remainder',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),remainderExit()]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();h.exchange.signalClose=101;await h.engine.tick();const limit=h.engine.ownOrders(b).find(o=>o.role==='exit');h.engine.client.cancelOrder=async(s,id)=>{h.exchange.fill(id,Number(limit.parameters.quantity));return structuredClone(h.exchange.orders.get(id));};h.exchange.now+=3000;await h.engine.tick();await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);assert.equal(b.runtime.quantity,0);assert.equal(b.runtime.runEnabled,true);
});
function raceProtectiveFill(h){const b=h.engine.bot(h.id),stop=[...h.exchange.algos.values()].find(a=>a.type==='STOP_MARKET'),child={...stop,clientOrderId:'raced-protection',orderId:9876,origQty:String(b.runtime.quantity),executedQty:'0',cumQuote:'0',status:'NEW'};h.exchange.orders.set('raced-protection',child);h.exchange.fill('raced-protection',b.runtime.quantity);stop.actualOrderId=9876;stop.algoStatus='FINISHED';}
function rejectClose(h,before=()=>{}){const send=h.engine.client.placeOrder.bind(h.engine.client);h.engine.client.placeOrder=async p=>{if(p.reduceOnly==='true'){h.exchange.calls.push({method:'placeOrder',parameters:structuredClone(p)});before();throw new BinanceError('ReduceOnly Order is rejected.',{code:-2022,status:400});}return send(p);};}
test('a definite reduce-only rejection after a protective fill reconciles without stopping the bot',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),marketRule('EXIT_LONG','종가 > 100')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);await h.engine.tick();rejectClose(h,()=>raceProtectiveFill(h));h.exchange.signalClose=101;await h.engine.tick();await h.engine.tick();assert.equal(b.runtime.quantity,0);assert.equal(b.runtime.error,null);assert.equal(b.runtime.runEnabled,true);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);assert.equal(h.engine.ownOrders(b).find(o=>o.status==='REJECTED').errorKind,'reduce-only-resolved');
});
test('a reduce-only rejection with remaining holdings waits for reconciliation then retains a real error',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),marketRule('EXIT_LONG','종가 > 100')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);await h.engine.tick();rejectClose(h);h.exchange.signalClose=101;await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.ok(b.runtime.closeRecovery);await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);h.exchange.now+=16000;await h.engine.tick();assert.equal(b.runtime.runEnabled,false);assert.match(b.runtime.error,/ReduceOnly/);assert.ok(b.runtime.quantity>0);
});
test('a user stop aborts reduce-only recovery and removes untriggered guards',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),marketRule('EXIT_LONG','종가 > 100')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);await h.engine.tick();rejectClose(h);h.exchange.signalClose=101;await h.engine.tick();const held=b.runtime.quantity;await h.engine.pauseBot(h.id);raceProtectiveFill(h);h.exchange.now+=4000;await h.engine.tick();assert.equal(b.runtime.quantity,held);assert.equal(b.runtime.runEnabled,false);assert.equal(b.runtime.managementEnabled,false);assert.equal(b.runtime.closeRecovery,undefined);
});

test('an old-position exit remainder cannot close a later position',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();const q=b.runtime.quantity;h.engine.state.orders.push({id:'old-epoch',botId:b.id,scope:h.engine.state.scope,kind:'standard',role:'exit',direction:'LONG',positionEpoch:b.runtime.positionEpoch-1,status:'CANCELED',createdAt:h.exchange.now-20000,appliedQty:0,parameters:{symbol:b.symbol,type:'LIMIT',side:'SELL',quantity:String(q)},orderPolicy:{type:'LIMIT',timeout:1,remainder:'market'}});await h.engine.settlePending(b,info);assert.equal(h.engine.state.orders.at(-1).fallbackDone,true);assert.equal(h.exchange.quantity,q);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});
test('an existing close covering the position resolves reduce-only conflict without a duplicate',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),remainderExit()]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();h.exchange.signalClose=101;await h.engine.tick();const limit=h.engine.ownOrders(b).find(o=>o.role==='exit');rejectClose(h);const rejected=await h.engine.submit(b,{...limit.parameters,type:'MARKET'},{role:'exit',direction:'LONG'});assert.equal(rejected.errorKind,'reduce-only-resolved');assert.equal(rejected.closeResolution,'covered-by-existing-close');assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.equal(b.runtime.closeRecovery,undefined);assert.equal(b.runtime.quantity,Number(limit.parameters.quantity));
});

test('legacy overlapping exits settle the partially filled newer order without starving on the cancelled older one',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),remainderExit()]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();h.exchange.signalClose=101;await h.engine.tick();const older=h.engine.ownOrders(b).find(o=>o.role==='exit');h.exchange.orders.get(older.id).status='CANCELED';await h.engine.refreshOrder(b,older);const newer=await h.engine.submit(b,older.parameters,{role:'exit',direction:'LONG',orderPolicy:older.orderPolicy});h.exchange.fill(newer.id,Number(newer.parameters.quantity)/2);h.exchange.now+=3000;await h.engine.tick();await h.engine.tick();const exits=h.exchange.calls.filter(c=>c.method==='placeOrder'&&c.parameters.side==='SELL');assert.deepEqual(exits.map(c=>c.parameters.type),['LIMIT','LIMIT','MARKET']);assert.equal(exits[2].parameters.quantity,String(Number(older.parameters.quantity)/2));assert.equal(b.runtime.quantity,0);assert.equal(b.runtime.error,null);assert.equal(older.fallbackDone,true);
});

test('legacy flat reduce-only errors clear after restart without rearming a paused bot',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),marketRule('EXIT_LONG','종가 > 100')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);await h.engine.tick();rejectClose(h,()=>raceProtectiveFill(h));h.exchange.signalClose=101;await h.engine.tick();const order=h.engine.ownOrders(b).find(o=>o.status==='REJECTED');delete order.errorKind;b.runtime.error=order.error;b.runtime.runEnabled=false;
 const recovered=await new TradingEngine(new MemoryStore(h.engine.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();assert.ok(recovered.bot(h.id).runtime.closeRecovery);await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});const calls=h.exchange.calls.length;await recovered.tick();assert.equal(recovered.bot(h.id).runtime.error,null);assert.equal(recovered.bot(h.id).runtime.runEnabled,false);assert.equal(recovered.bot(h.id).runtime.quantity,0);assert.equal(h.exchange.calls.length,calls);
});
test('an unrelated error is not cleared by a historical reduce-only rejection',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),marketRule('EXIT_LONG','종가 > 100')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);await h.engine.tick();rejectClose(h,()=>raceProtectiveFill(h));h.exchange.signalClose=101;await h.engine.tick();b.runtime.error='unrelated account error';b.runtime.runEnabled=false;h.engine.closeRecovery.recoverLegacy();assert.equal(b.runtime.closeRecovery,undefined);assert.equal(b.runtime.error,'unrelated account error');
});
test('unknown acceptance is never treated as a definite reduce-only rejection',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),marketRule('EXIT_LONG','종가 > 100')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);await h.engine.tick();h.engine.client.placeOrder=async()=>{throw new BinanceError('acceptance unknown',{code:-2022,uncertain:true});};h.exchange.signalClose=101;await h.engine.tick();assert.equal(b.runtime.runEnabled,false);assert.equal(b.runtime.closeRecovery,undefined);assert.equal(h.engine.ownOrders(b).at(-1).status,'UNKNOWN');assert.ok(b.runtime.error);
});

function pendingNative(h,{kind='stopLoss',direction='LONG'}={}){const b=h.engine.bot(h.id),native=[...h.exchange.algos.values()].find(o=>o.type===(kind==='stopLoss'?'STOP_MARKET':'TAKE_PROFIT_MARKET')),id='native-delayed-'+h.exchange.next,order={...native,clientOrderId:id,orderId:h.exchange.next++,origQty:String(b.runtime.quantity),executedQty:'0',cumQuote:'0',status:'NEW'};h.exchange.orders.set(id,order);native.actualOrderId=order.orderId;native.algoStatus='TRIGGERING';return {id,order,native};}
async function closeWaitHarness(direction='LONG',kind='stopLoss'){const h=await actionHarness([marketRule('ENTER_'+direction)]);await h.engine.startBot(h.id);await h.engine.tick();const pending=pendingNative(h,{direction,kind}),sign=(direction==='LONG'?1:-1)*(kind==='stopLoss'?-1:1);h.engine.client.premium=async()=>({markPrice:String(100+sign*10)});return {...h,pending};}
test('native TP/SL trigger settlement never stops long or short bots or sends a duplicate market close',async()=>{for(const direction of ['LONG','SHORT'])for(const kind of ['stopLoss','takeProfit']){const h=await closeWaitHarness(direction,kind),b=h.engine.bot(h.id),q=b.runtime.quantity;await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.ok(b.runtime.closePending);assert.equal(b.runtime.waiting.kind,'order-settlement');for(let i=0;i<3;i++){h.exchange.now+=100;await h.engine.tick();}assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);h.exchange.fill(h.pending.id,q);h.pending.native.algoStatus='FINISHED';h.exchange.now+=4000;await h.engine.tick();assert.equal(b.runtime.quantity,0);assert.equal(b.runtime.error,null);assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.closePending,undefined);assert.equal(b.runtime.waiting,null);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);}});
test('delayed cancellation retains the close intent and sends one market close after confirmation even if price recovers',async()=>{const h=await actionHarness([marketRule('ENTER_LONG')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);await h.engine.tick();const cancel=h.engine.client.cancelAlgo.bind(h.engine.client);h.engine.client.cancelAlgo=async()=>({code:200});h.engine.client.premium=async()=>({markPrice:'80'});await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.ok(b.runtime.closePending);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);h.engine.client.premium=async()=>({markPrice:'100'});h.engine.client.cancelAlgo=cancel;h.exchange.now+=6000;await h.engine.tick();await h.engine.tick();assert.equal(b.runtime.quantity,0);assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.equal(b.runtime.closePending,undefined);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);});
test('a partial native protective fill waits for terminal status and closes only the confirmed remainder',async()=>{const h=await closeWaitHarness(),b=h.engine.bot(h.id),q=b.runtime.quantity;h.exchange.fill(h.pending.id,q/2);await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.ok(b.runtime.closePending);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);h.pending.order.status='CANCELED';h.pending.native.algoStatus='FINISHED';h.exchange.now+=4000;await h.engine.tick();const sent=h.exchange.calls.filter(c=>c.method==='placeOrder');assert.equal(sent.length,2);assert.equal(Number(sent[1].parameters.quantity),q/2);assert.equal(b.runtime.quantity,0);assert.equal(b.runtime.error,null);});
test('a user pause during protective settlement remains paused after the native close completes',async()=>{const h=await closeWaitHarness(),b=h.engine.bot(h.id);await h.engine.tick();await h.engine.pauseBot(h.id);h.exchange.fill(h.pending.id,b.runtime.quantity);h.pending.native.algoStatus='FINISHED';h.exchange.now+=4000;await h.engine.tick();assert.equal(b.runtime.runEnabled,false);assert.equal(b.runtime.error,null);assert.equal(b.runtime.closePending,undefined);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);});
test('pending native settlement survives restart without replacing a known in-flight close or auto-starting',async()=>{const h=await closeWaitHarness(),b=h.engine.bot(h.id);await h.engine.tick();const recovered=await new TradingEngine(new MemoryStore(h.engine.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});h.exchange.fill(h.pending.id,b.runtime.quantity);h.pending.native.algoStatus='FINISHED';h.exchange.now+=4000;await recovered.tick();assert.equal(recovered.bot(h.id).runtime.quantity,0);assert.equal(recovered.bot(h.id).runtime.error,null);assert.equal(recovered.bot(h.id).runtime.runEnabled,false);assert.equal(recovered.bot(h.id).runtime.closePending,undefined);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);});
test('legacy completed close-wait errors clear only after exchange reconciliation and leave manual start control intact',async()=>{const h=await closeWaitHarness(),b=h.engine.bot(h.id);h.exchange.fill(h.pending.id,b.runtime.quantity);h.pending.native.algoStatus='FINISHED';await h.engine.refreshOrder(b,h.engine.ownOrders(b).find(o=>o.kind==='algo'&&o.role==='stop'));await h.engine.refreshAccount(true);await h.engine.ensureGuards(b,info);b.runtime.runEnabled=false;b.runtime.error='기존 주문의 취소·체결 결과를 확인한 뒤 청산합니다.';const recovered=await new TradingEngine(new MemoryStore(h.engine.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});await recovered.tick();assert.equal(recovered.bot(h.id).runtime.error,null);assert.equal(recovered.bot(h.id).runtime.closePending,undefined);assert.equal(recovered.bot(h.id).runtime.runEnabled,false);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);});

test('a known triggering guard whose child order is not visible yet waits without an acceptance error',async()=>{const h=await closeWaitHarness(),b=h.engine.bot(h.id),query=h.engine.client.queryOrder.bind(h.engine.client);h.engine.client.queryOrder=async(s,id)=>{if(typeof id==='object'&&id.orderId===h.pending.order.orderId)throw new BinanceError('child not visible',{code:-2013});return query(s,id);};await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.ok(b.runtime.closePending);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);h.engine.client.queryOrder=query;h.exchange.fill(h.pending.id,b.runtime.quantity);h.pending.native.algoStatus='FINISHED';h.exchange.now+=4000;await h.engine.tick();assert.equal(b.runtime.error,null);assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.quantity,0);});
test('a previous full-close intent cannot cancel current-position guards or close a new position epoch',async()=>{const h=await closeWaitHarness(),b=h.engine.bot(h.id);await h.engine.tick();h.exchange.fill(h.pending.id,b.runtime.quantity);h.pending.native.algoStatus='FINISHED';await h.engine.refreshOrder(b,h.engine.ownOrders(b).find(o=>o.kind==='algo'&&o.role==='stop'));h.exchange.quantity=2;b.runtime.quantity=2;b.runtime.entryPrice=100;b.runtime.positionEpoch++;const calls=h.exchange.calls.length;h.exchange.now+=4000;await h.engine.tick();assert.equal(b.runtime.quantity,2);assert.equal(h.exchange.quantity,2);assert.equal(b.runtime.closePending,undefined);assert.equal(h.exchange.calls.length,calls);assert.equal(b.runtime.runEnabled,true);});

test('an accepted market full-close is journal-linked across restart and is never sent twice',async()=>{const h=await actionHarness([marketRule('ENTER_LONG')]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();const send=h.engine.client.placeOrder.bind(h.engine.client);let queued;h.engine.client.placeOrder=async p=>{if(p.reduceOnly!=='true')return send(p);h.exchange.calls.push({method:'placeOrder',parameters:structuredClone(p)});queued={...p,clientOrderId:p.newClientOrderId,orderId:h.exchange.next++,origQty:p.quantity,executedQty:'0',cumQuote:'0',status:'NEW'};h.exchange.orders.set(queued.clientOrderId,queued);return structuredClone(queued);};await h.engine.closePosition(b,'손절 조건');assert.ok(b.runtime.closePending);assert.ok(h.engine.ownOrders(b).some(o=>o.closeIntentId===b.runtime.closePending.id));const recovered=await new TradingEngine(new MemoryStore(h.engine.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});h.exchange.now+=4000;await recovered.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);assert.ok(recovered.bot(h.id).runtime.closePending);h.exchange.fill(queued.clientOrderId,Number(queued.origQty));h.exchange.now+=4000;await recovered.tick();assert.equal(recovered.bot(h.id).runtime.quantity,0);assert.equal(recovered.bot(h.id).runtime.closePending,undefined);assert.equal(recovered.bot(h.id).runtime.runEnabled,false);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);});

const deadlineEntry=()=>marketRule('ENTER_LONG','TRUE',{order:{type:'LIMIT',price:'bid',ticks:0,timeout:5,remainder:'market',postOnly:false}});
async function deadlineHarness(rules=[deadlineEntry()]){
 const h=await actionHarness(rules);const b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();return {...h,b,order:h.engine.ownOrders(b).find(o=>o.kind==='standard'&&o.role==='entry')};
}
test('an already expired entry is converted before slow fee-history and unrelated bot work',async()=>{
 const h=await deadlineHarness(),sent=[],start=h.order.createdAt,refresh=h.engine.refreshOrder.bind(h.engine);h.exchange.beforeSend=p=>sent.push({at:h.exchange.now,type:p.type});
 const fee={...structuredClone(h.order),id:'historical-fee',status:'FILLED',parameters:{...h.order.parameters,type:'MARKET'},orderId:7654,feesFetched:false,fallbackDone:true};h.engine.state.orders.unshift(fee);
 h.engine.refreshOrder=async(b,o,options)=>{if(o===fee){h.exchange.now+=20000;o.feesFetched=true;return;}return refresh(b,o,options);};h.exchange.now=start+5000;await h.engine.tick();
 assert.equal(sent.filter(p=>p.type==='MARKET').length,1);assert.equal(sent.find(p=>p.type==='MARKET').at,start+5000);assert.equal(h.order.timing.deadlineAt,start+5000);assert.equal(h.order.timing.timeoutCheckedAt,start+5000);assert.ok(h.order.timing.cancelConfirmedAt);assert.equal(h.b.runtime.runEnabled,true);
});
test('a deadline reached during background reads interrupts the remaining read batch',async()=>{
 const h=await deadlineHarness(),refresh=h.engine.refreshOrder.bind(h.engine),start=h.order.createdAt,sent=[];h.exchange.beforeSend=p=>sent.push({at:h.exchange.now,type:p.type});
 const fees=[1,2].map(n=>({...structuredClone(h.order),id:'old-fee-'+n,status:'FILLED',parameters:{...h.order.parameters,type:'MARKET'},orderId:8000+n,feesFetched:false,fallbackDone:true}));h.engine.state.orders.unshift(...fees);
 h.engine.refreshOrder=async(b,o,options)=>{if(fees.includes(o)){h.exchange.now+=o===fees[0]?6000:20000;o.feesFetched=true;return;}return refresh(b,o,options);};await h.engine.tick();
 assert.equal(sent.find(p=>p.type==='MARKET').at,start+6000);assert.equal(h.order.timing.timeoutCheckedAt,start+6000);assert.equal(sent.filter(p=>p.type==='MARKET').length,1);
});
test('REST market cadence does not delay the five-second order deadline',async()=>{
 const h=await deadlineHarness(),start=h.order.createdAt;h.engine.state.dataTransport={mode:'rest',restIntervalSeconds:15};h.engine.lastCycleAt=h.exchange.now;const last=h.engine.lastCycleAt;h.exchange.now=start+4999;await h.engine.timerCycle();assert.equal(h.exchange.calls.filter(c=>c.parameters.type==='MARKET').length,0);
 h.exchange.now=start+5000;await h.engine.timerCycle();assert.equal(h.exchange.calls.filter(c=>c.parameters.type==='MARKET').length,1);assert.equal(h.engine.lastCycleAt,last);assert.equal(h.order.timing.timeoutCheckedAt,start+5000);assert.equal(h.engine.timerBusy,false);
});
test('deadline-only processing keeps STOP priority over entry fallback',async()=>{
 const h=await deadlineHarness([deadlineEntry(),marketRule('STOP_BOT','종가 > 100')]);h.exchange.fill(h.order.id,1);h.exchange.now+=5000;h.exchange.signalClose=101;await h.engine.tick({deadlinesOnly:true});assert.equal(h.b.runtime.runEnabled,false);assert.equal(h.order.fallbackDone,true);assert.equal(h.exchange.calls.filter(c=>c.parameters.type==='MARKET').length,0);assert.equal(h.exchange.quantity,1);
});
test('deadline-only processing keeps a position exit ahead of partial-entry fallback',async()=>{
 const h=await deadlineHarness([deadlineEntry(),marketRule('EXIT_LONG','종가 > 100')]);h.exchange.fill(h.order.id,1);h.exchange.now+=5000;h.exchange.signalClose=101;await h.engine.tick({deadlinesOnly:true});const market=h.exchange.calls.filter(c=>c.parameters.type==='MARKET');assert.equal(market.length,1);assert.equal(market[0].parameters.side,'SELL');assert.equal(market[0].parameters.quantity,'1');assert.equal(h.exchange.quantity,0);assert.equal(h.order.fallbackDone,true);
});
test('unconfirmed cancellation never sends a fallback; a later partial-fill confirmation converts only the remainder once',async()=>{
 const h=await deadlineHarness(),cancel=h.engine.client.cancelOrder.bind(h.engine.client),quantity=Number(h.order.parameters.quantity);h.engine.client.cancelOrder=async()=>({status:'NEW',executedQty:'0',orderId:h.order.orderId});h.exchange.now+=5000;await h.engine.tick({deadlinesOnly:true});assert.equal(h.exchange.calls.filter(c=>c.parameters.type==='MARKET').length,0);assert.equal(h.order.status,'NEW');
 h.exchange.fill(h.order.id,1);h.engine.client.cancelOrder=cancel;h.exchange.now+=1000;await h.engine.tick({deadlinesOnly:true});await h.engine.tick({deadlinesOnly:true});const market=h.exchange.calls.filter(c=>c.parameters.type==='MARKET');assert.equal(market.length,1);assert.equal(Number(market[0].parameters.quantity),quantity-1);assert.equal(h.exchange.quantity,quantity);
});
test('a paused entry cannot be revived by a deadline or a restart',async()=>{
 const h=await deadlineHarness();await h.engine.pauseBot(h.id);h.exchange.now+=5000;await h.engine.tick({deadlinesOnly:true});assert.equal(h.exchange.calls.length,1);assert.equal(h.order.fallbackDone,true);
 const recovered=await new TradingEngine(new MemoryStore(h.engine.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});await recovered.tick({deadlinesOnly:true});assert.equal(h.exchange.calls.length,1);assert.equal(recovered.bot(h.id).runtime.runEnabled,false);
});
test('exchange rate cooldown also blocks deadline sends until it expires',async()=>{
 const h=await deadlineHarness();h.exchange.now+=5000;h.engine.client.rate={blockedUntil:h.exchange.now+5000};await h.engine.tick({deadlinesOnly:true});assert.equal(h.exchange.calls.length,1);h.exchange.now+=5001;await h.engine.tick({deadlinesOnly:true});assert.equal(h.exchange.calls.filter(c=>c.parameters.type==='MARKET').length,1);
});
test('restart with an accepted pending limit produces a single linked fallback after explicit resume',async()=>{
 const h=await deadlineHarness();const recovered=await new TradingEngine(new MemoryStore(h.engine.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});await recovered.startBot(h.id);h.exchange.now+=5000;await recovered.tick({deadlinesOnly:true});await recovered.tick({deadlinesOnly:true});assert.equal(h.exchange.calls.filter(c=>c.parameters.type==='MARKET').length,1);const fallback=recovered.ownOrders(recovered.bot(h.id)).find(o=>o.parent===h.order.id);assert.ok(fallback);assert.equal(fallback.acceptedAt,h.exchange.now);
});

test('a deadline reached between unrelated bots is handled before the remaining bot round',async()=>{
 const h=await deadlineHarness(),start=h.order.createdAt,normal=h.engine.tickBot.bind(h.engine),sent=[];
 h.exchange.beforeSend=p=>sent.push({at:h.exchange.now,type:p.type});
 const slow=[1,2,3].map(n=>({...structuredClone(h.b),id:'slow-idle-'+n,name:'idle '+n,budgetIncluded:false,runtime:{...structuredClone(h.b.runtime),runEnabled:false,managementEnabled:false}}));h.engine.state.bots.unshift(...slow);
 h.engine.tickBot=async(b,options)=>{if(b.id.startsWith('slow-idle-')){h.exchange.now+=3000;return;}return normal(b,options);};
 await h.engine.tick();assert.equal(sent.find(p=>p.type==='MARKET').at,start+6000);assert.equal(h.exchange.calls.filter(c=>c.parameters.type==='MARKET').length,1);
});

test('historical non-shared fee queries use the original symbol and never replace the new symbol position',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]);h.engine.bot(h.id).exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();const b=h.engine.bot(h.id),o=h.engine.ownOrders(b).find(o=>o.kind==='standard'&&o.role==='entry'),query=h.engine.client.queryOrder.bind(h.engine.client),symbols=[];b.symbol='TMFUSDT';b.runtime.quantity=2;b.runtime.entryPrice=50;o.feesFetched=false;const before=b.runtime.realized;h.engine.client.queryOrder=async(symbol,id)=>{symbols.push(symbol);return query(symbol,id);};h.engine.client.trades=async(symbol,id)=>{symbols.push(symbol);assert.equal(id,o.orderId);return [{id:876,qty:String(o.appliedQty),price:'100',commission:'0.01',commissionAsset:'USDT',time:h.exchange.now}];};await h.engine.refreshOrder(b,o);await h.engine.refreshOrder(b,o);assert.ok(symbols.every(symbol=>symbol==='BTCUSDT'));assert.equal(b.runtime.quantity,2);assert.equal(b.runtime.entryPrice,50);assert.ok(Math.abs(b.runtime.realized-(before-.01))<1e-9);assert.equal(h.engine.state.fills.find(f=>f.tradeId===876).symbol,'BTCUSDT');
});
test('unexpected historical quantity changes cannot be applied to a bot new symbol',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]);h.engine.bot(h.id).exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();const b=h.engine.bot(h.id),o=h.engine.ownOrders(b).find(o=>o.kind==='standard'&&o.role==='entry');b.symbol='TMFUSDT';b.runtime.quantity=2;b.runtime.entryPrice=50;await assert.rejects(()=>h.engine.applyOrder(b,o,{status:'FILLED',executedQty:String(o.appliedQty+1),cumQuote:'1000'}),/이전 종목/);assert.equal(b.runtime.quantity,2);assert.equal(b.runtime.entryPrice,50);
});

test('deleting a flat single bot keeps a named individual statistics profile across reload',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),marketRule('EXIT_LONG','종가 > 100')]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();h.exchange.signalClose=101;await h.engine.tick();await h.engine.tick();const fills=JSON.stringify(h.engine.state.fills);await h.engine.removeBot(h.id);assert.equal(h.engine.state.bots.some(x=>x.id===h.id),false);assert.equal(h.engine.state.deletedBots[0].name,b.name);assert.equal(h.engine.state.deletedBots[0].historyBudget,b.budget);assert.equal(JSON.stringify(h.engine.state.fills),fills);
 const recovered=await new TradingEngine(new MemoryStore(h.engine.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init(),r=await recovered.tradeHistory.get(h.id);assert.equal(r.bot.deleted,true);assert.equal(r.trades.length,1);
});
test('a blocked single-bot deletion does not create a deleted statistics profile',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]);await h.engine.startBot(h.id);await h.engine.tick();await assert.rejects(()=>h.engine.removeBot(h.id),/포지션/);assert.equal(h.engine.state.deletedBots?.length||0,0);assert.ok(h.engine.bot(h.id));
});


test('non-shared settlement recovers losses from a previously increased budget exactly once',async()=>{const {engine,id}=await harness(),b=engine.bot(id);Object.assign(b,{budget:200,budgetMode:'pnl',profitReinvestPercent:50,budgetRecovery:'full',budgetLossCarry:'carry'});Object.assign(b.runtime,{quantity:2,entryPrice:100,direction:'LONG'});const o={id:'recovery-exit',scope:engine.state.scope,botId:id,kind:'standard',role:'exit',direction:'LONG',status:'NEW',appliedQty:0,appliedQuote:0,parameters:{symbol:'BTCUSDT',type:'LIMIT',side:'SELL',quantity:'2'}};engine.state.orders.push(o);await engine.applyOrder(b,o,{executedQty:'1',cumQuote:'200',status:'PARTIALLY_FILLED'});assert.equal(engine.budgetLimit(b),250);await engine.applyOrder(b,o,{executedQty:'2',cumQuote:'260',status:'FILLED'});assert.equal(engine.budgetLimit(b),210);assert.equal(b.runtime.budgetRecoveryDebt,40);Object.assign(b.runtime,{quantity:1,entryPrice:100,direction:'LONG'});const next={...o,id:'recovery-after-loss',appliedQty:0,appliedQuote:0,status:'NEW',parameters:{...o.parameters,quantity:'1'}};engine.state.orders.push(next);await engine.applyOrder(b,next,{executedQty:'1',cumQuote:'160',status:'FILLED'});assert.equal(engine.budgetLimit(b),260);assert.equal(b.runtime.budgetRecoveryDebt,0);const runtime=structuredClone(b.runtime);await engine.applyOrder(b,next,{executedQty:'1',cumQuote:'160',status:'FILLED'});assert.deepEqual(b.runtime,runtime);});


test('full stop cancels only owned guards, keeps holdings and blocks exit formulas and software TP/SL',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),marketRule('EXIT_LONG','종가 > 100')]);await h.engine.startBot(h.id);await h.engine.tick();const b=h.engine.bot(h.id),qty=b.runtime.quantity;
 h.exchange.algos.set('external-guard',{clientAlgoId:'external-guard',algoStatus:'NEW',type:'STOP_MARKET'});
 await h.engine.pauseBot(h.id);assert.equal(b.runtime.managementEnabled,false);assert.equal(b.runtime.stopPending,null);assert.equal(h.exchange.algos.get('external-guard').algoStatus,'NEW');assert.ok(h.engine.ownOrders(b).filter(o=>o.kind==='algo').every(o=>o.status==='CANCELED'));
 h.exchange.signalClose=120;h.engine.client.premium=async()=>({markPrice:'120'});h.exchange.now+=120000;await h.engine.tick();await h.engine.tick({deadlinesOnly:true});assert.equal(b.runtime.quantity,qty);assert.equal(h.exchange.quantity,qty);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(h.exchange.calls.filter(c=>c.method==='placeAlgo').length,2);assert.equal(h.engine.decorate(b).status,'paused');
});
test('full stop cancels an exit LIMIT and permanently disables its market remainder until a new signal',async()=>{
 const exit=marketRule('EXIT_LONG','종가 > 100',{order:{type:'LIMIT',price:'ask',ticks:0,timeout:5,remainder:'market',postOnly:false}}),h=await actionHarness([marketRule('ENTER_LONG'),exit]);h.engine.bot(h.id).exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();h.exchange.signalClose=101;await h.engine.tick();const b=h.engine.bot(h.id),qty=b.runtime.quantity,o=h.engine.ownOrders(b).find(o=>o.role==='exit');assert.equal(o.status,'NEW');await h.engine.pauseBot(h.id);assert.equal(o.status,'CANCELED');assert.equal(o.fallbackDone,true);h.exchange.now+=20000;await h.engine.tick();assert.equal(b.runtime.quantity,qty);assert.equal(h.exchange.calls.length,2);await h.engine.startBot(h.id);await h.engine.tick();assert.equal(h.exchange.calls.length,2);
});
test('unconfirmed stop cancellations survive restart and retry with order permission off without creating new orders',async()=>{
 const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();const cancel=h.engine.client.cancelAlgo.bind(h.engine.client);h.engine.client.cancelAlgo=async()=>({code:200});await h.engine.pauseBot(h.id);assert.ok(h.engine.bot(h.id).runtime.stopPending);await assert.rejects(()=>h.engine.startBot(h.id),/취소·체결 확인/);
 const recovered=await new TradingEngine(new MemoryStore(h.engine.state),{now:()=>h.exchange.now,clientFactory:()=>new FakeClient(h.exchange)}).init();await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:false});h.exchange.now+=4000;await recovered.tick();const r=recovered.bot(h.id).runtime;assert.equal(r.stopPending,null);assert.equal(r.runEnabled,false);assert.equal(r.managementEnabled,false);assert.ok(r.quantity>0);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').length,0);
});
test('a native order already triggering when stopped is reconciled without a replacement close',async()=>{
 const h=await closeWaitHarness(),b=h.engine.bot(h.id),qty=b.runtime.quantity;await h.engine.pauseBot(h.id);assert.ok(b.runtime.stopPending);assert.equal(b.runtime.closePending,undefined);h.exchange.fill(h.pending.id,qty/2);h.pending.order.status='CANCELED';h.pending.native.algoStatus='FINISHED';h.exchange.now+=4000;await h.engine.tick();assert.equal(b.runtime.stopPending,null);assert.equal(b.runtime.quantity,qty/2);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(b.runtime.managementEnabled,false);
});
test('explicit manual full close remains available after full stop',async()=>{
 const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();await h.engine.pauseBot(h.id);assert.ok(h.exchange.quantity>0);await h.engine.closeBot(h.id);await h.engine.tick();assert.equal(h.exchange.quantity,0);assert.equal(h.engine.bot(h.id).runtime.runEnabled,false);assert.equal(h.engine.bot(h.id).runtime.managementEnabled,false);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,2);
});
test('stop during a disk failure cannot resume exits or guards after storage recovers',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),marketRule('EXIT_LONG','종가 > 100')]);await h.engine.startBot(h.id);await h.engine.tick();const qty=h.exchange.quantity;h.store.fail=true;await assert.rejects(()=>h.engine.pauseBot(h.id));assert.equal(h.engine.bot(h.id).runtime.managementEnabled,false);assert.equal(h.engine.bot(h.id).runtime.runEnabled,false);h.store.fail=false;h.exchange.now+=6000;assert.equal(await h.engine.storage.recover({force:true}),true);h.exchange.signalClose=120;await h.engine.tick();assert.equal(h.exchange.quantity,qty);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(h.engine.bot(h.id).runtime.managementEnabled,false);assert.equal(h.engine.ownOrders(h.engine.bot(h.id)).filter(o=>o.kind==='algo'&&o.status==='NEW').length,0);
});
test('saving held settings fully stops and keeps the holding until explicitly started',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]);await h.engine.startBot(h.id);await h.engine.tick();const qty=h.exchange.quantity;await h.engine.saveBot({...h.engine.bot(h.id),actionRules:[marketRule('EXIT_LONG')]});await h.engine.tick();assert.equal(h.exchange.quantity,qty);assert.equal(h.engine.bot(h.id).runtime.managementEnabled,false);assert.equal(h.engine.ownOrders(h.engine.bot(h.id)).filter(o=>o.kind==='algo'&&o.status==='NEW').length,0);await h.engine.startBot(h.id);await h.engine.tick();assert.equal(h.exchange.quantity,0);
});

test('a stop remains durable when entry was already paused and saving the stop fails',async()=>{
 const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();h.engine.bot(h.id).runtime.runEnabled=false;await h.engine.checkpoint();h.store.fail=true;await assert.rejects(()=>h.engine.pauseBot(h.id));assert.equal(h.engine.bot(h.id).runtime.managementEnabled,false);h.store.fail=false;h.exchange.now+=6000;await h.engine.storage.recover({force:true});assert.equal(h.engine.bot(h.id).runtime.managementEnabled,false);assert.equal(h.engine.ownOrders(h.engine.bot(h.id)).filter(o=>o.kind==='algo'&&o.status==='NEW').length,0);
});
test('turning global order permission off during a storage fault preserves exchange guards',async()=>{
 const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();h.store.fail=true;await assert.rejects(()=>h.engine.checkpoint());await h.engine.setTrading(false);h.store.fail=false;h.exchange.now+=6000;await h.engine.storage.recover({force:true});assert.equal(h.engine.tradingEnabled,false);assert.equal(h.engine.bot(h.id).runtime.managementEnabled,false);assert.equal(h.engine.ownOrders(h.engine.bot(h.id)).filter(o=>o.kind==='algo'&&o.status==='NEW').length,2);
});


test('definitive margin rejection waits and retries a current signal without stopping or consuming the rearm signal',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);const send=h.engine.client.placeOrder.bind(h.engine.client);let attempts=0,available=4000;h.engine.client.account=async()=>({canTrade:true,assets:[{asset:'USDT',walletBalance:'5000',availableBalance:String(available)}]});h.engine.client.placeOrder=async p=>{attempts++;if(attempts===1)throw new BinanceError('Margin is insufficient.',{code:-2019,status:400});return send(p);};
 await h.engine.tick();assert.equal(attempts,1);assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.managementEnabled,true);assert.equal(b.runtime.error,null);assert.equal(b.runtime.entryBlocked.source,'exchange-margin');assert.equal(b.runtime.ruleSignals[b.actionRules[0].id].fired,false);assert.equal(b.runtime.ruleSignals[b.actionRules[0].id].lastExecutionAt,0);const rejected=h.engine.ownOrders(b).at(-1);assert.equal(rejected.status,'REJECTED');assert.equal(rejected.errorKind,'entry-margin');assert.equal(rejected.feesFetched,true);
 for(let i=1;i<5;i++){available+=1;h.exchange.now+=1000;await h.engine.tick();}assert.equal(attempts,1,'balance changes cannot bypass rejection backoff');h.exchange.now+=1000;await h.engine.tick();assert.equal(attempts,2);assert.ok(b.runtime.quantity>0);assert.equal(b.runtime.entryBlocked,null);assert.equal(b.runtime.entryMarginRetry,undefined);await h.engine.tick();assert.equal(attempts,2);
});
test('repeated margin rejections back off and never replay a signal after its condition turns false',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG','종가 > 99')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);let attempts=0;h.engine.client.placeOrder=async()=>{attempts++;throw new BinanceError('insufficient',{code:-2019,status:400});};await h.engine.tick();assert.equal(b.runtime.entryBlocked.retryAt-h.exchange.now,5000);h.exchange.now+=5000;await h.engine.tick();assert.equal(attempts,2);assert.equal(b.runtime.entryBlocked.retryAt-h.exchange.now,10000);h.exchange.signalClose=98;h.exchange.now+=20000;await h.engine.tick();assert.equal(attempts,2);assert.equal(b.runtime.entryBlocked,null);assert.equal(b.runtime.entryMarginRetry,undefined);assert.equal(b.runtime.runEnabled,true);
});
test('margin wait still permits the held position exit rule and does not remove existing guards',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG','종가 >= 100',{reentry:{mode:'cooldown',cooldown:0,afterExitCooldown:0}}),marketRule('EXIT_LONG','종가 < 100')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);await h.engine.tick();const q=b.runtime.quantity,send=h.engine.client.placeOrder.bind(h.engine.client);h.engine.client.placeOrder=async p=>{if(p.reduceOnly!=='true')throw new BinanceError('insufficient',{code:-2019,status:400});return send(p);};h.exchange.now+=1000;await h.engine.tick();assert.equal(b.runtime.quantity,q);assert.equal(b.runtime.error,null);assert.equal(b.runtime.runEnabled,true);assert.equal(h.engine.ownOrders(b).filter(o=>o.kind==='algo'&&o.status==='NEW').length,2);h.exchange.signalClose=99;h.exchange.now+=1000;await h.engine.tick();assert.equal(b.runtime.quantity,0);assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);
});
test('uncertain margin responses and unrelated rejection codes never enter the safe margin retry path',async()=>{
 for(const variant of [{code:-2019,uncertain:true},{code:-2019,status:503},{code:-2019,temporary:true},{code:-2010,status:400}]){const h=await actionHarness([marketRule('ENTER_LONG')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);let attempts=0;h.engine.client.placeOrder=async()=>{attempts++;throw new BinanceError('not a definitive margin rejection',variant);};await h.engine.tick();h.exchange.now+=60000;await h.engine.tick();assert.equal(attempts,1);assert.equal(b.runtime.runEnabled,false);assert.ok(b.runtime.error);assert.notEqual(h.engine.ownOrders(b)[0].errorKind,'entry-margin');}
});
test('margin rejection on a close is still an error rather than retrying an entry or silently hiding it',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG'),marketRule('EXIT_LONG','종가 > 100')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);await h.engine.tick();h.engine.client.placeOrder=async()=>{throw new BinanceError('exit margin issue',{code:-2019,status:400});};h.exchange.signalClose=101;await h.engine.tick();assert.equal(b.runtime.runEnabled,false);assert.match(b.runtime.error,/exit margin issue/);assert.equal(b.runtime.entryMarginRetry,undefined);assert.notEqual(h.engine.ownOrders(b).filter(o=>o.role==='exit').at(-1).errorKind,'entry-margin');
});
test('a rejected market remainder finishes that fallback without stopping management or duplicating the partial fill',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG','TRUE',{order:{type:'LIMIT',price:'bid',ticks:0,timeout:5,remainder:'market',postOnly:false}})]),b=h.engine.bot(h.id);b.exit={takeProfitEnabled:false,stopLossEnabled:false};await h.engine.startBot(h.id);await h.engine.tick();const parent=h.engine.ownOrders(b)[0];h.exchange.fill(parent.id,1);let attempts=0;h.engine.client.placeOrder=async()=>{attempts++;throw new BinanceError('insufficient',{code:-2019,status:400});};h.exchange.now+=6000;await h.engine.tick();assert.equal(attempts,1);assert.equal(parent.fallbackDone,true);assert.equal(b.runtime.quantity,1);assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);h.exchange.now+=60000;await h.engine.tick();assert.equal(attempts,1);assert.equal(b.runtime.quantity,1);
});
test('explicit stop cancels margin retries even after the waiting time elapses',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);let attempts=0;h.engine.client.placeOrder=async()=>{attempts++;throw new BinanceError('insufficient',{code:-2019,status:400});};await h.engine.tick();await h.engine.pauseBot(h.id);h.exchange.now+=60000;await h.engine.tick();assert.equal(attempts,1);assert.equal(b.runtime.runEnabled,false);assert.equal(b.runtime.managementEnabled,false);assert.equal(b.runtime.entryMarginRetry,undefined);
});
test('real commission and adverse mark gap shrink an automatic entry and persist the quote and balance used',async()=>{
 const h=await actionHarness([marketRule('ENTER_SHORT','TRUE',{leverage:20})]),b=h.engine.bot(h.id);h.engine.client.commissionRate=async symbol=>({symbol,takerCommissionRate:'0.0005'});h.engine.client.premium=async()=>({markPrice:'100.5'});await h.engine.startBot(h.id);await h.engine.tick();const o=h.engine.ownOrders(b).find(o=>o.role==='entry');assert.ok(o.entryEstimate);assert.equal(o.entryEstimate.markPrice,100.5);assert.equal(o.entryEstimate.feeRate,.0005);assert.ok(o.entryEstimate.openLoss>0);assert.ok(o.entryEstimate.required<=b.budget*.99+1e-8);assert.equal(o.entryEstimate.availableBalance,4000);assert.equal(o.entryEstimate.quantity,Number(o.parameters.quantity));assert.ok(Number(o.parameters.quantity)<b.budget*.99*20/99.9);assert.equal(b.runtime.runEnabled,true);
});
test('missing opening cost data waits without placing a new order or disabling management',async()=>{
 const h=await actionHarness([marketRule('ENTER_LONG')]),b=h.engine.bot(h.id);await h.engine.startBot(h.id);h.engine.client.commissionRate=async symbol=>({symbol,takerCommissionRate:null});await h.engine.tick();assert.equal(b.runtime.runEnabled,true);assert.equal(b.runtime.error,null);assert.equal(b.runtime.entryBlocked.reason,'cost-data');assert.equal(h.exchange.calls.length,0);
});
