import test from 'node:test';
import assert from 'node:assert/strict';
import {BinanceClient} from '../backend/binance.mjs';
import {MarketData} from '../backend/market-data.mjs';
import {RequestBudget,isTemporary,requestWeight} from '../backend/binance-rate.mjs';
const ok=data=>new Response(JSON.stringify(data),{status:200});
test('chart and signed clients share IP cooldown, respect Retry-After and recover without queued requests escaping',async()=>{
 let time=1800000000000,calls=0;const now=()=>time,fetchImpl=async()=>{calls++;return calls===1?new Response(JSON.stringify({code:-1003,msg:'Too many requests'}),{status:429,headers:{'retry-after':'5'}}):ok({canTrade:true});};
 const chart=new MarketData({now,fetchImpl}),client=new BinanceClient({environment:'live',now,fetchImpl,minGap:0,apiKey:'key',secret:'secret'});
 const first=chart.request('usdm','/depth',{symbol:'BTCUSDT',limit:10});await assert.rejects(first,e=>e.status===429&&e.retryAt===time+5000);
 await assert.rejects(client.account(),e=>e.status===429&&e.retryAt===time+5000);assert.equal(calls,1);
 time+=4999;await assert.rejects(client.positions());assert.equal(calls,1);time++;assert.equal((await client.account()).canTrade,true);assert.equal(calls,2);
 let queuedCalls=0;const queued=new BinanceClient({apiKey:'key',secret:'secret',minGap:0,now,fetchImpl:async()=>{queuedCalls++;return new Response('{}',{status:429,headers:{'retry-after':'10'}});}});
 const results=await Promise.allSettled([queued.account(),queued.positions(),queued.openOrders()]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(queuedCalls,1);
});
test('IP weight observations throttle heavy reads before the limit and retain capacity for reconciliation and orders',()=>{
 let time=1800000001000;const budget=new RequestBudget({now:()=>time});
 budget.observe(new Response('{}',{headers:{'x-mbx-used-weight-1m':'1799'}}));assert.throws(()=>budget.reserve(2),e=>e.status===429);
 budget.reserve(40,{priority:true});assert.equal(budget.used,1839);budget.observe(new Response('{}',{headers:{'x-mbx-used-weight-1m':'2280'}}));assert.throws(()=>budget.reserve(1,{priority:true}));
 time+=60000;budget.reserve(5);assert.equal(budget.used,5);
 assert.equal(requestWeight('/fapi/v1/ticker/24hr'),40);assert.equal(requestWeight('/fapi/v1/ticker/24hr',{symbol:'BTCUSDT'}),1);assert.equal(requestWeight('/fapi/v1/klines',{limit:1000}),5);assert.equal(requestWeight('/fapi/v1/klines',{limit:3}),1);
 budget.observe(new Response('{}',{status:418,headers:{'retry-after':'120'}}),{msg:'IP banned until '+(time+300000)});assert.equal(budget.blockedUntil,time+300000);
});
test('bot and chart candle history is deduplicated, refreshes current/previous bars and reloads after a gap',async()=>{
 let time=1800000000000,phase=0;const now=()=>time,calls=[];
 const row=(minute,close)=>[minute*60000,'100','120','90',String(close),'3',minute*60000+59999];
 const fetchImpl=async url=>{const u=new URL(url);calls.push(u);if(u.pathname.endsWith('/exchangeInfo'))return ok({symbols:[{symbol:'BTCUSDT',status:'TRADING',quoteAsset:'USDT',marginAsset:'USDT'}]});
 if(u.pathname.endsWith('/klines')){const limit=Number(u.searchParams.get('limit'));return ok(phase===0?[row(1,101),row(2,102),row(3,103)]:phase===1?[row(2,102.5),row(3,104),row(4,105)]:limit===3?[row(8,108),row(9,109),row(10,110)]:Array.from({length:10},(_,i)=>row(i+1,101+i)));}
 if(u.pathname.endsWith('/depth'))return ok({bids:[],asks:[]});if(u.pathname.endsWith('/premiumIndex'))return ok({symbol:'BTCUSDT',markPrice:'100'});return ok({symbol:'BTCUSDT',lastPrice:'100'});};
 const client=new BinanceClient({environment:'live',now,fetchImpl,minGap:0}),chart=new MarketData({now,fetchImpl});
 const [bars,quote]=await Promise.all([client.klines('BTCUSDT','1m'),chart.quote('usdm','BTCUSDT','1m')]);assert.deepEqual(bars,quote.candles);assert.equal(calls.filter(u=>u.pathname.endsWith('/klines')).length,1);
 time+=3000;phase=1;const refreshed=await client.klines('BTCUSDT','1m');assert.deepEqual(refreshed.map(c=>c.close),[101,102.5,104,105]);assert.equal(calls.filter(u=>u.pathname.endsWith('/klines')).at(-1).searchParams.get('limit'),'3');
 time+=3000;phase=2;const recovered=await client.klines('BTCUSDT','1m');assert.equal(recovered.length,10);assert.deepEqual(calls.filter(u=>u.pathname.endsWith('/klines')).slice(-2).map(u=>u.searchParams.get('limit')),['3','1000']);
});
test('temporary read failures can recover but ambiguous writes retain their uncertainty',async()=>{
 const fetchImpl=async()=>{throw Error('offline');},client=new BinanceClient({apiKey:'key',secret:'secret',fetchImpl,minGap:0});
 await assert.rejects(client.account(),e=>isTemporary(e)&&!e.uncertain);
 await assert.rejects(client.placeOrder({symbol:'BTCUSDT'}),e=>e.uncertain&&!isTemporary(e));
});

test('request usage counts outbound requests by safe path and source without recording keys or signed parameters',async()=>{
 let time=1800000001000,calls=0;const now=()=>time,fetchImpl=async()=>{calls++;return ok({});},client=new BinanceClient({environment:'live',now,fetchImpl,minGap:0,apiKey:'private-profile-key',secret:'private-profile-secret'}),market=new MarketData({now,fetchImpl});
 await client.account();await client.positions();await market.request('usdm','/depth',{symbol:'BTCUSDT',limit:10});
 const usage=client.rate.snapshot().usage;assert.equal(usage.currentMinute.requests,3);assert.equal(usage.currentMinute.weight,12);assert.equal(calls,3);assert.ok(usage.currentMinute.endpoints.some(row=>row.source==='market'));assert.ok(usage.currentMinute.endpoints.some(row=>row.endpoint==='/fapi/v3/account'));
 const text=JSON.stringify(usage);assert.doesNotMatch(text,/private-profile|signature|apiKey|secret|BTCUSDT/);
 time+=60000;assert.equal(client.rate.snapshot().usage.currentMinute.requests,0);assert.equal(client.rate.snapshot().usage.previousMinute.requests,3);
});
test('background quota defers only its read, preserves priority for trading data, and distinguishes an actual exchange cooldown',async()=>{
 let time=1800000001000,calls=0;const now=()=>time,fetchImpl=async()=>{calls++;return ok([]);},client=new BinanceClient({environment:'live',now,fetchImpl,minGap:0,apiKey:'key',secret:'secret'}),market=new MarketData({now,fetchImpl});
 client.rate.used=1800;client.rate.minute=Math.floor(time/60000);await assert.rejects(()=>market.request('usdm','/depth',{symbol:'BTCUSDT',limit:10}),e=>e.local===true&&e.scope==='background');assert.equal(calls,0);
 await client.tradesAfter('BTCUSDT',1);await client.book('BTCUSDT');assert.equal(calls,2);assert.equal(client.rate.snapshot().usage.currentMinute.requests,2);assert.equal(client.rate.snapshot().usage.currentMinute.denied,1);assert.equal(client.rate.snapshot().usage.lastWait.origin,'local');
 client.rate.observe(new Response('{}',{status:429,headers:{'retry-after':'5'}}),{code:-1003});await assert.rejects(()=>client.account(),e=>e.local===false&&e.scope==='exchange');assert.equal(calls,2);assert.equal(client.rate.snapshot().usage.lastWait.origin,'exchange');
});

test('exchange limit response observations are counted once while a later ban timestamp remains visible',async()=>{
 const time=1800000001000,client=new BinanceClient({apiKey:'key',secret:'secret',now:()=>time,minGap:0,fetchImpl:async()=>new Response(JSON.stringify({code:-1003,msg:'IP banned until '+(time+300000)}),{status:418,headers:{'retry-after':'5'}})});
 await assert.rejects(()=>client.account());const usage=client.rate.snapshot().usage;assert.equal(usage.currentMinute.requests,1);assert.equal(usage.currentMinute.denied,1);assert.equal(usage.lastWait.retryAt,time+300000);
});
