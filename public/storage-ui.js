import {api} from './api.js';
let root,state,busy=false;
const time=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'—';
export function renderStorage(value){
 state=value;if(!root)return;
 const fault=state.storageFault,health=state.storageHealth,$=s=>root.querySelector(s);root.classList.toggle('has-fault',!!fault);
 $('#storage-save-state').textContent=fault?(fault.phase==='saving'?'저장 재시도 대기':'주문·포지션 확인 대기'):'정상';
 $('#storage-save-message').textContent=fault?fault.message:health?'최근 자동 복구: '+time(health.recoveredAt)+' · '+health.code:'주문 의도를 저장한 뒤 거래소에 전송합니다.';
 $('#storage-save-details').hidden=!fault;$('#storage-save-retry').hidden=!fault;$('#storage-save-retry').disabled=busy;
 $('#storage-save-note').hidden=!fault;
 if(fault){$('#storage-save-at').textContent=time(fault.firstAt);$('#storage-save-cause').textContent=fault.code+' · '+fault.reason;$('#storage-save-file').textContent=fault.file+' · '+fault.syscall;
 $('#storage-save-next').textContent=fault.offRequested?'주문 허용 끄기 요청 적용됨 · 저장 회복 후에도 꺼짐 유지':Math.max(0,Math.ceil((fault.retryAt-Date.now())/1000))+'초 뒤 자동 확인 · 복구 시 기존 허용 상태 유지';}
}
export function installStorageUI({refresh,toast}){
 root=document.createElement('div');root.className='storage-health-panel';root.innerHTML='<div class="storage-health-heading"><h3>주문 원장 저장</h3><strong id="storage-save-state">확인 중</strong></div><p id="storage-save-message" role="status"></p><dl id="storage-save-details" hidden><div><dt>발생 시각</dt><dd id="storage-save-at"></dd></div><div><dt>저장 오류</dt><dd id="storage-save-cause"></dd></div><div><dt>대상 파일</dt><dd id="storage-save-file"></dd></div><div><dt>다음 확인</dt><dd id="storage-save-next"></dd></div></dl><button type="button" class="button secondary" id="storage-save-retry" hidden>저장·주문 다시 확인</button><p class="storage-recovery-note" id="storage-save-note" hidden>파일 저장과 거래소 주문·포지션 대조가 끝날 때까지 주문을 보류합니다. 미확인 주문은 다시 전송하지 않습니다. 거래소에 이미 등록된 보호 주문은 유지됩니다.</p>';
 document.querySelector('#trading-permission-help').after(root);
 root.querySelector('#storage-save-retry').addEventListener('click',async()=>{if(busy)return;busy=true;if(state)renderStorage(state);try{const next=await api('/storage/retry',{method:'POST'});renderStorage(next);await refresh();toast(next.storageFault?'확인을 기다리고 있습니다. 표시된 원인을 확인해 주세요.':'원장 저장·주문·포지션 대조를 완료했습니다.',!!next.storageFault);}catch(error){toast(error.message,true);}finally{busy=false;if(state)renderStorage(state);}});
 if(state)renderStorage(state);
}
