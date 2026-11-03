import { api } from './api.js';
let state=null,initialized=false;
export function renderConnection(stateValue){
  state=stateValue;const $=s=>document.querySelector(s);
  $('#connection-status').textContent=state.connected?`${state.environment==='live'?'실전':'테스트넷'} 연결됨 · ${state.tradingEnabled?'주문 허용':'조회 전용'}`:state.credentials?.saved?'저장된 키 · 연결 확인 필요':'API 키 미등록';
  $('#credential-storage-status').textContent=state.credentials?.error|| (state.credentials?.saved?'이 PC에 암호화 저장됨': '등록 시 이 PC에 암호화 저장');
  $('#credential-storage-path').textContent=state.credentials?.storagePath||'프로그램 폴더/.runtime/credentials.dpapi';
  $('#connection-position-mode').textContent=state.connected?(state.positionMode==='HEDGE'?'헤지 모드':'단방향 모드'):'연결 후 자동 확인';
  $('#connection-balance').textContent=state.account?`${state.account.walletBalance.toLocaleString('en-US')} USDT`:'연결 후 조회';
  $('#disconnect-account').disabled=!state.connected&&!state.credentials?.saved;
  $('#reconnect-account').hidden=state.connected||!state.credentials?.saved||state.environment!=='live';
  $('#connect-account').textContent=state.connected?'연결·권한 적용':'연결·암호화 저장';
  if(!initialized){$('#connection-allow').checked=state.environment==='live'&&state.tradingEnabled;$('#live-confirm-field').hidden=!$('#connection-allow').checked;initialized=true;}
}
export function installConnectionUI({refresh,toast}){
  const $=s=>document.querySelector(s),form=$('#connection-form');
  const visibility=()=>{$('#live-confirm-field').hidden=!$('#connection-allow').checked;};
  $('#connection-allow').addEventListener('change',visibility);
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=$('#connect-account');button.disabled=true;button.textContent='연결 확인 중…';$('#connection-error').hidden=true;
    const body={environment:'live',apiKey:$('#connection-key').value.trim(),secret:$('#connection-secret').value.trim(),allowTrading:$('#connection-allow').checked,liveAcknowledgement:$('#connection-live-ack').value};
    try{
      if(state?.connected&&state.environment===body.environment&&!body.apiKey&&!body.secret)await api('/trading',{method:'POST',body:{enabled:body.allowTrading,liveAcknowledgement:body.liveAcknowledgement}});
      else await api('/connection',{method:'POST',body});
      await refresh(true);$('#connection-allow').checked=state.tradingEnabled;visibility();toast('연결 설정을 적용했습니다. 봇은 봇 탭에서 개별 시작하세요.');
    }catch(error){$('#connection-error').textContent=error.message;$('#connection-error').hidden=false;}
    finally{$('#connection-key').value='';$('#connection-secret').value='';$('#connection-live-ack').value='';button.disabled=false;button.textContent=state?.connected?'연결·권한 적용':'연결·암호화 저장';}
  });
  $('#reconnect-account').addEventListener('click',async()=>{const button=$('#reconnect-account');button.disabled=true;try{await api('/connection/reconnect',{method:'POST'});await refresh(true);toast(state.connected?'저장된 키로 연결했습니다. 주문 실행은 꺼져 있습니다.':state.error||'연결 상태를 확인해 주세요.',!state.connected);}catch(e){toast(e.message,true);}finally{button.disabled=false;}});
  $('#disconnect-account').addEventListener('click',async()=>{try{await api('/connection',{method:'DELETE'});await refresh(true);$('#connection-allow').checked=false;visibility();toast('연결을 해제하고 저장된 키를 삭제했습니다.');}catch(e){toast(e.message,true);}});
  visibility();
}
