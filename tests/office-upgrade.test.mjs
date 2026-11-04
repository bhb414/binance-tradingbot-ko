import test from 'node:test';
import assert from 'node:assert/strict';
import {positionEmotion,workstationEffect} from '../public/workroom-metrics.js';
import {avatarPartLayers,avatarPartPreview,normalizeAppearance} from '../public/avatar.js';
import {officeRosterMarkup} from '../public/office-roster.js';
test('seven expressions follow current unrealized return on margin, independent of realized profit',()=>{
 const base={id:'b',quantity:1,used:100,budget:1000,pnl:0,runtime:{realized:30}},cases=[[15,'ecstatic'],[5,'excited'],[1,'happy'],[.02,'neutral'],[-1,'uneasy'],[-5,'sad'],[-15,'distressed']];
 for(const [value,kind] of cases){const mood=positionEmotion({...base,pnl:30+value});assert.equal(mood.kind,kind);assert.ok(Math.abs(mood.value-value)<1e-8);assert.ok(Math.abs(mood.roi-value)<1e-8);}
 assert.equal(positionEmotion({...base,error:'sync'}).kind,'unknown');assert.equal(positionEmotion({...base,quantity:0}).kind,'none');
 assert.match(workstationEffect({...base,pnl:32},0,0),/workstation-effect gain/);assert.match(workstationEffect({...base,pnl:28},0,0),/workstation-effect loss/);
 assert.equal(workstationEffect({...base,pnl:30},0,0),'');assert.equal(workstationEffect({...base,pnl:32,error:'unknown'},0,0),'');
});
test('category previews include only selected hair, outfit or accessory parts',()=>{
 const appearance=normalizeAppearance({hair:'long',outfit:'suit',accessory:'round'});
 assert.deepEqual(avatarPartLayers('hair','pony',appearance),['03Hair-back-6','03Hair-9']);
 assert.deepEqual(avatarPartLayers('outfit','suit',appearance),['01Costume-55']);
 assert.deepEqual(avatarPartLayers('accessory','round',appearance),['06Glasses-0']);
 assert.deepEqual(avatarPartLayers('accessory','none',appearance),[]);
 const hair=avatarPartPreview('hair','long',appearance);assert.doesNotMatch(hair,/00Skin|01Costume|02Eye|06Glasses/);
 const outfit=avatarPartPreview('outfit','suit',appearance);assert.doesNotMatch(outfit,/00Skin|03Hair|02Eye|06Glasses/);
});
test('roster offers start for a paused entry engine even while it is still managing a position',()=>{
 const bot={id:'held',name:'<SPY>',symbol:'SPYUSDT',status:'running',quantity:1,pnl:1,used:100,runtime:{runEnabled:false,realized:0}},names=[];
 const html=officeRosterMarkup([bot],{selectedId:'held',icon:name=>{names.push(name);return '<svg/>';}});assert.ok(names.includes('play'));assert.ok(!names.includes('pause'));assert.match(html,/&lt;SPY&gt; 시작/);assert.match(html,/data-edit-bot="held"/);assert.match(html,/data-office-focus="held"/);
});

test('minimum-order entry waits remain running and show their specific reason instead of an error',()=>{
 const bot={id:'waiting',name:'예산 대기',symbol:'BTCUSDT',quantity:1,entryPrice:100,positionDirection:'LONG',leverage:20,used:5,budget:10,pnl:1,runtime:{runEnabled:true,realized:0,entryBlocked:{label:'진입 대기 · 최소 금액',message:'예상 주문금액이 최소 기준보다 작습니다.'}}},names=[];
 const html=officeRosterMarkup([bot],{icon:name=>{names.push(name);return '<svg/>';}});
 assert.match(html,/진입 대기 · 최소 금액/);assert.doesNotMatch(html,/확인 필요/);assert.ok(names.includes('pause'));assert.doesNotMatch(html,/has-error/);
});

test('maker retries appear as waiting information while actual bot errors retain priority',()=>{
 const bot={id:'maker',name:'메이커',symbol:'BTCUSDT',quantity:0,runtime:{runEnabled:true,orderRetry:{label:'롱 진입 · 메이커 주문 대기',message:'5초 뒤에도 조건이 충족되면 최신 호가로 다시 시도합니다.'}}};
 const html=officeRosterMarkup([bot],{icon:()=>'<svg/>'});assert.match(html,/메이커 주문 대기/);assert.match(html,/최신 호가/);assert.doesNotMatch(html,/확인 필요|has-error/);
 assert.match(officeRosterMarkup([{...bot,error:'접수 여부 미확인'}],{icon:()=>'<svg/>'}),/확인 필요/);
});
