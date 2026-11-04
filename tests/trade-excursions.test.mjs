import test from 'node:test';
import assert from 'node:assert/strict';
import {TradingEngine} from '../backend/engine.mjs';
import {TradeExcursions,excursionView,excursionStats} from '../backend/trade-excursions.mjs';
import {emptyState} from '../backend/store.mjs';
import {buildTradeHistory} from '../backend/trade-history.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+' != '+b);
function fixture(){
 let now=10000;const state={...emptyState(),scope:'test:account',dataTransport:{mode:'rest',restIntervalSeconds:1},fundingCoverage:[{scope:'test:account',start:0,end:1e9}]},store={state,async save(){},async load(){return this.state;}};
 const e=new TradingEngine(store,{now:()=>now});e.client={};e.connected=true;e.accountAt=now;
 const b={id:'b',name:'test',symbol:'BTCUSDT',leverage:10,budget:100,runtime:{quantity:0,entryPrice:0,direction:null,positionEpoch:0,entries:0,realized:0}};state.bots.push(b);e.excursions.init();
 const clock=at=>{now=at;e.accountAt=at;};
 const mark=(price,at)=>{clock(at);e.accountSnapshot={positions:[{symbol:b.symbol,positionSide:'BOTH',quantity:b.runtime.quantity*(b.runtime.direction==='SHORT'?-1:1),entryPrice:b.runtime.entryPrice,markPrice:price}]};e.excursions.observe();};
 const fill=async(role,quantity,price,{at=now,direction='LONG',leverage=10,id='o'+state.orders.length}={})=>{
  clock(at);const o={id,scope:state.scope,botId:b.id,role,direction,leverage,appliedQty:0,appliedQuote:0,status:'NEW',createdAt:at,parameters:{symbol:b.symbol,side:direction==='LONG'?(role==='entry'?'BUY':'SELL'):(role==='entry'?'SELL':'BUY'),positionSide:'BOTH',quantity:String(quantity)}};
  state.orders.push(o);await e.applyOrder(b,o,{executedQty:quantity,cumQuote:quantity*price,status:'FILLED',updateTime:at});return o;
 };
 return {e,b,state,store,clock,mark,fill};
}
test('long trade tracks gross cycle excursions through additions, partial exits and final close; duplicate order updates do not reapply',async()=>{
 const f=fixture();const o=await f.fill('entry',2,100);f.mark(110,11000);f.mark(90,12000);
 await f.fill('exit',1,120,{at:13000});f.mark(80,14000);await f.fill('entry',1,80,{at:15000,leverage:20});f.mark(120,16000);await f.fill('exit',2,95,{at:17000});
 const r=f.e.excursions.get(f.b);near(r.maxProfit,80);near(r.maxLoss,-20);near(r.maxProfitPercent,80/24*100);near(r.maxLossPercent,-100);near(r.realizedGross,30);assert.equal(r.closedAt,17000);assert.equal(r.quantity,0);assert.equal(r.maxProfitAt,16000);
 const before=JSON.stringify(r);await f.e.applyOrder(f.b,o,{executedQty:2,cumQuote:200,status:'FILLED',updateTime:10000});assert.equal(JSON.stringify(r),before);
 assert.equal(excursionView(r).status,'observed');near(f.b.runtime.realized,30);
});
test('short positions invert price movement and percentage extrema are measured independently from USDT extrema',async()=>{
 const f=fixture();await f.fill('entry',1,100,{direction:'SHORT',leverage:100});f.mark(90,11000);await f.fill('entry',1,90,{direction:'SHORT',leverage:1,at:12000});f.mark(80,13000);f.mark(120,14000);await f.fill('exit',2,95,{direction:'SHORT',at:15000});
 const r=f.e.excursions.get(f.b);near(r.maxProfit,30);near(r.maxProfitPercent,1000);near(r.maxLoss,-50);near(r.entryMargin,91);near(r.realizedGross,0);
});
test('already-held and imported positions are partial and do not invent pre-collection profit or original margin',()=>{
 const f=fixture();Object.assign(f.b.runtime,{quantity:2,entryPrice:100,direction:'LONG',positionEpoch:3,realized:500});f.e.excursions.init();f.mark(105,11000);
 let r=f.e.excursions.get(f.b);assert.equal(excursionView(r).status,'partial');near(r.maxProfit,10);assert.equal(excursionView(r).maxProfitPercent,null);
 f.e.excursions.fill(f.b,{epoch:3,role:'entry',quantity:1,price:110,at:12000,beforeQuantity:2,beforePrice:100,imported:true});
 r=f.e.excursions.get(f.b);assert.equal(r.partial,true);near(r.quantity,3);near(r.realizedGross,0);assert.match(r.reason,/인수/);
});
test('restart/serialized state and storage rewind retain extrema and continue the same epoch without stale references',async()=>{
 const f=fixture();await f.fill('entry',1,100);f.mark(120,11000);const durable=structuredClone(f.state);f.mark(130,12000);f.store.state=structuredClone(durable);f.mark(105,13000);
 let r=f.e.excursions.get(f.b);near(r.maxProfit,20);assert.equal(f.store.state.tradeExcursions[0],r);
 const e2=new TradingEngine({state:JSON.parse(JSON.stringify(f.store.state))},{now:()=>14000});e2.excursions.init();r=e2.excursions.get(f.b);near(r.maxProfit,20);assert.equal(r.partial,false);assert.equal(e2.state.tradeExcursions.length,1);
});
test('stale stream prices, synchronization holds, missing account and unresolved orders are not sampled; outages are visible',async()=>{
 const f=fixture();await f.fill('entry',1,100);f.mark(110,11000);const r=f.e.excursions.get(f.b),samples=r.samples;
 f.b.runtime.syncHold=true;f.mark(1000,12000);assert.equal(r.samples,samples);f.b.runtime.syncHold=false;
 f.e.client.streams={channels:new Map([['market',{}]]),fresh:()=>null};f.state.dataTransport.mode='websocket';f.mark(1000,13000);assert.equal(r.samples,samples);
 f.e.client.streams.fresh=()=>({value:{markPrice:'108'}});f.mark(1000,18000);near(r.maxProfit,10);assert.equal(r.gaps,1);assert.equal(r.markSamples,2);
 f.state.orders.push({scope:f.state.scope,botId:'b',status:'UNKNOWN'});f.mark(5000,19000);assert.equal(r.markSamples,2);
});
test('late executions and quantity mismatches cannot publish incorrect extrema',async()=>{
 const f=fixture();await f.fill('entry',1,100);f.mark(110,12000);await f.fill('exit',1,105,{at:11000});
 const x=excursionView(f.e.excursions.get(f.b));assert.equal(x.status,'uncertain');assert.equal(x.maxProfit,null);assert.match(x.reason,/늦게/);
 const g=fixture();await g.fill('entry',1,100);g.b.runtime.quantity=2;g.mark(120,11000);assert.equal(excursionView(g.e.excursions.get(g.b)).status,'uncertain');
});
test('separate account scopes, bots and position epochs never merge observations',async()=>{
 const f=fixture();await f.fill('entry',1,100);f.mark(120,11000);await f.fill('exit',1,110,{at:12000});await f.fill('entry',1,90,{at:13000});f.mark(85,14000);
 assert.equal(f.state.tradeExcursions.length,2);near(f.e.excursions.get(f.b).maxProfit,0);near(f.e.excursions.get(f.b,1).maxProfit,20);
 const other={...f.b,id:'worker_A'};f.state.bots.push(other);f.e.excursions.fill(other,{epoch:2,role:'entry',quantity:1,price:80,direction:'LONG',at:15000});assert.notEqual(f.e.excursions.get(other),f.e.excursions.get(f.b));
 f.state.scope='different';assert.equal(f.e.excursions.get(f.b),undefined);
});
test('history joins excursions even after precise fees arrive, keeps old trades missing, and excludes partial/open records from aggregates',async()=>{
 const f=fixture();await f.fill('entry',1,100);f.mark(115,11000);f.mark(95,12000);await f.fill('exit',1,110,{at:13000});
 for(const o of f.state.orders){o.feesFetched=true;f.state.fills.push({id:'fee:'+o.id,scope:f.state.scope,botId:'b',symbol:f.b.symbol,clientOrderId:o.id,at:o.createdAt,fee:.1,feeAsset:'USDT',tradeQuantity:1,tradePrice:o.appliedQuote,positionEpoch:1});}
 let report=buildTradeHistory({state:f.state,botId:'b',now:14000});const t=report.trades[0];near(t.excursion.maxProfit,15);near(t.excursion.maxLoss,-5);near(t.net,9.8);near(report.summary.excursions.maximumProfitPercent,150);assert.equal(report.summary.excursions.collected,1);
 const legacy=structuredClone(f.state);delete legacy.tradeExcursions;report=buildTradeHistory({state:legacy,botId:'b',now:14000});assert.equal(report.trades[0].excursion.status,'missing');assert.equal(report.summary.excursions.maximumProfit,null);
 const stats=excursionStats([{closedAt:1,excursion:t.excursion},{closedAt:2,excursion:{...t.excursion,status:'partial'}},{closedAt:null,excursion:t.excursion},{closedAt:3,excursion:excursionView(null)}]);assert.equal(stats.collected,1);assert.equal(stats.partial,1);assert.equal(stats.missing,1);
});
test('an engine tick records mark observations while new entries and order permission are disabled, without extra data requests',async()=>{
 const f=fixture();await f.fill('entry',1,100);f.b.runtime.runEnabled=false;f.e.tradingEnabled=false;f.e.lastTimeSync=10000;f.e.manual.refreshPending=async()=>{};f.e.refreshAccount=async()=>true;f.e.shared.syncAll=async()=>{};f.e.tickBot=async()=>{};f.e.checkpoint=async()=>{};
 f.e.accountSnapshot={positions:[{symbol:f.b.symbol,positionSide:'BOTH',quantity:1,markPrice:113}]};await f.e.tick();near(f.e.excursions.get(f.b).maxProfit,13);assert.equal(f.e.excursions.get(f.b).markSamples,1);
});

