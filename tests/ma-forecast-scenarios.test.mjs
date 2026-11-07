import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudy,studyData,validateStudy,decodeStudies} from '../public/chart-studies.js';
import {forecastCrossings} from '../public/ma-forecast-scenarios.js';
import {FORECAST_CANDIDATES,FORECAST_METHODS} from '../public/ma-forecast.js';
import {theoreticalCyclePeriod} from '../public/cycle-reference.js';

const raw=Array.from({length:190},(_,i)=>({time:1700000000+i*60,open:100+i*.01+Math.sin(i/8),high:102+i*.01+Math.sin(i/8),low:98+i*.01+Math.sin(i/8),close:100+i*.01+Math.sin(i/8+.25),volume:2+i%11}));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7*Math.max(1,Math.abs(b)),a+' != '+b);
function forecast(kind='SMA',method='close',candle='standard',source='close'){
 const s=createStudy('MA_FORECAST',{candle,source});Object.assign(s.params,{method,anchor:'live',horizon:9,searchBars:50,showCrossing:true,type0:kind,type1:kind,period0:13,period1:26,enabled2:false,enabled3:false,enabled4:false});return s;
}
function single(kind,n,candle,source){const s=createStudy(kind,{candle,source});s.params.period=n;return s;}

test('frozen-close scenario projections match independently appended OHLC candles for all five MA kinds and HA sources',()=>{
 for(const kind of ['SMA','EMA','VWMA','KAMA','HMA'])for(const candle of ['standard','heikin'])for(const source of ['close','open','hl2']){
  const s=forecast(kind,'close',candle,source),d=studyData(s,raw),price=d.forecast.comparison.assumedClose;
  const future=Array.from({length:s.params.horizon},(_,h)=>({time:raw.at(-1).time+(h+1)*60,open:price,high:price,low:price,close:price,volume:raw.at(-1).volume}));
  for(const [slot,n]of [[0,13],[1,26]]){
   const expected=studyData(single(kind,n,candle,source),[...raw,...future]).plots[0].data.filter(p=>p.time>=raw.at(-1).time),actual=d.plots.find(p=>p.key==='forecast'+slot).data;
   assert.equal(actual.length,expected.length,kind+' '+candle+' '+source);for(let i=0;i<actual.length;i++){assert.equal(actual[i].time,expected[i].time);near(actual[i].value,expected[i].value);}
  }
 }
});

test('MA-level and range prices are frozen once instead of being replaced with future MA or future range values',()=>{
 for(const method of ['short','long','low','high','mean-price']){
  const s=forecast('EMA',method),d=studyData(s,raw),price=d.forecast.comparison.assumedClose;
  const future=Array.from({length:9},(_,i)=>({time:raw.at(-1).time+(i+1)*60,open:price,high:price,low:price,close:price,volume:raw.at(-1).volume}));
  const expected=studyData(single('EMA',13,'standard','close'),[...raw,...future]).plots[0].data.slice(-10),actual=d.plots.find(p=>p.key==='forecast0').data;
  actual.forEach((p,i)=>near(p.value,expected[i].value));
 }
});

test('strict crossover and merely touching are distinct, including a zero-gap plateau',()=>{
 assert.deepEqual(forecastCrossings([2,1,1,0],[1,1,1,1],1,3),{touchBars:1,crossBars:3});
 assert.deepEqual(forecastCrossings([2,1,1,1],[1,1,1,1],1,3),{touchBars:1,crossBars:null});
 assert.deepEqual(forecastCrossings([1,1,1],[1,1,1],0,2),{touchBars:0,crossBars:null});
 const rising=Array.from({length:80},(_,i)=>({time:1700000000+i*60,open:i+1,high:i+1,low:i+1,close:i+1,volume:1})),s=forecast();s.params.searchBars=60;
 const m=studyData(s,rising).forecast.comparison;assert.equal(m.crossBars,null);assert.equal(m.touchBars,25);assert.match(m.message,/교차 없음.*접촉 25봉/);
});

test('fastest mode minimizes actual crossing time and a one-bar overshoot counts even when its absolute gap is larger',()=>{
 const fixture=[10,10,20,20].map((close,i)=>({time:1700000000+i*60,open:close,high:close,low:i===3?.1:close,close,volume:1}));
 const s=forecast('SMA','fastest-range');Object.assign(s.params,{period0:2,period1:4,rangeBars:1,slopeBars:1,horizon:4});
 const d=studyData(s,fixture),low=d.forecast.candidates.find(c=>c.id==='low');assert.equal(low.crossBars,1);assert.equal(d.forecast.comparison.crossBars,1);assert.equal(d.forecast.comparison.selectedMethod,'low');
 for(const method of ['fastest','fastest-range']){
  const normal=forecast('HMA',method),r=studyData(normal,raw),pool=r.forecast.candidates.filter(c=>Number.isFinite(c.crossBars)&&!c.reason&&(method!=='fastest-range'||['low','high'].includes(c.id)));
  assert.equal(r.forecast.comparison.crossBars,pool.length?Math.min(...pool.map(c=>c.crossBars)):null);
  normal.params.crossA='1';normal.params.crossB='0';assert.equal(studyData(normal,raw).forecast.comparison.crossBars,r.forecast.comparison.crossBars);
 }
});

