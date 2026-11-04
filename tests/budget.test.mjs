import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveBudget} from '../public/budget.js';
import {makeBot,validateBot,budgetUsage} from '../public/core.js';

test('budget modes distinguish fixed limits, compounding profits, capped recovery, and exhaustion',()=>{
  const expected={fixed:[1000,1000,1000,1000],pnl:[900,1000,1200,0],capped:[900,1000,1000,0]};
  for(const mode of Object.keys(expected))for(const [i,realized]of [-100,0,200,-1500].entries())assert.equal(effectiveBudget({budget:1000,budgetMode:mode,runtime:{realized}}),expected[mode][i]);
  assert.equal(effectiveBudget({budget:1000,runtime:{realized:-100}}),1000);
  const bot=makeBot({budget:1000,budgetMode:'pnl',used:500,reserved:200,runtime:{realized:-400}});assert.deepEqual(budgetUsage(bot),{inPositions:500,pending:200,available:0,overBudget:100});
  assert.ok(validateBot({...bot,budgetMode:'automatic-refill'}).some(e=>e.includes('손익 반영')));
});

test('changing base capital preserves accumulated realized results and allocations use current limits',()=>{
  const b=makeBot({budget:1000,budgetMode:'capped',runtime:{realized:-100}});assert.equal(effectiveBudget({...b,budget:1500}),1400);
  assert.deepEqual(validateBot(makeBot({budget:100}),[b],{balance:1000}),[]);
  assert.ok(validateBot(makeBot({budget:101}),[b],{balance:1000}).some(e=>e.includes('초과')));
});

test('budget baselines keep the original lifetime PnL and apply only subsequent changes in every mode',()=>{
 for(const mode of ['fixed','pnl','capped']){
  const runtime={realized:-200,budgetBaseline:{at:10,realized:-200}},b={budget:1000,budgetMode:mode,runtime};assert.equal(effectiveBudget(b),1000);
  runtime.realized=-250;assert.equal(effectiveBudget(b),mode==='fixed'?1000:950);
  runtime.realized=100;assert.equal(effectiveBudget(b),mode==='pnl'?1300:1000);
  runtime.budgetBaseline={at:20,realized:100};assert.equal(effectiveBudget(b),1000);
  runtime.realized=-1500;assert.equal(effectiveBudget(b),mode==='fixed'?1000:0);
 }
});

