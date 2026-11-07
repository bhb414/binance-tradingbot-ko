import test from 'node:test';import assert from 'node:assert/strict';
import {createStudy} from '../public/chart-studies.js';import {movingAverageLegend} from '../public/moving-average-legend.js';
test('each selected period has its own label, actual line color and matching value',()=>{
 const s=createStudy('MA_SET'),points=[{key:'ma4',value:220},{key:'ma0',value:5},{key:'ma2',value:60},{key:'ma1',value:20},{key:'ma3',value:120}],rows=movingAverageLegend(s,points);
 assert.deepEqual(rows.map(row=>row.label),['SMA 5선','SMA 20선','SMA 60선','SMA 120선','SMA 220선']);assert.deepEqual(rows.map(row=>row.text),['5','20','60','120','220']);assert.deepEqual(rows.map(row=>row.color),Object.values(s.styles).map(style=>style.color));
});
test('hidden and missing periods never shift neighboring values and zero remains visible',()=>{
 const s=createStudy('MA_SET');s.styles.ma1.visible=false;const rows=movingAverageLegend(s,[{key:'ma0',value:0},{key:'ma2',value:60.25},{key:'ma4',value:220}]);
 assert.deepEqual(rows.map(row=>row.key),['ma0','ma2','ma3','ma4']);assert.deepEqual(rows.map(row=>row.text),['0','60.25','—','220']);assert.deepEqual(movingAverageLegend(s,null).map(row=>row.text),['—','—','—','—']);
});
test('edited type, period and color are reflected without mutating settings or reading invalid numbers',()=>{
 const s=createStudy('MA_SET');s.params.average='VWMA';s.params.period0=6;s.styles.ma0.color='#123456';const points=[{key:'ma0',value:1.234567},{key:'ma1',value:Infinity}],before=structuredClone(s),rows=movingAverageLegend(s,points,value=>value.toFixed(6));
 assert.equal(rows[0].label,'VWMA 6선');assert.equal(rows[0].color,'#123456');assert.equal(rows[0].text,'1.234567');assert.equal(rows[1].text,'—');assert.deepEqual(s,before);
});
test('all unchecked periods and standalone averages produce no bundle rows',()=>{
 const s=createStudy('MA_SET');for(const style of Object.values(s.styles))style.visible=false;assert.deepEqual(movingAverageLegend(s),[]);assert.deepEqual(movingAverageLegend(createStudy('SMA')),[]);
});
