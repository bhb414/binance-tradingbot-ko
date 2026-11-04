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
 constructor(series){this.series=series;this.line=null;this.signature='';}
 update(value,open){const price=Number(value);if(value==null||value===''||!Number.isFinite(price)||price<=0){this.clear();return;}
  const color=Number.isFinite(Number(open))&&price<Number(open)?'#df6879':'#249b78',options={price,title:'현재가',color,lineWidth:1,lineStyle:2,lineVisible:true,axisLabelVisible:true},signature=JSON.stringify(options);
  if(!this.line)this.line=this.series.createPriceLine(options);else if(this.signature!==signature)this.line.applyOptions(options);this.signature=signature;
 }
 clear(){if(this.line)this.series.removePriceLine(this.line);this.line=null;this.signature='';}
}
export class CandleInspection{
 constructor({chart,studies,onChange=()=>{},isDrawing=()=>false}){
  this.studies=studies;this.onChange=onChange;this.isDrawing=isDrawing;this.raw=new Map();this.displayed=new Map();this.pin=null;this.hover=null;this.key=null;this.heikin=false;this.executions=[];
  this.move=p=>{if(this.pin!==null||this.isDrawing())return;const t=chartSeconds(p.time);this.hover=this.raw.has(t)?t:null;this.publish();};
  this.click=p=>{if(this.isDrawing())return;const t=chartSeconds(p.time);if(!this.raw.has(t))return;this.pin=t;this.hover=null;this.publish(true);};
  this.chart=chart;chart.subscribeCrosshairMove(this.move);chart.subscribeClick(this.click);
 }
 update({key,raw,displayed=raw,heikin=false}){
  if(this.key!==key){this.pin=null;this.hover=null;this.executions=[];}this.key=key;this.heikin=heikin;this.raw=new Map(raw.map(c=>[c.time,c]));this.displayed=new Map(displayed.map(c=>[c.time,c]));
  if(!this.raw.has(this.pin))this.pin=null;if(!this.raw.has(this.hover))this.hover=null;this.latest=raw.at(-1)?.time??null;this.publish();
 }
 setExecutions(rows){this.executions=rows;this.publish();}
 publish(selected=false){const time=this.pin??this.hover??this.latest,candle=this.displayed.get(time),raw=this.raw.get(time);this.studies?.valuesAt(candle?time:undefined);this.onChange({time:candle?time:null,candle,raw,heikin:this.heikin,pinned:this.pin!==null,hovered:this.hover!==null,selected,executions:this.executions.filter(row=>row.barTime===time),indicators:this.studies?.readingsAt(candle?time:undefined)||[]});}
 release(){this.pin=null;this.hover=null;this.publish();}
 clear(){this.executions=[];this.key=null;this.pin=null;this.hover=null;this.latest=null;this.raw.clear();this.displayed.clear();this.publish();}
 destroy(){this.chart.unsubscribeCrosshairMove(this.move);this.chart.unsubscribeClick(this.click);}
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setText=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
export function installCandleInspector(host,{chart,studies,series,isDrawing}){
 host.innerHTML='<div class="chart-readout-heading"><b data-readout="mode">최근 봉</b><time data-readout="time">—</time><span data-readout="kind"></span><button type="button" data-readout="release" hidden>선택 해제</button><small data-readout="hint">캔들 클릭·터치로 값 고정</small></div><div class="chart-readout-prices">'+[['open','시가'],['high','고가'],['low','저가'],['close','종가'],['actual','실제 종가'],['volume','거래량']].map(([key,label])=>'<span data-readout-field="'+key+'">'+label+' <output data-readout="'+key+'">—</output></span>').join('')+'</div><details class="chart-readout-studies" data-readout="studies" hidden><summary>선택 봉 지표 값 <span data-readout="count"></span></summary><div data-readout="values"></div></details><details class="chart-readout-executions" data-readout="executions" hidden><summary>선택 봉 체결 <span data-readout="execution-count"></span></summary><ol data-readout="execution-list"></ol><small>앱에 기록된 체결 · B 매수 / S 매도 · 한국시간</small></details>';
 const el=Object.fromEntries([...host.querySelectorAll('[data-readout]')].map(n=>[n.dataset.readout,n])),format=v=>v==null||!Number.isFinite(Number(v))?'—':series.priceFormatter().format(Number(v));
 const inspector=new CandleInspection({chart,studies,isDrawing,onChange:view=>{
  const {candle,raw}=view;host.dataset.pinned=String(view.pinned);setText(el.mode,view.pinned?'선택 봉':view.hovered?'커서 봉':'최근 봉');setText(el.time,koreanChartTime(view.time));setText(el.kind,view.heikin?'하이킨아시 · 합성가격':'일반 캔들');el.release.hidden=!view.pinned;el.hint.hidden=view.pinned;
  for(const field of ['open','high','low','close'])setText(el[field],format(candle?.[field]));
  host.querySelector('[data-readout-field="actual"]').hidden=!view.heikin;setText(el.actual,format(raw?.close));setText(el.volume,raw?.volume==null?'—':Number(raw.volume).toLocaleString('en-US',{maximumFractionDigits:4}));
  const trades=view.executions,wasHidden=el.executions.hidden;el.executions.hidden=!view.pinned||!trades.length;setText(el['execution-count'],'('+trades.length+')');
  const tradesHTML=trades.map(row=>'<li><b class="'+(row.side==='BUY'?'execution-buy':'execution-sell')+'">'+(row.side==='BUY'?'B 매수':'S 매도')+'</b><span>'+esc(row.label)+' · '+esc(koreanTickMark(row.at/1000,4))+(row.timeEstimated?' (기록시각)':'')+'</span><span>'+esc(Number(row.quantity).toLocaleString('en-US',{maximumFractionDigits:8}))+' @ '+esc(format(row.price))+'</span><small>'+esc(row.botNames?.join(' · ')||'')+'</small></li>').join('');
  if(el['execution-list'].innerHTML!==tradesHTML)el['execution-list'].innerHTML=tradesHTML;if(view.pinned&&trades.length&&(view.selected||wasHidden))el.executions.open=true;if(!view.pinned)el.executions.open=false;
  const rows=view.indicators;el.studies.hidden=!view.pinned||!rows.length;setText(el.count,'('+rows.length+')');const html=rows.map(r=>'<span><b>'+esc(r.label)+'</b> <output>'+esc(r.value)+'</output></span>').join('');if(el.values.innerHTML!==html)el.values.innerHTML=html;if(view.selected)el.studies.open=true;if(!view.pinned)el.studies.open=false;
 }});
 el.release.addEventListener('click',()=>inspector.release());studies.onValuesChanged=()=>inspector.publish();return inspector;
}
