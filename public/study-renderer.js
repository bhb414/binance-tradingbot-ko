import {BandFill,bandRows} from './band-fill.js';
import {STUDIES,studyData,studyLabel,studyActive,studyPane} from './chart-studies.js';
import {getStudies,subscribeStudies,studyControls,studyIcon,setStudyPreviewData} from './study-ui.js';
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const legendPreference='fw-study-legend-collapsed-v1',renderers=new Set();
let labelsCollapsed=false;try{labelsCollapsed=localStorage.getItem(legendPreference)==='1';}catch{}

export class StudyRenderer {
  constructor(chart,{legend,priceSeries,context='home',onPaneCount=()=>{},followCrosshair=true}){
    this.chart=chart;this.legend=legend;this.onPaneCount=onPaneCount;this.series=[];this.rows=[];this.candles=[];this.interval='15m';this.candleType='standard';this.config='';
    this.context=context;legend.dataset.studyContext=context;legend.classList.add('study-legend');legend.setAttribute('aria-label','차트 지표 목록');legend.replaceChildren();
    this.list=document.createElement('div');this.list.id=legend.id+'-rows';this.list.className='study-legend-rows';
    this.toggle=document.createElement('button');this.toggle.type='button';this.toggle.className='study-legend-toggle';this.toggle.setAttribute('aria-controls',this.list.id);
    this.toggle.addEventListener('click',()=>{labelsCollapsed=!labelsCollapsed;try{localStorage.setItem(legendPreference,labelsCollapsed?'1':'0');}catch{}for(const renderer of renderers)renderer.syncLabels();});
    legend.append(this.list,this.toggle);renderers.add(this);this.syncLabels();
    this.priceSeries=priceSeries;this.unsubscribe=subscribeStudies(()=>this.update(this.candles,this.interval,this.candleType));
    this.observer=new ResizeObserver(()=>this.layout());this.observer.observe(legend.parentElement);
    this.pointerHandler=()=>requestAnimationFrame(()=>this.layout());legend.parentElement.addEventListener('pointerup',this.pointerHandler);
    if(followCrosshair)chart.subscribeCrosshairMove(param=>this.valuesAt(param.time));
  }
  update(candles,interval='15m',candleType='standard'){
    this.candles=candles;this.interval=interval;this.candleType=candleType;setStudyPreviewData(this.context,candles);const studies=getStudies(),config=JSON.stringify([studies,interval]);
    if(config!==this.config){
      const range=this.chart.timeScale().getVisibleLogicalRange(),heights=new Map(this.rows.filter(row=>row.pane>0).map(row=>[row.study.id,this.chart.panes()[row.pane]?.getHeight()]));
      for(const row of this.rows)if(row.fill)row.fillOwner.detachPrimitive(row.fill);
      for(const series of [...this.series].reverse())this.chart.removeSeries(series);this.series=[];this.rows=[];this.list.replaceChildren();let pane=0;
      for(const study of studies){
        const active=studyActive(study,interval),definition=STUDIES[study.type],index=active&&studyPane(study)?++pane:0;
        const row={study,pane:index,plots:[],values:new Map()};
        if(active){for(const plot of definition.plots){if(!study.styles[plot.key].visible)continue;const style=study.styles[plot.key],series=this.chart.addSeries(window.LightweightCharts[plot.histogram?'HistogramSeries':'LineSeries'],{color:style.color,lineWidth:style.width,lineStyle:style.lineStyle,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:!plot.histogram,title:studyLabel(study)+(definition.plots.length>1?' '+plot.label:''),...(study.type==='VOLUME'?{priceFormat:{type:'volume'}}:{})},index);row.plots.push({key:plot.key,series});this.series.push(series);}
          if(study.type==='BB'&&study.fill?.visible&&study.fill.transparency<100){for(const key of ['upper','lower'])if(!row.plots.some(p=>p.key===key)){const series=this.chart.addSeries(window.LightweightCharts.LineSeries,{color:'transparent',lineVisible:false,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false},index);row.plots.push({key,series,fillOnly:true});this.series.push(series);}row.fill=new BandFill();row.fillOwner=row.plots[0].series;row.fillOwner.attachPrimitive(row.fill);}
          if(index>0)this.chart.panes()[index].priceScale('right').applyOptions({scaleMargins:{top:.26,bottom:.12}});
        }
        const element=document.createElement('div');element.className='study-chart-legend'+(!active?' is-muted':'');element.dataset.studyId=study.id;
        const label=esc(studyLabel(study));element.innerHTML='<button type="button" class="study-legend-name" data-study-edit="'+study.id+'" aria-label="'+label+' 설정 열기"><i style="background:'+study.styles[definition.plots[0].key].color+'"></i>'+label+'</button><output class="study-legend-value"></output><span class="study-legend-actions">'+studyControls(study)+'</span>';
        row.element=element;row.output=element.querySelector('output');this.list.append(element);this.rows.push(row);
      }
      this.onPaneCount(pane);this.chart.panes().forEach((item,index)=>{if(!index){item.setStretchFactor(3.3);return;}const row=this.rows.find(row=>row.pane===index),height=heights.get(row?.study.id);item.setStretchFactor(height?height/100:(row?.study.type==='VOLUME'?0.72:1.15));});
      this.config=config;if(range)this.chart.timeScale().setVisibleLogicalRange(range);
    }
    for(const row of this.rows){const data=studyData(row.study,candles,candleType);row.error=data.error;row.element.title=data.error||(row.study.type==='FORMULA'?row.study.params.formula:'');row.values.clear();for(const plot of data.plots){for(const point of plot.data){if(!Number.isFinite(point.value))continue;if(!row.values.has(point.time))row.values.set(point.time,[]);row.values.get(point.time).push({key:plot.key,value:point.value});}const item=row.plots.find(item=>item.key===plot.key);if(item){if(row.study.type==='FORMULA'&&studyPane(row.study))item.series.applyOptions({priceFormat:{type:'price',precision:6,minMove:.000001}});else if(!['RSI','STOCH','VOLUME'].includes(row.study.type)&&this.priceSeries)item.series.applyOptions({priceFormat:this.priceSeries.options().priceFormat});item.data=plot.data;item.histogram=!!plot.histogram;item.series.setData(plot.data);}}
      if(row.fill)row.fill.update(bandRows(data.plots),row.study.fill);
      const first=row.plots[0]?.series;if(first){for(const line of row.levels||[])first.removePriceLine(line);row.levels=data.levels.map(price=>first.createPriceLine({price,color:'#c5c6cc',lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''}));}
    }
    this.valuesAt(this.valueTime);this.onValuesChanged?.();this.syncLabels();requestAnimationFrame(()=>this.layout());
  }
  syncLabels(){
    this.list.hidden=labelsCollapsed;this.toggle.hidden=this.rows.length===0;
    const label=labelsCollapsed?'지표 이름 펼치기':'지표 이름 접기';
    this.toggle.setAttribute('aria-label',label);this.toggle.setAttribute('aria-expanded',String(!labelsCollapsed));this.toggle.title=label+' · 지표 선은 그대로 표시합니다';
    this.toggle.innerHTML=studyIcon(labelsCollapsed?'down':'up')+'<span>지표명 '+this.rows.length+'</span>';this.layout();
  }
  clear(){this.valueTime=undefined;this.candles=[];for(const series of this.series)series.setData([]);for(const row of this.rows){row.fill?.update([],row.study.fill);for(const plot of row.plots)plot.data=[];row.values.clear();row.output.textContent='—';}}
  readingsAt(time){return this.rows.filter(row=>studyActive(row.study,this.interval)).map(row=>{const points=row.values.get(time??this.candles.at(-1)?.time),definition=STUDIES[row.study.type],visible=(points||[]).filter(p=>row.study.styles[p.key].visible);return {label:studyLabel(row.study),value:row.error?'계산 확인 필요':visible.length?visible.map(p=>(definition.plots.length>1?(definition.plots.find(plot=>plot.key===p.key)?.label||p.key)+' ':'')+p.value.toLocaleString('en-US',{maximumFractionDigits:row.study.type==='VOLUME'?0:row.study.type==='FORMULA'?8:Math.abs(p.value)<.1?8:2})).join(' / '):'—'};});}
  valuesAt(time){this.valueTime=time;for(const row of this.rows){const active=studyActive(row.study,this.interval),points=row.values.get(time??this.candles.at(-1)?.time);row.output.textContent=row.error?'계산 확인 필요':!active?(row.study.visible?'이 주기 숨김':'숨김'):points?.length?points.filter(point=>row.study.styles[point.key].visible).map(point=>point.value.toLocaleString('en-US',{maximumFractionDigits:row.study.type==='VOLUME'?0:row.study.type==='FORMULA'?8:Math.abs(point.value)<.1?8:2})).join(' / '):'—';}}
  layout(){
    const panes=this.chart.panes(),tops=[];let y=0;for(const pane of panes){tops.push(y);y+=pane.getHeight()+1;}
    const offsets=new Map(),rowHeight=matchMedia('(max-width:540px)').matches?26:22;for(const row of this.rows){const offset=offsets.get(row.pane)||0;row.element.style.top=((tops[row.pane]||0)+(row.pane?5:33)+offset*rowHeight)+'px';offsets.set(row.pane,offset+1);}
    this.toggle.style.top=(labelsCollapsed?33:Math.min(33+(offsets.get(0)||0)*rowHeight,Math.max(33,(panes[0]?.getHeight()||300)-28)))+'px';
  }
}
