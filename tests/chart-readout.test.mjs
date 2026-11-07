import test from 'node:test';
import assert from 'node:assert/strict';
import {koreanChartTime,koreanTickMark,koreanTimeOptions,CurrentPriceLine,CandleInspection} from '../public/chart-readout.js';
import {accountView,withAccountEquity} from '../backend/account-view.mjs';
import {TradingEngine} from '../backend/engine.mjs';
import {emptyState} from '../backend/store.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,a+' != '+b);
test('axis ticks and crosshair use KST across midnight and year boundaries without shifting candle timestamps',()=>{
 const t=Date.parse('2026-11-04T15:30:45Z')/1000;
 assert.equal(koreanTickMark(t,3),'00:30');assert.equal(koreanTickMark(t,4),'00:30:45');assert.equal(koreanTickMark(t,2),'11/5');assert.equal(koreanChartTime(t),'2026.11.05 00:30 KST');
 const year=Date.parse('2026-12-31T16:00:00Z')/1000;assert.equal(koreanTickMark(year,0),'2027');assert.equal(koreanTickMark(year,1),'1월');assert.equal(koreanChartTime('2026-11-04'),'2026.11.04 09:00 KST');assert.equal(koreanChartTime({year:2026,month:11,day:4}),'2026.11.04 09:00 KST');
 for(const value of [null,undefined,NaN,'invalid'])assert.equal(koreanChartTime(value),'—');
 const options=koreanTimeOptions();assert.equal(options.timeScale.tickMarkFormatter(t,3),'00:30');assert.equal(options.localization.timeFormatter(t),'2026.11.05 00:30 KST');assert.equal(t,Date.parse('2026-11-04T15:30:45Z')/1000);
});
test('the current-price axis line follows only real ticker prices and never edits entry lines or drawings',()=>{
 const created=[],removed=[],entry={title:'롱 평단'},drawing={title:'수평선'},series={createPriceLine(options){const line={options,applyOptions(next){this.options=next;}};created.push(line);return line;},removePriceLine(line){removed.push(line);}};
 const current=new CurrentPriceLine(series);current.update(123.4,121.2);assert.equal(created[0].options.price,123.4);assert.equal(created[0].options.title,'현재가');current.update(123.4,121.2);assert.equal(created.length,1);
 current.update('122.8',123);assert.equal(created[0].options.price,122.8);assert.equal(created[0].options.color,'#df6879');
 for(const value of [NaN,Infinity,null,undefined,'',0,-1])current.update(value);assert.equal(removed.length,1);assert.ok(!removed.includes(entry)&&!removed.includes(drawing));current.update(125,124);assert.equal(created.length,2);
});
function inspector(){
 let view,drawing=false;const chart={subscribeCrosshairMove(f){this.move=f;},subscribeClick(f){this.click=f;},unsubscribeCrosshairMove(f){assert.equal(f,this.move);this.move=null;},unsubscribeClick(f){assert.equal(f,this.click);this.click=null;}},studies={valuesAt(t){this.time=t;},readingsAt(t){return[{label:'수식 지표',value:String(t)}];}},raw=[{time:100,open:10,high:13,low:9,close:12,volume:2},{time:200,open:12,high:16,low:11,close:15,volume:3}],model=new CandleInspection({chart,studies,onChange:v=>view=v,isDrawing:()=>drawing});
 model.update({key:'usdm:BTCUSDT:1m',raw});return {model,chart,studies,raw,get view(){return view;},setDrawing:v=>drawing=v};
}
test('click pins historical OHLC and indicator time through hover and live refresh; release returns to latest',()=>{
 const f=inspector();assert.equal(f.view.time,200);f.chart.move({time:100});assert.equal(f.view.candle.close,12);assert.equal(f.studies.time,100);
 f.chart.click({time:100});assert.equal(f.view.pinned,true);assert.equal(f.view.selected,true);f.chart.move({time:200});assert.equal(f.view.time,100);
 f.model.update({key:'usdm:BTCUSDT:1m',raw:[...f.raw,{time:300,close:18}]});assert.equal(f.view.time,100);assert.equal(f.view.candle.close,12);assert.equal(f.studies.time,100);assert.equal(f.view.selected,false);
 f.model.release();assert.equal(f.view.time,300);assert.equal(f.view.pinned,false);f.chart.move({});assert.equal(f.view.time,300);f.model.destroy();assert.equal(f.chart.click,null);
});
test('Heikin inspection distinguishes synthetic OHLC from actual close, and symbol/interval changes or aged-out pins reset safely',()=>{
 const f=inspector();f.chart.click({time:100});f.model.update({key:'usdm:BTCUSDT:1m',raw:f.raw,displayed:f.raw.map(c=>({...c,close:c.close-1})),heikin:true});assert.equal(f.view.candle.close,11);assert.equal(f.view.raw.close,12);assert.equal(f.view.heikin,true);
 f.model.update({key:'spot:BTCUSDT:1m',raw:f.raw});assert.equal(f.view.pinned,false);assert.equal(f.view.time,200);f.chart.click({time:100});f.model.update({key:'spot:BTCUSDT:1m',raw:[f.raw[1]]});assert.equal(f.view.pinned,false);assert.equal(f.view.time,200);
 f.model.clear();assert.equal(f.view.time,null);assert.equal(f.view.candle,undefined);
});
test('drawing clicks, blank future chart space and invalid times cannot select a different candle',()=>{
 const f=inspector();f.setDrawing(true);f.chart.click({time:100});assert.equal(f.view.pinned,false);f.chart.move({time:100});assert.equal(f.view.time,200);f.setDrawing(false);
 f.chart.click({time:NaN});f.chart.click({time:300});f.chart.click({});assert.equal(f.view.pinned,false);f.chart.click({time:100});assert.equal(f.view.time,100);f.chart.click({time:200});assert.equal(f.view.time,200);
});

