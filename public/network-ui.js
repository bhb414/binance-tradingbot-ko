import {api} from './api.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function installNetworkUI({toast,onContext}){
 const card=document.createElement('div');card.className='settings-card network-card';
 card.innerHTML='<h2>같은 Wi-Fi에서 접속</h2><p>이 PC가 켜져 있으면 같은 공유기의 휴대폰·다른 PC에서 사용할 수 있습니다.</p><div class="order-permission-row"><div><h3>같은 Wi-Fi 접속 허용</h3><p id="network-status" role="status">불러오는 중…</p></div><button type="button" id="network-toggle" class="trading-switch" role="switch" aria-checked="false" aria-label="같은 Wi-Fi 접속 허용" disabled><span class="trading-switch-track" aria-hidden="true"><i></i></span><span id="network-toggle-state">꺼짐</span></button></div><div id="network-details" hidden><div class="network-address-heading"><strong>다른 기기에서 열 주소</strong><button type="button" id="network-refresh">주소 새로고침</button></div><div id="network-addresses"></div><div class="network-code-row" id="network-code-row"><span>처음 접속할 때 입력할 코드</span><strong id="network-code"></strong></div><p class="network-help">개인 Wi-Fi에서 사용하세요. 주소와 코드를 공유하면 조회·봇 관리·주문을 사용할 수 있습니다. API 키 관리는 이 PC에서만 가능합니다.</p><p class="network-help">접속이 안 되면 Windows 방화벽에서 개인 네트워크의 Node.js 연결이 허용돼 있는지 확인하세요.</p></div><p id="network-error" class="form-errors" role="alert" hidden></p><p class="network-help">설정은 자동 저장됩니다. 접속 허용을 꺼도 이 PC의 봇은 계속 작동합니다.</p>';
 document.querySelector('#page-settings .connection-card').before(card);
 const $=s=>card.querySelector(s);let state=null,busy=false;
 function showError(message){$('#network-error').hidden=!message;$('#network-error').textContent=message||'';}
 function render(){
  if(!state)return;const local=state.local!==false;onContext?.(local);
  $('#network-toggle').setAttribute('aria-checked',String(state.enabled));$('#network-toggle').disabled=busy||!local||!state.enabled&&!state.available;
  $('#network-toggle-state').textContent=busy?'변경 중…':state.enabled?'켜짐':'꺼짐';
  $('#network-status').textContent=!local?'서버 PC에서 접속 허용을 변경할 수 있습니다.':state.enabled?'접속 주소와 코드를 다른 기기에 입력하세요.':state.available?'꺼짐 · 이 PC에서만 접속 가능':'사용할 네트워크 주소가 없습니다. Wi-Fi·유선 연결을 확인하세요.';
  $('#network-details').hidden=!state.enabled;$('#network-code-row').hidden=!local;$('#network-refresh').hidden=!local;$('#network-code').textContent=state.code||'—';
  $('#network-addresses').innerHTML=state.urls.length?state.urls.map((url,i)=>'<div class="network-address"><input readonly aria-label="접속 주소 '+(i+1)+'" value="'+esc(url)+'"><button type="button" class="button secondary" data-copy-address="'+i+'">복사</button></div>').join(''):'<p class="network-help">접속 주소를 열지 못했습니다. 네트워크 연결 후 주소를 새로고침하세요.</p>';
  showError(state.error);
 }
 async function load(){try{state=await api('/network');render();}catch(error){showError(error.message);}}
 $('#network-toggle').addEventListener('click',async()=>{if(!state||busy||!state.local)return;busy=true;render();showError('');try{state=await api('/network',{method:'POST',body:{enabled:!state.enabled}});toast(state.enabled?'같은 Wi-Fi 접속을 켰습니다. 표시된 주소와 코드로 연결하세요.':'같은 Wi-Fi 접속을 껐습니다. 봇 운용은 계속됩니다.');}catch(error){state={...state,error:error.message};toast(error.message,true);}finally{busy=false;render();}});
 $('#network-refresh').addEventListener('click',load);
 card.addEventListener('click',async event=>{const b=event.target.closest('[data-copy-address]');if(!b||!state)return;const input=b.previousElementSibling;try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(input.value);toast('접속 주소를 복사했습니다.');}else{input.focus();input.select();toast('주소를 선택했습니다. 길게 눌러 복사하세요.');}}catch{input.focus();input.select();toast('주소를 선택했습니다. 복사해서 사용하세요.');}});
 window.addEventListener('hashchange',()=>{if(location.hash==='#settings')load();});load();
 return {refresh:load};
}
