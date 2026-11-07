import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudy,studyData,validateStudy,decodeStudies} from '../public/chart-studies.js';
import {createCyclePriceSolver,cyclePriceReading,cyclePriceSummary} from '../public/cycle-price-target.js';
import {CyclePriceInspection} from '../public/cycle-price-inspection.js';
import {CyclePriceArrows} from '../public/cycle-price-arrows.js';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance*Math.max(1,Math.abs(b)),a+' != '+b);
const raw=Array.from({length:190},(_,i)=>({time:1700000000+i*60,open:100+i*.01+Math.sin(i/8),high:102+i*.01+Math.sin(i/8),low:98+i*.01+Math.sin(i/8),close:100+i*.01+Math.sin(i/8+.25),volume:2+i%11}));
function cycle(average='SMA',candle='standard',source='close'){
 const s=createStudy('CYCLE',{candle,source});Object.assign(s.params,{average,fast:13,slow:26,reference:'theory',anchor:'live',predictionSource:'remaining'});return s;
}
function independentMa(s,n,history,price,bars,index){
 const m=createStudy(s.params.average,{candle:s.candle,source:s.source});m.params.period=n;
 const future=Array.from({length:bars},(_,h)=>({time:history[index].time+(h+1)*60,open:price,high:price,low:price,close:price,volume:history[index].volume}));
 return studyData(m,[...history.slice(0,index+1),...future]).plots[0].data.at(-1).value;
}

test('SMA inverse targets solve known constant prices and distinguish contact, earlier crossing and no unique price',()=>{
 const history=[10,10,20,20].map((close,i)=>({time:i*60,open:close,high:close,low:close,close,volume:1})),s=cycle();Object.assign(s.params,{fast:2,slow:4});
 const d=studyData(s,history),solver=createCyclePriceSolver(d.cyclePriceContext);
 near(solver.at(1).price,10);assert.equal(solver.at(1).crossingSide,'below');near(solver.at(2).price,20);near(solver.at(3).price,20);assert.equal(solver.at(3).earlierCross,2);
 assert.equal(solver.at(4).price,null);assert.match(solver.at(4).reason,/가격.*무관/);
 assert.equal(solver.at(2),solver.at(2),'cache one horizon until the underlying context is replaced');
});

test('inverse prices match independently appended constant OHLC for all five MA types, HA sources and multiple future bars',()=>{
 let solved=0;
 for(const average of ['SMA','EMA','VWMA','KAMA','HMA'])for(const candle of ['standard','heikin'])for(const source of ['close','open','hl2']){
  const s=cycle(average,candle,source),d=studyData(s,raw),solver=createCyclePriceSolver(d.cyclePriceContext);let count=0;
  for(const bars of [1,3,5,9]){
   const target=solver.at(bars);if(target.price===null)continue;
   assert.ok(target.price>0);near(independentMa(s,13,raw,target.price,bars,raw.length-1),independentMa(s,26,raw,target.price,bars,raw.length-1));count++;solved++;
  }
  assert.ok(count>=1,average+' '+candle+' '+source+' has a verified solution');
 }
 assert.ok(solved>80);
});

test('inverse prices always start after the actual current candle, while the closed-anchor progress curves remain unchanged',()=>{
 const s=cycle('VWMA','heikin');s.params.anchor='closed';s.params.priceTargetMultiplier=20;
 const original=studyData(s,raw),edited=structuredClone(raw);Object.assign(edited.at(-1),{open:102,high:105,low:99,close:104,volume:9});const changed=studyData(s,edited);
 const a=createCyclePriceSolver(original.cyclePriceContext),b=createCyclePriceSolver(changed.cyclePriceContext);
 assert.deepEqual(original.cycleProjection,changed.cycleProjection);
 for(const h of [1,3,5]){assert.notEqual(a.at(h).price,b.at(h).price);near(independentMa(s,13,edited,b.at(h).price,h,edited.length-1),independentMa(s,26,edited,b.at(h).price,h,edited.length-1));}
 const reading=cyclePriceReading(s,changed.cyclePriceContext,b,5,changed.cycle.at(-1));near(reading.change,(reading.price/104-1)*100*20);
 assert.match(reading.summary,/5봉 후 · 20배 변동/);assert.match(reading.reference,/현재 진행봉/);assert.match(reading.assumption,/거래량은 기준봉과 동일/);
});

