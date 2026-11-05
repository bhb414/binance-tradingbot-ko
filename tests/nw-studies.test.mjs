import test from 'node:test';
import assert from 'node:assert/strict';
import {nadarayaWatson,nadarayaEnvelope,kernelSlope} from '../public/study-calculations.js';
import {createStudy,validateStudy,studyData,decodeStudies,studyActive,studyPane,studyPriceFormat,studyLabel} from '../public/chart-studies.js';
import {heikinAshi} from '../public/indicators.js';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
import {bandRows} from '../public/band-fill.js';
import {studyChartHit} from '../public/chart-hit.js';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,actual+' != '+expected);
const candles=values=>values.map((close,i)=>({time:i*60,open:close-1,high:close+3,low:close-2,close,volume:i+10}));
const make=(type,params={},extra={})=>{const study=createStudy(type,extra);study.params={...study.params,...params};return validateStudy(study);};
const plot=(data,key)=>data.plots.find(p=>p.key===key).data;

test('Gaussian endpoint NW uses hand-calculated normalized distance weights and full history',()=>{
 const result=nadarayaWatson([10,12,14,16],{lookback:3,bandwidth:1}),w1=Math.exp(-.5),w2=Math.exp(-2);
 assert.deepEqual(result.slice(0,2),[null,null]);near(result[2],(14+12*w1+10*w2)/(1+w1+w2));near(result[3],(16+14*w1+12*w2)/(1+w1+w2));
 const narrow=nadarayaWatson([10,12,14],{lookback:3,bandwidth:.1});near(narrow[2],14);const broad=nadarayaWatson([10,12,14],{lookback:3,bandwidth:300});assert.ok(broad[2]<result[2]);
});

test('RQ NW follows its independently calculated weights and Gaussian ignores the RQ parameter',()=>{
 const values=[10,12,14],parameters={lookback:3,bandwidth:2,kernel:'rationalQuadratic',alpha:2},w1=(1+1/16)**-2,w2=(1+4/16)**-2;
 near(nadarayaWatson(values,parameters)[2],(14+12*w1+10*w2)/(1+w1+w2));assert.notEqual(nadarayaWatson(values,parameters)[2],nadarayaWatson(values,{...parameters,alpha:.1})[2]);
 assert.deepEqual(nadarayaWatson(values,{...parameters,kernel:'gaussian',alpha:.1}),nadarayaWatson(values,{...parameters,kernel:'gaussian',alpha:100}));
});

test('NW is constant-preserving and gaps restart the complete calculation window without fabricated zero prices',()=>{
 const flat=nadarayaWatson(Array(12).fill(5),{lookback:3});flat.slice(2).forEach(value=>near(value,5));
 const gapped=nadarayaWatson([1,2,3,null,5,6,7,8],{lookback:3});assert.deepEqual(gapped.slice(3,6),[null,null,null]);assert.ok(Number.isFinite(gapped[6]));assert.deepEqual(nadarayaWatson([1,2],{lookback:3}),[null,null]);
 assert.ok(nadarayaWatson([0,0,0],{lookback:2}).slice(1).every(value=>value===0));
});

test('NW envelope uses trailing errors from each contemporaneous estimate and has independent warmup',()=>{
 const result=nadarayaEnvelope([10,12,14,16,12],[null,11,13,15,14],2,3);assert.deepEqual(result.upper.slice(0,2),[null,null]);near(result.upper[2],16);near(result.lower[2],10);near(result.upper[4],18.5);near(result.lower[4],9.5);
 const middle=[10,11,12,13],flat=nadarayaEnvelope(middle,middle,2,3);near(flat.upper[1],11);near(flat.lower[1],11);
 const zero=nadarayaEnvelope([10,12,14,16],[9,11,13,15],2,0);assert.deepEqual(zero.upper.slice(1),[11,13,15]);assert.deepEqual(zero.lower.slice(1),[11,13,15]);
 const gaps=nadarayaEnvelope([1,2,3,null,5,6],[1,1,1,null,4,5],2,1);assert.deepEqual(gaps.upper.slice(3,5),[null,null]);near(gaps.upper[5],6);
});

test('slope is a per-bar percent change, is scale-independent, and never spans missing or zero reference data',()=>{
 const values=[100,102,104,106];const data=kernelSlope(values,2);assert.deepEqual(data.slice(0,2),[null,null]);near(data[2],2);near(data[3],(106-102)/102*100/2);assert.deepEqual(kernelSlope(values.map(v=>v*10),2),data);
 assert.equal(kernelSlope([0,0,1],1)[1],null);assert.equal(kernelSlope([0,0,1],1)[2],null);assert.ok(kernelSlope([-100,-90],1)[1]>0);
 const gaps=kernelSlope([100,101,null,103,104,105],2);assert.equal(gaps[3],null);assert.equal(gaps[4],null);assert.ok(Number.isFinite(gaps[5]));
});

test('both NW kernels, their bands and slope never revise closed values when future bars are appended or live prices change',()=>{
 const rows=candles(Array.from({length:95},(_,i)=>100+i/10+Math.sin(i/3)*4)),original=structuredClone(rows);
 for(const kernel of ['gaussian','rationalQuadratic'])for(const type of ['NW','NW_SLOPE']){
  const study=make(type,{kernel,lookback:9,errorPeriod:4,slopeBars:3}),full=studyData(study,rows);
  for(const count of [10,20,40,70])for(const p of studyData(study,rows.slice(0,count)).plots)assert.deepEqual(p.data,plot(full,p.key).filter(point=>point.time<=rows[count-1].time));
  const changed=structuredClone(rows);changed.at(-1).close+=100;for(const p of studyData(study,changed).plots)assert.deepEqual(p.data.slice(0,-1),plot(full,p.key).slice(0,-1));
 }
 assert.deepEqual(rows,original);
});

