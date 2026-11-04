const terminal=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{maximumFractionDigits:8}):'—';
const statusName=s=>({NEW:'접수',PARTIALLY_FILLED:'부분 체결',UNKNOWN:'접수 확인 중',CANCELED:'취소',FILLED:'체결 완료'})[s]||s;
export function homeOpenOrders(state){
 const tracked=state?.orders||[],rows=(state?.account?.orders||[]).map(o=>({...o,kind:'standard',tracked:tracked.find(t=>t.kind==='standard'&&t.symbol===o.symbol&&t.id===o.clientOrderId)}));
 for(const t of tracked)if(t.kind==='algo'||!rows.some(r=>r.symbol===t.symbol&&r.clientOrderId===t.id))rows.push({...t,clientOrderId:t.kind==='standard'?t.id:null,tracked:t});
 return rows.map((r,index)=>{const owner=(state?.positionOwners||state?.bots||[]).find(b=>b.id===r.tracked?.botId),manual=state?.manualOrders?.find(m=>m.id===r.clientOrderId);return {...r,index,key:JSON.stringify([r.kind,r.symbol,r.clientOrderId||r.id||String(r.orderId)]),remaining:Math.max(0,Number(r.quantity)-Number(r.executedQuantity||0)),ownerName:owner?.name||manual?.botName||(manual?'앱 수동':'바이낸스 직접 주문'),ownerId:owner?.parentId||owner?.multiBotId||owner?.id,canCancel:r.kind==='standard'&&r.status!=='UNKNOWN'&&!terminal.has(r.status)&&!!(r.clientOrderId||r.orderId)&&!!state?.connected};});
}
export function homeOrderTable(state){
 const rows=homeOpenOrders(state);if(!rows.length)return '<div class="empty-table">미체결 주문이 없습니다.</div>';
 return '<table class="data-table home-order-table"><thead><tr><th>종목 / 관리</th><th>방향 / 유형</th><th>가격 / 조건가</th><th>미체결 / 전체 수량</th><th>상태</th><th>주문 관리</th></tr></thead><tbody>'+rows.map(o=>'<tr><td><strong>'+esc(o.symbol)+'</strong><small>'+esc(o.ownerName)+'</small></td><td>'+esc(o.side==='BUY'?'매수':'매도')+' · '+esc(o.type)+'</td><td>'+fmt(o.price)+'</td><td>'+fmt(o.remaining)+' / '+fmt(o.quantity)+'</td><td>'+esc(statusName(o.status))+'</td><td>'+(o.kind==='algo'?'<button type="button" class="button secondary" data-home-protection="'+esc(o.ownerId)+'">보호 설정</button>': '<button type="button" class="button secondary" data-home-cancel="'+esc(o.key)+'" '+(!o.canCancel?'disabled':'')+' aria-label="'+esc(o.symbol)+' 미체결 잔량 취소">잔량 취소</button>')+'</td></tr>').join('')+'</tbody></table><p class="position-data-note">취소는 미체결 잔량에만 적용됩니다. 봇이 켜져 있으면 이후 조건에 따라 새 주문이 생길 수 있습니다. 봇 TP/SL은 보호 설정에서 변경합니다.</p>';
}
