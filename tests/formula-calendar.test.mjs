import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFormula,formulaTimeframes,applyWholeTimeframe,formulaMarketRequests} from '../public/formula.js';
import {evaluateRuleFormula} from '../public/formula-runtime.js';
import {signatureAt} from '../public/formula-signature.js';
import {FORMULA_TIME_INSERTS,formulaExamples,formulaEditorMarkup} from '../public/formula-editor.js';
const now=s=>Date.parse(s),value=(source,at)=>{const result=compileFormula(source).evaluate({close:[1,2,3]},2,{now:now(at)});assert.equal(result.ok,true,result.error);return result.value;};

test('calendar weekdays use Monday=1 through Sunday=7 and default to Korean calendar date',()=>{
 assert.equal(value('요일() = 월요일','2026-01-04T15:00:00Z'),1);
 assert.equal(value('요일(UTC) = 일요일','2026-01-04T15:00:00Z'),1);
 assert.equal(value('요일(미국동부) = 일요일','2026-01-04T15:00:00Z'),1);
 for(const [day,name]of ['월요일','화요일','수요일','목요일','금요일','토요일','일요일'].entries())assert.equal(value('요일() = '+name,'2026-01-'+String(5+day).padStart(2,'0')+'T00:00:00Z'),1);
 assert.equal(value('현재요일() = 월요일 AND 현재시각() = 900','2026-01-05T00:00:00Z'),1);
});

test('time windows include the start, exclude the end, and support midnight and full-day boundaries',()=>{
 for(const [at,expected]of [['2026-01-04T23:59:59Z',0],['2026-01-05T00:00:00Z',1],['2026-01-05T08:59:59Z',1],['2026-01-05T09:00:00Z',0]])assert.equal(value('시간범위(900, 1800)',at),expected,at);
 for(const [time,expected]of [['2026-01-05T13:59:59Z',0],['2026-01-05T14:00:00Z',1],['2026-01-05T15:00:00Z',1],['2026-01-05T20:59:59Z',1],['2026-01-05T21:00:00Z',0]])assert.equal(value('시간범위(2300, 600)',time),expected,time);
 for(const at of ['2026-01-04T15:00:00Z','2026-01-05T14:59:59Z'])assert.equal(value('시간범위(0, 2400)',at),1);
 assert.equal(value('시각()','2026-01-04T15:00:00Z'),0);
 assert.equal(value('요일() = 금요일 AND 시간범위(2300, 600)','2026-01-09T14:30:00Z'),1);
 assert.equal(value('요일() = 금요일 AND 시간범위(2300, 600)','2026-01-09T15:30:00Z'),0);
});

test('New York time changes automatically in spring and fall; UTC and Korean time remain fixed',()=>{
 assert.equal(value('시각(미국동부)','2026-03-08T06:59:00Z'),159);
 assert.equal(value('시각(미국동부)','2026-03-08T07:00:00Z'),300);
 assert.equal(value('시각(미국동부)','2026-11-01T05:30:00Z'),130);
 assert.equal(value('시각(미국동부)','2026-11-01T06:30:00Z'),130);
 assert.equal(value('시간범위(930,1600,미국동부)','2026-01-05T14:30:00Z'),1);
 assert.equal(value('시간범위(930,1600,미국동부)','2026-07-06T13:30:00Z'),1);
 assert.equal(value('시각(UTC)','2026-07-06T13:30:00Z'),1330);
 assert.equal(value('시각(한국시간)','2026-07-06T13:30:00Z'),2230);
});

test('calendar predicates reject invalid HHMM values, unknown zones and ambiguous equal bounds',()=>{
 for(const source of ['시간범위(960,1800)','시간범위(2400,1800)','시간범위(900,2401)','시간범위(-1,1800)','시간범위(9.5,1800)','시간범위(900,900)','시간범위(종가,1800)','시간범위(900,1800,월요일)','요일(1)','요일(미국서부)','시각(종가)','요일(한국시간,UTC)'])assert.throws(()=>compileFormula(source),undefined,source);
 const result=compileFormula('요일()').evaluate({close:[1]},0);assert.equal(result.missing,true);assert.equal(result.pass,false);
 assert.equal(compileFormula('요일()').evaluate({},0,{now:now('2026-01-05T00:00:00Z')}).value,1);
});

test('calendar expressions combine with price frames and keep the evaluation clock through frame offsets',()=>{
 const at=now('2026-01-05T00:01:00Z'),candles=Array.from({length:60},(_,i)=>({time:at/1000-(59-i)*900,closeTime:at-(58-i)*900000-1,open:1,high:3,low:1,close:2,volume:1})),feeds={'15m':{serverNow:at,candles}};
 const source='(요일() = 월요일 AND 시간범위(900,1000) AND 종가 > 1)@15m[1]';
 assert.deepEqual(formulaTimeframes(source),['15m']);assert.equal(evaluateRuleFormula(source,feeds).result.pass,true);
 assert.equal(evaluateRuleFormula(source,feeds,{}, {now:now('2026-01-05T01:00:00Z')}).result.pass,false);
 const wrapped=applyWholeTimeframe('요일() <= 금요일 AND 종가@5m[1] > 1','15m');assert.deepEqual(formulaTimeframes(wrapped),['15m']);assert.equal(evaluateRuleFormula(wrapped,feeds).result.pass,true);
});

test('standalone calendars need no explicit frame and do not add subscriptions to a mixed rule',()=>{
 assert.deepEqual(formulaTimeframes('요일() <= 금요일 AND 시간범위(900,1800)'),[]);
 assert.deepEqual(formulaMarketRequests('BTCUSDT','요일() <= 금요일 AND 종가@15m > 1'),[{symbol:'BTCUSDT',interval:'15m',key:'BTCUSDT@15m'}]);
 const at=now('2026-01-05T00:30:00Z'),feeds={'1m':{serverNow:at,candles:[{time:at/1000-60,closeTime:at-1,close:1,open:1,low:1,high:1,volume:1},{time:at/1000,closeTime:at+59999,close:1,open:1,low:1,high:1,volume:1}]}};
 assert.equal(evaluateRuleFormula('시간범위(900,1800)',feeds).result.pass,true);
});

test('calendar insertion choices, examples and signatures explain the clock and timezone',()=>{
 for(const [source]of FORMULA_TIME_INSERTS)assert.doesNotThrow(()=>formulaTimeframes(source));
 for(const example of formulaExamples)assert.doesNotThrow(()=>formulaTimeframes(example.value));
 const source='시간범위(930,1600,',sig=signatureAt(source,source.length);assert.equal(sig.calendar,true);assert.equal(sig.argument,2);assert.match(sig.help[2],/서머타임/);
 const html=formulaEditorMarkup({formula:''});assert.match(html,/시간범위/);assert.match(html,/현재 감시 시각/);assert.match(html,/휴장일/);
});
