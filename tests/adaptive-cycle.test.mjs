import test from 'node:test';import assert from 'node:assert/strict';
import {compileFormula,formulaTimeframes} from '../public/formula.js';
import {kama,hma,cyclePeriod} from '../public/adaptive-cycle.js';
import {createStudy,studyData,studyPlots,validateStudy,decodeStudies} from '../public/chart-studies.js';
import {formulaSeries,heikinAshi} from '../public/indicators.js';
import {SCRIPT_EXAMPLES,scriptStudyData} from '../public/study-script.js';
import {formulaSnippets} from '../public/formula-snippets.js';import {signatureAt} from '../public/formula-signature.js';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const equalSeries=(actual,expected)=>{assert.equal(actual.length,expected.length);expected.forEach((x,i)=>x===null?assert.equal(actual[i],null):near(actual[i],x));};
const prices=Array.from({length:700},(_,i)=>100+i*.01+Math.sin(i*2*Math.PI/40));
const raw=prices.map((v,i)=>({time:1700000000+i*60,open:v-.05,high:v+.2,low:v-.3,close:v,volume:10+i%7}));
function referenceWMA(values,n){return values.map((_,i)=>{const sample=values.slice(i-n+1,i+1);return i>=n-1&&sample.every(Number.isFinite)?sample.reduce((s,x,j)=>s+x*(j+1),0)/(n*(n+1)/2):null;});}
function referenceHMA(values,n){const a=referenceWMA(values,Math.max(1,Math.floor(n/2))),b=referenceWMA(values,n);return referenceWMA(values.map((_,i)=>Number.isFinite(a[i])&&Number.isFinite(b[i])?2*a[i]-b[i]:null),Math.max(1,Math.floor(Math.sqrt(n))));}
function referenceKAMA(values,n,fast=2,slow=30){let start=0,last=null;return values.map((x,i)=>{if(!Number.isFinite(x)){start=i+1;last=null;return null;}if(i-start<n-1)return null;if(last===null){last=values.slice(i-n+1,i+1).reduce((s,v)=>s+v,0)/n;return last;}let volatility=0;for(let k=i-n+1;k<=i;k++)volatility+=Math.abs(values[k]-values[k-1]);const er=volatility?Math.abs(x-values[i-n])/volatility:0,sc=(2/(slow+1)+er*(2/(fast+1)-2/(slow+1)))**2;last+=sc*(x-last);return last;});}
test('KAMA agrees with an independent efficiency-ratio calculation and SMA seed',()=>{
 for(const n of [1,7,10,30])for(const [fast,slow]of [[2,30],[5,50]]){const expected=referenceKAMA(prices,n,fast,slow);equalSeries(kama(prices,n,fast,slow),expected);equalSeries(compileFormula(`KAMA(종가,${n},${fast},${slow})`).evaluateSeries({close:prices}).values,expected);}
});
test('Hull MA agrees with independent nested WMA calculations including odd periods and period one',()=>{
 for(const n of [1,2,7,15,20,55]){const expected=referenceHMA(prices,n);equalSeries(hma(prices,n),expected);equalSeries(compileFormula(`HullMA(종가,${n})`).evaluateSeries({close:prices}).values,expected);}
});
test('adaptive averages handle flat series and restart warmup after missing data',()=>{
 const values=prices.slice(0,100);values[40]=null;
 equalSeries(kama(values,10),referenceKAMA(values,10));equalSeries(hma(values,15),referenceHMA(values,15));
 assert.ok(kama(Array(60).fill(7),10).slice(9).every(v=>v===7));assert.ok(hma(Array(60).fill(7),20).slice(22).every(v=>Math.abs(v-7)<1e-12));
});
test('new recursive calculations preserve completed values when future prices are appended or changed',()=>{
 for(const source of ['KAMA(종가,10)','HMA(종가,15)','주기추정(종가,200,8,100)','교차간격(종가,SMA(종가,7))','경과봉수(상향돌파(종가,SMA(종가,7)))']){
  const compiled=compileFormula(source),a=compiled.evaluateSeries({close:prices.slice(0,350)}),b=compiled.evaluateSeries({close:prices});assert.equal(a.ok,true,a.error);assert.equal(b.ok,true,b.error);assert.deepEqual(b.values.slice(0,350),a.values,source);
  const changed=[...prices];changed.fill(1000,350);assert.deepEqual(compiled.evaluateSeries({close:changed}).values.slice(0,350),a.values,source);
 }
});
test('single-bar and series results agree even for lagged and lazily selected calls',()=>{
 for(const source of ['KAMA(종가,10)[1]','HMA(종가,20)','주기추정(종가,200,8,100)+주기추정(종가,200,8,100)[1]','주기추정(종가,200,8,100)','교차간격(종가,SMA(종가,7))','경과봉수(종가>100.5)','조건(종가>101,주기추정(종가,200,8,100),주기추정(종가,200,8,100)[5])']){
  const f=compileFormula(source),series=f.evaluateSeries({close:prices});assert.equal(series.ok,true,series.error);for(const i of [250,310,500,699]){const value=f.evaluate({close:prices},i,{maxSteps:1000000});assert.equal(value.ok,true,value.error);if(series.values[i]===null)assert.equal(value.value,null);else near(value.value,series.values[i]);}
 }
});
test('cycle estimates identify several known periods after removing a linear trend and a large price offset',()=>{
 for(const period of [8,20,40,80]){const values=Array.from({length:600},(_,i)=>1e9+.03*i+Math.sin(i*2*Math.PI/period)),result=cyclePeriod(values);assert.ok(result.slice(0,199).every(v=>v===null));assert.ok(result.slice(200).every(v=>Math.abs(v-period)<=1),period);}
});
test('cycle estimates reject flat values, linear trends and deterministic white noise',()=>{
 let seed=123456;const noise=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)*2-1;
 for(const values of [Array(1000).fill(7),Array.from({length:1000},(_,i)=>100+i*.1),Array.from({length:1000},noise)])assert.ok(cyclePeriod(values).every(v=>v===null));
});
test('missing cycle inputs require a complete clean lookback and then recover',()=>{
 const values=[...prices];values[300]=null;const result=cyclePeriod(values);assert.ok(result.slice(300,500).every(v=>v===null));assert.equal(result.at(-1),40);
});
test('bars-since starts unknown, resets on every true bar, and does not invent history across missing values',()=>{
 const f=compileFormula('경과봉수(종가>0)');assert.deepEqual(f.evaluateSeries({close:[-1,1,0,1,0,-1,-1,1,1,-1]}).values,[null,0,1,0,1,2,3,0,0,1]);assert.deepEqual(f.evaluateSeries({close:[-1,1,0,null,0,1,0]}).values,[null,0,1,null,null,0,1]);assert.deepEqual(compileFormula('BarsSince(0)').evaluateSeries({close:[1,2,3]}).values,[null,null,null]);
});
test('cross intervals count opposite crossings, retain completed lengths and ignore same-direction touches',()=>{
 const f=compileFormula('교차간격(종가,0)');assert.deepEqual(f.evaluateSeries({close:[-1,1,0,1,0,-1,-1,1,1,-1]}).values,[null,null,null,null,null,4,4,2,2,2]);assert.deepEqual(f.evaluateSeries({close:[-1,1,-1,null,-1,1,-1]}).values,[null,null,1,null,null,null,1]);
});
test('new functions validate periods, scopes, aliases and historical-only arguments',()=>{
 for(const source of ['KAMA(종가,0)','KAMA(종가,10,30,2)','KAMA(종가,10,1.5,30)','HMA(종가,501)','주기추정(종가,200,8,101)','주기추정(종가,200,2,100)','주기추정(종가,200,100,100)','주기추정(종가,200.5,8,100)','경과봉수(요일()=월요일)','교차간격(현재수익률(),종가)','HMA(현재손익(),7)'])assert.throws(()=>compileFormula(source),source);
 for(const source of ['KAMA(종가,10)','HMA(종가,15)','주기추정(종가,200,8,100)','경과봉수(종가>0)','교차간격(종가,SMA(종가,7))']){assert.throws(()=>formulaTimeframes(source));assert.deepEqual(formulaTimeframes(`(${source})@1m[1]`),['1m']);}
 assert.equal(compileFormula('적응이평(종가,10)').evaluateSeries({close:prices}).ok,true);assert.equal(compileFormula('헐이평(종가,20)').evaluateSeries({close:prices}).ok,true);
});
test('five-thousand-bar cycle and nested adaptive calculations stay within the existing evaluation budget',()=>{
 const close=Array.from({length:5000},(_,i)=>100+Math.sin(i*2*Math.PI/40));for(const source of ['주기추정(종가,200,8,100)','HMA(KAMA(종가,10),15)']){const result=compileFormula(source).evaluateSeries({close});assert.equal(result.ok,true,result.error);assert.ok(result.steps<600000);}
 assert.equal(compileFormula('주기추정(종가,200,8,100)').evaluateSeries({close},{maxSteps:50}).ok,false);
});
test('next-bar assumptions evaluate adaptive averages using only the simulated next candle',()=>{
 const data=raw.slice(0,100),series=formulaSeries(data);for(const name of ['KAMA','HMA']){const result=compileFormula(`다음봉(${name}(종가,10),101,103,100,102,10)`).evaluate(series,99,{maxSteps:100000});assert.equal(result.ok,true,result.error);const expected=(name==='KAMA'?kama:hma)([...data.map(c=>c.close),102],10).at(-1);near(result.value,expected);}
});
test('native adaptive studies match expressions for general and Heikin prices and keep selected bundle periods',()=>{
 for(const type of ['KAMA','HMA'])for(const candle of ['standard','heikin']){const study=createStudy(type,{candle}),data=studyData(study,raw),result=compileFormula(`${type}(종가,${study.params.period})`).evaluateSeries({close:(candle==='heikin'?heikinAshi(raw):raw).map(c=>c.close)});const expected=result.values.map((value,i)=>value===null?null:{time:raw[i].time,value}).filter(Boolean);assert.equal(data.error,null);assert.equal(data.plots[0].data.length,expected.length);data.plots[0].data.forEach((p,i)=>{assert.equal(p.time,expected[i].time);near(p.value,expected[i].value);});}
 for(const kind of ['KAMA','HMA']){const bundle=createStudy('MA_SET');bundle.params.average=kind;bundle.params.period0=7;bundle.styles.ma1.visible=false;assert.doesNotThrow(()=>validateStudy(bundle));const data=studyData(bundle,raw);const n=bundle.params.period0,expected=(kind==='KAMA'?kama:hma)(prices,n).filter(Number.isFinite);assert.equal(data.plots[0].data.length,expected.length);data.plots[0].data.forEach((p,i)=>near(p.value,expected[i]));assert.equal(bundle.styles.ma1.visible,false);}
});
test('cycle study distinguishes full periods, completed intervals, elapsed bars and ratio bases',()=>{
 const study=createStudy('CYCLE',{candle:'standard'}),data=studyData(study,raw);assert.equal(data.error,null);assert.equal(data.plots[0].data.at(-1).value,40);assert.ok(Math.abs(data.plots[1].data.at(-1).value-20)<=1);assert.match(data.caption,/완성봉/);
 const altered=structuredClone(raw);Object.assign(altered.at(-1),{open:999,high:1000,low:900,close:990});const closed=studyData(study,altered);assert.deepEqual(closed.plots.map(p=>p.data.at(-1)),data.plots.map(p=>p.data.at(-1)));
 study.params.display='ratio';const ratio=studyData(study,raw);assert.deepEqual(ratio.levels,[.25,.5,1,1.5,2,2.5,3,3.5,4]);assert.equal(ratio.plots[0].data.at(-1).value,1);near(ratio.plots[1].data.at(-1).value,data.plots[1].data.at(-1).value/40);study.params.basis='half';near(studyData(study,raw).plots[1].data.at(-1).value,ratio.plots[1].data.at(-1).value*2);assert.match(studyPlots(study)[0].label,/배/);
});
test('new chart types and bundle choices roundtrip through the server settings without altering prior indicators',async()=>{
 const legacy=createStudy('BB'),bundle=createStudy('MA_SET');bundle.params.average='HMA';const studies=[legacy,createStudy('KAMA'),createStudy('HMA'),createStudy('CYCLE'),bundle],document={version:1,timeframeVersion:2,studies},store=new ChartSettingsStore(null);await store.save({revision:0,document});assert.deepEqual((await store.get()).document,document);assert.deepEqual(decodeStudies(JSON.stringify(document)),document);assert.deepEqual(studies[0],legacy);
});
test('snippets, signature help and ready-made scripts include every new function and evaluate successfully',()=>{
 const names=formulaSnippets({chart:true,script:true}).map(s=>s.name);for(const name of ['KAMA','HMA','주기추정','교차간격','경과봉수']){assert.ok(names.includes(name));const text=name+'(';assert.equal(signatureAt(text,text.length).name,name);}
 for(const example of SCRIPT_EXAMPLES.slice(0,3)){const result=scriptStudyData(example.source,raw);assert.equal(result.error,null,example.name+': '+result.error);assert.ok(result.plots.length>=2);}
});
