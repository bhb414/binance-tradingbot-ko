import {api} from './api.js';
import {chartEntryLines,PositionPriceLines} from './chart-positions.js';
import {koreanTimeOptions,CurrentPriceLine,installCandleInspector} from './chart-readout.js';
import {heikinAshi} from './indicators.js';
import {StudyRenderer} from './study-renderer.js';
import {openStudyLibrary,getStudies,subscribeStudies} from './study-ui.js';
import {productLabel,instrumentName} from './markets.js';
let selected=null,request=0,chart,series,studies,positionLines,currentPriceLine,inspector,snapshot=null,lastKey=null,accountState=null;
const $=selector=>document.querySelector(selector);
function initialize(){
  if(chart)return;const L=window.LightweightCharts;if(!L)throw new Error('차트 라이브러리를 불러오지 못했습니다.');
  chart=L.createChart($('#modal-chart'),{autoSize:true,layout:{background:{type:'solid',color:'#fff'},textColor:'#7a887d',fontFamily:'Segoe UI, sans-serif',fontSize:11,attributionLogo:true,panes:{separatorColor:'#edf0eb',enableResize:true}},grid:{vertLines:{color:'#eef2eb'},horzLines:{color:'#eef2eb'}},rightPriceScale:{borderColor:'#e5ebdf'},timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#e5ebdf',rightOffset:6,...koreanTimeOptions().timeScale},localization:koreanTimeOptions().localization});
  series=chart.addSeries(L.CandlestickSeries,{upColor:'#35b98c',downColor:'#da7584',borderVisible:false,wickUpColor:'#35b98c',wickDownColor:'#da7584',lastValueVisible:false,priceLineVisible:false});
  positionLines=new PositionPriceLines(series,{lineStyle:L.LineStyle.Dashed});
  studies=new StudyRenderer(chart,{legend:$('#modal-study-legend'),priceSeries:series,context:'modal',followCrosshair:false,onPaneCount:count=>$('.modal-chart-stage').style.setProperty('--study-min-height',(280+count*105)+'px')});
  currentPriceLine=new CurrentPriceLine(series);inspector=installCandleInspector($('#modal-chart-inspector'),{chart,studies,series});
}
function draw(reset=false){
  if(!snapshot||!chart)return;const raw=snapshot.candles,data=$('#modal-candle-type').value==='heikin'?heikinAshi(raw):raw;
  const tick=Number(selected.tickSize),last=snapshot.ticker.lastPrice==null?NaN:Number(snapshot.ticker.lastPrice),parts=String(tick).split('e'),precision=tick>0?Math.min(12,Math.max(0,(parts[0].split('.')[1]||'').length-Number(parts[1]||0))):last>0&&last<1?8:2;
  series.applyOptions({priceFormat:{type:'price',precision,minMove:tick||10**-precision}});series.setData(data.map(({time,open,high,low,close})=>({time,open,high,low,close})));
  positionLines.update(chartEntryLines(accountState,selected.market,selected.symbol));
  studies.update(raw,$('#modal-interval').value,$('#modal-candle-type').value);
  inspector.update({key:selected.market+':'+selected.symbol+':'+$('#modal-interval').value,raw,displayed:data,heikin:$('#modal-candle-type').value==='heikin'});if(raw.length)currentPriceLine.update(last,raw.at(-1)?.open);else currentPriceLine.clear();
  $('#modal-chart-quote').textContent=Number.isFinite(last)?last.toLocaleString('en-US',{maximumFractionDigits:precision})+' '+selected.quoteAsset:'—';
  $('#modal-chart-status').textContent=raw.length?'실전 공개 시세 · '+$('#modal-interval').selectedOptions[0].text+' · '+($('#modal-candle-type').value==='heikin'?'하이킨아시 · 합성가격':'일반 캔들')+' · 설정 지표 '+getStudies().length+'개':'이 종목의 해당 주기에 표시할 봉이 없습니다.';
  $('#modal-chart').setAttribute('aria-label',selected.symbol+' '+$('#modal-interval').value+' 가격 차트');if(reset&&raw.length)chart.timeScale().setVisibleLogicalRange({from:Math.max(0,raw.length-150),to:raw.length+6});
}
async function refresh(reset=false){
  if(!selected||!$('#market-chart-dialog').open)return;const version=++request,key=selected.market+':'+selected.symbol+':'+$('#modal-interval').value;
  if(reset){positionLines?.clear();currentPriceLine?.clear();inspector?.clear();snapshot=null;$('#modal-chart-status').textContent='시세를 불러오는 중…';series?.setData([]);studies?.clear();}
  try{const data=await api('/market-data/quote?market='+encodeURIComponent(selected.market)+'&symbol='+encodeURIComponent(selected.symbol)+'&interval='+encodeURIComponent($('#modal-interval').value));if(version!==request||!$('#market-chart-dialog').open)return;snapshot=data;selected={...selected,...data.instrument};draw(reset||key!==lastKey);lastKey=key;}
  catch(error){if(version===request)$('#modal-chart-status').textContent=error.message;}
}
export function syncChartModalAccount(state){accountState=state;if(selected&&snapshot&&$('#market-chart-dialog').open)positionLines?.update(chartEntryLines(state,selected.market,selected.symbol));else positionLines?.clear();}
export function openChartModal(instrument,options={}){
  selected=instrument;snapshot=null;lastKey=null;$('#modal-chart-title').textContent=instrument.symbol;$('#modal-chart-product').textContent=instrumentName(instrument)+' · '+productLabel(instrument)+' · BINANCE';$('#modal-chart-quote').textContent='—';$('#modal-interval').value=options.interval||'15m';$('#modal-candle-type').value=options.candleType||'standard';
  $('#market-chart-dialog').showModal();initialize();refresh(true);
}
$('#modal-interval').addEventListener('change',()=>refresh(true));$('#modal-candle-type').addEventListener('change',()=>draw());$('#modal-indicator-button').addEventListener('click',()=>openStudyLibrary({context:'modal'}));$('#modal-chart-fit').addEventListener('click',()=>chart?.timeScale().fitContent());
$('#modal-chart-fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#market-chart-dialog').requestFullscreen();}catch(error){$('#modal-chart-status').textContent=error.message;}});
$('#market-chart-dialog').addEventListener('close',()=>{request++;snapshot=null;positionLines?.clear();currentPriceLine?.clear();inspector?.clear();});setInterval(()=>refresh(),5000);
subscribeStudies(()=>{if(snapshot&&$('#market-chart-dialog').open)draw();});
