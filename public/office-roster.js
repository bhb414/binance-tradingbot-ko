import {botWorkstation} from './bot-workstation.js';
import {effectiveBudget} from './budget.js';
import {positionEmotion} from './workroom-metrics.js';
import {positionNetReturn} from './position-net.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function rosterPositions(bot){
 const members=bot.kind==='multi'||Array.isArray(bot.members)?bot.members||[]:[bot];
 return members.flatMap(member=>{const r=member.runtime||{},quantity=Number(member.quantity??r.quantity);if(!Number.isFinite(quantity)||quantity===0)return [];const direction=member.positionDirection??r.direction??member.direction,entry=Number(member.entryPrice??r.entryPrice);return [{symbol:String(member.symbol||''),alias:member.alias||null,direction:['LONG','SHORT'].includes(direction)?direction:quantity<0?'SHORT':null,quantity:Math.abs(quantity),entryPrice:Number.isFinite(entry)&&entry>0?entry:null,checking:Boolean(r.syncHold)}];});
}
const positionNumber=value=>value===null?'—':value!==0&&Math.abs(value)<1e-8?Number(value.toPrecision(6)).toString():value.toLocaleString('ko-KR',{maximumFractionDigits:12});
export function rosterPositionMarkup(bot){const positions=rosterPositions(bot);if(!positions.length)return '';return '<div class="office-roster-positions" role="list" aria-label="'+esc(bot.name)+' 보유 포지션" title="수량과 평단은 해당 봇에 배정된 보유분 기준입니다.">'+positions.map(p=>'<div class="office-roster-position" role="listitem"><span class="roster-position-symbol">'+(p.alias?'<small>'+esc(p.alias)+'</small>':'')+esc(p.symbol)+'</span><b class="roster-position-side '+(p.direction==='LONG'?'long':p.direction==='SHORT'?'short':'unknown')+'">'+(p.direction==='LONG'?'롱':p.direction==='SHORT'?'숏':'방향 확인 중')+'</b><span class="roster-position-field"><small>수량</small><strong>'+positionNumber(p.quantity)+'</strong></span><span class="roster-position-field"><small>진입평단</small><strong>'+positionNumber(p.entryPrice)+' <em>USDT</em></strong></span>'+(p.checking?'<span class="roster-position-checking">수량 대조 중</span>':'')+'</div>').join('')+'</div>';}
export function officeRosterMarkup(bots,{selectedId,filter='all',icon,costs={}}){
 const visible=bots.filter(bot=>filter==='all'||bot.status===filter);
 if(!visible.length)return '<p class="office-roster-empty">이 상태의 봇이 없습니다.</p>';
 return '<ul class="office-roster-rows">'+visible.map(bot=>{
 const positions=rosterPositionMarkup(bot),running=!!bot.runtime?.runEnabled,mood=positionEmotion(bot),status=bot.budgetIncluded===false?'보관 · 예산 미포함':bot.error?'확인 필요':bot.runtime?.waiting?(bot.runtime.waiting.kind==='rate-limit'?'호출 제한 · 자동 재개':['order-settlement','reconciliation'].includes(bot.runtime.waiting.kind)?'정리 확인 중':'연결 재시도 중'):bot.runtime?.orderRetry?bot.runtime.orderRetry.label:bot.runtime?.importPending?'관리 시작 대기':running?(bot.runtime.entryBlocked?.label||'운용 중'):bot.quantity>0?'신규 진입 정지':'대기 중';
 const roi=mood.roi===null?'—':(mood.roi>=0?'+':'')+mood.roi.toFixed(2)+'%',net=positionNetReturn(bot,costs),signed=n=>(n>=0?'+':'')+n.toFixed(2),note='<span'+(bot.runtime?.orderRetry?' title="'+esc(bot.runtime.orderRetry.message)+'"':'')+'>'+esc(status)+'</span>';
 const detail=net.state==='ready'?'현재 보유분 기준 · 진입 수수료 '+net.entryFee.toFixed(4)+' USDT · 펀딩 '+signed(net.funding)+' USDT · 시장가 정리 예상 수수료 '+net.closingFee.toFixed(4)+' USDT · 비용 후 예상손익 '+signed(net.net)+' USDT · 보유 증거금 대비 수익률':net.reason;
 const returns=mood.kind==='none'?'<div class="office-roster-no-position">보유 포지션 없음</div>':'<div class="office-roster-returns"><span title="'+esc(mood.label)+'"><small>평가</small><strong class="'+(mood.value==null?'':mood.value>=0?'positive':'negative')+'">'+roi+'</strong><b class="roster-usdt '+(mood.value==null?'':mood.value>=0?'positive':'negative')+'">'+(mood.value==null?'—':signed(mood.value))+' USDT</b></span><span title="'+esc(detail)+'" aria-label="'+esc('비용 후 예상 '+(net.state==='ready'?signed(net.roi)+'% · '+detail:detail))+'"><small>비용 후 예상</small><strong class="'+(net.state==='ready'?net.net>=0?'positive':'negative':'cost-unknown')+'">'+(net.state==='ready'?signed(net.roi)+'%':'미확인')+'</strong><b class="roster-usdt '+(net.state==='ready'?net.net>=0?'positive':'negative':'cost-unknown')+'">'+(net.state==='ready'?signed(net.net)+' USDT':'— USDT')+'</b></span></div>';
 return '<li data-roster-id="'+esc(bot.id)+'" class="office-roster-row '+(positions?'has-positions ':'')+(selectedId===bot.id?'selected':'')+' '+(bot.error?'has-error':'')+'"><button type="button" class="office-roster-focus" data-office-focus="'+esc(bot.id)+'" data-office-key="focus:'+esc(bot.id)+'" aria-label="'+esc(bot.name)+' 설정'+'"><span class="bot-workstation-frame">'+botWorkstation(bot)+'</span><span><strong>'+esc(bot.name)+'</strong><small>'+esc(bot.symbol)+'</small><span class="office-roster-note">'+note+'</span><small class="office-roster-budget">'+(bot.budgetIncluded===false?'보관 · 예산 미포함':'운용한도 '+effectiveBudget(bot).toLocaleString('en-US',{maximumFractionDigits:2})+' USDT')+'</small></span></button><div class="office-roster-actions"><button type="button" '+(bot.budgetIncluded===false?'hidden ':'')+'data-office-toggle="'+esc(bot.id)+'" data-office-key="toggle:'+esc(bot.id)+'" aria-label="'+esc(bot.name)+' '+(running?'정지':'시작')+'" title="'+(running?'신규 진입 정지':'시작')+'">'+icon(running?'pause':'play')+'</button><button type="button" data-edit-bot="'+esc(bot.id)+'" data-office-key="settings:'+esc(bot.id)+'" aria-label="'+esc(bot.name)+' 설정" title="설정">'+icon('settings')+'</button><button type="button" data-bot-tools="'+esc(bot.id)+'" data-office-key="tools:'+esc(bot.id)+'" aria-label="'+esc(bot.name)+' 더보기" title="더보기"><span aria-hidden="true">⋯</span></button></div>'+returns+positions+'</li>';
 }).join('')+'</ul>';
}

