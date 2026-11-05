import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileConfirmedSharedFees,sharedQuantityPending} from '../backend/confirmed-shared-fees.mjs';
import {BudgetBaselines} from '../backend/budget-baseline.mjs';
import {effectiveBudget} from '../public/budget.js';
function fixture(){
 const scope='live:test',bot={id:'owner',name:'TMF',symbol:'TMFUSDT',budget:20,budgetMode:'pnl',profitReinvestPercent:100,budgetIncluded:false,runtime:{realized:-16.88,budgetWithheld:0,quantity:0,entryPrice:0,runEnabled:false}},order={id:'native',botId:bot.id,scope,kind:'standard',role:'exit',status:'FILLED',orderId:123,parameters:{symbol:'OKLOUSDT',type:'MARKET'},appliedQty:.9,sharedRecordedQty:.3+.6,sharedManaged:true,sharedPending:true,feesFetched:false,lastQueryError:-2013},ledger={id:'allocation',botId:bot.id,scope,kind:'ledger',role:'exit',status:'FILLED',parent:order.id,orderId:123,parameters:{symbol:'OKLOUSDT',type:'MARKET'},appliedQty:.3+.6,feesFetched:true};
 const fills=[];for(const [index,quantity]of [[1,.3],[2,.6]]){const id=ledger.id+':trade:'+index;fills.push({id,botId:bot.id,scope,symbol:'OKLOUSDT',orderId:123,clientOrderId:ledger.id,quantity,role:'exit'});fills.push({id:'fee:'+id,botId:bot.id,scope,symbol:'OKLOUSDT',orderId:123,clientOrderId:ledger.id,tradeQuantity:quantity,fee:index===1?0:.001,feeAsset:'USDT'});}
 const state={scope,bots:[bot],orders:[order,ledger],fills};return {state,bot,order,ledger};
}
test('floating-point quantity noise never creates a pending shared fill but a real small residual does',()=>{
 assert.equal(sharedQuantityPending(17.55,17.549999999999997),false);assert.equal(sharedQuantityPending(.9,.3+.6),false);assert.equal(sharedQuantityPending(1,1-1e-9),true);assert.equal(sharedQuantityPending(2e-8,1e-8),true);
});
test('a fully recorded shared fee clears stale flags without changing any fill, fee, PnL or current-position quantity',()=>{
 const h=fixture(),fills=JSON.stringify(h.state.fills),runtime=JSON.stringify(h.bot.runtime);assert.equal(reconcileConfirmedSharedFees(h.state,h.order),true);assert.equal(h.order.feesFetched,true);assert.equal(h.order.sharedPending,false);assert.equal(h.order.sharedRecordedQty,.9);assert.equal(h.order.lastQueryError,undefined);assert.equal(JSON.stringify(h.state.fills),fills);assert.equal(JSON.stringify(h.bot.runtime),runtime);assert.equal(reconcileConfirmedSharedFees(h.state,h.order),false);
});
test('missing, mismatched or invalid commission evidence cannot clear an unresolved order',()=>{
 const cases=[h=>h.state.fills.pop(),h=>h.state.fills.at(-1).fee=null,h=>h.state.fills.at(-1).fee=NaN,h=>h.state.fills.at(-1).feeAsset='',h=>h.state.fills.at(-1).symbol='TMFUSDT',h=>h.state.fills.at(-1).scope='other',h=>h.state.fills.at(-1).tradeQuantity=.5,h=>h.ledger.appliedQty=.8,h=>h.order.appliedQty=1,h=>h.ledger.feesFetched=false,h=>h.order.status='UNKNOWN'];
 for(const mutate of cases){const h=fixture();mutate(h);assert.equal(reconcileConfirmedSharedFees(h.state,h.order),false);assert.equal(h.order.feesFetched,false);assert.equal(h.order.sharedPending,true);}
});
test('account-wide closes require confirmed allocations for every owner before clearing the parent',()=>{
 const h=fixture(),trade=h.state.fills[2],fee=h.state.fills[3];h.ledger.appliedQty=.3;const second={...h.ledger,id:'other-allocation',botId:'other-owner',appliedQty:.6};h.state.orders.push(second);trade.id=second.id+':trade:2';trade.clientOrderId=second.id;trade.botId=second.botId;fee.id='fee:'+trade.id;fee.clientOrderId=second.id;fee.botId=second.botId;
 assert.equal(reconcileConfirmedSharedFees(h.state,h.order),true);
 const missing=fixture();missing.state.orders.push({...missing.ledger,id:'fake-allocation',appliedQty:1});assert.equal(reconcileConfirmedSharedFees(missing.state,missing.order),false);
});
test('a partially filled active order may confirm its collected fees without becoming terminal',()=>{
 const h=fixture();h.order.status='PARTIALLY_FILLED';assert.equal(reconcileConfirmedSharedFees(h.state,h.order),true);assert.equal(h.order.status,'PARTIALLY_FILLED');
});
function baseline(h){
 const e={state:h.state,connected:true,connectionId:'test-connection',now:()=>1800000000000,storage:{healthy(){}},budgetSelection:{root:()=>h.bot,members:()=>[h.bot],view:()=>({...h.bot,used:0,reserved:0})},ownOrders:b=>h.state.orders.filter(o=>o.botId===b.id),async refreshAccount(){},async syncBotPosition(){},async refreshOrder(_b,o){reconcileConfirmedSharedFees(h.state,o);},shared:{active:()=>false},budgetLimit:effectiveBudget,allocatedBudget:()=>0,accountSnapshot:{walletBalance:1000},note(){},async checkpoint(){}};
 return new BudgetBaselines(e);
}
test('renamed-symbol budget baseline resets after proven fee recovery while keeping trading history and statistics',async()=>{
 const h=fixture(),service=baseline(h),fills=JSON.stringify(h.state.fills),pnl=h.bot.runtime.realized,preview=await service.preview(h.bot.id);assert.equal(preview.after,20);assert.equal(preview.before,3.120000000000001);assert.equal(preview.allowed,true);await service.commit(h.bot.id,preview.previewId);assert.equal(effectiveBudget(h.bot),20);assert.equal(h.bot.runtime.realized,pnl);assert.equal(JSON.stringify(h.state.fills),fills);assert.equal(h.bot.runtime.runEnabled,false);
});
test('a genuinely unresolved historical fee still blocks budget reset and names its original symbol and order',async()=>{
 const h=fixture();h.state.fills.pop();await assert.rejects(()=>baseline(h).preview(h.bot.id),/OKLOUSDT.*123.*수수료/);assert.equal(h.bot.runtime.budgetBaseline,undefined);
});
