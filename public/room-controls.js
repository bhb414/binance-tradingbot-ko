import {roomAvatar} from './room.js';
import {BUDGET_MODES,effectiveBudget} from './budget.js';
import {protectionSummary} from './protection.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});
export function installRoomControls({scene,getBots,getState,selectBot,openSettings,connectionSettings,refresh,api,notify,icon}){
  const menu=document.querySelector('#room-character-menu'),dialog=document.querySelector('#room-action-dialog'),confirm=document.querySelector('#room-action-confirm'),error=document.querySelector('#room-action-error');
  let selected=null,pending=null,busy=false,hideTimer=null;
  const bot=()=>getBots().find(bot=>bot.id===(pending?.id||selected));
  function close(restoreFocus=false){
    clearTimeout(hideTimer);
    const previous=selected;selected=null;menu.hidden=true;scene.hold(null);
    for(const actor of scene.root.querySelectorAll('[data-select-map-bot]'))actor.setAttribute('aria-expanded','false');
    if(restoreFocus&&previous)scene.root.querySelector(`[data-select-map-bot="${CSS.escape(previous)}"]`)?.focus({preventScroll:true});
  }
  function menuState(){
    const current=getBots().find(bot=>bot.id===selected);if(!current){close();return;}
    menu.querySelector('.room-menu-name').textContent=current.name;
    const running=Boolean(current.runtime?.runEnabled),toggle=menu.querySelector('[data-room-toggle]');
    toggle.dataset.roomAction=running?'pause':'start';toggle.innerHTML=icon(running?'pause':'play');toggle.setAttribute('aria-label',running?'정지':'시작');toggle.title=running?'정지':'시작';
    const settings=menu.querySelector('[data-room-action="settings"]');settings.innerHTML=icon('settings');settings.setAttribute('aria-label','설정');settings.title='설정';
  }
  function open(id,{focus=true}={}){
    clearTimeout(hideTimer);if(selected===id&&!menu.hidden){if(focus)menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});return;}
    close();selected=id;scene.hold(id);selectBot(id);menu.hidden=false;menuState();
    const actor=scene.root.querySelector(`[data-select-map-bot="${CSS.escape(id)}"]`);if(!actor)return close();
    actor.setAttribute('aria-expanded','true');const anchor=(actor.querySelector('.actor-hit')||actor).getBoundingClientRect(),boundary=document.querySelector('#office-map-viewport').getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight;
    const right=Math.min(document.documentElement.clientWidth,boundary.right)-6,left=Math.max(6,boundary.left+6),scale=anchor.width/72,headTop=anchor.top+(actor.classList.contains('is-working')?38:28)*scale;
    menu.style.left=Math.max(left,Math.min(anchor.left+anchor.width/2-width/2,right-width))+'px';
    menu.style.top=Math.max(6,boundary.top+6,Math.min(headTop-height-8,Math.min(innerHeight,boundary.bottom)-height-6))+'px';
    if(focus)menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  function leave(){if(!selected)return;clearTimeout(hideTimer);hideTimer=setTimeout(()=>close(),350);}
  scene.root.addEventListener('pointerover',event=>{
    if(event.pointerType!=='mouse')return;const actor=event.target.closest?.('[data-select-map-bot]');if(!actor||actor.classList.contains('dimmed'))return;
    if(event.relatedTarget instanceof Node&&actor.contains(event.relatedTarget))return;open(actor.dataset.selectMapBot,{focus:false});
  });
  scene.root.addEventListener('pointerout',event=>{
    const actor=event.target.closest?.('[data-select-map-bot]');if(!actor)return;
    if(event.relatedTarget instanceof Node&&(actor.contains(event.relatedTarget)||menu.contains(event.relatedTarget)))return;leave();
  });
  menu.addEventListener('pointerenter',()=>clearTimeout(hideTimer));
  menu.addEventListener('pointerleave',event=>{const actor=scene.root.querySelector(`[data-select-map-bot="${CSS.escape(selected||'')}"]`);if(event.relatedTarget instanceof Node&&actor?.contains(event.relatedTarget))return;leave();});
  function action(kind,id){
    close();if(kind==='settings'){openSettings(id);return;}
    const current=getBots().find(bot=>bot.id===id);if(!current)return;
    pending={kind,id};error.hidden=true;renderAction();dialog.showModal();
  }
  function renderAction(){
    if(!pending)return;const current=bot(),state=getState();if(!current){dialog.close();return;}
    const start=pending.kind==='start',needsConnection=start&&(!state?.connected||!state.tradingEnabled);
    document.querySelector('#room-action-title').textContent=start?'봇을 시작할까요?':'봇을 정지할까요?';
    document.querySelector('#room-action-body').innerHTML='<div class="room-action-person"><svg viewBox="-48 -48 96 96" aria-hidden="true">'+roomAvatar(current)+'</svg><div><strong>'+esc(current.name)+'</strong><span>'+esc(current.symbol)+' · '+(current.margin==='ISOLATED'?'격리':'크로스')+' · '+current.leverage+'×</span></div><b class="room-environment">'+(state?.environment==='live'?'실전':'테스트넷')+'</b></div><p class="room-action-description">'+(start?(current.runtime?.importPending?'가져온 포지션의 정리 조건·보호 주문 관리를 시작합니다. 설정에 따라 신규 진입도 실행됩니다.':'저장된 수식으로 조건 감시와 신규 진입을 시작합니다. 편집 중인 설정은 저장한 뒤 적용됩니다.'):'신규 진입을 중지하고 남은 진입 주문을 취소합니다. 보유 포지션의 정리 조건과 보호 주문은 계속 관리합니다.')+'</p><dl class="room-action-facts"><div><dt>현재 운용한도 · '+BUDGET_MODES[current.budgetMode||'fixed']+'</dt><dd>'+money(effectiveBudget(current))+' USDT</dd></div><div><dt>사용 중인 조건</dt><dd>'+current.actionRules.filter(rule=>rule.enabled).length+'개</dd></div><div><dt>현재 상태</dt><dd>'+(current.runtime?.runEnabled?'신규 진입 허용':'신규 진입 정지')+'</dd></div></dl>'+(start?'<p class="room-action-note">보호 주문: '+esc(protectionSummary(current.exit))+'. 시작 시 이미 충족된 조건은 바로 실행될 수 있습니다.</p>':'')+(current.budgetWarning?'<p class="room-action-note">'+esc(current.budgetWarning)+'</p>':'')+(needsConnection?'<p class="room-action-note">'+(!state?.connected?'계좌를 먼저 연결해야 합니다.':'연결 설정에서 주문 실행을 허용해야 합니다.')+'</p>':'');
    confirm.textContent=needsConnection?'연결 설정 열기':start?'시작':'정지';confirm.disabled=busy||!needsConnection&&(start?Boolean(current.runtime?.runEnabled):!current.runtime?.runEnabled);
  }
  menu.addEventListener('click',event=>{const button=event.target.closest('[data-room-action]');if(!button||button.disabled)return;event.stopPropagation();action(button.dataset.roomAction,selected);});
  menu.addEventListener('keydown',event=>{
    const items=[...menu.querySelectorAll('button:not(:disabled)')],index=items.indexOf(document.activeElement);
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length;items[next]?.focus();}
  });
  document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!event.target.closest('[data-select-map-bot]'))close();});
  document.querySelector('#office-map-viewport').addEventListener('scroll',()=>{if(!menu.hidden)close();},{passive:true});window.addEventListener('resize',()=>close());
  confirm.addEventListener('click',async()=>{
    if(!pending||busy)return;const current=bot(),state=getState();if(!current)return;
    if(pending.kind==='start'&&(!state?.connected||!state.tradingEnabled)){dialog.close();connectionSettings();return;}
    if(pending.kind==='start'&&current.runtime?.runEnabled||pending.kind==='pause'&&!current.runtime?.runEnabled){renderAction();return;}
    const {id,kind}=pending;busy=true;confirm.disabled=true;error.hidden=true;
    try{await api('/bots/'+encodeURIComponent(id)+(kind==='start'?'/start':'/pause'),{method:'POST'});await refresh();dialog.close();notify(kind==='start'?'조건 감시와 신규 진입을 시작했습니다.':'신규 진입을 정지했습니다.');}
    catch(reason){error.textContent=reason.message;error.hidden=false;}
    finally{busy=false;if(dialog.open)renderAction();}
  });
  dialog.addEventListener('close',()=>{pending=null;});
  return {open,close,action,sync(){if(selected)menuState();if(dialog.open&&!busy)renderAction();}};
}
