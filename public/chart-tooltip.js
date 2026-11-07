// A pinned candle readout floats inside the chart, without changing its layout.
export function installChartTooltip(host,{chart,series,chartElement,onDismiss}){
 let view=null,frame=0,pointer=null,anchorPoint=null;const area=host.parentElement;
 host.classList.add('chart-candle-tooltip');host.hidden=true;host.setAttribute('role','region');
 const contain=event=>event.stopPropagation(),containedEvents=['pointerdown','click','dblclick','wheel'];
 for(const name of containedEvents)host.addEventListener(name,contain);
 const set=(key,value)=>{if(host.style[key]!==value)host.style[key]=value;};
 function position(){
  frame=0;if(!(view?.pinned||view?.projection&&view.hovered)||!(view.candle||view.projection)){host.hidden=true;return;}
  const box=area.getBoundingClientRect(),canvas=chartElement.getBoundingClientRect(),viewport=window.visualViewport;
  const screenLeft=viewport?.offsetLeft||0,screenTop=viewport?.offsetTop||0,screenRight=screenLeft+(viewport?.width||window.innerWidth),screenBottom=screenTop+(viewport?.height||window.innerHeight);
  const bounds={left:Math.max(8,canvas.left-box.left+8,screenLeft-box.left+8),right:Math.min(box.width-8,canvas.right-box.left-8,screenRight-box.left-8),top:Math.max(8,canvas.top-box.top+8,screenTop-box.top+8),bottom:Math.min(box.height-8,canvas.bottom-box.top-8,screenBottom-box.top-16)};
  const x=chart.timeScale().timeToCoordinate(view.time);
  if(!box.width||!box.height||x===null||x<0||x>canvas.width||bounds.right-bounds.left<140||bounds.bottom-bounds.top<70){host.hidden=true;return;}
  const y=Number.isFinite(view.point?.y)?view.point.y:(view.candle?series.priceToCoordinate(view.candle.close):null)??canvas.height/2,anchor={x:canvas.left-box.left+x,y:canvas.top-box.top+y};
  set('width',Math.min(310,bounds.right-bounds.left)+'px');set('maxHeight',Math.min(360,bounds.bottom-bounds.top)+'px');host.hidden=false;
  const width=host.offsetWidth,height=host.offsetHeight,gap=16;
  let left=anchor.x+gap;if(left+width>bounds.right)left=anchor.x-width-gap;
  let top=anchor.y-height/2;if(top+height>bounds.bottom)top=bounds.bottom-height;
  set('left',Math.max(bounds.left,Math.min(left,bounds.right-width))+'px');set('top',Math.max(bounds.top,Math.min(top,bounds.bottom-height))+'px');
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(position);}
 const remember=event=>{const rect=chartElement.getBoundingClientRect();pointer={x:event.clientX-rect.left,y:event.clientY-rect.top};};
 chartElement.addEventListener('pointerdown',remember,{capture:true,passive:true});
 const outside=event=>{if(view?.pinned&&!host.contains(event.target))onDismiss();};
 const escape=event=>{if(event.key==='Escape'&&view?.pinned&&!host.hidden){event.preventDefault();event.stopPropagation();onDismiss();}};
 document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);
 window.addEventListener('scroll',schedule,{capture:true,passive:true});window.addEventListener('resize',schedule);
 window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
 const observer=new ResizeObserver(schedule);observer.observe(area);observer.observe(host);
 chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
 return {setSeries(next){series=next;schedule();},update(next){if(next.selected)anchorPoint=pointer||next.point;if(!next.pinned)anchorPoint=null;view={...next,point:anchorPoint||next.point};if(!(view.pinned||view.projection&&view.hovered)||!(view.candle||view.projection))host.hidden=true;else schedule();},destroy(){for(const name of containedEvents)host.removeEventListener(name,contain);cancelAnimationFrame(frame);observer.disconnect();chartElement.removeEventListener('pointerdown',remember,true);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);chart.timeScale().unsubscribeVisibleLogicalRangeChange(schedule);host.hidden=true;}};
}
