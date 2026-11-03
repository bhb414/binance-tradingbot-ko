import {pixel as r,identity} from './room-art.js';
import {tile,humanSprite,planter,workstation,shelf} from './office-art.js';
import {seatedAvatar} from './avatar.js';
import {emotionBubble} from './workroom-metrics.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function roomAvatar(bot,x=0,y=0){return `<g class="room-avatar human-avatar facing-down" transform="translate(${x} ${y+32})"><ellipse cy="0" rx="17" ry="5" fill="#34483e26"/>${humanSprite(bot)}</g>`;}
export function roomLayout(bots){
 const rows=Math.max(2,Math.ceil(bots.length/3)),width=1120,height=Math.max(896,rows*224+368),positions=new Map();
 bots.forEach((bot,index)=>positions.set(bot.id,{x:256+index%3*320,y:352+Math.floor(index/3)*224,work:bot.status==='running'}));
 return {width,height,positions,rows};
}
export function actorRoute(bot,home){
 if(home.work)return [{x:home.x,y:home.y,wait:240+identity(bot.id).seed%61,face:'left',seated:true},{x:home.x+72,y:home.y,wait:.2},{x:home.x+72,y:home.y+72,wait:.6},{x:home.x-32,y:home.y+72,wait:1},{x:home.x+72,y:home.y+72,wait:.2},{x:home.x+72,y:home.y,wait:.2},{x:home.x,y:home.y,wait:12,face:'left',seated:true}];
 return [{x:home.x+65,y:home.y+16,wait:28,face:'left'},{x:home.x+65,y:home.y+70,wait:3,face:'down'},{x:home.x+12,y:home.y+70,wait:3,face:'left'},{x:home.x+65,y:home.y+70,wait:1}];
}
export function actorPose(bot,home,seconds){
 const route=actorRoute(bot,home),speed=home.work?48:32,segments=[];let duration=0;
 for(let index=0;index<route.length;index++){const point=route[index],next=route[(index+1)%route.length];if(point.wait){segments.push({from:point,to:point,time:point.wait,face:point.face||'down',walking:false,seated:point.seated===true});duration+=point.wait;}
 const time=Math.hypot(next.x-point.x,next.y-point.y)/speed;if(time){segments.push({from:point,to:next,time,face:next.x>point.x?'right':next.x<point.x?'left':next.y>point.y?'down':'up',walking:true});duration+=time;}}
 let phase=(Math.max(0,seconds)+identity(bot.id).seed%67/7)%duration;
 for(const segment of segments){if(phase<=segment.time){const t=segment.walking?phase/segment.time:0;return {x:segment.from.x+(segment.to.x-segment.from.x)*t,y:segment.from.y+(segment.to.y-segment.from.y)*t,direction:segment.face,walking:segment.walking,working:home.work&&segment.seated===true};}phase-=segment.time;}
 return {x:home.x,y:home.y,direction:home.work?'left':'down',walking:false,working:home.work};
}
function windowAt(x){return `<g>${r(x,94,136,65,'#99aeb6')}${r(x+4,98,128,53,'#c2dee2')}${r(x+8,102,120,2,'#e9f6f3')}${r(x+66,98,4,53,'#eff5ef')}${r(x+4,131,128,4,'#eff5ef')}${r(x-4,151,144,8,'#fcfdf7')}${r(x-4,159,144,5,'#b4c5c0')}</g>`;}
function roomBackground(layout,bots){
 const {width,height,rows}=layout,decor=[];
 for(let row=0;row<rows;row++)for(let col=0;col<3;col++){const bot=bots[row*3+col];decor.push(workstation(256+col*320,352+row*224,bot?.status==='running',bot));}
 return `<defs><pattern id="office-floor" width="32" height="32" patternUnits="userSpaceOnUse">${r(0,0,32,32,'#d0dadb')}${r(0,0,32,1,'#c5d1d3')}${r(0,0,1,32,'#c5d1d3')}${r(15,15,2,2,'#e1e7e6')}</pattern><pattern id="office-outside" width="32" height="32" patternUnits="userSpaceOnUse">${r(0,0,32,32,'#e3e9e7')}${r(0,0,32,1,'#d6dfdc')}</pattern></defs>
 ${r(0,0,width,height,'url(#office-outside)')}${r(54,76,width-96,height-138,'#35545c22')}${r(48,64,width-96,height-136,'#8b9fa4')}${r(56,64,width-112,height-144,'#e8eee8')}${r(80,168,width-160,height-280,'url(#office-floor)')}
 ${r(80,64,width-160,104,'#eef2e8')}${r(80,64,width-160,7,'#fffef5')}${r(80,164,width-160,9,'#96b0ad')}${[128,368,608,848].map(windowAt).join('')}
 ${r(56,172,24,height-284,'#b9c9c4')}${r(56,172,5,height-284,'#f2f6ec')}${r(width-80,172,24,height-284,'#a5bbb7')}${r(width-80,172,5,height-284,'#dce7e0')}
 <g class="office-zone-label"><text x="128" y="214">TRADING OFFICE</text><text class="office-zone-subtitle" x="128" y="234">각자의 자리에서 일하는 봇 트레이딩 팀</text></g>
 <g transform="translate(${width-160} 211)"><circle r="20" fill="#fbfcf4" stroke="#95a9a8" stroke-width="4"/><path d="M0 -12 V1 L8 6" fill="none" stroke="#6f858c" stroke-width="3"/></g>
 ${decor.join('')}${[[112,248],[width-112,248],[112,height-156],[width-112,height-156]].map(([x,y])=>planter(x,y,1.5)).join('')}
 ${shelf(440,height-180,3)}
 ${r(80,height-112,368,16,'#b8c8c1')}${r(672,height-112,width-752,16,'#b8c8c1')}${r(80,height-96,368,7,'#8b9f99')}${r(672,height-96,width-752,7,'#8b9f99')}
 ${r(448,height-112,224,16,'#eaf0e5')}${r(464,height-96,192,12,'#c5d3ce')}${r(480,height-84,160,12,'#f2f4e9')}`;
}
export function renderRoom(bots,{selectedId,filter='all'}={}){
 const layout=roomLayout(bots),nodes=bots.map(bot=>{
 const home=layout.positions.get(bot.id),pose=actorPose(bot,home,0),selected=bot.id===selectedId,dim=filter!=='all'&&filter!==bot.status;
 return `<g class="room-bot human-actor facing-${pose.direction} ${selected?'selected':''} ${dim?'dimmed':''} ${pose.walking?'is-walking':''} ${pose.working?'is-working':''}" transform="translate(${pose.x} ${pose.y})" data-select-map-bot="${escape(bot.id)}" role="button" tabindex="0" aria-haspopup="menu" aria-expanded="false" aria-pressed="${selected}" aria-label="${escape(bot.name)} · ${escape(bot.symbol)} · ${home.work?'일하는 중':'대기 중'} · 메뉴 열기">${r(-44,-100,88,128,'transparent','class="actor-hit"')}${r(-38,-90,76,8,'transparent','class="actor-menu-anchor" pointer-events="none"')}<ellipse class="actor-shadow" cy="6" rx="21" ry="6" fill="#34483e25"/><ellipse class="selection-ring" cy="9" rx="26" ry="9"/><g class="standing-person">${humanSprite(bot,{x:-40,y:-78,size:80})}</g>${seatedAvatar(bot)}${emotionBubble(bot)}</g>`;
 }).join('');
 return `<svg class="office-map rpg-world metaverse-office" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" data-world-width="${layout.width}" data-world-height="${layout.height}" role="group" aria-label="봇들이 각자의 책상에서 일하는 도트 사무실" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">${roomBackground(layout,bots)}<g class="room-actors">${nodes}</g></svg>`;
}
