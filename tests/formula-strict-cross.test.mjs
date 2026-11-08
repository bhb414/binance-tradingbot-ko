import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFormula} from '../public/formula.js';
import {evaluateRuleFormula} from '../public/formula-runtime.js';
import {createCrossTracker} from '../public/adaptive-cycle.js';
import {createStudy,studyData} from '../public/chart-studies.js';
import {formulaSeries} from '../public/indicators.js';

const values=(source,close,volume=close.map(()=>1))=>{const r=compileFormula(source).evaluateSeries({close,volume});assert.equal(r.ok,true,r.error);return r.values;};

test('touching and returning to the same side never triggers either direction, including the initial side',()=>{
 assert.deepEqual(values('상향돌파(종가,1)',[2,1,1,2,1,2]),[null,0,0,0,0,0]);
 assert.deepEqual(values('하향돌파(종가,1)',[0,1,1,0,1,0]),[null,0,0,0,0,0]);
 assert.deepEqual(values('상향돌파(종가,1)',[1,1,2]),[null,0,0]);
 assert.deepEqual(values('하향돌파(종가,1)',[1,1,0]),[null,0,0]);
});

test('opposite-side transitions cross exactly once after any equality plateau',()=>{
 const close=[0,1,1,2,2,1,1,0,0,1,2];
 assert.deepEqual(values('상향돌파(종가,1)',close),[null,0,0,1,0,0,0,0,0,0,1]);
 assert.deepEqual(values('하향돌파(종가,1)',close),[null,0,0,0,0,0,0,1,0,0,0]);
});

test('roundoff plateaus retain their prior side at every price scale without hiding real small crossings',()=>{
 for(const base of [1e-12,.07814,1,100000,1e12]){
  const close=[base*(1-1e-10),base*(1+4*Number.EPSILON),base*(1-4*Number.EPSILON),base*(1+1e-10),base*(1-4*Number.EPSILON),base*(1+1e-10),base*(1-1e-10)];
  const reference=close.map(()=>base);
  assert.deepEqual(values('상향돌파(종가,거래량)',close,reference),[null,0,0,1,0,0,0]);
  assert.deepEqual(values('하향돌파(종가,거래량)',close,reference),[null,0,0,0,0,0,1]);
 }
});

test('missing inputs reset remembered sides rather than allowing an invented cross across a gap',()=>{
 const close=[0,null,2,1,2,null,1,2,0];
 assert.deepEqual(values('상향돌파(종가,1)',close),[null,null,null,0,0,null,null,0,0]);
 assert.deepEqual(values('하향돌파(종가,1)',close),[null,null,null,0,0,null,null,0,1]);
});

test('ordinary formulas and the streaming cycle tracker identify the same events through deterministic noisy plateaus',()=>{
 for(let seed=1;seed<=12;seed++){
  let rng=seed;const close=Array.from({length:350},(_,i)=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return i%79===0?null:100+([-1,0,0,0,1,(rng%2?1:-1)*1e-13][rng%6]);});
  const up=values('상향돌파(종가,100)',close),down=values('하향돌파(종가,100)',close),tracker=createCrossTracker();
  for(let i=0;i<close.length;i++){
   tracker.push(close[i],100);assert.equal(Boolean(up[i]),tracker.elapsed===0&&tracker.direction===1,'up '+seed+':'+i);assert.equal(Boolean(down[i]),tracker.elapsed===0&&tracker.direction===-1,'down '+seed+':'+i);
  }
 }
});

test('bot runtime and native cycle studies share all five average types and ordinary or Heikin candle sources',()=>{
 const raw=Array.from({length:320},(_,i)=>{const close=.08+Math.round((Math.sin(i/9)+Math.cos(i/21))*4)*.0001;return {time:1700000000+i*60,open:close,high:close+.0001,low:close-.0001,close,volume:10+i%7};});
 const series=formulaSeries(raw);
 for(const kind of ['standard','heikin'])for(const average of ['SMA','EMA','VWMA','KAMA','HMA']){
  const s=createStudy('CYCLE',{candle:kind});Object.assign(s.params,{fast:6,slow:13,average,reference:'theory',anchor:'live',predictionSource:'interval'});
  const native=studyData(s,raw),source=kind==='standard'?'종가':'하이킨종가';assert.equal(native.error,null);
  for(const [fn,direction]of [['상향돌파',1],['하향돌파',-1]]){
   const computed=compileFormula(`${fn}(${average}(${source},6),${average}(${source},13))`).evaluateSeries(series);assert.equal(computed.ok,true,computed.error);
   for(let i=0;i<raw.length;i++)assert.equal(Boolean(computed.values[i]),native.cycle[i].elapsed===0&&native.cycle[i].direction===direction,kind+' '+average+' '+fn+' '+i);
  }
 }
});

