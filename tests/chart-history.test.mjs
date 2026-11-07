import test from 'node:test';import assert from 'node:assert/strict';
import {ChartHistory,mergeChartCandles,historyRange} from '../public/chart-history.js';
const c=(time,close=time)=>({time,open:close,high:close+1,low:close-1,close,volume:1});const context={market:'usdm',symbol:'BTCUSDT',interval:'1m'};const page=rows=>({...context,candles:rows});
function setup(request){let range={from:1,to:3};const renders=[],h=new ChartHistory({request,getRange:()=>range,setRange:r=>{range=r;},onChange:s=>renders.push(s),delay:0});return {h,renders,range:()=>range};}
test('prepend merges sorted timestamps, retains live values and shifts the viewport without changing width',async()=>{
 const paths=[],{h,renders,range}=setup(async path=>{paths.push(path);return page([c(60),c(120),c(180,999)]);});h.update(context,{candles:[c(180),c(240),c(300)],ticker:{lastPrice:300}});assert.equal((await h.loadOlder()).added,2);assert.deepEqual(h.current.snapshot.candles.map(c=>c.time),[60,120,180,240,300]);assert.equal(h.current.snapshot.candles[2].close,180);assert.deepEqual(range(),{from:3,to:5});assert.equal(renders.length,1);assert.match(paths[0],/before=180/);assert.match(paths[0],/limit=500/);h.destroy();
});
test('quote refresh keeps the historical prefix while replacing the current bar and adding the next bar',async()=>{
 const {h}=setup(async()=>page([c(60),c(120)]));h.update(context,{candles:[c(180),c(240)]});await h.loadOlder();const s=h.update(context,{candles:[c(240,999),c(300)],ticker:{lastPrice:999}});assert.deepEqual(s.candles.map(c=>c.time),[60,120,180,240,300]);assert.equal(s.candles[3].close,999);assert.equal(s.ticker.lastPrice,999);h.destroy();
});
test('a pending request is deduplicated and a late page never draws over a different symbol or timeframe',async()=>{
 let finish,calls=0;const {h,renders}=setup(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});h.update(context,{candles:[c(180),c(240)]});const pending=h.loadOlder();await h.loadOlder();assert.equal(calls,1);h.update({...context,symbol:'ETHUSDT'},{candles:[c(600),c(660)]});finish(page([c(60),c(120)]));await pending;assert.equal(renders.length,0);assert.equal(h.current.context.symbol,'ETHUSDT');assert.equal(h.view().count,2);h.select(context);assert.equal(h.view().count,4);h.update({...context,interval:'1h'},{candles:[c(3600)]});assert.equal(h.view().count,1);h.destroy();
});
test('live updates received during a history request are retained when the page arrives',async()=>{
 let finish;const {h}=setup(()=>new Promise(resolve=>{finish=resolve;}));h.update(context,{candles:[c(180),c(240)]});const pending=h.loadOlder();h.update(context,{candles:[c(180),c(240,999),c(300)]});finish(page([c(60),c(120)]));await pending;assert.deepEqual(h.current.snapshot.candles.map(c=>c.close),[60,120,180,999,300]);h.destroy();
});
test('short history pages still allow another page, and no progress stops requests at the exchange boundary',async()=>{
 let calls=0;const {h}=setup(async()=>{calls++;return page(calls===1?[c(120)]:[]);});h.update(context,{candles:[c(180)]});await h.loadOlder();assert.equal(h.view().exhausted,false);await h.loadOlder();assert.equal(h.view().exhausted,true);await h.loadOlder();assert.equal(calls,2);h.destroy();
});
test('errors leave candles and viewport intact, pause automatic retries and permit a manual retry',async()=>{
 let calls=0;const {h,range}=setup(async()=>{if(++calls===1)throw Error('rate limited');return page([c(120)]);});h.update(context,{candles:[c(180)]});assert.match((await h.loadOlder()).error,/rate/);assert.equal(h.view().count,1);assert.deepEqual(range(),{from:1,to:3});await h.loadOlder();assert.equal(calls,1);await h.loadOlder({manual:true});assert.equal(h.view().count,2);assert.equal(h.view().error,'');h.destroy();
});
test('manual navigation shows the new older section while automatic pagination preserves the current time span',()=>{
 assert.deepEqual(historyRange({from:900,to:1050},500,true),{from:360,to:510});assert.deepEqual(historyRange({from:-10,to:100},500),{from:490,to:600});assert.equal(historyRange(null,500),null);assert.deepEqual(mergeChartCandles([c(120),c(60)],[c(120,99),{time:NaN},c(180)]).map(c=>c.close),[60,99,180]);
});
test('an unresolved history request does not bridge a gap after the latest window was replaced',async()=>{
 let finish;const {h,renders}=setup(()=>new Promise(resolve=>{finish=resolve;}));h.update(context,{candles:[c(180)]});const pending=h.loadOlder();h.update(context,{candles:[c(6000)]});finish(page([c(120)]));await pending;assert.equal(renders.length,0);assert.deepEqual(h.current.snapshot.candles.map(c=>c.time),[6000]);h.destroy();
});
test('edge requests are debounced and do not run away after the viewport shifts',async()=>{
 let calls=0;const {h}=setup(async()=>{calls++;return page([c(60)]);});h.update(context,{candles:[c(120)]});h.viewChanged({from:100,to:200});await new Promise(r=>setTimeout(r,5));assert.equal(calls,0);h.viewChanged({from:0,to:100});h.viewChanged({from:0,to:100});await new Promise(r=>setTimeout(r,15));assert.equal(calls,1);h.destroy();
});
