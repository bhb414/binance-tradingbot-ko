import {workstation} from './office-art.js';
import {seatedAvatar} from './avatar.js';
import {emotionBubble} from './workroom-metrics.js';
export function botWorkstation(bot){
 const active=bot.budgetIncluded!==false&&!bot.error&&(bot.status==='running'||bot.runtime?.runEnabled||Number(bot.quantity??bot.runtime?.quantity)>0),grid=Array.from({length:11},(_,i)=>'<path d="M'+(-132+i*20)+' -110 V45 M-132 '+(-110+i*20)+' H73"/>').join('');
 return '<svg class="bot-workstation '+(active?'is-active':'is-idle')+'" viewBox="-132 -110 205 155" aria-hidden="true" shape-rendering="crispEdges"><rect x="-132" y="-110" width="205" height="155" rx="8" fill="#edf3f1"/><g stroke="#dce6e2" stroke-width="1">'+grid+'</g>'+workstation(0,0,active,active?bot:null)+'<g class="workstation-person">'+seatedAvatar(bot)+'</g><g class="workstation-emotion">'+emotionBubble(bot)+'</g>'+(active?'<rect class="desk-cursor" x="-58" y="-38" width="7" height="2" fill="#5e9e88"/>':'')+'</svg>';
}
