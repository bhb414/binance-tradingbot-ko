import test from 'node:test';import assert from 'node:assert/strict';
import {createStudy,withStudySource,validateStudy,studyData,studyPlots,decodeStudies} from '../public/chart-studies.js';
import {compileStudyScript,scriptStudyData} from '../public/study-script.js';
import {studyInputType} from '../public/study-source.js';
import {formulaSnippets} from '../public/formula-snippets.js';
import {signatureAt} from '../public/formula-signature.js';
import {ChartSettingsStore} from '../backend/chart-settings.mjs';
import {CustomStudyStore} from '../backend/custom-studies.mjs';
const rows=values=>values.map((close,i)=>({time:1700000000+i*60,open:close,high:close,low:close,close,volume:1+i%3}));
const custom=source=>validateStudy(withStudySource(createStudy('FORMULA',{params:{name:'막대',placement:'pane',formula:'종가'}}),source));
test('histograms auto-detect in the unified editor and default to zero without changing values',()=>{
 const raw=rows([-2,0,2]),s=custom('막대("차이", 종가)'),data=studyData(s,raw),p=data.plots[0];
 assert.equal(data.error,null);assert.equal(studyInputType('막대("x", 종가)'),'SCRIPT');assert.equal(studyPlots(s)[0].histogram,true);assert.equal(p.histogram,true);assert.deepEqual(p.data.map(x=>x.value),[-2,0,2]);assert.deepEqual(p.data.map(x=>x.color),[s.styles.line0.negative,s.styles.line0.color,s.styles.line0.color]);
 assert.equal(withStudySource(createStudy('FORMULA'),'막대("x", 종가)').params.placement,'pane');assert.equal(studyInputType('histogram("x", 종가)'),'SCRIPT');assert.equal(compileStudyScript('histogram("x", 종가)').plots[0].histogram,true);
});
test('color compares each bar to a dynamic expression, including equality and negative reference values',()=>{
 const raw=rows([-4,-2,-1,0,2,4]),s=custom('기준 = SMA(종가, 2)\n막대("값", 종가, 기준)\n선("기준", 기준)');
 s.styles.line0.color='#123456';s.styles.line0.negative='#abcdef';const p=studyData(s,raw).plots[0];
 assert.equal(p.data[0].value,undefined);assert.equal(p.data[1].color,'#123456');assert.equal(p.data.at(-1).color,'#123456');
 const negative=studyData(custom('막대("음수지만 기준 위", 종가, -5)'),rows([-3])).plots[0];assert.equal(negative.data[0].color,custom('막대("음수지만 기준 위", 종가, -5)').styles.line0.color);
 const positive=studyData(s,rows([4,2])).plots[0];assert.equal(positive.data[1].value,2);assert.equal(positive.data[1].color,'#abcdef');
});
test('missing, zero-divided or insufficient reference data produces gaps and never a false color',()=>{
 const raw=rows([1,2,3,4]);for(const source of ['막대("x", 종가, 1/0)','막대("x", 종가, SMA(종가, 55))']){const data=studyData(custom(source),raw);assert.equal(data.error,null);assert.ok(data.plots[0].data.every(p=>p.value===undefined&&p.color===undefined));}
});
test('multiple histograms retain separate reference expressions, styles, ordinary lines and existing signals',()=>{
 const s=custom('값 = 종가-2\n막대("0 기준", 값)\n막대("1 기준", 값, 1)\n선("기준", 1)\n화살표("전환", 상향돌파(값, 0))\n배경("양수", 값 > 0)'),raw=rows([1,2,3]);s.styles.line1.color='#123456';s.styles.line1.negative='#abcdef';
 const data=studyData(s,raw);assert.equal(data.error,null);assert.deepEqual(studyPlots(s).map(p=>!!p.histogram),[true,true,false,false,false]);assert.equal(data.plots[0].data[1].color,s.styles.line0.color);assert.equal(data.plots[1].data[1].color,'#abcdef');assert.equal(data.plots[1].data[2].color,'#123456');
});
test('bar scripts and chosen colors survive server and reusable-library round trips',async()=>{
 const s=custom('차이 = VWMA(하이킨종가, 5, 거래량)-SMA(하이킨종가, 5)\n기준 = SMA(차이, 3)\n막대("이격", 차이, 기준)\n선("기준", 기준)');s.styles.line0.color='#112233';s.styles.line0.negative='#aabbcc';
 const store=new ChartSettingsStore(null);await store.save({revision:0,document:{version:1,timeframeVersion:2,studies:[s]}});assert.deepEqual((await store.get()).document.studies,[s]);
 const library=new CustomStudyStore(null);await library.update({revision:0,action:'save',study:s});assert.deepEqual((await library.get()).studies,[s]);
 const d=decodeStudies(JSON.stringify((await store.get()).document));assert.deepEqual(studyData(d.studies[0],rows([1,2,3,4,5,6,7,8])),studyData(s,rows([1,2,3,4,5,6,7,8])));
});
test('completed bar values and colors remain unchanged when later candles arrive',()=>{
 const raw=rows([4,3,2,1,2,3,4,5]),s=custom('값 = VWMA(종가, 3)-SMA(종가, 3)\n막대("x", 값, SMA(값, 2))');
 const a=studyData(s,raw.slice(0,6)).plots[0].data,b=studyData(s,raw).plots[0].data;assert.deepEqual(a,b.slice(0,6));
});
test('bar syntax keeps output limits, sandbox rules, reserved names and editor help',()=>{
 for(const source of ['막대("x", 종가, 0, 1)','막대("x", 현재수익률())','막대("x", 종가, 종가@1h)','막대("x", 종가, A.종가)','막대 = 1\n선("x", 막대)',Array.from({length:7},(_,i)=>'막대("'+i+'", 종가)').join('\n')])assert.throws(()=>compileStudyScript(source),source);
 assert.ok(formulaSnippets({chart:true,script:true}).some(x=>x.name==='막대'));assert.ok(!formulaSnippets({chart:false}).some(x=>x.name==='막대'));
 const text='막대("값", 종가, ';assert.ok(signatureAt(text,text.length));assert.equal(scriptStudyData('선("x", 종가)',rows([1,2])).error,null);
});
