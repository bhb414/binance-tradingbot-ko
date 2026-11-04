import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../backend/store.mjs';
import {buildTradeHistory,mergeCoverage,fundingRecords,TradeHistory} from '../backend/trade-history.mjs';
import {PositionInsights} from '../backend/position-insights.mjs';
import {createServer} from '../server.mjs';
import {makeBot} from '../public/core.js';
const scope='live:account',now=2000000000000;
function state(){return {...emptyState(),scope,bots:[{id:'b',name:'봇',symbol:'BTCUSDT',budget:100,leverage:20,runtime:{quantity:0,realized:0}}],fundingCoverage:[{scope,start:0,end:now}]};}
function fill(s,{id,at,botId='b',symbol='BTCUSDT',role='entry',direction='LONG',qty=1,price=100,leverage=20,fee=0.1,asset='USDT',legacy=false,feesFetched=true,source='bot'}){
 const order={id,scope,botId,role,direction,leverage:legacy?undefined:leverage,margin:role==='entry'?qty*price/leverage:0,createdAt:at-50,appliedQty:qty,appliedQuote:qty*price,feesFetched,orderId:s.orders.length+1,source,parameters:{symbol,side:direction==='LONG'?(role==='entry'?'BUY':'SELL'):(role==='entry'?'SELL':'BUY'),positionSide:'BOTH',quantity:String(qty),price:String(price)}};
 s.orders.push(order);s.fills.push({id:id+':'+qty,scope,botId,symbol,at,role,side:order.parameters.side,quantity:qty,price,...(!legacy?{leverage,clientOrderId:id,tradeTime:at}: {})});
 if(fee!=null)s.fills.push({id:'fee:'+scope+':'+symbol+':'+order.orderId+':1',scope,botId,symbol,at,fee,feeAsset:asset,...(!legacy?{clientOrderId:id,orderId:order.orderId}: {})});return order;
}
const report=(s,options={})=>buildTradeHistory({state:s,botId:'b',now,...options});
test('additional entries and partial closes form one trade and charge every entry/exit fee once',()=>{
 const s=state();fill(s,{id:'e1',at:1000,qty:2,price:100,fee:.2});fill(s,{id:'x1',at:2000,qty:1,price:120,role:'exit',fee:.1});fill(s,{id:'e2',at:3000,qty:1,price:110,leverage:10,fee:.1});fill(s,{id:'x2',at:5000,qty:2,price:90,role:'exit',fee:.2});
 s.fundingLedger=[{id:'f',scope,symbol:'BTCUSDT',at:4000,amount:-.4,asset:'USDT'}];s.bots[0].runtime.realized=-10.6;
 const r=report(s),t=r.trades[0];assert.equal(r.trades.length,1);assert.equal(t.status,'closed');assert.equal(t.events.length,4);assert.equal(t.entryQuantity,3);assert.equal(t.exitQuantity,3);assert.equal(t.gross,-10);assert.ok(Math.abs(t.fee-.6)<1e-10);assert.ok(Math.abs(t.net+11)<1e-10);assert.equal(t.entryMargin,21);assert.ok(Math.abs(t.returnPercent-(-11/21*100))<1e-8);assert.equal(r.summary.losses,1);
});
test('short PnL, funding income and fee rebates preserve their signs and exclude unowned manual trades',()=>{
 const s=state();fill(s,{id:'e',at:1000,qty:2,price:100,direction:'SHORT',fee:1});fill(s,{id:'x',at:4000,qty:2,price:80,role:'exit',direction:'SHORT',fee:-.1});s.fundingLedger=[{id:'f',scope,symbol:'BTCUSDT',at:2500,amount:2,asset:'USDT'}];s.fills.push({id:'manual',scope,botId:null,at:2000,role:'manual',quantity:100,price:1});
 const r=report(s);assert.equal(r.trades[0].gross,40);assert.ok(Math.abs(r.summary.net-41.1)<1e-9);assert.equal(r.summary.wins,1);assert.equal(r.trades[0].entryMargin,10);
});
test('a profitable price move can be a net losing trade and costs are not deducted again from runtime PnL',()=>{
 const s=state();fill(s,{id:'e',at:1000,fee:1});fill(s,{id:'x',at:4000,role:'exit',price:101,fee:1});s.bots[0].runtime.realized=-1;
 const r=report(s);assert.equal(r.trades[0].gross,1);assert.equal(r.trades[0].net,-1);assert.equal(r.summary.winRate,0);assert.equal(r.summary.losses,1);
});
test('unknown fees, non-USDT commissions and uncovered funding never become zero-cost confirmed returns',()=>{
 for(const change of ['pending','currency','coverage']){
 const s=state();fill(s,{id:'e',at:1000,asset:change==='currency'?'BNB':'USDT',feesFetched:change!=='pending'});fill(s,{id:'x',at:3000,role:'exit',price:110});if(change==='coverage')s.fundingCoverage=[];
 const r=report(s);assert.equal(r.trades[0].net,null);assert.equal(r.summary.confirmed,0);assert.equal(r.summary.pending,1);assert.equal(r.curve.length,1);assert.ok(r.trades[0].costReasons.length);
 }
});
test('imported positions retain their entry and gross close but flag unavailable pre-import costs',()=>{
 const s=state();s.positionImports=[{id:'i',scope,botId:'b',symbol:'BTCUSDT',at:1000,quantity:2,entryPrice:100,direction:'LONG'}];fill(s,{id:'x',at:3000,role:'exit',qty:2,price:110});
 const r=report(s),t=r.trades[0];assert.equal(t.imported,true);assert.equal(t.gross,20);assert.equal(t.net,null);assert.equal(t.entryMargin,null);
});
test('precise exchange trades replace a delayed aggregate fill and attribute funding to the true held interval',()=>{
 const s=state(),o=fill(s,{id:'e',at:5000,qty:2,price:105,fee:null});o.createdAt=900;
 s.fills.push(...[{id:'t1',at:1000,tradePrice:100},{id:'t2',at:3000,tradePrice:110}].map(t=>({...t,scope,botId:'b',symbol:'BTCUSDT',clientOrderId:'e',tradeQuantity:1,fee:.1,feeAsset:'USDT'})));
 fill(s,{id:'x',at:6000,qty:2,price:110,role:'exit'});s.fundingLedger=[{id:'f',scope,symbol:'BTCUSDT',at:2000,amount:-1,asset:'USDT'}];
 const t=report(s).trades[0];assert.equal(t.openedAt,1000);assert.equal(t.events.length,3);assert.equal(t.events[0].timeEstimated,false);assert.equal(t.funding,-1);assert.ok(Math.abs(t.net-8.7)<1e-8);
});
test('legacy fee IDs with colon-containing scopes map correctly and leverage estimates remain visible',()=>{
 const s=state();fill(s,{id:'e',at:1000,qty:2,price:100,legacy:true});fill(s,{id:'x',at:3000,qty:2,price:110,role:'exit',legacy:true});
 s.fills.push({...s.fills[0]},{...s.fills[1]});const r=report(s),t=r.trades[0];assert.equal(t.entryMargin,10);assert.equal(t.marginEstimated,true);assert.ok(Math.abs(t.net-19.8)<1e-8);assert.equal(t.events.length,2);for(const fee of s.fills.filter(f=>f.fee!=null))fee.id='fee:'+s.orders.find(o=>o.id===fee.clientOrderId||fee.id.startsWith('fee:'+scope+':BTCUSDT:'+o.orderId+':')).orderId+':1';assert.ok(Math.abs(report(s).trades[0].net-19.8)<1e-8);
});
test('funding is not assigned outside ownership or across ambiguous boundary/hedge positions',()=>{
 const s=state();fill(s,{id:'e',at:1000});fill(s,{id:'x',at:3000,role:'exit',price:110});s.fundingLedger=[{id:'before',scope,symbol:'BTCUSDT',at:500,amount:-100,asset:'USDT'},{id:'during',scope,symbol:'BTCUSDT',at:2000,amount:-1,asset:'USDT'},{id:'after',scope,symbol:'BTCUSDT',at:3500,amount:-100,asset:'USDT'}];assert.equal(report(s).trades[0].funding,-1);
 s.fundingLedger.push({id:'boundary',scope,symbol:'BTCUSDT',at:1000,amount:-2,asset:'USDT'});assert.equal(report(s).trades[0].net,null);
 s.fundingLedger=s.fundingLedger.filter(f=>f.id!=='boundary');s.orders[0].parameters.positionSide='LONG';assert.equal(report(s).trades[0].net,null);
});
test('multi-symbol and overall views combine workers including removed legs without merging their positions',()=>{
 const s=state();s.multiBots=[{id:'p',kind:'multi',name:'다중',budget:500,legs:[]}];s.bots.push({id:'p_A',multiBotId:'p',symbol:'BTCUSDT',budget:250,runtime:{}});
 fill(s,{id:'a1',at:1000,botId:'p_A',leverage:2});fill(s,{id:'a2',at:3000,botId:'p_A',role:'exit',price:110,leverage:2});
 fill(s,{id:'b1',at:2000,botId:'p_B',symbol:'ETHUSDT',direction:'SHORT',price:50,leverage:4});fill(s,{id:'b2',at:4000,botId:'p_B',symbol:'ETHUSDT',direction:'SHORT',role:'exit',price:45,leverage:4});
 const r=report(s,{botId:'p'});assert.equal(r.summary.closed,2);assert.ok(Math.abs(r.summary.net-14.6)<1e-9);assert.equal(r.bot.budget,500);assert.equal(r.trades[0].entryMargin,12.5);assert.equal(report(s,{botId:null}).bot.budget,600);
});
test('drawdown and win statistics use complete net trades; current positions and missing entry records are separate',()=>{
 const s=state();for(const[i,gain]of[10,-20,5].entries()){fill(s,{id:'e'+i,at:1000+i*3000,fee:0});fill(s,{id:'x'+i,at:2000+i*3000,price:100+gain,role:'exit',fee:0});}
 const r=report(s);assert.equal(r.summary.confirmed,3);assert.equal(r.summary.net,-5);assert.equal(r.summary.maxDrawdownAmount,20);assert.ok(Math.abs(r.summary.maxDrawdownPercent-20/110*100)<1e-9);assert.equal(r.summary.wins,2);assert.equal(r.summary.losses,1);assert.equal(r.curve.at(-1).equity,95);
 fill(s,{id:'open',at:12000,fee:0});assert.equal(report(s).summary.open,1);assert.equal(report(s).summary.confirmed,3);const broken=state();fill(broken,{id:'orphan',at:2000,role:'exit',price:120});assert.equal(report(broken).trades[0].gross,null);
});
test('periods use close time, pagination is bounded and other account data stays excluded',()=>{
 const s=state();fill(s,{id:'e',at:now-20*86400000});fill(s,{id:'x',at:now-2*86400000,role:'exit',price:110});assert.equal(report(s,{range:'7d'}).trades.length,1);assert.equal(report(s,{range:'7d',page:99}).pagination.page,1);
 s.fills.push({id:'foreign',scope:'other',botId:'b',at:now-10000,role:'entry',quantity:100,price:100});assert.equal(report(s).trades.length,1);assert.throws(()=>report(s,{range:'bad'}));assert.throws(()=>report(s,{page:-1}));assert.throws(()=>report(s,{botId:'missing'}));
});
test('funding coverage merges contiguous verified windows and persists deduplicated payments for future offline views',async()=>{
 assert.deepEqual(mergeCoverage([{start:10,end:20},{start:1,end:9},{start:30,end:40}]),[{start:1,end:20},{start:30,end:40}]);
 const s=state();delete s.fundingLedger;delete s.fundingCoverage;let writes=0,time=now;const rows=[{symbol:'BTCUSDT',incomeType:'FUNDING_FEE',asset:'USDT',income:'-.5',time:now-100,tranId:1}],client={async symbolConfig(){return[];},async income(){return rows;}},e={connected:true,client,hedge:false,state:s,now:()=>time,serial:async fn=>fn(),checkpoint:async()=>writes++},service=new PositionInsights(e);
 await service.get();assert.equal(s.fundingLedger.length,1);assert.equal(s.fundingLedger[0].amount,-.5);assert.equal(writes,1);time+=60001;service.cache=null;await service.get();assert.equal(s.fundingLedger.length,1);assert.equal(s.fundingCoverage.length,1);assert.equal(writes,2);assert.equal(fundingRecords(rows,scope)[0].id,s.fundingLedger[0].id);
});
test('history routes require a session and support local-only offline ledger analysis without exchange calls',async()=>{
 const s=state();fill(s,{id:'e',at:1000});fill(s,{id:'x',at:3000,role:'exit',price:110});s.bots=s.bots.map(b=>({...makeBot(),...b}));const store={state:s,async load(){return s;},async save(){}},app=await createServer({store,clientFactory:()=>({clearCredentials(){},redact:s=>s}),marketData:{}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));try{
 const base='http://127.0.0.1:'+app.server.address().port;assert.equal((await fetch(base+'/api/trade-history')).status,403);const{token}=await(await fetch(base+'/api/session')).json(),headers={'X-Workroom-Token':token};
 const r=await fetch(base+'/api/bots/b/history?range=all',{headers});assert.equal(r.status,200);assert.equal((await r.json()).summary.closed,1);assert.equal((await fetch(base+'/api/trade-history?page=0',{headers})).status,400);
 }finally{await new Promise(resolve=>app.server.close(resolve));}
});

