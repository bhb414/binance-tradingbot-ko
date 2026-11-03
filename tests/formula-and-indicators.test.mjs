import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFormula, upgradeBot } from '../public/formula.js';
import { heikinAshi, bollingerBands, formulaSeries } from '../public/indicators.js';
import { makeBot, makeCandles, validateBot } from '../public/core.js';
import { roomLayout } from '../public/room.js';

const evaluate=(source,series,index=series.close.length-1)=>compileFormula(source).evaluate(series,index);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('the analysis expression grammar accepts arithmetic, grouping, Korean aliases, logic and historical values',()=>{
  const series={close:[10,12,15],open:[9,10,14],volume:[100,200,300]};
  assert.equal(evaluate('(종가 / 시가 * 100 - 100 > 5) AND 종가[1] = 12',series).pass,true);
  assert.equal(evaluate('거래량 > SMA(거래량, 2) * 1.1 OR 종가 < 0',series).pass,true);
  assert.equal(evaluate('NOT (종가 < 시가) 그리고 종가 > 종가[1]',series).pass,true);
  assert.equal(evaluate('상향돌파(종가, 11)',series,1).pass,true);
  assert.equal(evaluate('하향돌파(종가, 11)',series,1).pass,false);
});

test('unavailable history and division by zero remain unknown, including under NOT and cross functions',()=>{
  for(const source of ['종가 / 0','NOT (종가[5] > 0)','상향돌파(종가, 2)','범위내(종가[5], 0, 10)']){
    const result=evaluate(source,{close:[1]},0);assert.equal(result.pass,false,source);assert.equal(result.missing,true,source);
  }
  assert.equal(evaluate('TRUE OR 종가[5]',{close:[1]}).pass,true);
  assert.equal(evaluate('FALSE AND 종가[5]',{close:[1]}).missing,false);
});

test('formula input cannot execute JavaScript and invalid indicator periods cannot be saved',()=>{
  for(const source of ['globalThis.process.exit()','fetch(종가)','constructor(1)','종가; alert(1)','SMA(종가, 0)','EMA(종가, 1.5)','RSI(종가, 501)','ATR(0)'])assert.throws(()=>compileFormula(source),source);
  assert.throws(()=>compileFormula('('.repeat(90)+'종가'+')'.repeat(90)));
  assert.throws(()=>compileFormula('종가'.repeat(501)));
  assert.ok(validateBot(makeBot({formula:'종가 >'})).length);
  assert.deepEqual(validateBot(makeBot({formula:'하이킨종가 > 하이킨시가 AND 종가 > 볼린저상단(종가, 55, 1.04)'})),[]);
});

test('EMA is seeded by SMA; RSI uses Wilder smoothing and remains neutral for a flat series',()=>{
  near(evaluate('EMA(종가, 3)',{close:[1,2,3,4]}).value,3);
  near(evaluate('RSI(종가, 2)',{close:[1,2,3,2]}).value,50);
  near(evaluate('RSI(종가, 2)',{close:[3,3,3,3]}).value,50);
  assert.equal(evaluate('RSI(종가, 2)',{close:[1,2,3]}).value,100);
});

test('Heikin-Ashi uses the previous synthetic open and close, retaining raw data and volume',()=>{
  const raw=[{time:1,open:10,high:14,low:8,close:12,volume:10},{time:2,open:12,high:16,low:10,close:14,volume:20}];
  const original=structuredClone(raw),ha=heikinAshi(raw);
  assert.deepEqual(ha[0],{time:1,open:11,high:14,low:8,close:11,volume:10});
  assert.deepEqual(ha[1],{time:2,open:11,high:16,low:10,close:13,volume:20});
  assert.deepEqual(raw,original);
  const series=formulaSeries(raw);assert.deepEqual(series.close,[12,14]);assert.deepEqual(series.heikinClose,[11,13]);
});

test('chart Bollinger bands and formula Bollinger functions agree on population standard deviation',()=>{
  const raw=[1,2,3].map((close,i)=>({time:i,close}));const bands=bollingerBands(raw,3,2);
  assert.equal(bands.length,1);near(bands[0].middle,2);near(bands[0].upper,2+2*Math.sqrt(2/3));near(bands[0].lower,2-2*Math.sqrt(2/3));
  near(evaluate('볼린저상단(종가, 3, 2)',{close:[1,2,3]}).value,bands[0].upper);
  near(evaluate('볼린저하단(종가, 3, 2)',{close:[1,2,3]}).value,bands[0].lower);
  assert.throws(()=>bollingerBands(raw,0,2));assert.throws(()=>bollingerBands(raw,3,NaN));
  const sample=makeCandles('BTCUSDT');const changed=bollingerBands(sample,55,1.04);assert.equal(changed.length,206);
});

test('previously saved conditions migrate without losing offsets, grouping or distinct timeframes',()=>{
  const old=makeBot({conditionMode:'legacy'});delete old.formula;delete old.formulaTimeframe;delete old.formulaCandle;
  old.rules.children[0].operator='gt';old.rules.children[0].targetTimeframe='1h';old.rules.children[0].offset=2;
  const before=structuredClone(old.rules),upgraded=upgradeBot(old);
  assert.equal(upgraded.conditionMode,'formula');assert.match(upgraded.formula,/종가\[2\]/);assert.match(upgraded.formula,/봉\(EMA\(종가, 20\), 60, 0\)/);
  assert.deepEqual(old.rules,before);assert.deepEqual(upgraded.rules,before);assert.deepEqual(validateBot(upgraded),[]);
  assert.equal(evaluate(upgraded.formula,{close:[1,2,3]}).missing,true);
  const long=structuredClone(old);long.rules.children=Array.from({length:30},(_,i)=>({...structuredClone(old.rules.children[0]),id:String(i)}));
  const retained=upgradeBot(long);assert.equal(retained.conditionMode,'legacy');assert.deepEqual(validateBot(retained),[]);assert.deepEqual(retained.rules,long.rules);
});

test('the common room allocates distinct, in-bounds places as working and resting populations grow',()=>{
  const bots=Array.from({length:35},(_,i)=>makeBot({status:i<20?'running':'paused'}));const layout=roomLayout(bots);
  const occupied=new Set();
  for(const bot of bots){const p=layout.positions.get(bot.id);assert.equal(p.work,bot.status==='running');assert.ok(p.x>=0&&p.x<layout.width&&p.y+89<layout.height-45);assert.ok(!occupied.has(`${p.x}:${p.y}`));occupied.add(`${p.x}:${p.y}`);}
});
