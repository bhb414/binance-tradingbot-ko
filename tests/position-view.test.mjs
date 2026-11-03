import test from 'node:test';
import assert from 'node:assert/strict';
import {accountView} from '../backend/account-view.mjs';
import {PositionInsights} from '../backend/position-insights.mjs';
import {orderDirection,orderEstimate,orderCapacity,previewSize} from '../public/manual-sizing.js';
import {botPerformance} from '../public/performance.js';

test('fees and funding retain their signs and type-specific IDs, and bot funding follows actual ownership times',async()=>{
  const now=1800000000000,scope='a',at=now-3600000,bot={id:'b',symbol:'XUSDT',budget:100,pnl:9.8,fees:.2,runtime:{quantity:1}},rows=[
    {symbol:'XUSDT',incomeType:'REALIZED_PNL',asset:'USDT',income:'5',time:at+100,tranId:1},
    {symbol:'XUSDT',incomeType:'COMMISSION',asset:'USDT',income:'-.2',time:at+100,tranId:1},
    {symbol:'XUSDT',incomeType:'FUNDING_FEE',asset:'USDT',income:'-9',time:at-1,tranId:1},
    {symbol:'XUSDT',incomeType:'FUNDING_FEE',asset:'USDT',income:'-.5',time:at+100,tranId:2},
    {symbol:'XUSDT',incomeType:'FUNDING_FEE',asset:'USDT',income:'.1',time:at+200,tranId:3}];
  const client={async symbolConfig(){return [];},async income(){return [...rows,rows[1]];}},engine={connected:true,client,hedge:false,state:{scope,bots:[bot],fills:[],positionImports:[{scope,botId:'b',at,quantity:1}]},now:()=>now},service=new PositionInsights(engine),result=await service.get();
  assert.equal(result.realized.bySymbol.XUSDT,5);assert.equal(result.realized.costsBySymbol.XUSDT.commission,-.2);assert.ok(Math.abs(result.realized.netBySymbol.XUSDT+4.6)<1e-9);
  assert.equal(result.botFunding.b.complete,true);assert.equal(result.botFunding.b.funding,-.4);
  const performance=botPerformance(bot,result);assert.equal(performance.gross,10);assert.equal(performance.grossPercent,10);assert.equal(performance.net,9.4);assert.equal(performance.netPercent,9.4);
  bot.costsPending=true;assert.equal(botPerformance(bot,result).net,null);bot.costsPending=false;engine.hedge=true;service.cache=null;assert.equal((await service.get()).botFunding.b.complete,false);
});

test('position information preserves liquidation prices and uses isolated equity or USDT cross collateral for ratios',()=>{
  const positions=[{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:'2',entryPrice:'100',markPrice:'110',notional:'220',positionInitialMargin:'11',isolatedWallet:'0',maintMargin:'2',liquidationPrice:'84',unRealizedProfit:'20'},{symbol:'ETHUSDT',positionSide:'SHORT',positionAmt:'-1',entryPrice:'100',markPrice:'110',positionInitialMargin:'11',isolatedWallet:'30',maintMargin:'1',liquidationPrice:'125',unRealizedProfit:'-10'}];
  const account={assets:[{asset:'USDT',walletBalance:'100',availableBalance:'50',maintMargin:'3',crossWalletBalance:'70',crossUnPnl:'20'}]},view=accountView(account,positions,[],true),[cross,isolated]=view.positions;
  assert.equal(cross.marginType,'CROSSED');assert.equal(cross.leverage,20);assert.equal(cross.liquidationPrice,84);assert.equal(cross.notional,220);assert.equal(cross.marginRatio,2/90*100);assert.equal(cross.marginRatioScope,'account');assert.equal(isolated.marginRatio,5);assert.equal(isolated.marginType,'ISOLATED');
  const missing=accountView({assets:[]},[{symbol:'X',positionAmt:'1'}],[],false).positions[0];assert.equal(missing.leverage,null);assert.equal(missing.marginRatio,null);assert.equal(missing.liquidationPrice,null);
});

