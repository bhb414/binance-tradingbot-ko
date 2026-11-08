// Break at accepted cross events, independent of the plotted value. The
// forecast may restart above zero, and an estimated ratio may fall without a cross.
export function cycleSegmentData(data,cycle){
 const boundaries=new Set();
 for(let i=1;i<cycle.length;i++){
  const a=cycle[i-1],b=cycle[i];
  if((a.direction!=null&&b.direction!=null&&a.direction!==b.direction)||(b.elapsed===0&&a.elapsed>0))boundaries.add(b.time);
 }
 return data.map(point=>({...point,breakBefore:boundaries.has(point.time)}));
}

// Native line series bridge whitespace points. Draw explicit paths instead,
// retaining their original series data for scaling, crosshairs and axis labels.
export class CycleSegments{
 constructor(){this.data=[];this.points=[];this.style={};this.view={zOrder:()=> 'normal',renderer:()=>({draw:target=>this.draw(target)})};}
 attached({chart,series,requestUpdate}){this.chart=chart;this.series=series;this.requestUpdate=requestUpdate;}
 detached(){this.chart=null;this.series=null;this.requestUpdate=null;this.points=[];}
 update(data,style){this.data=data;this.style=style;this.requestUpdate?.();}
 updateAllViews(){
  if(!this.chart||!this.series){this.points=[];return;}
  const scale=this.chart.timeScale(),range=scale.getVisibleRange();let from=0,to=this.data.length;
  if(range){let l=0,r=to;while(l<r){const m=(l+r)>>1;if(this.data[m].time<range.from)l=m+1;else r=m;}from=Math.max(0,l-1);l=from;r=to;while(l<r){const m=(l+r)>>1;if(this.data[m].time<=range.to)l=m+1;else r=m;}to=Math.min(this.data.length,l+1);}
  this.points=this.data.slice(from,to).map(p=>Number.isFinite(p.value)?{x:scale.timeToCoordinate(p.time),y:this.series.priceToCoordinate(p.value),breakBefore:p.breakBefore,color:p.color||this.style.color}:null);
 }
 paneViews(){return [this.view];}
 draw(target){
  if(!this.points.length)return;
  target.useMediaCoordinateSpace(({context:ctx})=>{
   ctx.save();ctx.lineWidth=this.style.width||1;ctx.lineJoin='round';ctx.lineCap='butt';ctx.setLineDash([[],[1,2],[3,3],[6,6],[1,4]][this.style.lineStyle||0]||[]);
   // A one-bar phase has no stroke. Keep its lone observation visible so an
   // intervening opposite cross does not disappear between same-color phases.
   const isolated=point=>{ctx.fillStyle=point.color||this.style.color;ctx.beginPath();ctx.arc(point.x,point.y,Math.max(2,(this.style.width||1)/2+1),0,Math.PI*2);ctx.fill();};
   let previous=null,length=0;
   for(const point of this.points){
    if(!point||![point.x,point.y].every(Number.isFinite)){if(length===1)isolated(previous);previous=null;length=0;continue;}
    if(point.breakBefore){if(length===1)isolated(previous);previous=null;length=0;}
    if(previous){ctx.strokeStyle=previous.color;ctx.beginPath();ctx.moveTo(previous.x,previous.y);ctx.lineTo(point.x,point.y);ctx.stroke();}
    previous=point;length++;
   }
   if(length===1)isolated(previous);
   ctx.restore();
  });
 }
}
