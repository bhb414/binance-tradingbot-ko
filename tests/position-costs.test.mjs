import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../backend/store.mjs';
import {buildOpenPositionCosts} from '../backend/trade-history.mjs';
import {PositionCostEstimates} from '../backend/position-costs.mjs';
import {BinanceClient} from '../backend/binance.mjs';
import {requestWeight} from '../backend/binance-rate.mjs';
import {positionNetReturn} from '../public/position-net.js';
import {officeRosterMarkup} from '../public/office-roster.js';
import {createServer} from '../server.mjs';
const scope='live:cost-test',now=2000000000000;
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,actual+' != '+expected);
function state(){return {...emptyState(),scope,bots:[{id:'b',symbol:'BTCUSDT',leverage:20,budget:100,runtime:{quantity:1,entryPrice:100,direction:'LONG',positionEpoch:1,lastEntryAt:1000}}],fundingCoverage:[{scope,start:0,end:now}]};}
function fill(s,{id,at,quantity=1,price=100,role='entry',fee=.1,asset='USDT',botId='b',symbol='BTCUSDT',direction='LONG'}){
 const orderId=s.orders.length+1;
 s.orders.push({id,orderId,scope,botId,role,direction,leverage:20,createdAt:at-10,appliedQty:quantity,appliedQuote:quantity*price,feesFetched:fee!=null,parameters:{symbol,side:role==='entry'?'BUY':'SELL',positionSide:'BOTH',quantity:String(quantity)}});
 s.fills.push({id:id+':fill',clientOrderId:id,orderId,scope,botId,symbol,role,direction,at,tradeTime:at,quantity,price,leverage:20});
 if(fee!=null)s.fills.push({id:id+':fee',clientOrderId:id,orderId,scope,botId,symbol,at,fee,feeAsset:asset,tradeQuantity:quantity,tradePrice:price});
}
const basis=s=>buildOpenPositionCosts({state:s,now});
const view=(id='b',changes={})=>({id,symbol:'BTCUSDT',name:'BTC 봇',quantity:1,entryPrice:100,positionDirection:'LONG',leverage:20,used:5,budget:100,pnl:.05,runtime:{realized:0,positionEpoch:1,runEnabled:true},...changes});
const cost=(changes={})=>({symbol:'BTCUSDT',quantity:1,entryPrice:100,direction:'LONG',positionEpoch:1,entryFee:.05,funding:0,takerRate:.0005,fundingAsOf:now,rateAsOf:now,complete:true,reasons:[],...changes});

test('remaining entry commissions and funding follow partial exits and later additions; realized exits are excluded',()=>{
 const s=state();fill(s,{id:'e',at:1000,quantity:2,fee:2});fill(s,{id:'x',at:3000,role:'exit',fee:999,price:110});fill(s,{id:'a',at:5000,fee:.2,price:120});
 s.bots[0].runtime.quantity=2;s.fundingLedger=[{id:'f1',scope,symbol:'BTCUSDT',at:2000,amount:-.4,asset:'USDT'},{id:'f2',scope,symbol:'BTCUSDT',at:4000,amount:.1,asset:'USDT'}];
 const c=basis(s).b;assert.equal(c.complete,true);near(c.entryFee,1.2);near(c.funding,-.1);near(c.entryPrice,110);
 s.fills=s.fills.filter(f=>f.clientOrderId!=='x'||f.fee==null);s.orders.find(o=>o.id==='x').feesFetched=false;
 assert.equal(basis(s).b.complete,true);near(basis(s).b.entryFee,1.2);
});