test('Buy/Sell and Reduce Only map to the correct owned side, with close capacity excluding pending reductions',()=>{
  assert.equal(orderDirection('BUY'), 'LONG');assert.equal(orderDirection('SELL'),'SHORT');assert.equal(orderDirection('BUY',true),'SHORT');assert.equal(orderDirection('SELL',true),'LONG');
  const context={connected:true,hedge:true,positions:[{positionSide:'SHORT',quantity:-2},{positionSide:'LONG',quantity:3}],orders:[{positionSide:'SHORT',side:'BUY',quantity:1,executedQuantity:.3}],availableBalance:100,brackets:[{initialLeverage:20,notionalCap:10000}],notionalCoef:1};
  assert.ok(Math.abs(orderCapacity(context,{side:'BUY',reduceOnly:true,price:100,leverage:20}).quantity-1.3)<1e-8);assert.equal(orderCapacity(context,{side:'SELL',reduceOnly:true,price:100,leverage:20}).quantity,3);
  assert.deepEqual(orderEstimate('10','margin',100,20),{notional:200,margin:10,quantity:2});assert.equal(orderCapacity(context,{side:'BUY',price:100,leverage:20}).margin,98);
  assert.deepEqual(previewSize('margin','10',20,false),{sizeMode:'notional',amount:'200'});assert.deepEqual(previewSize('margin','10',20,true),{sizeMode:'margin',amount:'10'});assert.throws(()=>previewSize('margin','NaN',20,false));
});

test('realized PnL is complete over a fixed 30-day window, deduplicated, currency-filtered and cached',async()=>{
  const now=1800000000000,start=now-30*86400000,reads=[],client={async symbolConfig(){return [{symbol:'XUSDT',marginType:'CROSSED',leverage:20}];},async income(params){reads.push(params);return [{symbol:'XUSDT',incomeType:'REALIZED_PNL',asset:'USDT',income:'-3',time:start,tranId:1},{symbol:'XUSDT',incomeType:'REALIZED_PNL',asset:'USDT',income:'-3',time:start,tranId:1},{symbol:'XUSDT',incomeType:'REALIZED_PNL',asset:'USDT',income:'5',time:now,tranId:2},{symbol:'XUSDT',incomeType:'COMMISSION',asset:'USDT',income:'-1',time:now,tranId:3},{symbol:'XUSDT',incomeType:'REALIZED_PNL',asset:'BNB',income:'2',time:now,tranId:4}];}},engine={connected:true,client,state:{scope:'account-a'},connectionId:'a',now:()=>now},service=new PositionInsights(engine);
  const [a,b]=await Promise.all([service.get(),service.get()]);assert.equal(a.realized.bySymbol.XUSDT,2);assert.equal(a,b);assert.equal(a.realized.complete,true);assert.equal(a.settings.XUSDT.leverage,20);await service.get();assert.equal(reads.length,1);assert.equal(reads[0].incomeType,undefined);assert.equal(a.realized.netBySymbol.XUSDT,1);assert.equal(a.realized.costsBySymbol.XUSDT.commission,-1);assert.equal(a.realized.costsBySymbol.XUSDT.complete,false);assert.equal(reads[0].startTime,start);assert.equal(reads[0].endTime,now);
});

test('income queries split capped windows without dropping boundary records; failure never presents partial totals as complete',async()=>{
  const now=1800000000000,start=now-30*86400000,mid=Math.floor((start+now)/2),rows=Array.from({length:1000},(_,i)=>({symbol:'X',asset:'USDT',incomeType:'REALIZED_PNL',income:'1',time:i<500?mid:mid+1,tranId:i}));
  const client={async symbolConfig(){return [];},async income({startTime,endTime}){return rows.filter(row=>row.time>=startTime&&row.time<=endTime);}},engine={connected:true,client,state:{scope:'a'},now:()=>now},service=new PositionInsights(engine);
  assert.equal((await service.get()).realized.bySymbol.X,1000);service.cache=null;client.income=async()=>{throw new Error('timeout');};const failed=await service.get();assert.equal(failed.realized.complete,false);assert.deepEqual(failed.realized.bySymbol,{});
});

test('account changes invalidate pending and cached position insight responses',async()=>{
  let finish;const client={async symbolConfig(){return [];},async income(){await new Promise(resolve=>finish=resolve);return [];}},engine={connected:true,client,state:{scope:'a'},now:()=>1800000000000},service=new PositionInsights(engine),pending=service.get();await Promise.resolve();await Promise.resolve();engine.client={};engine.state.scope='b';finish();await assert.rejects(()=>pending,/계좌가 변경/);
});
