import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBot,validateBot} from '../public/core.js';
import {makeMultiBot,validateMulti} from '../public/multi-bot.js';
import {budgetSettingsErrors,effectiveBudget} from '../public/budget.js';
import {entryOrder,EntryCapacityError} from '../backend/orders.mjs';
const symbols=['BTCUSDT','ETHUSDT'];
test('single and multi bots accept sub-10-USDT and zero budgets across fixed, compounding and wallet-step modes',()=>{
 for(const budget of [0,.01,.25,1,5,9.99])for(const mode of ['fixed','pnl','capped','floor']){
  const b=makeBot({budget,budgetMode:mode,...(mode==='floor'?{budgetFloor:0}:{})});assert.deepEqual(validateBot(b,[],{symbols}),[]);assert.equal(effectiveBudget(b),budget);
  const multi=makeMultiBot({budget,budgetMode:mode,...(mode==='floor'?{budgetFloor:0}:{})});assert.deepEqual(validateMulti(multi,{symbols}),[]);
 }
 assert.deepEqual(budgetSettingsErrors(makeBot({budget:.5,budgetType:'walletStep'})),[]);
 for(const budget of [-1,NaN,Infinity,100000001,'1'])assert(budgetSettingsErrors(makeBot({budget})).some(s=>s.includes('운용 예산')));
 assert(budgetSettingsErrors(makeBot({budget:1,budgetMode:'floor',budgetFloor:2})).some(s=>s.includes('최소 운용한도')));
});
const info=minNotional=>({filters:[{filterType:'PRICE_FILTER',tickSize:'0.01'},{filterType:'LOT_SIZE',minQty:'0.01',maxQty:'100000',stepSize:'0.01'},{filterType:'MIN_NOTIONAL',notional:String(minNotional)}]});
const bot=(budget,leverage=20)=>makeBot({budget,leverage,entryPercent:100,order:{type:'MARKET',price:'bid',ticks:0,postOnly:false}}),book={bids:[['10','100']],asks:[['10','100']]};
test('entry uses leveraged and rounded notional against each symbol filter, never a minimum cash budget',()=>{
 const order=entryOrder(bot(1),info(5),book,100);assert.equal(order.parameters.quantity,'1.98');assert.equal(Number(order.parameters.quantity)*10,19.8);assert(order.margin<1);
 for(const [b,min,reason]of [[bot(1,2),5,'min-notional'],[bot(1),20,'min-notional'],[bot(.1),5,'min-notional'],[bot(0),5,'no-margin']])assert.throws(()=>entryOrder(b,info(min),book,100),e=>e instanceof EntryCapacityError&&e.reason===reason);
});
