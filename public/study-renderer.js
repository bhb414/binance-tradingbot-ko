import {restorePaneRatios} from './chart-pane-layout.js';
import {CycleSegments,cycleSegmentData} from './cycle-segments.js';
import {createCyclePriceSolver,cyclePriceReading} from './cycle-price-target.js';
import {CyclePriceArrows} from './cycle-price-arrows.js';
import {projectionVisibleRange} from './cycle-projection.js';
import {CYCLE_PROJECTION_PLOTS} from './cycle-projection.js';
import {CycleRatioGrid} from './cycle-ratio-grid.js';
import {cycleReferenceMessage,cycleReadings,cycleLegendValues,cycleElapsedColor} from './cycle-reference.js';
import {PriceChartLegend} from './price-chart-legend.js';
import {compactStudyLegend} from './compact-study-legend.js';
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
  constructor(chart,{legend,priceSeries,context='home',onPaneCount=()=>{},followCrosshair=true,paneLayout=null}){
    this.chart=chart;this.legend=legend;this.paneLayout=paneLayout;this.onPaneCount=onPaneCount;this.series=[];this.rows=[];this.candles=[];this.interval='15m';this.candleType='standard';this.config='';
    this.context=context;legend.dataset.studyContext=context;legend.classList.add('study-legend');legend.setAttribute('aria-label','가격 그래프·지표 목록');legend.replaceChildren();
    this.list=document.createElement('div');this.list.id=legend.id+'-rows';this.list.className='study-legend-rows';this.paneLegends=new Map();
    this.toggle=document.createElement('button');this.toggle.type='button';this.toggle.className='study-legend-toggle';this.toggle.setAttribute('aria-controls',this.list.id);
    this.toggle.addEventListener('click',()=>{labelsCollapsed=!labelsCollapsed;try{localStorage.setItem(legendPreference,labelsCollapsed?'1':'0');}catch{}for(const renderer of renderers)renderer.syncLabels();});
    this.menu=document.createElement('div');this.menu.className='study-legend-menu';this.menu.hidden=true;this.menu.setAttribute('role','group');this.menu.id=legend.id+'-menu';
    this.priceLegend=new PriceChartLegend();legend.append(this.priceLegend.element,this.list,this.toggle,this.menu);
    legend.addEventListener('click',event=>{const button=event.target.closest('[data-study-menu]');if(button){const row=this.rows.find(row=>row.study.id===button.dataset.studyMenu);if(row)this.openMenu(row,button);}else if(event.target.closest('[data-study-edit],[data-study-toggle],[data-study-remove]'))this.closeMenu();});
    document.addEventListener('click',event=>{if(!this.menu.contains(event.target)&&!event.target.closest('[data-study-menu]'))this.closeMenu();});
    legend.addEventListener('keydown',event=>{if(event.key==='Escape'&&!this.menu.hidden){event.stopPropagation();const button=this.menuButton;this.closeMenu();button?.focus();}});renderers.add(this);this.syncLabels();
    this.priceSeries=priceSeries;this.signals=new StudySignals(priceSeries);this.backgrounds=new StudyBackgrounds(priceSeries);this.unsubscribe=subscribeStudies(()=>this.update(this.candles,this.interval,this.candleType));this.unsubscribeAxisLabels=chartLabelPreferences.subscribe(value=>applyStudyAxisLabels(this.rows,value.studies));
    this.observer=new ResizeObserver(()=>{this.layout();const width=legend.parentElement.clientWidth;if(width!==this.containerWidth){this.containerWidth=width;this.revealFuture();}});this.observer.observe(legend.parentElement);
    this.pointerHandler=()=>requestAnimationFrame(()=>this.layout());legend.parentElement.addEventListener('pointerup',this.pointerHandler);
    if(followCrosshair)chart.subscribeCrosshairMove(param=>this.valuesAt(param.time));
  }
  set priceSeries(series){this._priceSeries=series;this.signals?.setSeries(series);this.backgrounds?.setSeries(series);}
  get priceSeries(){return this._priceSeries;}
  update(candles,interval='15m',candleType='standard'){
    this.candles=candles;this.interval=interval;this.candleType=candleType;this.priceLegend.update(candleType);setStudyPreviewData(this.context,candles,interval,candleType);const studies=getStudies(),config=JSON.stringify([studies,interval]);
    const changed=config!==this.config;
    if(changed){
      const range=this.chart.timeScale().getVisibleLogicalRange(),heights=new Map(this.rows.filter(row=>row.pane>0).map(row=>[row.study.id,this.chart.panes()[row.pane]?.getStretchFactor()/(this.chart.panes()[0]?.getStretchFactor()||3.3)*3.3]));
      for(const row of this.rows){if(row.ratioGrid)row.ratioGridOwner.detachPrimitive(row.ratioGrid);row.overlays?.dispose();row.priceArrows?.destroy();for(const plot of row.plots)if(plot.segments)plot.series.detachPrimitive(plot.segments);if(row.fill)row.fillOwner.detachPrimitive(row.fill);}
      for(const series of [...this.series].reverse())this.chart.removeSeries(series);this.series=[];this.rows=[];this.closeMenu();this.list.replaceChildren();this.paneLegends.clear();let pane=0;
      for(const study of studies){
        const active=studyActive(study,interval),definition={...STUDIES[study.type],plots:studyPlots(study)},index=active&&studyPane(study)&&(definition.plots.some(p=>!p.signal&&!p.background&&study.styles[p.key].visible)||hasPaneOverlays(study,definition.plots))?++pane:0;
        const row={study,pane:index,plots:[],values:new Map()};
        if(active){for(const plot of definition.plots){if(plot.signal||plot.background||!study.styles[plot.key].visible)continue;const style=study.styles[plot.key],series=this.chart.addSeries(window.LightweightCharts[plot.histogram?'HistogramSeries':'LineSeries'],{color:style.color,lineWidth:style.width,lineStyle:plot.projection?2:style.lineStyle,...(study.type==='CYCLE'&&['elapsed','interval'].includes(plot.key)?{lineVisible:false}:{}),priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:!plot.histogram,title:chartLabelPreferences.value.studies?axisTitle(study,definition,plot):'',...(studyPriceFormat(study,this.priceSeries?.options().priceFormat)?{priceFormat:studyPriceFormat(study,this.priceSeries?.options().priceFormat)}:{})},index);const item={key:plot.key,series,axisTitle:axisTitle(study,definition,plot)};if(study.type==='CYCLE'&&['elapsed','interval'].includes(plot.key)){item.segments=new CycleSegments();series.attachPrimitive(item.segments);}row.plots.push(item);this.series.push(series);}
          if((study.type==='BB'||definition.bandFill)&&study.fill?.visible&&study.fill.transparency<100){for(const key of ['upper','lower'])if(!row.plots.some(p=>p.key===key)){const series=this.chart.addSeries(window.LightweightCharts.LineSeries,{color:'transparent',lineVisible:false,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false},index);row.plots.push({key,series,fillOnly:true});this.series.push(series);}row.fill=new BandFill();row.fillOwner=row.plots[0].series;row.fillOwner.attachPrimitive(row.fill);}
          if(index>0&&hasPaneOverlays(study,definition.plots)){
            const resolveSeries=anchor=>{const key=anchor?.key||'__overlay_zero',existing=row.plots.find(p=>p.key===key);if(existing)return existing.series;
              const series=this.chart.addSeries(window.LightweightCharts.LineSeries,{color:'transparent',lineVisible:false,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,priceFormat:studyPriceFormat(study,this.priceSeries?.options().priceFormat)},index);row.plots.push({key,series,fillOnly:true,anchorOnly:true});this.series.push(series);return series;};
            row.overlays=new StudyPaneOverlays(study,definition.plots,resolveSeries);
          }
          if(study.type==='CYCLE'&&study.params.showProjection&&index>0)for(const plot of CYCLE_PROJECTION_PLOTS){if(!study.styles[plot.parent].visible)continue;const style=study.styles[plot.parent],series=this.chart.addSeries(window.LightweightCharts.LineSeries,{color:style.color,lineWidth:style.width,lineStyle:2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,title:'',priceFormat:studyPriceFormat(study,this.priceSeries?.options().priceFormat)},index);row.plots.push({key:plot.key,series,projection:true,axisTitle:studyLabel(study)+' '+plot.label});if(plot.parent==='elapsed')row.priceArrows=new CyclePriceArrows(series);this.series.push(series);}
          if(study.type==='CYCLE'&&study.params.display==='ratio'&&index>0&&row.plots.length){row.ratioGrid=new CycleRatioGrid();row.ratioGridOwner=row.plots[0].series;row.ratioGridOwner.attachPrimitive(row.ratioGrid);}
          if(index>0)this.chart.panes()[index].priceScale('right').applyOptions({scaleMargins:{top:study.type==='DMI'?.38:.26,bottom:.12}});
        }
        const element=document.createElement('div');element.className='study-chart-legend'+(!active?' is-muted':'');element.dataset.studyId=study.id;element.dataset.studyType=study.type;
        const model=compactStudyLegend(study),label=esc(studyLabel(study));element.classList.add('is-compact');
        element.innerHTML='<button type="button" class="study-legend-heading" data-study-edit="'+study.id+'" aria-label="'+label+' 설정 열기">'+esc(model.heading||studyLabel(study))+'</button><span class="study-legend-entries"></span><output class="study-legend-status" hidden></output><button type="button" class="study-icon-button study-legend-menu-button" data-study-menu="'+study.id+'" aria-label="'+label+' 메뉴" aria-expanded="false" aria-controls="'+this.menu.id+'" title="지표 설정·삭제">⋯</button>';
        const controls=document.createElement('span');controls.innerHTML=studyControls(study);const groupToggle=controls.querySelector('[data-study-toggle]');groupToggle.classList.add('study-group-toggle');groupToggle.setAttribute('aria-pressed',String(study.visible));
        if(study.type==='MA_SET'){const label=studyLabel(study)+' 묶음 전체 '+(study.visible?'숨기기':'표시하기');groupToggle.setAttribute('aria-label',label);groupToggle.title=label+' · 각 기간 체크는 유지됩니다';}if(!study.visible)groupToggle.querySelector('svg').insertAdjacentHTML('beforeend','<path d="M3 3l18 18"/>');element.insertBefore(groupToggle,element.querySelector('[data-study-menu]'));
        row.heading=element.querySelector('.study-legend-heading');row.heading.hidden=!model.heading;row.legendList=element.querySelector('.study-legend-entries');
        row.legendEntries=model.entries.map(item=>{const button=document.createElement('button');button.type='button';button.className='study-legend-name';button.dataset.studyEdit=study.id;button.dataset.legendPlot=item.key;button.setAttribute('aria-label',item.fullLabel+' 설정 열기');button.style.color=item.color;button.innerHTML='<i style="background:'+item.color+'"></i>'+'<span>'+esc(item.label)+'</span>';row.legendList.append(button);return {key:item.key,button,fullLabel:item.fullLabel};});
        row.element=element;row.output=element.querySelector('output');if(study.type==='CYCLE'){row.preview=document.createElement('output');row.preview.className='study-cycle-preview';row.preview.hidden=true;row.preview.setAttribute('aria-label','십자선 위치 교차 필요가격');element.append(row.preview);}this.rows.push(row);
        if(!this.paneLegends.has(index)){const container=document.createElement('div');container.className='study-pane-legend';container.dataset.legendPane=index;this.list.append(container);this.paneLegends.set(index,container);}this.paneLegends.get(index).append(element);
      }
      this.onPaneCount(pane);this.chart.panes().forEach((item,index)=>{if(!index){item.setStretchFactor(3.3);return;}const row=this.rows.find(row=>row.pane===index),height=heights.get(row?.study.id);item.setStretchFactor(height?height:(row?.study.type==='VOLUME'?0.72:row?.study.type==='CYCLE'?2.2:1.15));});
      restorePaneRatios(this.chart,this.rows,this.paneLayout?.read());this.config=config;if(range)this.chart.timeScale().setVisibleLogicalRange(range);
    }
    const signalRows=[];for(const row of this.rows){const data=studyData(row.study,candles,candleType,interval);signalRows.push({study:row.study,data,active:studyActive(row.study,interval)});row.error=data.error;row.forecast=data.forecast;row.cyclePriceContext=data.cyclePriceContext;const priceSignature=data.cyclePriceContext?JSON.stringify([row.study.params.average,row.study.params.fast,row.study.params.slow,row.study.source,data.cyclePriceContext.kind,data.cyclePriceContext.referencePrice,data.cyclePriceContext.candles,data.cyclePriceContext.volumes]):'';if(priceSignature!==row.priceSignature){row.priceSignature=priceSignature;row.priceSolver=data.cyclePriceContext?createCyclePriceSolver(data.cyclePriceContext):null;}row.cycleValues=data.cycle?new Map(data.cycle.map(point=>[point.time,point])):null;row.element.title=data.error||(row.study.type==='SCRIPT'?row.study.params.script:row.study.type==='FORMULA'?row.study.params.formula:data.caption||data.forecast?.caption||'');row.values.clear();for(const plot of data.plots){for(const point of plot.data){if(!Number.isFinite(point.value))continue;if(!row.values.has(point.time))row.values.set(point.time,[]);row.values.get(point.time).push({key:plot.key,value:point.value});}const item=row.plots.find(item=>item.key===plot.key);if(item){const priceFormat=studyPriceFormat(row.study,this.priceSeries?.options().priceFormat);if(priceFormat)item.series.applyOptions({priceFormat});item.data=plot.data;item.histogram=!!plot.histogram;item.series.setData(plot.data);}}
      if(row.study.type==='CYCLE')for(const plot of row.plots)if(plot.segments){plot.data=cycleSegmentData(plot.data||[],data.cycle||[]);plot.segments.update(plot.data,row.study.styles[plot.key]);}
      for(const plot of data.cycleProjection?.plots||[]){const item=row.plots.find(item=>item.key===plot.key);if(item){item.data=plot.data;item.series.setData(plot.data);}}
      row.priceArrows?.update({study:row.study,context:row.cyclePriceContext,solver:row.priceSolver,path:row.plots.find(p=>p.key==='cycleElapsedProjection')?.data||[]});
      for(const plot of row.plots)if(plot.key==='__overlay_zero'){plot.data=candles.map(c=>({time:c.time,value:0}));plot.series.setData(plot.data);}
      row.overlays?.update(data,studyActive(row.study,interval));
      if(row.fill)row.fill.update(bandRows(data.plots),row.study.fill);
      const first=row.plots[0]?.series;if(first){for(const line of row.levels||[])first.removePriceLine(line);row.levels=(row.ratioGrid?[]:data.levels).map(price=>first.createPriceLine({price,color:'#c5c6cc',lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''}));}
    }
    const priceOverlays=overlayRows(signalRows,'price');this.signals.update(priceOverlays);this.backgrounds.update(priceOverlays);
    this.futureBars=Math.max(0,...this.rows.flatMap(r=>r.plots.flatMap(p=>(p.data||[]).filter(x=>x.time>candles.at(-1)?.time).map(x=>1))));this.futureTime=Math.max(candles.at(-1)?.time||0,...this.rows.flatMap(r=>r.plots.flatMap(p=>(p.data||[]).map(x=>x.time))));if(changed)this.revealFuture();this.valuesAt(this.valueTime);this.onValuesChanged?.();this.syncLabels();requestAnimationFrame(()=>this.layout());
  }
  revealFuture(){const raw=this.candles,range=this.chart.timeScale().getVisibleLogicalRange();if(!raw.length||!range||!this.futureBars||range.to<raw.length-8)return;const step=raw.length>1?raw.at(-1).time-raw.at(-2).time:60,bars=Math.min(300,Math.ceil((this.futureTime-raw.at(-1).time)/Math.max(1,step)));const next=projectionVisibleRange(range,raw.length,bars);if(next.from!==range.from||next.to!==range.to)this.chart.timeScale().setVisibleLogicalRange(next);}
  closeMenu(){if(!this.menu)return;this.menu.hidden=true;this.menuButton?.setAttribute('aria-expanded','false');this.menuButton=null;}
  openMenu(row,button){
    const alreadyOpen=this.menuButton===button&&!this.menu.hidden;this.closeMenu();if(alreadyOpen)return;
    this.menuButton=button;this.menu.innerHTML=studyControls(row.study);this.menu.querySelector('[data-study-toggle]').remove();this.menu.setAttribute('aria-label',studyLabel(row.study)+' 관리');this.menu.hidden=false;button.setAttribute('aria-expanded','true');
    const parent=this.legend.getBoundingClientRect(),anchor=button.getBoundingClientRect();this.menu.style.left=Math.max(4,Math.min(anchor.left-parent.left,parent.width-this.menu.offsetWidth-4))+'px';this.menu.style.top=Math.max(4,Math.min(anchor.bottom-parent.top,parent.height-this.menu.offsetHeight-4))+'px';
  }
  syncLabels(){
    if(labelsCollapsed)this.closeMenu();this.list.hidden=labelsCollapsed;this.toggle.hidden=this.rows.length===0;
    const label=labelsCollapsed?'지표 이름 펼치기':'지표 이름 접기';
    this.toggle.setAttribute('aria-label',label);this.toggle.setAttribute('aria-expanded',String(!labelsCollapsed));this.toggle.title=label+' · 지표 선은 그대로 표시합니다';
    this.toggle.innerHTML=studyIcon(labelsCollapsed?'down':'up')+'<span>지표명 '+this.rows.length+'</span>';this.layout();
  }
  clear(){this.signals.clear();this.backgrounds.clear();this.valueTime=undefined;this.candles=[];for(const series of this.series)series.setData([]);for(const row of this.rows){row.cyclePriceContext=null;row.priceSolver=null;row.priceSignature='';row.priceArrows?.clear();if(row.preview)row.preview.hidden=true;row.overlays?.clear();row.fill?.update([],row.study.fill);for(const plot of row.plots){plot.data=[];plot.segments?.update([],row.study.styles[plot.key]);}row.values.clear();row.output.textContent='—';for(const entry of row.legendEntries||[])entry.button.title=entry.fullLabel+' · —';}}
  setProjectionPreview(reading){
    for(const row of this.rows){if(!row.preview)continue;const text=reading?.studyId===row.study.id?reading.summary:'';row.preview.hidden=!text;if(row.preview.textContent!==text)row.preview.textContent=text;if(text)row.preview.title=reading.notice+' · 클릭하면 상세 툴팁을 엽니다.';}
  }
  projectionReading(event){
    if(!Number.isFinite(event?.time))return null;
    const row=this.rows.find(row=>row.study.type==='CYCLE'&&row.pane>0&&row.pane===event.paneIndex&&row.study.params.showPriceTarget&&row.cyclePriceContext&&studyActive(row.study,this.interval));
    if(!row)return null;
    const path=row.plots.find(p=>p.projection&&p.data?.length)?.data||[],bars=path.findIndex(p=>p.time===event.time);
    if(bars<1)return null;
    row.priceSolver??=createCyclePriceSolver(row.cyclePriceContext);
    return {...cyclePriceReading(row.study,row.cyclePriceContext,row.priceSolver,bars,row.cycleValues?.get(this.candles.at(-1)?.time)),studyId:row.study.id,label:row.study.params.average+' '+row.study.params.fast+' / '+row.study.params.slow,time:event.time};
  }
  readingsAt(time){return this.rows.filter(row=>studyActive(row.study,this.interval)).map(row=>{if(row.study.type==='CYCLE'){const meta=row.cycleValues?.get(time??this.candles.at(-1)?.time);return {label:studyLabel(row.study),value:cycleReadings(row.study,meta)};}const points=row.values.get(time??this.candles.at(-1)?.time),definition={...STUDIES[row.study.type],plots:studyPlots(row.study)},visible=(points||[]).filter(p=>row.study.styles[p.key].visible);return {label:studyLabel(row.study),value:row.error?'계산 확인 필요':visible.length?visible.map(p=>(definition.plots.length>1?(definition.plots.find(plot=>plot.key===p.key)?.label||p.key)+' ':'')+p.value.toLocaleString('en-US',{maximumFractionDigits:STUDIES[row.study.type].precision??(row.study.type==='VOLUME'?0:['FORMULA','SCRIPT'].includes(row.study.type)?8:Math.abs(p.value)<.1?8:2)})+(definition.unit?' '+definition.unit:'')).join(' / '):'—'};});}
  valuesAt(time){
    this.valueTime=time;
    for(const row of this.rows){
      const active=studyActive(row.study,this.interval),points=row.values.get(time??this.candles.at(-1)?.time),model=compactStudyLegend(row.study,points),status=row.error?'계산 확인 필요':!active?(row.study.visible?(row.study.timeframes.includes(this.interval)?'선 모두 숨김':'이 주기 숨김'):'숨김'):'';
      row.legendList.hidden=!!status;row.heading.hidden=!status&&!model.heading;row.output.hidden=!status;row.output.textContent=status;if(!status&&row.study.type==='CYCLE'){const message=cycleReferenceMessage(row.study,row.cycleValues?.get(time??this.candles.at(-1)?.time));row.output.hidden=!message;row.output.textContent=message;}
      const readings=new Map(model.entries.map(item=>[item.key,item.text]));for(const entry of row.legendEntries){const value=readings.get(entry.key)||'—',title=entry.fullLabel+' · '+value;if(entry.button.title!==title){entry.button.title=title;entry.button.setAttribute('aria-description',value);}if(row.study.type==='CYCLE'){const meta=row.cycleValues?.get(time??this.candles.at(-1)?.time),texts=cycleLegendValues(row.study,meta),text=texts[entry.key];entry.button.querySelector('span').textContent=text;entry.button.title=cycleReadings(row.study,meta);entry.button.setAttribute('aria-description',text);if(entry.key==='elapsed'){const color=cycleElapsedColor(row.study,meta);entry.button.style.color=color;entry.button.querySelector('i').style.background=color;}}}
      const forecastReading=!status&&row.study.params.showCrossing&&row.forecast?.comparison&&(time==null||time===this.candles.at(-1)?.time);row.output.classList.toggle('study-forecast-reading',!!forecastReading);if(forecastReading){row.output.hidden=false;row.output.textContent=row.forecast.comparison.message;}
      if(row.forecast&&!row.error&&(time==null||time===this.candles.at(-1)?.time))row.element.title=row.forecast.caption;
    }
  }
  layout(){
    const panes=this.chart.panes(),tops=[];let y=0;for(const pane of panes){tops.push(y);y+=pane.getHeight()+1;}
    const rowHeight=matchMedia('(max-width:540px)').matches?26:22;this.priceLegend.element.style.top='33px';this.legend.style.setProperty('--study-legend-row-height',rowHeight+'px');

    for(const [index,container]of this.paneLegends){
      const top=(tops[index]||0)+(index?5:33+rowHeight),height=panes[index]?.getHeight()||300;container.style.top=top+'px';container.style.maxHeight=Math.max(rowHeight,Math.min(150,height-(index?10:33+rowHeight)-5))+'px';
      container.classList.toggle('is-scrollable',container.scrollHeight>container.clientHeight+1);
    }
    this.toggle.style.top='33px';this.toggle.style.left='auto';this.toggle.style.right=matchMedia('(max-width:540px)').matches?'65px':'78px';
  }
}
