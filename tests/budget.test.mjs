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
