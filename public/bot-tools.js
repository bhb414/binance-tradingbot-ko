import {budgetPolicyDescription} from './budget-policy.js';
import {makeBot} from './core.js';
import {makeMultiBot,multiRule} from './multi-bot.js';
import {makeActionRule,upgradeActions} from './actions.js';
import {randomId} from './id.js';
import {BUDGET_MODES} from './budget.js';
export const SINGLE_CONFIG_FIELDS=['id','name','symbol','budget','budgetMode','budgetType','budgetPercent','budgetShortfall','budgetFloor','budgetLossCarry','budgetRecovery','profitReinvestPercent','budgetIncluded','entryPercent','maxEntries','leverage','margin','color','conditionMode','formula','formulaTimeframe','formulaCandle','rules','order','reentry','exit','actionRules'];
const multiFields=['id','kind','name','budget','budgetMode','budgetType','budgetPercent','budgetShortfall','budgetFloor','budgetLossCarry','budgetRecovery','profitReinvestPercent','budgetIncluded','maxEntries','margin','color','legs','exit','actionRules'];
const pick=b=>Object.fromEntries((b.kind==='multi'?multiFields:SINGLE_CONFIG_FIELDS).filter(k=>b[k]!==undefined).map(k=>[k,structuredClone(b[k])]));
export function copyBotSettings(source){
 const b=pick(source);b.id=randomId();b.budgetIncluded=false;b.name=source.name.slice(0,source.kind==='multi'?25:27)+' 복사본';
 if(b.kind!=='multi')Object.assign(b,upgradeActions(b));
 for(const r of b.actionRules||[])r.id=randomId();
 const renew=node=>{if(!node||typeof node!=='object')return;if(node.id)node.id=randomId();node.children?.forEach(renew);};renew(b.rules);return b;
}
export function resetBotSettings(source){
 const keep=Object.fromEntries(['id','name','symbol','budget','budgetMode','budgetType','budgetPercent','budgetShortfall','budgetFloor','budgetLossCarry','budgetRecovery','profitReinvestPercent','budgetIncluded','color','legs'].filter(k=>source[k]!==undefined).map(k=>[k,structuredClone(source[k])]));
 if(source.kind==='multi')return makeMultiBot({...keep,actionRules:[multiRule(keep.legs)]});
 const b=makeBot({...keep,actionRules:[makeActionRule({formula:'FALSE@15m'})]});b.exit={...b.exit,takeProfitEnabled:false,stopLossEnabled:false};return pick(b);
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function budgetBaselineReview(p){
 const amount=n=>Number(n).toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2});
 return '<h3>예산 손익 기준 재설정</h3><p>저장된 예산 <b>'+amount(p.base)+' USDT</b> · '+esc(BUDGET_MODES[p.mode])+(p.mode==='floor'?' · 최소 '+amount(p.budgetFloor)+' USDT':'')+'<br>'+esc(budgetPolicyDescription(p))+'</p><div class="budget-baseline-amount"><span>현재 한도<br><b>'+amount(p.before)+'</b></span><span>→</span><span>재설정 후<br><b>'+amount(p.after)+' USDT</b></span></div><p>예산에 반영할 손익 <b>'+amount(p.budgetPnl)+' → 0 USDT</b></p><p>매매 기록·통계·보유 수량과 운용 방식은 유지합니다. 지금까지 확정된 손익을 예산 계산에서 제외하고 이후 확정손익부터 반영합니다. 미실현손익·펀딩은 예산 계산에 포함하지 않습니다.</p><p>보유 포지션은 정리 시 확정되는 매매이익·손실부터 위 반영 비율을 적용합니다.</p>'+(p.warnings||[]).map(w=>'<p class="budget-overflow-note">'+esc(w)+'</p>').join('')+(!p.allowed?'<p class="form-errors">'+esc(p.reason)+'</p>':'<p>미리보기는 60초 동안 유효합니다. 적용할 기준을 확인해 주세요.</p>');
}
export function installBotTools({api,getState,refresh,toast,onCopy,onSettingsReset,onBudgetMoved,onBudgetBaselineReset}){
 const dialog=document.createElement('dialog');dialog.id='bot-tools-dialog';dialog.className='small-dialog bot-tools-dialog';dialog.setAttribute('aria-labelledby','bot-tools-title');document.body.append(dialog);let id=null,busy=false,confirmAction=null,plan=null;
 const actual=()=>getState()?.bots.find(b=>b.id===id);
 function render(){const b=actual();if(!b){dialog.close();return;}confirmAction=null;plan=null;const members=b.kind==='multi'?b.members||[]:[b],ids=new Set(members.map(m=>m.id)),blocked=!!b.runtime?.runEnabled||members.some(m=>m.quantity>0||m.runtime?.syncHold)||(getState()?.orders||[]).some(o=>ids.has(o.botId));
 dialog.innerHTML='<div class="dialog-heading"><div><span class="eyebrow">BOT TOOLS</span><h2 id="bot-tools-title">'+esc(b.name)+'</h2></div><button type="button" class="icon-button" data-tools-close aria-label="봇 도구 닫기">×</button></div><p id="bot-tools-error" class="form-errors" role="alert" tabindex="-1" hidden></p><div class="bot-tools-options"><button type="button" data-tool="budget" data-budget-target="'+(b.budgetIncluded===false?'true':'false')+'" '+(!getState()?.capabilities?.budgetSelection?'disabled':'')+'><strong>'+(b.budgetIncluded===false?'운용으로 이동':'보관으로 이동')+'</strong><small>'+(b.budgetIncluded===false?'운용예산에 포함합니다. 이동 후 시작 버튼을 눌러야 매매합니다.':'운용예산 합계에서 제외합니다. 보유 포지션·미해결 주문이 있으면 이동할 수 없습니다.')+'</small></button><button type="button" data-tool="budget-baseline" '+(!getState()?.capabilities?.budgetBaselineReset?'disabled':'')+'><strong>예산 손익 기준 재설정</strong><small>매매 기록·통계는 유지합니다. 과거 확정손익은 예산 계산에서 빼고 이후 손익부터 반영합니다. 적용 전 한도를 확인합니다.</small></button><button type="button" data-tool="copy"><strong>봇 복사</strong><small>설정·종목·비중·외형을 복사합니다. 저장 전 수정할 수 있고, 포지션과 기록은 가져오지 않습니다.</small></button><button type="button" data-tool="settings" '+(blocked?'disabled':'')+'><strong>설정 초기화</strong><small>이름·종목·비중·예산·외형은 유지하고 조건·주문·보호 설정을 기본값으로 바꿉니다. 설정 저장 시 적용됩니다.</small></button><button type="button" data-tool="statistics" '+(blocked||!getState()?.capabilities?.botStatisticsReset?'disabled':'')+'><strong>기록·통계 초기화</strong><small>현재 시점부터 기록·손익·그래프를 새로 집계합니다. 실제 운용한도와 체결 원장은 유지됩니다.</small></button></div><p class="bot-tools-note">'+(blocked?'설정·기록 초기화는 봇을 정지하고 보유 포지션·미체결 주문을 정리한 뒤 사용할 수 있습니다. 예산 손익 기준은 보유 중에도 별도로 재설정할 수 있습니다.':'기록·통계 초기화와 예산 손익 기준 재설정은 별도 기능입니다.')+'</p><div id="bot-tools-confirm" hidden></div><div class="confirm-actions"><button type="button" class="button secondary" data-tools-back hidden>뒤로</button><button type="button" class="button secondary" data-tools-close>닫기</button><button type="button" class="button primary" data-tool-confirm hidden>기록·통계 초기화</button></div>';}
 function review(action,html,allowed=true){confirmAction=action;dialog.querySelector('.bot-tools-options').hidden=true;dialog.querySelector('.bot-tools-note').hidden=true;const content=dialog.querySelector('#bot-tools-confirm');content.innerHTML=html;content.hidden=false;const button=dialog.querySelector('[data-tool-confirm]');button.hidden=!allowed;button.textContent=action==='budget-baseline'?'예산 기준 재설정':'기록·통계 초기화';dialog.querySelector('[data-tools-back]').hidden=false;}
 function error(e){const el=dialog.querySelector('#bot-tools-error');el.textContent=e.message;el.hidden=false;el.scrollIntoView({block:'nearest'});el.focus({preventScroll:true});toast(e.message,true);}
 dialog.addEventListener('click',async event=>{
  event.stopPropagation();const button=event.target.closest('button');if(!button||busy)return;
  if(button.hasAttribute('data-tools-close')){dialog.close();return;}
  if(button.hasAttribute('data-tools-back')){render();return;}
  const b=actual();if(!b)return;dialog.querySelector('#bot-tools-error').hidden=true;
  if(button.dataset.tool==='budget'){busy=true;button.disabled=true;const included=button.dataset.budgetTarget==='true';try{await api('/bots/'+encodeURIComponent(id)+'/budget',{method:'POST',body:{included}});await refresh();onBudgetMoved?.(included,id);dialog.close();toast(included?'운용으로 이동했습니다. 시작은 별도로 눌러 주세요.':'보관으로 이동했습니다. 운용예산에 포함하지 않습니다.');}catch(e){error(e);}finally{busy=false;button.disabled=false;}return;}
  if(button.dataset.tool==='copy'){dialog.close();onCopy(b);return;}
  if(button.dataset.tool==='settings'){dialog.close();onSettingsReset(b);toast('기본값을 불러왔습니다. 설정 저장을 누르면 적용됩니다.');return;}
  if(button.dataset.tool==='statistics'){review('statistics','이 봇의 기록·통계를 지금부터 새로 집계할까요? 이전 원장은 보존됩니다.');return;}
  if(button.dataset.tool==='budget-baseline'){busy=true;button.disabled=true;try{plan=await api('/bots/'+encodeURIComponent(id)+'/budget-baseline/preview',{method:'POST'});review('budget-baseline',budgetBaselineReview(plan),plan.allowed);}catch(e){error(e);}finally{busy=false;button.disabled=false;}return;}
  if(button.hasAttribute('data-tool-confirm')){busy=true;button.disabled=true;const label=button.textContent,baseline=confirmAction==='budget-baseline',message=baseline?'예산에 반영할 손익 기준을 재설정했습니다. 매매 기록·통계는 유지됩니다.':'이 시점부터 기록·통계를 새로 집계합니다.';button.textContent='적용 중…';dialog.setAttribute('aria-busy','true');let result;
   try{result=await api('/bots/'+encodeURIComponent(id)+(baseline?'/budget-baseline':'/reset-statistics'),{method:'POST',...(baseline?{body:{previewId:plan.previewId}}:{})});}catch(e){error(e);return;}finally{busy=false;button.disabled=false;button.textContent=label;dialog.removeAttribute('aria-busy');}
   dialog.close();toast(message);
   try{await refresh();if(baseline)onBudgetBaselineReset?.(result);}catch(e){toast('재설정은 적용됐습니다. 화면 갱신을 완료하지 못해 새로고침이 필요합니다. '+e.message,true);}
  }
 });
 return {open(botId){id=botId;render();if(actual())dialog.showModal();}};
}
