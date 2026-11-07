import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudy,validateStudy,decodeStudies,studyData,studyPlots,studyActive,studyLabel,MA_FORECAST_PERIODS} from '../public/chart-studies.js';
import {projectStudyPoints} from '../public/study-time.js';
import {compactStudyLegend} from '../public/compact-study-legend.js';
import {forecastStyle} from '../public/ma-forecast.js';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
const raw=Array.from({length:440},(_,i)=>({time:1800000000+i*60,open:100+i*.01+Math.sin(i/9),high:103+i*.01+Math.sin(i/9),low:98+i*.01+Math.sin(i/9),close:101+i*.01+Math.cos(i/7),volume:1+i%19,closeTime:1800000000000+(i+1)*60000-1}));
const documentFor=studies=>({version:1,timeframeVersion:2,studies});
function legacy(){return {id:'legacy-forecast',type:'MA_FORECAST',visible:false,source:'hl2',candle:'standard',timeframes:['1m','1h'],params:{fastType:'VWMA',fast:6,slowType:'SMA',slow:55,horizon:8,slopeBars:4,anchor:'live'},styles:{fast:{...forecastStyle('#123456'),width:3,visible:false},slow:{...forecastStyle('#234567'),lineStyle:1},fastForecast:{...forecastStyle('#345678',true),width:2},slowForecast:{...forecastStyle('#456789',true),visible:false}}};}

test('forecast is a selectable five-line bundle with independent average kinds and no crossing requirement',()=>{
 const s=createStudy('MA_FORECAST'),data=studyData(s,raw);
 assert.deepEqual(MA_FORECAST_PERIODS.map((_,i)=>s.params['period'+i]),[5,20,60,120,220]);
 assert(MA_FORECAST_PERIODS.every((_,i)=>s.params['enabled'+i]&&s.params['type'+i]==='SMA'));
 assert.equal(data.forecast.lineCount,5);assert.equal(data.forecast.readyCount,5);assert.equal(data.plots.length,10);
 assert.equal(new Set(data.plots.map(p=>p.key)).size,10);assert.equal(data.forecast.crossingBars,undefined);
 assert.match(studyLabel(s),/SMA 5.*SMA 220/);assert.doesNotMatch(data.forecast.caption,/교차|돌파|확률/);
});

test('all five average kinds, source prices and candle choices match standalone averages and projected paths',()=>{
 const original=structuredClone(raw);
 for(const kind of ['SMA','EMA','VWMA','KAMA','HMA'])for(const candle of ['standard','heikin'])for(const source of ['close','hl2']){
  const s=createStudy('MA_FORECAST',{candle,source});
  for(let i=0;i<5;i++)s.params['type'+i]=kind;
  const d=studyData(s,raw,'heikin','1m');assert.equal(d.error,null);
  for(let i=0;i<5;i++){
   const single=createStudy(kind,{candle,source});single.params.period=s.params['period'+i];const expected=studyData(single,raw,'heikin').plots[0].data;
   assert.deepEqual(d.plots.find(p=>p.key==='ma'+i).data.filter(p=>Number.isFinite(p.value)),expected.filter(p=>Number.isFinite(p.value)),kind+' '+source+' '+candle+' '+i);
   const byTime=new Map(expected.map(p=>[p.time,p.value])),values=raw.map(c=>byTime.get(c.time)??null),projection=projectStudyPoints(values,raw,{horizon:3,slopeBars:3,lag:1});
   assert.deepEqual(d.plots.find(p=>p.key==='forecast'+i).data,projection.data);
  }
 }
 assert.deepEqual(raw,original);
});

test('mixed kinds, edited and repeated periods, disabled slots and styles round-trip through server persistence',async()=>{
 const s=createStudy('MA_FORECAST');s.params.type0='VWMA';s.params.period0=6;s.params.type1='HMA';s.params.period1=6;s.params.enabled2=false;s.params.enabled4=false;s.styles.forecast0.color='#123456';s.styles.ma1.width=3;
 const store=new ChartSettingsStore(null);await store.save({revision:0,document:documentFor([s])});assert.deepEqual((await store.get()).document.studies,[s]);
 assert.deepEqual(studyPlots(s).map(p=>p.key),['ma0','forecast0','ma1','forecast1','ma3','forecast3']);
 assert.deepEqual(studyData(s,raw).plots.map(p=>p.key),studyPlots(s).map(p=>p.key));assert.match(studyLabel(s),/VWMA 6.*HMA 6/);
});

test('old pair settings migrate without changing either average, forecast, style, anchor or display scope',async()=>{
 const old=legacy(),original=structuredClone(old),s=validateStudy(old);
 assert.deepEqual(old,original);assert.equal(s.id,old.id);assert.equal(s.visible,false);assert.equal(s.source,'hl2');assert.equal(s.candle,'standard');assert.deepEqual(s.timeframes,old.timeframes);
 for(const [key,value]of Object.entries({type0:'VWMA',period0:6,type1:'SMA',period1:55,enabled0:true,enabled1:true,enabled2:false,enabled3:false,enabled4:false,horizon:8,slopeBars:4,anchor:'live'}))assert.equal(s.params[key],value,key);
 for(const [before,after]of [['fast','ma0'],['slow','ma1'],['fastForecast','forecast0'],['slowForecast','forecast1']])assert.deepEqual(s.styles[after],old.styles[before]);
 assert.deepEqual(decodeStudies(JSON.stringify(documentFor([old]))).studies,[s]);
 const store=new ChartSettingsStore(null);await store.save({revision:0,document:documentFor([old])});assert.deepEqual((await store.get()).document.studies,[s]);
 const data=studyData(s,raw),single=createStudy('VWMA',{candle:'standard',source:'hl2',params:{period:6}}),expected=studyData(single,raw).plots[0].data;
 assert.deepEqual(data.plots[0].data.filter(p=>Number.isFinite(p.value)),expected.filter(p=>Number.isFinite(p.value)));const byTime=new Map(expected.map(p=>[p.time,p.value]));assert.deepEqual(data.plots[1].data,projectStudyPoints(raw.map(c=>byTime.get(c.time)??null),raw,{horizon:8,slopeBars:4,lag:0}).data);
});

