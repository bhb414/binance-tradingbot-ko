import {installChartLabelMenu} from './chart-labels.js';
import {api} from './api.js';
import {ChartExecutions} from './chart-executions.js';
import {fillTimeframeSelect} from './timeframe-picker.js';
import {chartEntryLines,PositionPriceLines} from './chart-positions.js';
import {koreanTimeOptions,CurrentPriceLine,installCandleInspector} from './chart-readout.js';
import {PriceChart} from './price-chart.js';
import {chartTypeCaption,chartType} from './chart-types.js';
import {installChartTypePicker} from './chart-type-picker.js';
import {StudyRenderer} from './study-renderer.js';
import {openStudyLibrary,getStudies,subscribeStudies} from './study-ui.js';
import {productLabel,instrumentName} from './markets.js';
let selected=null,selectedType='standard',request=0,chart,series,priceLayer,studies,positionLines,currentPriceLine,inspector,executions,snapshot=null,lastKey=null,accountState=null;
const $=selector=>document.querySelector(selector);
const typePicker=installChartTypePicker($('#modal-candle-type'),{onSelect:type=>{selectedType=type;draw();}});
installChartLabelMenu($('#modal-chart-label-menu'),{onError:message=>{$('#modal-chart-status').textContent=message;}});
function replacePrice(next){series=next;positionLines.setSeries(next);currentPriceLine.setSeries(next);studies.priceSeries=next;inspector.setSeries(next);executions.setSeries(next);}
function initialize(){
  if(chart)return;const L=window.LightweightCharts;if(!L)throw new Error('차트 라이브러리를 불러오지 못했습니다.');
  chart=L.createChart($('#modal-chart'),{autoSize:true,layout:{background:{type:'solid',color:'#fff'},textColor:'#7a887d',fontFamily:'Segoe UI, sans-serif',fontSize:11,attributionLogo:true,panes:{separatorColor:'#edf0eb',enableResize:true}},grid:{vertLines:{color:'#eef2eb'},horzLines:{color:'#eef2eb'}},rightPriceScale:{borderColor:'#e5ebdf'},timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#e5ebdf',rightOffset:6,...koreanTimeOptions().timeScale},localization:koreanTimeOptions().localization});
  priceLayer=new PriceChart(chart,{onReplace:replacePrice});series=priceLayer.series;
  positionLines=new PositionPriceLines(series,{lineStyle:L.LineStyle.Dashed});
  studies=new StudyRenderer(chart,{legend:$('#modal-study-legend'),priceSeries:series,context:'modal',followCrosshair:false,onPaneCount:count=>$('.modal-chart-stage').style.setProperty('--study-min-height',(280+count*105)+'px')});
  fillTimeframeSelect($('#modal-interval'));
  currentPriceLine=new CurrentPriceLine(series);inspector=installCandleInspector($('#modal-chart-inspector'),{chart,studies,series,chartElement:$('#modal-chart')});executions=new ChartExecutions(series,{toggle:$('#modal-chart-executions-toggle'),inspector});
}
function draw(reset=false){
  if(!snapshot||!chart)return;const raw=snapshot.candles;
  const tick=Number(selected.tickSize),last=snapshot.ticker.lastPrice==null?NaN:Number(snapshot.ticker.lastPrice),parts=String(tick).split('e'),precision=tick>0?Math.min(12,Math.max(0,(parts[0].split('.')[1]||'').length-Number(parts[1]||0))):last>0&&last<1?8:2;
  const data=priceLayer.render(selectedType,raw,{type:'price',precision,minMove:tick||10**-precision});
  positionLines.update(chartEntryLines(accountState,selected.market,selected.symbol));
  studies.update(raw,$('#modal-interval').value,selectedType);
  inspector.update({key:selected.market+':'+selected.symbol+':'+$('#modal-interval').value,raw,displayed:data,heikin:selectedType==='heikin',chartType:selectedType});if(raw.length)currentPriceLine.update(last,raw.at(-1)?.open);else currentPriceLine.clear();
  syncExecutions();
  $('#modal-chart-quote').textContent=Number.isFinite(last)?last.toLocaleString('en-US',{maximumFractionDigits:precision})+' '+selected.quoteAsset:'—';
  $('#modal-chart-status').textContent=raw.length?'실전 공개 시세 · '+$('#modal-interval').selectedOptions[0].text+' · '+chartTypeCaption(selectedType)+' · 설정 지표 '+getStudies().length+'개':'이 종목의 해당 주기에 표시할 봉이 없습니다.';
  $('#modal-chart').setAttribute('aria-label',selected.symbol+' '+$('#modal-interval').value+' 가격 차트');if(reset&&raw.length)chart.timeScale().setVisibleLogicalRange({from:Math.max(0,raw.length-150),to:raw.length+6});if(reset)studies.revealFuture();
}
async function refresh(reset=false){
  if(!selected||!$('#market-chart-dialog').open)return;const version=++request,key=selected.market+':'+selected.symbol+':'+$('#modal-interval').value;
  if(reset){executions?.clear();positionLines?.clear();currentPriceLine?.clear();inspector?.clear();snapshot=null;$('#modal-chart-status').textContent='시세를 불러오는 중…';priceLayer?.clear();studies?.clear();}
  try{const data=await api('/market-data/quote?market='+encodeURIComponent(selected.market)+'&symbol='+encodeURIComponent(selected.symbol)+'&interval='+encodeURIComponent($('#modal-interval').value));if(version!==request||!$('#market-chart-dialog').open)return;snapshot=data;selected={...selected,...data.instrument};draw(reset||key!==lastKey);lastKey=key;}
  catch(error){if(version===request)$('#modal-chart-status').textContent=error.message;}
}
function syncExecutions(){if(selected&&snapshot&&$('#market-chart-dialog').open)executions?.update({state:accountState,market:selected.market,symbol:selected.symbol,candles:snapshot.candles,interval:$('#modal-interval').value});else executions?.clear();}
export function syncChartModalAccount(state){accountState=state;if(selected&&snapshot&&$('#market-chart-dialog').open)positionLines?.update(chartEntryLines(state,selected.market,selected.symbol));else positionLines?.clear();syncExecutions();}
export function openChartModal(instrument,options={}){
  initialize();selected=instrument;snapshot=null;lastKey=null;$('#modal-chart-title').textContent=instrument.symbol;$('#modal-chart-product').textContent=instrumentName(instrument)+' · '+productLabel(instrument)+' · BINANCE';$('#modal-chart-quote').textContent='—';$('#modal-interval').value=options.interval||'15m';selectedType=chartType(options.candleType).id;typePicker.sync(selectedType);
  $('#market-chart-dialog').showModal();initialize();refresh(true);
}
$('#modal-interval').addEventListener('change',()=>refresh(true));$('#modal-indicator-button').addEventListener('click',()=>openStudyLibrary({context:'modal'}));$('#modal-chart-fit').addEventListener('click',()=>chart?.timeScale().fitContent());
$('#modal-chart-fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#market-chart-dialog').requestFullscreen();}catch(error){$('#modal-chart-status').textContent=error.message;}});
$('#market-chart-dialog').addEventListener('close',()=>{request++;snapshot=null;executions?.clear();positionLines?.clear();currentPriceLine?.clear();inspector?.clear();});setInterval(()=>refresh(),5000);
subscribeStudies(()=>{if(snapshot&&$('#market-chart-dialog').open)draw();});
