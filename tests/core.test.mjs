import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBot, seedBots, makeGroup, makeCondition, allocations, validateBot, startErrors, describeRule, makeCandles, movingAverage, budgetUsage, positionMargin } from '../public/core.js';

test('budget allocation rejects over-allocation but permits lowering the limit below committed margin',()=>{
  const bots=seedBots();assert.equal(allocations(bots).assigned,2600);assert.equal(allocations(bots).available,2400);
  const bot=makeBot({budget:2500});assert.ok(validateBot(bot,bots).some(e=>e.includes('초과')));
  bot.budget=2400;assert.deepEqual(validateBot(bot,bots),[]);
  bot.budget=100;bot.used=80;bot.reserved=30;assert.deepEqual(validateBot(bot,bots),[]);
  assert.deepEqual(budgetUsage(bot),{inPositions:80,pending:30,available:0,overBudget:10});
});

test('isolated budget counts the actual isolated wallet including added margin, while cross counts required margin',()=>{
  const position={quantity:-3,entryPrice:100,markPrice:105,initialMargin:105,isolatedMargin:180};
  assert.equal(positionMargin(position,3,'ISOLATED'),180);assert.equal(positionMargin(position,3,'CROSSED'),105);
  assert.equal(positionMargin({...position,isolatedMargin:0,initialMargin:0},3,'ISOLATED'),105);
  assert.equal(positionMargin({...position,quantity:0},3,'ISOLATED'),0);
});
test('malformed numeric settings and empty conditions cannot be saved',()=>{
  for (const [key,value] of [['budget',NaN],['leverage',Infinity],['entryPercent',0],['maxEntries',1.5]]) { const b=makeBot({[key]:value});assert.ok(validateBot(b).length,key); }
  const b=makeBot({conditionMode:'legacy'});b.rules.children=[];assert.ok(validateBot(b).some(e=>e.includes('조건 그룹')));
});

test('TP and SL are optional independently, absent switches retain legacy protection, and enabled limits remain validated',()=>{
  assert.deepEqual(validateBot(makeBot()),[]);
  const off={takeProfitEnabled:false,stopLossEnabled:false};assert.deepEqual(validateBot(makeBot({exit:off})),[]);
  assert.deepEqual(validateBot(makeBot({direction:'SHORT',exit:{...makeBot().exit,takeProfit:1000,takeProfitEnabled:false}})),[]);
  assert.deepEqual(validateBot(makeBot({exit:{...makeBot().exit,stopLoss:1000,stopLossEnabled:false}})),[]);
  for(const change of [{takeProfitEnabled:'false'},{stopLossEnabled:0},{takeProfit:0},{stopLoss:NaN},{price:'INVALID'}])assert.ok(validateBot(makeBot({exit:{...makeBot().exit,...change}})).length);
});
test('same-symbol running bots cannot request conflicting exchange settings',()=>{
  const a=makeBot({symbol:'BTCUSDT',status:'running',leverage:3});const b=makeBot({symbol:'BTCUSDT',leverage:5});
  assert.ok(startErrors(b,[a,b]).some(e=>e.includes('충돌')));
  b.leverage=3;assert.deepEqual(startErrors(b,[a,b]),[]);
  b.margin='CROSSED';assert.ok(startErrors(b,[a,b]).some(e=>e.includes('충돌')));
});
test('mixed-timeframe comparisons work; crosses require matching bar definitions',()=>{
  const b=makeBot({conditionMode:'legacy'});const rule=b.rules.children[0];rule.operator='gt';rule.targetTimeframe='1h';assert.deepEqual(validateBot(b),[]);
  rule.operator='cross_up';assert.ok(validateBot(b).some(e=>e.includes('양쪽 봉')));
  rule.targetTimeframe=rule.timeframe;assert.deepEqual(validateBot(b),[]);
  rule.targetCandle='live';assert.ok(validateBot(b).length);
});
test('nested AND/OR conditions preserve their meaning in the saved preview',()=>{
  const b=makeBot({conditionMode:'legacy'});const group=makeGroup();group.logic='OR';group.children[0].targetType='value';group.children[0].value=100;group.children.push(makeCondition());b.rules.children.push(group);
  assert.deepEqual(validateBot(b),[]);assert.ok(describeRule(b.rules).includes(' AND ('));assert.ok(describeRule(b.rules).includes(' OR '));
  let current=b.rules;for(let i=0;i<4;i++){const child=makeGroup();current.children=[child];current=child;}assert.ok(validateBot(b).some(e=>e.includes('3단계')));
});
test('demo candles are deterministic OHLC and indicators have correct history windows',()=>{
  const data=makeCandles('BTCUSDT','15m');assert.deepEqual(data,makeCandles('BTCUSDT','15m'));assert.equal(data.length,260);
  assert.equal(data.at(-1).close,68432.8);assert.ok(data.every((c,i)=>c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)&&(!i||c.time>data[i-1].time)));
  assert.equal(movingAverage(data,20).length,241);assert.equal(movingAverage(data,20)[0].value,data.slice(0,20).reduce((s,c)=>s+c.close,0)/20);
});

test('TP/SL validates effective price thresholds using each entry leverage and rejects unknown bases or signed stored magnitudes',()=>{
 const b=makeBot({leverage:20,exit:{basis:'leveraged',takeProfit:200,stopLoss:200,price:'MARK_PRICE'}});assert.deepEqual(validateBot(b),[]);assert.ok(validateBot({...b,exit:{...b.exit,basis:'price'}}).length);
 assert.ok(validateBot({...b,leverage:1}).length);assert.ok(validateBot({...b,exit:{...b.exit,basis:'mystery'}}).length);assert.ok(validateBot({...b,exit:{...b.exit,stopLoss:-5}}).length);
});