test('unknown import costs, foreign commission, incomplete fills, stale funding and scope mismatches never become zero cost',()=>{
 const s=state();fill(s,{id:'e',at:1000});assert.equal(basis(s).b.complete,true);
 s.fills.find(f=>f.fee!=null).feeAsset='BNB';assert.equal(basis(s).b.complete,false);
 s.fills.find(f=>f.fee!=null).feeAsset='USDT';s.fills.find(f=>f.fee!=null).tradeQuantity=.5;assert.equal(basis(s).b.complete,false);
 s.fills.find(f=>f.fee!=null).tradeQuantity=1;s.fundingCoverage[0].end=now-90001;assert.equal(basis(s).b.complete,false);
 s.fundingCoverage=[{scope:'different',start:0,end:now}];assert.equal(basis(s).b.complete,false);
 const imported=state();imported.positionImports=[{id:'i',scope,botId:'b',symbol:'BTCUSDT',direction:'LONG',quantity:1,entryPrice:100,at:1000}];assert.ok(basis(imported).b.reasons.includes('인수 전 진입 수수료 미확인'));
});

test('new position after verified funding window and mismatched remaining quantity remain unconfirmed',()=>{
 const s=state();fill(s,{id:'e',at:now-1000});s.fundingCoverage[0].end=now-2000;
 assert.equal(basis(s).b.complete,false);s.fundingCoverage[0].end=now;s.bots[0].runtime.quantity=2;assert.equal(basis(s).b.complete,false);
});

test('flat cycles do not contaminate new positions; fee rebates retain signs',()=>{
 const s=state();fill(s,{id:'old',at:1000,fee:100});fill(s,{id:'oldx',at:2000,role:'exit',price:200,fee:100});fill(s,{id:'new',at:3000,fee:-.1});
 const c=basis(s).b;assert.equal(c.complete,true);near(c.entryFee,-.1);assert.equal(c.openedAt,3000);
});

test('net current ROI includes both entry and estimated market exit fees and can be negative when gross is positive',()=>{
 const b=view(),r=positionNetReturn(b,{b:cost()},now);assert.equal(r.state,'ready');near(r.closingFee,.050025);near(r.net,-.050025);near(r.roi,-1.0005);
 const short=view('b',{positionDirection:'SHORT',pnl:.5}),s=positionNetReturn(short,{b:cost({direction:'SHORT',funding:.03})},now);
 near(s.closingFee,.04975);near(s.net,.43025);near(s.roi,8.605);
 const zero=positionNetReturn(b,{b:cost({entryFee:0,takerRate:0})},now);near(zero.net,.05);
});

test('realized history is excluded and quantity, direction, epoch and freshness changes invalidate cached cost',()=>{
 const b=view('b',{pnl:100.05,runtime:{realized:100,positionEpoch:1}}),r=positionNetReturn(b,{b:cost()},now);near(r.net,-.050025);
 for(const change of [{quantity:2},{entryPrice:99},{direction:'SHORT'},{positionEpoch:2},{fundingAsOf:now-90001},{rateAsOf:now-330001},{complete:false},{entryFee:null}]){
  const v=positionNetReturn(b,{b:cost(change)},now);assert.equal(v.state,'unknown',JSON.stringify(change));assert.equal(v.roi,null);
 }
 assert.equal(positionNetReturn(view('b',{quantity:0}),{},now).state,'none');
 assert.equal(positionNetReturn(view('b',{error:'sync'}),{b:cost()},now).state,'unknown');
});

test('multi-symbol ROI sums current net values over held margin, using each symbol account rate',()=>{
 const a=view('a'),b=view('b',{symbol:'ETHUSDT',pnl:1,used:10}),root={kind:'multi',id:'p',quantity:2,used:15,pnl:1.05,runtime:{realized:0},members:[a,b]};
 const costs={a:cost(),b:cost({symbol:'ETHUSDT',takerRate:.001,entryFee:.1,funding:-.02})};
 const result=positionNetReturn(root,costs,now);assert.equal(result.state,'ready');near(result.net,-.050025+.779);near(result.roi,result.net/15*100);
 delete costs.b;assert.equal(positionNetReturn(root,costs,now).state,'unknown');
});