test('partially returned trade commissions remain unconfirmed instead of understating round-trip costs',()=>{
 const s=state();fill(s,{id:'e',at:1000,qty:2});fill(s,{id:'x',at:3000,role:'exit',qty:2,price:110});s.fills.find(f=>f.clientOrderId==='e'&&f.fee!=null).tradeQuantity=1;
 assert.equal(report(s).trades[0].net,null);assert.ok(report(s).trades[0].costReasons.some(r=>r.includes('일부 체결')));
});

test('pagination includes every completed round-trip once and old verified funding remains usable after offline restart',()=>{
 const s=state();for(let i=0;i<45;i++){fill(s,{id:'e'+i,at:1000+i*2000});fill(s,{id:'x'+i,at:1500+i*2000,role:'exit',price:101});}
 const reports=[1,2,3].map(page=>report(s,{page}));assert.deepEqual(reports.map(r=>r.trades.length),[20,20,5]);assert.equal(new Set(reports.flatMap(r=>r.trades.map(t=>t.id))).size,45);
 s.fundingLedger=[{id:'old',scope,symbol:'BTCUSDT',at:1200,amount:-.5,asset:'USDT'}];const restored=JSON.parse(JSON.stringify(s));const result=report(restored,{now:now+200*86400000,funding:{scope,complete:false,startTime:now,endTime:now,rows:[]}});assert.equal(result.summary.confirmed,45);assert.ok(Math.abs(result.summary.net-(45*.8-.5))<1e-7);
});

