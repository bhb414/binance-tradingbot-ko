import {renderRoom,roomLayout,actorPose} from './room-world.js';
import {avatarSignature,avatarSprite,seatedAvatar,spriteViewBox} from './avatar.js';
import {positionEmotion,emotionBubble,workstationEffect} from './workroom-metrics.js';
const setAttribute=(node,name,value)=>{if(node&&node.getAttribute(name)!==String(value))node.setAttribute(name,String(value));};
const setLabel=(node,label)=>{if(!node)return;setAttribute(node,'aria-label',label);const title=node.querySelector('title');if(title&&title.textContent!==label)title.textContent=label;};
const effectKind=(bot,mood)=>bot.status==='running'&&Number.isFinite(mood.value)&&Math.abs(mood.value)>=1e-8?(mood.value>0?'gain':'loss'):'none';

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
    // Only membership/order changes affect the office layout. Keep image nodes alive
    // across price, emotion, task and status updates so the scene never flashes.
    const key=JSON.stringify(bots.map(bot=>bot.id));
    const rebuilt=key!==this.key||!this.root.firstElementChild;
    if(rebuilt){
      this.key=key;this.layout=roomLayout(bots);this.root.innerHTML=renderRoom(bots,{selectedId,filter});this.root.dataset.sceneRevision=String(Number(this.root.dataset.sceneRevision||0)+1);
      this.actors=new Map([...this.root.querySelectorAll('[data-select-map-bot]')].map(node=>[node.dataset.selectMapBot,node]));
      this.sprites=new Map([...this.actors].map(([id,node])=>[id,node.querySelector('.sprite-person')]));
      this.stations=new Map([...this.root.querySelectorAll('[data-workstation-bot]')].map(node=>[node.dataset.workstationBot,node]));
      this.appearances=new Map(bots.map(bot=>[bot.id,avatarSignature(bot)]));
      this.moods=new Map(bots.map(bot=>[bot.id,positionEmotion(bot).kind]));
      this.effects=new Map(bots.map(bot=>[bot.id,effectKind(bot,positionEmotion(bot))]));
      this.root.style.setProperty('--world-width',this.layout.width+'px');this.root.style.setProperty('--world-height',this.layout.height+'px');this.applyMotion();
    }
    for(const bot of bots){
      const node=this.actors.get(bot.id),home=this.layout.positions.get(bot.id),selected=bot.id===selectedId,dim=filter!=='all'&&filter!==bot.status,mood=positionEmotion(bot);
      home.work=bot.status==='running';
      node.classList.toggle('selected',selected);node.classList.toggle('dimmed',dim);setAttribute(node,'aria-pressed',selected);setAttribute(node,'tabindex',dim?'-1':'0');
      setAttribute(node,'aria-label',bot.name+' · '+bot.symbol+' · '+(home.work?'일하는 중':'대기 중')+' · 메뉴 열기');
      const appearance=avatarSignature(bot);
      if(this.appearances.get(bot.id)!==appearance){
        node.querySelector('.standing-person').innerHTML=avatarSprite(bot,{x:-40,y:-78,size:80});
        node.querySelector('.seated-person').outerHTML=seatedAvatar(bot);
        this.sprites.set(bot.id,node.querySelector('.sprite-person'));this.appearances.set(bot.id,appearance);
      }
      if(this.moods.get(bot.id)!==mood.kind){node.querySelector('.actor-mood').innerHTML=emotionBubble(bot);this.moods.set(bot.id,mood.kind);}
      setLabel(node.querySelector('.mood-bubble'),mood.label);
      const station=this.stations.get(bot.id);
      if(station){
        station.classList.toggle('desk-active',home.work);
        setAttribute(station.querySelector('.workstation-screen'),'fill',home.work?'#79b69d':'#9baeb6');
        setAttribute(station.querySelector('.workstation-light'),'fill',home.work?'#b6e4aa':'#95a5ad');
        const effect=effectKind(bot,mood);
        if(this.effects.get(bot.id)!==effect){station.querySelector('.workstation-mood').innerHTML=home.work?workstationEffect(bot,home.x,home.y):'';this.effects.set(bot.id,effect);}
        const effectNode=station.querySelector('.workstation-effect');
        if(effectNode){setAttribute(effectNode,'aria-label',mood.label);const title=effectNode.querySelector('title'),label=mood.label+' · 현재 손익 상태를 나타내는 시각 효과';if(title.textContent!==label)title.textContent=label;}
      }
    }
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
      setAttribute(node,'transform',`translate(${Math.round(pose.x*2)/2} ${Math.round(pose.y*2)/2})`);
      for(const direction of ['up','down','left','right'])node.classList.toggle('facing-'+direction,pose.direction===direction);
      const sprite=this.sprites?.get(bot.id),frame=pose.walking&&this.enabled?[0,1,2,1][Math.floor(this.actorTime(bot.id)*6)%4]:1;
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
