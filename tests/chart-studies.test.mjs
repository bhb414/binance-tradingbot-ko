import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudy,validateStudy,studyData,defaultStudies,parseStudies,average,studyActive,studyPane,formulaStudyResult,compileStudyFormula} from '../public/chart-studies.js';
import {bollingerBands} from '../public/indicators.js';
import {formulaSeries} from '../public/indicators.js';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const candles=values=>values.map((close,i)=>({time:i*60,open:close-1,high:close+2,low:close-2,close,volume:10}));
const withParams=(type,params)=>{const study=createStudy(type);study.params={...study.params,...params};return validateStudy(study);};
const values=(type,params,data,key='main')=>studyData(withParams(type,params),data).plots.find(plot=>plot.key===key).data;

test('chart SMA, EMA and Bollinger calculations respect warmup and population deviation',()=>{
  assert.deepEqual(average([1,2,3,4,5],3),[null,null,2,3,4]);assert.deepEqual(average([1,2,3,4,5],3,'EMA'),[null,null,2,3,4]);
  const data=candles([1,4,2,6,3,8,4]),expected=bollingerBands(data,3,2),actual=studyData(withParams('BB',{period:3}),data);
  for(const [key,field] of [['upper','upper'],['middle','middle'],['lower','lower']]){const plot=actual.plots.find(plot=>plot.key===key).data;assert.equal(plot.length,expected.length);plot.forEach((point,i)=>near(point.value,expected[i][field]));}
  assert.deepEqual(values('SMA',{period:20},data),[]);
});

test('RSI uses Wilder smoothing with neutral flat inputs; MACD signal has its own warmup',()=>{
  const data=candles([44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28]);
  near(values('RSI',{period:14},data)[0].value,70.46413502109705);assert.equal(values('RSI',{period:3},candles([10,10,10,10]))[0].value,50);
  const macd=studyData(withParams('MACD',{fast:2,slow:3,signal:2,average:'SMA'}),candles([1,2,3,4,5,6]));
  assert.equal(macd.plots[0].data[0].time,120);assert.equal(macd.plots[1].data[0].time,180);assert.ok(macd.plots[0].data.every(point=>point.value===.5));assert.ok(macd.plots[2].data.every(point=>point.value===0));
});

test('Stochastic smoothing and ATR include high-low ranges and previous close gaps',()=>{
  const data=[{time:0,open:2,high:5,low:1,close:3,volume:1},{time:60,open:3,high:6,low:2,close:5,volume:1},{time:120,open:4,high:7,low:3,close:6,volume:1}];
  const stochastic=studyData(withParams('STOCH',{period:2,smooth:1,signal:2}),data);near(stochastic.plots[0].data[0].value,80);near(stochastic.plots[1].data[0].value,80);
  const gaps=[{time:0,open:9,high:10,low:8,close:9,volume:1},{time:60,open:14,high:15,low:13,close:14,volume:1},{time:120,open:13,high:14,low:12,close:13,volume:1},{time:180,open:12,high:13,low:11,close:12,volume:1}];
  const atr=values('ATR',{period:3,average:'RMA'},gaps);near(atr[0].value,10/3);near(atr[1].value,26/9);
  const flat=data.map(c=>({...c,open:5,high:5,low:5,close:5}));assert.equal(values('STOCH',{period:2,smooth:1,signal:1},flat).length,0);
});

test('VWAP resets at UTC anchors and does not invent prices without volume; source and synthetic candles stay independent',()=>{
  const data=candles([10,20,30,40]).map((c,i)=>({...c,time:86280+i*60,volume:i===3?0:2}));
  const vwap=createStudy('VWAP',{source:'close'});assert.deepEqual(studyData(vwap,data).plots[0].data.map(point=>point.value),[10,15,30,30]);assert.equal(studyData(vwap,data.map(c=>({...c,volume:0}))).plots[0].data.length,0);
  const raw=[{time:0,open:1,high:8,low:0,close:3,volume:5},{time:60,open:3,high:9,low:2,close:4,volume:7}];const study=withParams('SMA',{period:1});study.candle='standard';near(studyData(study,raw,'heikin').plots[0].data[0].value,3);study.candle='heikin';near(studyData(study,raw).plots[0].data[0].value,3);near(studyData(study,raw).plots[0].data[1].value,4.5);
  assert.deepEqual(studyData(createStudy('VOLUME'),raw,'heikin').plots[0].data.map(point=>point.value),[5,7]);
});

test('indicator settings round-trip independently, reject invalid parameters and keep empty layouts and timeframe visibility',()=>{
  const study=createStudy('EMA');study.params.period=50;study.styles.main={...study.styles.main,color:'#123456',width:3};study.timeframes=['1h','4h'];
  const parsed=parseStudies(JSON.stringify({version:1,studies:[study]}));assert.deepEqual(parsed,[study]);assert.equal(studyActive(parsed[0],'15m'),false);assert.equal(studyActive(parsed[0],'1h'),true);
  parsed[0].visible=false;assert.equal(studyActive(parsed[0],'1h'),false);assert.deepEqual(parseStudies('{"version":1,"studies":[]}'),[]);
  for(const invalid of [{...study,params:{period:NaN}},{...study,params:{period:0}},{...study,timeframes:[]},{...study,styles:{main:{...study.styles.main,color:'url(evil)'}}}])assert.throws(()=>validateStudy(invalid));
  assert.throws(()=>withParams('MACD',{fast:30,slow:26}));assert.throws(()=>withParams('RSI',{lower:80,upper:70}));assert.equal(parseStudies('not json').length,defaultStudies().length);
  assert.equal(parseStudies(JSON.stringify({version:1,studies:[study,study]})).length,4);
});

