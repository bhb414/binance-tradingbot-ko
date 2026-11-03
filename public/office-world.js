import {pixel as r,identity} from './room-art.js';
import {tile,patch,humanSprite,planter,monitor,workstation,sofa,shelf,glassWall,chair} from './office-art.js';
import {seatedAvatar} from './avatar.js';
import {emotionBubble} from './workroom-metrics.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function roomAvatar(bot,x=0,y=0){return `<g class="room-avatar human-avatar facing-down" transform="translate(${x} ${y+32})"><ellipse cy="0" rx="17" ry="5" fill="#34483e26"/>${humanSprite(bot)}</g>`;}
export function roomLayout(bots){
 const working=bots.filter(bot=>bot.status==='running'),resting=bots.filter(bot=>bot.status!=='running'),rows=Math.max(2,Math.ceil(working.length/3)),restRows=Math.max(2,Math.ceil(resting.length/3));
 const width=1536,height=Math.max(1120,rows*192+704,restRows*104+864),positions=new Map();
 working.forEach((bot,index)=>positions.set(bot.id,{x:272+index%3*224,y:368+Math.floor(index/3)*192,work:true}));
 resting.forEach((bot,index)=>positions.set(bot.id,{x:1032+index%3*112,y:704+Math.floor(index/3)*104,work:false}));
 return {width,height,positions,rows,restRows,lobbyY:height-288};
}
export function actorRoute(bot,home){
 const sign=identity(bot.id).seed%2?1:-1;
 if(home.work)return [{x:home.x,y:home.y,wait:bot.task==='position'?18:13,face:'left',seated:true},{x:home.x+52,y:home.y,wait:.3},{x:home.x+52,y:home.y+64,wait:.8},{x:home.x-64,y:home.y+64,wait:1.4},{x:home.x+52,y:home.y+64,wait:.3},{x:home.x+52,y:home.y,wait:.3},{x:home.x,y:home.y,wait:1,face:'left',seated:true}];
 return [{x:home.x,y:home.y,wait:2,face:'down'},{x:home.x+sign*26,y:home.y,wait:.5},{x:home.x+sign*26,y:home.y+40,wait:1.5},{x:home.x-sign*24,y:home.y+40,wait:.4},{x:home.x-sign*24,y:home.y,wait:1}];
}
export function actorPose(bot,home,seconds){
 const route=actorRoute(bot,home),speed=bot.status==='running'?44:35,segments=[];let duration=0;
 for(let index=0;index<route.length;index++){
  const point=route[index],next=route[(index+1)%route.length];
  if(point.wait){segments.push({from:point,to:point,time:point.wait,face:point.face||'down',walking:false,seated:point.seated===true});duration+=point.wait;}
  const time=Math.hypot(next.x-point.x,next.y-point.y)/speed;
  if(time){segments.push({from:point,to:next,time,face:next.x>point.x?'right':next.x<point.x?'left':next.y>point.y?'down':'up',walking:true});duration+=time;}
 }
 let phase=(Math.max(0,seconds)+identity(bot.id).seed%89/7)%duration;
 for(const segment of segments){if(phase<=segment.time){const t=segment.walking?phase/segment.time:0;return {x:segment.from.x+(segment.to.x-segment.from.x)*t,y:segment.from.y+(segment.to.y-segment.from.y)*t,direction:segment.face,walking:segment.walking,working:home.work&&segment.seated===true};}phase-=segment.time;}
 return {x:home.x,y:home.y,direction:home.work?'left':'down',walking:false,working:home.work};
}
function sign(x,y,title,subtitle=''){return `<g class="office-zone-label" transform="translate(${x} ${y})"><text>${title}</text>${subtitle?`<text class="office-zone-subtitle" y="20">${subtitle}</text>`:''}</g>`;}
function windowAt(x,y,width=128){return `<g>${r(x,y,width,68,'#99b0b6')}${r(x+4,y+4,width-8,56,'#b8d7de')}${r(x+8,y+8,width-16,2,'#e4f3ed')}${r(x+width/2-2,y+4,4,56,'#edf2eb')}${r(x+4,y+38,width-8,4,'#edf2eb')}${r(x-4,y+60,width+8,8,'#f8faf3')}${r(x-4,y+68,width+8,4,'#b5c5c1')}${r(x+12,y+64,18,16,'#adbdbe22')}</g>`;}
function roomBackground(layout,bots){
 const {width,height,rows,restRows,lobbyY}=layout,workBottom=368+(rows-1)*192+112,working=bots.filter(bot=>bot.status==='running'),decor=[];
 // Six physical workstations form a shared office, with rows added for more bots.
 for(let row=0;row<rows;row++)for(let column=0;column<3;column++)decor.push(workstation(272+column*224,368+row*192,row*3+column<working.length,row*3+column));
 for(let row=0;row<restRows;row++)decor.push(sofa(1336,660+row*104,'green',2));
 const windows=[176,400,624,1040,1264].map(x=>windowAt(x,105,128)).join('');
 const planters=[[128,240],[864,240],[128,workBottom-24],[864,workBottom-24],[984,240],[1408,240],[984,480],[1408,480],[1408,height-208],[128,height-208],[864,height-208]];
 return `<defs>
 <pattern id="office-pavement" width="32" height="32" patternUnits="userSpaceOnUse">${r(0,0,32,32,'#cbd6d6')}${r(1,1,30,29,'#d8e0df')}${r(3,3,26,2,'#e9efeb')}</pattern>
 <pattern id="office-floor" width="32" height="32" patternUnits="userSpaceOnUse">${tile('city',4,20,0,0)}</pattern>
 <pattern id="office-oak" width="64" height="32" patternUnits="userSpaceOnUse">${r(0,0,64,32,'#d9caab')}${r(0,0,64,1,'#c5b798')}${r(0,16,64,1,'#cdbfa2')}${r(0,0,1,16,'#c5b798')}${r(32,16,1,16,'#c5b798')}${r(8,7,18,1,'#dfd3ba')}${r(37,23,17,1,'#dfd3ba')}</pattern>
 <pattern id="office-carpet" width="16" height="16" patternUnits="userSpaceOnUse">${r(0,0,16,16,'#beced1')}${r(0,0,16,1,'#b5c8cb')}${r(0,0,1,16,'#b5c8cb')}${r(6,7,2,2,'#d1dde0')}</pattern>
 <pattern id="office-cafe-floor" width="32" height="32" patternUnits="userSpaceOnUse">${r(0,0,32,32,'#e7e2d2')}${r(0,0,32,1,'#d0cbbd')}${r(0,0,1,32,'#d0cbbd')}</pattern>
 </defs>
 ${r(0,0,width,height,'#d5dfdf')}${r(0,0,width,height,'url(#office-pavement)')}
 ${r(76,104,1412,height-176,'#465d6226')}${r(64,80,1408,height-160,'#81979c')}${r(72,80,1392,height-168,'#dfe7e4')}
 ${r(96,176,1344,height-288,'url(#office-floor)')}${r(96,176,832,workBottom-144,'url(#office-carpet)')}
 ${r(96,workBottom+32,832,height-workBottom-176,'url(#office-oak)')}
 ${r(960,176,480,304,'#e0e6dc')}${r(976,192,448,272,'#c7d6cf')}
 ${r(960,512,480,height-624,'url(#office-cafe-floor)')}
 ${r(96,80,1344,104,'#ebefdf')}${r(96,80,1344,8,'#f7f9ee')}${r(96,172,1344,12,'#8baba9')}${windows}
 ${r(72,184,24,height-288,'#b0c1bb')}${r(72,184,6,height-288,'#f2f5e8')}${r(1440,184,24,height-288,'#9db4b2')}${r(1440,184,5,height-288,'#e4ede5')}
 ${r(928,184,32,height-432,'#eff2e6')}${r(928,184,6,height-432,'#b2c7be')}${r(928,height-248,32,136,'#eff2e6')}${r(928,height-248,6,136,'#b2c7be')}
 ${glassWall(960,184,296,true)}${glassWall(976,468,96)}${glassWall(1232,468,208)}
 ${sign(152,226,'01  /  TRADING FLOOR','팀의 전략이 일하는 곳')}${sign(1000,226,'02  /  MEETING ROOM')}
 ${sign(1000,630,'03  /  COFFEE &amp; LOUNGE')}${sign(152,lobbyY,'04  /  RECEPTION')}
 ${decor.join('')}
 ${monitor(1200,236,true,true)}${r(1137,232,126,4,'#f1f4e8')}
 ${patch('indoors',3,0,2,1,1136,344,4)}${chair(1108,350)}${chair(1108,400)}${chair(1292,350,'left')}${chair(1292,400,'left')}
 ${r(1180,351,29,18,'#f5f3df')}${r(1184,354,21,2,'#9cb5b0')}${r(1234,389,12,12,'#f8fbf3')}
 ${shelf(984,278,1)}${planter(1392,390,1.6)}
 ${Array.from({length:10},(_,i)=>tile('indoors',i%4,12,1000+i*40,520,40,40)).join('')}
 ${patch('indoors',10,13,1,3,1384,500,2)}
 ${r(1018,494,39,35,'#4b5b61')}${r(1022,499,31,16,'#91b3b1')}${r(1030,518,16,11,'#ede9d9')}${r(1070,509,17,19,'#f3f2df')}
 ${tile('indoors',16,0,1130,491,40,40)}${r(1200,493,26,27,'#c5aa84')}${r(1203,496,20,10,'#e4d1ac')}
 ${sofa(1000,636,'green',3)}${r(1130,654,164,4,'#c6b995')}${patch('indoors',0,0,3,1,1144,644,2)}
 ${shelf(192,workBottom+56,3)}${sofa(568,workBottom+60,'orange',4)}
 ${patch('indoors',3,0,2,1,648,workBottom+124,2)}${tile('indoors',18,0,678,workBottom+126,20,20)}
 ${r(264,lobbyY+39,210,60,'#7d908a22')}${r(256,lobbyY+24,208,60,'#b7bca8')}${r(256,lobbyY+16,208,27,'#eff1df')}${r(260,lobbyY+18,200,4,'#fffdf0')}${r(268,lobbyY+48,184,3,'#dbe2ce')}${monitor(410,lobbyY-16,false)}
 <g class="office-brand"><text x="516" y="${lobbyY+53}">FUTURES</text><text x="516" y="${lobbyY+73}">WORKROOM</text></g>
 ${planters.map(([x,y])=>planter(x,y,1.4)).join('')}
 ${r(96,height-112,504,16,'#b5c4be')}${r(792,height-112,648,16,'#b5c4be')}${r(96,height-96,504,8,'#839b97')}${r(792,height-96,648,8,'#839b97')}
 ${r(600,height-112,192,16,'#e4e9dd')}${r(612,height-96,168,16,'#bbcfc8')}${r(624,height-80,144,16,'#f0f1e1')}
 ${[192,352,960,1120,1280].map(x=>planter(x+24,height-24,1.8)).join('')}
 ${sign(650,height-28,'ENTRANCE')}`;
}
export function renderRoom(bots,{selectedId,filter='all'}={}){
 const layout=roomLayout(bots),nodes=bots.map(bot=>{
  const home=layout.positions.get(bot.id),pose=actorPose(bot,home,0),selected=bot.id===selectedId,dim=filter!=='all'&&filter!==bot.status,name=Array.from(bot.name);
  return `<g class="room-bot human-actor facing-${pose.direction} ${selected?'selected':''} ${dim?'dimmed':''} ${pose.walking?'is-walking':''} ${pose.working?'is-working':''}" transform="translate(${pose.x} ${pose.y})" data-select-map-bot="${escape(bot.id)}" role="button" tabindex="0" aria-haspopup="menu" aria-expanded="false" aria-pressed="${selected}" aria-label="${escape(bot.name)} · ${escape(bot.symbol)} · ${home.work?'일하는 중':'쉬는 중'} · 메뉴 열기">${r(-36,-90,72,106,'transparent','class="actor-hit"')}<ellipse class="actor-shadow" cy="0" rx="17" ry="5" fill="#34483e30"/><ellipse class="selection-ring" cy="1" rx="23" ry="8"/><g class="standing-person">${humanSprite(bot)}</g>${seatedAvatar(bot)}${emotionBubble(bot)}</g>`;
 }).join('');
 return `<svg class="office-map rpg-world metaverse-office" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" data-world-width="${layout.width}" data-world-height="${layout.height}" role="group" aria-label="사람 캐릭터가 걸어 다니는 메타버스 오피스" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">${roomBackground(layout,bots)}<g class="room-actors">${nodes}</g></svg>`;
}
