import test from 'node:test';
import assert from 'node:assert/strict';
import {TradingEngine} from '../backend/engine.mjs';
import {BinanceError} from '../backend/binance.mjs';
import {emptyState} from '../backend/store.mjs';
import {makeBot,validateBot} from '../public/core.js';
import {ACTIONS,isEntry,isSwitch,makeActionRule} from '../public/actions.js';
import {makeMultiBot,multiRule,multiTarget,validateMulti} from '../public/multi-bot.js';

const off={takeProfitEnabled:false,stopLossEnabled:false};
const market={type:'MARKET',price:'ask',ticks:0,timeout:1,remainder:'cancel',postOnly:false};
const rule=(action,extra={})=>makeActionRule({id:action,action,formula:'(종가 > 50)@1m',sizePercent:50,leverage:3,order:{...market},reentry:{mode:'bar',cooldown:0,afterExitCooldown:0},...extra});
const info=symbol=>({symbol,status:'TRADING',quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL',filters:[{filterType:'PRICE_FILTER',tickSize:'0.1'},{filterType:'LOT_SIZE',minQty:'0.001',maxQty:'10000',stepSize:'0.001'},{filterType:'MARKET_LOT_SIZE',minQty:'0.001',maxQty:'10000',stepSize:'0.001'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
async function harness({multi=false}={}){
 const store={state:emptyState(),saved:[],async load(){},async save(){if(this.fail)throw Object.assign(Error('disk full'),{code:'ENOSPC'});this.saved.push(structuredClone(this.state));}};
 const x={now:1800000000000,flag:true,wallet:1000,available:1000,releaseFunds:false,quantities:{},orders:new Map(),calls:[],config:{},delayClose:false,uncertainEntry:false};
 for(const symbol of ['BTCUSDT','ETHUSDT'])x.config[symbol]={symbol,marginType:'ISOLATED',leverage:3};
 x.fill=(id,amount)=>{const o=x.orders.get(id),delta=amount-Number(o.executedQty);x.quantities[o.symbol]=(x.quantities[o.symbol]||0)+delta*(o.side==='BUY'?1:-1);if(Math.abs(x.quantities[o.symbol])<1e-9)x.quantities[o.symbol]=0;Object.assign(o,{executedQty:String(amount),cumQuote:String(amount*100),avgPrice:'100',status:amount>=Number(o.origQty)-1e-9?'FILLED':'PARTIALLY_FILLED'});return o;};
 const client={offset:0,clearCredentials(){},redact:s=>s,async syncTime(){return x.now;},async exchangeInfo(){return {symbols:['BTCUSDT','ETHUSDT'].map(info)};},async tickers(){return ['BTCUSDT','ETHUSDT'].map(symbol=>({symbol,lastPrice:'100'}));},async book(){return {bids:[['100','100']],asks:[['100','100']]};},async premium(){return {markPrice:'100'};},
  async klines(symbol,interval){const t=Math.floor(x.now/60000)*60;return Array.from({length:80},(_,i)=>({time:t-(79-i)*60,closeTime:(t-(79-i)*60)*1000+59999,open:100,high:101,low:1,close:x.flag?100:1,volume:10}));},
  async account(){const available=x.releaseFunds?(Object.values(x.quantities).some(q=>q)?0:x.available):x.available;return {canTrade:true,assets:[{asset:'USDT',walletBalance:String(x.wallet),availableBalance:String(available)}]};},async positionMode(){return {dualSidePosition:false};},
  async positions(){return Object.entries(x.quantities).filter(([,q])=>q).map(([symbol,q])=>({symbol,positionSide:'BOTH',positionAmt:String(q),entryPrice:'100',markPrice:'100',positionInitialMargin:String(Math.abs(q)*100/x.config[symbol].leverage),unRealizedProfit:'0'}));},
  async openOrders(symbol){return [...x.orders.values()].filter(o=>(!symbol||o.symbol===symbol)&&['NEW','PARTIALLY_FILLED'].includes(o.status));},async openAlgoOrders(){return [];},async symbolConfig(symbol){return symbol?[x.config[symbol]]:Object.values(x.config);},async leverageBrackets(){return [{brackets:[{initialLeverage:125,notionalFloor:0,notionalCap:1000000}]}];},async changeMargin(s,m){x.config[s].marginType=m;return{};},async changeLeverage(s,l){x.config[s].leverage=l;return {leverage:l};},
  async placeOrder(p){x.calls.push(structuredClone(p));const o={...p,clientOrderId:p.newClientOrderId,orderId:x.orders.size+1,origQty:p.quantity,executedQty:'0',cumQuote:'0',status:'NEW'};x.orders.set(p.newClientOrderId,o);if(p.type==='MARKET'&&!(x.delayClose&&p.reduceOnly==='true'))x.fill(p.newClientOrderId,Number(p.quantity));if(x.uncertainEntry&&p.reduceOnly!=='true'){x.uncertainEntry=false;throw new BinanceError('lost response',{uncertain:true});}return structuredClone(o);},
  async queryOrder(symbol,id){const o=x.orders.get(id);if(!o)throw new BinanceError('missing',{code:-2013});return structuredClone(o);},async cancelOrder(symbol,id){const o=x.orders.get(id);if(o.status!=='FILLED')o.status='CANCELED';return structuredClone(o);},async trades(){return [];},async income(){return [];}
 };
 const e=await new TradingEngine(store,{now:()=>x.now,clientFactory:()=>client}).init();await e.connect({environment:'testnet',apiKey:'fabricated-switch-key',secret:'fabricated-switch-secret',allowTrading:true});
 let b,p;
 if(multi){const legs=[{alias:'A',symbol:'BTCUSDT',weight:50},{alias:'B',symbol:'ETHUSDT',weight:50}];p=await e.saveBot(makeMultiBot({budget:200,legs,exit:off,actionRules:[multiRule(legs,{id:'initial',formula:'TRUE@1m',targets:[multiTarget('A',{sizePercent:50})]})]}));await e.startBot(p.id);b=e.multi.workers(e.multi.get(p.id))[0];}
 else{b=await e.saveBot(makeBot({budget:100,exit:off,actionRules:[rule('ENTER_LONG')]}));await e.startBot(b.id);b=e.bot(b.id);}
 await e.tick();
 const switchTo=(action='SWITCH_SHORT',extra={})=>{if(multi){const group=e.multi.get(p.id);group.actionRules=[multiRule(group.legs,{id:action,formula:'(종가 > 50)@1m',reentry:{mode:'bar',cooldown:0,afterExitCooldown:0},targets:[multiTarget('A',{action,sizePercent:50,...extra})]})];}else b.actionRules=[rule(action,extra)];};
 return {e,x,store,client,b,p,switchTo,step:async(ms=2000)=>{x.now+=ms;await e.tick();}};
}

test('switch actions validate entry settings for single and multi bots and restrict close scope to this bot',()=>{
 for(const action of ['SWITCH_LONG','SWITCH_SHORT']){assert.ok(ACTIONS[action]);assert.ok(isEntry(action));assert.ok(isSwitch(action));const b=makeBot({exit:off,actionRules:[rule(action)]});assert.deepEqual(validateBot(b,[],{symbols:['BTCUSDT']}),[]);b.actionRules[0].leverage=0;assert.ok(validateBot(b,[],{symbols:['BTCUSDT']}).some(s=>s.includes('레버리지')));b.actionRules[0]=rule(action,{closeScope:'account'});assert.ok(validateBot(b,[],{symbols:['BTCUSDT']}).some(s=>s.includes('스위칭')));}
 const p=makeMultiBot({exit:off});p.actionRules[0].targets[0].action='SWITCH_SHORT';assert.deepEqual(validateMulti(p,{symbols:['BTCUSDT','ETHUSDT']}),[]);
});

test('a switch waits for the close, refreshes released funds, enters once and keeps an existing target holding',async()=>{
 const h=await harness();h.switchTo();h.x.available=50;h.x.releaseFunds=true;await h.step();
 assert.equal(h.x.calls.length,3);assert.equal(h.x.calls[1].reduceOnly,'true');assert.equal(h.x.calls[1].side,'SELL');assert.equal(h.x.calls[2].side,'SELL');assert.equal(h.b.runtime.direction,'SHORT');assert.ok(Number(h.x.calls[2].quantity)>1.48&&Number(h.x.calls[2].quantity)<1.49);assert.equal(h.b.runtime.switchPending,undefined);
 await h.step(60000);await h.step();assert.equal(h.x.calls.length,3);
});

test('delayed and partial market closes cannot enter early and retain the switch signal across bars',async()=>{
 const h=await harness();h.switchTo();h.x.delayClose=true;await h.step();assert.equal(h.x.calls.length,2);assert.equal(h.b.runtime.switchPending.phase,'closing');
 const close=h.x.calls[1];h.x.fill(close.newClientOrderId,Number(close.quantity)/2);h.x.flag=false;await h.step(60000);assert.equal(h.x.calls.length,2);assert.ok(h.b.runtime.quantity>0);
 h.x.fill(close.newClientOrderId,Number(close.quantity));await h.step(4000);assert.equal(h.x.calls.length,3);assert.equal(h.b.runtime.direction,'SHORT');assert.equal(h.b.runtime.switchPending,undefined);await h.step();assert.equal(h.x.calls.length,3);
});

test('capacity waits retain the operation without consuming another signal and resume after funds recover',async()=>{
 const h=await harness();h.switchTo();h.x.available=.01;await h.step();assert.equal(h.x.calls.length,2);assert.equal(h.b.runtime.quantity,0);assert.equal(h.b.runtime.switchPending.phase,'entry');assert.match(h.b.runtime.waiting.message,/최소|증거금/);
 h.x.flag=false;await h.step(60000);assert.equal(h.x.calls.length,2);h.x.available=100;await h.step(16000);assert.equal(h.x.calls.length,3);assert.equal(h.b.runtime.direction,'SHORT');assert.equal(h.b.runtime.switchPending,undefined);
});

test('stopping cancels a pending switch and never opens the new side after the close fills',async()=>{
 const h=await harness();h.switchTo();h.x.delayClose=true;await h.step();const close=h.x.calls[1];await h.e.pauseBot(h.b.id);assert.equal(h.b.runtime.switchPending,undefined);h.x.fill(close.newClientOrderId,Number(close.quantity));await h.step(60000);assert.equal(h.x.calls.length,2);assert.equal(h.b.runtime.runEnabled,false);
});

test('a pending switch remains stopped after restart and resumes only on an explicit start',async()=>{
 const h=await harness();h.switchTo();h.x.delayClose=true;await h.step();const close=h.x.calls[1];const restored=await new TradingEngine(h.store,{now:()=>h.x.now,clientFactory:()=>h.client}).init();await restored.connect({environment:'testnet',apiKey:'fabricated-switch-key',secret:'fabricated-switch-secret',allowTrading:true});
 assert.equal(restored.bot(h.b.id).runtime.switchPending.id,h.b.runtime.switchPending.id);h.x.flag=false;h.x.fill(close.newClientOrderId,Number(close.quantity));h.x.now+=60000;await restored.tick();assert.equal(h.x.calls.length,2);assert.equal(restored.bot(h.b.id).runtime.runEnabled,false);await restored.startBot(h.b.id);await restored.tick();assert.equal(h.x.calls.length,3);await restored.tick();assert.equal(h.x.calls.length,3);
});

test('an uncertain accepted switch entry is recovered without sending it twice',async()=>{
 const h=await harness();h.switchTo();h.x.uncertainEntry=true;await h.step();assert.equal(h.x.calls.length,3);assert.equal(h.b.runtime.runEnabled,false);await h.step();assert.equal(h.x.calls.length,3);await h.e.startBot(h.b.id);await h.step();assert.equal(h.x.calls.length,3);assert.equal(h.b.runtime.direction,'SHORT');assert.equal(h.b.runtime.switchPending,undefined);
});

test('a limit switch entry follows its remainder policy and counts as one operation',async()=>{
 const h=await harness();h.switchTo('SWITCH_SHORT',{order:{...market,type:'LIMIT',remainder:'market'}});await h.step();assert.equal(h.x.calls.length,3);assert.equal(h.b.runtime.switchPending.phase,'entering');const limit=h.x.calls[2];h.x.fill(limit.newClientOrderId,Math.floor(Number(limit.quantity)*500)/1000);await h.step(4000);assert.equal(h.x.calls.length,4);assert.equal(h.b.runtime.direction,'SHORT');assert.equal(h.b.runtime.entries,1);assert.equal(h.b.runtime.switchPending,undefined);await h.step();assert.equal(h.x.calls.length,4);
});

test('storage failure before recording a switch prevents the closing order',async()=>{
 const h=await harness();h.switchTo();h.store.fail=true;await assert.rejects(()=>h.step(),error=>error.storage);assert.equal(h.x.calls.length,1);
});

test('a multi target switches independently and continues after a delayed close crosses the signal bar',async()=>{
 const h=await harness({multi:true});h.switchTo();h.x.delayClose=true;await h.step();assert.equal(h.x.calls.length,2);const close=h.x.calls[1];h.x.flag=false;h.x.fill(close.newClientOrderId,Number(close.quantity));await h.step(60000);assert.equal(h.x.calls.length,3);assert.equal(h.b.runtime.direction,'SHORT');assert.equal(h.b.runtime.switchPending,undefined);await h.step();assert.equal(h.x.calls.length,3);
});

test('a multi stop condition preempts a pending switch',async()=>{
 const h=await harness({multi:true});h.switchTo();h.x.delayClose=true;await h.step();const p=h.e.multi.get(h.p.id);p.actionRules.unshift(multiRule(p.legs,{action:'STOP_BOT',formula:'TRUE@1m'}));await h.step();assert.equal(p.runtime.runEnabled,false);assert.equal(h.b.runtime.switchPending,undefined);assert.equal(h.x.calls.length,2);
});

test('opposing switch signals hold an existing position without starting a flip',async()=>{
 const h=await harness();h.b.actionRules=[rule('SWITCH_LONG'),rule('SWITCH_SHORT')];await h.step();assert.equal(h.x.calls.length,1);assert.equal(h.b.runtime.direction,'LONG');assert.equal(h.b.runtime.lastEvaluation.conflict,true);
});

test('a switch uses the requested entry leverage after fully releasing the old position',async()=>{
 const h=await harness();h.switchTo('SWITCH_SHORT',{leverage:5});await h.step();assert.equal(h.x.calls.length,3);assert.equal(h.x.config.BTCUSDT.leverage,5);assert.equal(h.b.leverage,5);assert.ok(Number(h.x.calls[2].quantity)>2.47);assert.equal(h.b.runtime.switchPending,undefined);
});

test('user-requested full close cancels a delayed switch and keeps the bot stopped',async()=>{
 const h=await harness();h.switchTo();h.x.delayClose=true;await h.step();const close=h.x.calls[1];await h.e.closeBot(h.b.id);assert.equal(h.b.runtime.switchPending,undefined);h.x.fill(close.newClientOrderId,Number(close.quantity));await h.step(4000);assert.equal(h.x.calls.length,2);assert.equal(h.b.runtime.quantity,0);assert.equal(h.b.runtime.runEnabled,false);assert.equal(h.b.runtime.closePending,undefined);
});

test('disabling order permission cancels a pending switch rather than resuming it on re-enable',async()=>{
 const h=await harness();h.switchTo();h.x.available=.01;await h.step();assert.ok(h.b.runtime.switchPending);await h.e.setTrading(false);assert.equal(h.b.runtime.switchPending,undefined);await h.e.setTrading(true);await h.step(60000);assert.equal(h.x.calls.length,2);assert.equal(h.b.runtime.runEnabled,false);
});
