import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBudgets,withBudgetAllocation,effectiveBudget,requestedBudget,percentBudgetBasis,budgetSettingsErrors,unallocatedPercentError} from '../public/budget.js';
import {makeBot,validateBot} from '../public/core.js';
import {makeMultiBot,multiAllocations,validateMulti} from '../public/multi-bot.js';
import {budgetFieldsMarkup,percentBudgetDescription,createBudgetEditor} from '../public/budget-editor.js';
import {BudgetSelection} from '../backend/budget-selection.mjs';
import {copyBotSettings,resetBotSettings} from '../public/bot-tools.js';
const pool=(id,percent=5,extra={})=>({id,budget:100,budgetMode:'fixed',budgetType:'unallocatedPercent',budgetPercent:percent,...extra});
const fixed={id:'fixed',budget:400};
test('all residual percentage roots use one post-allocation pool independent of iteration order',()=>{
 const a=pool('a'),b=pool('b');for(const bots of [[fixed,a,b],[b,fixed,a],[b,a,fixed]]){const rows=resolveBudgets(bots,1000,10);for(const id of ['a','b'])assert.deepEqual({basis:rows.get(id).basis,other:rows.get(id).otherAllocated,total:rows.get(id).totalPercent,limit:rows.get(id).limit},{basis:600,other:400,total:10,limit:30});assert.equal(rows.get('fixed').limit,400);}
});
test('paused allocations remain assigned, archived roots and multi workers are excluded',()=>{
 const roots=[{...fixed,runtime:{runEnabled:false}},pool('a'),pool('b',5,{kind:'multi',legs:[]}),pool('archived',100,{budgetIncluded:false}),{id:'archived-fixed',budget:900,budgetIncluded:false},pool('b_A',99,{multiBotId:'b'})];
 const r=resolveBudgets(roots,1000,20);assert.equal(r.get('a').limit,30);assert.equal(r.get('b').limit,30);assert.equal(r.get('a').totalPercent,10);assert.equal(r.has('b_A'),false);assert.equal(unallocatedPercentError(roots),'');assert.equal(resolveBudgets(roots.map(b=>b.id==='fixed'?{...b,budgetIncluded:false}:b),1000).get('a').limit,50);
});
test('own fills, pending commitments and cumulative bot PnL never shrink or inflate the shared basis',()=>{
 const a=pool('a',50,{used:100,reserved:50,runtime:{realized:10000,budgetWithheld:1000}}),b=pool('b',50,{used:100});const original=JSON.stringify([fixed,a,b]);
 for(const available of [0,50,300,1000]){const rows=resolveBudgets([fixed,a,b],1000,available);assert.equal(rows.get('a').limit,300);assert.equal(rows.get('b').limit,300);}
 assert.equal(JSON.stringify([fixed,a,b]),original);assert.equal(resolveBudgets([fixed,a,b],500,0).get('a').limit,50);assert.equal(a.used,100);
});
test('ordinary budgets retain their exact previous allocations and run before the residual group',()=>{
 const cases=[[{id:'x',budget:100,budgetShortfall:'available'},{id:'y',budget:200,budgetShortfall:'available',used:50}],[fixed,{id:'wallet',budgetType:'walletPercent',budgetPercent:20}],[fixed,{id:'free',budgetType:'availablePercent',budgetPercent:20,used:10}]];
 for(const ordinary of cases){const expected=resolveBudgets(ordinary,1000,100),withPool=resolveBudgets([...ordinary,pool('a')],1000,100);for(const [id,row] of expected)assert.deepEqual(withPool.get(id),row);const allocated=ordinary.reduce((sum,b)=>sum+expected.get(b.id).limit,0);assert.equal(withPool.get('a').basis,1000-allocated);}
});
test('pool total is checked including stopped roots, allows partial allocation and decimal totals, and fails closed on invalid stored totals',()=>{
 for(const values of [[5,5],[33.33,33.33,33.34],[0.1,99.9]])assert.equal(unallocatedPercentError(values.map((p,i)=>pool(String(i),p))),'');
 const bots=[fixed,pool('a',60),pool('b',60,{runtime:{runEnabled:false}})];assert.match(unallocatedPercentError(bots),/120%.*100%/);const rows=resolveBudgets(bots,1000);assert.equal(rows.get('a').limit,300);assert.equal(rows.get('b').limit,300);assert.equal(rows.get('a').target,360);assert.equal(unallocatedPercentError([fixed,pool('a',60),pool('b',60,{budgetIncluded:false})]),'');
});
test('unknown balances, exhausted wallet and stale context cannot invent a residual allocation',()=>{
 const a=pool('a',5);assert.equal(requestedBudget(a,1000,900),0);assert.equal(percentBudgetBasis(a,1000,900),null);assert.equal(resolveBudgets([a],Infinity).get('a').basis,null);assert.equal(resolveBudgets([a],Infinity).get('a').limit,0);assert.equal(resolveBudgets([fixed,a],300).get('a').limit,0);const view=withBudgetAllocation(a,[fixed,a],1000,900);assert.equal(requestedBudget(view,1000,900),30);assert.equal(percentBudgetBasis(view),600);assert.equal(requestedBudget(view,800,900),0);assert.equal(effectiveBudget({...view,budgetPercent:10}),0);assert.equal(effectiveBudget(withBudgetAllocation({...view,budgetPercent:10},[fixed,a],800,900)),40);
});
test('single and multi settings, copies and per-leg allocations retain the new mode without copying live budgets',()=>{
 const b=makeBot(pool('a'));assert.deepEqual(budgetSettingsErrors(b),[]);assert.deepEqual(validateBot(b,[fixed],{balance:1000}),[]);assert.deepEqual(validateBot(makeBot(pool('new',60)),[fixed,pool('archived',100,{budgetIncluded:false})],{balance:1000}),[]);assert.ok(validateBot(makeBot(pool('b',70)),[makeBot(pool('a',50))],{balance:1000}).some(x=>x.includes('100%')));
 for(const p of [makeBot(pool('a')),makeMultiBot(pool('m'))]){for(const copy of [copyBotSettings(p),resetBotSettings(p)]){assert.equal(copy.budgetType,'unallocatedPercent');assert.equal(copy.budgetPercent,5);assert.equal(copy.budgetAllocation,undefined);}}
 const m=makeMultiBot(pool('m',10)),view=withBudgetAllocation(m,[fixed,m],1000,10);assert.equal(effectiveBudget(view),60);assert.deepEqual(multiAllocations(view).map(l=>l.budget),m.legs.map(l=>60*l.weight/100));assert.deepEqual(validateMulti(m,{symbols:m.legs.map(l=>l.symbol)}),[]);
});
test('both budget editors explain assigned versus actually committed balances and retain original options',()=>{
 const html=budgetFieldsMarkup(pool('a'));assert.match(html,/value="unallocatedPercent" selected/);assert.match(html,/공통 잔여 예산 중 운용 비율/);assert.match(html,/같은 공통 잔여 예산/);assert.match(html,/정지 봇/);assert.match(html,/data-unallocated-summary/);assert.match(html,/100% 이하/);assert.match(html,/value="availablePercent"/);assert.match(html,/data-bind="budgetMode" disabled/);assert.match(budgetFieldsMarkup(pool('m'),'data-pf-bind'),/data-pf-bind="budgetType"/);assert.match(percentBudgetDescription({budgetType:'availablePercent'}),/설정만 한 미사용 배정예산/);
});
test('server previews and saves validate the entire latest group even with wallet headroom',async()=>{
 const a=pool('a',60),b=pool('b',60),state={bots:[a]},engine={state,connected:true,accountSnapshot:{walletBalance:1000,availableBalance:1000},multi:{has:()=>false},budgetRoots(candidate){return [...state.bots.filter(x=>x.id!==candidate.id),candidate];},async refreshAccount(){},decorate(x){return x;},ownOrders:()=>[]};a.runtime={quantity:0};b.runtime={quantity:0};engine.walletSteps={preview:(candidate,old)=>({...candidate,runtime:old?.runtime})};const selection=new BudgetSelection(engine),r=await selection.preview({...b,budgetIncluded:true});assert.equal(r.allowed,false);assert.equal(r.code,'unallocatedPercentTotal');await assert.rejects(selection.assertSave(b,null),/120%/);assert.equal((await selection.preview({...b,budgetIncluded:false})).allowed,true);assert.equal((await selection.preview({...b,budgetPercent:40,budgetIncluded:true})).allowed,true);
});
test('editor keeps the invalid residual draft visible and prevents saving without silently archiving it',async()=>{
 const draft=pool('b',60,{budgetIncluded:true}),message={hidden:true,textContent:'',className:''},check={};const root={addEventListener(){},querySelector:selector=>selector.includes('included')?check:message};const editor=createBudgetEditor({root,getDraft:()=>draft,getState:()=>({capabilities:{budgetSelection:true}}),api:async()=>({allowed:false,code:'unallocatedPercentTotal',message:'비율 합계 120%',budgetAllocation:{basis:600,totalPercent:120}})});editor.reset();assert.equal(await editor.validate(),false);assert.equal(draft.budgetIncluded,true);assert.equal(draft.budgetPercent,60);assert.equal(message.textContent,'비율 합계 120%');assert.equal(message.hidden,false);
});
