import {PriceChartLegend} from './price-chart-legend.js';
import {movingAverageLegend} from './moving-average-legend.js';
import {chartLabelPreferences,applyStudyAxisLabels} from './chart-labels.js';
import {overlayRows,hasPaneOverlays,StudyPaneOverlays} from './study-overlay-targets.js';
import {StudyBackgrounds} from './study-backgrounds.js';
import {StudySignals} from './study-signals.js';
import {BandFill,bandRows} from './band-fill.js';
import {STUDIES,studyData,studyLabel,studyActive,studyPane,studyPriceFormat,studyPlots} from './chart-studies.js';
import {getStudies,subscribeStudies,studyControls,studyIcon,setStudyPreviewData} from './study-ui.js';
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const axisTitle=(study,definition,plot)=>study.type==='MA_SET'?study.params.average+' '+plot.label:studyLabel(study)+(definition.plots.length>1?' '+plot.label:'');
const legendPreference='fw-study-legend-collapsed-v1',renderers=new Set();
let labelsCollapsed=false;try{labelsCollapsed=localStorage.getItem(legendPreference)==='1';}catch{}

export class StudyRenderer {
  constructor(chart,{legend,priceSeries,context='home',onPaneCount=()=>{},followCrosshair=true}){
    this.chart=chart;this.legend=legend;this.onPaneCount=onPaneCount;this.series=[];this.rows=[];this.candles=[];this.interval='15m';this.candleType='standard';this.config='';
    this.context=context;legend.dataset.studyContext=context;legend.classList.add('study-legend');legend.setAttribute('aria-label','가격 그래프·지표 목록');legend.replaceChildren();
    this.list=document.createElement('div');this.list.id=legend.id+'-rows';this.list.className='study-legend-rows';
    this.toggle=document.createElement('button');this.toggle.type='button';this.toggle.className='study-legend-toggle';this.toggle.setAttribute('aria-controls',this.list.id);
    this.toggle.addEventListener('click',()=>{labelsCollapsed=!labelsCollapsed;try{localStorage.setItem(legendPreference,labelsCollapsed?'1':'0');}catch{}for(const renderer of renderers)renderer.syncLabels();});
    this.priceLegend=new PriceChartLegend();legend.append(this.priceLegend.element,this.list,this.toggle);renderers.add(this);this.syncLabels();
    this.priceSeries=priceSeries;this.signals=new StudySignals(priceSeries);this.backgrounds=new StudyBackgrounds(priceSeries);this.unsubscribe=subscribeStudies(()=>this.update(this.candles,this.interval,this.candleType));this.unsubscribeAxisLabels=chartLabelPreferences.subscribe(value=>applyStudyAxisLabels(this.rows,value.studies));
    this.observer=new ResizeObserver(()=>this.layout());this.observer.observe(legend.parentElement);
    this.pointerHandler=()=>requestAnimationFrame(()=>this.layout());legend.parentElement.addEventListener('pointerup',this.pointerHandler);
    if(followCrosshair)chart.subscribeCrosshairMove(param=>this.valuesAt(param.time));
  }
  set priceSeries(series){this._priceSeries=series;this.signals?.setSeries(series);this.backgrounds?.setSeries(series);}
  get priceSeries(){return this._priceSeries;}
  update(candles,interval='15m',candleType='standard'){
    this.candles=candles;this.interval=interval;this.candleType=candleType;this.priceLegend.update(candleType);setStudyPreviewData(this.context,candles,interval);const studies=getStudies(),config=JSON.stringify([studies,interval]);
    const changed=config!==this.config;
    if(changed){
      const range=this.chart.timeScale().getVisibleLogicalRange(),heights=new Map(this.rows.filter(row=>row.pane>0).map(row=>[row.study.id,this.chart.panes()[row.pane]?.getHeight()]));
      for(const row of this.rows){row.overlays?.dispose();if(row.fill)row.fillOwner.detachPrimitive(row.fill);}
      for(const series of [...this.series].reverse())this.chart.removeSeries(series);this.series=[];this.rows=[];this.list.replaceChildren();let pane=0;
      for(const study of studies){
        const active=studyActive(study,interval),definition={...STUDIES[study.type],plots:studyPlots(study)},index=active&&studyPane(study)&&(definition.plots.some(p=>!p.signal&&!p.background&&study.styles[p.key].visible)||hasPaneOverlays(study,definition.plots))?++pane:0;
        const row={study,pane:index,plots:[],values:new Map()};
        if(active){for(const plot of definition.plots){if(plot.signal||plot.background||!study.styles[plot.key].visible)continue;const style=study.styles[plot.key],series=this.chart.addSeries(window.LightweightCharts[plot.histogram?'HistogramSeries':'LineSeries'],{color:style.color,lineWidth:style.width,lineStyle:plot.projection?2:style.lineStyle,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:!plot.histogram,title:chartLabelPreferences.value.studies?axisTitle(study,definition,plot):'',...(studyPriceFormat(study,this.priceSeries?.options().priceFormat)?{priceFormat:studyPriceFormat(study,this.priceSeries?.options().priceFormat)}:{})},index);row.plots.push({key:plot.key,series,axisTitle:axisTitle(study,definition,plot)});this.series.push(series);}
          if((study.type==='BB'||definition.bandFill)&&study.fill?.visible&&study.fill.transparency<100){for(const key of ['upper','lower'])if(!row.plots.some(p=>p.key===key)){const series=this.chart.addSeries(window.LightweightCharts.LineSeries,{color:'transparent',lineVisible:false,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false},index);row.plots.push({key,series,fillOnly:true});this.series.push(series);}row.fill=new BandFill();row.fillOwner=row.plots[0].series;row.fillOwner.attachPrimitive(row.fill);}
          if(index>0&&hasPaneOverlays(study,definition.plots)){
            const resolveSeries=anchor=>{const key=anchor?.key||'__overlay_zero',existing=row.plots.find(p=>p.key===key);if(existing)return existing.series;
              const series=this.chart.addSeries(window.LightweightCharts.LineSeries,{color:'transparent',lineVisible:false,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,priceFormat:studyPriceFormat(study,this.priceSeries?.options().priceFormat)},index);row.plots.push({key,series,fillOnly:true,anchorOnly:true});this.series.push(series);return series;};
            row.overlays=new StudyPaneOverlays(study,definition.plots,resolveSeries);
          }
          if(index>0)this.chart.panes()[index].priceScale('right').applyOptions({scaleMargins:{top:study.type==='DMI'?.38:.26,bottom:.12}});
        }
        const element=document.createElement('div');element.className='study-chart-legend'+(!active?' is-muted':'');element.dataset.studyId=study.id;element.dataset.studyType=study.type;
        const label=esc(studyLabel(study));element.innerHTML='<button type="button" class="study-legend-name" data-study-edit="'+study.id+'" aria-label="'+label+' 설정 열기"><i style="background:'+study.styles[definition.plots[0].key].color+'"></i>'+label+'</button><output class="study-legend-value"></output><span class="study-legend-actions">'+studyControls(study)+'</span>';
        if(study.type==='MA_SET'){
          element.classList.add('is-ma-set');element.innerHTML='<div class="study-ma-legend-heading"><button type="button" class="study-legend-name" data-study-edit="'+study.id+'" aria-label="'+label+' 설정 열기">'+esc(study.params.average)+' 묶음</button><span class="study-legend-actions">'+studyControls(study)+'</span></div><div class="study-ma-legend-lines"></div><output class="study-ma-legend-status" hidden></output>';
          row.legendList=element.querySelector('.study-ma-legend-lines');row.legendEntries=movingAverageLegend(study).map(item=>{const entry=document.createElement('div');entry.className='study-ma-legend-line';entry.dataset.maLegend=item.key;entry.innerHTML='<button type="button" class="study-legend-name" data-study-edit="'+study.id+'" aria-label="'+esc(item.label)+' 설정 열기"><i style="background:'+item.color+'"></i>'+esc(item.label)+'</button><output class="study-ma-legend-value" style="color:'+item.color+'">—</output>';row.legendList.append(entry);return {key:item.key,output:entry.querySelector('output')};});
        }
        row.element=element;row.output=study.type==='MA_SET'?element.querySelector('.study-ma-legend-status'):element.querySelector('output');this.list.append(element);this.rows.push(row);
      }
      this.onPaneCount(pane);this.chart.panes().forEach((item,index)=>{if(!index){item.setStretchFactor(3.3);return;}const row=this.rows.find(row=>row.pane===index),height=heights.get(row?.study.id);item.setStretchFactor(height?height/100:(row?.study.type==='VOLUME'?0.72:1.15));});
      this.config=config;if(range)this.chart.timeScale().setVisibleLogicalRange(range);
    }
    const signalRows=[];for(const row of this.rows){const data=studyData(row.study,candles,candleType,interval);signalRows.push({study:row.study,data,active:studyActive(row.study,interval)});row.error=data.error;row.forecast=data.forecast;row.element.title=data.error||(row.study.type==='SCRIPT'?row.study.params.script:row.study.type==='FORMULA'?row.study.params.formula:data.forecast?.caption||'');row.values.clear();for(const plot of data.plots){for(const point of plot.data){if(!Number.isFinite(point.value))continue;if(!row.values.has(point.time))row.values.set(point.time,[]);row.values.get(point.time).push({key:plot.key,value:point.value});}const item=row.plots.find(item=>item.key===plot.key);if(item){const priceFormat=studyPriceFormat(row.study,this.priceSeries?.options().priceFormat);if(priceFormat)item.series.applyOptions({priceFormat});item.data=plot.data;item.histogram=!!plot.histogram;item.series.setData(plot.data);}}
      for(const plot of row.plots)if(plot.key==='__overlay_zero'){plot.data=candles.map(c=>({time:c.time,value:0}));plot.series.setData(plot.data);}
      row.overlays?.update(data,studyActive(row.study,interval));
      if(row.fill)row.fill.update(bandRows(data.plots),row.study.fill);
      const first=row.plots[0]?.series;if(first){for(const line of row.levels||[])first.removePriceLine(line);row.levels=data.levels.map(price=>first.createPriceLine({price,color:'#c5c6cc',lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''}));}
    }
    const priceOverlays=overlayRows(signalRows,'price');this.signals.update(priceOverlays);this.backgrounds.update(priceOverlays);
    this.futureBars=Math.max(0,...this.rows.flatMap(r=>r.plots.flatMap(p=>(p.data||[]).filter(x=>x.time>candles.at(-1)?.time).map(x=>1))));this.futureTime=Math.max(candles.at(-1)?.time||0,...this.rows.flatMap(r=>r.plots.flatMap(p=>(p.data||[]).map(x=>x.time))));if(changed)this.revealFuture();this.valuesAt(this.valueTime);this.onValuesChanged?.();this.syncLabels();requestAnimationFrame(()=>this.layout());
  }
  revealFuture(){const raw=this.candles,range=this.chart.timeScale().getVisibleLogicalRange();if(!raw.length||!range||!this.futureBars||range.to<raw.length-8)return;const step=raw.length>1?raw.at(-1).time-raw.at(-2).time:60,bars=Math.min(300,Math.ceil((this.futureTime-raw.at(-1).time)/Math.max(1,step)));if(range.to<raw.length-1+bars+4)this.chart.timeScale().setVisibleLogicalRange({from:range.from,to:raw.length-1+bars+4});}
  syncLabels(){
    this.list.hidden=labelsCollapsed;this.toggle.hidden=this.rows.length===0;
    const label=labelsCollapsed?'지표 이름 펼치기':'지표 이름 접기';
    this.toggle.setAttribute('aria-label',label);this.toggle.setAttribute('aria-expanded',String(!labelsCollapsed));this.toggle.title=label+' · 지표 선은 그대로 표시합니다';
    this.toggle.innerHTML=studyIcon(labelsCollapsed?'down':'up')+'<span>지표명 '+this.rows.length+'</span>';this.layout();
  }
  clear(){this.signals.clear();this.backgrounds.clear();this.valueTime=undefined;this.candles=[];for(const series of this.series)series.setData([]);for(const row of this.rows){row.overlays?.clear();row.fill?.update([],row.study.fill);for(const plot of row.plots)plot.data=[];row.values.clear();row.output.textContent='—';for(const entry of row.legendEntries||[])entry.output.textContent='—';}}
  readingsAt(time){return this.rows.filter(row=>studyActive(row.study,this.interval)).map(row=>{const points=row.values.get(time??this.candles.at(-1)?.time),definition={...STUDIES[row.study.type],plots:studyPlots(row.study)},visible=(points||[]).filter(p=>row.study.styles[p.key].visible);return {label:studyLabel(row.study),value:row.error?'계산 확인 필요':visible.length?visible.map(p=>(definition.plots.length>1?(definition.plots.find(plot=>plot.key===p.key)?.label||p.key)+' ':'')+p.value.toLocaleString('en-US',{maximumFractionDigits:STUDIES[row.study.type].precision??(row.study.type==='VOLUME'?0:['FORMULA','SCRIPT'].includes(row.study.type)?8:Math.abs(p.value)<.1?8:2)})+(definition.unit?' '+definition.unit:'')).join(' / '):'—'};});}
  valuesAt(time){this.valueTime=time;for(const row of this.rows){if(row.forecast&&!row.error&&(time==null||time===this.candles.at(-1)?.time)){row.output.textContent=row.forecast.caption;continue;}const active=studyActive(row.study,this.interval),points=row.values.get(time??this.candles.at(-1)?.time);if(row.legendEntries){const shown=active&&!row.error;row.legendList.hidden=!shown;row.output.hidden=shown;row.output.textContent=row.error?'계산 확인 필요':row.study.visible?(row.study.timeframes.includes(this.interval)?'선 모두 숨김':'이 주기 숨김'):'숨김';const readings=new Map(movingAverageLegend(row.study,points).map(item=>[item.key,item.text]));for(const entry of row.legendEntries){const text=readings.get(entry.key)||'—';if(entry.output.textContent!==text)entry.output.textContent=text;}row.legendUnits=shown?1+row.legendEntries.length:2;continue;}if(row.study.type==='DMI'&&active&&!row.error&&points?.length){const definition=STUDIES.DMI;row.output.innerHTML=points.filter(p=>row.study.styles[p.key].visible).map(p=>'<span style="color:'+row.study.styles[p.key].color+'">'+esc(definition.plots.find(plot=>plot.key===p.key).label)+' '+p.value.toLocaleString('en-US',{maximumFractionDigits:2})+'</span>').join(' / ');continue;}row.output.textContent=row.error?'계산 확인 필요':!active?(row.study.type==='MA_SET'&&row.study.visible&&row.study.timeframes.includes(this.interval)?'선 모두 숨김':row.study.visible?'이 주기 숨김':'숨김'):points?.length?points.filter(point=>row.study.styles[point.key].visible).map(point=>point.value.toLocaleString('en-US',{maximumFractionDigits:STUDIES[row.study.type].precision??(row.study.type==='VOLUME'?0:['FORMULA','SCRIPT'].includes(row.study.type)?8:Math.abs(point.value)<.1?8:2)})+(STUDIES[row.study.type].unit?' '+STUDIES[row.study.type].unit:'')).join(' / '):'—';}}
  layout(){
    const panes=this.chart.panes(),tops=[];let y=0;for(const pane of panes){tops.push(y);y+=pane.getHeight()+1;}
    const offsets=new Map([[0,1]]),rowHeight=matchMedia('(max-width:540px)').matches?26:22;this.priceLegend.element.style.top='33px';this.legend.style.setProperty('--study-legend-row-height',rowHeight+'px');this.list.style.setProperty('--legend-list-top',(38+rowHeight*2)+'px');for(const row of this.rows){const offset=offsets.get(row.pane)||0;row.element.style.top=((tops[row.pane]||0)+(row.pane?5:33)+offset*rowHeight)+'px';const units=row.legendUnits||1;if(row.legendEntries)row.element.style.height=(units*rowHeight)+'px';offsets.set(row.pane,offset+units);}
    const scrolling=[...offsets].some(([index,count])=>count>Math.max(3,Math.floor(((panes[index]?.getHeight()||300)-70)/rowHeight)));this.list.classList.toggle('is-scrollable',scrolling);this.list.style.setProperty('--legend-list-height',Math.min(240,Math.max(100,(panes[0]?.getHeight()||300)-70))+'px');
    this.toggle.style.top=(scrolling||labelsCollapsed?33+rowHeight:Math.min(33+(offsets.get(0)||0)*rowHeight,Math.max(33,(panes[0]?.getHeight()||300)-28)))+'px';
  }
}