test('withheld profit is not reallocated after rate changes and baseline reset does not affect lifetime PnL',()=>{
 const b={budget:200,budgetMode:'pnl',profitReinvestPercent:50,runtime:{realized:60,budgetWithheld:50}};assert.equal(effectiveBudget(b),210);
 b.profitReinvestPercent=0;assert.equal(effectiveBudget(b),210);b.runtime.budgetBaseline={realized:60,withheld:50};assert.equal(effectiveBudget(b),200);
 b.runtime.realized=40;assert.equal(effectiveBudget(b),180);assert.equal(effectiveBudget({...b,budgetMode:'fixed'}),200);
 for(const p of [0,25,50,100]){const bot=makeBot({profitReinvestPercent:p});assert.deepEqual(validateBot(bot,[],{balance:Infinity}),[]);}
});
import {resolveBudgets,withBudgetAllocation,requestedBudget,budgetSettingsErrors} from '../public/budget.js';
test('available budget is opt-in and restores the fixed target when wallet capacity recovers',()=>{const strict={id:'s',budget:100},flex={...strict,budgetShortfall:'available'};assert.equal(resolveBudgets([strict],70).get('s').limit,100);assert.equal(resolveBudgets([flex],70).get('s').limit,70);assert.equal(resolveBudgets([flex],130).get('s').limit,100);assert.ok(validateBot(makeBot({...strict}),[],{balance:70}).some(e=>e.includes('초과')));assert.deepEqual(validateBot(makeBot({...flex}),[],{balance:70}),[]);});
test('wallet percentage follows realized wallet capital without adding bot PNL again',()=>{const bot={id:'p',budget:500,budgetType:'walletPercent',budgetPercent:25,budgetMode:'pnl',runtime:{realized:-1000}};assert.equal(requestedBudget(bot,200),50);assert.equal(requestedBudget(bot,80),20);assert.equal(requestedBudget(bot,0),0);assert.equal(effectiveBudget(withBudgetAllocation(bot,[bot],200)),50);for(const value of [0,-1,101,NaN])assert.ok(budgetSettingsErrors({...bot,budgetPercent:value}).length);assert.deepEqual(budgetSettingsErrors(bot),[]);});
test('flexible allocations stay proportional after the first bot fills and respect outstanding commitments',()=>{const strict={id:'s',budget:40},a={id:'a',budget:100,budgetShortfall:'available'},b={...a,id:'b'};let limits=resolveBudgets([strict,a,b],100);assert.equal(limits.get('a').limit,30);assert.equal(limits.get('b').limit,30);limits=resolveBudgets([strict,{...a,used:29.7},b],100);assert.equal(limits.get('a').limit,30);assert.equal(limits.get('b').limit,30);limits=resolveBudgets([strict,{...a,used:35,reserved:5},b],100);assert.equal(limits.get('a').limit,40);assert.equal(limits.get('b').limit,20);});
test('flexible budgets conserve finite wallet capacity and ignore archived targets',()=>{for(const wallet of [0,1,50,100,500])for(const used of [0,20,80,150]){const bots=[{id:'a',budget:100,budgetShortfall:'available',used},{id:'b',budget:200,budgetShortfall:'available',reserved:10},{id:'z',budget:1000,budgetIncluded:false}];const limits=resolveBudgets(bots,wallet);assert.ok(limits.get('a').limit+limits.get('b').limit<=wallet+1e-8);assert.ok(limits.get('a').limit>=0&&limits.get('a').limit<=100);assert.ok(limits.get('b').limit>=0&&limits.get('b').limit<=200);}});
test('edited budget settings cannot reuse an old resolved limit',()=>{const b={id:'a',budget:100,budgetShortfall:'available'},view=withBudgetAllocation(b,[b],70);assert.equal(effectiveBudget(view),70);assert.equal(effectiveBudget({...view,budget:50}),50);assert.equal(effectiveBudget(withBudgetAllocation({...view,budget:50},[view],70)),50);});

test('minimum budget preserves losses until cumulative recovery exceeds the floor and respects the profit rate',()=>{const b=makeBot({budget:100,budgetMode:'floor',budgetFloor:30,profitReinvestPercent:50,runtime:{realized:0,budgetWithheld:0}});assert.deepEqual(budgetSettingsErrors(b),[]);b.runtime.realized=-40;assert.equal(effectiveBudget(b),60);b.runtime.realized=-100;assert.equal(effectiveBudget(b),30);b.runtime.realized=-80;assert.equal(effectiveBudget(b),30);b.runtime.realized=-60;assert.equal(effectiveBudget(b),40);b.runtime.budgetWithheld=20;assert.equal(effectiveBudget(b),30);b.runtime.realized=-40;assert.equal(effectiveBudget(b),40);b.runtime.budgetBaseline={realized:-40,withheld:20};assert.equal(effectiveBudget(b),100);b.runtime.realized=-50;assert.equal(effectiveBudget(b),90);assert.equal(b.runtime.realized,-50);assert.equal(effectiveBudget({...b,budgetType:'walletPercent',budgetPercent:25,budgetAllocation:{wallet:200}}),50);});
test('minimum amount validates, participates in allocation and invalidates stale cached limits',()=>{const b=makeBot({id:'f',budget:100,budgetMode:'floor',budgetFloor:30,budgetShortfall:'available',runtime:{realized:-100}});for(const v of [-1,101,NaN,undefined])assert.ok(budgetSettingsErrors({...b,budgetFloor:v}).length);const view=withBudgetAllocation(b,[b],20);assert.equal(effectiveBudget(view),20);assert.equal(effectiveBudget({...view,budgetFloor:40}),40);});
