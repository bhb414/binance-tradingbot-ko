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
  constructor(chart,{legend,priceSeries,context='home',onPaneCount=()=>{},followCrosshair=true}){
    this.chart=chart;this.legend=legend;this.onPaneCount=onPaneCount;this.series=[];this.rows=[];this.candles=[];this.interval='15m';this.candleType='standard';this.config='';
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
      for(const series of [...this.series].reverse())this.chart.removeSeries(series);this.series=[];this.rows=[];this.closeMenu();this.list.replaceChildren();this.paneLegends.clear();let pane=0;
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
        const model=compactStudyLegend(study),label=esc(studyLabel(study));element.classList.add('is-compact');
        element.innerHTML='<button type="button" class="study-legend-heading" data-study-edit="'+study.id+'" aria-label="'+label+' 설정 열기">'+esc(model.heading||studyLabel(study))+'</button><span class="study-legend-entries"></span><output class="study-legend-status" hidden></output><button type="button" class="study-icon-button study-legend-menu-button" data-study-menu="'+study.id+'" aria-label="'+label+' 메뉴" aria-expanded="false" aria-controls="'+this.menu.id+'" title="지표 설정·삭제">⋯</button>';
        const controls=document.createElement('span');controls.innerHTML=studyControls(study);const groupToggle=controls.querySelector('[data-study-toggle]');groupToggle.classList.add('study-group-toggle');groupToggle.setAttribute('aria-pressed',String(study.visible));
        if(study.type==='MA_SET'){const label=studyLabel(study)+' 묶음 전체 '+(study.visible?'숨기기':'표시하기');groupToggle.setAttribute('aria-label',label);groupToggle.title=label+' · 각 기간 체크는 유지됩니다';}if(!study.visible)groupToggle.querySelector('svg').insertAdjacentHTML('beforeend','<path d="M3 3l18 18"/>');element.insertBefore(groupToggle,element.querySelector('[data-study-menu]'));
        row.heading=element.querySelector('.study-legend-heading');row.heading.hidden=!model.heading;row.legendList=element.querySelector('.study-legend-entries');
        row.legendEntries=model.entries.map(item=>{const button=document.createElement('button');button.type='button';button.className='study-legend-name';button.dataset.studyEdit=study.id;button.dataset.legendPlot=item.key;button.setAttribute('aria-label',item.fullLabel+' 설정 열기');button.style.color=item.color;button.innerHTML='<i style="background:'+item.color+'"></i>'+'<span>'+esc(item.label)+'</span>';row.legendList.append(button);return {key:item.key,button,fullLabel:item.fullLabel};});
        row.element=element;row.output=element.querySelector('output');this.rows.push(row);
        if(!this.paneLegends.has(index)){const container=document.createElement('div');container.className='study-pane-legend';container.dataset.legendPane=index;this.list.append(container);this.paneLegends.set(index,container);}this.paneLegends.get(index).append(element);
      }
      this.onPaneCount(pane);this.chart.panes().forEach((item,index)=>{if(!index){item.setStretchFactor(3.3);return;}const row=this.rows.find(row=>row.pane===index),height=heights.get(row?.study.id);item.setStretchFactor(height?height/100:(row?.study.type==='VOLUME'?0.72:1.15));});
      this.config=config;if(range)this.chart.timeScale().setVisibleLogicalRange(range);
    }
    const signalRows=[];for(const row of this.rows){const data=studyData(row.study,candles,candleType,interval);signalRows.push({study:row.study,data,active:studyActive(row.study,interval)});row.error=data.error;row.forecast=data.forecast;row.cycleValues=data.cycle?new Map(data.cycle.map(point=>[point.time,point])):null;row.element.title=data.error||(row.study.type==='SCRIPT'?row.study.params.script:row.study.type==='FORMULA'?row.study.params.formula:data.caption||data.forecast?.caption||'');row.values.clear();for(const plot of data.plots){for(const point of plot.data){if(!Number.isFinite(point.value))continue;if(!row.values.has(point.time))row.values.set(point.time,[]);row.values.get(point.time).push({key:plot.key,value:point.value});}const item=row.plots.find(item=>item.key===plot.key);if(item){const priceFormat=studyPriceFormat(row.study,this.priceSeries?.options().priceFormat);if(priceFormat)item.series.applyOptions({priceFormat});item.data=plot.data;item.histogram=!!plot.histogram;item.series.setData(plot.data);}}
      for(const plot of row.plots)if(plot.key==='__overlay_zero'){plot.data=candles.map(c=>({time:c.time,value:0}));plot.series.setData(plot.data);}
      row.overlays?.update(data,studyActive(row.study,interval));
      if(row.fill)row.fill.update(bandRows(data.plots),row.study.fill);
      const first=row.plots[0]?.series;if(first){for(const line of row.levels||[])first.removePriceLine(line);row.levels=data.levels.map(price=>first.createPriceLine({price,color:'#c5c6cc',lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''}));}
    }
    const priceOverlays=overlayRows(signalRows,'price');this.signals.update(priceOverlays);this.backgrounds.update(priceOverlays);
    this.futureBars=Math.max(0,...this.rows.flatMap(r=>r.plots.flatMap(p=>(p.data||[]).filter(x=>x.time>candles.at(-1)?.time).map(x=>1))));this.futureTime=Math.max(candles.at(-1)?.time||0,...this.rows.flatMap(r=>r.plots.flatMap(p=>(p.data||[]).map(x=>x.time))));if(changed)this.revealFuture();this.valuesAt(this.valueTime);this.onValuesChanged?.();this.syncLabels();requestAnimationFrame(()=>this.layout());
  }
  revealFuture(){const raw=this.candles,range=this.chart.timeScale().getVisibleLogicalRange();if(!raw.length||!range||!this.futureBars||range.to<raw.length-8)return;const step=raw.length>1?raw.at(-1).time-raw.at(-2).time:60,bars=Math.min(300,Math.ceil((this.futureTime-raw.at(-1).time)/Math.max(1,step)));if(range.to<raw.length-1+bars+4)this.chart.timeScale().setVisibleLogicalRange({from:range.from,to:raw.length-1+bars+4});}
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
  clear(){this.signals.clear();this.backgrounds.clear();this.valueTime=undefined;this.candles=[];for(const series of this.series)series.setData([]);for(const row of this.rows){row.overlays?.clear();row.fill?.update([],row.study.fill);for(const plot of row.plots)plot.data=[];row.values.clear();row.output.textContent='—';for(const entry of row.legendEntries||[])entry.button.title=entry.fullLabel+' · —';}}
  readingsAt(time){return this.rows.filter(row=>studyActive(row.study,this.interval)).map(row=>{if(row.study.type==='CYCLE'){const meta=row.cycleValues?.get(time??this.candles.at(-1)?.time),format=n=>Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:2})+'봉':'미확인';return {label:studyLabel(row.study),value:'한 바퀴 '+format(meta?.period)+(row.study.params.display==='ratio'?' · 1배 기준 '+format(meta?.basis):'')+' · 최근 교차 '+format(meta?.interval)+' · 경과 '+format(meta?.elapsed)};}const points=row.values.get(time??this.candles.at(-1)?.time),definition={...STUDIES[row.study.type],plots:studyPlots(row.study)},visible=(points||[]).filter(p=>row.study.styles[p.key].visible);return {label:studyLabel(row.study),value:row.error?'계산 확인 필요':visible.length?visible.map(p=>(definition.plots.length>1?(definition.plots.find(plot=>plot.key===p.key)?.label||p.key)+' ':'')+p.value.toLocaleString('en-US',{maximumFractionDigits:STUDIES[row.study.type].precision??(row.study.type==='VOLUME'?0:['FORMULA','SCRIPT'].includes(row.study.type)?8:Math.abs(p.value)<.1?8:2)})+(definition.unit?' '+definition.unit:'')).join(' / '):'—'};});}
  valuesAt(time){
    this.valueTime=time;
    for(const row of this.rows){
      const active=studyActive(row.study,this.interval),points=row.values.get(time??this.candles.at(-1)?.time),model=compactStudyLegend(row.study,points),status=row.error?'계산 확인 필요':!active?(row.study.visible?(row.study.timeframes.includes(this.interval)?'선 모두 숨김':'이 주기 숨김'):'숨김'):'';
      row.legendList.hidden=!!status;row.heading.hidden=!status&&!model.heading;row.output.hidden=!status;row.output.textContent=status;
      const readings=new Map(model.entries.map(item=>[item.key,item.text]));for(const entry of row.legendEntries){const value=readings.get(entry.key)||'—',title=entry.fullLabel+' · '+value;if(entry.button.title!==title){entry.button.title=title;entry.button.setAttribute('aria-description',value);}if(row.study.type==='CYCLE'){const item=model.entries.find(item=>item.key===entry.key);const meta=row.cycleValues?.get(time??this.candles.at(-1)?.time),base=row.study.params.display==='ratio'?meta?.basis:meta?.period;if(entry.key==='period'){const text=Number.isFinite(base)?base.toLocaleString('ko-KR',{maximumFractionDigits:2})+'봉':'미확인';entry.button.querySelector('span').textContent=(row.study.params.display==='ratio'?'1배기준 ':'주기 ')+text;entry.button.title=entry.fullLabel+' · '+text;}else entry.button.querySelector('span').textContent=(item?.label||'').replace(/\([^)]*\)/g,'')+' '+value;}}
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