test('malformed legacy settings cannot silently become defaults or corrupt new slots',()=>{
 for(const modify of [s=>delete s.styles.fast,s=>s.params.fast=0,s=>s.params.fastType='unknown',s=>s.params.period3=7]){const s=legacy();modify(s);assert.throws(()=>validateStudy(s));}
 const s=createStudy('MA_FORECAST');delete s.params.period4;assert.throws(()=>validateStudy(s));delete s.styles.ma0;assert.throws(()=>validateStudy(s));
});

test('closed-bar forecasts ignore all live candle mutations while live forecasts update',()=>{
 const s=createStudy('MA_FORECAST');for(let i=0;i<5;i++)s.params['type'+i]=['SMA','EMA','VWMA','KAMA','HMA'][i];
 const before=studyData(s,raw).plots.filter(p=>p.projection),changed=structuredClone(raw);Object.assign(changed.at(-1),{open:900,high:1000,low:800,close:999,volume:99999});
 assert.deepEqual(studyData(s,changed).plots.filter(p=>p.projection),before);
 s.params.anchor='live';assert.notDeepEqual(studyData(s,changed).plots.filter(p=>p.projection),studyData(s,raw).plots.filter(p=>p.projection));
});

test('all slots can be off and group visibility or timeframe hiding retains individual choices',()=>{
 const s=createStudy('MA_FORECAST');for(let i=0;i<5;i++)s.params['enabled'+i]=false;assert.doesNotThrow(()=>validateStudy(s));assert.equal(studyActive(s,'1m'),false);assert.deepEqual(studyPlots(s),[]);assert.deepEqual(studyData(s,raw).plots,[]);assert.match(studyLabel(s),/모두 숨김/);
 s.params.enabled3=true;assert.equal(studyActive(s,'1m'),true);s.visible=false;assert.equal(studyActive(s,'1m'),false);assert.equal(s.params.enabled3,true);s.visible=true;s.timeframes=['1h'];assert.equal(studyActive(s,'1m'),false);assert.equal(studyActive(s,'1h'),true);
});

test('invalid periods, types, checkbox values and forecast controls fail validation',()=>{
 const s=createStudy('MA_FORECAST');
 for(const [key,values]of Object.entries({period4:[0,301,2.5,NaN],type3:['unknown'],enabled2:['true',0,null],horizon:[0,121,1.5],slopeBars:[0,301],anchor:['future']}))for(const value of values)assert.throws(()=>validateStudy({...s,params:{...s.params,[key]:value}}),key+' '+value);
});

test('missing history and zero-volume VWMA keep unavailable projections empty instead of inventing prices',()=>{
 const s=createStudy('MA_FORECAST');for(let i=0;i<5;i++)s.params['type'+i]='VWMA';const d=studyData(s,raw.map(c=>({...c,volume:0})));assert.equal(d.error,null);assert.equal(d.forecast.readyCount,0);assert(d.plots.filter(p=>p.projection).every(p=>p.data.length===0));
 const short=studyData(createStudy('MA_FORECAST'),raw.slice(0,10));assert.equal(short.forecast.readyCount,1);assert.equal(short.plots.find(p=>p.key==='forecast4').data.length,0);
});

test('compact legends list each selected period once and show future-only readings with their own colors',()=>{
 const s=createStudy('MA_FORECAST');s.params.type0='VWMA';s.params.period0=6;s.params.enabled2=false;s.styles.forecast0.color='#123456';
 let model=compactStudyLegend(s,[{key:'ma0',value:0},{key:'forecast0',value:7}]);assert.equal(model.heading,'이평 예상 · 3봉');assert.equal(model.entries.length,4);assert.equal(model.entries[0].label,'VWMA 6');assert.equal(model.entries[0].text,'0');
 model=compactStudyLegend(s,[{key:'forecast0',value:7}]);assert.equal(model.entries[0].text,'예상 7');assert.equal(model.entries[0].color,'#123456');
 s.styles.ma0.visible=false;assert.equal(compactStudyLegend(s,[{key:'ma0',value:1},{key:'forecast0',value:7}]).entries[0].text,'예상 7');
 s.styles.forecast0.visible=false;assert(!compactStudyLegend(s).entries.some(p=>p.key==='ma0'));
});

test('migration leaves unrelated saved studies intact',()=>{
 const ma=createStudy('MA_SET'),copy=structuredClone(ma),doc=decodeStudies(JSON.stringify(documentFor([ma,legacy()])));assert.deepEqual(doc.studies[0],copy);assert.equal(doc.studies[1].type,'MA_FORECAST');
});
