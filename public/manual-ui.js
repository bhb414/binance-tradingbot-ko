import {api} from './api.js';
import {manualMarkup} from './manual-markup.js';
import {orderDirection,orderEstimate,orderCapacity,previewSize} from './manual-sizing.js';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fmt=value=>value==null||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('en-US',{maximumFractionDigits:8});
const money=value=>value==null||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const balance=value=>value==null||!Number.isFinite(Number(value))?'—':money(Math.trunc(Number(value)*100)/100);
const statusName=status=>({NEW:'접수',PARTIALLY_FILLED:'부분 체결',FILLED:'체결 완료',CANCELED:'취소',REJECTED:'거절',UNKNOWN:'접수 확인 중',EXPIRED:'만료',EXPIRED_IN_MATCH:'만료'})[status]||status;
export function installManualUI({notify,refresh,settings}){
  const host=$('#manual-order-ticket');let state=null,instrument=null,quote=null,context=null,contextProblem='',contextKey='',contextAt=0,request=0,loading=false,busy=false,settingsDirty=false,confirmation=null,sending=false;
  host.classList.add('terminal-ticket');host.innerHTML=manualMarkup();
  const dialog=document.createElement('dialog');dialog.id='manual-order-confirm';dialog.className='small-dialog manual-confirm-dialog';dialog.setAttribute('aria-labelledby','manual-confirm-title');dialog.innerHTML='<div class="dialog-heading"><h2 id="manual-confirm-title">주문 확인</h2><button type="button" class="icon-button" data-manual-dismiss aria-label="주문 확인 닫기">×</button></div><div id="manual-confirm-content"></div><p id="manual-confirm-error" class="manual-error" role="alert" hidden></p><div class="manual-confirm-actions"><button type="button" class="button secondary" data-manual-dismiss>취소</button><button type="button" class="button primary" id="manual-confirm-submit">주문 전송</button></div>';document.body.append(dialog);
  let action='OPEN',type='LIMIT',side='BUY',pendingClose=false,ownerId='';
  const supported=()=>instrument?.market==='usdm'&&instrument.quoteAsset==='USDT'&&instrument.marginAsset==='USDT';
  function error(message){$('#manual-error').textContent=message;$('#manual-error').hidden=!message;}
function referencePrice(){return type==='LIMIT'?Number($('#manual-price').value):Number(side==='BUY'?context?.ask:context?.bid)||Number(quote?.ticker.lastPrice);}
function capacity(){return orderCapacity(context?.botId?{...context,availableBalance:Math.min(context.availableBalance,context.botBudget)}:context,{side,reduceOnly:action==='CLOSE',price:referencePrice(),leverage:Number($('#manual-leverage').value)});}
function updateEstimates(){
  const mode=$('#manual-size-mode').value,leverage=Number($('#manual-leverage').value),estimate=orderEstimate($('#manual-amount').value,mode,referencePrice(),leverage),cap=capacity();
  $('#manual-notional').textContent=estimate?money(estimate.notional)+' USDT':'—';$('#manual-margin-estimate').textContent=action==='CLOSE'?'정리 주문':estimate?money(estimate.margin)+' USDT':'—';
  $('#manual-size-unit').textContent=mode==='quantity'?instrument?.baseAsset||'—':'USDT';$('#manual-amount').placeholder=mode==='margin'?'초기 증거금':mode==='notional'?'주문 금액':'수량 입력';
  $('#manual-size-mode option[value="quantity"]').textContent='수량 · '+(instrument?.baseAsset||'—');
  $('#manual-max-label').textContent=action==='CLOSE'?'정리 가능 수량':'최대 주문금액';$('#manual-max').textContent=cap?(action==='CLOSE'?fmt(cap.quantity):money(cap.notional))+' '+(action==='CLOSE'?instrument.baseAsset:'USDT'):'—';
  const ratio=cap?.notional>0&&estimate?Math.max(0,Math.min(100,estimate.notional/cap.notional*100)):0,slider=$('#manual-percent-range');slider.value=Math.round(ratio);slider.style.setProperty('--percent',ratio+'%');slider.disabled=!cap||cap.quantity<=0||busy;
  for(const button of host.querySelectorAll('[data-manual-percent]'))button.disabled=slider.disabled;
}
function applyPercent(percent){
  const cap=capacity();if(!cap||cap.quantity<=0){error(action==='CLOSE'?'정리할 수량이 없습니다.':'계좌 가용 증거금과 주문 가격을 먼저 확인해 주세요.');return;}
  const mode=$('#manual-size-mode').value,value=(mode==='margin'?cap.margin:mode==='quantity'?cap.quantity:cap.notional)*Number(percent)/100;
  $('#manual-amount').value=Number(percent)===0?'':String(Number(value.toFixed(mode==='quantity'?8:4)));error('');updateEstimates();
}
function render(){
  const matching=(state?.positionOwners||state?.bots||[]).filter(b=>b.symbol===instrument?.symbol&&supported()),owner=matching.find(b=>b.id===ownerId);if(ownerId&&!owner)ownerId='';
  const ownerSelect=$('#manual-owner'),ownerOptions='<option value="">별도 주문 · 봇 외부</option>'+matching.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+' · 봇</option>').join('');
  if(ownerSelect.innerHTML!==ownerOptions)ownerSelect.innerHTML=ownerOptions;ownerSelect.value=ownerId;$('#manual-owner-field').hidden=!matching.length;
  $('#manual-owner-note').hidden=!matching.length;$('#manual-owner-note').textContent=owner?'체결·수량·손익이 이 봇에 반영됩니다. 정지 중에도 직접 주문할 수 있습니다.'+(context?.botBudget!=null?' 남은 봇 예산 '+money(context.botBudget)+' USDT.':''):'같은 종목·방향은 거래소에서 합쳐집니다. 봇 보유분을 조절하려면 해당 봇을 선택하세요.';
  const available=supported(),environment=state?.environment==='live'?'실전':'테스트넷',reason=!available?'이 상품은 조회만 지원합니다.':!state?.connected?'계좌를 연결하면 주문할 수 있습니다.':!state.tradingEnabled?'설정에서 주문 실행을 허용해 주세요.':loading?'계좌 주문 규격 조회 중…':contextProblem||context?.blockedReason||(context?'':'주문 규격을 불러오는 중…');
  host.dataset.side=side;$('#manual-symbol').textContent=instrument?.symbol||'—';$('#manual-environment').textContent=state?.connected?environment+' 계좌':'계좌 미연결';$('#manual-environment').classList.toggle('live',state?.connected&&state.environment==='live');$('#manual-position-mode').textContent=context?.connected?(context.hedge?'헤지 모드':'단방향 모드'):'';$('#ticket-account-mode').textContent=context?.connected?(context.hedge?'헤지':'단방향'):'—';
  $('#manual-availability').textContent=reason;$('#manual-availability').hidden=!reason;$('#manual-settings-link').hidden=!available||state?.connected&&state?.tradingEnabled;$('#manual-free').textContent=context?.availableBalance!=null?balance(context.availableBalance)+' USDT':'—';$('#manual-wallet').textContent=state?.account?.walletBalance!=null?balance(state.account.walletBalance)+' USDT':'—';
  const locked=Boolean(context?.connected&&context.settingsLocked);$('#manual-margin').disabled=locked||!!ownerId||!available;$('#manual-leverage').disabled=locked||!available;$('#manual-leverage').max=context?.maxLeverage||125;$('#manual-price-fields').hidden=type!=='LIMIT';$('#manual-time-in-force').hidden=type!=='LIMIT';$('#manual-size-mode option[value="margin"]').disabled=action==='CLOSE';
  const button=$('#manual-submit');button.disabled=!available||!state?.connected||!state?.tradingEnabled||!context?.connected||!!context?.blockedReason||loading||busy;
  button.textContent=busy?'주문 확인 중…':action==='OPEN'?(side==='BUY'?'매수 / 롱':'매도 / 숏'):(side==='BUY'?'매수 / 숏 정리':'매도 / 롱 정리');
  host.querySelectorAll('[data-manual-side]').forEach(item=>{const active=item.dataset.manualSide===side;item.classList.toggle('active',active);item.setAttribute('aria-pressed',active);});
  const positions=context?.positions||[];$('#manual-position-info').hidden=!positions.length&&action!=='CLOSE';$('#manual-position-info').innerHTML=positions.length?positions.map(p=>'<span>'+(p.quantity>0?'롱':'숏')+' '+fmt(Math.abs(p.quantity))+' '+esc(instrument.baseAsset)+'</span>').join(''):(action==='CLOSE'?'<span>정리할 포지션이 없습니다.</span>':'');
  const records=(state?.manualOrders||[]).filter(order=>order.symbol===instrument?.symbol).slice(0,5);$('#manual-recent-count').textContent=records.length+'건';$('#manual-recent-orders').innerHTML=records.length?records.map(order=>'<div class="manual-order-record"><div><strong>'+esc(statusName(order.status))+'</strong><small>'+esc(order.action==='CLOSE'?'정리':'진입')+' · '+esc(order.botName||'별도')+' · '+(order.direction==='LONG'?'롱':'숏')+' · '+esc(order.type==='LIMIT'?'지정가':'시장가')+'</small></div><div><span>'+fmt(order.executedQuantity)+' / '+esc(order.quantity)+'</span>'+(order.canCancel&&state?.connected&&state?.tradingEnabled?'<button type="button" data-manual-cancel="'+order.id+'">취소</button>':'')+'</div>'+(order.error?'<p>'+esc(order.error)+'</p>':'')+'</div>').join(''):'<p class="manual-empty">수동 주문 내역이 없습니다.</p>';updateEstimates();
}
  async function loadContext(force=false){
    if(!supported()||document.querySelector('#page-home')?.hidden)return;const key=[instrument.symbol,state?.environment,state?.connected,ownerId].join(':');if(loading||!force&&key===contextKey&&Date.now()-contextAt<15000)return;
    loading=true;contextKey=key;const version=++request,symbol=instrument.symbol;render();try{const result=await api('/manual/context?symbol='+encodeURIComponent(symbol)+(ownerId?'&botId='+encodeURIComponent(ownerId):''));if(version!==request||symbol!==instrument?.symbol)return;if(ownerId&&result.botId!==ownerId)throw new Error('봇 귀속 주문 기능을 적용하려면 서버를 갱신해야 합니다. 현재 주문은 전송하지 않습니다.');context=result;contextProblem='';contextAt=Date.now();if(!settingsDirty){$('#manual-margin').value=result.botId?((state.positionOwners||state.bots).find(b=>b.id===result.botId)?.margin||result.margin):result.margin||'ISOLATED';$('#manual-leverage').value=result.leverage||3;}if(pendingClose){const cap=capacity();$('#manual-amount').value=String(cap?.quantity||0);pendingClose=false;}if(!$('#manual-price').value&&result.bid)$('#manual-price').value=String(result.bid);error('');}catch(problem){if(version===request){context=null;contextProblem=problem.message;contextAt=Date.now();error(problem.message);}}finally{if(version===request){loading=false;render();}}
  }
  function setState(next){
    const changed=state?.connectionId!==next.state?.connectionId||instrument?.symbol!==next.instrument.symbol||instrument?.market!==next.instrument.market||state?.environment!==next.state?.environment||state?.connected!==next.state?.connected;instrument=next.instrument;state=next.state;quote=next.quote;
    if(changed){ownerId='';pendingClose=false;request++;loading=false;context=null;contextProblem='';contextAt=0;contextKey='';settingsDirty=false;$('#manual-amount').value='';$('#manual-price').value='';error('');}
    render();loadContext();
  }
  function showConfirmation(plan){
    confirmation={mode:'order',plan};$('#manual-confirm-title').textContent=(plan.environment==='live'?'실전':'테스트넷')+' 주문 확인';$('#manual-confirm-error').hidden=true;
    $('#manual-confirm-content').innerHTML='<div class="manual-confirm-symbol">'+esc(plan.symbol)+'<span>'+(plan.action==='CLOSE'?'정리':'진입')+' · '+(plan.direction==='LONG'?'롱':'숏')+'</span></div><dl>'+[['주문 방식',plan.type==='LIMIT'?'지정가 · '+plan.timeInForce:'시장가'],['수량',plan.quantity+' '+plan.baseAsset],['가격',plan.price?plan.price+' USDT':'시장가 · 예상 '+fmt(plan.referencePrice)+' USDT'],['주문 금액 · 예상',fmt(plan.notional)+' USDT'],['증거금 · 예상',fmt(plan.estimatedMargin)+' USDT'],['계좌 설정',(plan.margin==='ISOLATED'?'격리':'크로스')+' · '+plan.leverage+'× · '+(plan.positionMode==='HEDGE'?'헤지':'단방향')]].map(([key,value])=>'<div><dt>'+key+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl>'+(plan.changes.margin||plan.changes.leverage?'<p class="manual-confirm-note">이 종목의 증거금 모드·레버리지를 위 설정으로 적용한 뒤 주문합니다.</p>':'')+'<p class="manual-confirm-note">현재 수량·가격으로 60초 이내에 확인해 주세요. 시장가의 실제 체결 금액·수수료는 달라질 수 있습니다.</p>';
    $('#manual-confirm-content').insertAdjacentHTML('afterbegin','<p class="manual-owner-confirm">주문 귀속: <strong>'+esc(plan.botName||'별도 주문 · 봇 외부')+'</strong></p>'+(plan.botId?'<p class="manual-confirm-note">체결은 이 봇의 수량·손익·예산에 반영됩니다. 봇의 정리 조건·TP/SL 관리는 유지하며, 정리 주문은 기존 보호 주문 취소를 확인한 뒤 전송합니다.</p>':''));
    $('#manual-confirm-submit').textContent=plan.environment==='live'?'실전 주문 전송':'테스트넷 주문 전송';dialog.showModal();
  }
  host.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.id==='manual-settings-link')settings();
    if(button.dataset.manualSide){side=button.dataset.manualSide;error('');render();}
    if(button.id==='manual-bbo'&&context){$('#manual-price').value=String(side==='BUY'?context.ask:context.bid);updateEstimates();}
    if(button.dataset.manualPercent!==undefined)applyPercent(button.dataset.manualPercent);
    if(button.dataset.manualCancel){const order=state.manualOrders.find(item=>item.id===button.dataset.manualCancel);if(!order)return;confirmation={mode:'cancel',order};$('#manual-confirm-title').textContent=(order.environment==='live'?'실전':'테스트넷')+' 주문 취소';$('#manual-confirm-content').innerHTML='<p class="manual-cancel-summary">'+esc(order.symbol)+' · '+esc(order.quantity)+' · '+(order.direction==='LONG'?'롱':'숏')+' 주문의 미체결 잔량을 취소합니다.</p>';$('#manual-confirm-error').hidden=true;$('#manual-confirm-submit').textContent='미체결 잔량 취소';dialog.showModal();}
  });
  $('#manual-order-form').addEventListener('input',event=>{if(event.target.id==='manual-percent-range'){applyPercent(event.target.value);return;}if(['manual-margin','manual-leverage'].includes(event.target.id))settingsDirty=true;error('');updateEstimates();});
  $('#manual-size-mode').addEventListener('change',()=>{$('#manual-amount').value='';updateEstimates();});
  $('#manual-owner').addEventListener('change',event=>{ownerId=event.target.value;request++;loading=false;context=null;contextAt=0;settingsDirty=false;error('');render();loadContext(true);});
  $('#manual-type').addEventListener('change',event=>{type=event.target.value;error('');render();});
  $('#manual-reduce-only').addEventListener('change',event=>{action=event.target.checked?'CLOSE':'OPEN';$('#manual-amount').value='';if(action==='CLOSE'&&$('#manual-size-mode').value==='margin')$('#manual-size-mode').value='quantity';error('');render();});
  $('#manual-order-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;error('');render();try{const plan=await api('/manual/preview',{method:'POST',body:{market:instrument.market,symbol:instrument.symbol,botId:ownerId||null,action,direction:orderDirection(side,action==='CLOSE'),type,...previewSize($('#manual-size-mode').value,$('#manual-amount').value.trim(),Number($('#manual-leverage').value),Boolean(state.connectionId)),price:$('#manual-price').value.trim(),margin:$('#manual-margin').value,leverage:Number($('#manual-leverage').value),timeInForce:$('#manual-time-in-force').value}});showConfirmation(plan);}catch(problem){error(problem.message);}finally{busy=false;render();}
  });
  dialog.addEventListener('cancel',event=>{if(sending)event.preventDefault();});
  dialog.addEventListener('click',event=>{if(event.target.closest('[data-manual-dismiss]')&&!sending)dialog.close();});
  dialog.addEventListener('close',()=>{confirmation=null;});
  $('#manual-confirm-submit').addEventListener('click',async()=>{
    if(sending||!confirmation)return;if(confirmation.mode==='done'){dialog.close();return;}sending=true;const button=$('#manual-confirm-submit');button.disabled=true;$('#manual-confirm-error').hidden=true;
    try{
      let order;if(confirmation.mode==='cancel')order=await api('/manual/orders/'+encodeURIComponent(confirmation.order.id)+'/cancel',{method:'POST'});
      else if(['retry','status'].includes(confirmation.mode)){const status=await api('/manual/requests/'+encodeURIComponent(confirmation.plan.id));order=status.found?status.order:await api('/manual/submit',{method:'POST',body:{planId:confirmation.plan.id}});}
      else order=await api('/manual/submit',{method:'POST',body:{planId:confirmation.plan.id}});
      await refresh();await loadContext(true);
      if(order.status==='UNKNOWN'){if(confirmation.plan)confirmation.mode='status';$('#manual-confirm-error').textContent=order.error||'주문 접수 여부를 조회 중입니다. 중복 전송하지 않습니다.';$('#manual-confirm-error').hidden=false;button.textContent=confirmation.plan?'접수 상태 조회':'취소 상태 다시 확인';}
      else if(order.status==='REJECTED'){$('#manual-confirm-error').textContent=order.error||'주문이 거절되었습니다. 창을 닫고 주문 내용을 다시 확인해 주세요.';$('#manual-confirm-error').hidden=false;button.textContent='닫기';confirmation.mode='done';}
      else{notify('수동 주문 · '+statusName(order.status));dialog.close();}
    }catch(problem){$('#manual-confirm-error').textContent=problem.message;$('#manual-confirm-error').hidden=false;if(confirmation?.plan)confirmation.mode='retry';button.textContent=confirmation?.plan?'같은 주문 접수 확인·재시도':'다시 확인';}
    finally{sending=false;button.disabled=false;}
  });
  return {setState,prepareClose(position,botId=''){ownerId=botId;request++;loading=false;context=null;contextAt=0;settingsDirty=false;side=position.quantity>0?'SELL':'BUY';action='CLOSE';$('#manual-reduce-only').checked=true;$('#manual-size-mode').value='quantity';$('#manual-amount').value=String(Math.abs(position.quantity));pendingClose=true;type='MARKET';$('#manual-type').value=type;error('');render();loadContext(true);},prepareBot(botId){ownerId=botId;request++;loading=false;context=null;contextAt=0;settingsDirty=false;action='OPEN';$('#manual-reduce-only').checked=false;$('#manual-amount').value='';render();loadContext(true);},setBookPrice(value){if(state?.environment!=='live'){notify('현재 호가는 실전 시세입니다. 계좌 환경의 호가를 사용해 주세요.',true);return;}type='LIMIT';$('#manual-type').value=type;$('#manual-price').value=String(value);render();$('#manual-price').focus();}};
}
