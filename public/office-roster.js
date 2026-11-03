import {avatarSprite} from './avatar.js';
import {positionEmotion} from './workroom-metrics.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function officeRosterMarkup(bots,{selectedId,filter='all',icon}){
 const visible=bots.filter(bot=>filter==='all'||bot.status===filter);
 if(!visible.length)return '<p class="office-roster-empty">이 상태의 봇이 없습니다.</p>';
 return '<ul class="office-roster-rows">'+visible.map(bot=>{
 const running=!!bot.runtime?.runEnabled,mood=positionEmotion(bot),status=bot.error?'확인 필요':bot.runtime?.importPending?'관리 시작 대기':running?'운용 중':bot.quantity>0?'신규 진입 정지':'대기 중';
 const roi=mood.roi===null?'':(mood.roi>=0?'+':'')+mood.roi.toFixed(2)+'%',note=roi?'<span class="'+(mood.value>=0?'positive':'negative')+'" title="'+esc(mood.label)+'">'+roi+'</span>':'<span>'+status+'</span>';
 return '<li class="office-roster-row '+(selectedId===bot.id?'selected':'')+' '+(bot.error?'has-error':'')+'"><button type="button" class="office-roster-focus" data-office-focus="'+esc(bot.id)+'" data-office-key="focus:'+esc(bot.id)+'" aria-label="'+esc(bot.name)+' 위치 보기"><svg class="office-roster-avatar" viewBox="-40 -72 80 80" aria-hidden="true">'+avatarSprite(bot)+'</svg><span><strong>'+esc(bot.name)+'</strong><small>'+esc(bot.symbol)+'</small><span class="office-roster-note">'+note+'</span></span></button><div class="office-roster-actions"><button type="button" data-office-toggle="'+esc(bot.id)+'" data-office-key="toggle:'+esc(bot.id)+'" aria-label="'+esc(bot.name)+' '+(running?'정지':'시작')+'" title="'+(running?'신규 진입 정지':'시작')+'">'+icon(running?'pause':'play')+'</button><button type="button" data-edit-bot="'+esc(bot.id)+'" data-office-key="settings:'+esc(bot.id)+'" aria-label="'+esc(bot.name)+' 설정" title="설정">'+icon('settings')+'</button></div></li>';
 }).join('')+'</ul>';
}
