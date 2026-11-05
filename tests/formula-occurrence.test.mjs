import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFormula,formulaTimeframes,formulaMarketRequests,applyWholeTimeframe} from '../public/formula.js';
import {evaluateRuleFormula} from '../public/formula-runtime.js';
import {formulaStudyResult} from '../public/chart-studies.js';
import {signatureAt} from '../public/formula-signature.js';
import {FORMULA_OCCURRENCE_INSERTS,formulaEditorMarkup,formulaExamples} from '../public/formula-editor.js';
const evaluate=(source,close,index=close.length-1)=>compileFormula(source).evaluate({close},index);
const now=Date.UTC(2026,10,5,4,0);
const snapshot=(close,seconds=60)=>({serverNow:now,candles:close.map((value,i)=>({time:now/1000-(close.length-1-i)*seconds,closeTime:now-(close.length-1-i)*seconds*1000+seconds*1000-1,open:value-.1,high:value+.2,low:value-.2,close:value,volume:10}))});

test('occurrence predicates include both count boundaries, support omitted maximum and return numeric counts',()=>{
 const values=[0,1,1,0,1];assert.equal(evaluate('발생횟수(종가 > 0, 5)',values).value,3);
 for(const source of ['발생(종가 > 0, 5, 3, 3)','발생(종가 > 0, 5, 2, 3)','발생(종가 > 0, 5, 3, 4)','발생(종가 > 0, 5, 3)','범위내(발생횟수(종가 > 0, 5), 3, 3)'])assert.equal(evaluate(source,values).pass,true,source);
 assert.equal(evaluate('발생(종가 > 0, 5, 0, 2)',values).pass,false);assert.equal(evaluate('발생(종가 > 0, 5, 4)',values).pass,false);assert.equal(evaluate('발생(종가 > 0, 5, 0, 0)',[0,0,0,0,0]).pass,true);assert.equal(evaluate('발생(종가 > 0, 5, 5, 5)',[1,1,1,1,1]).pass,true);
});

test('consecutive true bars count independently while new occurrences count only false-to-true transitions',()=>{
 const values=[0,1,1,1,0,1];assert.equal(evaluate('발생횟수(종가 > 0, 5)',values).value,4);assert.equal(evaluate('신규발생횟수(종가 > 0, 5)',values).value,2);assert.equal(evaluate('신규발생(종가 > 0, 5, 2, 2)',values).pass,true);
 assert.equal(evaluate('신규발생횟수(종가 > 0, 3)',[0,1,1,1,1]).value,0);assert.equal(evaluate('신규발생횟수(종가 > 0, 3)',[0,0,1,1,1]).value,1);assert.equal(evaluate('신규발생(종가 > 0, 3, 0, 0)',[1,1,1,1]).pass,true);
});

test('counting crossover signals counts actual crossover bars rather than every bar above the threshold',()=>{
 const values=[0,2,3,0,2,0,2];for(const name of ['발생횟수','신규발생횟수'])assert.equal(evaluate(name+'(상향돌파(종가, 1), 5)',values).value,2);
 assert.equal(evaluate('발생(상향돌파(종가, 1), 5, 2, 2)',values).pass,true);assert.equal(evaluate('발생횟수(종가 > 1, 5)',values).value,3);
});

test('missing history, zero divisions and unknown transitions never silently count as false or zero',()=>{
 for(const source of ['발생횟수(종가 > 0, 5)','발생(종가 > 0, 5, 0, 5)','NOT 발생(종가 > 0, 5, 0, 0)']){const result=evaluate(source,[1,2]);assert.equal(result.missing,true,source);assert.equal(result.pass,false);}
 assert.equal(evaluate('신규발생횟수(종가 > 0, 3)',[1,1,1]).missing,true);assert.equal(evaluate('신규발생횟수(종가 > 0, 3)',[0,0,0]).value,0);
 for(const name of ['발생횟수','신규발생횟수'])assert.equal(evaluate(name+'(종가 / (종가-2) > 0, 3)',[1,2,3]).missing,true);
 assert.equal(evaluate('발생(종가 > 0, 2, 0, 2)',[1,null,2]).missing,true);
});

test('cached rolling windows recover when missing observations leave and match evaluation at every independent bar',()=>{
 const close=[0,1,1,null,0,1,0,1,1,0,1];
 for(const name of ['발생횟수','신규발생횟수']){const compiled=compileFormula(name+'(종가 > 0, 3)'),all=compiled.evaluateSeries({close});assert.equal(all.ok,true);all.values.forEach((value,index)=>assert.equal(value,compiled.evaluate({close},index).value));assert.ok(Number.isFinite(all.values.at(-1)));}
});

test('scoped counts use their own bars and [1] excludes an unstable live candle without affecting other scopes',()=>{
 const feeds={'1m':snapshot([0,2,0,2,0,2]),'1h':snapshot([0,2,0,0,0,0],3600)};const value=source=>evaluateRuleFormula(source,feeds).result.value;
 assert.equal(value('발생횟수(종가 > 1, 3)@1m'),2);assert.equal(value('발생횟수(종가 > 1, 3)@1m[1]'),1);assert.equal(value('발생(종가 > 1, 3, 1, 1)@1m[1]'),1);
 const closed=value('발생횟수(종가 > 1, 3)@1m[1]');feeds['1m'].candles.at(-1).close=0;assert.equal(value('발생횟수(종가 > 1, 3)@1m[1]'),closed);assert.equal(value('발생횟수(종가 > 1, 3)@1m'),1);
 assert.deepEqual(formulaTimeframes('발생횟수(종가 > 1, 3)@1m + 발생횟수(종가 > 1, 3)@1h'),['1m','1h']);assert.equal(value('발생횟수(종가 > 1, 3)@1m + 발생횟수(종가 > 1, 3)@1h'),1);
 assert.equal(value('(발생횟수(종가 > 1, 3)[1]+발생횟수(종가 > 1, 3))@1m'),2);
});

