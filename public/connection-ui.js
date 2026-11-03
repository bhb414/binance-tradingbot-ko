import {api} from './api.js';
import {connectionView} from './connection-state.js';
let state=null,tradingBusy=false,connectionBusy=false,lastConnected=null,remote=false;
export function setConnectionLocal(local){remote=local===false;if(state)renderConnection(state);}
const $=s=>document.querySelector(s);
function showError(message){$('#connection-error').textContent=message;$('#connection-error').hidden=!message;}
export function renderConnection(value){
 state=value;const view=connectionView(state);
 $('#connection-status').textContent=view.connected?view.environment+' 연결됨':state.credentials?.saved?'저장된 키 · 연결 확인 필요':'API 키 미등록';
 $('#credential-storage-status').textContent=state.credentials?.error||(state.credentials?.saved?'이 PC에 암호화 저장됨':'등록 시 이 PC에 암호화 저장');
 $('#credential-storage-path').textContent=state.credentials?.storagePath||'프로그램 폴더/.runtime/credentials.dpapi';
 $('#connection-position-mode').textContent=view.connected?(state.positionMode==='HEDGE'?'헤지 모드':'단방향 모드'):'연결 후 자동 확인';
 $('#connection-balance').textContent=state.account?state.account.walletBalance.toLocaleString('en-US')+' USDT':'연결 후 조회';
 $('#disconnect-account').disabled=remote||connectionBusy||!state.connected&&!state.credentials?.saved;
 $('#reconnect-account').hidden=state.connected||!state.credentials?.saved||state.environment!=='live';
 $('#reconnect-account').disabled=remote||connectionBusy;
 $('#connect-account').disabled=remote||connectionBusy;$('#connect-account').textContent=connectionBusy?'연결 확인 중…':state.connected?'새 키 연결·저장':'연결·암호화 저장';
 const toggle=$('#trading-toggle');toggle.setAttribute('aria-checked',String(view.permission));toggle.setAttribute('aria-busy',String(tradingBusy));toggle.disabled=tradingBusy||connectionBusy||!view.connected&&!view.permission;
 $('#trading-toggle-state').textContent=tradingBusy?'변경 중…':view.permission?'켜짐':'꺼짐';
 $('#trading-permission-status').textContent=view.connected?(view.enabled?'수동 주문·봇 주문 실행 가능':'새 주문 전송·봇 조건식 매매 중지'):view.permission?'허용 설정 저장됨 · 계좌 재연결 대기':'계좌 연결 후 켤 수 있습니다.';
 if(lastConnected!==view.connected){$('#connection-key-editor').open=!view.connected;lastConnected=view.connected;}
 $('#connection-key-summary').textContent=view.connected?'API 키 변경':'API 키 등록';
 $('#connection-key-editor').hidden=remote;const details=$('.credential-details');if(details)details.hidden=remote;
 let note=$('#connection-remote-note');if(!note){note=document.createElement('p');note.id='connection-remote-note';note.className='connection-remote-note';note.textContent='API 키 등록·변경·삭제는 서버 PC에서 해 주세요.';$('#connection-key-editor').before(note);}note.hidden=!remote;
}
export function installConnectionUI({refresh,toast}){
 $('#trading-toggle').addEventListener('click',async()=>{
  if(tradingBusy||connectionBusy||!state)return;const enabled=!connectionView(state).permission;tradingBusy=true;showError('');renderConnection(state);
  let applied=false;
  try{const next=await api('/trading',{method:'POST',body:{enabled}});renderConnection(next);applied=true;await refresh();toast(enabled?'실전 주문을 허용했습니다. 설정은 자동 저장됩니다.':'주문 실행을 껐습니다. 기존 포지션·미체결 주문은 유지됩니다.');}
  catch(error){showError(error.message);toast(applied?'주문 허용 설정은 저장됐습니다. 화면 갱신을 다시 확인합니다.':error.message,true);}
  finally{tradingBusy=false;renderConnection(state);}
 });
 $('#connection-form').addEventListener('submit',async event=>{
  event.preventDefault();if(connectionBusy||tradingBusy)return;const body={environment:'live',apiKey:$('#connection-key').value.trim(),secret:$('#connection-secret').value.trim()};
  if(!body.apiKey||!body.secret){showError('API Key와 HMAC Secret을 모두 입력해 주세요. 주문 허용은 위 토글에서 변경합니다.');return;}
  connectionBusy=true;showError('');if(state)renderConnection(state);
  try{await api('/connection',{method:'POST',body});await refresh();toast('키를 연결·저장했습니다. 봇 시작은 봇 탭에서 선택하세요.');}
  catch(error){showError(error.message);}
  finally{$('#connection-key').value='';$('#connection-secret').value='';connectionBusy=false;if(state)renderConnection(state);}
 });
 $('#reconnect-account').addEventListener('click',async()=>{
  if(connectionBusy)return;connectionBusy=true;if(state)renderConnection(state);
  try{await api('/connection/reconnect',{method:'POST'});await refresh();toast(state.connected?'저장된 키로 연결하고 주문 허용 설정을 복원했습니다.':state.error||'연결 상태를 확인해 주세요.',!state.connected);}catch(error){toast(error.message,true);}finally{connectionBusy=false;if(state)renderConnection(state);}
 });
 $('#disconnect-account').addEventListener('click',async()=>{
  if(connectionBusy||tradingBusy)return;connectionBusy=true;if(state)renderConnection(state);
  try{await api('/connection',{method:'DELETE'});await refresh();toast('연결을 해제하고 저장된 키를 삭제했습니다.');}catch(error){toast(error.message,true);}finally{connectionBusy=false;if(state)renderConnection(state);}
 });
}
