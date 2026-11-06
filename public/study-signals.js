// Display-only signals; equal-time markers stack natively above/below candles.
export function studySignalMarkers(rows){
 const entries=[];for(const {study,data,active=true} of rows){if(!active||!study.visible||data.error)continue;
  for(const plot of data.plots||[]){const style=study.styles[plot.key];if(!plot.signal||!style?.visible)continue;
   for(const point of plot.data)if(point.value===1)entries.push({order:style.order??0,index:entries.length,marker:{id:'study-signal:'+study.id+':'+plot.key+':'+point.time,time:point.time,position:style.position||(plot.side==='buy'?'belowBar':'aboveBar'),shape:(style.direction||(plot.side==='buy'?'up':'down'))==='up'?'arrowUp':'arrowDown',color:style.color,text:plot.text??plot.label,size:style.width}});
  }
 }return entries.sort((a,b)=>a.marker.time-b.marker.time||a.order-b.order||a.index-b.index).map(e=>e.marker);
}
export class StudySignals{
 constructor(series,{createMarkers=window.LightweightCharts.createSeriesMarkers}={}){this.createMarkers=createMarkers;this.markers=[];this.signature='';this.setSeries(series);}
 setSeries(series){this.plugin?.detach();this.plugin=this.createMarkers(series,[],{autoScale:true});this.signature='';this.render(this.markers);}
 render(markers){this.markers=markers;const signature=JSON.stringify(markers);if(signature!==this.signature){this.plugin.setMarkers(markers);this.signature=signature;}}
 update(rows){this.render(studySignalMarkers(rows));}
 clear(){this.render([]);}
 dispose(){this.plugin?.detach();this.plugin=null;this.markers=[];this.signature='';}
}
