import {renderRoom,roomLayout,actorPose} from './room-world.js';
import {avatarSignature,spriteViewBox} from './avatar.js';
import {positionEmotion} from './workroom-metrics.js';

// The trading poll updates data; this scene owns only visual poses and camera UI.
export class RoomScene{
  constructor(root){
    this.root=root;this.bots=[];this.layout=roomLayout([]);this.key='';this.elapsed=0;this.frame=null;this.lastTime=null;this.lastPaint=0;this.visible=false;this.heldId=null;this.heldAt=0;this.timeOffsets=new Map();
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)');let preference;try{preference=localStorage.getItem('fw-room-motion-v1');}catch{}
    this.enabled=preference!=='off'&&!this.reduced.matches;
    document.addEventListener('visibilitychange',()=>this.schedule());
    this.reduced.addEventListener('change',()=>{if(this.reduced.matches)this.setMotion(false);});
    this.paint=this.paint.bind(this);this.applyMotion();
  }
  update(bots,{selectedId,filter='all'}={}){
    this.bots=bots;this.selectedId=selectedId;this.filter=filter;
    const key=JSON.stringify(bots.map(bot=>[bot.id,bot.name,avatarSignature(bot),bot.status,bot.task,positionEmotion(bot).kind]));
    const rebuilt=key!==this.key||!this.root.firstElementChild;
    if(rebuilt){
      this.key=key;this.layout=roomLayout(bots);this.root.innerHTML=renderRoom(bots,{selectedId,filter});this.root.dataset.sceneRevision=String(Number(this.root.dataset.sceneRevision||0)+1);
      this.actors=new Map([...this.root.querySelectorAll('[data-select-map-bot]')].map(node=>[node.dataset.selectMapBot,node]));
      this.sprites=new Map([...this.actors].map(([id,node])=>[id,node.querySelector('.sprite-person')]));
      this.root.style.setProperty('--world-width',this.layout.width+'px');this.root.style.setProperty('--world-height',this.layout.height+'px');this.applyMotion();
    }
    for(const bot of bots){const node=this.actors.get(bot.id),selected=bot.id===selectedId,dim=filter!=='all'&&filter!==bot.status;node.classList.toggle('selected',selected);node.classList.toggle('dimmed',dim);node.setAttribute('aria-pressed',String(selected));node.setAttribute('tabindex',dim?'-1':'0');const bubble=node.querySelector('.mood-bubble');if(bubble){const mood=positionEmotion(bot);bubble.setAttribute('aria-label',mood.label);bubble.querySelector('title').textContent=mood.label;}}
    this.renderPoses();this.schedule();return rebuilt;
  }
  applyMotion(){
    this.root.classList.toggle('motion-paused',!this.enabled);
    const button=document.querySelector('#room-motion');if(button){button.setAttribute('aria-pressed',String(this.enabled));button.setAttribute('aria-label',this.enabled?'캐릭터 움직임 일시정지':'캐릭터 움직임 재개');button.title=this.enabled?'캐릭터 움직임 일시정지':'캐릭터 움직임 재개';button.textContent=this.enabled?'Ⅱ':'▷';}
  }
  setMotion(enabled){this.enabled=Boolean(enabled)&&!this.reduced.matches;try{localStorage.setItem('fw-room-motion-v1',this.enabled?'on':'off');}catch{}this.applyMotion();this.renderPoses();this.schedule();}
  setVisible(visible){this.visible=visible;this.schedule();}
  schedule(){
    const active=this.visible&&!document.hidden&&this.enabled&&this.bots.length>0;
    if(!active){if(this.frame)cancelAnimationFrame(this.frame);this.frame=null;this.lastTime=null;return;}
    if(!this.frame)this.frame=requestAnimationFrame(this.paint);
  }
  paint(now){
    this.frame=null;if(!this.visible||document.hidden||!this.enabled)return;
    if(this.lastTime!=null)this.elapsed+=Math.min(.1,(now-this.lastTime)/1000);this.lastTime=now;
    if(now-this.lastPaint>=1000/30){this.renderPoses();this.lastPaint=now;}
    this.schedule();
  }
  renderPoses(){
    if(!this.actors)return;
    const order=[];
    for(const bot of this.bots){
      const node=this.actors.get(bot.id),home=this.layout.positions.get(bot.id),pose=actorPose(bot,home,this.actorTime(bot.id));if(!node)continue;
      node.setAttribute('transform',`translate(${Math.round(pose.x*2)/2} ${Math.round(pose.y*2)/2})`);
      for(const direction of ['up','down','left','right'])node.classList.toggle('facing-'+direction,pose.direction===direction);
      const sprite=this.sprites?.get(bot.id),row={down:0,left:1,right:2,up:3}[pose.direction],frame=pose.walking&&this.enabled?[0,1,2,1][Math.floor(this.actorTime(bot.id)*6)%4]:1;
      if(sprite){const viewBox=spriteViewBox(pose.direction,frame);if(sprite.getAttribute('viewBox')!==viewBox)sprite.setAttribute('viewBox',viewBox);}
      node.classList.toggle('is-walking',pose.walking);node.classList.toggle('is-working',pose.working);order.push({node,y:pose.y});
      node.classList.toggle('menu-held',bot.id===this.heldId);
    }
    // Sort feet, like a top-down game's sprite layer; only move DOM nodes if needed.
    const layer=this.root.querySelector('.room-actors');order.sort((a,b)=>a.y-b.y);order.forEach((actor,index)=>{if(layer.children[index]!==actor.node)layer.insertBefore(actor.node,layer.children[index]||null);});
  }
  actorTime(id){return (this.heldId===id?this.heldAt:this.elapsed)-(this.timeOffsets.get(id)||0);}
  hold(id){
    if(this.heldId){this.timeOffsets.set(this.heldId,(this.timeOffsets.get(this.heldId)||0)+this.elapsed-this.heldAt);this.actors?.get(this.heldId)?.classList.remove('menu-held');}
    this.heldId=id;this.heldAt=this.elapsed;if(id)this.actors?.get(id)?.classList.add('menu-held');
  }
  position(id){const bot=this.bots.find(bot=>bot.id===id),home=this.layout.positions.get(id);return bot&&home?actorPose(bot,home,this.actorTime(id)):null;}
}