test('reset periods hide earlier completed trades in bot and combined reports without deleting ledger rows',()=>{
 const s=state();fill(s,{id:'old-e',at:1000});fill(s,{id:'old-x',at:2000,role:'exit',price:110});fill(s,{id:'new-e',at:4000});fill(s,{id:'new-x',at:5000,role:'exit',price:95});s.bots[0].statsReset={scope,at:3000,realized:9.8};const rows=s.fills.length;
 for(const botId of ['b',null]){const r=buildTradeHistory({state:s,botId,now});assert.equal(r.trades.length,1);assert.equal(r.trades[0].openedAt,4000);assert.equal(r.summary.closed,1);assert.ok(Math.abs(r.summary.net+5.2)<1e-8);assert.equal(r.curve.at(-1).net,r.summary.net);}assert.equal(s.fills.length,rows);
 s.bots[0].statsReset.scope='another-account';assert.equal(report(s).trades.length,2);
});
test('multi reset periods also hide archived member trades in both group and combined reports',()=>{
 const s=state();s.bots[0].id='parent_A';s.bots[0].multiBotId='parent';s.multiBots=[{id:'parent',kind:'multi',name:'다중',budget:100,legs:[{alias:'A',symbol:'BTCUSDT'}],statsReset:{scope,at:3000,realized:0}}];
 fill(s,{id:'e',botId:'parent_A',at:1000});fill(s,{id:'x',botId:'parent_A',at:2000,role:'exit',price:110});s.bots=[];
 for(const botId of ['parent',null])assert.equal(buildTradeHistory({state:s,botId,now}).trades.length,0);assert.equal(s.orders.length,2);
});
test('funding displayed after a statistics reset excludes earlier ownership income',()=>{
 const s=state();s.bots[0].runtime.quantity=0;s.bots[0].statsReset={scope,at:3000,realized:0};s.fills=[{scope,botId:'b',at:1000,quantity:1,role:'entry'},{scope,botId:'b',at:2000,quantity:1,role:'exit'},{scope,botId:'b',at:4000,quantity:1,role:'entry'}];
 const e={state:s,hedge:false,now:()=>6000},insights=new PositionInsights(e),rows=[{symbol:'BTCUSDT',incomeType:'FUNDING_FEE',time:1500,asset:'USDT',income:5},{symbol:'BTCUSDT',incomeType:'FUNDING_FEE',time:4500,asset:'USDT',income:-.2}];
 assert.equal(insights.botFunding(rows,0,true).b.funding,-.2);assert.equal(insights.botFunding(rows,0,true).b.startTime,3000);
});

test('wallet percentage reports use the current wallet target rather than an unused amount setting',()=>{const s=state();Object.assign(s.bots[0],{budget:500,budgetType:'walletPercent',budgetPercent:25});fill(s,{id:'e',at:1000,fee:0});fill(s,{id:'x',at:3000,role:'exit',price:110,fee:0});const r=report(s,{account:{walletBalance:200,positions:[]}});assert.equal(r.bot.budget,50);assert.equal(r.summary.returnPercent,20);assert.equal(r.curve.at(-1).equity,60);});
