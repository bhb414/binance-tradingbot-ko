import {StudySignals} from './study-signals.js';
import {StudyBackgrounds} from './study-backgrounds.js';
export const overlayTarget=style=>style?.target==='study'?'study':'price';
export const anchorPlots=plots=>plots.filter(p=>!p.signal&&!p.background&&!p.projection);
const shown=(study,p)=>study.styles[p.key]?.visible&&(!p.background||study.styles[p.key].transparency<100);
export function indicatorAnchor(study,plots,style={}){const lines=anchorPlots(plots);return lines.find(p=>p.key===style.anchor)||lines.find(p=>study.styles[p.key]?.visible)||lines[0]||null;}
export function hasPaneOverlays(study,plots){return plots.some(p=>(p.signal||p.background)&&shown(study,p)&&overlayTarget(study.styles[p.key])==='study');}
export function overlayRows(rows,target){return rows.map(row=>({...row,data:{...row.data,plots:(row.data.plots||[]).filter(p=>(p.signal||p.background)&&overlayTarget(row.study.styles[p.key])===target)}}));}
export class StudyPaneOverlays{
 constructor(study,plots,resolveSeries,{createSignals=s=>new StudySignals(s),createBackgrounds=s=>new StudyBackgrounds(s)}={}){
  this.study=study;this.groups=[];const groups=new Map();
  for(const p of plots){if(!p.signal||!shown(study,p)||overlayTarget(study.styles[p.key])!=='study')continue;const anchor=indicatorAnchor(study,plots,study.styles[p.key]),key=anchor?.key||'';if(!groups.has(key))groups.set(key,{anchor,keys:[]});groups.get(key).keys.push(p.key);}
  for(const group of groups.values())this.groups.push({...group,signals:createSignals(resolveSeries(group.anchor))});
  if(plots.some(p=>p.background&&shown(study,p)&&overlayTarget(study.styles[p.key])==='study'))this.backgrounds=createBackgrounds(resolveSeries(indicatorAnchor(study,plots)));
 }
 update(data,active=true){const row={study:this.study,data,active};for(const group of this.groups)group.signals.update([{...row,data:{...data,plots:data.plots.filter(p=>group.keys.includes(p.key))}}]);this.backgrounds?.update(overlayRows([row],'study'));}
 clear(){for(const group of this.groups)group.signals.clear();this.backgrounds?.clear();}
 dispose(){for(const group of this.groups)group.signals.dispose();this.backgrounds?.dispose();this.groups=[];this.backgrounds=null;}
}
