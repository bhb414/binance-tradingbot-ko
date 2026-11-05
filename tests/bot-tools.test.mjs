import {budgetBaselineReview} from '../public/bot-tools.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {copyBotSettings,resetBotSettings} from '../public/bot-tools.js';
import {makeBot,validateBot} from '../public/core.js';import {makeActionRule} from '../public/actions.js';
import {makeMultiBot,multiRule,multiTarget,validateMulti} from '../public/multi-bot.js';
import {botPerformance} from '../public/performance.js';
import {botStatusMarkup} from '../public/bot-status.js';
import {workroomPerformance,positionEmotion} from '../public/workroom-metrics.js';
test('single copies receive independent IDs and settings without position, PnL, history, or reset ownership',()=>{
 const source=makeBot({name:'원본',budget:40,actionRules:[makeActionRule({formula:'TRUE@1h',leverage:20})],runtime:{runEnabled:true,quantity:3,realized:12},statsReset:{at:1,scope:'live:x',realized:12},fees:2,orders:[{}],imported:{}}),copy=copyBotSettings(source);
 assert.notEqual(copy.id,source.id);assert.notEqual(copy.actionRules[0].id,source.actionRules[0].id);assert.notEqual(copy.rules.id,source.rules.id);assert.equal(copy.budget,40);assert.equal(copy.budgetIncluded,false);assert.equal(copy.actionRules[0].leverage,20);assert.match(copy.name,/복사본$/);
 for(const key of ['runtime','statsReset','fees','orders','imported','quantity','used','pnl'])assert.equal(copy[key],undefined);copy.actionRules[0].order.ticks=7;assert.equal(source.actionRules[0].order.ticks,0);
 assert.deepEqual(validateBot(copy,[],{symbols:['BTCUSDT'],balance:Infinity}),[]);
});
test('multi copies preserve allocations, symbols and per-leg policies with independent rules',()=>{
 const source=makeMultiBot();source.actionRules=[multiRule(source.legs,{formula:'(A.종가>B.종가)@1h',targets:[multiTarget('A',{action:'ENTER_SHORT',leverage:12}),multiTarget('B',{leverage:5})]})];source.runtime={runEnabled:true};source.members=[{quantity:3}];
 const copy=copyBotSettings(source);assert.notEqual(copy.id,source.id);assert.notEqual(copy.actionRules[0].id,source.actionRules[0].id);assert.deepEqual(copy.legs,source.legs);assert.deepEqual(copy.actionRules[0].targets,source.actionRules[0].targets);assert.equal(copy.members,undefined);assert.equal(copy.budgetIncluded,false);assert.equal(copy.runtime,undefined);assert.deepEqual(validateMulti(copy,{symbols:['BTCUSDT','ETHUSDT']}),[]);copy.legs[0].weight=30;assert.equal(source.legs[0].weight,50);
});
test('settings defaults preserve identity and capital while disabling entry conditions and protections',()=>{
 for(const source of [makeBot({name:'단일',symbol:'ETHUSDT',budget:40,budgetMode:'pnl',margin:'CROSSED',actionRules:[makeActionRule({formula:'TRUE@1h',leverage:20})]}),makeMultiBot({name:'여러 종목',budget:40})]){
 const next=resetBotSettings(source);assert.equal(next.id,source.id);assert.equal(next.name,source.name);assert.equal(next.budget,40);assert.equal(next.budgetMode,source.budgetMode);assert.equal(next.maxEntries,0);assert.equal(next.exit.takeProfitEnabled,false);assert.equal(next.exit.stopLossEnabled,false);assert.match(next.actionRules[0].formula,/FALSE/);
 if(source.kind==='multi'){assert.deepEqual(next.legs,source.legs);assert.deepEqual(validateMulti(next,{symbols:['BTCUSDT','ETHUSDT']}),[]);}else{assert.equal(next.symbol,'ETHUSDT');assert.deepEqual(validateBot(next,[],{symbols:['ETHUSDT'],balance:Infinity}),[]);}
 }
});
test('statistics baseline zeroes displayed realized returns without changing current position emotion or capital',()=>{
 const b={id:'b',budget:100,pnl:-25,fees:0,runtime:{realized:-25},statsReset:{at:100,realized:-25}};
 const perf=botPerformance(b,{botFunding:{b:{complete:true,statsResetAt:100,funding:0}}},[{botId:'b',at:50,fee:10,feeAsset:'BNB'}]);assert.equal(perf.gross,0);assert.equal(perf.net,0);assert.equal(perf.netPercent,0);assert.equal(workroomPerformance([b]).pnl,0);
 assert.equal(positionEmotion({...b,quantity:1,used:10,pnl:-23}).value,2);assert.equal(botPerformance({...b,pnl:-23,fees:.1},{botFunding:{b:{complete:true,statsResetAt:100,funding:-.2}}}).net,1.8);
});

