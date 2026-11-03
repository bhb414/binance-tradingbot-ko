import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartWorkspace,CHART_WORKSPACE_KEY,normalizeChartWorkspace,rangeOffset,restoredRange,presetRange} from '../public/chart-workspace.js';
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};};
test('last market, symbol, interval and Heikin chart survive a new workspace instance',()=>{
  const storage=memory(),a=new ChartWorkspace(storage);a.select({market:'spot',symbol:'ETHUSDT',interval:'1h',candleType:'heikin',range:'7d'});
  const b=new ChartWorkspace(storage);assert.deepEqual(b.selection,{market:'spot',symbol:'ETHUSDT',interval:'1h',candleType:'heikin',range:'7d'});
  a.select({market:'options',symbol:'BTC-261127-100000-C'});assert.equal(new ChartWorkspace(storage).selection.symbol,'BTC-261127-100000-C');
});
test('chart zoom and panel ratios restore independently per market and interval, price lines stay with their instrument',()=>{
  const storage=memory(),a=new ChartWorkspace(storage);a.remember('usdm','SPYUSDT','1h',{range:{from:600,to:800},count:1000,panes:{price:.7,rsi:.3},price:{autoScale:false,from:90,to:120},lines:[100,110]});
  a.remember('spot','SPYUSDT','1h',{range:{from:900,to:1007},count:1000,panes:{price:1},lines:[10]});const b=new ChartWorkspace(storage);
  assert.deepEqual(restoredRange(b.view('usdm','SPYUSDT','1h').offset,1001),{from:601,to:801});assert.deepEqual(b.view('usdm','SPYUSDT','1h').panes,{price:.7,rsi:.3});assert.deepEqual(b.view('usdm','SPYUSDT','1h').price,{autoScale:false,from:90,to:120});assert.deepEqual(b.view('usdm','SPYUSDT','15m'),{});
  assert.deepEqual(b.lines('usdm','SPYUSDT'),[100,110]);assert.deepEqual(b.lines('spot','SPYUSDT'),[10]);assert.deepEqual(b.lines('usdm','BTCUSDT'),[]);
});
test('invalid or unavailable browser storage cannot stop the chart, and saved history is bounded',()=>{
  const storage=memory();storage.setItem(CHART_WORKSPACE_KEY,'broken');assert.equal(new ChartWorkspace(storage).selection.symbol,'BTCUSDT');let warnings=0;
  const a=new ChartWorkspace({getItem(){throw Error();},setItem(){throw Error();}},()=>warnings++);a.select({symbol:'INTCUSDT'});a.select({interval:'1h'});assert.equal(warnings,1);assert.equal(a.selection.symbol,'INTCUSDT');
  const value=normalizeChartWorkspace({version:1,selection:{market:'bad',symbol:'<img>',interval:'bad',candleType:'bad'},views:{'usdm:XUSDT:1h':{offset:{from:10,to:-20},panes:{price:-1}}},lines:{'usdm:XUSDT':[NaN,Infinity,-1,20]}});assert.equal(value.selection.symbol,'BTCUSDT');assert.equal(value.views['usdm:XUSDT:1h'].offset,undefined);assert.deepEqual(value.lines['usdm:XUSDT'],[20]);
  assert.equal(rangeOffset(null,100),null);assert.deepEqual(presetRange(1000,'1h','7d'),{from:832,to:1007});assert.deepEqual(restoredRange({from:-800,to:-600},50),{from:-5,to:5});
  for(let i=0;i<50;i++)a.remember('usdm','X'+i+'USDT','1h',{range:{from:1,to:20},count:100,panes:{},lines:[i+1]});assert.equal(Object.keys(a.value.views).length,40);assert.equal(Object.keys(a.value.lines).length,40);
});
