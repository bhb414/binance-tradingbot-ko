import {budgetIncluded} from './budget.js';
export function budgetSelectionMarkup(bot){return '<div class="budget-selection"><label><input type="checkbox" data-budget-included '+(budgetIncluded(bot)?'checked':'')+'>운용예산에 포함</label><small>체크 해제 시 보관합니다. 보관한 봇은 예산 합계에서 제외되며 시작할 수 없습니다.</small><p data-budget-message role="status" hidden></p></div>';}
export function createBudgetEditor({root,api,getDraft,getState,onUpdate}){
 let version=0,approved=null,message='',pending=false,timer=null;
 const snapshot=()=>{const d=getDraft();return {budget:d.budget,budgetMode:d.budgetMode||'fixed',budgetIncluded:budgetIncluded(d)};};
 function paint(){const d=getDraft();if(!d)return;const check=root.querySelector('[data-budget-included]'),note=root.querySelector('[data-budget-message]');if(check){check.checked=budgetIncluded(d);check.disabled=!getState()?.capabilities?.budgetSelection;}if(note){note.hidden=!message;note.textContent=message;note.className=pending?'muted':'budget-selection-note';}}
 async function validate(path='budget'){
  clearTimeout(timer);const d=getDraft();if(!d||!Number.isFinite(d.budget)||d.budget<10)return false;const request=++version,values=snapshot(),id=d.id;
  if(!getState()?.capabilities?.budgetSelection){message='서버 갱신 후 운용·보관을 선택해 주세요.';paint();return false;}
  pending=true;message='계좌 잔고와 배정 한도 확인 중…';paint();
  try{const result=await api('/budget/preview',{method:'POST',body:{id,...values}});if(request!==version||getDraft()!==d)return false;
   pending=false;if(result.allowed){approved=snapshot();message=budgetIncluded(d)?'운용예산에 포함 · 저장 후 시작 버튼으로 매매를 시작합니다.':'보관 · 운용예산에 포함하지 않습니다.';}
   else{message=result.message;if(path==='budgetIncluded'){d.budgetIncluded=approved?.budgetIncluded??false;}else if(result.canExclude){d.budgetIncluded=false;message+=' 보관으로 저장할 수 있도록 예산 포함을 해제했습니다.';approved=snapshot();}else if(approved){Object.assign(d,approved);message+=' 마지막으로 확인된 예산을 유지합니다.';}}
   paint();onUpdate?.();return true;
  }catch(error){if(request!==version||getDraft()!==d)return false;pending=false;message=error.message;if(approved)Object.assign(d,approved);paint();onUpdate?.();return false;}
 }
 return {reset(){version++;clearTimeout(timer);approved=snapshot();message='';pending=false;paint();},paint,changed(path){if(path==='budgetIncluded')return validate(path);version++;clearTimeout(timer);timer=setTimeout(()=>validate(path),300);},validate};
}
