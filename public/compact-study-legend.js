import {STUDIES,studyLabel,studyPlots} from './chart-studies.js';
import {movingAverageLegend} from './moving-average-legend.js';
function formatValue(study,value){return Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:STUDIES[study.type].precision??(study.type==='VOLUME'?0:['FORMULA','SCRIPT'].includes(study.type)?8:Math.abs(value)<.1?8:2)})+(study.type==='CYCLE'?(study.params.display==='bars'?'봉':'배'):STUDIES[study.type].unit?' '+STUDIES[study.type].unit:''):'—';}
const priceStudies=new Set(['SMA','EMA','VWMA','KAMA','HMA','MA_SET','MA_FORECAST','BB','NW','ICHIMOKU','VWAP']);
const forecastKinds=study=>new Set(studyPlots(study).filter(p=>!p.projection).map(p=>study.params['type'+p.key.slice(2)]));
export const studyLegendDetails=study=>study.type==='BB'?'BB '+study.params.period+' '+study.params.basis+' '+study.source+' '+study.params.multiplier:studyLabel(study);
export function studyLegendHeading(study,model){
 if(study.type==='BB')return 'BB '+study.params.period+'·'+study.params.multiplier;
 if(study.type==='MA_FORECAST'){const kinds=forecastKinds(study);return (kinds.size===1?[...kinds][0]+' 예상':'이평 예상')+' '+study.params.horizon+'봉';}
 return model.heading||studyLabel(study);
}
export function studyLegendEntryParts(study,entry){
 const label=study.type==='MA_FORECAST'&&forecastKinds(study).size===1?entry.label.replace(/^\S+\s+/, ''):entry.label;
 return {parameter:['MA_SET','MA_FORECAST'].includes(study.type)?label:'',reading:entry.text};
}
export function studyLegendEntryText(study,entry){const {parameter,reading}=studyLegendEntryParts(study,entry);return [parameter,reading].filter(Boolean).join(' ');}
// Keep keyed values beside the settings, using the instrument precision for price studies.
export function compactStudyLegend(study,points=[],priceFormatter){
 const format=value=>priceStudies.has(study.type)&&priceFormatter&&Number.isFinite(value)?priceFormatter(value):formatValue(study,value);
 if(study.type==='MA_FORECAST'){
  const values=new Map((points||[]).map(p=>[p.key,p.value]));
  return {heading:'이평 예상 · '+study.params.horizon+'봉',entries:studyPlots(study).filter(p=>!p.projection&&(study.styles[p.key].visible||study.styles['forecast'+p.key.slice(2)].visible)).map(p=>{
   const i=p.key.slice(2),current=study.styles[p.key].visible&&Number.isFinite(values.get(p.key)),key=current?p.key:study.styles['forecast'+i].visible?'forecast'+i:p.key,value=values.get(key),label=study.params['type'+i]+' '+study.params['period'+i];
   return {key:p.key,label,fullLabel:'이평 예상 '+label,color:study.styles[key].color,text:(!current&&Number.isFinite(value)?'예상 ':'')+format(value)};
  })};
 }
 if(study.type==='MA_SET')return {heading:study.params.average,entries:movingAverageLegend(study,points,format).map(entry=>({...entry,fullLabel:entry.label,label:String(study.params['period'+entry.key.slice(2)])}))};
 const label=study.type==='VWMA'?'VWMA '+study.params.period:studyLabel(study),plots=studyPlots(study),values=new Map((points||[]).map(p=>[p.key,p.value])),multiple=plots.length>1;
 return {heading:multiple?(study.type==='CYCLE'?study.params.average+' '+study.params.fast+'/'+study.params.slow:study.type==='BB'?'BB '+study.params.period+'·'+study.params.multiplier:label):'',entries:plots.filter(p=>study.styles[p.key]?.visible).map(p=>({key:p.key,label:multiple?(study.type==='BB'?({upper:'상단',middle:'중심',lower:'하단'}[p.key]||p.label):p.label):label,fullLabel:multiple?label+' '+p.label:label,color:study.styles[p.key].color,text:format(values.get(p.key))}))};
}