test('pointer movements within one candle or future blank space do not repeatedly format legends, while new quote data still refreshes',()=>{
 const f=inspector(),publish=f.model.onChange;let updates=0;f.model.onChange=view=>{updates++;publish(view);};
 for(let i=0;i<100;i++)f.chart.move({time:100,point:{x:i,y:i}});assert.equal(updates,1);assert.equal(f.view.time,100);
 const next=structuredClone(f.raw);next[0].close=13;f.model.update({key:'usdm:BTCUSDT:1m',raw:next});assert.equal(updates,2);assert.equal(f.view.raw.close,13);
 for(let i=0;i<100;i++)f.chart.move({time:300+i,point:{x:i,y:i}});assert.equal(updates,3);assert.equal(f.view.time,200);
});
test('USDT equity includes both cross and isolated unrealized PnL, keeps wallet/free collateral separate, and can be negative',()=>{
 const positions=[{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:'2',entryPrice:'100',markPrice:'110',unRealizedProfit:'20',marginAsset:'USDT'},{symbol:'ETHUSDT',positionSide:'SHORT',positionAmt:'-1',entryPrice:'100',markPrice:'110',unRealizedProfit:'-10',isolatedWallet:'30',marginAsset:'USDT'},{symbol:'BTCUSDC',positionSide:'BOTH',positionAmt:'1',entryPrice:'100',markPrice:'500',unRealizedProfit:'400',marginAsset:'USDC'}];
 const a=accountView({assets:[{asset:'USDT',walletBalance:'100',availableBalance:'50'}]},positions,[],true);assert.equal(a.unrealizedProfit,10);assert.equal(a.equity,110);assert.equal(a.walletBalance,100);assert.equal(a.availableBalance,50);
 assert.equal(withAccountEquity({walletBalance:10,unrealizedProfit:-20}).equity,-10);assert.equal(withAccountEquity({walletBalance:null,unrealizedProfit:0}).equity,null);
});
test('fresh streamed USDT marks update aggregate PnL/equity once while retaining unmodeled account PnL and excluding USDC',()=>{
 const account={walletBalance:100,availableBalance:40,unrealizedProfit:12,positions:[{symbol:'BTCUSDT',positionSide:'BOTH',marginAsset:'USDT',unrealizedProfit:10},{symbol:'ETHUSDT',positionSide:'SHORT',marginAsset:'USDT',unrealizedProfit:-1},{symbol:'BTCUSDC',positionSide:'BOTH',marginAsset:'USDC',unrealizedProfit:30}]},copy=structuredClone(account),next=[{...account.positions[1],unrealizedProfit:-2},{...account.positions[2],unrealizedProfit:300},{...account.positions[0],unrealizedProfit:18}];
 const a=withAccountEquity(account,next);assert.equal(a.unrealizedProfit,19);assert.equal(a.equity,119);assert.equal(a.walletBalance,100);assert.equal(a.availableBalance,40);assert.deepEqual(account,copy);assert.deepEqual(withAccountEquity(a),a);
});
test('engine live equity uses the same mark stream as bot positions and leaves stored capital and REST reads untouched',()=>{
 const engine=new TradingEngine({state:{...emptyState(),dataTransport:{mode:'websocket'}}});let reads=0;engine.client={streams:{channels:new Map([['market',{}]]),fresh:()=>({value:{markPrice:'110'}})},account:()=>reads++};
 engine.accountSnapshot={walletBalance:100,availableBalance:50,unrealizedProfit:0,positions:[{symbol:'BTCUSDT',positionSide:'BOTH',quantity:-2,entryPrice:100,markPrice:100,unrealizedProfit:0,notional:200}]};
 const a=engine.liveAccount();assert.equal(a.unrealizedProfit,-20);assert.equal(a.equity,80);assert.equal(a.availableBalance,50);assert.equal(engine.accountSnapshot.unrealizedProfit,0);assert.equal(reads,0);near(a.positions[0].markPrice,110);
 engine.state.dataTransport.mode='rest';assert.equal(engine.liveAccount().equity,100);
});
