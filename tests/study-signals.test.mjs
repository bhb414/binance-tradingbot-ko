import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudy,withStudySource,validateStudy,studyData,studyPlots,decodeStudies} from '../public/chart-studies.js';
import {compileStudyScript,scriptStudyData} from '../public/study-script.js';
import {studyInputType} from '../public/study-source.js';
import {studySignalMarkers,StudySignals} from '../public/study-signals.js';
import {CustomStudyStore} from '../backend/custom-studies.mjs';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
import {formulaSnippets} from '../public/formula-snippets.js';
import {signatureAt} from '../public/formula-signature.js';
const rows=values=>values.map((close,i)=>({time:1700000000+i*60,open:close,high:close+.2,low:close-.2,close,volume:1}));
const source='단기 = SMA(종가, 1)\n장기 = SMA(종가, 3)\n선("단기", 단기)\n매수신호("골든", 상향돌파(단기, 장기))\n매도신호("데드", 하향돌파(단기, 장기))';
const custom=s=>validateStudy(withStudySource(createStudy('FORMULA'),s));
const markers=(study,raw,extra={})=>studySignalMarkers([{study,data:studyData(study,raw),...extra}]);

test('golden and dead cross signals share script variables and preserve line outputs with native candle timestamps',()=>{
 const raw=rows([4,3,2,1,2,3,2,1]),before=structuredClone(raw),s=custom(source),r=studyData(s,raw),m=markers(s,raw);
 assert.equal(r.error,null);assert.equal(r.plots.length,3);assert.deepEqual(studyPlots(s).map(p=>!!p.signal),[false,true,true]);assert.deepEqual(r.plots[0].data.map(p=>p.value),raw.map(c=>c.close));
 assert.deepEqual(m.map(p=>[p.time,p.text,p.shape,p.position,p.color]),[[raw[4].time,'골든','arrowUp','belowBar','#149b73'],[raw[6].time,'데드','arrowDown','aboveBar','#d6516b']]);assert.deepEqual(raw,before);
});
test('signal-only indicators auto-detect without a line and only true finite conditions produce arrows',()=>{
 const raw=rows([1,2,3]);for(const name of ['매수신호','매도신호','buySignal','sellSignal'])assert.equal(studyInputType(name+'("신호", 종가 > 1)'),'SCRIPT');
 const s=custom('매수신호("조건", 종가 > 1)\n매도신호("없음", 0)');assert.equal(markers(s,raw).length,2);assert.equal(markers(s,[]).length,0);
 assert.equal(markers(custom('매수신호("미확인", SMA(종가, 55) > 종가)'),raw).length,0);assert.equal(markers(custom('매수신호("음수도 참", -1)'),raw).length,3);
});
test('lagged conditions show previous-bar signals on current bars and current-bar signals retract without changing completed history',()=>{
 const s=custom('매수신호("교차", 상향돌파(SMA(종가, 1), SMA(종가, 3)))'),raw=rows([4,3,2,1,2]);assert.equal(markers(s,raw).at(-1).time,raw[4].time);
 const changed=rows([4,3,2,1,.5]);assert.equal(markers(s,changed).length,0);
 const lagged=custom('매수신호("이전 봉 교차", 상향돌파(SMA(종가, 1), SMA(종가, 3))[1])'),extended=rows([4,3,2,1,2,3]);assert.equal(markers(lagged,extended).at(-1).time,extended[5].time);
 assert.deepEqual(studyData(s,extended).plots[0].data.slice(0,raw.length),studyData(s,raw).plots[0].data);
});
test('signal visibility, timeframe activation, errors and custom size, position and color affect display only',()=>{
 const raw=rows([1,2,3]),s=custom('매수신호("매수", 1)\n매도신호("매도", 1)');s.styles.line0={...s.styles.line0,color:'#abcdef',width:3,position:'aboveBar'};s.styles.line1.visible=false;
 const m=markers(s,raw);assert.equal(m.length,3);assert.equal(m[0].position,'aboveBar');assert.equal(m[0].shape,'arrowUp');assert.equal(m[0].size,3);assert.equal(m[0].color,'#abcdef');assert.deepEqual(markers({...s,visible:false},raw),[]);assert.deepEqual(markers(s,raw,{active:false}),[]);assert.deepEqual(studySignalMarkers([{study:s,data:{error:'계산 오류',plots:studyData(s,raw).plots}}]),[]);
});
test('signal scripts and styles survive reusable-library and chart-settings round trips',async()=>{
 const s=custom(source);s.styles.line1.position='aboveBar';s.styles.line1.width=2;s.styles.line1.color='#abcdef';const library=new CustomStudyStore(null),layout=new ChartSettingsStore(null);
 await library.update({revision:0,action:'save',study:s});const saved=(await library.get()).studies[0];assert.deepEqual(saved,s);const doc={version:1,timeframeVersion:2,studies:[saved]};const result=await layout.save({revision:0,document:doc});assert.deepEqual(result.document,doc);assert.deepEqual(decodeStudies(JSON.stringify(doc)),doc);
 const legacy=createStudy('SCRIPT');assert.ok(!('position' in validateStudy(legacy).styles.line0));assert.throws(()=>validateStudy({...s,styles:{...s.styles,line1:{...s.styles.line1,position:'inBar'}}}));
});
test('marker rendering keeps stable data, replaces its price-series primitive, clears stale symbols, and never touches execution markers',()=>{
 const calls=[],plugins=[],external={markers:['execution']};const createMarkers=(series,initial,options)=>{const p={setMarkers:m=>calls.push({series,m}),detach:()=>p.detached=true};plugins.push(p);assert.equal(options.autoScale,true);return p;};
 const a={},b={},renderer=new StudySignals(a,{createMarkers}),raw=rows([1,2]),s=custom('매수신호("신호", 1)'),entries=[{study:s,data:studyData(s,raw)}];renderer.update(entries);const before=calls.length;renderer.update(entries);assert.equal(calls.length,before);renderer.setSeries(b);assert.equal(plugins[0].detached,true);assert.equal(calls.at(-1).series,b);assert.equal(calls.at(-1).m.length,2);renderer.clear();assert.deepEqual(calls.at(-1).m,[]);renderer.update(entries);renderer.update([]);assert.deepEqual(calls.at(-1).m,[]);assert.deepEqual(external.markers,['execution']);
});
test('signals stay in the sandbox and bounded output limit applies to mixed lines and arrows',()=>{
 for(const s of ['매수신호("x")','매도신호("x", 종가, 1)','매수신호(x, 1)','매수신호("x", fetch())','매도신호("x", 현재수익률())','매수신호("x", 종가@1h)','매수신호 = 1\n선("x", 종가)'])assert.throws(()=>compileStudyScript(s),s);
 const six=Array.from({length:6},(_,i)=>'매수신호("신호'+i+'", 1)').join('\n');assert.equal(compileStudyScript(six).plots.length,6);assert.throws(()=>compileStudyScript(six+'\n선("초과", 종가)'),/최대 6/);
 const escaped='매수신호("이름, (특수) // 문자", 종가 > 0)';assert.equal(scriptStudyData(escaped,rows([1])).error,null);
});
test('new signal functions have script-only insertion snippets and argument help',()=>{
 const script=formulaSnippets({chart:true,script:true});for(const name of ['매수신호','매도신호']){assert.equal(script.find(x=>x.name===name)?.insert,name+'()');assert.ok(!formulaSnippets().some(x=>x.name===name));const text=name+'("표시", ';const h=signatureAt(text,text.length);assert.equal(h.argument,1);assert.equal(h.params.length,2);}
});