test('roster shows gross and net alongside one another without changing character emotion or controls',()=>{
 const costs={b:cost({fundingAsOf:Date.now(),rateAsOf:Date.now()})},html=officeRosterMarkup([view()],{selectedId:'b',costs,icon:()=>'<svg/>'});
 assert.match(html,/office-roster-returns/);assert.match(html,/>평가</);assert.match(html,/>비용 후 예상</);assert.match(html,/\+1\.00%/);assert.match(html,/-1\.00%/);assert.match(html,/시장가 정리 예상 수수료/);assert.match(html,/roster-usdt positive[^>]*>\+0\.05 USDT/);assert.match(html,/roster-usdt negative[^>]*>-0\.05 USDT/);assert.match(html,/data-office-toggle="b"/);
 const unknown=officeRosterMarkup([view()],{costs:{},icon:()=>''});assert.match(unknown,/미확인/);assert.match(unknown,/roster-usdt cost-unknown[^>]*>— USDT/);assert.doesNotMatch(unknown,/>0\.00%</);
});

test('commission endpoint is signed, read-only, weight 20 and coalesced by client cache',async()=>{
 let calls=0,time=now;const client=new BinanceClient({apiKey:'test-key',secret:'test-secret',minGap:0,now:()=>time,fetchImpl:async(url,opts)=>{
 calls++;const u=new URL(url);assert.equal(u.pathname,'/fapi/v1/commissionRate');assert.equal(u.searchParams.get('symbol'),'BTCUSDT');assert.ok(u.searchParams.get('signature'));assert.equal(opts.headers['X-MBX-APIKEY'],'test-key');assert.equal(opts.method,'GET');
 return {ok:true,status:200,headers:new Headers(),json:async()=>({symbol:'BTCUSDT',takerCommissionRate:'.0004'})};
 }});
 const [a,b]=await Promise.all([client.commissionRate('BTCUSDT'),client.commissionRate('BTCUSDT')]);assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(requestWeight('/fapi/v1/commissionRate'),20);
 time+=300001;await client.commissionRate('BTCUSDT');assert.equal(calls,2);
});

test('held symbols share cached rates, failed rates back off, and account changes invalidate in-flight data',async()=>{
 let calls=0,time=now;const s=state();fill(s,{id:'e',at:1000});const client={commissionRate:async symbol=>{calls++;return {symbol,takerCommissionRate:'.0005'};}},snapshot={scope,complete:true,startTime:0,endTime:now,rows:[]},e={state:s,connected:true,connectionId:'c',client,now:()=>time,positionInsights:{get:async()=>{},fundingSnapshot:()=>snapshot}},service=new PositionCostEstimates(e);
 await Promise.all([service.get(),service.get()]);assert.equal(calls,1);const r=await service.get();assert.equal(r.byBot.b.takerRate,.0005);
 time+=1000;await service.get();assert.equal(calls,1);s.bots[0].runtime.quantity=0;assert.deepEqual((await service.get()).byBot,{});assert.equal(calls,1);
 let fails=0;const bad={commissionRate:async()=>{fails++;throw Error('rate limit');}};
 await service.rate('ETHUSDT',bad);await service.rate('ETHUSDT',bad);assert.equal(fails,1);time+=30001;await service.rate('ETHUSDT',bad);assert.equal(fails,2);
 s.bots[0].runtime.quantity=1;let release;e.client={commissionRate:()=>new Promise(resolve=>{release=resolve;})};const pending=service.get();e.connectionId='new';e.client={};release({symbol:'BTCUSDT',takerCommissionRate:'.0005'});await assert.rejects(pending,/계좌가 변경/);
});

test('cost endpoint requires a session and does not call exchange when disconnected or flat',async()=>{
 const s=state();s.bots=[];const app=await createServer({store:{state:s,async load(){return s;},async save(){}},clientFactory:()=>({clearCredentials(){},redact:s=>s}),marketData:{}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));try{
 const base='http://127.0.0.1:'+app.server.address().port;assert.equal((await fetch(base+'/api/positions/costs')).status,403);
 const {token}=await(await fetch(base+'/api/session')).json(),r=await fetch(base+'/api/positions/costs',{headers:{'X-Workroom-Token':token}});assert.equal(r.status,200);assert.deepEqual((await r.json()).byBot,{});
 }finally{await new Promise(resolve=>app.server.close(resolve));}
});
