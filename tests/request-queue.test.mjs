import test from 'node:test';
import assert from 'node:assert/strict';
import {BinanceClient} from '../backend/binance.mjs';
import {RequestQueue,requestPriority} from '../backend/request-queue.mjs';
const gate=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),get resolve(){return resolve;}};};
test('execution requests pass queued report reads, keep their FIFO order and sign only when sent',async()=>{
 const first=gate(),started=gate(),calls=[];let now=1800000000000;
 const client=new BinanceClient({apiKey:'fabricated-key',secret:'fabricated-secret',minGap:0,now:()=>now,fetchImpl:async(url,options)=>{const parsed=new URL(url);calls.push({path:parsed.pathname,method:options.method,query:options.body||parsed.search.slice(1)});if(calls.length===1){started.resolve();await first.promise;}return new Response('{}',{status:200});}});
 const a=client.income({startTime:1});await started.promise;const b=client.income({startTime:2}),c=client.income({startTime:3}),cancel=client.cancelOrder('BTCUSDT','owned-order'),query=client.queryOrder('BTCUSDT','owned-order');now+=5000;first.resolve();await Promise.all([a,b,c,cancel,query]);
 assert.deepEqual(calls.map(c=>c.method+':'+c.path),['GET:/fapi/v1/income','DELETE:/fapi/v1/order','GET:/fapi/v1/order','GET:/fapi/v1/income','GET:/fapi/v1/income']);assert.equal(new URLSearchParams(calls[1].query).get('timestamp'),String(now));
 const timings=client.rate.snapshot().usage.timings;assert.equal(timings.length,5);assert.equal(timings[1].priority,0);assert.equal(timings[1].queueMs,5000);assert.doesNotMatch(JSON.stringify(timings),/fabricated|owned-order|signature|apiKey/);
});
test('request failures do not strand queued work and timing history stays bounded',async()=>{
 let time=0;const queue=new RequestQueue({now:()=>time}),timings=[],first=gate(),started=gate();const a=queue.enqueue(async()=>{started.resolve();await first.promise;throw Error('failed');},{priority:2,onTiming:r=>timings.push(r)});await started.promise;const b=queue.enqueue(async()=>{time+=2;return 'done';},{priority:0,onTiming:r=>timings.push(r)});const rejected=assert.rejects(a,/failed/);time=5;first.resolve();await rejected;assert.equal(await b,'done');assert.deepEqual(timings.map(r=>r.ok),[false,true]);assert.equal(timings[1].queueMs,5);
});
test('shared fill reconciliation and order verification have execution priority without elevating report history',()=>{
 for(const endpoint of ['/fapi/v1/order','/fapi/v1/algoOrder','/fapi/v3/account','/fapi/v3/positionRisk'])assert.equal(requestPriority('GET',endpoint),0);
 assert.equal(requestPriority('GET','/fapi/v1/userTrades',{fromId:1}),0);assert.equal(requestPriority('GET','/fapi/v1/userTrades',{orderId:1}),2);assert.equal(requestPriority('GET','/fapi/v1/income'),2);assert.equal(requestPriority('GET','/fapi/v1/klines'),1);
});
