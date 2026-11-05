import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudy,validateStudy,studyData,parseStudies,studyLabel,studyPane,studyPriceFormat} from '../public/chart-studies.js';
import {directionalMovement} from '../public/study-calculations.js';
import {heikinAshi} from '../public/indicators.js';
import {studyChartHit} from '../public/chart-hit.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,a+' != '+b);
const candles=values=>values.map((close,i)=>({time:i*60,closeTime:(i+1)*60000-1,open:close-.4,high:close+1,low:close-1,close,volume:10+i}));
const study=(type,params={},extra={})=>{const s=createStudy(type,extra);s.params={...s.params,...params};return validateStudy(s);};
const points=(s,rows,key='main',kind='standard')=>studyData(s,rows,kind).plots.find(p=>p.key===key).data;
const types=['DMI','ADX','CCI','MFI','BBW','BBP'];

test('DMI follows Wilder directional movement including ties, warmup, and separate ADX smoothing',()=>{
 const rows=[[10,8,9],[11,9,10],[12,10,11],[11,9,10],[13,7,10],[13,7,10]].map(([high,low,close],i)=>({time:i*60,open:close,high,low,close,volume:10})),d=directionalMovement(rows,2,2);
 assert.deepEqual(d.plus.slice(0,2),[null,null]);near(d.plus[2],50);near(d.minus[2],0);assert.equal(d.adx[2],null);near(d.plus[3],25);near(d.minus[3],25);near(d.adx[3],50);near(d.plus[4],6.25);near(d.minus[4],6.25);near(d.adx[4],25);near(d.adx[5],12.5);
 const combined=points(study('DMI',{period:2,smoothing:2}),rows,'adx');assert.deepEqual(combined,points(study('ADX',{period:2,smoothing:2}),rows));assert.deepEqual(studyData(study('DMI',{period:2,smoothing:2}),rows).levels,[20,25]);
});
test('DMI treats flat and equal outside moves as nondirectional and restarts warmup after missing input',()=>{
 const flat=candles([5,5,5,5,5,5]).map(c=>({...c,open:5,high:5,low:5,close:5})),d=directionalMovement(flat,2,2);assert.ok(d.plus.slice(2).every(v=>v===0));assert.ok(d.minus.slice(2).every(v=>v===0));assert.ok(d.adx.slice(3).every(v=>v===0));
 const rising=candles([1,2,3,4,5,6,7,8,9]);rising[4].high=NaN;const gap=directionalMovement(rising,2,2);assert.equal(gap.plus[4],null);assert.equal(gap.plus[5],null);assert.equal(gap.plus[6],null);assert.ok(Number.isFinite(gap.plus[7]));
});
test('new studies use only known bars, never mutate market data, and respect chart versus explicit candle sources',()=>{
 const rows=candles(Array.from({length:90},(_,i)=>100+i/10+Math.sin(i/3)*4)),original=structuredClone(rows);
 for(const type of types){const s=study(type,{period:5,...(['DMI','ADX'].includes(type)?{smoothing:3}:{})});const full=studyData(s,rows);for(const n of [15,30,60])for(const p of studyData(s,rows.slice(0,n)).plots)assert.deepEqual(p.data,full.plots.find(x=>x.key===p.key).data.filter(x=>x.time<=rows[n-1].time),type);s.candle='heikin';assert.deepEqual(studyData(s,rows,'standard'),studyData({...s,candle:'standard'},heikinAshi(rows)));s.candle='standard';assert.deepEqual(studyData(s,rows,'heikin'),studyData(s,rows,'standard'));}assert.deepEqual(rows,original);
});
test('CCI uses mean absolute deviation and a 0.015 scale without clipping or inventing flat values',()=>{
 const s=study('CCI',{period:3},{source:'close'});near(points(s,candles([1,2,3]))[0].value,100);near(points(s,candles([1,3,2]))[0].value,0);assert.deepEqual(points(s,candles([5,5,5])),[]);assert.deepEqual(points(study('CCI',{period:20}),candles([1,2,3])),[]);assert.deepEqual(studyData(s,candles([1,2,3])).levels,[-100,0,100]);
});
test('MFI uses directional price-volume sums with full comparison history and does not invent zero-volume flows',()=>{
 const rows=candles([1,2,1,2]).map((c,i)=>({...c,volume:[10,20,30,40][i]})),s=study('MFI',{period:2},{source:'close'}),data=points(s,rows);assert.equal(data[0].time,120);near(data[0].value,100*40/70);near(data[1].value,100*80/110);
 near(points(s,candles([1,2,3]))[0].value,100);near(points(s,candles([3,2,1]))[0].value,0);assert.deepEqual(points(s,candles([1,2,3,4]).map(c=>({...c,volume:0}))),[]);assert.deepEqual(points(s,candles([1,1,1,1])),[]);assert.deepEqual(points(s,rows.map(c=>({...c,volume:-1}))),[]);
});
test('undefined MFI intervals stay blank and do not draw a continuous line across absent money flow',()=>{
 const data=points(study('MFI',{period:2},{source:'close'}),candles([1,2,3,3,3,4]));assert.deepEqual(data.find(p=>p.time===240),{time:240});assert.equal(data.find(p=>p.time===300).value,100);
});
test('Bollinger width and percent B match the selected bands, preserve outside values and handle zero denominators',()=>{
 const rows=candles([1,2,3,4,2,6,1,8,4,3]);for(const basis of ['SMA','EMA']){const params={period:3,multiplier:1.04,basis},extra={source:'ohlc4',candle:'heikin'},bb=studyData(study('BB',params,extra),rows),width=points(study('BBW',params,extra),rows),percent=points(study('BBP',params,extra),rows),ha=heikinAshi(rows);
 for(const [i,m]of bb.plots.find(p=>p.key==='middle').data.entries()){const upper=bb.plots[0].data[i].value,lower=bb.plots[2].data[i].value,c=ha.find(c=>c.time===m.time),price=(c.open+c.high+c.low+c.close)/4;near(width[i].value,(upper-lower)/m.value*100);near(percent[i].value,(price-lower)/(upper-lower));}}
 assert.ok(points(study('BBP',{period:3,multiplier:.1}),candles([1,2,20]))[0].value>1);assert.deepEqual(points(study('BBP',{period:3}),candles([5,5,5])),[]);assert.equal(points(study('BBW',{period:3}),candles([5,5,5]))[0].value,0);assert.deepEqual(points(study('BBW',{period:3}),candles([-1,0,1])),[]);
});
test('new indicator parameters, line styles and source choices persist and reject invalid thresholds',()=>{
 const all=types.map(type=>{const s=createStudy(type,{candle:'heikin',timeframes:['1m','5m']});for(const style of Object.values(s.styles)){style.width=3;style.color='#123456';}return s;});assert.deepEqual(parseStudies(JSON.stringify({version:1,timeframeVersion:2,studies:all})),all);assert.ok(all.every(studyPane));assert.equal(studyLabel(all[0]),'DMI 14 / 14');assert.match(studyLabel(all[4]),/BBW 20 · 2/);
 for(const type of ['DMI','ADX'])assert.throws(()=>study(type,{weak:30,strong:20}));assert.throws(()=>study('DMI',{smoothing:0}));assert.throws(()=>study('CCI',{lower:20}));assert.throws(()=>study('MFI',{lower:90,upper:80}));assert.throws(()=>study('BBW',{multiplier:0}));
});
test('independent oscillator scales do not inherit tiny price increments or price-specific formatter callbacks',()=>{
 const price={type:'custom',precision:8,minMove:1e-8,formatter:()=> 'price'};for(const type of ['DMI','ADX','CCI','MFI','BBW'])assert.deepEqual(studyPriceFormat(createStudy(type),price),{type:'price',precision:2,minMove:.01});assert.deepEqual(studyPriceFormat(createStudy('BBP'),price),{type:'price',precision:3,minMove:.001});assert.equal(studyPriceFormat(createStudy('BB'),price),price);
});
test('each DMI line is clickable in its own pane and blank calculation gaps are not hits',()=>{
 const chart={timeScale:()=>({timeToCoordinate:t=>t*10,options:()=>({barSpacing:8})})},series={priceToCoordinate:v=>100-v},row={pane:1,study:createStudy('DMI'),plots:['plus','minus','adx'].map((key,i)=>({key,series,data:[{time:1,value:10+i*20},{time:2,value:10+i*20}]}))};for(const y of [90,70,50])assert.equal(studyChartHit(chart,[row],{time:1,point:{x:15,y},paneIndex:1}),true);assert.equal(studyChartHit(chart,[row],{time:1,point:{x:15,y:90},paneIndex:0}),false);row.plots.forEach(p=>p.data=[{time:1},{time:2}]);assert.equal(studyChartHit(chart,[row],{time:1,point:{x:15,y:90},paneIndex:1}),false);
});
