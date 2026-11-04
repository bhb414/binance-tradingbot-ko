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
