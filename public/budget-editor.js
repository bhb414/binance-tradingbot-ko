import {BUDGET_OPTIONS,BUDGET_TYPES,SHORTFALL_OPTIONS,budgetIncluded,budgetSettingsErrors} from './budget.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function budgetFieldsMarkup(bot,attribute='data-bind'){
 const percent=bot.budgetType==='walletPercent',select=(label,key,value,choices,disabled=false)=>'<label class="field"><span>'+label+'</span><select '+attribute+'="'+key+'" '+(disabled?'disabled':'')+'>'+choices.map(([v,t])=>'<option value="'+v+'" '+(v===value?'selected':'')+'>'+t+'</option>').join('')+'</select></label>',input=(label,key,value,unit,min,max,disabled=false)=>'<label class="field"><span>'+label+'</span><div class="input-unit"><input type="number" '+attribute+'="'+key+'" value="'+esc(value)+'" min="'+min+'" max="'+max+'" step="any" inputmode="decimal" '+(disabled?'disabled':'')+'><span>'+unit+'</span></div></label>';
 return select('예산 지정 방식','budgetType',bot.budgetType||'amount',BUDGET_TYPES)+(percent?input('선물 USDT 지갑 잔고 중 운용 비율','budgetPercent',bot.budgetPercent??25,'%',.01,100):input('목표 운용예산 · 증거금 한도','budget',bot.budget,'USDT',10,100000000))+select('예산 부족 시','budgetShortfall',bot.budgetShortfall||'strict',SHORTFALL_OPTIONS)+select('손익에 따른 예산 운용','budgetMode',bot.budgetMode||'fixed',BUDGET_OPTIONS,percent)+input('이익 중 예산에 더할 비율','profitReinvestPercent',bot.profitReinvestPercent??100,'%',0,100,percent)+'<p class="field full field-note">'+(percent?'매 주문 준비 시 최신 선물 USDT 지갑 잔고로 계산합니다. 미실현손익은 제외하며 지갑 잔고에 이미 손익이 반영되므로 봇 손익을 다시 더하지 않습니다.':'고정 한도와 손익 반영은 기존 방식입니다. 자동 축소를 선택하면 목표 예산보다 잔고가 적어도 가용한도 안에서 운용하고, 회복되면 목표까지 복구합니다.')+' 여러 자동 축소 봇은 기존 증거금을 우선 반영하고 남은 한도를 목표 예산에 비례해 배분합니다. 보유 포지션을 자동으로 줄이거나 늘리지 않습니다.</p>';
}
export function budgetSelectionMarkup(bot){return '<div class="budget-selection"><label><input type="checkbox" data-budget-included '+(budgetIncluded(bot)?'checked':'')+'>운용예산에 포함</label><small>체크 해제 시 보관합니다. 보관한 봇은 예산 합계에서 제외되며 시작할 수 없습니다.</small><p data-budget-message role="status" hidden></p></div>';}
export function createBudgetEditor({root,api,getDraft,getState,onUpdate}){
 let version=0,approved=null,message='',pending=false,timer=null;
 const snapshot=()=>{const d=getDraft();return {budget:d.budget,budgetMode:d.budgetMode||'fixed',budgetType:d.budgetType||'amount',budgetPercent:d.budgetPercent,budgetShortfall:d.budgetShortfall||'strict',budgetIncluded:budgetIncluded(d)};};
 function paint(){const d=getDraft();if(!d)return;const check=root.querySelector('[data-budget-included]'),note=root.querySelector('[data-budget-message]');if(check){check.checked=budgetIncluded(d);check.disabled=!getState()?.capabilities?.budgetSelection;}if(note){note.hidden=!message;note.textContent=message;note.className=pending?'muted':'budget-selection-note';}}
 async function validate(path='budget'){
  clearTimeout(timer);const d=getDraft();if(!d||budgetSettingsErrors(d).length)return false;const request=++version,values=snapshot(),id=d.id;
  if(!getState()?.capabilities?.budgetSelection){message='서버 갱신 후 운용·보관을 선택해 주세요.';paint();return false;}
  pending=true;message='계좌 잔고와 배정 한도 확인 중…';paint();
  try{const result=await api('/budget/preview',{method:'POST',body:{id,...values}});if(request!==version||getDraft()!==d)return false;
   pending=false;if(result.allowed){d.budgetAllocation=result.budgetAllocation;approved=snapshot();message=budgetIncluded(d)?'운용예산에 포함 · 현재 '+Number(result.effectiveBudget??result.requested).toLocaleString('ko-KR',{maximumFractionDigits:2})+' USDT'+(result.budgetAllocation?.reduced?' (가용 한도에 맞춰 축소)':'')+' · 저장 후 시작 버튼으로 매매를 시작합니다.':'보관 · 운용예산에 포함하지 않습니다.';}
   else{message=result.message;if(path==='budgetIncluded'){d.budgetIncluded=approved?.budgetIncluded??false;}else if(result.canExclude){d.budgetIncluded=false;message+=' 보관으로 저장할 수 있도록 예산 포함을 해제했습니다.';approved=snapshot();}else if(approved){Object.assign(d,approved);message+=' 마지막으로 확인된 예산을 유지합니다.';}}
   paint();onUpdate?.();return true;
  }catch(error){if(request!==version||getDraft()!==d)return false;pending=false;message=error.message;if(approved)Object.assign(d,approved);paint();onUpdate?.();return false;}
 }
 return {reset(){version++;clearTimeout(timer);approved=snapshot();message='';pending=false;paint();},paint,changed(path){if(path==='budgetIncluded')return validate(path);version++;clearTimeout(timer);timer=setTimeout(()=>validate(path),300);},validate};
}
