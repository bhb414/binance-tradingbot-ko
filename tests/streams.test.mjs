import test from 'node:test';
import assert from 'node:assert/strict';
import {MarketStreams,transportSettings} from '../backend/streams.mjs';
import {UserStream} from '../backend/user-stream.mjs';
import {RequestBudget} from '../backend/binance-rate.mjs';
import {BinanceClient} from '../backend/binance.mjs';
import {TradingEngine} from '../backend/engine.mjs';
import {emptyState} from '../backend/store.mjs';
import {createServer} from '../server.mjs';
class Socket extends EventTarget{
 static instances=[];
 constructor(url){super();this.url=url;this.readyState=0;this.sent=[];Socket.instances.push(this);}
 open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
 message(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
 send(data){this.sent.push(JSON.parse(data));}
 close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
}
const store=()=>({state:emptyState(),async load(){return this.state;},async save(){}});
const row=(time,close)=>({time,closeTime:(time+60)*1000-1,open:10,high:20,low:5,close,volume:1});
const kline=(time,close,E)=>({e:'kline',E,s:'BTCUSDT',k:{t:time*1000,T:(time+60)*1000-1,i:'1m',o:'10',h:'20',l:'5',c:String(close),v:'1'}});
test('one market connection multiplexes symbols and timeframes; routed depth is shared and REST mode closes sockets',async()=>{
 let time=1000000;Socket.instances=[];const streams=new MarketStreams({now:()=>time,WebSocketImpl:Socket});try{
  streams.touch('ticker','BTCUSDT');streams.touch('candles','BTCUSDT','1m');streams.touch('candles','ETHUSDT','1h');streams.touch('book','BTCUSDT');
  assert.equal(Socket.instances.length,2);const market=Socket.instances.find(s=>s.url.includes('/market/')),depth=Socket.instances.find(s=>s.url.includes('/public/'));
  market.open();depth.open();for(const c of streams.channels.values())streams.flush(c);
  assert.equal(market.sent[0].params.length,3);assert.deepEqual(depth.sent[0].params,['btcusdt@depth10@500ms']);
  market.message({stream:'btcusdt@ticker',data:{e:'24hrTicker',s:'BTCUSDT',E:time,c:'11',P:'1',h:'12',l:'9',q:'100'}});
  let reads=0;const budget=new RequestBudget({now:()=>time});assert.equal((await streams.read(budget,'ticker','BTCUSDT',async()=>{reads++;return {lastPrice:'10'};})).lastPrice,'11');assert.equal(reads,0);
  market.message({e:'24hrTicker',s:'BTCUSDT',E:time-1,c:'3'});assert.equal((await streams.read(budget,'ticker','BTCUSDT',()=>{})).lastPrice,'11');
  streams.configure({mode:'rest',restIntervalSeconds:30});assert.ok(Socket.instances.every(s=>s.readyState===3));
  const load=async()=>{reads++;return {lastPrice:String(reads)};};assert.equal((await streams.read(budget,'ticker','BTCUSDT',load)).lastPrice,'1');time+=29000;await streams.read(budget,'ticker','BTCUSDT',load);assert.equal(reads,1);time+=1001;await streams.read(budget,'ticker','BTCUSDT',load);assert.equal(reads,2);
 }finally{streams.close();}
});
test('candles retain warmup and closed bars, ignore old events, and reseed after reconnect or missing bars',async()=>{
 let time=1000000,forceCalls=[];Socket.instances=[];const streams=new MarketStreams({now:()=>time,WebSocketImpl:Socket}),budget=new RequestBudget({now:()=>time});
 try{
  streams.touch('candles','BTCUSDT','1m');let socket=Socket.instances.at(-1);socket.open();const load=async force=>{forceCalls.push(force);return [row(60,10),row(120,11)];};
  await streams.candles(budget,'BTCUSDT','1m',1000,load);socket.message(kline(120,12,time));socket.message(kline(180,13,++time));
  assert.deepEqual((await streams.candles(budget,'BTCUSDT','1m',1000,load)).map(r=>r.close),[10,12,13]);assert.equal(forceCalls.length,1);
  socket.message(kline(120,3,time-2));assert.equal((await streams.candles(budget,'BTCUSDT','1m',1000,load)).at(-1).close,13);
  socket.close();time+=2000;for(const c of streams.channels.values())streams.connect(c);socket=Socket.instances.at(-1);socket.open();
  socket.message(kline(180,14,++time));await streams.candles(budget,'BTCUSDT','1m',1000,async force=>{assert.equal(force,true);forceCalls.push(force);return [row(60,10),row(120,12),row(180,14)];});assert.equal(forceCalls.length,2);
  socket.message(kline(300,16,++time));const recovered=await streams.candles(budget,'BTCUSDT','1m',1000,async force=>{assert.equal(force,true);return [row(120,12),row(180,14),row(240,15),row(300,16)];});assert.equal(recovered.at(-2).time,240);
 }finally{streams.close();}
});
test('user stream reconnects privately, invalidates on events, ignores out of order events and cleans up without deleting a shared key',async()=>{
 Socket.instances=[];let time=1000000,created=0;const client={async listenKey(){created++;return {listenKey:'private-test-key'};},async keepListenKey(){}},stream=new UserStream(client,{WebSocketImpl:Socket,now:()=>time});
 try{
  stream.start();await new Promise(r=>setImmediate(r));assert.equal(created,1);const socket=Socket.instances.at(-1);assert.match(socket.url,/\/private\/ws\//);socket.open();const initial=stream.revision;
  socket.message({e:'ACCOUNT_UPDATE',E:10,a:{}});socket.message({e:'ORDER_TRADE_UPDATE',E:11,o:{c:'order-1'}});const revision=stream.revision;assert.equal(revision,initial+2);socket.message({e:'ORDER_TRADE_UPDATE',E:9,o:{c:'order-1'}});assert.equal(stream.revision,revision);
  assert.equal(JSON.stringify(stream.view()).includes('private-test-key'),false);socket.message({e:'listenKeyExpired'});assert.equal(stream.status,'reconnecting');assert.ok(stream.revision>revision);
 }finally{stream.close();}
});
test('listen key requests use API-key authentication without signatures or ambiguous order errors',async()=>{
 const requests=[],client=new BinanceClient({environment:'live',apiKey:'key',secret:'secret',minGap:0,fetchImpl:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({listenKey:'test'}));}});
 assert.equal((await client.listenKey()).listenKey,'test');assert.equal(requests[0].options.headers['X-MBX-APIKEY'],'key');assert.equal(requests[0].options.body,'');assert.doesNotMatch(requests[0].url,/timestamp|signature|secret/);
 const offline=new BinanceClient({apiKey:'key',secret:'secret',minGap:0,fetchImpl:async()=>{throw Error('offline');}});await assert.rejects(offline.listenKey(),e=>e.temporary&&!e.uncertain);await assert.rejects(offline.placeOrder({}),e=>e.uncertain);
});
test('idle account/order reads share the interval, pushes invalidate them and explicit trade validation stays fresh',async()=>{
 let time=1000000,calls=0;const s=store(),client={transport:{mode:'websocket'},userStream:{status:'connected',revision:1},get accountRevision(){return this.userStream.revision;},async account(){calls++;return {};},async positions(){return [];},async openOrders(){return [];}};
 const engine=new TradingEngine(s,{now:()=>time});engine.client=client;engine.connected=true;engine.state.dataTransport=transportSettings();
 await engine.refreshAccount();time+=1000;await engine.refreshAccount();assert.equal(calls,1);client.userStream.revision++;await engine.refreshAccount();assert.equal(calls,2);await engine.refreshAccount(true);assert.equal(calls,3);
 let queries=0;const order={status:'NEW',appliedQty:0};await engine.pollTrackedOrder(order,async()=>queries++);time+=1000;await engine.pollTrackedOrder(order,async()=>queries++);assert.equal(queries,1);client.userStream.revision++;await engine.pollTrackedOrder(order,async()=>queries++);assert.equal(queries,2);
 order.status='UNKNOWN';await engine.pollTrackedOrder(order,async()=>queries++);assert.equal(queries,3);
 client.userStream.status='reconnecting';time+=15000;await engine.refreshAccount();assert.equal(calls,4);time+=1000;await engine.refreshAccount();assert.equal(calls,4);
});
test('transport settings validate, persist across engine reload, and use the authenticated HTTP route',async()=>{
 assert.throws(()=>transportSettings({mode:'bad'}));for(const n of [0,2,301,3.5,NaN])assert.throws(()=>transportSettings({mode:'rest',restIntervalSeconds:n}));
 const s=store(),clientFactory=()=>({configureDataTransport(value){this.transport=value;},transportStatus(){return {settings:this.transport};},clearCredentials(){}});
 const app=await createServer({store:s,clientFactory,marketData:{configureDataTransport(){}}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 try{const base='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(base+'/api/session')).json(),headers={'X-Workroom-Token':token,'Content-Type':'application/json'};
 assert.equal((await fetch(base+'/api/data-transport',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 let response=await fetch(base+'/api/data-transport',{method:'POST',headers,body:JSON.stringify({mode:'rest',restIntervalSeconds:25})});assert.equal(response.status,200);assert.deepEqual((await response.json()).settings,{mode:'rest',restIntervalSeconds:25});
 response=await fetch(base+'/api/data-transport',{method:'POST',headers,body:'{"mode":"rest","restIntervalSeconds":1}'});assert.equal(response.status,400);assert.equal(s.state.dataTransport.restIntervalSeconds,25);
 const reloaded=await new TradingEngine(s,{clientFactory}).init();assert.deepEqual(reloaded.state.dataTransport,{mode:'rest',restIntervalSeconds:25});
 }finally{await new Promise(resolve=>app.server.close(resolve));}
});

test('changing REST cadence discards cached deadlines and live PNL uses streamed marks without changing trading balances',async()=>{
 let time=1000000,reads=0;const budget=new RequestBudget({now:()=>time}),streams=new MarketStreams({now:()=>time,WebSocketImpl:Socket});streams.budget=budget;
 try{
 streams.configure({mode:'rest',restIntervalSeconds:300});await streams.read(budget,'ticker','BTCUSDT',async()=>++reads);streams.configure({mode:'rest',restIntervalSeconds:3});time+=3000;await streams.read(budget,'ticker','BTCUSDT',async()=>++reads);assert.equal(reads,2);
 streams.configure({mode:'websocket',restIntervalSeconds:15});const {c}=streams.touch('premium','BTCUSDT');c.socket.open();c.socket.message({e:'markPriceUpdate',s:'BTCUSDT',E:time,p:'110',r:'0'});
 const engine=new TradingEngine(store(),{now:()=>time});engine.state.dataTransport=transportSettings();engine.client={streams};engine.accountSnapshot={availableBalance:50,walletBalance:100,positions:[{symbol:'BTCUSDT',quantity:-2,entryPrice:100,markPrice:100,unrealizedProfit:0,notional:200}]};
 const view=engine.liveAccount();assert.equal(view.positions[0].unrealizedProfit,-20);assert.equal(view.positions[0].notional,220);assert.equal(view.availableBalance,50);assert.equal(engine.accountSnapshot.positions[0].markPrice,100);
 }finally{streams.close();}
});