test('closed timeframe signals stay on their completed candle and named multi-market operands keep their own history',()=>{
 const now=20000000,make=close=>({serverNow:now,candles:close.map((c,i)=>({time:Math.floor(now/60000)*60-(close.length-1-i)*60,closeTime:Math.floor(now/60000)*60000-(close.length-1-i)*60000+59999,open:c,high:c,low:c,close:c,volume:1}))});
 const primary=make([0,1,1,2,999]),a=make([0,1,1,2,999]),b=make([1,1,1,1,999]);primary.symbols={A:a,B:b};const feeds={'1m':primary};
 for(const source of ['상향돌파(종가,1)@1m[1]','상향돌파(A.종가,B.종가)@1m[1]'])assert.equal(evaluateRuleFormula(source,feeds).result.pass,true);
 primary.candles.at(-1).close=-999;a.candles.at(-1).close=-999;
 assert.equal(evaluateRuleFormula('상향돌파(A.종가,B.종가)@1m[1]',feeds).result.pass,true);
 assert.equal(evaluateRuleFormula('상향돌파(A.종가,B.종가)@1m',feeds).result.pass,false);
 const same=make([2,1,1,2,999]);assert.equal(evaluateRuleFormula('상향돌파(종가,1)@1m[1]',{'1m':same}).result.pass,false);
});

test('occurrence counters and lagged queries do not count same-side returns or depend on traversal order',()=>{
 const close=[0,2,1,1,2,0,1,0,1,2];
 assert.equal(compileFormula('발생횟수(상향돌파(종가,1),9)').evaluate({close},9).value,2);
 const up=values('상향돌파(종가,1)',close),formula=compileFormula('상향돌파(종가,1)[2] + 상향돌파(종가,1)');
 const r=formula.evaluateSeries({close});assert.equal(r.ok,true,r.error);
 assert.deepEqual(r.values,close.map((_,i)=>i<2||up[i-2]===null||up[i]===null?null:up[i-2]+up[i]));
 assert.equal(formula.evaluate({close},9).value,r.values[9]);
});

test('an arbitrarily long neutral plateau remains causal and respects the runtime step budget',()=>{
 const close=[0,...Array(1500).fill(1),2],f=compileFormula('상향돌파(종가,1)'),r=f.evaluate({close},close.length-1,{maxSteps:200000});assert.equal(r.ok,true,r.error);assert.equal(r.pass,true);assert.ok(r.steps<10000);
 close[0]=2;assert.equal(f.evaluate({close},close.length-1).pass,false);
 close[0]=0;const full=f.evaluateSeries({close});assert.equal(full.ok,true);assert.deepEqual(f.evaluateSeries({close:close.slice(0,-1)}).values,full.values.slice(0,-1));
 const tooSmall=f.evaluate({close},close.length-1,{maxSteps:10});assert.equal(tooSmall.ok,false);assert.match(tooSmall.error,/계산량/);
});

test('live edits and hypothetical next bars use current inputs without altering completed signals',()=>{
 const close=[0,1,2,1,2],f=compileFormula('상향돌파(종가,1)'),before=f.evaluateSeries({close});assert.equal(before.values.at(-1),0);
 close[close.length-1]=0;assert.equal(f.evaluate({close},4).value,0);assert.deepEqual(f.evaluateSeries({close}).values.slice(0,-1),before.values.slice(0,-1));
 const forecast=compileFormula('다음봉(상향돌파(종가,1),1,2,1,2,1)');
 assert.equal(forecast.evaluate({close:[0,1],open:[0,1],high:[0,1],low:[0,1],volume:[1,1]},1).value,1);
 assert.equal(forecast.evaluate({close:[2,1],open:[2,1],high:[2,1],low:[2,1],volume:[1,1]},1).value,0);
});