test('NW respects independent standard and Heikin candle sources and never calculates from the chart display alone',()=>{
 const rows=candles(Array.from({length:30},(_,i)=>100+Math.sin(i/2)*3));
 for(const type of ['NW','NW_SLOPE']){const study=make(type,{lookback:4,errorPeriod:2,slopeBars:2},{source:'close',candle:'heikin'});assert.deepEqual(studyData(study,rows,'standard'),studyData({...study,candle:'standard'},heikinAshi(rows)));assert.deepEqual(studyData({...study,candle:'standard'},rows,'heikin'),studyData({...study,candle:'standard'},rows,'standard'));assert.deepEqual(studyData({...study,candle:'chart'},rows,'heikin'),studyData(study,rows));}
});

test('overlay center and oscillator use the same slope thresholds and colors while band multiplier cannot change slope',()=>{
 const rows=candles([10,11,12,13,14,14,14,13,12,11,10]),params={lookback:2,bandwidth:.1,slopeBars:1,neutral:.1,errorPeriod:2},overlay=make('NW',params),oscillator=make('NW_SLOPE',params),center=plot(studyData(overlay,rows),'middle'),slope=plot(studyData(oscillator,rows),'main');
 for(const p of slope){const m=center.find(v=>v.time===p.time);assert.equal(m.color,p.color);}
 assert.ok(slope.some(p=>p.color===oscillator.styles.main.color));assert.ok(slope.some(p=>p.color===oscillator.styles.main.negative));assert.ok(slope.some(p=>p.color===oscillator.styles.main.neutral));assert.deepEqual(studyData(oscillator,rows).levels,[-.1,0,.1]);assert.deepEqual(studyData(make('NW_SLOPE',{...params,neutral:0}),rows).levels,[0]);
 assert.deepEqual(plot(studyData(make('NW',{...params,multiplier:0}),rows),'middle'),center);const raw=nadarayaWatson(rows.map(c=>c.close),params);for(const point of slope)near(point.value,kernelSlope(raw,1)[point.time/60]);
});

test('NW settings, fill and slope units round-trip alongside existing studies and persist through the server store',async()=>{
 const nw=make('NW',{lookback:8,bandwidth:2,kernel:'rationalQuadratic',alpha:3},{candle:'heikin',source:'hlc3',timeframes:['1m','30m']}),slope=make('NW_SLOPE',{lookback:8,bandwidth:2,kernel:'rationalQuadratic',alpha:3});nw.fill={visible:true,color:'#123456',transparency:76};nw.styles.middle.neutral='#345678';const document={version:1,timeframeVersion:2,studies:[createStudy('BB'),nw,slope]},decoded=decodeStudies(JSON.stringify(document));assert.deepEqual(decoded,document);const store=new ChartSettingsStore(null);await store.save({revision:0,document});assert.deepEqual((await store.get()).document,document);
 assert.equal(studyPane(nw),false);assert.equal(studyPane(slope),true);assert.match(studyLabel(nw),/NW RQ 2/);assert.match(studyLabel(slope),/기울기/);const format=studyPriceFormat(slope,{type:'price',precision:2,minMove:.01});assert.equal(format.type,'custom');assert.equal(format.minMove,.0001);assert.deepEqual(format.tickmarksFormatter([.025,.05,-.025,-.000001]),['0.0250%','0.0500%','-0.0250%','0.0000%']);assert.equal(format.formatter(.05341),'0.0534%');
 for(const style of Object.values(nw.styles))style.visible=false;assert.equal(studyActive(nw,'1m'),true);nw.fill.transparency=100;assert.equal(studyActive(nw,'1m'),false);assert.equal(studyActive(slope,'1m'),true);
});

test('NW rejects unsafe kernel inputs, color strings and invalid band parameters without resetting other settings',()=>{
 for(const params of [{kernel:'unknown'},{lookback:0},{lookback:3.5},{lookback:301},{bandwidth:0},{bandwidth:NaN},{alpha:0},{alpha:Infinity},{slopeBars:0},{slopeBars:1.5},{neutral:-.1},{errorPeriod:0},{multiplier:-1}])assert.throws(()=>make('NW',params));
 const nw=createStudy('NW');nw.styles.middle.neutral='url(evil)';assert.throws(()=>validateStudy(nw));assert.throws(()=>validateStudy({...createStudy('NW'),fill:{visible:true,color:'#123456',transparency:101}}));
});

test('NW bands provide only jointly valid shading rows and all curve lines remain clickable in their own panes',()=>{
 const rows=candles([10,11,12,13,14,13,12]),study=make('NW',{lookback:2,errorPeriod:2}),data=studyData(study,rows),fill=bandRows(data.plots);assert.equal(fill[0].time,120);assert.ok(fill.every(row=>Number.isFinite(row.upper)&&Number.isFinite(row.lower)));
 const chart={timeScale:()=>({timeToCoordinate:t=>t*10,options:()=>({barSpacing:8})})},series={priceToCoordinate:v=>100-v},row={pane:0,study,plots:data.plots.map(p=>({key:p.key,series,data:[{time:1,value:10},{time:2,value:10}]}))};assert.equal(studyChartHit(chart,[row],{time:1,point:{x:15,y:90},paneIndex:0}),true);assert.equal(studyChartHit(chart,[row],{time:1,point:{x:15,y:90},paneIndex:1}),false);
});
