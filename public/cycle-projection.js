import {studyTimeAt} from './study-time.js';
export const CYCLE_PROJECTION_PLOTS=[{key:'cycleElapsedProjection',parent:'elapsed',label:'경과 연장'},{key:'cycleTargetProjection',parent:'interval',label:'기준값 가로 연장'}];

// A narrower viewport must retain the observation anchoring the future lines.
// Leave a view of older history untouched when the user has panned away.
export function projectionVisibleRange(range,count,bars){
 if(!range||count<1||bars<1||range.to<count-8)return range;
 return {from:Math.min(range.from,count-13),to:Math.max(range.to,count-1+bars+4)};
}

// CYCLE metadata is already aligned to the selected live/closed observation.
// Start at its last displayed point; applying another lag would detach the line.
export function projectCycleProgress(study,raw,cycle,interval='1m'){
 const empty={plots:[],horizon:0,meetingBars:null,withinHorizon:false};
 const p=study.params,meta=cycle?.at(-1),horizon=p.projectionBars;
 if(!p.showProjection||!raw.length||!meta||!Number.isInteger(horizon)||horizon<1||horizon>300)return empty;
 const basis=p.display==='ratio'?meta.basis:1;
 if(!Number.isFinite(basis)||basis<=0)return empty;
 const target=p.predictionSource==='interval'?meta.interval:meta.prediction,elapsed=meta.elapsed;
 const colors={elapsed:meta.direction===-1?study.styles.elapsed.negative:study.styles.elapsed.color,interval:study.styles.interval.color};
 const plots=CYCLE_PROJECTION_PLOTS.map(plot=>{
  const start=plot.parent==='elapsed'?elapsed:target;
  const data=!study.styles[plot.parent].visible||!Number.isFinite(start)?[]:Array.from({length:horizon+1},(_,h)=>{
   const time=studyTimeAt(raw,raw.length-1+h,interval),value=(start+(plot.parent==='elapsed'?h:0))/basis;
   return time===null?null:{time,value,color:colors[plot.parent]};
  }).filter(Boolean);
  return {...plot,projection:true,data};
 });
 const meeting=Number.isFinite(target)&&Number.isFinite(elapsed)?target-elapsed:null;
 const meetingBars=Number.isFinite(meeting)&&meeting>=0?meeting:null;
 return {plots,horizon,meetingBars,withinHorizon:meetingBars!==null&&meetingBars<=horizon};
}
