import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudy,withStudySource,validateStudy,studyData,studyPlots,studyActive,decodeStudies} from '../public/chart-studies.js';
import {compileStudyScript} from '../public/study-script.js';
import {studyInputType} from '../public/study-source.js';
import {studySignalMarkers} from '../public/study-signals.js';
import {backgroundLayers,CandleBackground,StudyBackgrounds} from '../public/study-backgrounds.js';
import {CustomStudyStore} from '../backend/custom-studies.mjs';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
import {signatureAt} from '../public/formula-signature.js';
import {formulaSnippets} from '../public/formula-snippets.js';
const rows=values=>values.map((close,i)=>({time:1700000000+i*60,open:close-.1,high:close+.2,low:close-.2,close,volume:1}));
const custom=source=>validateStudy(withStudySource(createStudy('FORMULA'),source));
const entry=(study,raw)=>({study,data:studyData(study,raw)});

test('the user indicator can retain four lines and two arrows while adding independent background conditions',()=>{
 const source='차이값20_6 = SMA(하이킨종가, 20)-SMA(하이킨종가, 6)\n기준선20 = SMA(SMA(하이킨종가, 20),20)\n기울기20 = 변화율(기준선20, 1)\n기준선6 = VWMA(하이킨종가,6)\n기울기6 = 변화율(기준선6, 1)\n선("차이값1", 차이값20_6)\n선("기울기20", 기울기20)\n선("기울기6", 기울기6)\n선("0 기준선", 0)\n매도신호("매도", 상향돌파(기울기20, 0))\n매수신호("매수", 하향돌파(기울기20, 0))\n배경("매수 시점", 하향돌파(기울기20, 0))\n배경("매도 시점", 상향돌파(기울기20, 0))';
 const s=custom(source),raw=rows(Array.from({length:250},(_,i)=>100+Math.sin(i/9)*5)),data=studyData(s,raw);assert.equal(data.error,null);assert.equal(data.plots.length,8);assert.equal(studyPlots(s).filter(p=>p.background).length,2);
 const markers=studySignalMarkers([{study:s,data}]),backgrounds=backgroundLayers([{study:s,data}]);assert.ok(markers.length>0);assert.deepEqual(backgrounds.flatMap(b=>b.data.filter(x=>x.value===1).map(x=>x.time)).sort(),markers.map(x=>x.time).sort());
});
test('persistent conditions shade consecutive bars while cross conditions shade only their event; missing and false stay empty',()=>{
 const s=custom('배경("구간", 종가 > 1)\n배경("교차", 상향돌파(종가, 1))'),raw=rows([0,2,3,0,2]),e=entry(s,raw);assert.equal(e.data.error,null);assert.deepEqual(e.data.plots[0].data.map(p=>p.value),[0,1,1,0,1]);assert.deepEqual(e.data.plots[1].data.filter(p=>p.value===1).map(p=>p.time),[raw[1].time,raw[4].time]);assert.equal(backgroundLayers([{...e,active:false}]).length,0);assert.equal(backgroundLayers([{...e,study:{...s,visible:false}}]).length,0);
 const unknown=entry(custom('배경("봉 부족", SMA(종가, 55) > 종가)'),raw);assert.ok(unknown.data.plots[0].data.every(p=>p.value===undefined));assert.equal(studyData(s,[]).plots[0].data.length,0);
});
test('background masks are causal, retract the live bar, and lag conditions appear on the following bar',()=>{
 const s=custom('배경("구간", 종가 > 1)'),raw=rows([0,2,3]),extended=rows([0,2,3,0]);assert.deepEqual(studyData(s,extended).plots[0].data.slice(0,3),studyData(s,raw).plots[0].data);assert.equal(studyData(s,rows([0,2,0])).plots[0].data.at(-1).value,0);
 const lag=custom('배경("이전", (종가 > 1)[1])');assert.deepEqual(studyData(lag,raw).plots[0].data.map(p=>p.value),[undefined,0,1]);
});
test('background color, opacity and visibility round-trip without adding fields to legacy indicators',async()=>{
 const legacy=createStudy('SCRIPT'),old=structuredClone(legacy);assert.deepEqual(validateStudy(legacy),old);const s=custom('배경("강조", 종가 > 0)');s.styles.bg0={visible:true,color:'#abcdef',transparency:43};const library=new CustomStudyStore(null),layout=new ChartSettingsStore(null);await library.update({revision:0,action:'save',study:s});const saved=(await library.get()).studies[0];assert.deepEqual(saved,s);const doc={version:1,timeframeVersion:2,studies:[s]};assert.deepEqual((await layout.save({revision:0,document:doc})).document,doc);assert.deepEqual(decodeStudies(JSON.stringify(doc)),doc);
 const hidden=structuredClone(s);hidden.styles.bg0.transparency=100;assert.equal(studyActive(hidden,'1m'),false);assert.deepEqual(backgroundLayers([entry(hidden,rows([1]))]),[]);hidden.styles.bg0={...s.styles.bg0,visible:false};assert.equal(studyActive(hidden,'1m'),false);
 for(const style of [{...s.styles.bg0,color:'url(evil)'},{...s.styles.bg0,transparency:-1},{...s.styles.bg0,transparency:101},{...s.styles.bg0,transparency:NaN},{...s.styles.bg0,visible:'true'}])assert.throws(()=>validateStudy({...s,styles:{...s.styles,bg0:style}}));
});
test('vertical rectangles fill the price-pane height, merge neighboring bars, leave false gaps, and follow zoom and viewport',()=>{
 const fills=[],ctx={save(){},restore(){},fillRect(x,y,width,height){fills.push({x,y,width,height,color:this.fillStyle,alpha:this.globalAlpha});}},p=new CandleBackground();let spacing=10,range={from:1,to:4};p.attached({chart:{timeScale:()=>({getVisibleRange:()=>range,options:()=>({barSpacing:spacing}),timeToCoordinate:t=>t*10})},requestUpdate(){}});p.update([{color:'#123456',transparency:80,data:[{time:1,value:1},{time:2,value:1},{time:3,value:0},{time:4,value:1}]}]);p.updateAllViews();p.paneViews()[0].renderer().draw({useMediaCoordinateSpace:f=>f({context:ctx,mediaSize:{width:100,height:300}})});assert.equal(p.view.zOrder(),'bottom');assert.deepEqual(fills.map(({x,y,width,height})=>({x,y,width,height})),[{x:5,y:0,width:20,height:300},{x:35,y:0,width:10,height:300}]);assert.ok(Math.abs(fills[0].alpha-.2)<1e-10);
 fills.length=0;spacing=20;range={from:4,to:4};p.updateAllViews();p.draw({useMediaCoordinateSpace:f=>f({context:ctx,mediaSize:{width:100,height:150}})});assert.equal(fills[0].width,20);assert.equal(fills[0].height,150);p.update([]);p.updateAllViews();assert.deepEqual(p.columns,[]);p.detached();assert.equal(p.chart,null);
});
test('background primitives replace price-series owners and clear stale symbols without intercepting clicks or scaling prices',()=>{
 const attached=[],detached=[],a={attachPrimitive:p=>attached.push(p),detachPrimitive:p=>detached.push(p)},b={...a},renderer=new StudyBackgrounds(a);renderer.update([entry(custom('배경("x", 1)'),rows([1]))]);assert.equal(renderer.primitive.layers.length,1);renderer.setSeries(b);assert.equal(detached[0],attached[0]);assert.equal(attached.length,2);renderer.clear();assert.deepEqual(renderer.primitive.layers,[]);assert.equal(renderer.primitive.hitTest,undefined);assert.equal(renderer.primitive.autoscaleInfo,undefined);
});
test('generic arrows support custom or empty text, independent direction and position, and stable equal-time stacking order',()=>{
 const s=custom('화살표("첫째", 1)\n화살표신호("둘째", 1)\narrow("", 1)');s.styles.line0.order=5;s.styles.line1.order=1;s.styles.line1.direction='down';s.styles.line1.position='aboveBar';s.styles.line2.order=1;s.styles.line2.position='aboveBar';const raw=rows([1,2]),markers=studySignalMarkers([entry(validateStudy(s),raw)]);assert.deepEqual(markers.filter(m=>m.time===raw[0].time).map(m=>m.text),['둘째','','첫째']);assert.equal(markers[0].shape,'arrowDown');assert.equal(markers[0].position,'aboveBar');assert.equal(markers[1].shape,'arrowUp');assert.equal(markers[2].position,'belowBar');assert.equal(studyInputType('화살표("x", 종가 > 0)'),'SCRIPT');
 for(const style of [{...s.styles.line0,direction:'left'},{...s.styles.line0,order:-1},{...s.styles.line0,order:100},{...s.styles.line0,order:1.5}])assert.throws(()=>validateStudy({...s,styles:{...s.styles,line0:style}}));
});
test('background outputs have their own bounded slots and sandbox validation and both functions have snippets and help',()=>{
 const lines=Array.from({length:20},(_,i)=>'선("선'+i+'", 종가)').join('\n'),bgs=Array.from({length:6},(_,i)=>'배경("배경'+i+'", 종가 > 0)').join('\n');assert.equal(compileStudyScript(lines+'\n'+bgs).backgrounds.length,6);assert.throws(()=>compileStudyScript(bgs+'\n배경("초과", 1)'),/최대 6/);assert.throws(()=>compileStudyScript(lines+'\n화살표("초과", 1)'),/최대 20/);
 for(const s of ['배경("x")','배경("x", 1, 2)','배경("x", 현재수익률())','배경("x", 종가@1h)','배경("x", fetch())','화살표("x", 1, "up")'])assert.throws(()=>compileStudyScript(s));
 assert.equal(studyInputType('bgcolor("x", 종가 > 0)'),'SCRIPT');for(const name of ['배경','화살표']){assert.equal(formulaSnippets({chart:true,script:true}).find(x=>x.name===name)?.insert,name+'()');assert.ok(!formulaSnippets().some(x=>x.name===name));const text=name+'("x", ';assert.equal(signatureAt(text,text.length).argument,1);}
});
