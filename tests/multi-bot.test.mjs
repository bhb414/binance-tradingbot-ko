import test from 'node:test';
import assert from 'node:assert/strict';
import {TradingEngine} from '../backend/engine.mjs';
import {BinanceError} from '../backend/binance.mjs';
import {emptyState} from '../backend/store.mjs';
import {makeBot} from '../public/core.js';
import {makeMultiBot,multiRule,multiTarget,validateMulti,multiAllocations} from '../public/multi-bot.js';
import {compileFormula,formulaSymbols} from '../public/formula.js';
import {evaluateRuleFormula} from '../public/formula-runtime.js';
const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'];
const info=symbol=>({symbol,baseAsset:symbol.replace('USDT',''),status:'TRADING',quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL',filters:[{filterType:'PRICE_FILTER',tickSize:'0.1'},{filterType:'LOT_SIZE',minQty:'0.001',maxQty:'100000',stepSize:'0.001'},{filterType:'MARKET_LOT_SIZE',minQty:'0.001',maxQty:'100000',stepSize:'0.001'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
async function harness(){
 const state=emptyState(),store={state,saved:[],async load(){return this.state;},async save(){this.saved.push(structuredClone(this.state));}},x={now:1800000000000,prices:{BTCUSDT:100,ETHUSDT:50,SOLUSDT:200},quantities:{},entryPrices:{},orders:new Map(),calls:[],config:Object.fromEntries(symbols.map(s=>[s,{symbol:s,marginType:'ISOLATED',leverage:3}]))};
 const client={offset:0,redact:s=>s,clearCredentials(){},async syncTime(){return x.now;},async exchangeInfo(){return {symbols:symbols.map(info)};},async tickers(){return symbols.map(symbol=>({symbol,lastPrice:String(x.prices[symbol])}));},
 async book(symbol){const p=x.prices[symbol];return {bids:[[String(p),'100']],asks:[[String(p),'100']]};},async premium(symbol){return {markPrice:String(x.prices[symbol])};},
 async klines(symbol,interval){const seconds=interval==='1h'?3600:interval==='4h'?14400:60,last=Math.floor(x.now/1000/seconds)*seconds;return Array.from({length:600},(_,i)=>({time:last-(599-i)*seconds,closeTime:(last-(598-i)*seconds)*1000-1,open:x.prices[symbol],high:x.prices[symbol]+1,low:x.prices[symbol]-1,close:x.prices[symbol],volume:10}));},
 async account(){return {canTrade:true,assets:[{asset:'USDT',walletBalance:'20000',availableBalance:'10000'}]};},async positionMode(){return {dualSidePosition:false};},
 async positions(){return Object.entries(x.quantities).filter(([,q])=>q).map(([symbol,q])=>({symbol,positionSide:'BOTH',positionAmt:String(q),entryPrice:String(x.entryPrices[symbol]||100),markPrice:String(x.prices[symbol]),positionInitialMargin:String(Math.abs(q)*(x.entryPrices[symbol]||100)/x.config[symbol].leverage),unRealizedProfit:'0'}));},
 async openOrders(symbol){return [...x.orders.values()].filter(o=>(!symbol||o.symbol===symbol)&&o.status==='NEW');},async openAlgoOrders(){return [];},async symbolConfig(symbol){return symbol?[x.config[symbol]]:Object.values(x.config);},
 async leverageBrackets(symbol){return [{symbol,brackets:[{initialLeverage:125,notionalFloor:0,notionalCap:10000000}]}];},async changeMargin(symbol,margin){x.config[symbol].marginType=margin;return{};},async changeLeverage(symbol,n){x.config[symbol].leverage=n;return {leverage:n};},
 async placeOrder(p){x.calls.push({...p});if(p.symbol===x.rejectSymbol)throw new BinanceError('rejected',{code:-2010});const o={...p,orderId:x.orders.size+1,clientOrderId:p.newClientOrderId,origQty:p.quantity,executedQty:p.quantity,avgPrice:String(x.prices[p.symbol]),cumQuote:String(Number(p.quantity)*x.prices[p.symbol]),status:'FILLED'};x.orders.set(p.newClientOrderId,o);const old=x.quantities[p.symbol]||0,delta=Number(p.quantity)*(p.side==='BUY'?1:-1);if(!old||Math.sign(old)===Math.sign(delta))x.entryPrices[p.symbol]=(Math.abs(old)*(x.entryPrices[p.symbol]||0)+Math.abs(delta)*x.prices[p.symbol])/(Math.abs(old)+Math.abs(delta));x.quantities[p.symbol]=old+delta;if(x.uncertainSymbol===p.symbol){x.uncertainSymbol=null;throw new BinanceError('lost reply',{uncertain:true});}return {...o};},
 async queryOrder(symbol,id){const o=x.orders.get(id);if(!o)throw new BinanceError('not found',{code:-2013});return {...o};},async cancelOrder(symbol,id){const o=x.orders.get(id);if(o.status!=='FILLED')o.status='CANCELED';return {...o};},async trades(){return [];},async income(){return[];}
 };
 const engine=await new TradingEngine(store,{now:()=>x.now,clientFactory:()=>client}).init();await engine.connect({environment:'testnet',apiKey:'fabricated-multi-key',secret:'fabricated-multi-secret',allowTrading:true});return {engine,x,store,client};
}
function config(extra={}){
 const legs=[{alias:'A',symbol:'BTCUSDT',weight:60},{alias:'B',symbol:'ETHUSDT',weight:40}];
 return makeMultiBot({budget:1000,legs,actionRules:[multiRule(legs,{formula:'(A.종가 / B.종가 > 1.5)@1h',targets:[multiTarget('A',{sizePercent:100,leverage:2}),multiTarget('B',{action:'ENTER_SHORT',sizePercent:100,leverage:4})]})],...extra});
}
test('qualified-symbol formulas combine values and indicators on synchronized historical bars',()=>{
 const snapshot=(values,times=[1,2,3,4])=>({serverNow:5*3600000-1,candles:times.map((time,i)=>({time:time*3600,closeTime:(time+1)*3600000-1,open:values[i],high:values[i],low:values[i],close:values[i],volume:1}))});
 const a=snapshot([10,20,30,40]),b=snapshot([2,3,4],[2,3,4]),snapshots={'1h':{...a,symbols:{A:a,B:b}}};
 const result=evaluateRuleFormula('(A.종가[1] / B.종가[1])@1h',snapshots);assert.equal(result.result.value,10);
 assert.equal(evaluateRuleFormula('SMA(A.종가/B.종가, 2)@1h[1]',snapshots).result.value,10);
 assert.deepEqual(formulaSymbols('(BTCUSDT.종가 / ETHUSDT.종가)@1h'),['BTCUSDT','ETHUSDT']);assert.throws(()=>compileFormula('A.constructor@1h'));
 const behind=snapshot([2,3],[2,3]);assert.throws(()=>evaluateRuleFormula('(A.종가 > B.종가)@1h',{'1h':{...a,symbols:{A:a,B:behind}}}),e=>e.temporary);
});
test('multi validation uses percentage budgets and supports distinct targets without pair-only behavior',()=>{
 const p=config();assert.deepEqual(validateMulti(p,{symbols}),[]);assert.deepEqual(multiAllocations(p).map(l=>l.budget),[600,400]);
 assert.deepEqual(validateMulti({...p,legs:p.legs.map(l=>({...l,weight:30}))},{symbols}),[]);
 assert.ok(validateMulti({...p,legs:p.legs.map(l=>({...l,weight:60}))},{symbols}).some(s=>s.includes('100%')));
 assert.ok(validateMulti({...p,legs:[p.legs[0],{...p.legs[1],symbol:'BTCUSDT'}]},{symbols}).length);
});
test('one visible multi bot allocates budgets, trades independent symbols and never duplicates a steady signal',async()=>{
 const h=await harness(),p=await h.engine.saveBot(config());await h.engine.startBot(p.id);await h.engine.tick();await h.engine.tick();
 assert.equal(h.x.calls.length,2);assert.ok(h.x.quantities.BTCUSDT>0);assert.ok(h.x.quantities.ETHUSDT<0);
 const s=h.engine.snapshot();assert.equal(s.bots.length,1);assert.equal(s.bots[0].kind,'multi');assert.equal(s.bots[0].members.length,2);assert.deepEqual(s.bots[0].members.map(b=>b.budget),[600,400]);assert.equal(s.positionOwners.length,2);
 assert.ok(Math.abs(Number(h.x.calls[0].quantity)*100/2-594)<.1);assert.ok(Math.abs(Number(h.x.calls[1].quantity)*50/4-396)<.1);
 const single=await h.engine.saveBot(makeBot({symbol:'BTCUSDT',budget:100}));await assert.rejects(()=>h.engine.startBot(single.id),/한 봇/);
});
test('a condition can close one symbol while leaving the other symbol held',async()=>{
 const h=await harness(),p=config();p.actionRules.push(multiRule(p.legs,{formula:'(A.종가 < 90)@1h',targets:[multiTarget('A',{action:'CLOSE_ALL',sizePercent:100})]}));
 await h.engine.saveBot(p);await h.engine.startBot(p.id);await h.engine.tick();const b=h.x.quantities.ETHUSDT;h.x.prices.BTCUSDT=80;await h.engine.tick();assert.equal(h.x.quantities.BTCUSDT,0);assert.equal(h.x.quantities.ETHUSDT,b);
});
test('a rejected target pauses new entries and preserves other already-filled holdings',async()=>{
 const h=await harness(),p=await h.engine.saveBot(config());h.x.rejectSymbol='ETHUSDT';await h.engine.startBot(p.id);await h.engine.tick();const v=h.engine.snapshot().bots[0];assert.equal(v.runtime.runEnabled,false);assert.ok(v.error);assert.ok(h.x.quantities.BTCUSDT>0);assert.equal(h.x.quantities.ETHUSDT||0,0);await h.engine.tick();assert.equal(h.x.calls.length,2);
});

test('three-symbol conditions can enter multiple longs and shorts without a pair restriction',async()=>{
 const h=await harness(),legs=[{alias:'A',symbol:'BTCUSDT',weight:30},{alias:'B',symbol:'ETHUSDT',weight:30},{alias:'C',symbol:'SOLUSDT',weight:40}],p=makeMultiBot({budget:1000,legs,actionRules:[multiRule(legs,{formula:'(A.종가 > 0 AND C.종가 > B.종가)@1h',targets:legs.map(l=>multiTarget(l.alias,{action:l.alias==='C'?'ENTER_SHORT':'ENTER_LONG',sizePercent:100}))})]});
 await h.engine.saveBot(p);await h.engine.startBot(p.id);await h.engine.tick();assert.equal(h.x.calls.length,3);assert.ok(h.x.quantities.BTCUSDT>0);assert.ok(h.x.quantities.ETHUSDT>0);assert.ok(h.x.quantities.SOLUSDT<0);assert.equal(h.engine.snapshot().bots[0].members.length,3);
});
test('unknown multi-symbol order acceptance is queried without resending and stays paused after restart',async()=>{
 const h=await harness(),p=await h.engine.saveBot(config());h.x.uncertainSymbol='ETHUSDT';await h.engine.startBot(p.id);await h.engine.tick();assert.equal(h.engine.snapshot().bots[0].runtime.runEnabled,false);await h.engine.tick();assert.equal(h.x.calls.length,2);assert.ok(h.engine.snapshot().bots[0].members.every(b=>b.quantity>0));
 const store={state:structuredClone(h.store.state),async load(){},async save(){}},restored=await new TradingEngine(store,{now:()=>h.x.now,clientFactory:()=>h.client}).init();await restored.connect({environment:'testnet',apiKey:'fabricated-multi-key',secret:'fabricated-multi-secret',allowTrading:true});await restored.tick();assert.equal(h.x.calls.length,2);assert.equal(restored.snapshot().bots[0].runtime.runEnabled,false);
});

test('stopping new entries preserves independently managed exits, and STOP can fire again after explicit start',async()=>{
 const h=await harness(),p=config();p.actionRules.push(multiRule(p.legs,{formula:'(A.종가 < 90)@1h',targets:[multiTarget('A',{action:'CLOSE_ALL',sizePercent:100})]}));
 await h.engine.saveBot(p);await h.engine.startBot(p.id);await h.engine.tick();await h.engine.pauseBot(p.id);h.x.prices.BTCUSDT=80;await h.engine.tick();assert.equal(h.x.quantities.BTCUSDT,0);assert.ok(h.x.quantities.ETHUSDT<0);assert.equal(h.engine.snapshot().bots[0].runtime.runEnabled,false);
 const stop=multiRule(p.legs,{action:'STOP_BOT',formula:'TRUE@1h'}),next={...p,actionRules:[stop]};await h.engine.saveBot(next);for(let i=0;i<2;i++){await h.engine.startBot(p.id);await h.engine.tick();assert.equal(h.engine.snapshot().bots[0].runtime.runEnabled,false);}
});
test('opposing entry signals for the same symbol are held without blocking other symbols',async()=>{
 const h=await harness(),p=config();p.actionRules.push(multiRule(p.legs,{formula:'TRUE@1h',targets:[multiTarget('A',{action:'ENTER_SHORT'})]}));
 await h.engine.saveBot(p);await h.engine.startBot(p.id);await h.engine.tick();assert.equal(h.x.quantities.BTCUSDT||0,0);assert.ok(h.x.quantities.ETHUSDT<0);assert.equal(h.engine.snapshot().bots[0].runtime.lastEvaluation.conflict,true);
});
test('a ready exit cancels a partially filled entry before any timed market fallback',async()=>{
 const h=await harness(),p=config();p.actionRules[0].targets=p.actionRules[0].targets.slice(0,1);p.actionRules[0].targets[0].order={type:'LIMIT',price:'bid',ticks:0,timeout:1,remainder:'market',postOnly:false};
 p.actionRules.push(multiRule(p.legs,{formula:'(A.종가 < 90)@1h',targets:[multiTarget('A',{action:'CLOSE_ALL',sizePercent:100})]}));
 const send=h.client.placeOrder;h.client.placeOrder=async parameters=>{const o=await send(parameters);if(parameters.type==='LIMIT'){o.executedQty=String(Number(o.origQty)/2);o.cumQuote=String(Number(o.executedQty)*h.x.prices[o.symbol]);o.status='PARTIALLY_FILLED';h.x.orders.set(o.clientOrderId,{...o});h.x.quantities[o.symbol]/=2;}return o;};
 await h.engine.saveBot(p);await h.engine.startBot(p.id);await h.engine.tick();assert.ok(h.x.quantities.BTCUSDT>0);h.x.now+=2000;h.x.prices.BTCUSDT=80;await h.engine.tick();assert.equal(h.x.quantities.BTCUSDT,0);assert.equal(h.x.calls.length,2);assert.equal(h.x.calls[1].side,'SELL');assert.equal([...h.x.orders.values()][0].status,'CANCELED');await h.engine.tick();assert.equal(h.x.calls.length,2);
});
test('temporary cross-symbol data errors preserve the group start state and recover without duplicate orders',async()=>{
 const h=await harness(),p=await h.engine.saveBot(config());await h.engine.startBot(p.id);const market=h.engine.market.bind(h.engine);let fail=true;h.engine.market=async(s,tf)=>{if(s==='ETHUSDT'&&fail)throw Object.assign(Error('temporary feed'),{temporary:true,retryAt:h.x.now+3000});return market(s,tf);};
 await h.engine.tick();assert.equal(h.engine.snapshot().bots[0].runtime.runEnabled,true);assert.equal(h.x.calls.length,0);h.x.now+=4000;fail=false;await h.engine.tick();assert.equal(h.x.calls.length,2);
});
test('saved weights and budget modes split the effective group capital; exposed symbols stay locked and failed saves roll back',async()=>{
 const h=await harness(),p=config({budgetMode:'pnl'});await h.engine.saveBot(p);const workers=h.engine.multi.workers(h.engine.multi.get(p.id));workers[0].runtime.realized=-100;h.engine.multi.syncBudgets(h.engine.multi.get(p.id));assert.deepEqual(workers.map(b=>b.budget),[540,360]);
 await h.engine.startBot(p.id);await h.engine.tick();const changed={...p,legs:p.legs.map((l,i)=>({...l,weight:i?70:30}))};await h.engine.saveBot(changed);assert.equal(h.engine.snapshot().bots[0].runtime.runEnabled,false);assert.ok(Math.abs(h.engine.snapshot().bots[0].members[0].budget-270)<1e-8);
 await assert.rejects(()=>h.engine.saveBot({...changed,legs:[{...changed.legs[0],symbol:'SOLUSDT'},changed.legs[1]]}),/보유/);
 const before=structuredClone(h.store.state);h.store.save=async()=>{throw Error('disk full');};await assert.rejects(()=>h.engine.saveBot({...changed,budget:700}),/원장 저장/);assert.deepEqual(h.store.state,before);
});
test('cross-symbol historical expressions keep gap boundaries, Korean indicators and numeric instrument names',()=>{
 const rows=[1,2,3,4].map(i=>({time:i*3600,closeTime:(i+1)*3600000-1,open:i,high:i,low:i,close:i,volume:1})),a={serverNow:5*3600000-1,candles:rows},b={...a,candles:rows.filter((_,i)=>i!==2)};
 const result=evaluateRuleFormula('볼린저상단(A.하이킨종가, 2, 1.04)@1h[1]',{'1h':{...a,symbols:{A:a}}});assert.equal(result.result.ok,true);assert.equal(result.result.missing,false);
 assert.throws(()=>evaluateRuleFormula('(A.종가/B.종가)@1h',{'1h':{...a,symbols:{A:a,B:b}}}),e=>e.temporary);
 assert.deepEqual(formulaSymbols('1000SHIBUSDT.종가@1h'),['1000SHIBUSDT']);
});

test('one over-budget holding does not prevent another symbol using its own allocation',async()=>{
 const h=await harness(),p=await h.engine.saveBot(config()),a=h.engine.multi.workers(h.engine.multi.get(p.id))[0];Object.assign(a.runtime,{quantity:20,entryPrice:100,direction:'LONG',entries:1});a.leverage=2;h.x.config.BTCUSDT.leverage=2;h.x.quantities.BTCUSDT=20;h.x.entryPrices.BTCUSDT=100;
 await h.engine.startBot(p.id);await h.engine.tick();assert.equal(h.x.quantities.BTCUSDT,20);assert.ok(h.x.quantities.ETHUSDT<0);assert.equal(h.engine.snapshot().bots[0].runtime.runEnabled,true);
});

test('storage failure between multi-symbol fills resumes remaining legs without reordering the accepted leg',async()=>{
 const h=await harness(),p=await h.engine.saveBot(config()),save=h.store.save.bind(h.store);await h.engine.startBot(p.id);let fail=true;
 h.store.save=async()=>{if(fail&&h.store.state.orders.some(o=>o.parameters.symbol==='BTCUSDT'&&o.status==='FILLED')){fail=false;throw Object.assign(Error('locked'),{code:'EPERM'});}return save();};
 await assert.rejects(()=>h.engine.tick(),e=>e.storage);assert.equal(h.x.calls.length,1);h.x.now+=6000;await h.engine.tick();await h.engine.tick();
 assert.equal(h.engine.storage.fault,null);assert.equal(h.engine.snapshot().bots[0].runtime.runEnabled,true);assert.equal(h.x.calls.length,2);assert.ok(h.x.quantities.BTCUSDT>0);assert.ok(h.x.quantities.ETHUSDT<0);
});

test('under-allocated weights leave the remainder unused and size every leg from its actual percentage',async()=>{
 const h=await harness(),p=config({legs:[{alias:'A',symbol:'BTCUSDT',weight:20},{alias:'B',symbol:'ETHUSDT',weight:30}]});
 assert.deepEqual(validateMulti(p,{symbols}),[]);assert.deepEqual(multiAllocations(p).map(l=>l.budget),[200,300]);assert.deepEqual(multiAllocations({...p,budgetMode:'pnl'},-100).map(l=>l.budget),[180,270]);
 await h.engine.saveBot(p);await h.engine.startBot(p.id);await h.engine.tick();await h.engine.tick();
 assert.deepEqual(h.engine.snapshot().bots[0].members.map(b=>b.budget),[200,300]);assert.equal(h.x.calls.length,2);
 const margin=h.x.calls.reduce((sum,o)=>sum+Number(o.quantity)*h.x.prices[o.symbol]/h.x.config[o.symbol].leverage,0);assert.ok(Math.abs(margin-495)<.01);assert.equal(h.engine.allocatedBudget(),1000);
});
test('unused percentages do not silently reassign or double-book the parent bot budget',async()=>{
 const h=await harness(),p=config({legs:[{alias:'A',symbol:'BTCUSDT',weight:30},{alias:'B',symbol:'ETHUSDT',weight:30}]});h.client.account=async()=>({canTrade:true,assets:[{asset:'USDT',walletBalance:'1000',availableBalance:'1000'}]});await h.engine.refreshAccount(true);
 await h.engine.saveBot(p);assert.equal(h.engine.allocatedBudget(),1000);await assert.rejects(()=>h.engine.saveBot(makeBot({symbol:'SOLUSDT',budget:50})),/예산|잔고/);await assert.rejects(()=>h.engine.saveBot(config({id:crypto.randomUUID(),budget:100})),/잔고/);assert.equal(h.x.calls.length,0);
 assert.ok(validateMulti({...p,legs:[{...p.legs[0],weight:50},{...p.legs[1],weight:50.01}]},{symbols}).some(message=>message.includes('100%')));
 assert.deepEqual(validateMulti({...p,legs:[{...p.legs[0],weight:49.999},{...p.legs[1],weight:50.001}]},{symbols}),[]);
});

test('multi-symbol protection applies each held leg leverage independently and closing one leg preserves the other',async()=>{
 const h=await harness(),algos=new Map();h.client.placeAlgo=async p=>{const order={...p,algoStatus:'NEW',algoId:algos.size+1};algos.set(p.clientAlgoId,order);return {...order};};h.client.queryAlgo=async id=>({...algos.get(id)});h.client.cancelAlgo=async id=>{algos.get(id).algoStatus='CANCELED';return {};};
 const p=await h.engine.saveBot(config({exit:{basis:'leveraged',takeProfit:8,stopLoss:4,price:'MARK_PRICE',takeProfitEnabled:true,stopLossEnabled:true}}));await h.engine.startBot(p.id);await h.engine.tick();
 const a=[...algos.values()].filter(o=>o.symbol==='BTCUSDT'),b=[...algos.values()].filter(o=>o.symbol==='ETHUSDT');assert.equal(a.find(o=>o.type==='TAKE_PROFIT_MARKET').triggerPrice,'104');assert.equal(b.find(o=>o.type==='TAKE_PROFIT_MARKET').triggerPrice,'49');
 h.x.prices.BTCUSDT=104.1;h.x.now+=5000;await h.engine.tick();assert.equal(h.x.quantities.BTCUSDT,0);assert.ok(h.x.quantities.ETHUSDT<0);
});

test('multi-symbol rules share calendar constraints and evaluate current time even with cached market snapshots',async()=>{
 const h=await harness(),p=config();p.actionRules[0].formula='요일() = 월요일 AND 시간범위(900, 1000) AND (A.종가 / B.종가 > 1.5)@1h';
 h.x.now=Date.parse('2026-01-04T23:59:00Z');const bot=await h.engine.saveBot(p);await h.engine.startBot(bot.id);await h.engine.tick();assert.equal(h.x.calls.length,0);
 h.x.now=Date.parse('2026-01-05T00:00:00Z');await h.engine.tick();assert.equal(h.x.calls.length,2);assert.ok(h.x.quantities.BTCUSDT>0);assert.ok(h.x.quantities.ETHUSDT<0);
});

test('multi-symbol exit formulas combine aggregate return with each named leg return',async()=>{
 const h=await harness(),p=config(),positions=h.client.positions.bind(h.client);p.exit={takeProfitEnabled:false,stopLossEnabled:false};
 p.actionRules.push(multiRule(p.legs,{formula:'현재수익률() >= 1 AND A.현재수익률 >= 2 AND B.현재수익률 >= 8',targets:[multiTarget('A',{action:'EXIT_LONG',sizePercent:100}),multiTarget('B',{action:'EXIT_SHORT',sizePercent:100})]}));
 h.client.positions=async()=>{const rows=await positions();return rows.map(r=>({...r,unRealizedProfit:String((Number(r.markPrice)-Number(r.entryPrice))*Number(r.positionAmt))}));};
 const saved=await h.engine.saveBot(p);await h.engine.startBot(saved.id);await h.engine.tick();assert.ok(h.x.quantities.BTCUSDT>0);assert.ok(h.x.quantities.ETHUSDT<0);
 h.x.prices.BTCUSDT=101;h.x.prices.ETHUSDT=49;h.x.now+=1000;await h.engine.refreshAccount(true);await h.engine.tick();assert.equal(h.x.quantities.BTCUSDT,0);assert.equal(h.x.quantities.ETHUSDT,0);assert.equal(h.x.calls.length,4);
});

test('one undersized leg defers a multi-symbol batch without stopping the parent or opening an unmatched leg',async()=>{
 const h=await harness(),p=config({budget:10,exit:{takeProfitEnabled:false,stopLossEnabled:false}});p.actionRules[0].reentry={mode:'cooldown',cooldown:0,afterExitCooldown:0};p.actionRules.push(multiRule(p.legs,{formula:'A.종가@1h > 100',targets:[multiTarget('A',{action:'EXIT_LONG',sizePercent:100}),multiTarget('B',{action:'EXIT_SHORT',sizePercent:100})]}));
 const saved=await h.engine.saveBot(p);await h.engine.startBot(saved.id);await h.engine.tick();assert.equal(h.x.calls.length,2);const before={...h.x.quantities};
 h.x.now+=1000;await h.engine.tick();const view=h.engine.multi.view(h.engine.multi.get(saved.id));assert.equal(view.runtime.runEnabled,true);assert.equal(view.error,null);assert.equal(view.runtime.entryBlocked.reason,'min-notional');assert.equal(h.x.calls.length,2);assert.deepEqual(h.x.quantities,before);
 h.x.prices.BTCUSDT=101;h.x.now+=1000;await h.engine.tick();assert.equal(h.x.quantities.BTCUSDT,0);assert.equal(h.x.quantities.ETHUSDT,0);assert.equal(h.x.calls.length,4);assert.equal(h.engine.multi.get(saved.id).runtime.runEnabled,true);
});
test('a multi-symbol balance race after preflight cannot submit only later legs or permanently stop the parent',async()=>{
 const h=await harness(),p=config({exit:{takeProfitEnabled:false,stopLossEnabled:false}}),saved=await h.engine.saveBot(p);await h.engine.startBot(saved.id);
 const account=h.client.account.bind(h.client);h.client.account=async()=>{const value=await account();value.assets[0].availableBalance='0';return value;};
 await h.engine.tick();const view=h.engine.multi.view(h.engine.multi.get(saved.id));assert.equal(h.x.calls.length,0);assert.equal(view.runtime.runEnabled,true);assert.equal(view.error,null);assert.equal(view.runtime.entryBlocked.reason,'no-margin');
});

test('group statistics reset covers every leg, preserves capital and rejects a single held member',async()=>{
 const h=await harness(),p=await h.engine.saveBot(config({budgetMode:'pnl'})),root=h.engine.multi.get(p.id),workers=h.engine.multi.workers(root);workers[0].runtime.realized=-20;workers[1].runtime.realized=5;h.engine.multi.syncBudgets(root);
 workers[1].runtime.quantity=1;await assert.rejects(()=>h.engine.resetBotStatistics(p.id),/보유/);workers[1].runtime.quantity=0;
 const before=h.engine.multi.view(root).effectiveBudget,view=await h.engine.resetBotStatistics(p.id);assert.equal(view.statsReset.realized,-15);assert.equal(view.effectiveBudget,before);assert.deepEqual(view.members.map(b=>b.statsReset.realized),[-20,5]);assert.equal(view.runtime.runEnabled,false);assert.equal(h.x.calls.length,0);
 const saved=await h.engine.saveBot({...view,statsReset:{at:1,realized:100}});assert.deepEqual(saved.statsReset,view.statsReset);assert.deepEqual(saved.members.map(b=>b.statsReset),view.members.map(b=>b.statsReset));
 await assert.rejects(()=>h.engine.resetBotStatistics(workers[0].id),/전체/);
});

test('statistics reset refuses a group with a missing worker record',async()=>{const h=await harness(),p=await h.engine.saveBot(config());h.engine.state.bots=h.engine.state.bots.filter(b=>b.id!==p.id+'_B');await assert.rejects(()=>h.engine.resetBotStatistics(p.id),/누락/);assert.equal(h.engine.multi.get(p.id).statsReset,null);});

test('multi profiles exclude the whole parent budget, propagate membership, and reject member-level moves',async()=>{
 const {engine:e,x}=await harness(),p=await e.saveBot(config({budget:30000,budgetIncluded:false}));
 assert.equal(e.allocatedBudget(),0);assert.ok(e.multi.workers(e.multi.get(p.id)).every(b=>b.budgetIncluded===false));
 await assert.rejects(()=>e.startBot(p.id),/보관/);await assert.rejects(()=>e.serial(()=>e.budgetSelection.set(p.members[0].id,true)),/다중종목/);
 await assert.rejects(()=>e.serial(()=>e.budgetSelection.set(p.id,true)),/운용예산/);assert.equal(e.multi.get(p.id).budgetIncluded,false);
 await e.saveBot({...p,budget:100});await e.serial(()=>e.budgetSelection.set(p.id,true));assert.equal(e.allocatedBudget(),100);assert.ok(e.multi.workers(e.multi.get(p.id)).every(b=>b.budgetIncluded===true&&!b.runtime.runEnabled));
 await e.startBot(p.id);await e.serial(()=>e.budgetSelection.set(p.id,false));assert.equal(e.multi.get(p.id).runtime.runEnabled,false);assert.equal(e.allocatedBudget(),0);await e.tick();assert.equal(x.calls.length,0);
});
test('a single held leg blocks archiving the group and its entire allocation remains included',async()=>{
 const {engine:e}=await harness(),p=await e.saveBot(config({budget:100}));await e.startBot(p.id);await e.tick();await e.pauseBot(p.id);
 await assert.rejects(()=>e.serial(()=>e.budgetSelection.set(p.id,false)),/보유 포지션/);assert.equal(e.allocatedBudget(),100);assert.notEqual(e.multi.get(p.id).budgetIncluded,false);
});

test('maker rejection on one multi target keeps the group running and retries only that unaccepted target',async()=>{
 const {engine:e,x,client}=await harness(),p=config(),r=p.actionRules[0];r.targets[0].order={type:'LIMIT',price:'bid',ticks:0,timeout:10,remainder:'cancel',postOnly:true};const saved=await e.saveBot(p),send=client.placeOrder.bind(client),attempts=[];
 client.placeOrder=async parameters=>{attempts.push({...parameters});if(parameters.symbol==='BTCUSDT'&&attempts.filter(p=>p.symbol==='BTCUSDT').length===1)throw new BinanceError('maker',{code:-5022,status:400});return send(parameters);};await e.startBot(saved.id);await e.tick();const root=e.multi.get(saved.id),workers=e.multi.workers(root);
 assert.equal(root.runtime.runEnabled,true);assert.equal(root.runtime.error,null);assert.equal(workers[0].runtime.error,null);assert.equal(workers[0].runtime.quantity,0);assert.ok(workers[1].runtime.quantity>0);assert.ok(e.multi.view(root).runtime.orderRetry);
 x.now+=4999;await e.tick();assert.equal(attempts.length,2);x.now++;await e.tick();assert.equal(attempts.length,3);assert.equal(attempts.filter(p=>p.symbol==='ETHUSDT').length,1);assert.ok(workers[0].runtime.quantity>0);assert.equal(e.multi.view(root).runtime.orderRetry,null);assert.equal(root.runtime.runEnabled,true);
});

test('multi budget baseline restores the parent cap and per-symbol percentages without touching lifetime results',async()=>{
 const h=await harness(),p=await h.engine.saveBot(config({budgetMode:'pnl'})),root=h.engine.multi.get(p.id),workers=h.engine.multi.workers(root);workers[0].runtime.realized=-100;workers[1].runtime.realized=-50;h.engine.multi.syncBudgets(root);
 assert.deepEqual(h.engine.multi.view(root).members.map(b=>b.budget),[510,340]);const plan=await h.engine.budgetBaselines.preview(root.id);assert.equal(plan.before,850);await h.engine.budgetBaselines.commit(root.id,plan.previewId);
 const view=h.engine.multi.view(root);assert.equal(view.effectiveBudget,1000);assert.equal(view.runtime.realized,-150);assert.deepEqual(view.members.map(b=>b.budget),[600,400]);assert.equal(h.engine.allocatedBudget(),1000);assert.equal(h.x.calls.length,0);
 await assert.rejects(()=>h.engine.budgetBaselines.preview(workers[0].id),/다중종목/);const marker=structuredClone(root.runtime.budgetBaseline);await h.engine.saveBot({...root,name:'saved group'});assert.deepEqual(h.engine.multi.get(root.id).runtime.budgetBaseline,marker);
 const input={...root,budget:1100,budgetIncluded:true};const result=await h.engine.budgetSelection.inspect(input);assert.equal(result.requested,1100);
});
test('multi baseline keeps unassigned weights unused and fresh wallet changes can invalidate application',async()=>{
 const h=await harness(),p=await h.engine.saveBot(config({budgetMode:'capped',legs:[{alias:'A',symbol:'BTCUSDT',weight:40},{alias:'B',symbol:'ETHUSDT',weight:40}]})),root=h.engine.multi.get(p.id);h.engine.multi.workers(root)[0].runtime.realized=-200;
 let plan=await h.engine.budgetBaselines.preview(root.id);h.client.account=async()=>({canTrade:true,assets:[{asset:'USDT',walletBalance:'900',availableBalance:'900'}]});await assert.rejects(()=>h.engine.budgetBaselines.commit(root.id,plan.previewId),/초과/);assert.equal(root.runtime.budgetBaseline,undefined);
 root.budgetIncluded=false;plan=await h.engine.budgetBaselines.preview(root.id);await h.engine.budgetBaselines.commit(root.id,plan.previewId);assert.deepEqual(h.engine.multi.view(root).members.map(b=>b.budget),[400,400]);assert.equal(h.engine.allocatedBudget(),0);
});

test('multi reinvestment withholds each profitable leg before combining losses and allocates the resulting cap',async()=>{
 const h=await harness(),p=await h.engine.saveBot(config({budget:200,budgetMode:'pnl',profitReinvestPercent:50})),root=h.engine.multi.get(p.id),[a,b]=h.engine.multi.workers(root);
 a.runtime.realized+=100;h.engine.recordBudgetProfit(a,100);b.runtime.realized-=40;h.engine.recordBudgetProfit(b,-40);h.engine.multi.syncBudgets(root);assert.equal(h.engine.multi.view(root).effectiveBudget,210);assert.deepEqual(h.engine.multi.view(root).members.map(m=>m.budget),[126,84]);assert.equal(h.engine.allocatedBudget(),210);
 const plan=await h.engine.budgetBaselines.preview(root.id);await h.engine.budgetBaselines.commit(root.id,plan.previewId);assert.equal(h.engine.multi.view(root).effectiveBudget,200);assert.equal(root.runtime.budgetBaseline.withheld,50);
 await h.engine.saveBot({...root,profitReinvestPercent:25});const saved=h.engine.multi.get(root.id);assert.equal(saved.runtime.budgetWithheld,50);assert.equal(saved.profitReinvestPercent,25);assert.equal(h.engine.multi.view(saved).effectiveBudget,200);
 for(const value of [-1,101,'50'])await assert.rejects(()=>h.engine.saveBot({...saved,profitReinvestPercent:value}),/비율/);
});

test('retiring a flat multi leg preserves prior budget PnL and a reset baseline instead of creating artificial profit',async()=>{
 const h=await harness(),p=await h.engine.saveBot(config({budgetMode:'pnl'})),root=h.engine.multi.get(p.id),[a,b]=h.engine.multi.workers(root);a.runtime.realized=-100;b.runtime.realized=-50;const plan=await h.engine.budgetBaselines.preview(root.id);await h.engine.budgetBaselines.commit(root.id,plan.previewId);
 const legs=[{alias:'A',symbol:'BTCUSDT',weight:50},{alias:'C',symbol:'SOLUSDT',weight:50}];await h.engine.saveBot({...root,legs,actionRules:[multiRule(legs)]});const saved=h.engine.multi.get(root.id);assert.equal(h.engine.multi.view(saved).effectiveBudget,1000);assert.equal(h.engine.multi.realized(saved),-150);assert.equal(h.engine.allocatedBudget(),1000);
});

test('multi-symbol wallet percentage budgets resolve once at the root and split the live limit by weights',async()=>{
 const h=await harness();let wallet=800;h.client.account=async()=>({canTrade:true,assets:[{asset:'USDT',walletBalance:String(wallet),availableBalance:String(wallet)}]});const p=config({budgetType:'walletPercent',budgetPercent:50,budgetShortfall:'available'});await h.engine.saveBot(p);let view=h.engine.multi.view(h.engine.multi.get(p.id));assert.equal(view.effectiveBudget,400);assert.deepEqual(view.members.map(m=>m.effectiveBudget),[240,160]);wallet=400;await h.engine.refreshAccount(true);h.engine.multi.syncBudgets(h.engine.multi.get(p.id));view=h.engine.multi.view(h.engine.multi.get(p.id));assert.equal(view.effectiveBudget,200);assert.deepEqual(view.members.map(m=>m.effectiveBudget),[120,80]);await h.engine.startBot(p.id);await h.engine.tick();assert.equal(h.engine.multi.get(p.id).runtime.runEnabled,true);assert.ok(h.engine.multi.view(h.engine.multi.get(p.id)).used<=200);assert.ok(h.engine.allocatedBudget()<=wallet);
});

test('multi-symbol minimum budget belongs to the parent and is distributed only once',async()=>{const h=await harness(),p=await h.engine.saveBot(config({budget:100,budgetMode:'floor',budgetFloor:30,profitReinvestPercent:50})),root=h.engine.multi.get(p.id),workers=h.engine.multi.workers(root);workers[0].runtime.realized=-100;await h.engine.checkpoint();h.engine.multi.syncBudgets(root);assert.equal(h.engine.multi.view(root).effectiveBudget,30);assert.deepEqual(workers.map(b=>b.budget),[18,12]);workers[0].runtime.realized=-30;root.runtime.budgetWithheld=20;await h.engine.checkpoint();h.engine.multi.syncBudgets(root);assert.equal(h.engine.multi.view(root).effectiveBudget,50);assert.deepEqual(workers.map(b=>b.budget),[30,20]);assert.equal(workers[0].runtime.budgetFloorCredit,undefined);});

test('a worker waiting for protective cancellation keeps the multi-symbol parent running',async()=>{const h=await harness(),algos=new Map();h.client.placeAlgo=async p=>{const o={...p,algoStatus:'NEW',algoId:algos.size+1};algos.set(p.clientAlgoId,o);return {...o};};h.client.queryAlgo=async id=>({...algos.get(id)});h.client.cancelAlgo=async()=>({code:200});const p=await h.engine.saveBot(config({exit:{takeProfitEnabled:false,stopLossEnabled:true,stopLoss:3,takeProfit:5,price:'MARK_PRICE'}}));await h.engine.startBot(p.id);await h.engine.tick();const parent=h.engine.multi.get(p.id),workers=h.engine.multi.workers(parent),before=h.x.calls.length;h.x.prices.BTCUSDT=80;await h.engine.tick();assert.ok(workers[0].runtime.closePending);assert.equal(parent.runtime.runEnabled,true);assert.equal(parent.runtime.error,null);assert.equal(workers[0].runtime.error,null);assert.equal(h.x.calls.length,before);h.client.cancelAlgo=async id=>{algos.get(id).algoStatus='CANCELED';return {};};h.x.now+=6000;await h.engine.tick();assert.equal(workers[0].runtime.quantity,0);assert.ok(workers[1].runtime.quantity>0);assert.equal(parent.runtime.runEnabled,true);assert.equal(parent.runtime.error,null);});

async function pendingMultiDeadline(){
 const h=await harness(),send=h.client.placeOrder.bind(h.client);h.client.placeOrder=async p=>{if(p.type!=='LIMIT')return send(p);h.x.calls.push({...p});const o={...p,orderId:h.x.orders.size+1,clientOrderId:p.newClientOrderId,origQty:p.quantity,executedQty:'0',cumQuote:'0',avgPrice:'0',status:'NEW'};h.x.orders.set(p.newClientOrderId,o);return {...o};};
 const cfg=config({exit:{takeProfitEnabled:false,stopLossEnabled:false}});for(const rule of cfg.actionRules)for(const target of rule.targets||[])target.order={type:'LIMIT',price:'bid',ticks:0,timeout:5,remainder:'market',postOnly:false};
 const p=await h.engine.multi.save(cfg);await h.engine.multi.start(p.id);await h.engine.tick();return {...h,p:h.engine.multi.get(p.id)};
}
test('multi-symbol deadline pass settles accepted legs once without starting a new allocation batch',async()=>{
 const h=await pendingMultiDeadline();assert.equal(h.x.calls.filter(o=>o.type==='LIMIT').length,2);h.x.now+=5000;await h.engine.tick({deadlinesOnly:true});await h.engine.tick({deadlinesOnly:true});assert.equal(h.x.calls.filter(o=>o.type==='MARKET').length,2);assert.equal(h.x.calls.filter(o=>o.type==='LIMIT').length,2);assert.ok(h.engine.multi.workers(h.p).every(b=>b.runtime.quantity>0));assert.equal(h.p.runtime.runEnabled,true);
});
test('multi-symbol stop rules retain priority over a due entry remainder',async()=>{
 const h=await pendingMultiDeadline();h.p.actionRules.unshift({id:'deadline-stop',enabled:true,action:'STOP_BOT',formula:'(A.종가 > 100)@1m'});h.x.prices.BTCUSDT=101;h.x.now+=5000;await h.engine.tick({deadlinesOnly:true});assert.equal(h.p.runtime.runEnabled,false);assert.equal(h.x.calls.filter(o=>o.type==='MARKET').length,0);assert.ok([...h.x.orders.values()].every(o=>o.status==='CANCELED'));
});

test('deleting a flat multi bot keeps its group identity and worker ownership for individual statistics',async()=>{
 const h=await harness(),p=await h.engine.multi.save(config({exit:{takeProfitEnabled:false,stopLossEnabled:false}}));await h.engine.multi.start(p.id);await h.engine.tick();await h.engine.multi.close(p.id);const ids=h.engine.multi.workers(p).map(b=>b.id),fills=JSON.stringify(h.engine.state.fills);await h.engine.multi.remove(p.id);assert.equal(h.engine.multi.groups.length,0);const profile=h.engine.state.deletedBots.find(b=>b.id===p.id&&b.scope===h.engine.state.scope);assert.equal(profile.name,p.name);assert.equal(profile.kind,'multi');assert.ok(ids.every(id=>profile.memberIds.includes(id)));assert.equal(JSON.stringify(h.engine.state.fills),fills);const r=await h.engine.tradeHistory.get(p.id);assert.equal(r.bot.deleted,true);assert.equal(r.trades.length,2);
});

test('a multi bot shares one available-balance basis across legs and preserves it after its own fills',async()=>{
 const h=await harness();let external=600;h.client.account=async()=>({canTrade:true,assets:[{asset:'USDT',walletBalance:'800',availableBalance:String(Math.max(0,800-external-Object.entries(h.x.quantities).reduce((n,[symbol,q])=>n+Math.abs(q)*(h.x.entryPrices[symbol]||100)/h.x.config[symbol].leverage,0)))}]});
 const p=config({budgetType:'availablePercent',budgetPercent:50,budgetShortfall:'available'});await h.engine.saveBot(p);let view=h.engine.multi.view(h.engine.multi.get(p.id));assert.equal(view.effectiveBudget,100);assert.deepEqual(view.members.map(m=>m.effectiveBudget),[60,40]);await h.engine.startBot(p.id);await h.engine.tick();await h.engine.refreshAccount(true);h.engine.multi.syncBudgets(h.engine.multi.get(p.id));view=h.engine.multi.view(h.engine.multi.get(p.id));assert.ok(view.members.every(m=>m.quantity>0));assert.ok(Math.abs(view.effectiveBudget-100)<1e-8);assert.ok(view.used<=100);
 const quantities=view.members.map(m=>m.quantity);external=650;await h.engine.refreshAccount(true);h.engine.multi.syncBudgets(h.engine.multi.get(p.id));view=h.engine.multi.view(h.engine.multi.get(p.id));assert.ok(Math.abs(view.effectiveBudget-75)<1e-8);assert.deepEqual(view.members.map(m=>m.quantity),quantities);assert.equal(view.runtime.runEnabled,true);
});


test('multi-symbol recovery is a parent budget shared across workers and keeps the grown capital basis',async()=>{const h=await harness(),p=await h.engine.saveBot(config({budget:100,budgetMode:'pnl',budgetRecovery:'full',budgetLossCarry:'carry',profitReinvestPercent:50})),root=h.engine.multi.get(p.id),workers=h.engine.multi.workers(root);const settle=(b,amount)=>{b.runtime.realized+=amount;h.engine.recordBudgetProfit(b,amount);h.engine.multi.syncBudgets(root);};settle(workers[0],100);assert.equal(h.engine.multi.view(root).effectiveBudget,150);settle(workers[1],-40);assert.equal(h.engine.multi.view(root).effectiveBudget,110);assert.equal(root.runtime.budgetRecoveryDebt,40);settle(workers[0],60);assert.equal(h.engine.multi.view(root).effectiveBudget,160);assert.equal(root.runtime.budgetWithheld,60);assert.equal(root.runtime.budgetRecoveryDebt,0);assert.deepEqual(workers.map(b=>b.budget),[96,64]);const saved=await h.engine.saveBot({...h.engine.multi.view(root)});assert.equal(saved.budgetRecovery,'full');assert.equal(saved.budgetLossCarry,'carry');assert.equal(saved.effectiveBudget,160);});

test('multi-symbol zero carry and a budget baseline reset preserve actual member losses',async()=>{const h=await harness(),p=await h.engine.saveBot(config({budget:100,budgetMode:'floor',budgetFloor:30,budgetRecovery:'full',budgetLossCarry:'zero',profitReinvestPercent:50})),root=h.engine.multi.get(p.id),a=h.engine.multi.workers(root)[0];a.runtime.realized=-150;h.engine.recordBudgetProfit(a,-150);h.engine.multi.syncBudgets(root);assert.equal(root.runtime.budgetLossCredit,50);assert.equal(root.runtime.budgetRecoveryDebt,100);assert.equal(h.engine.multi.view(root).effectiveBudget,30);const plan=await h.engine.budgetBaselines.preview(root.id);assert.equal(plan.after,100);await h.engine.budgetBaselines.commit(root.id,plan.previewId);assert.equal(h.engine.multi.view(root).effectiveBudget,100);assert.equal(a.runtime.realized,-150);assert.equal(root.runtime.budgetRecoveryDebt,0);a.runtime.realized+=40;h.engine.recordBudgetProfit(a,40);h.engine.multi.syncBudgets(root);assert.equal(h.engine.multi.view(root).effectiveBudget,120);});
