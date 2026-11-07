// Hypothetical returns relative to today's reference close, not order signals.
// Scan in order and keep only the first positive long and positive short case.
export class CyclePriceArrows{
 constructor(series,{createMarkers=window.LightweightCharts.createSeriesMarkers,schedule=fn=>setTimeout(fn,0),cancel=id=>clearTimeout(id)}={}){
  this.plugin=createMarkers(series,[],{autoScale:false});this.schedule=schedule;this.cancel=cancel;this.version=0;this.signature='';this.solver=null;
 }
 update({study,context,solver,path=[]}){
  const signature=JSON.stringify([study.params.showPositiveTargets,study.params.priceTargetMultiplier,study.styles.elapsed.visible,study.styles.elapsed.color,study.styles.elapsed.negative,path.map(p=>p.time)]);
  if(this.solver===solver&&this.signature===signature)return;
  this.clear();this.solver=solver;this.signature=signature;
  if(!study.params.showPositiveTargets||!study.styles.elapsed.visible||!context||!solver||path.length<2)return;
  const version=this.version,found=new Set(),markers=[];let bars=1;
  const scan=()=>{
   if(version!==this.version)return;
   // Yield between horizons so expensive nonlinear estimates cannot accumulate
   // into a whole-chart synchronous scan. A new observation cancels old work.
   const result=solver.at(bars),change=result.price===null?null:(result.price/context.referencePrice-1)*100*study.params.priceTargetMultiplier;
   if(Number.isFinite(change)&&Math.abs(change)>1e-7&&result.crossingSide&&result.earlierCross===null&&result.earlierTouch===null){
    const side=change>0?'long':'short';if(!found.has(side)){
     found.add(side);markers.push({id:'cycle-positive:'+study.id+':'+side,time:path[bars].time,position:side==='long'?'belowBar':'aboveBar',shape:side==='long'?'arrowUp':'arrowDown',color:side==='long'?study.styles.elapsed.color:study.styles.elapsed.negative,text:side==='long'?'롱':'숏',size:1});
     this.plugin.setMarkers([...markers].sort((a,b)=>a.time-b.time));
    }
   }
   bars++;if(bars<path.length&&found.size<2)this.timer=this.schedule(scan);
  };
  this.timer=this.schedule(scan);
 }
 clear(){this.version++;this.cancel(this.timer);this.timer=null;this.solver=null;this.signature='';this.plugin.setMarkers([]);}
 destroy(){this.clear();this.plugin.detach();}
}
