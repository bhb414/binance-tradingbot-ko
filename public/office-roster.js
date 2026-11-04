import {avatarSprite} from './avatar.js';
import {positionEmotion} from './workroom-metrics.js';
import {positionNetReturn} from './position-net.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function officeRosterMarkup(bots,{selectedId,filter='all',icon,costs={}}){
 const visible=bots.filter(bot=>filter==='all'||bot.status===filter);
 if(!visible.length)return '<p class="office-roster-empty">이 상태의 봇이 없습니다.</p>';
 return '<ul class="office-roster-rows">'+visible.map(bot=>{
 const running=!!bot.runtime?.runEnabled,mood=positionEmotion(bot),status=bot.error?'확인 필요':bot.runtime?.waiting?(bot.runtime.waiting.kind==='rate-limit'?'호출 제한 · 자동 재개':'연결 재시도 중'):bot.runtime?.importPending?'관리 시작 대기':running?(bot.runtime.entryBlocked?.label||'운용 중'):bot.quantity>0?'신규 진입 정지':'대기 중';
 const roi=mood.roi===null?'—':(mood.roi>=0?'+':'')+mood.roi.toFixed(2)+'%',net=positionNetReturn(bot,costs),signed=n=>(n>=0?'+':'')+n.toFixed(2),note='<span>'+esc(status)+'</span>';
 const detail=net.state==='ready'?'현재 보유분 기준 · 진입 수수료 '+net.entryFee.toFixed(4)+' USDT · 펀딩 '+signed(net.funding)+' USDT · 시장가 정리 예상 수수료 '+net.closingFee.toFixed(4)+' USDT · 비용 후 예상손익 '+signed(net.net)+' USDT · 보유 증거금 대비 수익률':net.reason;
 const returns=mood.kind==='none'?'':'<div class="office-roster-returns"><span title="'+esc(mood.label)+'"><small>평가</small><strong class="'+(mood.value==null?'':mood.value>=0?'positive':'negative')+'">'+roi+'</strong></span><span title="'+esc(detail)+'" aria-label="'+esc('비용 후 예상 '+(net.state==='ready'?signed(net.roi)+'% · '+detail:detail))+'"><small>비용 후 예상</small><strong class="'+(net.state==='ready'?net.net>=0?'positive':'negative':'cost-unknown')+'">'+(net.state==='ready'?signed(net.roi)+'%':'미확인')+'</strong></span></div>';
 return '<li class="office-roster-row '+(selectedId===bot.id?'selected':'')+' '+(bot.error?'has-error':'')+'"><button type="button" class="office-roster-focus" data-office-focus="'+esc(bot.id)+'" data-office-key="focus:'+esc(bot.id)+'" aria-label="'+esc(bot.name)+' 위치 보기"><svg class="office-roster-avatar" viewBox="-40 -72 80 80" aria-hidden="true">'+avatarSprite(bot)+'</svg><span><strong>'+esc(bot.name)+'</strong><small>'+esc(bot.symbol)+'</small><span class="office-roster-note">'+note+'</span></span></button><div class="office-roster-actions"><button type="button" data-office-toggle="'+esc(bot.id)+'" data-office-key="toggle:'+esc(bot.id)+'" aria-label="'+esc(bot.name)+' '+(running?'정지':'시작')+'" title="'+(running?'신규 진입 정지':'시작')+'">'+icon(running?'pause':'play')+'</button><button type="button" data-edit-bot="'+esc(bot.id)+'" data-office-key="settings:'+esc(bot.id)+'" aria-label="'+esc(bot.name)+' 설정" title="설정">'+icon('settings')+'</button></div>'+returns+'</li>';
 }).join('')+'</ul>';
}
