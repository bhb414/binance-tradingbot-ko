const within=(v,a,b,pad=0)=>v>=Math.min(a,b)-pad&&v<=Math.max(a,b)+pad;
function nearSegment(p,a,b,tolerance){if(!a||!b||![a.x,a.y,b.x,b.y].every(Number.isFinite))return false;const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=tolerance;}
export function primaryChartHit(chart,series,candles,type,event){
 const p=event.point;if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||(event.paneIndex??0)!==0)return false;
 const candle=candles.get(event.time);if(!candle)return false;const scale=chart.timeScale(),x=scale.timeToCoordinate(event.time),tolerance=6;if(!Number.isFinite(x))return false;
 if(['standard','heikin','bar'].includes(type)){
  const y=Object.fromEntries(['open','high','low','close'].map(k=>[k,series.priceToCoordinate(candle[k])]));if(!Object.values(y).every(Number.isFinite))return false;
  const half=Math.max(1,(scale.options().barSpacing||7)*.35);
  if(Math.abs(p.x-x)<=tolerance&&within(p.y,y.high,y.low,tolerance))return true;
  if(type==='bar')return nearSegment(p,{x:x-half,y:y.open},{x,y:y.open},tolerance)||nearSegment(p,{x,y:y.close},{x:x+half,y:y.close},tolerance);
  return within(p.x,x-half,x+half,2)&&within(p.y,y.open,y.close,2);
 }
 const rows=[...candles.values()],index=rows.findIndex(c=>c.time===event.time),point=c=>c?{x:scale.timeToCoordinate(c.time),y:series.priceToCoordinate(c.close)}:null;
 for(let i=Math.max(0,index-1);i<=Math.min(rows.length-2,index);i++){const a=point(rows[i]),b=point(rows[i+1]);if(type==='step'){const corner={x:b.x,y:a.y};if(nearSegment(p,a,corner,tolerance)||nearSegment(p,corner,b,tolerance))return true;}else if(nearSegment(p,a,b,tolerance))return true;}
 return nearSegment(p,{x,y:series.priceToCoordinate(candle.close)},{x,y:series.priceToCoordinate(candle.close)},tolerance);
}

// Use the library hit result when available, and geometry as a fallback for thin,
// dashed, histogram and separate-pane study plots.
export function studyChartHit(chart,rows,event){
 const p=event.point;if(!p||![p.x,p.y].every(Number.isFinite))return false;const scale=chart.timeScale(),pane=event.paneIndex??0,spacing=scale.options().barSpacing||7;
 for(const row of rows){if(row.pane!==pane)continue;for(const plot of row.plots){if(plot.fillOnly)continue;if(event.hoveredInfo?.series===plot.series||event.hoveredSeries===plot.series)return true;const data=plot.data||[];let index=data.findIndex(c=>c.time===event.time);if(index<0){let distance=Infinity;data.forEach((c,i)=>{const x=scale.timeToCoordinate(c.time);if(Number.isFinite(x)&&Math.abs(x-p.x)<distance){index=i;distance=Math.abs(x-p.x);}});}if(index<0)continue;const tolerance=Math.max(6,(row.study?.styles?.[plot.key]?.width||1)/2+4),point=c=>c&&Number.isFinite(c.value)?{x:scale.timeToCoordinate(c.time),y:plot.series.priceToCoordinate(c.value)}:null;
 if(plot.histogram){for(const c of data.slice(Math.max(0,index-1),index+2)){const a=point(c),zero=plot.series.priceToCoordinate(0);if(a&&Number.isFinite(a.x)&&Number.isFinite(a.y)&&Number.isFinite(zero)&&within(p.x,a.x-spacing*.45,a.x+spacing*.45,2)&&within(p.y,a.y,zero,3))return true;}}
 else{for(let i=Math.max(0,index-1);i<=Math.min(data.length-2,index);i++)if(nearSegment(p,point(data[i]),point(data[i+1]),tolerance))return true;const a=point(data[index]);if(nearSegment(p,a,a,tolerance))return true;}
 }}return false;
}
export function nearestChartTime(chart,candles,event){
 if(candles.has(event.time))return event.time;const p=event.point;if(!p||!Number.isFinite(p.x)||!chart.timeScale)return null;const scale=chart.timeScale(),limit=(scale.options?.().barSpacing||7)/2+6;let time=null,distance=Infinity;for(const key of candles.keys()){const x=scale.timeToCoordinate(key);if(Number.isFinite(x)&&Math.abs(p.x-x)<distance){distance=Math.abs(p.x-x);time=key;}}return distance<=limit?time:null;
}
