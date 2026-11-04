import {makeBot} from './core.js';
import {makeMultiBot,multiRule} from './multi-bot.js';
import {makeActionRule,upgradeActions} from './actions.js';
import {randomId} from './id.js';
export const SINGLE_CONFIG_FIELDS=['id','name','symbol','budget','budgetMode','budgetIncluded','entryPercent','maxEntries','leverage','margin','color','conditionMode','formula','formulaTimeframe','formulaCandle','rules','order','reentry','exit','actionRules'];
const multiFields=['id','kind','name','budget','budgetMode','budgetIncluded','maxEntries','margin','color','legs','exit','actionRules'];
const pick=b=>Object.fromEntries((b.kind==='multi'?multiFields:SINGLE_CONFIG_FIELDS).filter(k=>b[k]!==undefined).map(k=>[k,structuredClone(b[k])]));
export function copyBotSettings(source){
 const b=pick(source);b.id=randomId();b.budgetIncluded=false;b.name=source.name.slice(0,source.kind==='multi'?25:27)+' 복사본';
 if(b.kind!=='multi')Object.assign(b,upgradeActions(b));
 for(const r of b.actionRules||[])r.id=randomId();
 const renew=node=>{if(!node||typeof node!=='object')return;if(node.id)node.id=randomId();node.children?.forEach(renew);};renew(b.rules);return b;
}
export function resetBotSettings(source){
 const keep=Object.fromEntries(['id','name','symbol','budget','budgetMode','budgetIncluded','color','legs'].filter(k=>source[k]!==undefined).map(k=>[k,structuredClone(source[k])]));
 if(source.kind==='multi')return makeMultiBot({...keep,actionRules:[multiRule(keep.legs)]});
 const b=makeBot({...keep,actionRules:[makeActionRule({formula:'FALSE@15m'})]});b.exit={...b.exit,takeProfitEnabled:false,stopLossEnabled:false};return pick(b);
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function installBotTools({api,getState,refresh,toast,onCopy,onSettingsReset,onBudgetMoved}){
 const dialog=document.createElement('dialog');dialog.id='bot-tools-dialog';dialog.className='small-dialog bot-tools-dialog';dialog.setAttribute('aria-labelledby','bot-tools-title');document.body.append(dialog);let id=null,busy=false;
 const actual=()=>getState()?.bots.find(b=>b.id===id);
 function render(){const b=actual();if(!b){dialog.close();return;}const members=b.kind==='multi'?b.members||[]:[b],ids=new Set(members.map(m=>m.id)),blocked=!!b.runtime?.runEnabled||members.some(m=>m.quantity>0||m.runtime?.syncHold)||(getState()?.orders||[]).some(o=>ids.has(o.botId));
 dialog.innerHTML='<div class="dialog-heading"><div><span class="eyebrow">BOT TOOLS</span><h2 id="bot-tools-title">'+esc(b.name)+'</h2></div><button type="button" class="icon-button" data-tools-close aria-label="봇 도구 닫기">×</button></div><div class="bot-tools-options"><button type="button" data-tool="budget" data-budget-target="'+(b.budgetIncluded===false?'true':'false')+'" '+(!getState()?.capabilities?.budgetSelection?'disabled':'')+'><strong>'+(b.budgetIncluded===false?'운용으로 이동':'보관으로 이동')+'</strong><small>'+(b.budgetIncluded===false?'운용예산에 포함합니다. 이동 후 시작 버튼을 눌러야 매매합니다.':'운용예산 합계에서 제외합니다. 보유 포지션·미해결 주문이 있으면 이동할 수 없습니다.')+'</small></button><button type="button" data-tool="copy"><strong>봇 복사</strong><small>설정·종목·비중·외형을 복사합니다. 저장 전 수정할 수 있고, 포지션과 기록은 가져오지 않습니다.</small></button><button type="button" data-tool="settings" '+(blocked?'disabled':'')+'><strong>설정 초기화</strong><small>이름·종목·비중·예산·외형은 유지하고 조건·주문·보호 설정을 기본값으로 바꿉니다. 설정 저장 시 적용됩니다.</small></button><button type="button" data-tool="statistics" '+(blocked||!getState()?.capabilities?.botStatisticsReset?'disabled':'')+'><strong>기록·통계 초기화</strong><small>현재 시점부터 기록·손익·그래프를 새로 집계합니다. 실제 운용한도와 체결 원장은 유지됩니다.</small></button></div><p class="bot-tools-note">'+(blocked?'초기화는 봇을 정지하고 보유 포지션·미체결 주문을 정리한 뒤 사용할 수 있습니다.':!getState()?.capabilities?.botStatisticsReset?'기록·통계 초기화는 서버 갱신 후 사용할 수 있습니다.':'기록·통계 초기화는 연결된 계좌의 보유·주문 상태를 다시 확인합니다.')+'</p><p id="bot-tools-confirm" hidden>이 봇의 기록·통계를 지금부터 새로 집계할까요? 이전 원장은 보존됩니다.</p><p id="bot-tools-error" class="form-errors" role="alert" hidden></p><div class="confirm-actions"><button type="button" class="button secondary" data-tools-close>닫기</button><button type="button" class="button primary" data-tool-confirm hidden>기록·통계 초기화</button></div>';}
 dialog.addEventListener('click',async event=>{event.stopPropagation();const button=event.target.closest('button');if(!button||busy)return;if(button.hasAttribute('data-tools-close')){dialog.close();return;}const b=actual();if(!b)return;
 if(button.dataset.tool==='budget'){busy=true;button.disabled=true;const included=button.dataset.budgetTarget==='true';try{await api('/bots/'+encodeURIComponent(id)+'/budget',{method:'POST',body:{included}});await refresh();onBudgetMoved?.(included,id);dialog.close();toast(included?'운용으로 이동했습니다. 시작은 별도로 눌러 주세요.':'보관으로 이동했습니다. 운용예산에 포함하지 않습니다.');}catch(e){const error=dialog.querySelector('#bot-tools-error');error.textContent=e.message;error.hidden=false;}finally{busy=false;button.disabled=false;}return;}
 if(button.dataset.tool==='copy'){dialog.close();onCopy(b);return;}
 if(button.dataset.tool==='settings'){dialog.close();onSettingsReset(b);toast('기본값을 불러왔습니다. 설정 저장을 누르면 적용됩니다.');return;}
 if(button.dataset.tool==='statistics'){dialog.querySelector('#bot-tools-confirm').hidden=false;dialog.querySelector('[data-tool-confirm]').hidden=false;return;}
 if(button.hasAttribute('data-tool-confirm')){busy=true;button.disabled=true;try{await api('/bots/'+encodeURIComponent(id)+'/reset-statistics',{method:'POST'});await refresh();dialog.close();toast('이 시점부터 기록·통계를 새로 집계합니다.');}catch(e){const error=dialog.querySelector('#bot-tools-error');error.textContent=e.message;error.hidden=false;}finally{busy=false;button.disabled=false;}}
 });
 return {open(botId){id=botId;render();if(actual())dialog.showModal();}};
}