test('legacy imported holdings show partial live observations and retain them when the new epoch-tagged exit closes the trade',async()=>{
 const f=fixture();Object.assign(f.b.runtime,{quantity:1,entryPrice:100,direction:'LONG',positionEpoch:7});f.state.positionImports=[{id:'legacy-import',scope:f.state.scope,botId:'b',symbol:f.b.symbol,at:1000,quantity:1,entryPrice:100,direction:'LONG'}];f.e.excursions.init();
 assert.equal(excursionView(f.e.excursions.get(f.b)).maxProfit,null);f.mark(112,11000);
 let t=buildTradeHistory({state:f.state,botId:'b',now:12000}).trades[0];assert.equal(t.excursion.status,'partial');near(t.excursion.maxProfit,12);assert.equal(t.excursion.maxProfitPercent,null);
 await f.fill('exit',1,105,{at:13000});t=buildTradeHistory({state:f.state,botId:'b',now:14000}).trades[0];assert.equal(t.excursion.status,'partial');near(t.excursion.maxProfit,12);
});
test('precise fee records without epochs inherit their order fill epoch without changing past missing cycles',async()=>{
 const f=fixture();await f.fill('entry',1,100);f.mark(112,11000);await f.fill('exit',1,110,{at:12000});
 for(const o of f.state.orders){o.feesFetched=true;f.state.fills.push({id:'legacy-fee:'+o.id,scope:f.state.scope,botId:'b',symbol:f.b.symbol,clientOrderId:o.id,at:o.createdAt,fee:0,feeAsset:'USDT',tradeQuantity:1,tradePrice:o.appliedQuote});}
 const t=buildTradeHistory({state:f.state,botId:'b',now:13000}).trades[0];assert.equal(t.excursion.status,'observed');near(t.excursion.maxProfit,12);
});