test('a custom historical expression plots the requested 3-bar average with blank warmup points',()=>{
  const study=createStudy('FORMULA'),data=candles([3,6,9,12]);
  assert.equal(study.params.formula,'종가[0:3]/3');
  assert.deepEqual(studyData(study,data).plots[0].data,[{time:0},{time:60},{time:120,value:6},{time:180,value:9}]);
  assert.deepEqual(studyData(study,data,'heikin'),studyData(study,data,'standard'));
  assert.equal(studyPane(study),false);study.params.placement='pane';assert.equal(studyPane(validateStudy(study)),true);
});

test('batched formula evaluation matches the condition engine at every bar and reuses indicator caches within a bounded calculation',()=>{
  const data=candles(Array.from({length:100},(_,i)=>100+Math.sin(i/3)*10+i/10)),series=formulaSeries(data);
  for(const source of ['EMA(종가, 12)-EMA(종가, 26)','RSI(종가, 14)+ATR(14)','볼린저상단(종가, 20, 2)-SMA(종가, 20)','상향돌파(종가, SMA(종가, 5))','(종가/종가[1]-1)*100']){
    const compiled=compileStudyFormula(source),result=compiled.evaluateSeries(series);assert.equal(result.ok,true);
    result.values.forEach((value,index)=>{const single=compiled.evaluate(series,index);if(single.missing)assert.equal(value,null);else near(value,single.value);});
  }
  const limited=formulaStudyResult('SMA(종가, 20)',data,{maxSteps:5});assert.equal(limited.ok,false);assert.deepEqual(limited.values,[]);assert.match(limited.error,/계산량/);
  assert.equal(compileStudyFormula('종가').evaluateSeries(series,{length:5001}).ok,false);
  assert.notEqual(formulaStudyResult('EMA(종가, 3)',data).values.at(-1),formulaStudyResult('EMA(종가, 3)',candles([1,2,3,4])).values.at(-1));
});

test('custom formulas preserve missing-value gaps, explicit Heikin sources, zero values and independent persisted names',()=>{
  const data=candles([1,2,3,4]),study=createStudy('FORMULA');study.params.formula='종가/(종가-2)';const points=studyData(study,data).plots[0].data;assert.deepEqual(points[1],{time:60});near(points[0].value,-1);
  study.params.formula='0';assert.ok(studyData(study,data).plots[0].data.every(point=>point.value===0));
  study.params.formula='하이킨종가-하이킨시가';const result=studyData(study,data);assert.deepEqual(result,studyData(study,data,'heikin'));
  study.params.name='나의 평균 "A" <선>';const other=createStudy('FORMULA');other.params.formula='RSI(종가, 14)';other.params.placement='pane';
  const restored=parseStudies(JSON.stringify({version:1,studies:[study,other]}));assert.equal(restored.length,2);assert.notEqual(restored[0].id,restored[1].id);assert.equal(restored[0].params.name,study.params.name);assert.equal(restored[1].params.formula,'RSI(종가, 14)');
});

test('custom formula inputs cannot run JavaScript or silently depend on account positions or unavailable timeframes',()=>{
  for(const source of ['globalThis.process.exit()','fetch("https://example.com")','종가; 1','종가[-1]','수익률+종가','평균매수가','봉(종가,60,0)'])assert.throws(()=>compileStudyFormula(source));
  const study=createStudy('FORMULA');study.params.formula='';assert.throws(()=>validateStudy(study));study.params.formula='종가';study.params.name='a'.repeat(33);assert.throws(()=>validateStudy(study));
});

test('half-open historical slices sum values and match explicit terms and SMA, including nonzero starts and expression slices',()=>{
  const data=candles([3,6,9,12,15]),series=formulaSeries(data);
  const slice=formulaStudyResult('종가[0:3]/3',data),expanded=formulaStudyResult('(종가[0]+종가[1]+종가[2])/3',data),sma=formulaStudyResult('SMA(종가,3)',data);
  assert.equal(slice.ok,true);assert.deepEqual(slice.values,expanded.values);assert.deepEqual(slice.values,sma.values);
  near(compileStudyFormula('종가[1:4]').evaluate(series,4).value,27);near(compileStudyFormula('(고가-저가)[0:3]').evaluate(series,4).value,12);
  assert.equal(compileStudyFormula('종가[0:3]/3 > 10').evaluate(series,4).pass,true);assert.equal(compileStudyFormula('종가[1:4]').evaluate(series,2).missing,true);
});

test('historical slices reject reversed, empty, fractional, negative or oversized bounds and retain operation limits',()=>{
  for(const source of ['종가[0:0]','종가[3:1]','종가[-1:3]','종가[0:3.5]','종가[0:502]','종가[:3]','종가[0:]','종가[0:3:1]','알수없는값[0:3]'])assert.throws(()=>compileStudyFormula(source));
  const limited=formulaStudyResult('(종가[0:3])[0:3]',candles([1,2,3,4,5,6]),{maxSteps:10});assert.equal(limited.ok,false);assert.deepEqual(limited.values,[]);
});
