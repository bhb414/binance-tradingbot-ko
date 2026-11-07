// Pixel-bounded sampling keeps the half-step grid responsive even if a scale
// spans thousands of multiples. Only lines intersecting the visible pane draw.
export function cycleRatioGridRows(series,height){
 if(!Number.isFinite(height)||height<=0)return [];
 const found=new Map(),put=value=>{const y=series.priceToCoordinate(value);if(Number.isFinite(y)&&y>=0&&y<=height)found.set(Math.round(y),{value,y});};
 put(.25);put(.5);put(.75);
 for(let y=0;y<=Math.ceil(height);y++){
  const price=series.coordinateToPrice(y);if(!Number.isFinite(price))continue;
  const value=Math.round(price*2)/2;if(value>=1)put(value);
 }
 return [...found.values()];
}
export class CycleRatioGrid{
 constructor(){this.view={zOrder:()=> 'bottom',renderer:()=>({draw:target=>this.draw(target)})};}
 attached({series}){this.series=series;}
 detached(){this.series=null;}
 paneViews(){return [this.view];}
 draw(target){if(!this.series)return;target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{
  const rows=cycleRatioGridRows(this.series,mediaSize.height);ctx.save();ctx.strokeStyle='#c5c6cc';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();
  for(const {y}of rows){const at=Math.round(y)+.5;ctx.moveTo(0,at);ctx.lineTo(mediaSize.width,at);}ctx.stroke();ctx.restore();
 });}
}