test('new observed prices replace inverse targets; multiplier changes only the compact displayed percent, never the root or historical plots',()=>{
 const s=cycle(),first=studyData(s,raw),a=createCyclePriceSolver(first.cyclePriceContext),one=cyclePriceReading(s,first.cyclePriceContext,a,5,first.cycle.at(-1));
 s.params.priceTargetMultiplier=30;const second=studyData(s,raw),b=createCyclePriceSolver(second.cyclePriceContext),thirty=cyclePriceReading(s,second.cyclePriceContext,b,5,second.cycle.at(-1));
 near(one.price,thirty.price);near(thirty.change,one.change*30);assert.deepEqual(first.plots,second.plots);assert.deepEqual(first.cycleProjection,second.cycleProjection);
 const changed=structuredClone(raw);changed.at(-1).close+=2;assert.notEqual(createCyclePriceSolver(studyData(s,changed).cyclePriceContext).at(5).price,one.price);
 assert.equal((thirty.summary.match(/%/g)||[]).length,1);assert.match(thirty.assumption,/수수료·펀딩은 포함하지/);assert.match(cyclePriceSummary(5,20,-4.2),/^5봉 후 · 20배 변동 −4.20%$/);
});

test('unavailable data, zero VWMA volume and invalid horizons never invent a target or infinite percent',()=>{
 const s=cycle('VWMA'),d=studyData(s,raw.map(c=>({...c,volume:0}))),solver=createCyclePriceSolver(d.cyclePriceContext);
 for(const h of [0,1,5,301,2.5,NaN])assert.equal(solver.at(h).price,null);
 const result=cyclePriceReading(s,d.cyclePriceContext,solver,5,d.cycle.at(-1));assert.equal(result.change,null);assert.match(result.summary,/계산 불가/);assert.doesNotMatch(result.summary,/NaN|Infinity/);
 assert.equal(createCyclePriceSolver(null).at(5).price,null);
});

test('tooltip settings migrate and round-trip through shared storage without editing old periods, methods or styles',async()=>{
 const s=cycle(),old=structuredClone(s);delete old.params.showPriceTarget;delete old.params.priceTargetMultiplier;delete old.params.showPositiveTargets;
 const migrated=validateStudy(old);assert.equal(migrated.params.showPriceTarget,true);assert.equal(migrated.params.priceTargetMultiplier,1);assert.equal(migrated.params.showPositiveTargets,true);assert.deepEqual(migrated.styles,s.styles);
 s.params.showPriceTarget=false;s.params.priceTargetMultiplier=20;s.params.showPositiveTargets=false;const document={version:1,timeframeVersion:2,studies:[s]},store=new ChartSettingsStore(null);await store.save({revision:0,document});assert.deepEqual((await store.get()).document,document);assert.deepEqual(decodeStudies(JSON.stringify(document)),document);
 for(const value of [0,-1,1001,NaN,'20'])assert.throws(()=>validateStudy({...s,params:{...s.params,priceTargetMultiplier:value}}));
 const off=studyData(s,raw);assert.equal(off.cyclePriceContext,null);assert.deepEqual(off.plots,studyData(migrated,raw).plots);
});

