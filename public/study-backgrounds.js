export function backgroundLayers(rows){
 const layers=[];for(const {study,data,active=true} of rows){if(!active||!study.visible||data.error)continue;
  for(const plot of data.plots||[]){const style=study.styles[plot.key];if(plot.background&&style?.visible&&style.transparency<100)layers.push({data:plot.data,color:style.color,transparency:style.transparency});}
 }return layers;
}
export class CandleBackground{
 constructor(){this.layers=[];this.columns=[];this.view={zOrder:()=> 'bottom',renderer:()=>({draw:target=>this.draw(target)})};}
 attached({chart,requestUpdate}){this.chart=chart;this.requestUpdate=requestUpdate;}
 detached(){this.chart=null;this.requestUpdate=null;this.columns=[];}
 update(layers){this.layers=layers;this.requestUpdate?.();}
 updateAllViews(){
  if(!this.chart){this.columns=[];return;}const scale=this.chart.timeScale(),range=scale.getVisibleRange();this.spacing=Math.max(.1,scale.options().barSpacing||1);
  this.columns=this.layers.map(layer=>({...layer,x:layer.data.flatMap(p=>{if(p.value!==1||range&&(p.time<range.from||p.time>range.to))return [];const x=scale.timeToCoordinate(p.time);return Number.isFinite(x)?[x]:[];})}));
 }
 paneViews(){return [this.view];}
 draw(target){if(!this.columns.length)return;target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{
  if(!mediaSize?.height)return;ctx.save();for(const layer of this.columns){ctx.fillStyle=layer.color;ctx.globalAlpha=1-layer.transparency/100;let left=null,right=null;
   const flush=()=>{if(left!==null&&right>0&&left<mediaSize.width)ctx.fillRect(Math.max(0,left),0,Math.min(mediaSize.width,right)-Math.max(0,left),mediaSize.height);left=right=null;};
   for(const x of layer.x){const a=x-this.spacing/2,b=x+this.spacing/2;if(left!==null&&a<=right+.01)right=b;else{flush();left=a;right=b;}}flush();
  }ctx.restore();
 });}
}
export class StudyBackgrounds{
 constructor(series){this.primitive=new CandleBackground();this.setSeries(series);}
 setSeries(series){this.series?.detachPrimitive(this.primitive);this.series=series;series.attachPrimitive(this.primitive);}
 update(rows){this.primitive.update(backgroundLayers(rows));}
 clear(){this.primitive.update([]);}
}
