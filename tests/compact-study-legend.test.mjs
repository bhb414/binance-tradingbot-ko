import test from 'node:test';import assert from 'node:assert/strict';
import {createStudy,studyPlots} from '../public/chart-studies.js';import {compactStudyLegend,studyLegendHeading,studyLegendEntryText} from '../public/compact-study-legend.js';

test('inline readings keep MA periods and script output names, use price tick precision, and preserve pane units',()=>{
 const bb=createStudy('BB'),format=value=>value.toFixed(5),model=compactStudyLegend(bb,[{key:'upper',value:.12345}],format);assert.equal(studyLegendHeading(bb,model),'BB 20 SMA close 2');assert.equal(studyLegendEntryText(bb,model.entries[0]),'0.12345');
 const ma=createStudy('MA_SET'),m=compactStudyLegend(ma,[{key:'ma0',value:1.23456}],format);assert.equal(studyLegendEntryText(ma,m.entries[0]),'5 1.23456');
 const script=createStudy('SCRIPT'),s=compactStudyLegend(script,[{key:'line0',value:1}]);assert.match(studyLegendEntryText(script,s.entries[0]),/ 1$/);
 const slope=createStudy('NW_SLOPE'),p=compactStudyLegend(slope,[{key:'main',value:0}],format);assert.equal(p.entries[0].text,'0 %/봉');assert(studyLegendHeading(slope,p));
});
test('moving averages share a heading and keep edited periods, colors and keyed tooltip values',()=>{
 const s=createStudy('MA_SET');s.params.average='VWMA';s.params.period0=6;s.styles.ma1.visible=false;s.styles.ma0.color='#123456';const before=structuredClone(s),r=compactStudyLegend(s,[{key:'ma4',value:220},{key:'ma0',value:0},{key:'ma2',value:60.25}]);
 assert.equal(r.heading,'VWMA');assert.deepEqual(r.entries.map(e=>e.label),['6','60','120','220']);assert.equal(r.entries[0].fullLabel,'VWMA 6선');assert.equal(r.entries[0].color,'#123456');assert.deepEqual(r.entries.map(e=>e.text),['0','60.25','—','220']);assert.deepEqual(s,before);
});
test('multi-line studies use each visible plot color and name instead of the first line color',()=>{
 for(const type of ['BB','DMI','MACD','ICHIMOKU']){const s=createStudy(type),plots=studyPlots(s);s.styles[plots[1].key].visible=false;const r=compactStudyLegend(s,plots.map((p,i)=>({key:p.key,value:i+1})));
 assert.ok(r.heading);assert.deepEqual(r.entries.map(e=>e.key),plots.filter((_,i)=>i!==1).map(p=>p.key));for(const e of r.entries){assert.equal(e.color,s.styles[e.key].color);assert.equal(e.label,type==='BB'?({upper:'상단',middle:'중심',lower:'하단'}[e.key]):plots.find(p=>p.key===e.key).label);assert.notEqual(e.text,'—');}}
});
test('single line legends avoid repeated names and keep zero, units and missing values readable',()=>{
 assert.equal(compactStudyLegend(createStudy('VWMA',{params:{period:6}})).entries[0].label,'VWMA 6');const s=createStudy('NW_SLOPE'),r=compactStudyLegend(s,[{key:'main',value:0}]);assert.equal(r.heading,'');assert.equal(r.entries.length,1);assert.match(r.entries[0].label,/NW/);assert.equal(r.entries[0].text,'0 %/봉');assert.equal(compactStudyLegend(s,[{key:'main',value:NaN}]).entries[0].text,'—');
});
test('script legends follow actual output names and selected plots up to the full plot limit',()=>{
 const s=createStudy('SCRIPT');s.params.script=Array.from({length:20},(_,i)=>'선("사용자 '+i+'", SMA(종가,'+(i+1)+'))').join('\n');s.styles.line5.visible=false;const r=compactStudyLegend(s,[{key:'line19',value:19}]);assert.equal(r.entries.length,19);assert.equal(r.entries.at(-1).label,'사용자 19');assert.equal(r.entries.at(-1).text,'19');assert.equal(r.entries.at(-1).color,s.styles.line19.color);assert.ok(!r.entries.some(e=>e.key==='line5'));
});
test('all hidden plots retain the group identity without introducing helper lines',()=>{
 const s=createStudy('MA_SET');for(const style of Object.values(s.styles))style.visible=false;assert.deepEqual(compactStudyLegend(s),{heading:'SMA',entries:[]});const bb=createStudy('BB');for(const style of Object.values(bb.styles))style.visible=false;assert.equal(compactStudyLegend(bb).entries.length,0);assert.match(compactStudyLegend(bb).heading,/BB/);
});