function patchNode(node,next){
 if(node.nodeType!==next.nodeType||node.nodeName!==next.nodeName){node.replaceWith(next);return;}
 if(node.nodeType===3){if(node.data!==next.data)node.data=next.data;return;}
 if(node.nodeType!==1)return;
 for(const a of [...node.attributes])if(!next.hasAttribute(a.name))node.removeAttribute(a.name);
 for(const a of [...next.attributes])if(node.getAttribute(a.name)!==a.value)node.setAttributeNS(a.namespaceURI,a.name,a.value);
 const old=[...node.childNodes],desired=[...next.childNodes];for(let i=0;i<desired.length;i++){if(old[i])patchNode(old[i],desired[i]);else node.append(desired[i]);}for(let i=desired.length;i<old.length;i++)old[i].remove();
}
export function renderOfficeRoster(root,bots,options){
 const template=document.createElement('template');template.innerHTML=officeRosterMarkup(bots,options);const next=template.content.firstElementChild;
 let list=root.firstElementChild;if(!list||list.tagName!==next.tagName){root.replaceChildren(next);return;}
 if(next.tagName!=='UL'){patchNode(list,next);return;}
 const rows=new Map([...list.children].map(row=>[row.dataset.rosterId,row]));let index=0;
 for(const desired of [...next.children]){const row=rows.get(desired.dataset.rosterId);if(row){rows.delete(desired.dataset.rosterId);patchNode(row,desired);if(list.children[index]!==row)list.insertBefore(row,list.children[index]||null);}else list.insertBefore(desired,list.children[index]||null);index++;}
 for(const row of rows.values())row.remove();
}
