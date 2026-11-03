import test from 'node:test';
import assert from 'node:assert/strict';
import {TradingEngine} from '../backend/engine.mjs';
import {BinanceError} from '../backend/binance.mjs';
import {manualPlan} from '../backend/manual-trading.mjs';
import {emptyState} from '../backend/store.mjs';
import {makeBot} from '../public/core.js';
import {createServer} from '../server.mjs';
import {readFavorites,toggleFavorite} from '../public/favorites.js';

test('bot-attributed manual orders update the stopped bot ledger, fees and budget while external orders remain separate',async()=>{
  const {engine,exchange}=await harness();exchange.updatePosition=true;
  const bot=await engine.saveBot(makeBot({symbol:'INTCUSDT',name:'INTC 관리',budget:100,margin:'ISOLATED',leverage:3,exit:{takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'}}));
  const first=await engine.serial(()=>engine.manual.preview({...input,botId:bot.id,type:'MARKET',amount:'1'}));
  assert.equal(first.botId,bot.id);assert.equal(exchange.calls.length,0);
  const filled=await engine.serial(()=>engine.manual.submit(first.id));assert.equal(filled.status,'FILLED');assert.equal(filled.botId,bot.id);
  const runtime=engine.bot(bot.id).runtime;assert.equal(runtime.quantity,1);assert.equal(runtime.entries,1);assert.equal(runtime.runEnabled,false);assert.equal(runtime.realized,-.01);assert.equal(runtime.syncHold,false);
  await engine.serial(()=>engine.manual.submit(first.id));assert.equal(exchange.calls.filter(c=>c.method==='place').length,1);
  await assert.rejects(()=>engine.serial(()=>engine.manual.preview(input)),/정지는 신규 진입만/);
  await assert.rejects(()=>engine.serial(()=>engine.manual.preview({...input,botId:bot.id,amount:'3'})),/운용예산/);
  await assert.rejects(()=>engine.serial(()=>engine.manual.preview({...input,botId:bot.id,direction:'SHORT'})),/반대 방향/);
  const close=await engine.serial(()=>engine.manual.preview({...input,botId:bot.id,action:'CLOSE',type:'MARKET',amount:'.5'.replace(/^\./,'0.')}));
  await engine.serial(()=>engine.manual.submit(close.id));assert.equal(runtime.quantity,.5);assert.equal(runtime.syncHold,false);assert.equal(engine.state.fills.filter(f=>f.quantity).every(f=>f.botId===bot.id),true);
});

test('bot ownership changes, pending orders and budget changes invalidate a previously confirmed manual plan',async()=>{
  const {engine}=await harness();const bot=await engine.saveBot(makeBot({symbol:'INTCUSDT',budget:100,margin:'ISOLATED',leverage:3,exit:{takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'}}));
  const preview=await engine.serial(()=>engine.manual.preview({...input,botId:bot.id}));engine.bot(bot.id).budget=10;
  await assert.rejects(()=>engine.serial(()=>engine.manual.submit(preview.id)),/운용예산/);engine.bot(bot.id).budget=100;
  const result=await engine.serial(()=>engine.manual.submit(preview.id));assert.equal(result.status,'NEW');
  await assert.rejects(()=>engine.serial(()=>engine.manual.preview({...input,botId:bot.id})),/미체결 일반 주문/);
  await engine.cancelBotOrder(bot.id,result.id);assert.equal(engine.state.orders.find(o=>o.id===result.id).status,'CANCELED');
  await assert.rejects(()=>engine.serial(()=>engine.manual.preview({...input,symbol:'SPOTUSDT',botId:bot.id})),/USDT/);
});

test('a guard filling during cancellation aborts the manual close, and an uncertain bot fill is recovered once',async()=>{
  const {engine,exchange}=await harness();exchange.updatePosition=true;const bot=await engine.saveBot(makeBot({symbol:'INTCUSDT',budget:100,margin:'ISOLATED',leverage:3,exit:{takeProfitEnabled:false,stopLossEnabled:false,price:'MARK_PRICE'}}));
  const entry=await engine.serial(()=>engine.manual.preview({...input,botId:bot.id,type:'MARKET',amount:'1'}));exchange.uncertain=true;
  const unknown=await engine.serial(()=>engine.manual.submit(entry.id));assert.equal(unknown.status,'FILLED');assert.equal(engine.bot(bot.id).runtime.quantity,1);await engine.serial(()=>engine.manual.submit(entry.id));assert.equal(exchange.calls.filter(c=>c.method==='place').length,1);exchange.uncertain=false;
  const guard={id:'guard-race',scope:engine.state.scope,botId:bot.id,kind:'algo',role:'stop',status:'NEW',parameters:{symbol:'INTCUSDT'},appliedQty:0,feesFetched:true};engine.state.orders.push(guard);
  const refresh=engine.refreshOrder.bind(engine);engine.refreshOrder=async(b,o)=>{if(o===guard)return;return refresh(b,o);};
  const preview=await engine.serial(()=>engine.manual.preview({...input,botId:bot.id,action:'CLOSE',type:'MARKET',amount:'0.25'}));
  engine.cancelGuard=async()=>{guard.status='CANCELED';engine.bot(bot.id).runtime.quantity=.5;exchange.positions=[{quantity:.5}];};
  const result=await engine.serial(()=>engine.manual.submit(preview.id));assert.equal(result.status,'REJECTED');assert.match(result.error,/保護|보호 주문 처리/);assert.equal(exchange.calls.filter(c=>c.method==='place').length,1);assert.equal(engine.bot(bot.id).runtime.quantity,.5);
});

test('commission IDs are isolated by account and symbol and old fee records are not charged twice',async()=>{
  const {engine,exchange}=await harness(),bots=['INTCUSDT','BTCUSDT'].map((symbol,i)=>makeBot({id:'fee-bot-'+i,symbol,runtime:{quantity:1,entryPrice:100,direction:'LONG',realized:0}}));engine.state.bots.push(...bots);
  for(const b of bots){const id='fee-order-'+b.id,order={id,botId:b.id,scope:engine.state.scope,kind:'standard',role:'entry',direction:'LONG',status:'FILLED',parameters:{symbol:b.symbol},orderId:37,appliedQty:1,appliedQuote:100,feesFetched:false};engine.state.orders.push(order);exchange.orders.set(id,{status:'FILLED',executedQty:'1',cumQuote:'100',orderId:37});await engine.refreshOrder(b,order);assert.equal(b.runtime.realized,-.01);order.feesFetched=false;await engine.refreshOrder(b,order);assert.equal(b.runtime.realized,-.01);}
  assert.equal(engine.state.fills.filter(f=>f.fee!=null).length,2);
  const b=bots[0],order=engine.ownOrders(b)[0],fee=engine.state.fills.find(f=>f.botId===b.id);fee.id='fee:37:1';order.feesFetched=false;await engine.refreshOrder(b,order);assert.equal(b.runtime.realized,-.01);
});

const info={symbol:'INTCUSDT',baseAsset:'INTC',quoteAsset:'USDT',marginAsset:'USDT',contractType:'TRADIFI_PERPETUAL',status:'TRADING',filters:[{filterType:'PRICE_FILTER',tickSize:'0.1',minPrice:'0.1',maxPrice:'100000'},{filterType:'LOT_SIZE',minQty:'0.1',maxQty:'10000',stepSize:'0.1'},{filterType:'MARKET_LOT_SIZE',minQty:'0.1',maxQty:'10000',stepSize:'0.1'},{filterType:'MIN_NOTIONAL',notional:'5'}]};
const input={market:'usdm',symbol:'INTCUSDT',action:'OPEN',direction:'LONG',type:'LIMIT',sizeMode:'quantity',amount:'1.3',price:'100.1',leverage:3,margin:'ISOLATED',timeInForce:'GTC'};
class Store{constructor(state=emptyState()){this.state=structuredClone(state);this.fail=false;this.saved=[];}async load(){return this.state;}async save(){if(this.fail)throw Error('disk full');this.saved.push(structuredClone(this.state));}}
class Exchange{
  constructor(){this.calls=[];this.orders=new Map();this.positions=[];this.config={symbol:'INTCUSDT',marginType:'ISOLATED',leverage:3};this.hedge=false;this.balance=1000;this.uncertain=false;this.reject=false;this.now=1800000000000;this.next=1;}
}
class Client{
  constructor(exchange){this.e=exchange;this.offset=0;}
  clearCredentials(){}redact(text){return String(text);}async syncTime(){return this.e.now;}
  async exchangeInfo(){return {symbols:[info,{...info,symbol:'SPOTUSDT',marginAsset:'BTC'}]};}
  async book(){return {bids:[['100','10']],asks:[['100.1','10']]};}
  async positionMode(){return {dualSidePosition:this.e.hedge};}
  async openAlgoOrders(){return [];}
  async trades(){return [{id:1,time:this.e.now,commission:'0.01',commissionAsset:'USDT'}];}
  async symbolConfig(){return [{...this.e.config}];}
  async leverageBrackets(){return [{symbol:'INTCUSDT',brackets:[{initialLeverage:20,notionalFloor:0,notionalCap:10000},{initialLeverage:5,notionalFloor:10000,notionalCap:100000}]}];}
  async account(){return {canTrade:true,assets:[{asset:'USDT',walletBalance:String(this.e.balance),availableBalance:String(this.e.balance)}]};}
  async positions(){return this.e.positions.map(p=>({symbol:'INTCUSDT',positionSide:p.side||'BOTH',positionAmt:String(p.quantity),entryPrice:'100',markPrice:'100',unRealizedProfit:'0'}));}
  async openOrders(){return [...this.e.orders.values()].filter(o=>['NEW','PARTIALLY_FILLED'].includes(o.status));}
  async changeMargin(symbol,margin){this.e.calls.push({method:'margin',symbol,margin});this.e.config.marginType=margin;return {code:200};}
  async changeLeverage(symbol,leverage){this.e.calls.push({method:'leverage',symbol,leverage});this.e.config.leverage=leverage;return {leverage};}
  async placeOrder(parameters){
    this.e.calls.push({method:'place',parameters});if(this.e.reject)throw new BinanceError('rejected',{code:-2010});const order={...parameters,clientOrderId:parameters.newClientOrderId,origQty:parameters.quantity,executedQty:parameters.type==='MARKET'?parameters.quantity:'0',cumQuote:parameters.type==='MARKET'?String(Number(parameters.quantity)*100):'0',avgPrice:parameters.type==='MARKET'?'100':'0',status:parameters.type==='MARKET'?'FILLED':'NEW',orderId:this.e.next++};this.e.orders.set(parameters.newClientOrderId,order);if(this.e.updatePosition&&order.status==='FILLED'){const current=this.e.positions[0]?.quantity||0;this.e.positions=[{quantity:current+(parameters.side==='BUY'?1:-1)*Number(parameters.quantity)}].filter(p=>p.quantity);}
    if(this.e.uncertain)throw new BinanceError('response lost',{uncertain:true});return order;
  }
  async queryOrder(symbol,id){const order=this.e.orders.get(id);if(!order)throw new BinanceError('not found',{code:-2013});return {...order};}
  async cancelOrder(symbol,id){this.e.calls.push({method:'cancel',symbol,id});const order=this.e.orders.get(id);order.status='CANCELED';return {...order};}
}
async function harness(state){const exchange=new Exchange(),store=new Store(state),engine=await new TradingEngine(store,{clientFactory:()=>new Client(exchange),now:()=>exchange.now}).init();await engine.connect({environment:'testnet',apiKey:'fabricated-manual-key-1234',secret:'fabricated-manual-secret-1234',allowTrading:true});return {engine,store,exchange};}

test('favorites preserve independent spot/future identities, empty selections, and toggles',()=>{
  const keys=toggleFavorite([], 'usdm:INTCUSDT'),both=toggleFavorite(keys,'spot:INTCUSDT');assert.equal(both.length,2);assert.deepEqual(readFavorites(JSON.stringify(both)),both);assert.deepEqual(toggleFavorite(keys,'usdm:INTCUSDT'),[]);assert.deepEqual(readFavorites('[]'),[]);assert.throws(()=>toggleFavorite([], 'https://attacker/'));assert.equal(readFavorites('broken').length,6);
});
test('manual previews support TradFi, exact decimal quantities, notional sizing and read-only validation',async()=>{
  const {engine,exchange}=await harness(),preview=await engine.serial(()=>engine.manual.preview(input));assert.equal(preview.quantity,'1.3');assert.equal(preview.price,'100.1');assert.equal(preview.baseAsset,'INTC');assert.deepEqual(exchange.calls,[]);
  const context=await engine.serial(()=>engine.manual.context('INTCUSDT'));assert.equal(manualPlan({...input,sizeMode:'notional',amount:'200.2'},context).quantity,'2');
  for(const bad of [{...input,amount:'-1'},{...input,amount:'0.01'},{...input,leverage:21},{...input,market:'spot'},{...input,type:'STOP_MARKET'},{...input,price:'0'}])await assert.rejects(()=>engine.serial(()=>engine.manual.preview(bad)));
  exchange.balance=1;await assert.rejects(()=>engine.serial(()=>engine.manual.preview(input)),/증거금/);assert.deepEqual(exchange.calls,[]);
});

test('initial-margin input is sized server-side at the confirmed leverage and cannot size a closing order',async()=>{
  const {engine,exchange}=await harness();const margin=await engine.serial(()=>engine.manual.preview({...input,sizeMode:'margin',amount:'10',price:'100',leverage:3}));assert.equal(margin.quantity,'0.3');assert.equal(margin.estimatedMargin,10);assert.equal(margin.notional,30);assert.deepEqual(exchange.calls,[]);
  await assert.rejects(()=>engine.serial(()=>engine.manual.preview({...input,sizeMode:'margin',amount:'1000'})),/증거금/);await assert.rejects(()=>engine.serial(()=>engine.manual.preview({...input,action:'CLOSE',sizeMode:'margin'})),/정리 주문/);assert.deepEqual(exchange.calls,[]);
});

test('manual previews accept a returned 150x tier and still reject targets above the actual tier',async()=>{
  const {engine}=await harness();engine.client.leverageBrackets=async()=>[{symbol:'INTCUSDT',brackets:[{initialLeverage:150,notionalFloor:0,notionalCap:100000}]}];
  const preview=await engine.serial(()=>engine.manual.preview({...input,sizeMode:'margin',amount:'10',price:'100',leverage:150}));assert.equal(preview.quantity,'15');assert.equal(preview.leverage,150);
  await assert.rejects(()=>engine.serial(()=>engine.manual.preview({...input,leverage:151})),/레버리지/);
});
test('confirmed manual orders persist before transmission, and repeating a plan never sends twice',async()=>{
  const {engine,store,exchange}=await harness(),preview=await engine.serial(()=>engine.manual.preview(input));
  const place=engine.client.placeOrder.bind(engine.client);engine.client.placeOrder=async parameters=>{assert.ok(store.saved.at(-1).orders.some(o=>o.id===parameters.newClientOrderId&&o.stage==='ORDER_SENT'));return place(parameters);};
  const order=await engine.serial(()=>engine.manual.submit(preview.id)),again=await engine.serial(()=>engine.manual.submit(preview.id));assert.equal(order.status,'NEW');assert.equal(order.id,again.id);assert.equal(exchange.calls.filter(c=>c.method==='place').length,1);assert.equal(engine.snapshot().manualOrders.length,1);assert.ok(!engine.state.bots.length);
  const cancelled=await engine.serial(()=>engine.manual.cancel(order.id));assert.equal(cancelled.status,'CANCELED');assert.equal(exchange.calls.filter(c=>c.method==='cancel').length,1);
});
test('read-only accounts, expired confirmations, changed balances and changed position modes block transmission',async()=>{
  const {engine,exchange}=await harness(),preview=await engine.serial(()=>engine.manual.preview(input));exchange.balance=1;await assert.rejects(()=>engine.serial(()=>engine.manual.submit(preview.id)),/증거금/);exchange.balance=1000;exchange.hedge=true;await assert.rejects(()=>engine.serial(()=>engine.manual.submit(preview.id)),/포지션 모드/);exchange.hedge=false;exchange.now+=60001;await assert.rejects(()=>engine.serial(()=>engine.manual.submit(preview.id)),/만료/);engine.tradingEnabled=false;await assert.rejects(()=>engine.serial(()=>engine.manual.preview(input)),/주문 실행/);assert.deepEqual(exchange.calls,[]);
});
test('manual closing orders reduce only the requested side and cannot close a bot-owned position or flip a net position',async()=>{
  const {engine,exchange}=await harness();exchange.positions=[{quantity:-2}];await assert.rejects(()=>engine.serial(()=>engine.manual.preview(input)),/반대 방향/);
  const preview=await engine.serial(()=>engine.manual.preview({...input,action:'CLOSE',direction:'SHORT',type:'MARKET',amount:'1'}));const order=await engine.serial(()=>engine.manual.submit(preview.id));const request=exchange.calls.find(c=>c.method==='place').parameters;assert.equal(request.side,'BUY');assert.equal(request.reduceOnly,'true');assert.equal(order.status,'FILLED');assert.equal(engine.state.fills[0].source,'manual');assert.equal(engine.state.fills[0].price,100);
  exchange.hedge=true;exchange.positions=[{quantity:2,side:'LONG'},{quantity:-2,side:'SHORT'}];const hedge=await engine.serial(()=>engine.manual.preview({...input,action:'CLOSE',direction:'SHORT',amount:'1'}));await engine.serial(()=>engine.manual.submit(hedge.id));const last=exchange.calls.filter(c=>c.method==='place').at(-1).parameters;assert.equal(last.positionSide,'SHORT');assert.equal(last.reduceOnly,undefined);
  await assert.rejects(()=>engine.serial(()=>engine.manual.preview({...input,action:'CLOSE',amount:'3'})),/보유/);
  engine.state.bots.push(makeBot({symbol:'INTCUSDT',runtime:{runEnabled:false,quantity:1}}));await assert.rejects(()=>engine.serial(()=>engine.manual.preview(input)),/봇/);
});
test('uncertain responses recover by querying after restart and never resend, while configuration failures do not place an order',async()=>{
  const {engine,exchange,store}=await harness(),preview=await engine.serial(()=>engine.manual.preview(input));exchange.uncertain=true;const first=await engine.serial(()=>engine.manual.submit(preview.id));assert.equal(first.status,'UNKNOWN');await assert.rejects(()=>engine.serial(()=>engine.manual.preview(input)),/접수/);
  const recovered=await new TradingEngine(new Store(store.state),{clientFactory:()=>new Client(exchange),now:()=>exchange.now}).init();await recovered.connect({environment:'testnet',apiKey:'fabricated-manual-key-1234',secret:'fabricated-manual-secret-1234',allowTrading:true});await recovered.serial(()=>recovered.manual.refreshPending());assert.equal(recovered.snapshot().manualOrders[0].status,'NEW');assert.equal((await recovered.serial(()=>recovered.manual.submit(preview.id))).id,first.id);assert.equal(exchange.calls.filter(c=>c.method==='place').length,1);
  await recovered.serial(()=>recovered.manual.cancel(first.id));const next=await recovered.serial(()=>recovered.manual.preview({...input,margin:'CROSSED',leverage:5}));recovered.client.changeMargin=async()=>{throw new BinanceError('timeout',{uncertain:true});};assert.equal((await recovered.serial(()=>recovered.manual.submit(next.id))).status,'REJECTED');assert.equal(exchange.calls.filter(c=>c.method==='place').length,1);
});
test('disk failures and bot ownership block manual orders before settings or trading requests',async()=>{
  const {engine,exchange,store}=await harness(),preview=await engine.serial(()=>engine.manual.preview({...input,margin:'CROSSED',leverage:5}));store.fail=true;await assert.rejects(()=>engine.serial(()=>engine.manual.submit(preview.id)),/원장/);assert.deepEqual(exchange.calls,[]);
});

test('explicit margin and leverage changes are confirmed before sending, and interrupted configuration never resumes an order',async()=>{
  const {engine,exchange,store}=await harness(),preview=await engine.serial(()=>engine.manual.preview({...input,margin:'CROSSED',leverage:5}));
  assert.equal(preview.changes.margin,true);await engine.serial(()=>engine.manual.submit(preview.id));assert.deepEqual(exchange.calls.map(call=>call.method),['margin','leverage','place']);assert.equal(exchange.config.leverage,5);
  const unfinished=structuredClone(store.state);unfinished.orders[0].stage='CONFIGURING';unfinished.orders[0].status='UNKNOWN';const recovered=await new TradingEngine(new Store(unfinished),{clientFactory:()=>new Client(exchange)}).init();assert.equal(recovered.snapshot().manualOrders[0].status,'REJECTED');assert.equal(exchange.calls.filter(call=>call.method==='place').length,1);
});

test('pending close orders reserve position quantity and existing positions prevent implicit settings changes',async()=>{
  const {engine,exchange}=await harness();exchange.positions=[{quantity:2}];
  await assert.rejects(()=>engine.serial(()=>engine.manual.preview({...input,margin:'CROSSED'})),/현재/);
  const first=await engine.serial(()=>engine.manual.preview({...input,action:'CLOSE',amount:'1.5'}));await engine.serial(()=>engine.manual.submit(first.id));
  await assert.rejects(()=>engine.serial(()=>engine.manual.preview({...input,action:'CLOSE',amount:'1'})),/미체결/);
});
test('manual HTTP endpoints require the local token and only accept a server-issued confirmation',async()=>{
  const {exchange,store}=await harness(),app=await createServer({store,clientFactory:()=>new Client(exchange)});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));try{
    const base='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(base+'/api/session')).json(),headers={'X-Workroom-Token':token,'Content-Type':'application/json'},post=(route,body)=>fetch(base+route,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await fetch(base+'/api/manual/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,403);assert.equal((await post('/api/manual/submit',{planId:'ffffffff-ffff-ffff-ffff-ffffffffffff'})).status,400);assert.deepEqual(exchange.calls,[]);
    assert.equal((await post('/api/connection',{environment:'testnet',apiKey:'fabricated-manual-key-1234',secret:'fabricated-manual-secret-1234',allowTrading:true})).status,200);
    assert.equal((await fetch(base+'/api/manual/context?symbol=INTCUSDT',{headers})).status,200);const response=await post('/api/manual/preview',input);assert.equal(response.status,200);const plan=await response.json();assert.deepEqual(exchange.calls,[]);
    const submitted=await post('/api/manual/submit',{planId:plan.id});assert.equal(submitted.status,200);const order=await submitted.json();assert.equal((await post('/api/manual/submit',{planId:plan.id})).status,200);assert.equal(exchange.calls.filter(call=>call.method==='place').length,1);
    assert.equal((await fetch(base+'/api/manual/requests/'+plan.id,{headers})).status,200);assert.equal((await post('/api/manual/orders/'+order.id+'/cancel',{})).status,200);
  }finally{await new Promise(resolve=>app.server.close(resolve));await app.engine.stopTimer();}
});

test('manual fills reconcile after journal failure without resubmitting the reviewed request',async()=>{
 const h=await harness(),save=h.store.save.bind(h.store),preview=await h.engine.serial(()=>h.engine.manual.preview({...input,type:'MARKET',price:null}));let fail=true;
 h.store.save=async()=>{if(fail&&h.store.state.orders.some(o=>o.source==='manual'&&o.status==='FILLED')){fail=false;throw Object.assign(Error('locked'),{code:'EPERM'});}return save();};
 await assert.rejects(()=>h.engine.serial(()=>h.engine.manual.submit(preview.id)),e=>e.storage);assert.equal(h.exchange.calls.filter(c=>c.method==='place').length,1);
 h.exchange.now+=6000;await h.engine.tick();const result=await h.engine.serial(()=>h.engine.manual.submit(preview.id));assert.equal(result.status,'FILLED');assert.equal(h.exchange.calls.filter(c=>c.method==='place').length,1);assert.equal(h.store.state.fills.filter(f=>f.source==='manual').length,1);
});
test('interrupted manual configuration cannot automatically send a previously unsent order during storage recovery',async()=>{
 const h=await harness(),save=h.store.save.bind(h.store),preview=await h.engine.serial(()=>h.engine.manual.preview(input));let fail=true;
 h.store.save=async()=>{if(fail&&h.store.state.orders.some(o=>o.stage==='ORDER_SENT')){fail=false;throw Object.assign(Error('locked'),{code:'EPERM'});}return save();};
 await assert.rejects(()=>h.engine.serial(()=>h.engine.manual.submit(preview.id)),e=>e.storage);assert.equal(h.exchange.calls.filter(c=>c.method==='place').length,0);
 h.exchange.now+=6000;await h.engine.tick();const result=await h.engine.serial(()=>h.engine.manual.submit(preview.id));assert.equal(result.status,'REJECTED');assert.equal(h.exchange.calls.filter(c=>c.method==='place').length,0);assert.equal(h.engine.storage.fault,null);
});
