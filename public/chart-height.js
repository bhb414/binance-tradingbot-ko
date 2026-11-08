export const CHART_HEIGHT_KEY='fw-chart-height-v1';
const validRatio=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=3;
export function chartHeightBounds(viewport){return {min:260,max:Math.max(260,Math.round(viewport*3))};}
export function chartHeightForViewport(viewport,ratio=null){
 const {min,max}=chartHeightBounds(viewport),height=validRatio(ratio)?viewport*ratio:Math.min(1000,viewport*.65);
 return Math.round(Math.max(min,Math.min(max,height)));
}
// Total height and pane proportions are independent: the library divides this
// fixed viewport among its panes; only this handle changes the outer height.
export function installChartHeight(panel,handle,{storage,window:win=panel.ownerDocument.defaultView,frame=callback=>win.requestAnimationFrame(callback),cancel=id=>win.cancelAnimationFrame(id)}={}){
 const doc=panel.ownerDocument;let ratio=null,drag=null,pending=null,frameId=null;
 try{storage??=win.localStorage;const saved=JSON.parse(storage?.getItem(CHART_HEIGHT_KEY)||'null');if(saved?.version===1&&validRatio(saved.ratio))ratio=saved.ratio;}catch{}
 const viewport=()=>Math.max(1,win.innerHeight),body=panel.querySelector('.chart-body'),fullscreen=()=>panel.classList.contains('is-chart-fullscreen');
 const paint=height=>{const {min,max}=chartHeightBounds(viewport());height=Math.round(Math.max(min,Math.min(max,height)));panel.style.setProperty('--chart-body-height',height+'px');handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(max));handle.setAttribute('aria-valuenow',String(height));handle.setAttribute('aria-valuetext',height+'픽셀');return height;};
 const flush=()=>{if(frameId!==null)cancel(frameId);frameId=null;if(pending!==null){paint(pending);pending=null;}};
 const save=()=>{try{if(ratio===null)storage?.removeItem(CHART_HEIGHT_KEY);else storage?.setItem(CHART_HEIGHT_KEY,JSON.stringify({version:1,ratio}));}catch{}};
 const remember=()=>{ratio=Number(handle.getAttribute('aria-valuenow'))/viewport();save();};
 const finish=()=>{if(!drag)return;const id=drag.id;drag=null;flush();doc.documentElement.classList.remove('chart-height-dragging');try{if(handle.hasPointerCapture?.(id))handle.releasePointerCapture(id);}catch{}remember();};
 const refresh=()=>{if(drag)return;paint(chartHeightForViewport(viewport(),ratio));};
 const reset=()=>{if(fullscreen())return;finish();ratio=null;save();refresh();};
 const down=event=>{if(fullscreen()||drag||event.button!==0||event.isPrimary===false)return;event.preventDefault();event.stopPropagation();drag={id:event.pointerId,y:event.clientY,height:body.getBoundingClientRect().height};doc.documentElement.classList.add('chart-height-dragging');try{handle.setPointerCapture(event.pointerId);}catch{}};
 const move=event=>{if(!drag||event.pointerId!==drag.id)return;event.preventDefault();pending=drag.height+event.clientY-drag.y;if(frameId===null)frameId=frame(()=>{frameId=null;if(pending!==null){paint(pending);pending=null;}});};
 const up=event=>{if(drag?.id===event.pointerId)finish();};
 const key=event=>{if(fullscreen())return;if(event.key==='Home'){event.preventDefault();reset();return;}if(!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();paint(body.getBoundingClientRect().height+(event.key==='ArrowUp'?-1:1)*(event.shiftKey?80:24));remember();};
 handle.addEventListener('pointerdown',down);handle.addEventListener('keydown',key);handle.addEventListener('dblclick',reset);doc.addEventListener('pointermove',move,{capture:true,passive:false});doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',up,true);win.addEventListener('resize',refresh);refresh();
 return {refresh,destroy(){finish();handle.removeEventListener('pointerdown',down);handle.removeEventListener('keydown',key);handle.removeEventListener('dblclick',reset);doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',up,true);win.removeEventListener('resize',refresh);}};
}