test('future inspection hovers, pins, refreshes and expires separately from candles; historical moves and drawing never select a forecast',()=>{
 const chart={moves:[],clicks:[],subscribeCrosshairMove(f){this.moves.push(f);},subscribeClick(f){this.clicks.push(f);},unsubscribeCrosshairMove(f){this.moves=this.moves.filter(x=>x!==f);},unsubscribeClick(f){this.clicks=this.clicks.filter(x=>x!==f);}},views=[];let value=1,drawing=false,candlePinned=false,selections=0;
 const model=new CyclePriceInspection({chart,read:e=>e.time>100&&e.time<=200&&e.paneIndex===1?{value,time:e.time}:null,onChange:v=>views.push(v),onSelect:()=>{selections++;candlePinned=false;},isDrawing:()=>drawing,isCandlePinned:()=>candlePinned});
 model.move({time:160,paneIndex:0});assert.equal(views.at(-1),null);model.move({time:160,paneIndex:1});assert.equal(views.at(-1).pinned,false);assert.equal(views.at(-1).reading.value,1);
 model.click({time:160,paneIndex:1});assert.equal(views.at(-1).pinned,true);assert.equal(selections,1);model.move({time:100,paneIndex:1});assert.equal(views.at(-1).reading.time,160);
 value=2;model.refresh();assert.equal(views.at(-1).reading.value,2);model.release();candlePinned=true;model.move({time:160,paneIndex:1});assert.equal(views.at(-1),null);
 candlePinned=false;drawing=true;model.click({time:160,paneIndex:1});assert.equal(selections,1);drawing=false;model.click({time:160,paneIndex:1});model.event.time=300;model.refresh();assert.equal(views.at(-1),null);assert.equal(model.pinned,false);
 model.destroy();assert.equal(chart.moves.length,0);assert.equal(chart.clicks.length,0);
});

test('forecast arrows use only the first eligible positive long and positive short, in real future time order',()=>{
 const s=cycle(),updates=[],queue=[],plugin={setMarkers:x=>updates.push(x),detach(){}},arrows=new CyclePriceArrows({}, {createMarkers:()=>plugin,schedule:fn=>{queue.push(fn);return fn;},cancel(){}}),path=Array.from({length:8},(_,h)=>({time:100+h*60,value:h})),calls=[];
 const candidates=[null,null,{price:103,earlierCross:1},{price:104,earlierTouch:2},{price:102},{price:110},{price:99},{price:98}];
 const solver={at(h){calls.push(h);return {price:null,crossingSide:'above',earlierCross:null,earlierTouch:null,...candidates[h]};}};
 arrows.update({study:s,context:{referencePrice:100},solver,path});while(queue.length)queue.shift()();
 const markers=updates.at(-1);assert.deepEqual(markers.map(m=>[m.time,m.text,m.shape]),[[340,'롱','arrowUp'],[460,'숏','arrowDown']]);assert.deepEqual(calls,[1,2,3,4,5,6]);
 arrows.update({study:s,context:{referencePrice:100},solver,path});assert.equal(queue.length,0,'unchanged observations do not rescan');
 s.params.showPositiveTargets=false;arrows.update({study:s,context:{referencePrice:100},solver,path});assert.deepEqual(updates.at(-1),[]);arrows.destroy();
});

test('new quotes clear vanished hypothetical arrows and stale asynchronous scans cannot restore old markers',()=>{
 const s=cycle(),updates=[],queue=[],plugin={setMarkers:x=>updates.push(x),detach(){}},arrows=new CyclePriceArrows({}, {createMarkers:()=>plugin,schedule:fn=>{queue.push(fn);return fn;},cancel(){}}),path=[0,1,2,3].map(h=>({time:100+h*60,value:h}));
 const positive={at:()=>({price:101,crossingSide:'above',earlierCross:null,earlierTouch:null})};arrows.update({study:s,context:{referencePrice:100},solver:positive,path});queue.shift()();assert.equal(updates.at(-1)[0].text,'롱');
 const unavailable={at:()=>({price:null})};arrows.update({study:s,context:{referencePrice:102},solver:unavailable,path});assert.deepEqual(updates.at(-1),[]);while(queue.length)queue.shift()();assert.deepEqual(updates.at(-1),[]);
 s.params.showPositiveTargets=true;s.params.priceTargetMultiplier=20;arrows.update({study:s,context:{referencePrice:100},solver:positive,path});arrows.destroy();while(queue.length)queue.shift()();assert.deepEqual(updates.at(-1),[]);
});