test('occurrence windows cannot resample another timeframe silently and whole-frame assignment retains history offsets',()=>{
 for(const source of ['발생(종가 > 1, 10, 1, 3)','발생횟수(종가@1m > 0, 3)@1h','신규발생(종가@1m > 종가@1h, 3, 1, 2)@1m'])assert.throws(()=>formulaTimeframes(source),source);
 const assigned=applyWholeTimeframe('발생(종가 > SMA(종가, 2), 3, 1, 2)@1h[1]','1m');assert.deepEqual(formulaTimeframes(assigned),['1m']);assert.match(assigned,/\[1\]/);
});

test('counts combine aligned values from multiple instruments and keep market request deduplication',()=>{
 const primary=snapshot([1,1,1,1,1,1]),other=snapshot([0,2,0,2,2,0]);primary.symbols={B:other};const source='발생(B.종가 > 종가, 5, 3, 3)@1m';assert.equal(evaluateRuleFormula(source,{'1m':primary}).result.pass,true);assert.deepEqual(formulaMarketRequests('BTCUSDT',source,{B:'ETHUSDT'}).map(r=>r.key),['BTCUSDT@1m','ETHUSDT@1m']);
 assert.equal(evaluateRuleFormula('신규발생횟수(B.종가 > 종가, 5)@1m',{'1m':primary}).result.value,2);
});

test('current clock and position snapshots cannot be misrepresented as historical occurrences',()=>{
 for(const source of ['발생(요일() = 월요일, 10, 1, 3)','발생횟수(시각() > 900, 3)','발생(시간범위(900,1800), 3, 1)','발생(현재수익률() > 5, 3, 1)','발생(현재손익 > 0, 3, 1)','신규발생횟수(포지션보유(), 3)','발생(평균매수가 > 종가, 3, 1)','발생(A.현재수익률 > 0, 3, 1)','발생(수익률 > 0, 3, 1)','발생(A.포지션수익률 > 0, 3, 1)'])assert.throws(()=>compileFormula(source),/과거 이력/,source);
 assert.doesNotThrow(()=>formulaTimeframes('요일() <= 금요일 AND 발생(종가 > 1, 3, 1)@1m[1]'));
});

test('occurrence periods, bounds and arities reject invalid input at the right argument',()=>{
 for(const source of ['발생(종가 > 1, 0, 0, 0)','발생(종가 > 1, 501, 0, 1)','발생(종가 > 1, 3.5, 0, 1)','발생(종가 > 1, 종가, 0, 1)','발생(종가 > 1, 3, 2, 1)','발생(종가 > 1, 3, -1, 1)','발생(종가 > 1, 3, 0, 4)','발생(종가 > 1, 3, 0, 종가)','발생(종가 > 1, 3)','발생횟수(종가 > 1, 3, 1)','신규발생(종가 > 1, 3, 1, 2, 3)','신규발생횟수(종가 > 1)'])assert.throws(()=>compileFormula(source),source);
 for(const source of ['CountTrue(종가 > 0, 3)','CountStarts(종가 > 0, 3)','Occurs(종가 > 0, 3, 1, 2)','OccursStarts(종가 > 0, 3, 1)'])assert.equal(evaluate(source,[0,1,0,1]).ok,true);
});

test('rolling occurrence calculations remain bounded and efficient across long chart series and nested conditions',()=>{
 const close=Array.from({length:5000},(_,i)=>i%2);for(const name of ['발생횟수','신규발생횟수']){const result=compileFormula(name+'(종가 > 0, 500)').evaluateSeries({close},{maxSteps:100000});assert.equal(result.ok,true,result.error);assert.equal(result.values.at(-1),250);}
 const source='발생횟수(발생횟수(종가 > 0, 5) > 2, 5)',compiled=compileFormula(source),values=close.slice(0,100);assert.equal(compiled.evaluateSeries({close:values},{maxSteps:50}).ok,false);const full=compiled.evaluateSeries({close:values});assert.equal(full.ok,true);full.values.forEach((value,index)=>assert.equal(value,compiled.evaluate({close:values},index).value));
});

test('custom chart formulas can plot counts without changing raw price data or past completed values',()=>{
 const rows=snapshot([0,1,1,0,1,0,1]).candles,original=structuredClone(rows);for(const source of ['발생횟수(종가 > 0, 3)','신규발생횟수(종가 > 0, 3)']){const full=formulaStudyResult(source,rows);assert.equal(full.ok,true);assert.deepEqual(formulaStudyResult(source,rows.slice(0,5)).values,full.values.slice(0,5));}assert.deepEqual(rows,original);
});

test('editor insertions and nested signature help explain count bounds and transition semantics',()=>{
 for(const [source]of FORMULA_OCCURRENCE_INSERTS)assert.doesNotThrow(()=>formulaTimeframes(source));for(const example of formulaExamples)assert.doesNotThrow(()=>formulaTimeframes(example.value));
 let text='발생(상향돌파(종가, EMA(종가, 20)), 10, ';let help=signatureAt(text,text.length);assert.equal(help.name,'발생');assert.equal(help.argument,2);assert.match(help.help[2],/최소/);text+='1, ';help=signatureAt(text,text.length);assert.equal(help.argument,3);assert.match(help.help[3],/최대/);text='신규발생(';assert.match(signatureAt(text,text.length).help[0],/거짓 → 참/);const markup=formulaEditorMarkup({formula:''});assert.match(markup,/발생횟수/);assert.match(markup,/연속 3봉 참/);
});
