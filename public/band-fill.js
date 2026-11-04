// Draw only the region between the computed upper/lower Bollinger values.
export function bandRows(plots){
 const upper=plots.find(p=>p.key==='upper')?.data||[],lower=new Map((plots.find(p=>p.key==='lower')?.data||[]).map(p=>[p.time,p.value]));
 return upper.map(p=>({time:p.time,upper:p.value,lower:lower.get(p.time)}));
}
export class BandFill{
 constructor(){this.data=[];this.points=[];this.style={visible:false};const renderer={draw:target=>this.draw(target)};this.view={zOrder:()=> 'bottom',renderer:()=>renderer};}
 attached({chart,series,requestUpdate}){this.chart=chart;this.series=series;this.requestUpdate=requestUpdate;}
 detached(){this.chart=null;this.series=null;this.requestUpdate=null;this.points=[];}
 update(data,style){this.data=data;this.style=style;this.requestUpdate?.();}
 updateAllViews(){
  if(!this.chart||!this.series||!this.style.visible){this.points=[];return;}
  const scale=this.chart.timeScale(),range=scale.getVisibleRange();let from=0,to=this.data.length;
  if(range){let l=0,r=to;while(l<r){const m=(l+r)>>1;if(this.data[m].time<range.from)l=m+1;else r=m;}from=Math.max(0,l-1);l=from;r=to;while(l<r){const m=(l+r)>>1;if(this.data[m].time<=range.to)l=m+1;else r=m;}to=Math.min(this.data.length,l+1);}
  this.points=this.data.slice(from,to).map(p=>Number.isFinite(p.upper)&&Number.isFinite(p.lower)?{x:scale.timeToCoordinate(p.time),upper:this.series.priceToCoordinate(p.upper),lower:this.series.priceToCoordinate(p.lower)}:null);
 }
 paneViews(){return [this.view];}
 draw(target){
  if(!this.style.visible||this.style.transparency>=100||this.points.length<2)return;
  target.useMediaCoordinateSpace(({context:ctx})=>{
   ctx.save();ctx.fillStyle=this.style.color;ctx.globalAlpha=1-this.style.transparency/100;let segment=[];
   const flush=()=>{if(segment.length>1){ctx.beginPath();ctx.moveTo(segment[0].x,segment[0].upper);for(let i=1;i<segment.length;i++)ctx.lineTo(segment[i].x,segment[i].upper);for(let i=segment.length-1;i>=0;i--)ctx.lineTo(segment[i].x,segment[i].lower);ctx.closePath();ctx.fill();}segment=[];};
   for(const p of this.points){if(!p||![p.x,p.upper,p.lower].every(Number.isFinite)){flush();continue;}segment.push(p);}flush();ctx.restore();
  });
 }
}
