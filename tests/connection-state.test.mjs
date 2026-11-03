import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionView} from '../public/connection-state.js';
test('permission color and label reflect the real permission independently of lookup and bot warnings',()=>{
 const base={connected:true,tradingEnabled:true,environment:'live',bots:[]};
 const healthy=connectionView(base);for(const state of [{...base,error:'조회 실패'},{...base,bots:[{name:'SPY',error:'확인 필요'}]},{...base,waiting:{message:'호출 제한 대기'}}]){
 const view=connectionView(state);assert.equal(view.connectionState,healthy.connectionState);assert.equal(view.orderLabel,'주문 허용');assert.ok(view.warning);assert.match(view.summary,/주문 허용/);}
 const market=connectionView(base,'차트 조회 실패');assert.equal(market.connectionState,'trading');assert.equal(market.healthLabel,'조회 경고');
 const off=connectionView({...base,tradingEnabled:false});assert.equal(off.connectionState,'readonly');assert.equal(off.permission,false);assert.equal(off.orderLabel,'주문 꺼짐');
});
test('saved on preference is visible while disconnected without claiming order execution is available',()=>{
 const view=connectionView({connected:false,tradingEnabled:false,orderPermission:{enabled:true},environment:'live'});
 assert.equal(view.permission,true);assert.equal(view.enabled,false);assert.equal(view.orderLabel,'연결 대기');assert.equal(view.connectionState,'disconnected');
});

test('storage recovery shows saved permission separately from the execution hold and respects off requests',()=>{
 const base={connected:true,tradingEnabled:false,orderPermission:{enabled:true},storageFault:{code:'EPERM'},environment:'live',bots:[],error:'원장 저장 오류'};
 const held=connectionView(base);assert.equal(held.enabled,false);assert.equal(held.permission,true);assert.equal(held.orderLabel,'저장 복구 대기');assert.equal(held.healthLabel,'저장 오류');
 assert.equal(connectionView({...base,orderPermission:{enabled:false}}).permission,false);
});
