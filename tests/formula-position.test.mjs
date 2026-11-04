import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFormula,formulaTimeframes} from '../public/formula.js';
import {evaluateRuleFormula} from '../public/formula-runtime.js';
import {formulaPosition,portfolioFormulaPosition} from '../public/formula-position.js';
import {compileStudyFormula} from '../public/chart-studies.js';
import {signatureAt} from '../public/formula-signature.js';
import {FORMULA_POSITION_INSERTS,formulaExamples} from '../public/formula-editor.js';
const now=Date.parse('2026-11-04T00:00:00Z');
const snapshot=(mark=100.5,close=90)=>({serverNow:now,premium:{markPrice:String(mark)},candles:Array.from({length:60},(_,i)=>({time:now/1000-(59-i)*60,closeTime:now-(58-i)*60000-1,open:close,high:close,low:close,close,volume:1}))});
const position=(more={})=>({quantity:2,entryPrice:100,direction:'LONG',leverage:20,...more});
const result=(source,p=position(),mark=100.5)=>evaluateRuleFormula(source,{'1m':snapshot(mark)},p).result;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,a+' != '+b);

test('current return uses live mark and held leverage, independently of candle close and realized history',()=>{
 assert.equal(result('현재수익률() >= 10').pass,true);assert.equal(result('현재수익률 >= 10').pass,true);
 assert.equal(result('가격변동률()').value,.5);assert.equal(result('현재손익()').value,1);assert.equal(result('포지션보유()').value,1);
 near(result('수익률').value,-200);
 assert.equal(result('현재수익률()',position({realized:10000,profitValue:-300})).value,10);
 assert.equal(result('진입증거금수익률()').value,10);assert.equal(result('ROI()').value,10);
});
test('long and short thresholds have symmetric favorable signs and exact percent boundaries',()=>{
 for(const direction of ['LONG','SHORT']){
  const sign=direction==='LONG'?1:-1,p=position({direction});
  assert.equal(result('현재수익률() >= 10',p,100+sign*.5).pass,true);
  assert.equal(result('현재수익률() <= -5',p,100-sign*.25).pass,true);
  assert.equal(result('현재수익률() >= 10',p,100+sign*.49).pass,false);
  assert.equal(result('가격변동률()',p,100+sign*.5).value,.5);
 }
});
test('updated average entry, quantity and applied position leverage feed current metrics',()=>{
 const p=position({quantity:3,entryPrice:105,leverage:10}),r=result('현재수익률()',p,107);near(r.value,2/105*1000);near(result('현재손익()',p,107).value,6);
 const bot={quantity:3,entryPrice:105,positionDirection:'LONG',leverage:10,runtime:{quantity:2,entryPrice:100,direction:'SHORT',realized:100}};
 assert.equal(result('현재수익률()',formulaPosition(bot),107).value,r.value);
});
test('no position, missing mark, sync hold and unknown leverage cannot become false zero-return signals',()=>{
 for(const source of ['현재수익률()','가격변동률()','현재손익()']){const r=result(source,{quantity:0});assert.equal(r.missing,true);assert.equal(r.pass,false);}
 assert.equal(result('포지션보유() = 0',{quantity:0}).pass,true);
 assert.equal(result('포지션보유() = 0 OR 현재수익률() > 5',{quantity:0}).pass,true);
 assert.equal(result('현재수익률() <= 0',{quantity:0}).pass,false);
 assert.equal(result('현재수익률()',position({syncHold:true})).missing,true);
 assert.equal(result('현재수익률()',position({leverage:undefined})).missing,true);
 const feed=snapshot();delete feed.premium;assert.equal(evaluateRuleFormula('현재수익률()',{'1m':feed},position()).result.missing,true);
});
test('current metrics stay current inside completed-bar wrappers, while legacy profit keeps historical semantics',()=>{
 const source='(현재수익률() >= 10 AND 종가 < 100)@1m[1]';assert.deepEqual(formulaTimeframes(source),['1m']);assert.equal(result(source).pass,true);
 assert.equal(result('현재수익률()@1m[1]').value,10);near(result('수익률@1m[1]').value,-200);
 assert.equal(result('요일() <= 금요일 AND 현재수익률() >= 10').pass,true);
});
test('portfolio return uses summed entry margin and held unrealized PnL rather than averaging leg percentages',()=>{
 const a={id:'a',alias:'A',symbol:'BTCUSDT',quantity:2,entryPrice:100,positionDirection:'LONG',leverage:20,pnl:14,runtime:{realized:12}},b={id:'b',alias:'B',symbol:'ETHUSDT',quantity:2,entryPrice:50,positionDirection:'SHORT',leverage:5,pnl:-8,runtime:{realized:-10}},flat={id:'c',alias:'C',symbol:'SOLUSDT',quantity:0,pnl:500,runtime:{realized:500}};
 const view={quantity:2,used:50,pnl:506,runtime:{realized:502},members:[a,b,flat]},p=portfolioFormulaPosition(view),primary=snapshot(101),second=snapshot(49);primary.symbols={A:primary,B:second,C:snapshot(10)};
 const feeds={'1m':primary},value=source=>evaluateRuleFormula(source,feeds,p).result.value;
 near(value('현재수익률()'),4/30*100);near(value('가격변동률()'),4/300*100);assert.equal(value('현재손익()'),4);
 assert.equal(value('A.현재수익률'),20);assert.equal(value('B.현재수익률'),10);assert.equal(value('B.현재손익'),2);assert.equal(value('C.포지션보유'),0);
 assert.equal(evaluateRuleFormula('현재수익률() > 13 AND A.현재수익률 >= 20 AND B.현재수익률 >= 10',feeds,p).result.pass,true);
 assert.equal(value('수익률'),8);
 b.runtime.syncHold=true;assert.equal(evaluateRuleFormula('현재수익률()',feeds,portfolioFormulaPosition(view)).result.missing,true);
});
test('current position formulas have no arguments or frame requirement and cannot be used as historical chart indicators',()=>{
 for(const [source]of FORMULA_POSITION_INSERTS){assert.deepEqual(formulaTimeframes(source),[]);assert.throws(()=>compileStudyFormula(source));}
 for(const source of ['현재수익률(20)','현재손익(1)','가격변동률(종가)'])assert.throws(()=>compileFormula(source));
 for(const source of ['현재수익률','A.현재수익률','가격변동률','현재손익','포지션보유'])assert.throws(()=>compileStudyFormula(source));
 const source='현재수익률(',sig=signatureAt(source,source.length);assert.equal(sig.position,true);assert.deepEqual(sig.params,[]);assert.match(sig.help[0],/마크가격/);assert.match(sig.help[0],/수수료/);
 for(const example of formulaExamples)assert.doesNotThrow(()=>formulaTimeframes(example.value));
});