test('pre-reset funding cache never leaks into newly reset returns',()=>{const b={id:'b',budget:100,pnl:-10,fees:0,statsReset:{at:100,realized:-10}},p=botPerformance(b,{botFunding:{b:{complete:true,funding:9}}});assert.equal(p.net,null);assert.equal(p.funding,null);assert.match(p.reason,/재조회/);});

test('new, copied and reset drafts open without live runtime data, including shared accounts',()=>{
 const source=makeBot({name:'원본',runtime:{runEnabled:true,quantity:1,realized:5}});
 const drafts=[makeBot(),copyBotSettings(source),resetBotSettings(source)];
 for(const draft of drafts)for(const sharedPositions of [false,true]){
  const html=botStatusMarkup(draft,{capabilities:{sharedPositions},account:{positions:[]},orders:[],fills:[]});
  assert.match(html,/먼저 저장/);assert.doesNotMatch(html,/data-bot-trade|data-bot-history|NaN|undefined/);
 }
});
test('saved shared bot status still uses its own profit and tolerates missing live valuation',()=>{
 const bot={...makeBot(),quantity:1,entryPrice:100,positionDirection:'LONG',used:10,pnl:15,runtime:{runEnabled:false,quantity:1,realized:5}};
 const state={capabilities:{sharedPositions:true},positionMode:'ONE_WAY',account:{positions:[{symbol:'BTCUSDT',quantity:3,markPrice:110,unrealizedProfit:30}]},orders:[],fills:[]};
 const html=botStatusMarkup(bot,state);
 assert.match(html,/미실현 손익<\/small><strong><span class="positive">\+10\.00 USDT/);
 assert.match(html,/data-bot-trade/);
 assert.doesNotMatch(botStatusMarkup({...bot,pnl:undefined},state),/NaN|undefined/);
});

test('budget baseline review distinguishes preserved records from the new budget period and escapes error text',()=>{
 const p={base:100,mode:'pnl',before:88,after:100,budgetPnl:-12,allowed:true,warnings:['운용 유지']},html=budgetBaselineReview(p);
 assert.match(html,/88.00/);assert.match(html,/100.00/);assert.match(html,/통계/);assert.match(html,/미실현손익/);assert.match(html,/정리 시 확정/);assert.match(html,/운용 유지/);
 assert.doesNotMatch(budgetBaselineReview({...p,allowed:false,reason:'<script>bad</script>'}),/<script>/);
 for(const source of [makeBot({runtime:{budgetBaseline:{at:1,realized:-10}}}),makeMultiBot({runtime:{budgetBaseline:{at:1,realized:-10}}})]){assert.equal(copyBotSettings(source).runtime,undefined);assert.equal(resetBotSettings(source).runtime,undefined);}
});

test('copy and settings reset preserve percentage and shortfall policies without live allocations',()=>{for(const budgetType of ['walletPercent','availablePercent'])for(const source of [makeBot(),makeMultiBot()]){Object.assign(source,{budgetType,budgetPercent:35,budgetShortfall:'available',budgetMode:'floor',budgetFloor:20,budgetAllocation:{limit:17}});for(const result of [copyBotSettings(source),resetBotSettings(source)]){assert.equal(result.budgetType,budgetType);assert.equal(result.budgetPercent,35);assert.equal(result.budgetShortfall,'available');assert.equal(result.budgetFloor,20);assert.equal(result.budgetAllocation,undefined);}}});
