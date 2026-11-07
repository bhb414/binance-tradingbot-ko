import {chartLabelPreferences} from './chart-labels.js';
import {primaryChartHit,studyChartHit,nearestChartTime} from './chart-hit.js';
import {installChartTooltip} from './chart-tooltip.js';
import {chartTypeCaption} from './chart-types.js';
import {installCyclePriceInspection} from './cycle-price-inspection.js';
// Display-only KST formatting: candle timestamps stay in UTC for all calculations.
const pad=n=>String(n).padStart(2,'0');
export function chartSeconds(time){
 if(typeof time==='number')return Number.isFinite(time)?time:NaN;
 if(typeof time==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(time))return Date.parse(time+'T00:00:00Z')/1000;
 if(time&&Number.isInteger(time.year)&&Number.isInteger(time.month)&&Number.isInteger(time.day))return Date.UTC(time.year,time.month-1,time.day)/1000;
 return NaN;
}
function kstDate(time){const seconds=chartSeconds(time);return Number.isFinite(seconds)?new Date((seconds+32400)*1000):null;}
export function koreanChartTime(time){const d=kstDate(time);return d&&!Number.isNaN(d.getTime())?d.getUTCFullYear()+'.'+pad(d.getUTCMonth()+1)+'.'+pad(d.getUTCDate())+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+' KST':'—';}
export function koreanTickMark(time,type){const d=kstDate(time);if(!d||Number.isNaN(d.getTime()))return '';if(type===0)return String(d.getUTCFullYear());if(type===1)return (d.getUTCMonth()+1)+'월';if(type===2)return (d.getUTCMonth()+1)+'/'+d.getUTCDate();return pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+(type===4?':'+pad(d.getUTCSeconds()):'');}
export const koreanTimeOptions=()=>({localization:{locale:'ko-KR',timeFormatter:koreanChartTime},timeScale:{tickMarkFormatter:koreanTickMark}});
export class CurrentPriceLine{
 constructor(series,{labels=chartLabelPreferences}={}){this.series=series;this.line=null;this.signature='';this.axisLabelVisible=labels.value.current;this.unsubscribeLabels=labels.subscribe(value=>{this.axisLabelVisible=value.current;this.line?.applyOptions({axisLabelVisible:value.current});this.signature='';});}
 destroy(){this.unsubscribeLabels();this.clear();}
 setSeries(series){this.clear();this.series=series;}
 update(value,open){const price=Number(value);if(value==null||value===''||!Number.isFinite(price)||price<=0){this.clear();return;}
  const color=Number.isFinite(Number(open))&&price<Number(open)?'#df6879':'#249b78',options={price,title:'현재가',color,lineWidth:1,lineStyle:2,lineVisible:true,axisLabelVisible:this.axisLabelVisible},signature=JSON.stringify(options);
  if(!this.line)this.line=this.series.createPriceLine(options);else if(this.signature!==signature)this.line.applyOptions(options);this.signature=signature;
 }
 clear(){if(this.line)this.series.removePriceLine(this.line);this.line=null;this.signature='';}
}
export class CandleInspection{
 constructor({chart,studies,onChange=()=>{},isDrawing=()=>false,hitTest=()=>true}){
  this.studies=studies;this.hitTest=hitTest;this.onChange=onChange;this.isDrawing=isDrawing;this.raw=new Map();this.displayed=new Map();this.pin=null;this.hover=null;this.key=null;this.heikin=false;this.chartType='standard';this.executions=[];this.point=null;
  this.move=p=>{if(this.pin!==null||this.isDrawing())return;const t=chartSeconds(p.time);this.hover=this.raw.has(t)?t:null;this.publish();};
  this.click=p=>{if(this.isDrawing())return;const t=nearestChartTime(chart,this.raw,{...p,time:chartSeconds(p.time)});if(!this.raw.has(t)||!this.hitTest({...p,time:t})){if(this.pin!==null)this.release();return;}this.pin=t;this.hover=null;this.point=p.point&&Number.isFinite(p.point.x)&&Number.isFinite(p.point.y)?{x:p.point.x,y:p.point.y}:null;this.publish(true);};
  this.chart=chart;chart.subscribeCrosshairMove(this.move);chart.subscribeClick(this.click);chart.subscribeDblClick?.(this.click);
 }
 update({key,raw,displayed=raw,heikin=false,chartType=heikin?'heikin':'standard'}){
  if(this.key!==key){this.pin=null;this.hover=null;this.executions=[];this.point=null;}this.key=key;this.heikin=heikin;this.chartType=chartType;this.raw=new Map(raw.map(c=>[c.time,c]));this.displayed=new Map(displayed.map(c=>[c.time,c]));
  if(!this.raw.has(this.pin))this.pin=null;if(!this.raw.has(this.hover))this.hover=null;this.latest=raw.at(-1)?.time??null;this.publish();
 }
 setExecutions(rows){this.executions=rows;this.publish();}
 publish(selected=false){const time=this.pin??this.hover??this.latest,candle=this.displayed.get(time),raw=this.raw.get(time);this.studies?.valuesAt(candle?time:undefined);this.onChange({time:candle?time:null,candle,raw,heikin:this.heikin,chartType:this.chartType,pinned:this.pin!==null,hovered:this.hover!==null,selected,point:this.pin!==null?this.point:null,executions:this.executions.filter(row=>row.barTime===time),indicators:this.studies?.readingsAt(candle?time:undefined)||[]});}
 release(){this.pin=null;this.hover=null;this.point=null;this.publish();}
 clear(){this.point=null;this.executions=[];this.key=null;this.pin=null;this.hover=null;this.latest=null;this.raw.clear();this.displayed.clear();this.publish();}
 destroy(){this.chart.unsubscribeCrosshairMove(this.move);this.chart.unsubscribeClick(this.click);this.chart.unsubscribeDblClick?.(this.click);}
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setText=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
export function installCandleInspector(host,{chart,studies,series,isDrawing,chartElement}){
 let tooltip,cycleInspection;
 host.innerHTML='<div class="chart-readout-heading"><time data-readout="time">—</time><span data-readout="kind"></span><button type="button" data-readout="release" aria-label="봉 정보 닫기" title="봉 정보 닫기">×</button></div><div class="chart-tooltip-body"><div class="chart-readout-prices">'+[['open','시가'],['high','고가'],['low','저가'],['close','종가'],['actual','실제 종가'],['volume','거래량']].map(([key,label])=>'<span data-readout-field="'+key+'">'+label+' <output data-readout="'+key+'">—</output></span>').join('')+'</div><details class="chart-readout-studies" data-readout="studies" hidden><summary>선택 봉 지표 값 <span data-readout="count"></span></summary><div data-readout="values"></div></details><details class="chart-readout-executions" data-readout="executions" hidden><summary>선택 봉 체결 <span data-readout="execution-count"></span></summary><ol data-readout="execution-list"></ol><small>앱에 기록된 체결 · B 매수 / S 매도 · 한국시간</small></details></div>';
 const el=Object.fromEntries([...host.querySelectorAll('[data-readout]')].map(n=>[n.dataset.readout,n])),format=v=>v==null||!Number.isFinite(Number(v))?'—':series.priceFormatter().format(Number(v));
 const inspector=new CandleInspection({chart,studies,isDrawing,hitTest:p=>{return chartLabelPreferences.value.price!==false&&(primaryChartHit(chart,series,inspector.displayed,inspector.chartType,{...p,time:chartSeconds(p.time)})||(p.paneIndex??0)===0&&(p.hoveredInfo?.series===series||p.hoveredSeries===series))||studyChartHit(chart,studies.rows,{...p,time:chartSeconds(p.time)});},onChange:view=>{
  const {candle,raw}=view;host.dataset.pinned=String(view.pinned);setText(el.time,koreanChartTime(view.time));setText(el.kind,chartTypeCaption(view.chartType));
  for(const field of ['open','high','low','close'])setText(el[field],format(candle?.[field]));
  host.querySelector('[data-readout-field="actual"]').hidden=!view.heikin;setText(el.actual,format(raw?.close));setText(el.volume,raw?.volume==null?'—':Number(raw.volume).toLocaleString('en-US',{maximumFractionDigits:4}));
  const trades=view.executions,wasHidden=el.executions.hidden;el.executions.hidden=!view.pinned||!trades.length;setText(el['execution-count'],'('+trades.length+')');
  const tradesHTML=trades.map(row=>'<li><b class="'+(row.side==='BUY'?'execution-buy':'execution-sell')+'">'+(row.side==='BUY'?'B 매수':'S 매도')+'</b><span>'+esc(row.label)+' · '+esc(koreanTickMark(row.at/1000,4))+(row.timeEstimated?' (기록시각)':'')+'</span><span>'+esc(Number(row.quantity).toLocaleString('en-US',{maximumFractionDigits:8}))+' @ '+esc(format(row.price))+'</span><small>'+esc(row.botNames?.join(' · ')||'')+'</small></li>').join('');
  if(el['execution-list'].innerHTML!==tradesHTML)el['execution-list'].innerHTML=tradesHTML;if(view.pinned&&trades.length&&(view.selected||wasHidden))el.executions.open=true;if(!view.pinned)el.executions.open=false;
  const rows=view.indicators;el.studies.hidden=!view.pinned||!rows.length;setText(el.count,'('+rows.length+')');const html=rows.map(r=>'<span><b>'+esc(r.label)+'</b> <output>'+esc(r.value)+'</output></span>').join('');if(el.values.innerHTML!==html)el.values.innerHTML=html;if(view.selected)el.studies.open=true;if(!view.pinned)el.studies.open=false;
  tooltip?.update(view);cycleInspection?.refresh();
 }});
 tooltip=installChartTooltip(host,{chart,series,chartElement,onDismiss:()=>inspector.release()});
 cycleInspection=installCyclePriceInspection({chart,studies,chartElement,series,isDrawing,isCandlePinned:()=>inspector.pin!==null,onSelect:()=>inspector.release(),formatTime:koreanChartTime});
 inspector.setSeries=next=>{series=next;tooltip.setSeries(next);cycleInspection.setSeries(next);inspector.publish();};
 el.release.addEventListener('click',()=>inspector.release());const publish=()=>inspector.publish();studies.onValuesChanged=publish;const destroy=inspector.destroy.bind(inspector);inspector.destroy=()=>{cycleInspection.destroy();tooltip.destroy();if(studies.onValuesChanged===publish)studies.onValuesChanged=null;destroy();};return inspector;
}
