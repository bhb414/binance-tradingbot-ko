import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFormula,formulaTimeframes,applyWholeTimeframe} from '../public/formula.js';
import {evaluateRuleFormula} from '../public/formula-runtime.js';
import {signatureAt} from '../public/formula-signature.js';
import {upgradeActions,makeActionRule} from '../public/actions.js';
import {normalizeBrackets,leverageCap,notionalCap} from '../public/leverage.js';
import {createServer} from '../server.mjs';
import {emptyState} from '../backend/store.mjs';
const now=36000000;
const snapshot=(values,seconds)=>({serverNow:now,candles:values.map((close,index)=>({time:now/1000-(values.length-1-index)*seconds,closeTime:now-(values.length-1-index)*seconds*1000+seconds*1000-1,open:close-1,high:close+1,low:close-2,close,volume:10}))});
const markets=()=>({'5m':snapshot([1,2,3,1000],300),'1h':snapshot([10,20,30,999],3600)});
const value=(source,feeds=markets())=>evaluateRuleFormula(source,feeds).result.value;

test('postfix frame lags and sums count their own candles, including function results',()=>{
  assert.equal(value('종가@5m[2] + EMA(종가, 2)@1h[1]'),27);
  assert.equal(value('종가@5m[1:4]/3'),2);
  assert.equal(value('종가[2]@5m'),2);
  assert.deepEqual(formulaTimeframes('종가@1h[1] > 종가@5m[1]'),['5m','1h']);
  assert.equal(compileFormula('종가@5m[2]').ast.value.type,'lag');
});
test('zero uses the current candle while historical indicator values ignore changing live candles',()=>{
  const feeds=markets();assert.equal(value('종가@5m'),1000);assert.equal(value('종가@5m[0]'),1000);
  assert.equal(value('종가@5m[1]'),3);assert.equal(value('EMA(종가, 2)@1h[1]',feeds),25);
  feeds['1h'].candles.at(-1).close=999999;assert.equal(value('EMA(종가, 2)@1h[1]',feeds),25);
  assert.equal(value('상향돌파(종가, 10)@5m'),1);assert.equal(value('상향돌파(종가, 10)@5m[1]'),0);
});
test('whole-expression scope is inherited by BB and RSI with explicit inner overrides',()=>{
  const source='(종가[1] > 볼린저상단(종가, 2, 2)[1] OR RSI(종가, 2)[1] > 60)@5m';
  assert.equal(value(source),1);
  assert.equal(value('(종가 + 종가@1h[1])@5m'),1030);
  assert.equal(value('(종가 > 종가[1])@5m[1]'),1);
});
test('whole-frame assignment retains all offsets and applies to all existing timeframes',()=>{
  const assigned=applyWholeTimeframe('종가@5m[2] + EMA(종가, 2)@1h[1]','5m');
  assert.deepEqual(formulaTimeframes(assigned),['5m']);assert.equal(value(assigned),4.5);
  assert.equal(value(applyWholeTimeframe('종가[1] + SMA(종가, 2)[1]','5m')),5.5);
  assert.deepEqual(formulaTimeframes(applyWholeTimeframe(assigned,'1h')),['1h']);
  assert.throws(()=>applyWholeTimeframe('종가','2minutes'));assert.throws(()=>applyWholeTimeframe('','5m'));
});
test('ambiguous historical sampling across timeframes and unscoped data cannot run',()=>{
  for(const source of ['종가 > 1','EMA(종가, 2)','EMA(종가@1h, 2)@5m','상향돌파(종가@5m, 종가@1h)','(종가@5m + 종가@1h)[1]','봉(종가, 5, 0)'])assert.throws(()=>formulaTimeframes(source),source);
  for(const source of ['종가@2m','종가@5M','종가@5m[-1]','종가@5m[1.2]','종가@5m;process.exit()'])assert.throws(()=>compileFormula(source),source);
  assert.deepEqual(formulaTimeframes('종가@1M > 종가@1w'),['1w','1M']);
});
test('all feeds must be fresh, future-dated candles are ignored and missing history stays unknown',()=>{
  const feeds=markets();feeds['1h'].serverNow+=7200000;
  assert.throws(()=>value('종가@5m > 종가@1h',feeds),/최신 봉/);
  const future=markets();future['5m'].candles.push({...future['5m'].candles.at(-1),time:now/1000+300,close:7777});
  assert.equal(value('종가@5m',future),1000);
  assert.equal(evaluateRuleFormula('종가@5m[100] > 0',markets()).result.missing,true);
  assert.throws(()=>value('종가@1d'),/조회하지/);
});
test('multi-feed evaluation shares an operation budget and keeps unavailable values unknown',()=>{
  const formula=compileFormula('SMA(종가, 3)@5m + SMA(종가, 3)@1h'),frames={'5m':{close:[1,2,3]},'1h':{close:[10,20,30]}};
  assert.equal(formula.evaluate(frames['5m'],2,{frames,maxSteps:8}).ok,false);
  assert.equal(formula.evaluate(frames['5m'],2,{frames,maxSteps:100}).value,22);
  assert.equal(formula.evaluate(frames['5m'],2).missing,true);
});
test('legacy closed/live rules migrate once without enabling rules or losing source data',()=>{
  const bot={actionRules:[{id:'a',enabled:true,formula:'종가[2] > EMA(종가, 20)',timeframe:'1h',candle:'closed'},{id:'b',enabled:false,formula:'종가 > 5',timeframe:'5m',candle:'live'}]},original=structuredClone(bot);
  const upgraded=upgradeActions(bot);assert.equal(upgraded.actionRules[0].formula,'(종가[2] > EMA(종가, 20))@1h[1]');assert.equal(upgraded.actionRules[1].formula,'(종가 > 5)@5m');
  assert.equal(upgraded.actionRules[1].enabled,false);assert.equal(upgradeActions(upgraded),upgraded);assert.deepEqual(bot,original);
  assert.equal('timeframe' in makeActionRule(),false);assert.equal('candle' in makeActionRule(),false);
});
test('function help follows the innermost call and its active argument, even in incomplete text',()=>{
  let text='상향돌파(종가, 볼린저상단(종가, 20, ';
  assert.equal(signatureAt(text,text.length).name,'볼린저상단');assert.equal(signatureAt(text,text.length).argument,2);
  text+='2)';assert.equal(signatureAt(text,text.length).name,'상향돌파');assert.equal(signatureAt(text,text.length).argument,1);
  text+=')@5m';assert.equal(signatureAt(text,text.length),null);
  text='EMA((종가[0:3]/3), ';assert.equal(signatureAt(text,text.length).argument,1);
  assert.equal(signatureAt('CrossUp(종가, ',12).name,'CrossUp');
});
test('leverage follows the account symbol tiers and full assigned budget, preserving unknown limits',()=>{
  const current=normalizeBrackets([{symbol:'BTCUSDT',brackets:[{initialLeverage:150,notionalFloor:0,notionalCap:300000},{initialLeverage:100,notionalFloor:300000,notionalCap:800000}]}],'BTCUSDT');assert.equal(current.maxLeverage,150);assert.equal(leverageCap({available:true,...current},500),150);assert.equal(leverageCap({available:true,...current},3000),100);
  const limits={available:true,...normalizeBrackets([{symbol:'BTCUSDT',brackets:[{initialLeverage:125,notionalFloor:0,notionalCap:50000},{initialLeverage:50,notionalFloor:50000,notionalCap:250000},{initialLeverage:20,notionalFloor:250000,notionalCap:1000000}]}],'BTCUSDT')};
  assert.equal(leverageCap(limits,100),125);assert.equal(leverageCap(limits,500),100);assert.equal(leverageCap(limits,1000),50);assert.equal(notionalCap(limits,125),50000);
  assert.equal(leverageCap({available:false},100),125);assert.throws(()=>normalizeBrackets([], 'BTCUSDT'));
  assert.equal(leverageCap(limits,2000000),0);assert.throws(()=>normalizeBrackets([{symbol:'ETHUSDT',brackets:[{initialLeverage:20,notionalFloor:0,notionalCap:100}]}],'BTCUSDT'));
});
test('leverage HTTP lookup requires a token, reports unavailable before connection and never mutates exchange settings',async()=>{
  let mutations=0,reads=0;
  const fake={offset:0,clearCredentials(){},redact:s=>s,async exchangeInfo(){return {symbols:[{symbol:'BTCUSDT',status:'TRADING',quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL'}]};},async syncTime(){},async account(){return {assets:[]};},async positions(){return [];},async positionMode(){return {};},async openOrders(){return [];},async leverageBrackets(){reads++;return {symbol:'BTCUSDT',brackets:[{initialLeverage:20,notionalFloor:0,notionalCap:100000}]};},async changeLeverage(){mutations++;},async changeMargin(){mutations++;}};
  const store={state:emptyState(),async load(){},async save(){}},app=await createServer({store,clientFactory:()=>fake});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));clearInterval(app.engine.timer);
  try{
    const base='http://127.0.0.1:'+app.server.address().port,{token}=await (await fetch(base+'/api/session')).json(),headers={'X-Workroom-Token':token};
    assert.equal((await fetch(base+'/api/leverage?symbol=BTCUSDT')).status,403);
    let response=await fetch(base+'/api/leverage?symbol=BTCUSDT',{headers});assert.equal((await response.json()).available,false);assert.equal(reads,0);
    await app.engine.connect({environment:'testnet',apiKey:'fabricated-test-api-key',secret:'fabricated-test-secret'});
    response=await fetch(base+'/api/leverage?symbol=BTCUSDT',{headers});assert.equal((await response.json()).maxLeverage,20);
    assert.equal(reads,1);assert.equal(mutations,0);
  }finally{await new Promise(resolve=>app.server.close(resolve));}
});
