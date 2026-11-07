import {STUDIES,studyLabel,studyPlots} from './chart-studies.js';
import {movingAverageLegend} from './moving-average-legend.js';
function formatValue(study,value){return Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:STUDIES[study.type].precision??(study.type==='VOLUME'?0:['FORMULA','SCRIPT'].includes(study.type)?8:Math.abs(value)<.1?8:2)})+(study.type==='CYCLE'?(study.params.display==='bars'?'봉':'배'):STUDIES[study.type].unit?' '+STUDIES[study.type].unit:''):'—';}
// Compact labels contain names and swatches; keyed values remain in their tooltips.
export function compactStudyLegend(study,points=[]){
 if(study.type==='MA_FORECAST'){
  const values=new Map((points||[]).map(p=>[p.key,p.value]));
  return {heading:'이평 예상 · '+study.params.horizon+'봉',entries:studyPlots(study).filter(p=>!p.projection&&(study.styles[p.key].visible||study.styles['forecast'+p.key.slice(2)].visible)).map(p=>{
   const i=p.key.slice(2),current=study.styles[p.key].visible&&Number.isFinite(values.get(p.key)),key=current?p.key:study.styles['forecast'+i].visible?'forecast'+i:p.key,value=values.get(key),label=study.params['type'+i]+' '+study.params['period'+i];
   return {key:p.key,label,fullLabel:'이평 예상 '+label,color:study.styles[key].color,text:(!current&&Number.isFinite(value)?'예상 ':'')+formatValue(study,value)};
  })};
 }
 if(study.type==='MA_SET')return {heading:study.params.average,entries:movingAverageLegend(study,points).map(entry=>({...entry,fullLabel:entry.label,label:String(study.params['period'+entry.key.slice(2)])}))};
 const label=study.type==='VWMA'?'VWMA '+study.params.period:studyLabel(study),plots=studyPlots(study),values=new Map((points||[]).map(p=>[p.key,p.value])),multiple=plots.length>1;
 return {heading:multiple?(study.type==='CYCLE'?study.params.average+' '+study.params.fast+'/'+study.params.slow:study.type==='BB'?'BB '+study.params.period+'·'+study.params.multiplier:label):'',entries:plots.filter(p=>study.styles[p.key]?.visible).map(p=>({key:p.key,label:multiple?(study.type==='BB'?({upper:'상단',middle:'중심',lower:'하단'}[p.key]||p.label):p.label):label,fullLabel:multiple?label+' '+p.label:label,color:study.styles[p.key].color,text:formatValue(study,values.get(p.key))}))};
}
