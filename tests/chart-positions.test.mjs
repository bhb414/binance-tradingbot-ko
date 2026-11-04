import test from 'node:test';
import assert from 'node:assert/strict';
import{chartEntryLines,PositionPriceLines}from'../public/chart-positions.js';
const state=positions=>({connected:true,account:{positions}});
test('entry lines use physical account entries for the selected futures symbol and reject invalid positions',()=>{
 const s=state([{symbol:'BTCUSDT',quantity:2,entryPrice:101,positionSide:'BOTH'},{symbol:'ETHUSDT',quantity:-3,entryPrice:99,positionSide:'BOTH'},{symbol:'BTCUSDT',quantity:0,entryPrice:102},{symbol:'BTCUSDT',quantity:1,entryPrice:0},{symbol:'BTCUSDT',quantity:NaN,entryPrice:103},{symbol:'BTCUSDT',quantity:1,entryPrice:Infinity}]);s.bots=[{symbol:'BTCUSDT',entryPrice:90}];
 const long=chartEntryLines(s,'usdm','BTCUSDT');assert.equal(long.length,1);assert.equal(long[0].price,101);assert.equal(long[0].title,'롱 평단');
 const short=chartEntryLines(s,'usdm','ETHUSDT');assert.equal(short[0].title,'숏 평단');assert.notEqual(short[0].color,long[0].color);
 for(const market of ['spot','coinm','options'])assert.deepEqual(chartEntryLines(s,market,'BTCUSDT'),[]);
 assert.deepEqual(chartEntryLines({...s,connected:false},'usdm','BTCUSDT'),[]);assert.deepEqual(chartEntryLines(null,'usdm','BTCUSDT'),[]);
});
test('hedged long and short entries remain separate and numeric strings are accepted',()=>{
 const lines=chartEntryLines(state([{symbol:'BTCUSDT',quantity:'2',entryPrice:'98.25',positionSide:'LONG'},{symbol:'BTCUSDT',quantity:'-3',entryPrice:'102.75',positionSide:'SHORT'}]),'usdm','BTCUSDT');
 assert.equal(lines.length,2);assert.equal(new Set(lines.map(l=>l.key)).size,2);assert.deepEqual(lines.map(l=>l.price),[98.25,102.75]);
});
test('averaging, reduction, closing, symbol switching and reconnects update only owned price lines without duplicates',()=>{
 const created=[],removed=[],changed=[],drawings={manual:true},summary={textContent:''},series={createPriceLine(options){const line={options,applyOptions(next){this.options=next;changed.push(next);}};created.push(line);return line;},removePriceLine(line){removed.push(line);},priceFormatter(){return {format:n=>n.toFixed(2)};}},renderer=new PositionPriceLines(series,{summary}),p={symbol:'BTCUSDT',quantity:2,entryPrice:100};
 const update=positions=>renderer.update(chartEntryLines(state(positions),'usdm','BTCUSDT'));update([p]);assert.equal(created.length,1);assert.match(summary.textContent,/BTCUSDT 롱 평단 100.00/);
 update([p]);update([{...p,quantity:1}]);assert.equal(created.length,1);assert.equal(changed.length,0);
 update([{...p,quantity:3,entryPrice:101}]);assert.equal(created.length,1);assert.equal(changed.length,1);assert.equal(created[0].options.price,101);
 update([{...p,quantity:0}]);assert.equal(removed.length,1);assert.equal(summary.textContent,'');update([p]);assert.equal(created.length,2);
 renderer.update(chartEntryLines(state([p]),'usdm','ETHUSDT'));assert.equal(removed.length,2);update([p]);renderer.update(chartEntryLines({connected:false},'usdm','BTCUSDT'));assert.equal(removed.length,3);
 update([p]);renderer.clear();assert.equal(renderer.lines.size,0);assert.ok(removed.every(l=>l!==drawings));assert.ok(created.every(l=>l.options.axisLabelVisible&&l.options.lineStyle===2));
});
