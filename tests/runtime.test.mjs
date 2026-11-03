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
  await engine.pauseBot(id);assert.equal(engine.bot(id).runtime.runEnabled,false);assert.equal(engine.decorate(engine.bot(id)).task,'position');assert.equal(engine.decorate(engine.bot(id)).status,'running');
  assert.ok(!JSON.stringify(store.state).includes('test-secret'));assert.ok(!JSON.stringify(store.state).includes('test-key-1234567890'));
});
test('an accepted order with a lost response is queried and recovered without resending, including after restart',async()=>{
  const {engine,exchange,store,id}=await harness();exchange.uncertain=true;await engine.startBot(id);await engine.tick();const intent=store.state.orders.find(o=>o.role==='entry');assert.equal(intent.status,'UNKNOWN');
  const recoveredStore=new MemoryStore(store.state),recovered=await new TradingEngine(recoveredStore,{now:()=>exchange.now,clientFactory:()=>new FakeClient(exchange)}).init();
  await recovered.connect({environment:'testnet',apiKey:'test-key-1234567890',secret:'test-secret-1234567890',allowTrading:true});exchange.fill(intent.id,Number(intent.parameters.quantity));await recovered.tick();await recovered.tick();
  assert.equal(exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(recovered.bot(id).runtime.quantity,Number(intent.parameters.quantity));assert.equal(recovered.bot(id).runtime.runEnabled,false);assert.equal(exchange.calls.filter(c=>c.method==='placeAlgo').length,2);
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

test('saving one disabled protection keeps the other; disabling both cancels owned guards without closing holdings',async()=>{
  const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();const quantity=h.exchange.quantity;
  await h.engine.saveBot({...h.engine.bot(h.id),exit:{...h.engine.bot(h.id).exit,stopLossEnabled:false}});await h.engine.tick();let active=[...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW');assert.equal(active.length,1);assert.equal(active[0].type,'TAKE_PROFIT_MARKET');
  await h.engine.saveBot({...h.engine.bot(h.id),exit:{...h.engine.bot(h.id).exit,takeProfitEnabled:false}});await h.engine.tick();active=[...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW');assert.equal(active.length,0);assert.equal(h.exchange.quantity,quantity);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal(h.engine.bot(h.id).runtime.guardKey,null);
});

test('unconfirmed cancellation is surfaced and retried before declaring protections removed',async()=>{
  const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();const cancel=h.engine.client.cancelAlgo.bind(h.engine.client);h.engine.client.cancelAlgo=async()=>({code:200});
  await h.engine.saveBot({...h.engine.bot(h.id),exit:{...h.engine.bot(h.id).exit,takeProfitEnabled:false,stopLossEnabled:false}});await h.engine.tick();assert.match(h.engine.bot(h.id).runtime.error,/취소 확인/);assert.equal([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').length,2);
  h.engine.client.cancelAlgo=cancel;await h.engine.tick();assert.equal([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').length,0);assert.equal(h.engine.bot(h.id).runtime.error,null);assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);
});

test('disabled protection survives restart and read-only edits do not cancel exchange orders',async()=>{
  const h=await harness();await h.engine.startBot(h.id);await h.engine.tick();h.engine.tradingEnabled=false;const mutations=h.exchange.mutations.length;
  await h.engine.saveBot({...h.engine.bot(h.id),exit:{...h.engine.bot(h.id).exit,takeProfitEnabled:false,stopLossEnabled:false}});await h.engine.tick();assert.equal(h.exchange.mutations.length,mutations);assert.equal([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').length,2);
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

test('stop condition cancels partial entry residual permanently, preserves holdings, and continues protective management',async()=>{
  const entry=marketRule('ENTER_LONG','TRUE',{order:{type:'LIMIT',price:'bid',ticks:0,timeout:10,remainder:'market',postOnly:true}}),h=await actionHarness([entry,marketRule('STOP_BOT','종가 > 100')]);
  await h.engine.startBot(h.id);await h.engine.tick();const b=h.engine.bot(h.id),order=h.engine.ownOrders(b).find(o=>o.role==='entry');h.exchange.fill(order.id,1);h.exchange.signalClose=101;h.exchange.now+=15000;await h.engine.tick();
  assert.equal(b.runtime.runEnabled,false);assert.equal(b.runtime.quantity,1);assert.equal(order.status,'CANCELED');assert.equal(order.fallbackDone,true);
  await h.engine.tick();assert.equal(h.exchange.calls.filter(c=>c.method==='placeOrder').length,1);assert.equal([...h.exchange.algos.values()].filter(o=>o.algoStatus==='NEW').length,2);
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
  const saved=await h.engine.saveBot({...b,budget:10});assert.equal(saved.budget,10);assert.equal(saved.quantity,held);assert.ok(saved.budgetWarning);assert.equal(saved.runtime.runEnabled,false);assert.equal(h.exchange.mutations.length,mutations);
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