test('averaging hypothetical prices and averaging crossing times are separate calculations with explicit contributors',()=>{
 const price=forecast('SMA','mean-price');for(const [key]of FORECAST_CANDIDATES)price.params[key]=false;price.params.useClose=true;price.params.useLow=true;
 const d=studyData(price,raw),used=d.forecast.candidates.filter(c=>['close','low'].includes(c.id));near(d.forecast.comparison.assumedClose,(used[0].price+used[1].price)/2);
 const bars=forecast('SMA','mean-bars'),r=studyData(bars,raw),crossed=r.forecast.candidates.filter(c=>Number.isFinite(c.crossBars)&&!c.reason);
 assert.ok(crossed.length>0);near(r.forecast.comparison.crossBars,crossed.reduce((s,c)=>s+c.crossBars,0)/crossed.length);assert.equal(r.forecast.selected,undefined);
 assert.match(r.forecast.caption,new RegExp(crossed.length+'/7개 평균'));assert.match(r.forecast.caption,/점선은 후보 이평경로의 평균/);
 const none=structuredClone(bars);for(const [key]of FORECAST_CANDIDATES)none.params[key]=false;assert.throws(()=>validateStudy(none),/후보/);
 price.params.useClose=false;price.params.useLow=false;price.params.useSlope=true;assert.throws(()=>validateStudy(price),/가정 종가/);
});

test('selected candidates constrain shortest and average calculations and survive saved settings',()=>{
 const s=forecast('EMA','fastest');for(const [key]of FORECAST_CANDIDATES)s.params[key]=false;s.params.useHigh=true;
 const d=studyData(s,raw);assert.equal(d.forecast.comparison.selectedMethod,'high');
 const doc=decodeStudies(JSON.stringify({version:1,timeframeVersion:2,studies:[s]}));assert.deepEqual(doc.studies[0],s);
});

test('projections and scenario selection do not read live OHLC/volume after a closed anchor',()=>{
 for(const method of FORECAST_METHODS.map(([key])=>key)){
  const s=forecast('VWMA',method,'heikin','hl2');s.params.anchor='closed';const before=studyData(s,raw),changed=structuredClone(raw);Object.assign(changed.at(-1),{open:999,high:1100,low:900,close:1000,volume:99999});
  const after=studyData(s,changed);assert.deepEqual(after.forecast,before.forecast,method);assert.deepEqual(after.plots.filter(p=>p.projection),before.plots.filter(p=>p.projection),method);
 }
});

test('a displayed horizon does not limit the separate crossover search and ratios distinguish remaining from final elapsed',()=>{
 const rising=Array.from({length:80},(_,i)=>({time:1700000000+i*60,open:i+1,high:i+1,low:i+1,close:i+1,volume:1}));
 const s=forecast('SMA','low');s.params.horizon=1;s.params.searchBars=60;const d=studyData(s,rising),m=d.forecast.comparison;
 assert.equal(d.plots.find(p=>p.key==='forecast0').data.length,2);assert.ok(m.crossBars>1);
 const T=theoreticalCyclePeriod('SMA',13,26);near(m.remainingRatio,m.crossBars/T);
 const current=studyData(forecast('SMA','fastest'),raw).forecast.comparison;assert.ok(Number.isFinite(current.elapsedBars));assert.ok(Number.isFinite(current.crossBars));near(current.finalElapsedBars,current.elapsedBars+current.crossBars-1);near(current.finalElapsedRatio,current.finalElapsedBars/T);
});

test('missing crossing history and unavailable VWMA stay unavailable without inventing an assumed close',()=>{
 const flat=raw.map(c=>({...c,open:100,high:100,low:100,close:100})),s=forecast('SMA','cross-close'),d=studyData(s,flat);
 assert.equal(d.forecast.comparison.assumedClose,null);assert.match(d.forecast.caption,/마지막 교차/);assert(d.plots.filter(p=>p.projection).every(p=>p.data.length===0));
 const vw=forecast('VWMA','fastest'),zero=studyData(vw,raw.map(c=>({...c,volume:0})));assert.equal(zero.forecast.readyCount,0);assert(zero.plots.filter(p=>p.projection).every(p=>p.data.length===0));
});

test('legacy five-line forecasts acquire only scenario defaults and retain their existing projection mode',()=>{
 const s=forecast();for(const key of ['method','showCrossing','searchBars','rangeBars','crossA','crossB','ratioBasis',...FORECAST_CANDIDATES.map(([key])=>key)])delete s.params[key];
 const decoded=decodeStudies(JSON.stringify({version:1,timeframeVersion:2,studies:[s]})).studies[0];assert.equal(decoded.params.method,'slope');assert.equal(decoded.params.showCrossing,false);assert.equal(decoded.params.period0,13);assert.deepEqual(decoded.styles,s.styles);
});
