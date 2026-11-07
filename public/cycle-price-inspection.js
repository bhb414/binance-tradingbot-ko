import {installChartTooltip} from './chart-tooltip.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setText=(element,value)=>{if(element.textContent!==value)element.textContent=value;};

// Future observations never become fake candles or historical indicator values.
export class CyclePriceInspection{
 constructor({chart,read,onChange,onSelect=()=>{},isDrawing=()=>false,isCandlePinned=()=>false,isTooltipHovered=()=>false,schedule=fn=>setTimeout(fn,0),cancel=id=>clearTimeout(id),frame=null,cancelFrame=()=>{}}){
  Object.assign(this,{chart,read,onChange,onSelect,isDrawing,isCandlePinned,isTooltipHovered,schedule,cancel,frame,cancelFrame});this.event=null;this.pinned=false;
  this.applyMove=event=>{
   if(this.pinned||this.isDrawing()||this.isTooltipHovered())return;this.cancel(this.hideTimer);
   if(this.event?.time===event.time&&this.event?.paneIndex===event.paneIndex)return;
   const reading=this.read(event);
   if(!reading){if(!this.event){this.release();return;}this.hideTimer=this.schedule(()=>{if(!this.pinned&&!this.isTooltipHovered())this.release();});return;}
   this.event=event;this.publish(this.isCandlePinned()?null:reading);
  };
  this.move=event=>{if(this.pinned||this.isDrawing()||this.isTooltipHovered())return;if(!this.frame){this.applyMove(event);return;}this.pendingEvent=event;if(!this.moveFrame)this.moveFrame=this.frame(()=>{this.moveFrame=null;const next=this.pendingEvent;this.pendingEvent=null;if(next)this.applyMove(next);});};
  this.click=event=>{
   this.cancelMove();if(this.isDrawing())return;const reading=this.read(event);
   if(!reading){this.release();return;}
   this.onSelect();this.event=event;this.pinned=true;this.publish(reading,true);
  };
  chart.subscribeCrosshairMove(this.move);chart.subscribeClick(this.click);
 }
 publish(reading,selected=false){this.onChange(reading?{reading,event:this.event,pinned:this.pinned,selected}:null);}
 cancelMove(){this.cancelFrame(this.moveFrame);this.moveFrame=null;this.pendingEvent=null;}
 pinCurrent(){if(this.pinned||this.isDrawing()||!this.event)return;this.cancelMove();const reading=this.read(this.event);if(!reading)return;this.cancel(this.hideTimer);this.onSelect();this.pinned=true;this.publish(reading);}
 refresh(){
  const reading=this.event&&!(this.isCandlePinned()&&!this.pinned)?this.read(this.event):null;
  if(!reading){this.pinned=false;this.event=null;}this.publish(reading);
 }
 release(){this.cancelMove();this.cancel(this.hideTimer);this.event=null;this.pinned=false;this.publish(null);}
 destroy(){this.chart.unsubscribeCrosshairMove(this.move);this.chart.unsubscribeClick(this.click);this.release();}
}

export function installCyclePriceInspection({chart,studies,chartElement,series,isDrawing,isCandlePinned,onSelect,formatTime}){
 const host=document.createElement('div');host.className='chart-readout chart-cycle-price-tooltip';host.setAttribute('aria-label','주기분석 교차 필요가격');host.hidden=true;chartElement.parentElement.append(host);
 host.innerHTML='<div class="chart-readout-heading"><time></time><span></span><button type="button" aria-label="교차 필요가격 닫기">×</button></div><div class="chart-tooltip-body"><strong data-cycle-price-summary></strong><div data-cycle-price-elapsed></div><p data-cycle-price-notice></p><details><summary>필요가격·계산 가정</summary><div data-cycle-price-details></div></details><small data-cycle-price-pin>클릭하면 고정</small></div>';
 const el={time:host.querySelector('time'),kind:host.querySelector('.chart-readout-heading>span'),summary:host.querySelector('[data-cycle-price-summary]'),elapsed:host.querySelector('[data-cycle-price-elapsed]'),notice:host.querySelector('[data-cycle-price-notice]'),details:host.querySelector('[data-cycle-price-details]'),pin:host.querySelector('[data-cycle-price-pin]')};
 let tooltip;
 const controller=new CyclePriceInspection({chart,read:event=>studies.projectionReading(event),isDrawing,isCandlePinned,onSelect,isTooltipHovered:()=>host.matches(':hover'),frame:fn=>requestAnimationFrame(fn),cancelFrame:id=>cancelAnimationFrame(id),onChange:view=>{
  if(!view){tooltip?.update({pinned:false});host.hidden=true;return;}
  const {reading:r,event,pinned,selected}=view;
  host.dataset.pinned=String(pinned);
  setText(el.time,formatTime(r.time));setText(el.kind,r.label+' · 현재 기준 교차 필요가격');setText(el.summary,r.summary);setText(el.elapsed,r.elapsed);setText(el.notice,r.notice);el.pin.hidden=pinned;
  const html=(r.target?'<p><b>반복할 실제 종가</b><br>'+esc(r.target)+'</p>':'')+'<p>'+esc(r.reference)+'</p><p>'+esc(r.assumption)+'</p>';if(el.details.innerHTML!==html)el.details.innerHTML=html;
  let top=0;for(let i=0;i<(event.paneIndex||0);i++)top+=(chart.panes()[i]?.getHeight()||0)+1;
  const point=event.point?{x:event.point.x,y:event.point.y+top}:null;
  tooltip?.update({time:r.time,point,pinned,selected,hovered:true,projection:true});
 }});
 tooltip=installChartTooltip(host,{chart,series,chartElement,onDismiss:()=>controller.release()});
 // Interacting with the floating box must never activate its covered chart or
 // legend. Pin the current hover observation before handling its own controls.
 host.addEventListener('pointerdown',event=>{event.stopPropagation();controller.pinCurrent();});
 host.querySelector('button').addEventListener('click',()=>controller.release());
 return {refresh:()=>controller.refresh(),setSeries:next=>tooltip.setSeries(next),destroy(){controller.destroy();tooltip.destroy();host.remove();}};
}
