const within=(v,a,b,pad=0)=>v>=Math.min(a,b)-pad&&v<=Math.max(a,b)+pad;
function nearSegment(p,a,b,tolerance){if(!a||!b||![a.x,a.y,b.x,b.y].every(Number.isFinite))return false;const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=tolerance;}
export function primaryChartHit(chart,series,candles,type,event){
 const p=event.point;if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||(event.paneIndex??0)!==0)return false;
 const candle=candles.get(event.time);if(!candle)return false;const scale=chart.timeScale(),x=scale.timeToCoordinate(event.time),tolerance=4;if(!Number.isFinite(x))return false;
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
