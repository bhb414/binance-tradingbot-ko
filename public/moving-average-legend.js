import {studyPlots} from './chart-studies.js';
const formatValue=value=>value.toLocaleString('en-US',{maximumFractionDigits:Math.abs(value)<.1?8:2});
// Match values by plot key, since warmup lengths and selected lines differ.
export function movingAverageLegend(study,points=[],format=formatValue){
 if(study.type!=='MA_SET')return [];
 const values=new Map((points||[]).map(point=>[point.key,point.value]));
 return studyPlots(study).filter(plot=>study.styles[plot.key].visible).map(plot=>{
  const value=values.get(plot.key);
  return {key:plot.key,label:study.params.average+' '+plot.label,color:study.styles[plot.key].color,text:Number.isFinite(value)?format(value):'—'};
 });
}
