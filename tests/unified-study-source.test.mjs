import test from 'node:test';import assert from 'node:assert/strict';
import {studyInputType,studySource} from '../public/study-source.js';
import {createStudy,validateStudy,withStudySource,studyData,studyPlots,decodeStudies} from '../public/chart-studies.js';
import {customStudyCopy,customChartCopy,customStudyKey} from '../public/custom-studies.js';
import {CustomStudyStore} from '../backend/custom-studies.mjs';
const formula='(VWMA((하이킨고가+하이킨저가)/2, 6, 거래량)+SMA(하이킨종가, 55))/2',script='단기 = '+formula+'\n선("VWMA 6", 단기)',raw=Array.from({length:300},(_,i)=>({time:1700000000+i*60,open:100+i*.01,high:101+i*.01,low:99+i*.01,close:100.2+i*.01,volume:10+i%5}));
test('input detection distinguishes statements from equality, multiline expressions, quoted labels and comments',()=>{
 for(const s of [formula,'종가 = 시가','종가 == 시가','종가 >= 시가','조건(종가 = 시가, 1, 0)','SMA(\n하이킨종가, 6\n) +\nSMA(종가, 55)','// 선("x", 종가)\nSMA(종가, 6)',''])assert.equal(studyInputType(s),'FORMULA',s);
 for(const s of [script,'값 = 종가','값 =','선("주석 // , 이름", 종가)','plot("x", 종가)','forecast("x", 종가, 3)','// 설명\n단기 = SMA(종가, 6); 선("x", 단기)','선(\n"x", 종가\n)'])assert.equal(studyInputType(s),'SCRIPT',s);
});
test('the exact user script and its one-line expression produce the same line through one input path',()=>{
 const source=createStudy('FORMULA'),before=JSON.stringify(source),a=validateStudy(withStudySource(source,formula)),b=validateStudy(withStudySource(source,script));assert.equal(a.type,'FORMULA');assert.equal(b.type,'SCRIPT');assert.equal(studySource(a),formula);assert.equal(studySource(b),script);assert.equal(JSON.stringify(source),before);const left=studyData(a,raw).plots[0].data,right=studyData(b,raw).plots[0].data;assert.equal(studyData(b,raw).error,null);assert.deepEqual(right.filter(p=>p.value!=null),left.filter(p=>p.value!=null));assert.equal(studyPlots(b)[0].label,'VWMA 6');
});
test('switching input syntax in both directions preserves identity, name, visibility, primary style and additional plot styles',()=>{
 let b=createStudy('FORMULA',{params:{name:'내 선',placement:'pane',formula:'종가'},timeframes:['1m','5m'],visible:false});b.styles.main={...b.styles.main,color:'#123456',width:3,visible:false};const a=structuredClone(b);b=withStudySource(b,script);assert.equal(b.styles.line0.color,'#123456');assert.equal(b.styles.line0.width,3);assert.equal(b.styles.line0.visible,false);b.styles.line1.color='#abcdef';b=withStudySource(b,formula);b=withStudySource(b,script);assert.equal(b.styles.line1.color,'#abcdef');for(const k of ['id','visible','timeframes','source','candle'])assert.deepEqual(b[k],a[k]);assert.equal(b.params.name,'내 선');assert.equal(b.params.placement,'pane');assert.equal(b.params.formula,undefined);assert.equal(validateStudy(b).params.script,script);
});
test('existing formula and script entries can be edited and round-trip in the same reusable library and chart layout',async()=>{
 const old=createStudy('FORMULA'),converted=validateStudy(withStudySource(old,script)),library=new CustomStudyStore(null);await library.update({revision:0,action:'save',study:old});await library.update({revision:1,action:'save',study:converted});let saved=await library.get();assert.equal(saved.studies.length,1);assert.equal(saved.studies[0].id,old.id);assert.equal(saved.studies[0].type,'SCRIPT');const copy=customChartCopy(saved.studies[0]);assert.notEqual(copy.id,old.id);assert.equal(customStudyKey(copy),customStudyKey(saved.studies[0]));assert.equal(customStudyKey(customStudyCopy(converted)),customStudyKey(converted));const restored=validateStudy(withStudySource(saved.studies[0],formula));await library.update({revision:2,action:'save',study:restored});saved=await library.get();assert.equal(saved.studies[0].type,'FORMULA');assert.deepEqual(decodeStudies(JSON.stringify({version:1,timeframeVersion:2,studies:[old,copy]})).studies,[old,copy]);
});
test('automatic selection retains validation of incomplete scripts, unsafe JavaScript and unsupported indicator contexts',()=>{
 const b=createStudy('FORMULA');for(const s of ['値 = 1','단기 = 종가','단기 = 단기 + 1\n선("x", 단기)','단기 = 종가\n단기 = 시가\n선("x", 단기)','fetch("https://example.com")','선("x", 현재수익률())','선("x", 종가@1h)','종가@1h'])assert.throws(()=>validateStudy(withStudySource(b,s)),s);assert.equal(validateStudy(withStudySource(b,'선("x", 종가, 26)')).type,'SCRIPT');
});
