import {MAX_STUDIES} from './study-limits.js';
const valid=value=>Number.isFinite(value)&&value>0;
const paneId=(rows,index)=>index===0?'price':rows.find(row=>row.pane===index)?.study.id;
export function capturePaneRatios(chart,rows){
 const panes=chart.panes(),total=panes.reduce((sum,pane)=>sum+pane.getHeight(),0),result={};
 if(!valid(total))return result;
 panes.forEach((pane,index)=>{const id=paneId(rows,index),height=pane.getHeight();if(id&&valid(height))result[id]=height/total;});return result;
}
export function restorePaneRatios(chart,rows,saved={}){
 if(!valid(saved?.price))return;
 chart.panes().forEach((pane,index)=>{const id=paneId(rows,index);if(id&&valid(saved[id]))pane.setStretchFactor(saved[id]/saved.price*3.3);});
}
export function mergePaneRatios(previous={},current={}){
 const scale=valid(previous.price)&&valid(current?.price)?current.price/previous.price:1;
 const merged=Object.fromEntries(Object.entries(previous).map(([id,value])=>[id,value*scale]));for(const [id,value]of Object.entries(current||{})){delete merged[id];merged[id]=value;}
 return Object.fromEntries(Object.entries(merged).slice(-MAX_STUDIES-1));
}
// Capture before chart internals stop propagation, then save after their final
// resize frame. Releasing outside the canvas still completes a pane drag.
export function installPaneResizePersistence(element,save,{document:doc=element.ownerDocument,frame=requestAnimationFrame}={}){
 let dragging=false,scheduled=false;
 const down=()=>{dragging=true;},up=()=>{if(!dragging)return;dragging=false;if(scheduled)return;scheduled=true;frame(()=>{scheduled=false;save();});};
 const capture={capture:true};element.addEventListener('pointerdown',down,capture);doc.addEventListener('pointerup',up,capture);doc.addEventListener('pointercancel',up,capture);
 return ()=>{element.removeEventListener('pointerdown',down,capture);doc.removeEventListener('pointerup',up,capture);doc.removeEventListener('pointercancel',up,capture);};
}
