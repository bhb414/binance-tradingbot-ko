import {positionMargin,BUDGET_MODES} from './core.js';
import {BUDGET_OPTIONS} from './budget.js';
import {protectionSummary} from './protection.js';
import {roomAvatar} from './room.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:8});
export function installPositionImportUI({api,getState,refresh,onImported,connectionSettings,notify}){
  const $=selector=>document.querySelector(selector),dialog=$('#position-import-dialog'),body=$('#position-import-body'),error=$('#position-import-error'),submit=$('#position-import-submit');
  let context=null,plan=null,busy=false,requestedKey=null,requestedBotId=null,destination='existing',selection=null;
  const selectedPosition=()=>context?.positions.find(position=>position.key===$('#import-position')?.value);
  function setError(message){error.textContent=message;error.hidden=!message;}
  function unavailable(bot,position){
    if(bot.symbol!==position.symbol)return '담당 종목이 다름 · '+bot.symbol;
    if(position.owner&&position.owner.id!==bot.id)return '다른 봇이 이미 맡은 포지션';
    const state=getState(),stored=state?.bots?.find(item=>item.id===bot.id);
    if(stored?.quantity>0&&stored.positionDirection&&stored.positionDirection!==position.direction)return '가져온 포지션 방향이 다름';
    if(bot.eligible)return '';
    if(state?.orders?.some(order=>order.botId===bot.id))return '미해결 주문 있음';
    if(stored?.runtime?.runEnabled)return '먼저 봇 신규 진입을 정지하세요';
    if(!position.shared&&stored?.quantity>0&&!stored.runtime?.importPending)return '이미 보유 포지션을 관리 중';
    return '현재 연결할 수 없는 상태';
  }
  function showDestination(){
    $('#import-new-fields').hidden=destination!=='new';$('#import-existing-fields').hidden=destination!=='existing';
    for(const button of body.querySelectorAll('[data-import-mode]')){const active=button.dataset.importMode===destination;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);}
    const position=selectedPosition(),target=context.bots.find(bot=>bot.id===$('#import-target').value),reason=target&&position?unavailable(target,position):'연결할 기존 봇이 없습니다.';
    $('#import-target-note').textContent=reason||target.name+' · '+target.symbol+' · 운용예산 '+fmt(target.budget)+' USDT. 저장된 조건·예산·보호 주문 설정을 유지합니다. 편집창의 미저장 변경은 포함하지 않습니다.';
    submit.disabled=busy||destination==='existing'&&(!target||Boolean(reason));
  }
  function targets(preferred=null){
    const position=selectedPosition(),select=$('#import-target');if(!position||!select)return;
    const previous=select.value,choices=context.bots.map(bot=>({bot,reason:unavailable(bot,position)})).sort((a,b)=>Number(Boolean(a.reason))-Number(Boolean(b.reason))||Number(b.bot.symbol===position.symbol)-Number(a.bot.symbol===position.symbol));
    select.innerHTML=choices.length?choices.map(({bot,reason})=>'<option value="'+esc(bot.id)+'" '+(reason?'disabled':'')+'>'+esc(bot.name)+' · '+esc(bot.symbol)+(reason?' — '+esc(reason):' · '+fmt(bot.budget)+' USDT')+'</option>').join(''):'<option value="" disabled selected>기존 봇이 없습니다</option>';
    const requested=preferred||requestedBotId||(position.owner?.pending?position.owner.id:null),valid=id=>choices.some(choice=>choice.bot.id===id&&!choice.reason);
    if(requested&&choices.some(choice=>choice.bot.id===requested))select.value=requested;
    else if(valid(previous))select.value=previous;
    else if(choices.some(choice=>!choice.reason))select.value=choices.find(choice=>!choice.reason).bot.id;
    $('#import-name').value=position.symbol.replace(/USDT$/,'')+' 관리';$('#import-budget').value=Math.max(10,Math.ceil(positionMargin(position,3,position.isolatedMargin>0?'ISOLATED':'CROSSED')));
    showDestination();
  }
  function render(){
    plan=null;submit.textContent='확인 내용 보기';setError('');
    const preferred=context.bots.find(bot=>bot.id===requestedBotId),available=context.positions.filter(position=>position.supported&&(!position.owner||position.owner.pending)),positions=preferred?available.filter(position=>position.symbol===preferred.symbol):available;
    if(!positions.length){
      body.innerHTML='<p class="position-import-empty">'+(preferred?esc(preferred.symbol)+'에서 이 봇에 연결할 수동 포지션이 없습니다. 같은 종목의 계좌 포지션이 있어야 합니다.':'가져올 수동 포지션이 없습니다. 계좌의 USDT 선물 포지션 중 다른 봇이 관리하지 않는 포지션을 가져올 수 있습니다.')+'</p>'+(preferred?'<button type="button" class="button secondary" id="import-show-all">전체 수동 포지션 보기</button>':'');submit.hidden=true;
      $('#import-show-all')?.addEventListener('click',()=>{requestedBotId=null;selection=null;render();});return;
    }
    submit.hidden=false;destination=selection?.destination||(context.bots.length?'existing':'new');
    body.innerHTML='<p class="import-intro">현재 수량과 평균 진입가를 그대로 가져옵니다. 연결한 뒤에는 <b>관리 시작 대기</b> 상태이며, 설정을 확인한 뒤 봇을 시작하세요.</p><div class="form-grid"><label class="field full">가져올 포지션<select id="import-position" aria-label="가져올 포지션">'+positions.map(position=>'<option value="'+esc(position.key)+'">'+esc(position.symbol)+' · '+(position.direction==='LONG'?'롱':'숏')+' · '+fmt(position.quantity)+(position.owner?' · 가져온 정보 갱신':'')+'</option>').join('')+'</select></label><div class="import-mode-tabs full" role="group" aria-label="포지션을 맡기는 방법"><button type="button" data-import-mode="existing">기존 봇에 맡기기</button><button type="button" data-import-mode="new">새 관리 봇 만들기</button></div><div class="import-existing-fields full" id="import-existing-fields"><label class="field">담당할 기존 봇<select id="import-target" aria-label="담당할 기존 봇"></select></label><p class="import-target-note" id="import-target-note"></p><p class="import-target-help">같은 종목의 정지 봇 또는 관리 시작 대기 봇에 연결합니다. 공유 계좌의 수동 보유분은 이미 보유 중인 같은 방향 봇에도 추가할 수 있습니다. 선택할 수 없는 봇은 목록에 이유를 표시합니다.</p></div><div class="import-new-fields form-grid full" id="import-new-fields"><label class="field full">손익에 따른 예산 운용<select id="import-budget-mode" aria-label="가져올 봇의 예산 방식">'+BUDGET_OPTIONS.map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('')+'</select></label><label class="field">봇 이름<input id="import-name" aria-label="가져올 포지션의 새 봇 이름" maxlength="32"></label><div class="editor-wallet-summary full"><span>선물지갑 잔고 <strong>'+fmt(getState()?.account?.walletBalance)+' USDT</strong></span><span>현재 주문 가능 <strong>'+fmt(getState()?.account?.availableBalance)+' USDT</strong></span></div><label class="field">이 봇의 운용예산 · 증거금 한도<span class="input-unit"><input id="import-budget" aria-label="가져올 포지션의 운용예산" type="number" min="10" step="any"><span>USDT</span></span></label></div></div><p class="import-footnote">포지션 전체 방향 수량을 연결합니다. 가져오기 자체는 매수·매도·추가 증거금 이체를 하지 않습니다. 기존 거래소 주문도 그대로 유지합니다.</p>';
    const key=selection?.key||requestedKey;if(key&&positions.some(position=>position.key===key))$('#import-position').value=key;
    targets(selection?.target);
    if(selection){$('#import-name').value=selection.name;$('#import-budget').value=selection.budget;$('#import-budget-mode').value=selection.budgetMode;}
    $('#import-position').addEventListener('change',()=>targets());$('#import-target').addEventListener('change',showDestination);
    for(const button of body.querySelectorAll('[data-import-mode]'))button.addEventListener('click',()=>{destination=button.dataset.importMode;showDestination();setError('');});
  }
  function renderPlan(){
    submit.textContent=plan.newBot?'새 봇에 포지션 가져오기':'기존 봇에 포지션 연결';submit.disabled=false;const bot=plan.bot;
    body.innerHTML='<p class="import-plan-destination">'+(plan.newBot?'새 관리 봇 만들기':'기존 봇에 연결 · 저장된 조건과 예산 유지')+'</p><div class="import-plan-person"><svg viewBox="-48 -48 96 96" aria-hidden="true">'+roomAvatar({...bot,color:'mint'})+'</svg><div><strong>'+esc(bot.name)+'</strong><span>'+esc(bot.symbol)+' · '+(plan.direction==='LONG'?'롱':'숏')+' · '+(plan.environment==='live'?'실전':'테스트넷')+'</span></div></div><dl class="import-facts"><div><dt>가져올 수량</dt><dd>'+fmt(plan.quantity)+'</dd></div><div><dt>평균 진입가</dt><dd>'+fmt(plan.entryPrice)+'</dd></div><div><dt>보유 포지션 증거금 · 현재 추정</dt><dd>'+fmt(plan.estimatedMargin)+' USDT</dd></div><div><dt>기준 예산 · '+BUDGET_MODES[bot.budgetMode]+'</dt><dd>'+fmt(bot.budget)+' USDT</dd></div><div><dt>현재 운용한도</dt><dd>'+fmt(bot.effectiveBudget)+' USDT</dd></div><div><dt>현재 증거금 모드 · 레버리지</dt><dd>'+(bot.margin==='ISOLATED'?'격리':'크로스')+' · '+bot.leverage+'×</dd></div><div><dt>봇 보호 주문 설정</dt><dd>'+esc(protectionSummary(bot.exit))+'</dd></div></dl>'+plan.warnings.map(warning=>'<p class="import-warning">'+esc(warning)+'</p>').join('')+'<p class="import-footnote">연결하면 관리 시작 대기로 저장됩니다. 가져오기만으로 주문을 등록·취소하지 않습니다. 인수 전 실현손익·수수료는 봇 실현손익에 포함하지 않습니다.</p><button type="button" class="button secondary" id="import-back">선택 다시 하기</button>';
    $('#import-back').addEventListener('click',render);
  }
  async function open(key=null,botId=null){
    requestedKey=key;requestedBotId=botId;selection=null;context=null;plan=null;busy=false;setError('');submit.hidden=true;submit.disabled=false;body.innerHTML='<p class="position-import-empty">계좌 포지션을 조회하는 중…</p>';dialog.showModal();
    if(!getState()?.connected){body.innerHTML='<p class="position-import-empty">계좌를 연결하면 현재 보유 포지션을 조회해 봇에 맡길 수 있습니다.</p><button type="button" class="button secondary" id="import-connect">연결 설정 열기</button>';$('#import-connect').addEventListener('click',()=>{dialog.close();connectionSettings();});return;}
    try{context=await api('/position-import/context');if(dialog.open)render();}catch(reason){body.innerHTML='';setError(reason.message);}
  }
  $('#position-import-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||submit.disabled)return;busy=true;submit.disabled=true;setError('');
    try{
      if(!plan){
        const position=selectedPosition(),target=$('#import-target').value;
        if(destination==='existing'){const bot=context.bots.find(bot=>bot.id===target);if(!bot||unavailable(bot,position))throw new Error('연결 가능한 기존 봇을 선택해 주세요.');}
        selection={key:$('#import-position').value,target,destination,name:$('#import-name').value,budget:$('#import-budget').value,budgetMode:$('#import-budget-mode').value};
        const input={positionKey:selection.key,botId:destination==='existing'?target:null};
        if(destination==='new')Object.assign(input,{name:selection.name,budget:Number(selection.budget),budgetMode:selection.budgetMode});
        plan=await api('/position-import/preview',{method:'POST',body:input});renderPlan();
      }else{const result=await api('/position-import/commit',{method:'POST',body:{previewId:plan.id}});await refresh();dialog.close();notify('포지션을 연결했습니다. 관리 시작 전 조건과 보호 주문을 확인하세요.');onImported(result.bot.id);}
    }catch(reason){setError(reason.message);}finally{busy=false;if(plan)submit.disabled=false;else if($('#import-position'))showDestination();}
  });
  return {open};
}
