import {botNeedsStop,botStopPending} from './bot-controls.js';
import {budgetPolicyDescription,budgetRecoveryDebt,previewBudgetPolicy} from './budget-policy.js';
import {insertFormulaSnippet} from './formula-snippets.js';
import {homeOpenOrders,homeOrderTable} from './home-orders.js';
import {actionFormulaPosition,formulaPosition} from './formula-position.js';
import { api } from './api.js';
import {fillActionMarkup} from './fill-action.js';
import {connectionView} from './connection-state.js';
import {ChartWorkspace,chartViewKey,restoredRange,presetRange} from './chart-workspace.js';
import {chartEntryLines,PositionPriceLines} from './chart-positions.js';
import {koreanTimeOptions,CurrentPriceLine,installCandleInspector} from './chart-readout.js';
import {botPerformance} from './performance.js';
import {installBotTools,copyBotSettings,resetBotSettings} from './bot-tools.js';
import {appearanceFor,saveAppearance} from './avatar.js';
import {botStatusMarkup} from './bot-status.js';
import {installTradeHistoryUI} from './trade-history-ui.js';
import {installAccountEquityUI} from './account-equity-ui.js';
import { installConnectionUI,renderConnection,setConnectionLocal } from './connection-ui.js';
import {installNetworkUI} from './network-ui.js';
import {installTransportUI} from './transport-ui.js';
import { SYMBOLS, makeBot, validateBot, describeRule, budgetUsage, BUDGET_MODES, effectiveBudget } from './core.js';
import { upgradeBot, applyWholeTimeframe } from './formula.js';
import {ruleIntervals,evaluateRuleFormula} from './formula-runtime.js';
import {leverageCap,notionalCap} from './leverage.js';
import {BUDGET_OPTIONS,budgetIncluded,allocatedAmount,budgetRealized,withBudgetAllocation,requestedBudget,isPercentBudget,percentBudgetBasis} from './budget.js';
import {budgetSelectionMarkup,createBudgetEditor,budgetFieldsMarkup,percentBudgetDescription} from './budget-editor.js';
import {installSignatureHelp} from './formula-signature.js';
import {PriceChart} from './price-chart.js';
import {chartTypeCaption,CHART_TYPE_IDS} from './chart-types.js';
import {installChartTypePicker} from './chart-type-picker.js';
import { roomAvatar } from './room.js';
import {ChartExecutions} from './chart-executions.js';
import {CHART_INTERVALS} from './chart-timeframes.js';
import {installTimeframePicker} from './timeframe-picker.js';
import {renderOfficeRoster} from './office-roster.js';
import {installBotActions} from './bot-actions.js';
import {installPositionImportUI} from './position-import-ui.js';
import { formulaEditorMarkup, formulaExamples } from './formula-editor.js';
import {openChartModal,syncChartModalAccount} from './chart-modal.js';
import {StudyRenderer} from './study-renderer.js';
import {installStudyUI,openStudyLibrary} from './study-ui.js';
import {MARKET_FILTERS,productLabel,instrumentName,matchesMarket,isTradfi} from './markets.js';
import {marketKey} from './markets.js';
import {FavoritesPersistence} from './favorites-persistence.js';
import {installManualUI} from './manual-ui.js';
import {installMultiUI} from './multi-ui.js';
import {positionRows} from './positions-ui.js';
import {appearanceCard,installAppearanceUI} from './appearance-ui.js';
import {workroomPerformance} from './workroom-metrics.js';
import {protectionEditorMarkup,syncProtectionEditor,applyProtectionChoice} from './protection-editor.js';
import { ACTIONS, isEntry, isStop, makeActionRule, upgradeActions } from './actions.js';


const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n, decimals = 2) => n==null||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const price = n => fmt(n,n>0&&n<1?Math.min(12,Math.max(5,-Math.floor(Math.log10(n))+2)):2);
const signed = n => (n >= 0 ? '+' : '') + fmt(n);
const time = value => new Date(value || Date.now()).toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul', hour:'2-digit', minute:'2-digit', second:'2-digit' });
const ICONS = {
  chart:'M3 3v18h18M7 14l4-4 4 3 6-8', bot:'M9 3h6M12 3v3M5 7h14v13H5zM2 11v5M22 11v5M9 16h6M9 11h.01M15 11h.01',
  history:'M3 11a9 9 0 1 1 2.7 7M3 4v7h7M12 7v5l3 2', settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  help:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2M12 17h.01',
  flask:'M9 3h6M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 15h8', chevron:'M8 10l4 4 4-4',
  list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', indicator:'M3 17l4-6 4 3 4-9 6 5M3 21h18',
  expand:'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M8 12h8M12 8v8', maximize:'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',
  crosshair:'M12 2v4M12 18v4M2 12h4M18 12h4M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0', horizontal:'M3 12h18M5 9v6M19 9v6',
  trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  close:'M6 6l12 12M6 18L18 6', search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', info:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v6M12 7h.01',
  plus:'M12 5v14M5 12h14', wallet:'M20 8V5H5a3 3 0 0 1 0-6M3 5v15h18V8H5a3 3 0 0 1 0-6h15M21 11h-6v5h6M17 13.5h.01',
  shield:'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6', download:'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
  check:'M5 12l4 4L20 5', play:'M7 4l14 8-14 8z', pause:'M7 4h3v16H7zM14 4h3v16h-3z', more:'M5 12h.01M12 12h.01M19 12h.01',
  folder:'M3 7V4h6l3 3h9v13H3z', arrow:'M5 12h14M13 6l6 6-6 6', code:'M8 6l-6 6 6 6M16 6l6 6-6 6M14 3l-4 18'
};
function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ICONS.info}"/></svg>`; }
function icons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }

let bots=[],logs=[],legacyBots=[];
try{const saved=JSON.parse(localStorage.getItem('fw-bots-v1')||'null');if(Array.isArray(saved))legacyBots=saved.map(upgradeBot);}catch{}
let positionCosts=null,positionCostsKey='',positionCostsAt=0,positionCostsPending=null;
let positionInsights=null,positionInsightsKey='',positionInsightsAt=0,positionInsightsPending=null;
let serverState=null,marketSnapshot=null,marketError=null,chartRequest=0,formulaRequest=0,syncing=false;
let manualUI,appearanceUI,multiUI,botTools,multiSymbolPick,favorites;
let favoritesStorage;try{favoritesStorage=localStorage;}catch{}
const favoriteStore=new FavoritesPersistence({storage:favoritesStorage,request:api,onChange(next){const changed=JSON.stringify(next)!==JSON.stringify(favorites);favorites=next;if(changed&&$('#symbol-dialog').open)renderSymbolResults($('#symbol-search').value);paintFavoriteState();},onStatus(message){const output=$('#favorites-sync-status');if(output&&output.textContent!==message)output.textContent=message;paintFavoriteState();}});
favorites=[...favoriteStore.keys];
function paintFavoriteState(){document.querySelectorAll('[data-favorite-key]').forEach(button=>{button.disabled=!favoriteStore.ready||favoriteStore.saving;});}
function refreshFavorites(){return favoriteStore.load().catch(()=>{});}
for(const symbol of SYMBOLS){symbol.price=NaN;symbol.change=NaN;symbol.volume='—';}

let chartStorage;try{chartStorage=localStorage;}catch{}
const chartWorkspace=new ChartWorkspace(chartStorage,()=>toast('차트 설정을 브라우저에 저장하지 못했습니다.',true)),savedChart=chartWorkspace.selection;
let currentMarket=savedChart.market,marketInstruments=[],marketCatalogErrors=[],marketCatalogReady=false,marketFilter='all',symbolResultLimit=100;
let currentPage='home', currentSymbol=savedChart.symbol, currentInterval=savedChart.interval, homeTab='positions', botFilter='all', rosterTab='operating', draft=null, editorTab='basic', chart, candleSeries, homeStudies, homePrice, positionPriceLines, currentPriceLine, candleInspector, chartExecutions, candles=[], drawingMode=false, drawnLines=[], confirmCallback;
let toastTimer, selectedRuleId, symbolPickerTarget='home';
let leverageLimits=null,leverageRequest=0,signatureHelp,formulaDebounce;
const SYMBOL_NAMES={BTCUSDT:'비트코인',ETHUSDT:'이더리움',SOLUSDT:'솔라나',BNBUSDT:'비엔비 바이낸스코인',XRPUSDT:'리플',DOGEUSDT:'도지코인'};
const symbolName=symbol=>[SYMBOL_NAMES[symbol.symbol],symbol.name].filter(Boolean).join(' · ');
const currentRule=()=>draft?.actionRules.find(rule=>rule.id===selectedRuleId);
const rulePrefix=()=> 'actionRules.'+draft.actionRules.findIndex(rule=>rule.id===selectedRuleId);
let selectedBotId=bots[0]?.id, candleType=savedChart.candleType;
let chartRenderedKey='',chartRestoring=false,chartSaveTimer;
const botControls=installBotActions({getBots:()=>bots,getState:()=>serverState,openSettings:id=>openBot(id),connectionSettings:()=>goPage('settings'),refresh:syncWorkspace,api,notify:toast});
const timeframePicker=installTimeframePicker({root:$('#chart-interval-more'),onSelect:setChartInterval});
const homeTypePicker=installChartTypePicker($('#candle-type'),{value:candleType,onSelect:setChartType});
const positionImportUI=installPositionImportUI({api,getState:()=>serverState,refresh:syncWorkspace,connectionSettings:()=>goPage('settings'),notify:toast,onImported:id=>{if($('#bot-dialog').open)$('#bot-dialog').close();selectedBotId=id;goPage('bots');openBot(id,'conditions');}});
function toast(message, error=false) { const el=$('#toast'); el.textContent=message; el.classList.toggle('error',error); el.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.hidden=true,error ? 7500 : 4200); }
async function syncWorkspace(refreshMarket=false){
  if(syncing)return;syncing=true;
  try{const state=await api('/status');serverState=state;bots=state.bots.map(upgradeActions);logs=state.logs;renderConnection(state);transportUI?.setState(state);renderRuntimeBanner();renderBots();loadPositionInsights();loadPositionCosts();renderHomeTable();syncPositionPriceLines();syncChartExecutions();syncChartModalAccount(state);if($('#bot-dialog').open)renderEditorStatus();renderActivity();multiUI?.setState();manualUI?.setState({instrument:currentInstrument(),state,quote:marketSnapshot?.market===currentMarket&&marketSnapshot?.ticker.symbol===currentSymbol?marketSnapshot:null});if(refreshMarket){await loadSymbols();await updateChart(true);}}
  catch(error){marketError=error.message;renderRuntimeBanner();throw error;}
  finally{syncing=false;}
}
async function loadSymbols(){
  const data=await api('/symbols');
  for(const row of data.symbols){if(!SYMBOLS.some(s=>s.symbol===row.symbol))SYMBOLS.push({symbol:row.symbol,short:row.baseAsset,name:row.baseAsset,color:'#8aa497',price:NaN,change:NaN,volume:'—'});}
  for(const ticker of data.tickers){const symbol=SYMBOLS.find(s=>s.symbol===ticker.symbol);if(symbol){symbol.price=Number(ticker.lastPrice);symbol.change=Number(ticker.priceChangePercent);symbol.volume=Number(ticker.quoteVolume);}}
  renderMarket();if($('#symbol-dialog').open)renderSymbolResults($('#symbol-search').value);
}
function renderRuntimeBanner(){
  const view=connectionView(serverState,marketError),{connected,enabled,environment,summary}=view;
  $('.rail').dataset.connectionState=view.connectionState;$('.rail').dataset.healthState=view.warning?'warning':'ok';
  const status=$('#workspace-connection');status.title=summary;status.setAttribute('aria-label',summary+' · 연결 설정 열기');
  $('#rail-environment').textContent=connected?environment:'미연결';$('#rail-order-state').textContent=view.orderLabel;
  const health=$('#rail-health-state');health.hidden=!view.warning;health.textContent=view.healthLabel;health.title=view.warning;
  const footer=$('#runtime-footer');footer.textContent=environment+' · '+view.orderLabel+(view.warning?' · '+view.healthLabel:'');footer.title=summary;
  $('.rail [data-page="settings"].nav-item').title=summary;
  $('.editor-demo-note').innerHTML=icon('shield')+environment+' 환경 · 저장 후 봇 정지 · 미체결·TP/SL 취소 · 봇 시작 시 '+(enabled?'주문 실행 가능':'API 연결·주문 허용 필요');
}
function goPage(page) {
  if (!['home','bots','activity','settings'].includes(page)) page='home';
  if(currentPage==='home'&&page!=='home')persistChartView();
  currentPage=page; $$('.page').forEach(el=>el.hidden=el.id!==`page-${page}`);
  $$('[data-page]').forEach(el=>{el.classList.toggle('active',el.dataset.page===page); if(el.dataset.page===page) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');});
  $('#status-page').textContent=({home:'시장 조회',bots:'봇 작업실',activity:'활동 기록',settings:'설정'})[page];
  if (location.hash!==`#${page}`) history.replaceState(null,'',`#${page}`);
  if(page==='home') { renderHomeTable();if(serverState)updateChart(false); }
  if(page==='bots') {renderBots();loadPositionCosts();}
  closeMarket();
  window.scrollTo(0,0);
}
function coinGlyph(symbol) { return ({BTCUSDT:'₿',ETHUSDT:'Ξ',SOLUSDT:'◎',BNBUSDT:'B',XRPUSDT:'X',DOGEUSDT:'Ð'})[symbol] || '◈'; }
function currentInstrument(){return marketInstruments.find(s=>s.market===currentMarket&&s.symbol===currentSymbol)||{market:currentMarket,symbol:currentSymbol,baseAsset:SYMBOLS.find(s=>s.symbol===currentSymbol)?.short||currentSymbol,quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL',price:SYMBOLS.find(s=>s.symbol===currentSymbol)?.price,change:SYMBOLS.find(s=>s.symbol===currentSymbol)?.change};}
async function loadMarkets(){
  const result=await api('/market-data/catalog');marketInstruments=result.symbols.map(item=>({...item,color:SYMBOLS.find(s=>s.short===item.baseAsset)?.color||'#8aa497'}));marketCatalogErrors=result.errors;marketCatalogReady=true;renderMarket();if($('#symbol-dialog').open)renderSymbolResults($('#symbol-search').value);
}
function renderMarket(){
  const symbol=currentInstrument(),snapshot=marketSnapshot?.market===currentMarket&&marketSnapshot?.ticker.symbol===currentSymbol?marketSnapshot:null;
  const last=snapshot?.ticker.lastPrice??symbol.price,change=snapshot?.ticker.priceChangePercent??symbol.change;
  $('#main-symbol').textContent=symbol.symbol;$('#main-price').textContent=price(last);$('#main-change').textContent=change!=null&&Number.isFinite(Number(change))?signed(change)+'%':'—';$('#main-change').className=change>=0?'positive':'negative';
  $('#main-coin').textContent=coinGlyph(symbol.symbol);$('#main-coin').style.color=symbol.color||'#8aa497';$('#main-coin').style.background=(symbol.color||'#8aa497')+'20';
  $('#main-symbol').parentElement.querySelector('small').textContent=productLabel(symbol)+' · BINANCE 실전 공개 시세';
  $('#stat-high').textContent=price(snapshot?.ticker.highPrice);$('#stat-low').textContent=price(snapshot?.ticker.lowPrice);
  $('#stat-volume').textContent=snapshot?fmt(snapshot.ticker.quoteVolume??snapshot.ticker.baseVolume,0)+' '+(snapshot.ticker.quoteVolume!=null?symbol.quoteAsset:symbol.baseAsset):'—';
  const funding=snapshot?.premium?.lastFundingRate,stat=$('.market-stats>div:last-child');stat.querySelector('small').textContent=funding!=null?'펀딩비율':'상품 유형';stat.querySelector('span').textContent=funding!=null?fmt(funding*100,4)+'%':productLabel(symbol);stat.querySelector('span').className=funding!=null?(funding>=0?'positive':'negative'):'';$('#book-price').textContent=price(last);
  function bookRows(rows,side){let total=0;const computed=(rows||[]).slice(0,6).map(row=>({price:Number(row[0]),qty:Number(row[1]),total:total+=Number(row[1])}));const max=total||1;return (side==='ask'?computed.reverse():computed).map(row=>'<button type="button" class="book-row '+side+'" data-book-price="'+row.price+'" aria-label="'+row.price+' 가격 입력" style="--depth:'+Math.min(100,row.total/max*100)+'%"><span>'+price(row.price)+'</span><span>'+fmt(row.qty,3)+'</span><span>'+fmt(row.total,3)+'</span></button>').join('');}
  $('#book-asks').innerHTML=bookRows(snapshot?.book.asks,'ask');$('#book-bids').innerHTML=bookRows(snapshot?.book.bids,'bid');$('.orderbook .panel-heading>.muted').textContent=symbol.quoteAsset;
  const sum=rows=>(rows||[]).slice(0,6).reduce((total,row)=>total+Number(row[1]),0),bid=sum(snapshot?.book.bids),ask=sum(snapshot?.book.asks),ratio=(bid+ask)?bid/(bid+ask)*100:0;
  $('.book-ratio').innerHTML='<span>매수 '+(snapshot?fmt(ratio,1)+'%':'—')+'</span><span>매도 '+(snapshot?fmt(100-ratio,1)+'%':'—')+'</span>';$('.ratio-bar>span').style.width=ratio+'%';
  manualUI?.setState({instrument:symbol,state:serverState,quote:snapshot});
}
function syncPositionPriceLines(){
  if(!positionPriceLines)return;const visible=chartRenderedKey.startsWith(currentMarket+':'+currentSymbol+':')&&candles.length>0;
  positionPriceLines.update(visible?chartEntryLines(serverState,currentMarket,currentSymbol):[]);
}
function selectSymbol(symbol,market='usdm') {if(!marketInstruments.some(s=>s.market===market&&s.symbol===symbol)&&!(market==='usdm'&&SYMBOLS.some(s=>s.symbol===symbol)))return;persistChartView();currentMarket=market;currentSymbol=symbol;chartWorkspace.select({market,symbol});syncPositionPriceLines();renderMarket();updateChart();closeMarket();}
function persistChartView(){
  if(!chart||currentPage!=='home'||chartRestoring||chartRenderedKey!==chartViewKey(currentMarket,currentSymbol,currentInterval)||!candles.length)return;
  clearTimeout(chartSaveTimer);const paneList=chart.panes(),total=paneList.reduce((sum,p)=>sum+p.getHeight(),0)||1,panes={};
  paneList.forEach((pane,index)=>{const id=index===0?'price':homeStudies.rows.find(row=>row.pane===index)?.study.id;if(id)panes[id]=pane.getHeight()/total;});
  chartWorkspace.remember(currentMarket,currentSymbol,currentInterval,{range:chart.timeScale().getVisibleLogicalRange(),count:candles.length,panes,price:{autoScale:candleSeries.priceScale().options().autoScale,...(candleSeries.priceScale().getVisibleRange()||{})},lines:drawnLines.map(line=>line.options().price)});
}
function restoreChartLines(){
  drawnLines.forEach(line=>candleSeries.removePriceLine(line));drawnLines=[];
  for(const value of chartWorkspace.lines(currentMarket,currentSymbol))addChartLine(value);
}
function addChartLine(value){
  if(drawnLines.length>=50){toast('수평선은 종목당 50개까지 저장합니다.',true);return;}
  drawnLines.push(candleSeries.createPriceLine({price:value,color:'#d0b77d',lineWidth:1,lineStyle:window.LightweightCharts.LineStyle.Dashed,axisLabelVisible:true,title:'수평선'}));
}
function setChartType(type){
  if(!CHART_TYPE_IDS.includes(type))return;persistChartView();candleType=type;chartWorkspace.select({candleType});syncChartButtons();
  if(chartRenderedKey===chartViewKey(currentMarket,currentSymbol,currentInterval)&&marketSnapshot)drawHomeChart(marketSnapshot,currentMarket,currentSymbol,currentInterval,false);else updateChart(false);
}
function replaceHomePrice(next){
  const options=drawnLines.map(line=>line.options());candleSeries=next;positionPriceLines.setSeries(next);currentPriceLine.setSeries(next);homeStudies.priceSeries=next;candleInspector.setSeries(next);chartExecutions.setSeries(next);drawnLines=options.map(option=>next.createPriceLine(option));
}
function setChartInterval(interval){
  if(!CHART_INTERVALS.includes(interval))return;persistChartView();currentInterval=interval;chartWorkspace.select({interval});syncChartButtons();renderMarket();updateChart();
}
function syncChartExecutions(){
  if(chartRenderedKey===chartViewKey(currentMarket,currentSymbol,currentInterval))chartExecutions?.update({state:serverState,market:currentMarket,symbol:currentSymbol,candles,interval:currentInterval});
}
function syncChartButtons(){
  timeframePicker.sync(currentInterval);
  homeTypePicker.sync(candleType);
  $$('[data-interval]').forEach(button=>button.classList.toggle('active',button.dataset.interval===currentInterval));
  $$('[data-range]').forEach(button=>button.classList.toggle('active',button.dataset.range===chartWorkspace.selection.range));
}
function applyChartRange(preset){
  chartWorkspace.select({range:preset});syncChartButtons();if(!chart||!candles.length)return;
  chart.timeScale().setVisibleLogicalRange(presetRange(candles.length,currentInterval,preset));persistChartView();
}
function initChart() {
  if (!window.LightweightCharts) { $('#chart-fallback').hidden=false; return; }
  const L=window.LightweightCharts;
  chart=L.createChart($('#chart'),{autoSize:true,layout:{background:{type:'solid',color:'#ffffff'},textColor:'#7e8b96',fontFamily:'Segoe UI, sans-serif',fontSize:10,attributionLogo:true,panes:{separatorColor:'#e9eef1',separatorHoverColor:'#d5e0df',enableResize:true}},grid:{vertLines:{color:'#edf1f4'},horzLines:{color:'#edf1f4'}},crosshair:{mode:L.CrosshairMode.Normal,vertLine:{color:'#586c83',labelBackgroundColor:'#344456'},horzLine:{color:'#586c83',labelBackgroundColor:'#344456'}},rightPriceScale:{borderColor:'#e2e8ec',scaleMargins:{top:.17,bottom:.10}},timeScale:{borderColor:'#e2e8ec',timeVisible:true,secondsVisible:false,rightOffset:8,barSpacing:7,...koreanTimeOptions().timeScale},localization:koreanTimeOptions().localization});
  homePrice=new PriceChart(chart,{type:candleType,onReplace:replaceHomePrice});candleSeries=homePrice.series;
  positionPriceLines=new PositionPriceLines(candleSeries,{lineStyle:L.LineStyle.Dashed,summary:$('#chart-entry-summary')});
  homeStudies=new StudyRenderer(chart,{legend:$('#indicator-legend'),priceSeries:candleSeries,followCrosshair:false,onPaneCount:count=>$('.chart-body').style.setProperty('--study-extra-height',Math.max(0,count-1)*110+'px')});
  currentPriceLine=new CurrentPriceLine(candleSeries);candleInspector=installCandleInspector($('#chart-inspector'),{chart,studies:homeStudies,series:candleSeries,isDrawing:()=>drawingMode,chartElement:$('#chart')});
  chartExecutions=new ChartExecutions(candleSeries,{toggle:$('#chart-executions-toggle'),inspector:candleInspector});
  chart.subscribeClick(param=> { if (!drawingMode || !param.point) return; const p=candleSeries.coordinateToPrice(param.point.y); if (!Number.isFinite(p)) return; addChartLine(p);persistChartView(); drawingMode=false; $$('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool==='cursor')); toast('차트에 수평선을 추가했습니다.'); });
  chart.timeScale().subscribeVisibleLogicalRangeChange(()=>{if(chartRestoring||chartRenderedKey!==chartViewKey(currentMarket,currentSymbol,currentInterval))return;clearTimeout(chartSaveTimer);chartSaveTimer=setTimeout(persistChartView,120);});
  $('.chart-container').addEventListener('pointerup',()=>requestAnimationFrame(persistChartView));
  window.addEventListener('pagehide',persistChartView);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persistChartView();});
  updateChart();
}
async function updateChart(resetRange=true) {
  if(!chart) return;
  const request=++chartRequest,symbol=currentSymbol,market=currentMarket,interval=currentInterval;
  if(chartRenderedKey!==chartViewKey(market,symbol,interval)){currentPriceLine?.clear();candleInspector?.clear();chartExecutions?.clear();homeStudies?.clear();homePrice?.clear();}
  let snapshot;
  try{snapshot=await api('/market-data/quote?market='+encodeURIComponent(market)+'&symbol='+encodeURIComponent(symbol)+'&interval='+encodeURIComponent(interval));if(request!==chartRequest)return;marketSnapshot=snapshot;marketError=null;const meta=marketInstruments.find(s=>s.market===market&&s.symbol===symbol)||currentInstrument();meta.price=snapshot.ticker.lastPrice;meta.change=snapshot.ticker.priceChangePercent;meta.volume=snapshot.ticker.quoteVolume;renderMarket();renderRuntimeBanner();}
  catch(error){if(request!==chartRequest)return;marketError=error.message;renderRuntimeBanner();return;}
  drawHomeChart(snapshot,market,symbol,interval,resetRange);
}
function drawHomeChart(snapshot,market,symbol,interval,resetRange=false){
  const nextKey=chartViewKey(market,symbol,interval),changed=chartRenderedKey!==nextKey,previousRange=!changed?chart.timeScale().getVisibleLogicalRange():null;chartRestoring=true;
  candles=snapshot.candles;
  const s=currentInstrument();const tick=Number(s.tickSize),parts=String(tick).split('e');const precision=tick>0?Math.max(0,Math.min(12,(parts[0].split('.')[1]||'').length-Number(parts[1]||0))):s.price<1?6:2;
  const displayed=homePrice.render(candleType,candles,{type:'price',precision,minMove:tick||10**-precision});homeStudies.update(candles,currentInterval,candleType);
  candleInspector.update({key:nextKey,raw:candles,displayed,heikin:candleType==='heikin',chartType:candleType});if(candles.length)currentPriceLine.update(snapshot.ticker.lastPrice,candles.at(-1)?.open);else currentPriceLine.clear();
  $('#chart').setAttribute('aria-label',currentSymbol+' · '+currentInterval+' 바이낸스 가격 차트. 마우스 드래그로 이동하고 휠로 확대합니다. 캔들을 클릭하면 해당 봉의 가격과 지표 값을 고정합니다.');
  $('#chart-name').textContent=`${currentSymbol} · ${productLabel(currentInstrument())} · ${currentInterval} · ${chartTypeCaption(candleType)}`;
  if(changed||resetRange){
    const saved=chartWorkspace.view(market,symbol,interval),range=restoredRange(saved.offset,candles.length)||presetRange(candles.length,interval,chartWorkspace.selection.range);
    chart.timeScale().setVisibleLogicalRange(range);restoreChartLines();
    candleSeries.priceScale().applyOptions({autoScale:saved.price?.autoScale!==false});if(saved.price?.autoScale===false&&Number.isFinite(saved.price.from)&&Number.isFinite(saved.price.to))candleSeries.priceScale().setVisibleRange({from:saved.price.from,to:saved.price.to});
    chart.panes().forEach((pane,index)=>{const id=index===0?'price':homeStudies.rows.find(row=>row.pane===index)?.study.id;if(saved.panes?.[id])pane.setStretchFactor(saved.panes[id]);});
  }else if(previousRange)chart.timeScale().setVisibleLogicalRange(previousRange);
  if(changed||resetRange)homeStudies.revealFuture();chartRenderedKey=nextKey;chartRestoring=false;syncChartButtons();syncPositionPriceLines();syncChartExecutions();
  $('.chart-caption>.muted').textContent=time(snapshot.asOf)+' 수신';
}
function positionSymbolButton(symbol){
  return '<button type="button" class="position-symbol-link '+(currentMarket==='usdm'&&symbol===currentSymbol?'active':'')+'" data-position-symbol="'+esc(symbol)+'" aria-label="'+esc(symbol)+' 차트 보기" title="'+esc(symbol)+' 차트 보기"><strong>'+esc(symbol)+'</strong>'+icon('chart')+'</button>';
}
function importPositionButton(position){
  const direction=['LONG','SHORT'].includes(position.positionSide)?position.positionSide:position.quantity>0?'LONG':'SHORT';
  const owner=bots.find(bot=>bot.symbol===position.symbol&&bot.quantity>0&&(!serverState?.positionMode||serverState.positionMode!=='HEDGE'||bot.positionDirection===direction));
  return !owner||owner.runtime?.importPending?'<button type="button" class="home-import-button" data-import-position="'+esc(position.symbol+':'+direction)+'">'+icon('bot')+(owner?'가져온 정보 갱신':'봇에 맡기기')+'</button>':'';
}
async function showPositionChart(symbol){
  try{if(!marketCatalogReady)await loadMarkets();const instrument=marketInstruments.find(s=>s.market==='usdm'&&s.symbol===symbol);if(!instrument){toast('해당 포지션 종목의 공개 시세를 찾을 수 없습니다.',true);return;}selectSymbol(symbol,'usdm');renderHomeTable();$('#symbol-picker').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}catch(error){toast(error.message,true);}
}

function positionCostKey(state){
 if(!state?.connected||!state.connectionId)return '';
 const held=(state.positionOwners||state.bots||[]).filter(b=>Number(b.quantity??b.runtime?.quantity)>0);
 return held.length?JSON.stringify([state.connectionId,held.map(b=>[b.id,b.quantity??b.runtime?.quantity,b.entryPrice??b.runtime?.entryPrice,b.positionDirection??b.runtime?.direction,b.runtime?.positionEpoch]),state.fills?.[0]?.id]):'';
}
async function loadPositionCosts(){
 const key=positionCostKey(serverState);
 if(key!==positionCostsKey){positionCostsKey=key;positionCosts=null;positionCostsAt=0;}
 if(currentPage!=='bots'||!key||positionCostsPending||Date.now()-positionCostsAt<15000)return;
 const request={key};positionCostsPending=request;
 try{const value=await api('/positions/costs');if(key!==positionCostKey(serverState)||value.connectionId!==serverState?.connectionId)return;positionCosts=value;positionCostsAt=Date.now();renderOffice();}
 catch{positionCostsAt=Date.now()-10000;}
 finally{if(positionCostsPending===request)positionCostsPending=null;}
}

async function loadPositionInsights(){
  const state=serverState,key=state?.connected?(state.connectionId||state.environment)+':'+state.bots.map(b=>b.id+':'+(b.statsReset?.at||0)).join(','):'';
  if(key!==positionInsightsKey){positionInsightsKey=key;positionInsights=null;positionInsightsAt=0;positionInsightsPending=null;}
  if(!key||!state.connectionId||positionInsightsPending||Date.now()-positionInsightsAt<60000)return;
  const request={key};positionInsightsPending=request;
  try{const value=await api('/positions/insights');if(request.key!==positionInsightsKey||value.connectionId&&value.connectionId!==serverState?.connectionId)return;positionInsights=value;positionInsightsAt=Date.now();renderHomeTable();renderBots();if($('#bot-dialog').open)renderEditorStatus();}
  catch{positionInsightsAt=Date.now()-45000;}
  finally{if(positionInsightsPending===request)positionInsightsPending=null;}
}
async function preparePositionClose(key,ownerId=''){
  try{
    const [symbol,direction]=key.split(':'),position=serverState?.account?.positions.find(p=>p.symbol===symbol&&(['LONG','SHORT'].includes(p.positionSide)?p.positionSide:p.quantity>0?'LONG':'SHORT')===direction);
    if(!position){toast('현재 보유 포지션을 다시 확인해 주세요.',true);return;}
    const known=()=>marketInstruments.some(item=>item.market==='usdm'&&item.symbol===symbol)||SYMBOLS.some(item=>item.symbol===symbol);if(!known()&&!marketCatalogReady)await loadMarkets();if(!known())throw new Error('해당 포지션의 주문 종목을 찾을 수 없습니다.');selectSymbol(symbol,'usdm');const owner=(serverState.positionOwners||bots).find(b=>b.id===ownerId&&b.symbol===symbol);if($('#bot-dialog').open)$('#bot-dialog').close();goPage('home');manualUI.prepareClose(position,owner?.id||'');
    if(matchMedia('(max-width:900px)').matches)openMarket();
    $('#manual-order-ticket').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});$('#manual-amount').focus({preventScroll:true});
  }catch(error){toast(error.message,true);}
}
function renderHomeTable(){
  const account=serverState?.account,positions=account?.positions||[];$('#position-count').textContent=positions.length;document.querySelector('[data-home-tab="orders"]>span').textContent=homeOpenOrders(serverState).length;
  $('#home-table').classList.remove('has-mobile-positions');
  if(!account){$('#home-table').innerHTML='<div class="empty-table">'+icon('wallet')+'계좌를 연결하면 잔고·포지션·주문을 조회할 수 있습니다.</div>';return;}
  if(homeTab==='positions'){
    if(!positions.length){$('#home-table').innerHTML='<div class="empty-table">'+icon('check')+'보유 포지션이 없습니다.</div>';return;}
    const previousScroller=$('#home-table .position-table-scroll'),scrollLeft=previousScroller?.scrollLeft||0,restoreFocus=previousScroller&&document.activeElement===previousScroller;
    $('#home-table').innerHTML=positionRows(positions,{bots:serverState.positionOwners||bots,state:serverState,insights:positionInsights,symbolButton:positionSymbolButton,importButton:importPositionButton})+'<p class="position-data-note">매매손익·순손익은 최근 30일 종목 전체 기준(양방향 합산), 미실현 제외 · 비율은 현재 증거금 대비 참고율'+(!serverState.connectionId?' · 추가 조회 정보는 서버 갱신 후 표시됩니다.':'')+(positionInsights?.realized&&!positionInsights.realized.complete?' · 실현손익 조회 확인 필요':'')+'</p>';
    const scroller=$('#home-table .position-table-scroll');scroller.scrollLeft=scrollLeft;if(restoreFocus)scroller.focus({preventScroll:true});
  }else if(homeTab==='orders'){
    $('#home-table').innerHTML=homeOrderTable(serverState);
  }else{
    const rows=(serverState.fills||[]).filter(f=>f.quantity);$('#home-table').innerHTML=rows.length?'<table class="data-table"><thead><tr><th>시간</th><th>종목</th><th>매매 구분</th><th>체결 수량</th><th>체결가</th></tr></thead><tbody>'+rows.map(f=>'<tr><td>'+time(f.tradeTime||f.at)+'</td><td>'+positionSymbolButton(f.symbol)+'</td><td>'+fillActionMarkup(f)+'</td><td>'+fmt(f.quantity,6)+'</td><td>'+price(f.price)+'</td></tr>').join('')+'</tbody></table>':'<div class="empty-table">'+icon('history')+'이 앱의 체결 원장에 기록된 체결이 없습니다.</div>';
  }
}

function pixelScene(bot,mini=false){return `<svg class="${mini?'pixel-mini':'pixel-scene'}" viewBox="0 0 260 165" role="img" aria-label="${esc(bot.name)} 사람 캐릭터"><rect x="25" y="130" width="210" height="3" fill="#dbe4d2"/>${roomAvatar(bot,130,84)}</svg>`;}
function taskLabel(b){if(b.runtime?.importPending)return '포지션 가져옴 · 관리 시작 대기';if(b.error)return '확인 필요: '+b.error;if(b.runtime?.waiting)return b.runtime.waiting.message;if(!b.runtime?.runEnabled&&!b.runtime?.managementEnabled&&b.runtime?.pendingOrderCount)return '봇 정지 · 거래소 주문 남음 · 정지 버튼으로 취소';if(b.runtime?.orderRetry)return b.runtime.orderRetry.label;if(b.runtime?.runEnabled&&b.runtime.entryBlocked)return b.quantity>0?"조건 감시·보유 포지션 관리 중":"조건 감시 중";if(!b.runtime?.runEnabled&&!b.runtime?.managementEnabled&&b.quantity>0)return '봇 정지 · 보유 포지션 유지';if(b.entryPaused&&b.quantity>0)return '진입 중지 · 자동 관리 중';return b.status==='paused'?'시작 대기':({watching:'수식 조건 감시 중',position:'보유 포지션 관리 중',waiting:'주문 결과 확인 중'})[b.task]||'대기 중';}
function renderBots(){
  const operating=bots.filter(budgetIncluded),assigned=operating.reduce((sum,b)=>sum+estimateBudget(b),0),balance=serverState?.account?.walletBalance,running=operating.filter(b=>b.status==='running').length;
  $('#nav-count').textContent=bots.length;$('#all-bot-count').textContent=operating.length;$('#running-count').textContent=running;$('#paused-count').textContent=operating.length-running;
  const account=serverState?.account,equity=account?.equity??(account?account.walletBalance+account.unrealizedProfit:null),unrealized=account?.unrealizedProfit??null;
  $('#account-equity').innerHTML=fmt(equity,2)+'<span>USDT</span>';$('#account-wallet').textContent=fmt(balance,2)+' USDT';$('#account-unrealized').textContent=unrealized===null?'— USDT':signed(unrealized)+' USDT';$('#account-unrealized').className=unrealized===null?'':unrealized>=0?'positive':'negative';
  $('#total-assigned').innerHTML=fmt(assigned,0)+'<span>USDT</span>';$('#total-available').innerHTML=fmt(balance==null?null:balance-assigned,2)+'<span>USDT</span>';$('#allocated-bar').style.width=(balance?Math.min(100,assigned/balance*100):0)+'%';
  const performance=workroomPerformance(operating),pnl=performance.pnl;$('#total-pnl').innerHTML=(serverState?.connected&&pnl!==null?signed(pnl):'—')+'<span>USDT</span>';$('#total-pnl').className=pnl>=0?'positive':'negative';
  $('#total-roi').textContent=serverState?.connected&&performance.roi!==null?(performance.roi>=0?'+':'')+fmt(performance.roi,2)+'%':'—%';$('#total-roi').className='workroom-roi '+(pnl>=0?'positive':'negative');$('#total-roi').title='현재 등록된 봇의 (누적 실현손익 + 현재 미실현손익) ÷ 기준예산 합계 '+fmt(performance.baseBudget,2)+' USDT. 확인된 USDT 수수료 포함, 펀딩 제외.';
  const performances=operating.map(b=>botPerformance(b,positionInsights,serverState?.fills)),gross=performances.every(p=>p.gross!==null)?performances.reduce((sum,p)=>sum+p.gross,0):null,net=performances.every(p=>p.net!==null)?performances.reduce((sum,p)=>sum+p.net,0):null,base=performance.baseBudget;
  $('#total-pnl').innerHTML=(serverState?.connected?signed(gross):'—')+'<span>USDT</span>';$('#total-pnl').className=gross>=0?'positive':'negative';$('#total-roi').textContent=serverState?.connected&&gross!==null&&base>0?signed(gross/base*100)+'%':'—%';$('#total-roi').title='매매손익(비용 차감 전) ÷ 기준예산 합계';
  $('#total-net-pnl').textContent=serverState?.connected&&net!==null?signed(net)+' USDT':'— USDT';$('#total-net-roi').textContent=serverState?.connected&&net!==null&&base>0?signed(net/base*100)+'%':'—%';$('#total-net-pnl').className=net>=0?'positive':'negative';$('#total-net-roi').className='workroom-roi '+(net>=0?'positive':'negative');
  const visible=operating.filter(b=>botFilter==='all'||b.status===botFilter);if(!visible.some(b=>b.id===selectedBotId))selectedBotId=visible[0]?.id;renderOffice();
}

function renderOffice(){
  const operating=bots.filter(budgetIncluded),archived=bots.filter(b=>!budgetIncluded(b));
  const visible=rosterTab==='archive'?archived:operating,filter=rosterTab==='archive'?'all':botFilter;
  renderOfficeRoster($('#office-roster-list'),visible,{selectedId:selectedBotId,filter,icon,costs:positionCosts&&positionCosts.connectionId===serverState?.connectionId?positionCosts.byBot:{}});
  $('#office-roster-count').textContent=visible.filter(b=>filter==='all'||b.status===filter).length;
  for(const button of $$('[data-roster-tab]')){const active=button.dataset.rosterTab===rosterTab;button.setAttribute('aria-selected',String(active));button.classList.toggle('active',active);button.querySelector('span').textContent=button.dataset.rosterTab==='archive'?archived.length:operating.length;}
  botControls.sync();
}

async function toggleBot(id){
  const b=bots.find(b=>b.id===id);if(!b)return;
  if(!serverState?.connected){goPage('settings');toast('여기서 API 키를 연결한 뒤 봇을 시작하세요.',true);return;}
  try{await api('/bots/'+encodeURIComponent(id)+(botNeedsStop(b)?'/pause':'/start'),{method:'POST'});await syncWorkspace();toast(botNeedsStop(b)?'봇을 정지했습니다. 보유 포지션은 유지하며 주문 취소 결과를 확인합니다.':'조건 감시를 시작했습니다.');}catch(error){toast(error.message,true);}
}

function renderActivity() { $('#activity-list').innerHTML=logs.map(l=>`<article class="activity-row"><span class="activity-icon">${icon('history')}</span><div><strong>${esc(l.title)}</strong><p>${esc(l.message)}</p></div><time datetime="${new Date(l.at).toISOString()}">${time(l.at)}</time></article>`).join(''); }
function download(filename,value) { const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }

const options = (items, value) => items.map(([key,label])=>`<option value="${esc(key)}" ${String(key)===String(value)?'selected':''}>${esc(label)}</option>`).join('');
const bindInput=(label,key,value,{unit='',type='number',min='',max='',step='any',note='',full=false}={})=>`<label class="field ${full?'full':''}"><span>${label}</span><span class="input-unit"><input data-bind="${key}" type="${type}" value="${esc(value)}" ${type==='number'?`min="${min}" max="${max}" step="${step}"`:''} ${type==='text'?'maxlength="32"':''} aria-label="${label}">${unit?`<span>${unit}</span>`:''}</span>${note?`<small>${note}</small>`:''}</label>`;
const bindSelect=(label,key,value,items,note='')=>`<label class="field"><span>${label}</span><select data-bind="${key}" aria-label="${label}">${options(items,value)}</select>${note?`<small>${note}</small>`:''}</label>`;
function getPath(obj,key){return key.split('.').reduce((v,k)=>v?.[k],obj);}
function setPath(obj,key,value){const keys=key.split('.');const last=keys.pop();keys.reduce((v,k)=>v[k],obj)[last]=value;}
function botSymbolField(){
  const selected=SYMBOLS.find(s=>s.symbol===draft.symbol);
  return '<div class="field"><span>담당 종목</span><button type="button" id="bot-symbol-picker" class="bot-symbol-picker" aria-label="담당 종목 검색" aria-haspopup="dialog"><span><strong>'+esc(draft.symbol)+'</strong><small>'+esc(selected?symbolName(selected):'USDT 무기한 선물')+'</small></span>'+icon('search')+'</button><small>심볼이나 종목명을 검색해 선택하세요.</small></div>';
}
function botConfigLocked(){return Boolean(draft.quantity>0||serverState?.orders?.some(order=>order.botId===draft.id));}
const budgetEditor=createBudgetEditor({root:$('#bot-dialog'),api,getDraft:()=>draft,getState:()=>serverState,onUpdate(){for(const key of ['budget','budgetMode','budgetType','budgetPercent','budgetShortfall','budgetFloor','budgetLossCarry','budgetRecovery']){const el=$('[data-bind="'+key+'"]');if(el)el.value=draft[key]??(key==='budgetType'?'amount':key==='budgetShortfall'?'strict':key==='budgetPercent'?25:key==='budgetLossCarry'?'carry':key==='budgetRecovery'?'ratio':'fixed');}updateBudgetPreview();}});
function renderBasic() {
  $('#editor-basic').innerHTML=`<div class="form-section"><h3>봇의 이름과 담당 종목</h3><div class="form-grid">${bindInput('봇 이름','name',draft.name,{type:'text',full:true})}${botSymbolField()}<div class="field full" id="bot-appearance-summary">${appearanceCard(draft)}</div></div></div><div class="form-section"><h3>이 봇의 운용 예산</h3><div class="editor-wallet-summary"><span>전체 선물 USDT 지갑 금액 <strong>${fmt(serverState?.account?.walletBalance)} USDT</strong></span><span>현재 주문 가능 <strong>${fmt(serverState?.account?.availableBalance)} USDT</strong></span></div>${budgetSelectionMarkup(draft)}<div class="form-grid">${budgetFieldsMarkup(draft)}${bindSelect('포지션당 진입 횟수','maxEntries',draft.maxEntries,[[0,'제한 없음 (기본)'],...Array.from({length:20},(_,i)=>[i+1,'최대 '+(i+1)+'회'])],'처음 진입과 추가 진입의 체결 횟수입니다. 전량 정리하면 0회로 초기화합니다.')}${bindSelect('증거금 모드','margin',draft.margin,[['ISOLATED','아이솔레이트 (격리)'],['CROSSED','크로스 (교차)']])}</div><div class="budget-preview" id="budget-preview"></div><div class="field-note">${icon('info')}<span>레버리지는 조건·행동 탭에서 롱·숏 진입 조건마다 정합니다. 봇 예산은 주문 운용 한도이며 최대 손실 보장은 아닙니다. 크로스는 계좌의 담보를 공유합니다.</span></div></div>`;
  budgetEditor.paint();renderLeverage();loadLeverageLimits();updateBudgetPreview();
  const savedBot=bots.find(bot=>bot.id===draft.id);if(savedBot)$('#editor-basic .form-section').insertAdjacentHTML('beforeend','<div class="import-bot-shortcut"><button type="button" class="button secondary" data-import-for-bot="'+esc(savedBot.id)+'">기존 포지션 연결</button><small>계좌의 '+esc(savedBot.symbol)+' 포지션을 이 봇에 맡깁니다. 현재 저장된 조건과 예산을 유지합니다.</small></div>');
  if(botConfigLocked()){$('#bot-symbol-picker').disabled=true;$('#editor-basic [data-bind="margin"]').disabled=true;}
}
function renderLeverage(){
  const rule=currentRule(),range=$('#rule-leverage-range'),numberInput=$('#rule-leverage-number'),note=$('#leverage-limit-note');if(!rule||!isEntry(rule.action)||!range||!numberInput)return;
  const cap=leverageCap(leverageLimits,estimateBudget(draft));
  range.max=numberInput.max=Math.max(1,cap);range.disabled=!leverageLimits?.available||cap<1;range.value=Math.max(1,Math.min(cap,rule.leverage||1));range.setAttribute('aria-valuetext',range.value+'배');
  if(document.activeElement!==numberInput)numberInput.value=rule.leverage;
  const step=cap<=20?5:cap<=50?10:25,ticks=[1];for(let value=step;value<cap;value+=step)ticks.push(value);if(cap>1)ticks.push(cap);
  $('#leverage-ticks').innerHTML=ticks.map(value=>'<span>'+value+'×</span>').join('');
  const maximum=notionalCap(leverageLimits,rule.leverage);
  note.className=rule.leverage>cap?'leverage-error':'';
  note.textContent=(leverageLimits?.available?`${draft.symbol} · 거래소 최대 ${leverageLimits.maxLeverage}× · 예산 기준 최대 ${cap}×`+(maximum?` · 선택 배수의 명목 한도 ${fmt(maximum,0)} USDT`:'')+(rule.leverage>cap?' · 허용 범위로 조정하세요.':''):leverageLimits?.reason||'종목별 레버리지 한도를 조회하는 중…')+(botConfigLocked()?` · 현재 포지션은 ${draft.leverage}× 유지. 이 설정은 다음 새 포지션에 적용합니다.`:'');
}
function ruleLeverageMarkup(rule,prefix){return '<div class="leverage-field"><div class="leverage-heading"><span>이 진입 조건의 레버리지</span><label class="leverage-value"><input id="rule-leverage-number" type="number" data-bind="'+prefix+'.leverage" aria-label="이 진입 조건의 레버리지" min="1" max="125" step="1"><span>×</span></label></div><input id="rule-leverage-range" class="leverage-range" type="range" min="1" max="125" step="1" aria-label="진입 조건 레버리지 슬라이더"><div id="leverage-ticks" class="leverage-ticks"></div><small id="leverage-limit-note"></small><small>포지션이 없는 첫 진입 때 적용합니다. 보유 중 추가 진입은 현재 포지션 배수를 유지합니다. 같은 종목의 모든 봇·수동 매매는 거래소 레버리지와 증거금 모드를 공유합니다.</small></div>';}
async function loadLeverageLimits(){
  const request=++leverageRequest,symbol=draft.symbol;leverageLimits=null;renderLeverage();
  try{const limits=await api('/leverage?symbol='+encodeURIComponent(symbol));if(request!==leverageRequest||draft?.symbol!==symbol)return;leverageLimits=limits;}
  catch(error){if(request!==leverageRequest)return;leverageLimits={available:false,reason:'한도 조회 실패 · '+error.message};}
  renderLeverage();
}
function estimateBudget(bot){return effectiveBudget(withBudgetAllocation(bot,bots,serverState?.account?.walletBalance??Infinity,serverState?.account?.availableBalance));}

function updateBudgetPreview() {
  const stored=bots.find(bot=>bot.id===draft.id),view=withBudgetAllocation(previewBudgetPolicy({...stored,...draft,runtime:stored?.runtime}),bots,serverState?.account?.walletBalance??Infinity,serverState?.account?.availableBalance),limit=effectiveBudget(view),realized=budgetRealized(view),mode=draft.budgetMode||'fixed',usage=budgetUsage({...view,used:stored?.used,reserved:stored?.reserved});
  const amounts=draft.actionRules.filter(r=>r.enabled&&isEntry(r.action)).map(r=>limit*r.sizePercent/100),low=amounts.length?Math.min(...amounts):null,high=amounts.length?Math.max(...amounts):null;
  const notionals=draft.actionRules.filter(r=>r.enabled&&isEntry(r.action)).map(r=>limit*r.sizePercent/100*(r.leverage||draft.leverage));
  $('#budget-preview').innerHTML='<div><small>조건별 진입 증거금 · 현재 한도 기준</small><strong>'+fmt(low)+(high!==low?' ~ '+fmt(high):'')+'<span>USDT</span></strong></div><div><small>최대 명목 주문금액 · 조건별 배수 기준</small><strong>'+fmt(notionals.length?Math.max(...notionals):null)+'<span>USDT</span></strong></div><div><small>수수료·수량 여유분</small><strong>1% 제외 후 계산</strong></div>';
  let note=$('#budget-usage-note');if(!note){note=document.createElement('div');note.id='budget-usage-note';note.className='budget-usage-note';$('#budget-preview').after(note);}
  const explanation=isPercentBudget(draft)?percentBudgetDescription(draft):({fixed:'손실이 나도 설정한 기준 한도를 유지합니다.',pnl:'늘어난 계산 예산에 이후 손익을 계속 반영합니다.',floor:'실제 운용한도는 최소 '+fmt(draft.budgetFloor)+' USDT를 유지하고 계산 예산이 최소치를 넘으면 증가합니다. 계좌 여유가 없으면 최소 금액을 보장하지 않습니다.',capped:'손익을 반영하되 설정한 원금까지만 운용합니다.'}[mode]||'')+(mode==='fixed'?'':' '+budgetPolicyDescription(draft)+' 복구 대상으로 남은 손실 '+fmt(budgetRecoveryDebt(view))+' USDT.');
  note.innerHTML=(isPercentBudget(draft)?'<strong>계산 기준 잔액 '+fmt(percentBudgetBasis(view))+' USDT × '+fmt(draft.budgetPercent)+'%</strong><br>':'')+'<strong>목표 예산 '+fmt(requestedBudget(view,serverState?.account?.walletBalance,serverState?.account?.availableBalance))+' → 현재 운용한도 '+fmt(limit)+' USDT</strong><p>'+explanation+(draft.budgetShortfall==='available'?' 가용 한도가 부족하면 자동으로 축소하고 회복 시 목표 예산까지 복구합니다.':'')+'</p><strong>보유 증거금 '+fmt(usage.inPositions)+' / 미체결 진입 증거금 '+fmt(usage.pending)+' / 남은 예산 '+fmt(usage.available)+' USDT</strong><br>보유 증거금은 운용한도에 포함됩니다. 예산이 줄어도 기존 포지션을 자동 정리하지 않으며 새 진입만 남은 한도로 제한합니다.'+(!isPercentBudget(draft)?'<br>예산 반영 손익 '+signed(realized)+' USDT · 기준 '+(stored?.runtime?.budgetBaseline?.at?esc(new Date(stored.runtime.budgetBaseline.at).toLocaleString('ko-KR')):'운용 시작부터')+' · 기록을 유지하고 ⋯에서 예산 손익 기준만 재설정할 수 있습니다.':'')+'<br>변경은 저장 후 적용하며 자금을 따로 이체하지 않습니다.'+(usage.overBudget>0?'<p class="budget-overflow-note">현재 증거금이 한도보다 '+fmt(usage.overBudget)+' USDT 많습니다. 기존 보유분과 정리·보호 관리는 유지합니다.</p>':'')+(limit===0?'<p class="budget-overflow-note">현재 가용 한도가 0이므로 새 진입을 기다립니다.</p>':'');
}
function orderMarkup(rule,prefix){return '<div class="form-section rule-order-section"><h3>이 행동의 주문 방식</h3><div class="form-grid">'+bindSelect('주문 방식',prefix+'.order.type',rule.order.type,[['LIMIT','지정가'],['MARKET','시장가']])+bindSelect('지정가 기준',prefix+'.order.price',rule.order.price,[['bid','매수 1호가'],['ask','매도 1호가'],['last','현재가']])+bindInput('기준 가격에서 조정',prefix+'.order.ticks',rule.order.ticks,{unit:'틱',min:-100,max:100,step:1})+bindInput('체결 대기시간',prefix+'.order.timeout',rule.order.timeout,{unit:'초',min:1,max:3600,step:1})+bindSelect('미체결 잔량 처리',prefix+'.order.remainder',rule.order.remainder,[['cancel','잔량 취소 후 종료'],['market','잔량 취소 확인 후 시장가 전환']])+bindSelect('지정가 체결 정책',prefix+'.order.postOnly',String(rule.order.postOnly),[['true','Post-only · 메이커만'],['false','일반 지정가']])+'</div><div id="action-preview" class="action-preview"></div></div>';}

function renderConditions() {
  signatureHelp?.dispose();clearTimeout(formulaDebounce);
  const rule=currentRule()||draft.actionRules[0];selectedRuleId=rule?.id;draft.conditionMode='formula';
  const list='<div class="action-rules-heading"><div><h3>조건마다 실행할 행동을 정하세요</h3><p>진입 · 정리 · 봇 정지를 수식과 함께 설정합니다.</p></div><button type="button" class="button secondary" id="add-action-rule">'+icon('plus')+'조건 추가</button></div><div class="action-rule-list">'+draft.actionRules.map((r,i)=>'<div class="action-rule-row '+(r.id===selectedRuleId?'selected':'')+'"><button type="button" class="action-rule-select" data-select-rule="'+r.id+'" aria-pressed="'+(r.id===selectedRuleId)+'"><span class="rule-number">'+(i+1)+'</span><span><strong>'+ACTIONS[r.action]+'</strong><small>'+esc(r.formula||'조건식을 입력하세요')+'</small></span></button><label class="rule-enabled"><input type="checkbox" data-bind="actionRules.'+i+'.enabled" aria-label="조건 '+(i+1)+' 사용" '+(r.enabled?'checked':'')+'>사용</label></div>').join('')+'</div>';
  if(!rule){$('#editor-conditions').innerHTML=list;return;}
  const prefix=rulePrefix(),index=draft.actionRules.indexOf(rule),entry=isEntry(rule.action),stop=isStop(rule.action);rule.order||=makeActionRule().order;rule.reentry||=makeActionRule().reentry;
  const settings='<div class="rule-editor-heading"><h3>조건 '+(index+1)+'</h3><div><button type="button" data-move-rule="up" aria-label="선택 조건 위로" '+(!index?'disabled':'')+'>'+icon('chevron')+'</button><button type="button" data-move-rule="down" aria-label="선택 조건 아래로" '+(index===draft.actionRules.length-1?'disabled':'')+'>'+icon('chevron')+'</button><button type="button" id="remove-action-rule" aria-label="선택 조건 삭제" '+(draft.actionRules.length===1?'disabled':'')+'>'+icon('trash')+'</button></div></div><div class="form-grid rule-action-settings">'+bindSelect('조건 충족 시 행동',prefix+'.action',rule.action,Object.entries(ACTIONS))+(stop?'<div class="stop-action-note">조건이 충족되면 봇을 정지합니다. 자동 진입·정리·TP/SL을 중지하고 이 봇의 미체결·보호 주문을 취소합니다. 보유 포지션은 유지합니다. 다시 시작하려면 캐릭터의 시작을 선택하세요.</div>':bindInput(entry?'진입 비율 · 봇 예산 기준':'정리 비율 · 보유 수량 기준',prefix+'.sizePercent',rule.sizePercent,{unit:'%',min:.01,max:100,step:.01,note:entry?'봇 예산 안에서 이 조건이 사용할 증거금 비율':'선택한 정리 대상 수량의 비율입니다.'})+(!entry?bindSelect('정리 대상',prefix+'.closeScope',rule.closeScope||'bot',[['bot','이 봇 보유분'],['account','계좌 전체 보유분']],'계좌 보유분에는 다른 봇·수동 보유분이 포함됩니다. 현재수익률 등 포지션 조건도 선택한 대상 기준입니다.'):'')+bindSelect('같은 조건 재실행',prefix+'.reentry.mode',rule.reentry.mode,[['rearm','조건 해제 후 다시 충족'],['bar','봉마다 한 번'],['cooldown','시간 간격마다']],{rearm:'조건이 거짓이 됐다가 다시 참이 되면 실행합니다.',bar:'조건이 참이면 수식의 가장 짧은 봉 주기마다 한 번 실행합니다.',cooldown:'조건이 계속 참이면 아래 간격마다 다시 실행합니다.'}[rule.reentry.mode])+(rule.reentry.mode==='cooldown'?bindInput('같은 조건 재실행 간격',prefix+'.reentry.cooldown',rule.reentry.cooldown,{unit:'초',min:0,max:86400,step:1,note:'0초 = 간격 없음. 조건이 참이면 매 감시 주기(조회 설정의 감시 주기)마다 실행할 수 있습니다.'}):'')+(entry?bindInput('전량 정리 후 새 진입 대기',prefix+'.reentry.afterExitCooldown',rule.reentry.afterExitCooldown,{unit:'초',min:0,max:86400,step:1,note:'0초 = 대기 없음. 전량 정리 후 이 시간이 지나고 진입 조건도 맞아야 주문합니다.'})+ruleLeverageMarkup(rule,prefix):''))+ '</div>';
  $('#editor-conditions').innerHTML=list+settings+formulaEditorMarkup({...draft,formula:rule.formula,formulaTimeframe:rule.timeframe,formulaCandle:rule.candle},{prefix})+(stop?'<div id="action-preview" class="action-preview"></div>':orderMarkup(rule,prefix))+'<div class="field-note rule-behavior-note">'+icon('info')+'<span>봇 정지 조건은 신규 주문보다 먼저 처리합니다. 정리 조건은 진입보다 먼저 처리하며 같은 종류는 위쪽 조건을 먼저 실행합니다. 롱·숏 진입이 동시에 충족되면 진입을 보류합니다. 단방향 계좌에서는 같은 종목의 반대 매매가 기존 포지션과 상계됩니다. 정리 대상은 이 봇 보유분 또는 계좌 보유분으로 고릅니다. 정지는 자동 진입·정리·TP/SL을 모두 중지합니다. 보유 포지션은 유지하고 이 봇의 미체결·보호 주문은 취소합니다.</span></div>';
  $('#editor-conditions').querySelectorAll('[data-bind$=".closeScope"] option[value="account"]').forEach(el=>el.disabled=!serverState?.capabilities?.sharedPositions);
  signatureHelp=installSignatureHelp($('#formula-source'),$('#formula-signature'));renderLeverage();updateFormulaFeedback();updateActionPreview();
}
async function updateFormulaFeedback() {
  const rule=currentRule();if(!rule)return;
  const source=rule.formula||'',feedback=$('#formula-feedback'),request=++formulaRequest;
  $('#formula-count').textContent=source.length+' / 1000';
  $('#formula-lines').innerHTML=Array.from({length:Math.max(6,source.split('\n').length)},(_,i)=>String(i+1).padStart(2,'0')).join('<br>');
  if(!rule.enabled&&!source){feedback.className='formula-feedback';feedback.textContent='사용을 꺼 둔 조건입니다. 수식을 입력한 뒤 사용을 켜세요.';return;}
  try {
    const intervals=ruleIntervals(source);feedback.className='formula-feedback valid';feedback.innerHTML=icon('check')+'<div><strong>문법 정상</strong><span>거래소 봉으로 조건을 확인하는 중…</span></div>';
    const snapshots=await api('/formula/markets',{method:'POST',body:{symbol:draft.symbol,source}});if(request!==formulaRequest||!$('#bot-dialog').open)return;
    const {result}=evaluateRuleFormula(source,snapshots,actionFormulaPosition((serverState?.positionOwners||bots).find(b=>b.id===draft.id&&b.symbol===draft.symbol)||draft,rule,serverState));feedback.className='formula-feedback valid';
    let message=result.missing?'계산에 필요한 봉 또는 포지션 정보가 없습니다.':result.pass?'조회한 거래소 봉에서 조건 충족':'조회한 거래소 봉에서 조건 미충족';
    if(!result.ok)message=result.error;
    feedback.innerHTML=icon('check')+'<div><strong>문법 정상</strong><span>'+esc(message)+' · 수동 검사 결과 · '+ACTIONS[rule.action]+'</span></div>';
  } catch(error) {if(request!==formulaRequest)return;feedback.className='formula-feedback invalid';feedback.innerHTML=icon('info')+'<div><strong>수식을 확인해 주세요</strong><span>'+esc(error.message)+'</span></div>';}
}
function setFormulaExample(index) {
  const example=formulaExamples[index],rule=currentRule();if(!example||!rule)return;
  const textarea=$('#formula-source');rule.formula=example.value;textarea.value=rule.formula;$('#form-errors').hidden=true;updateFormulaFeedback();textarea.focus();
}
function renderActions() {
  if(!['MARK_PRICE','CONTRACT_PRICE'].includes(draft.exit.price))draft.exit.price='MARK_PRICE';
  $('#editor-actions').innerHTML='<div class="form-section"><h3>포지션 공통 보호 주문 <span class="protection-optional">선택 사항</span></h3><p class="protection-intro">익절·손절을 각각 켜거나 끌 수 있습니다. 둘 다 끄면 조건·행동 탭의 정리 조건만 사용합니다.</p>'+protectionEditorMarkup(draft.exit)+'<div class="field-note">'+icon('shield')+'<span>보호 주문은 봇이 관리하는 수량 전체에 적용합니다. 둘 다 끄면 거래소 TP·SL을 등록하지 않습니다. 기존 보호 주문의 변경·취소는 주문 실행이 허용된 동안 반영하며 취소 완료까지 확인합니다.</span></div></div><div class="form-section"><h3>주문 중복 방지와 소유 수량</h3><div class="field-note">'+icon('info')+'<span>각 조건의 실행과 주문 의도를 전송 전에 저장합니다. 접수 여부가 불명확하면 재전송하지 않고 조회합니다. 정리 행동은 조건마다 선택한 이 봇 보유분 또는 계좌 보유분에 적용합니다. 새 봇·복사본은 처음 시작하기 전까지 주문하지 않습니다.</span></div></div>';
}
function updateProtectionControls(){syncProtectionEditor($('#editor-actions'),draft.exit);}
function updateActionPreview() {
  const rule=currentRule(),preview=$('#action-preview');if(!rule||!preview)return;
  if(isStop(rule.action)){preview.textContent='조건 충족 → 봇 정지 · 자동 매매 중지 · 미체결·TP/SL 취소 · 포지션 유지';return;}
  const market=rule.order.type==='MARKET';preview.textContent='조건 충족 → '+ACTIONS[rule.action]+' · '+rule.sizePercent+'%'+ (isEntry(rule.action)?' · 새 포지션 '+rule.leverage+'×':' · '+(rule.closeScope==='account'?'계좌 전체 보유분':'이 봇 보유분'))+' · '+(market?'시장가':({bid:'매수 1호가',ask:'매도 1호가',last:'현재가'})[rule.order.price]+' '+rule.order.ticks+'틱 지정가 → '+rule.order.timeout+'초 뒤 잔량 '+(rule.order.remainder==='market'?'취소 확인 후 시장가 전환':'취소'));
  document.querySelector('[data-bind="'+rulePrefix()+'.sizePercent"]').disabled=rule.action==='CLOSE_ALL';
  $$('[data-bind^="'+rulePrefix()+'.order."]').forEach(el=>{if(!el.dataset.bind.endsWith('.type'))el.disabled=market;});
}
function renderEditorStatus() {
  if(!draft)return;const stored=bots.find(b=>b.id===draft.id)||draft;
  const saved=bots.some(b=>b.id===draft.id),controls=$('#editor-run-controls');controls.hidden=!saved;
  $('#editor-start-bot').disabled=!saved||stored.budgetIncluded===false||!!stored.runtime?.runEnabled||botStopPending(stored);$('#editor-pause-bot').disabled=!botNeedsStop(stored)||botStopPending(stored);
  $('#editor-run-state').textContent=stored.budgetIncluded===false?'보관 · 운용예산 미포함':stored.runtime?.stopPending?'정지 · 주문 취소 확인 중':stored.runtime?.runEnabled?(stored.runtime.orderRetry?.label||stored.runtime.entryBlocked?.label||'신규 진입 허용'):stored.quantity>0?'봇 정지 · 보유 포지션 유지':'시작 대기';
  $('#editor-status').innerHTML='<div class="editor-status-top">'+pixelScene(stored,true)+'<div><h3>'+esc(stored.name)+' · '+esc(stored.symbol)+'</h3><p>'+esc(taskLabel(stored))+'</p></div></div>'+botStatusMarkup(stored,serverState,positionInsights)+(stored.budgetWarning?'<p class="budget-overflow-note">'+esc(stored.budgetWarning)+'</p>':'')+'<div class="bot-log">'+(logs.filter(l=>l.botId===stored.id&&(!stored.statsReset||l.at>=stored.statsReset.at)).slice(0,15).map(l=>'<p><time>'+time(l.at)+'</time>'+esc(l.message)+'</p>').join('')||'<p>아직 이 봇의 활동 기록이 없습니다.</p>')+'</div>';
}
function setEditorTab(tab){editorTab=tab;$$('[data-editor-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.editorTab===tab);b.setAttribute('aria-selected',b.dataset.editorTab===tab);});$$('.editor-panel').forEach(p=>p.hidden=p.id!==`editor-${tab}`);$('.editor-body').scrollTop=0;}
function openBot(id=null,tab='basic',initial=null) {
  const b=bots.find(b=>b.id===id);if(b?.kind==='multi'||initial?.kind==='multi'){multiUI.open(id,tab,initial);return;}draft=upgradeActions(structuredClone(initial || b || makeBot({budgetIncluded:false})));selectedRuleId=draft.actionRules.find(r=>r.enabled)?.id||draft.actionRules[0]?.id;
  $('#editor-title').textContent=b?b.name:initial?.name||'새 봇 만들기';$('#editor-eyebrow').textContent=b?'YOUR BOT WORKSPACE':'BUILD YOUR BOT';$('#delete-bot').hidden=!b;$('#bot-editor-tools').hidden=!b;$('#form-errors').hidden=true;
  budgetEditor.reset();renderBasic();renderConditions();renderActions();renderEditorStatus();setEditorTab(tab);$('#bot-dialog').showModal();
}
function confirmAction(title,message,callback,label='확인') { $('#confirm-title').textContent=title;$('#confirm-message').textContent=message;$('#confirm-action').textContent=label;confirmCallback=callback;$('#confirm-dialog').showModal(); }
async function saveBot(event,confirmed=false){
  event.preventDefault();if(!await budgetEditor.validate())return;const stored=bots.find(bot=>bot.id===draft.id),errors=validateBot({...draft,runtime:stored?.runtime||draft.runtime},bots,{balance:serverState?.account?.walletBalance??Infinity,symbols:SYMBOLS.map(s=>s.symbol),enforceAllocationLimit:!stored||draft.budget>stored.budget,maxLeverage:botConfigLocked()?(leverageLimits?.maxLeverage||125):leverageCap(leverageLimits,estimateBudget(draft))});
  if(draft.actionRules.some(r=>r.enabled&&r.closeScope==='account'&&!isEntry(r.action)&&!isStop(r.action))&&!serverState?.capabilities?.sharedPositions)errors.push('서버 갱신 후 계좌 보유분 정리를 저장해 주세요.');
  if(draft.exit?.basis==='leveraged'&&!serverState?.capabilities?.leveragedProtection)errors.push('서버가 아직 진입 증거금 기준 TP·SL을 지원하지 않습니다. 서버 갱신 후 다시 저장해 주세요.');
  if(errors.length){$('#form-errors').innerHTML='<ul>'+errors.map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul>';$('#form-errors').hidden=false;return;}
  if(stored?.quantity>0&&!stored.runtime?.importPending&&!confirmed&&JSON.stringify([stored.actionRules,stored.exit])!==JSON.stringify([draft.actionRules,draft.exit])){confirmAction('보유 포지션 관리 조건 변경',stored.name+' · 저장하면 봇이 정지하고 이 봇의 미체결·TP/SL 주문을 취소합니다. 변경한 정리 조건과 TP/SL은 다시 시작한 뒤 적용됩니다.',()=>saveBot({preventDefault(){}},true),'저장·적용');return;}
  const submit=$('#bot-form [type="submit"]');submit.disabled=true;
  try{const saved=await api('/bots',{method:'POST',body:draft});selectedBotId=saved.id;rosterTab=saved.budgetIncluded===false?'archive':'operating';$('#bot-dialog').close();await syncWorkspace();toast('설정을 저장했습니다. 봇은 정지 상태이며 미체결·TP/SL 취소를 확인합니다.');}
  catch(error){$('#form-errors').textContent=error.message;$('#form-errors').hidden=false;$('#form-errors').scrollIntoView({block:'nearest'});}
  finally{submit.disabled=false;}
}

function showSymbols(target='home'){
  symbolPickerTarget=['bot','multi'].includes(target)?target:'home';symbolResultLimit=100;$('#symbol-dialog h2').textContent=symbolPickerTarget!=='home'?'담당 종목 찾기':'바이낸스 상품 찾기';$('#symbol-dialog .eyebrow').textContent=symbolPickerTarget!=='home'?'BOT SYMBOL':'BINANCE MARKETS';$('#symbol-search').value='';$('#symbol-market-filters').hidden=symbolPickerTarget!=='home';renderSymbolResults('');$('#symbol-dialog').showModal();$('#symbol-search').focus();refreshFavorites();if(symbolPickerTarget==='home'&&!marketCatalogReady)loadMarkets().catch(error=>{marketError=error.message;renderSymbolResults($('#symbol-search').value);});
}
function renderSymbolResults(query) {
  const bot=symbolPickerTarget!=='home',normalize=text=>String(text).toLowerCase().replace(/[\s/\-]/g,''),term=normalize(query),current=bot?draft?.symbol:currentSymbol;
  const candidates=bot?SYMBOLS.map(s=>({...s,market:'usdm',baseAsset:s.short,quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL',name:symbolName(s)})):marketInstruments;
  const rank=s=>s.symbol===current&&(bot||s.market===currentMarket)&&!term?-1:normalize(s.symbol)===term?0:normalize(s.symbol).startsWith(term)?1:2;
  const items=candidates.filter(s=>(bot|| (marketFilter==='favorites'?favorites.includes(marketKey(s)):matchesMarket(s,marketFilter)))&&normalize(s.symbol+' '+s.baseAsset+' '+(bot?s.name:instrumentName(s))+' '+productLabel(s)).includes(term)).sort((a,b)=>rank(a)-rank(b));
  $('#symbol-market-filters').innerHTML=bot?'':[['favorites','★ 즐겨찾기 '+favorites.length],...MARKET_FILTERS].map(([key,label])=>'<button type="button" data-market-filter="'+key+'" aria-pressed="'+(key===marketFilter)+'" class="'+(key===marketFilter?'active':'')+'">'+label+'</button>').join('');
  const note=$('#symbol-market-note');note.hidden=bot||!marketCatalogErrors.length;note.textContent=marketCatalogErrors.map(e=>e.error).join(' / ');
  $('#symbol-result-count').textContent=!bot&&!marketCatalogReady?'바이낸스 상품 목록을 불러오는 중…':items.length+'개 상품'+(bot?' · 봇 매매 지원 종목':' · 별을 눌러 즐겨찾기');
  $('#symbol-results').innerHTML=items.slice(0,symbolResultLimit).map(s=>{const saved=favorites.includes(marketKey(s));return '<div class="symbol-result-row"><button type="button" class="symbol-favorite '+(saved?'active':'')+'" data-favorite-key="'+esc(marketKey(s))+'" aria-label="'+esc(s.symbol+' '+productLabel(s))+' 즐겨찾기 '+(saved?'삭제':'추가')+'" aria-pressed="'+saved+'" '+(!favoriteStore.ready||favoriteStore.saving?'disabled':'')+'>'+(saved?'★':'☆')+'</button><button type="button" class="symbol-result '+(s.symbol===current&&(bot||s.market===currentMarket)?'selected':'')+'" data-market="'+s.market+'" data-symbol="'+esc(s.symbol)+'" aria-label="'+esc(s.symbol+' '+productLabel(s))+' 선택"><span class="coin-icon" style="color:'+(s.color||'#8aa497')+';background:#f0f5eb">'+coinGlyph(s.symbol)+'</span><span class="symbol-result-name"><strong>'+esc(s.symbol)+'</strong><small>'+esc(bot?s.name:instrumentName(s))+' · '+esc(productLabel(s))+'</small></span><span class="symbol-result-quote">'+price(s.price)+(s.symbol===current&&(bot||s.market===currentMarket)?'<small>선택됨</small>':'')+'</span></button></div>';}).join('')+(items.length>symbolResultLimit?'<button type="button" id="symbol-show-more" class="symbol-show-more">'+(items.length-symbolResultLimit)+'개 더 보기 · 검색으로 좁힐 수 있습니다</button>':'')||'<div class="empty-table">'+(!bot&&!marketCatalogReady?'상품 목록을 불러오는 중입니다.':marketFilter==='favorites'&&!term?'즐겨찾기가 없습니다. 전체 목록에서 별을 눌러 추가하세요.':'검색 결과가 없습니다. 다른 종목명이나 심볼을 입력하세요.')+'</div>';
}
function openMarket(){
  $('#market-sidebar').classList.add('open');if(!$('.sidebar-backdrop')){const backdrop=document.createElement('div');backdrop.className='sidebar-backdrop';backdrop.addEventListener('click',closeMarket);document.body.append(backdrop);}$('#close-market').focus();
}
function closeMarket(){ $('#market-sidebar').classList.remove('open');$('.sidebar-backdrop')?.remove(); }

document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.importForBot){positionImportUI.open(null,b.dataset.importForBot);return;}
  if(b.id==='import-position-button'||b.dataset.importPosition){positionImportUI.open(b.dataset.importPosition||null);return;}
  if(b.dataset.prepareClose){preparePositionClose(b.dataset.prepareClose,b.dataset.closeOwner||'');return;}
  if(b.dataset.rosterTab){rosterTab=b.dataset.rosterTab;renderOffice();return;}
  if(b.dataset.officeFocus){selectedBotId=b.dataset.officeFocus;openBot(selectedBotId);return;}
  if(b.dataset.officeToggle){const target=bots.find(item=>item.id===b.dataset.officeToggle);if(target)botControls.action(botNeedsStop(target)?'pause':'start',target.id);return;}
  if(b.dataset.botTools){botTools.open(b.dataset.botTools);return;}
  if(b.id==='bot-editor-tools'){botTools.open(draft.id);return;}
  if(b.id==='editor-start-bot'||b.id==='editor-pause-bot'){botControls.action(b.id==='editor-start-bot'?'start':'pause',draft.id);return;}
  if(b.dataset.botTrade){const target=bots.find(item=>item.id===b.dataset.botTrade);if(target){if($('#bot-dialog').open)$('#bot-dialog').close();goPage('home');selectSymbol(target.symbol,'usdm');manualUI.prepareBot(target.id);if(matchMedia('(max-width:900px)').matches)openMarket();$('#manual-order-ticket').scrollIntoView({block:'start'});}return;}
  if(b.dataset.homeCancel!==undefined){const order=homeOpenOrders(serverState).find(o=>o.key===b.dataset.homeCancel),connectionId=serverState.connectionId;if(order?.canCancel)confirmAction('미체결 잔량 취소',order.symbol+' · '+order.ownerName+' · 남은 '+fmt(order.remaining,8)+'개를 취소합니다. 이미 체결된 수량은 유지합니다.'+(order.tracked?.botId?' 이 주문의 잔량 시장가 전환은 중단합니다. 봇은 이후 조건에 따라 새 주문을 낼 수 있습니다.':''),async()=>{try{const result=await api('/account/orders/cancel',{method:'POST',body:{connectionId,symbol:order.symbol,clientOrderId:order.clientOrderId||undefined,orderId:order.orderId==null?undefined:String(order.orderId)}});toast(result.pending?'취소 결과 확인 중입니다. 미체결 목록에서 상태를 확인해 주세요.':result.status==='FILLED'?'이미 전량 체결된 주문입니다.':result.status==='NOT_OPEN'?'현재 미체결 목록에 없는 주문입니다.':'미체결 잔량을 취소했습니다.');}finally{await syncWorkspace();}},'잔량 취소');return;}
  if(b.dataset.homeProtection){openBot(b.dataset.homeProtection,'actions');return;}
  if(b.dataset.cancelBotOrder){const order=serverState.orders.find(o=>o.id===b.dataset.cancelBotOrder&&o.botId===b.dataset.ownerBot);if(order)confirmAction('미체결 잔량 취소',order.symbol+' · '+order.type+' · '+order.quantity+' 중 미체결 잔량을 취소합니다.',async()=>{await api('/bots/'+encodeURIComponent(order.botId)+'/orders/'+encodeURIComponent(order.id)+'/cancel',{method:'POST'});await syncWorkspace();},'잔량 취소');return;}

  if(b.dataset.favoriteKey){favoriteStore.set(b.dataset.favoriteKey,!favorites.includes(b.dataset.favoriteKey)).catch(error=>toast(error.message,true));return;}
  if(b.id==='favorites-refresh'){favoriteStore.load().catch(error=>toast(error.message,true));return;}
  if(b.dataset.bookPrice){manualUI?.setBookPrice(b.dataset.bookPrice);return;}
  if(b.id==='apply-whole-frame'){
    try{const textarea=$('#formula-source'),source=applyWholeTimeframe(textarea.value,$('#formula-whole-frame').value);if(source.length>1000)throw new Error('수식은 1,000자 이하여야 합니다.');textarea.value=currentRule().formula=source;updateFormulaFeedback();textarea.focus();signatureHelp?.update(true);}
    catch(error){toast(error.message,true);}return;
  }
  if(b.id==='add-action-rule'){if(draft.actionRules.length>=20){toast('조건은 20개까지 설정할 수 있습니다.',true);return;}const r=makeActionRule();draft.actionRules.push(r);selectedRuleId=r.id;renderConditions();return;}
  if(b.dataset.selectRule){selectedRuleId=b.dataset.selectRule;renderConditions();return;}
  if(b.id==='remove-action-rule'){draft.actionRules=draft.actionRules.filter(r=>r.id!==selectedRuleId);selectedRuleId=draft.actionRules[0]?.id;renderConditions();updateBudgetPreview();return;}
  if(b.dataset.moveRule){const i=draft.actionRules.findIndex(r=>r.id===selectedRuleId),j=i+(b.dataset.moveRule==='up'?-1:1);if(j>=0&&j<draft.actionRules.length)[draft.actionRules[i],draft.actionRules[j]]=[draft.actionRules[j],draft.actionRules[i]];renderConditions();return;}
  if(b.dataset.page)goPage(b.dataset.page);
  if(b.hasAttribute('data-close-dialog')){b.closest('dialog').close();return;}
  if(b.dataset.marketFilter){marketFilter=b.dataset.marketFilter;symbolResultLimit=100;renderSymbolResults($('#symbol-search').value);return;}
  if(b.id==='symbol-show-more'){symbolResultLimit+=100;renderSymbolResults($('#symbol-search').value);return;}
  if(b.dataset.positionSymbol){showPositionChart(b.dataset.positionSymbol);return;}
  if(b.id==='bot-symbol-picker'){showSymbols('bot');return;}
  if(b.dataset.symbol){
    if(b.closest('#symbol-results')&&symbolPickerTarget==='multi'){const callback=multiSymbolPick;multiSymbolPick=null;$('#symbol-dialog').close();callback?.(b.dataset.symbol);return;}
    if(b.closest('#symbol-results')&&symbolPickerTarget==='bot'){
      if(!draft||!SYMBOLS.some(s=>s.symbol===b.dataset.symbol))return;
      draft.symbol=b.dataset.symbol;renderBasic();updateFormulaFeedback();$('#form-errors').hidden=true;$('#symbol-dialog').close();$('#bot-symbol-picker').focus();return;
    }
    selectSymbol(b.dataset.symbol,b.dataset.market||'usdm');if(b.closest('dialog'))b.closest('dialog').close();
  }
  if(b.dataset.interval)setChartInterval(b.dataset.interval);
  if(b.dataset.range&&chart)applyChartRange(b.dataset.range);
  if(b.dataset.homeTab){homeTab=b.dataset.homeTab;$$('[data-home-tab]').forEach(el=>{el.classList.toggle('active',el===b);el.setAttribute('aria-selected',el===b);});renderHomeTable();}
  if(b.dataset.tool){drawingMode=b.dataset.tool==='line';$$('[data-tool]').forEach(el=>el.classList.toggle('active',el===b));if(drawingMode)toast('차트에서 수평선을 넣을 가격을 클릭하세요.');}
  if(b.dataset.botFilter){botFilter=b.dataset.botFilter;$$('[data-bot-filter]').forEach(el=>el.classList.toggle('active',el===b));renderBots();}
  if(b.dataset.editBot)openBot(b.dataset.editBot);
  if(b.dataset.viewBot)openBot(b.dataset.viewBot,'status');
  if(b.dataset.configureBot)openBot(b.dataset.configureBot,'conditions');
  if(b.dataset.toggleBot)toggleBot(b.dataset.toggleBot);
  if(b.dataset.closePosition){const target=bots.find(item=>item.id===b.dataset.closePosition);confirmAction('포지션 전량 청산',target.name+' · '+target.symbol+' · 보유 수량 '+target.quantity+'을 '+(serverState.environment==='live'?'실전':'테스트넷')+' 계좌에서 시장가 청산합니다.',async()=>{await api('/bots/'+target.id+'/close',{method:'POST'});await syncWorkspace();},'전량 청산');}
  if(b.dataset.editorTab)setEditorTab(b.dataset.editorTab);
  if(b.dataset.customizeAppearance){const target=draft?.id===b.dataset.customizeAppearance?draft:bots.find(bot=>bot.id===b.dataset.customizeAppearance);if(target)appearanceUI.open(target);return;}
  if(b.dataset.formulaExample!==undefined)setFormulaExample(Number(b.dataset.formulaExample));
  if(b.closest('#editor-actions')&&draft&&applyProtectionChoice(draft.exit,b.dataset)){renderActions();$('#form-errors').hidden=true;return;}
  if(b.id==='new-bot'||b.id==='add-bot-card')openBot();
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='rule-leverage-range'){currentRule().leverage=el.valueAsNumber;renderLeverage();updateBudgetPreview();$('#form-errors').hidden=true;return;}
  if(el.hasAttribute('data-budget-included')&&el.closest('#bot-dialog')){draft.budgetIncluded=el.checked;budgetEditor.changed('budgetIncluded');return;}
  if(el.dataset.bind || el.dataset.rule) $('#form-errors').hidden=true;
  if(el.dataset.bind){
    const previous=currentRule()?.action,val=el.type==='checkbox'?el.checked:el.type==='number'?el.valueAsNumber:el.dataset.bind==='maxEntries'?Number(el.value):el.dataset.bind.endsWith('.postOnly')?el.value==='true':el.value;setPath(draft,el.dataset.bind,val);
    if(el.dataset.bind.startsWith('actionRules.')&&el.dataset.bind.endsWith('.action')){const rule=currentRule();if(rule.action==='CLOSE_ALL')rule.sizePercent=100;else if(isEntry(previous)!==isEntry(rule.action))rule.sizePercent=isEntry(rule.action)?25:100;if(isEntry(rule.action))rule.leverage??=draft.leverage||3;renderConditions();}
    else if(el.dataset.bind.endsWith('.enabled')||el.dataset.bind.endsWith('.reentry.mode'))renderConditions();
    else if(el.dataset.bind.includes('.order.')||el.dataset.bind.endsWith('.sizePercent'))updateActionPreview();
    if(el.dataset.bind==='budgetMode'){if(draft.budgetMode==='floor')draft.budgetFloor??=Math.min(30,draft.budget);renderBasic();}
    if(['budgetLossCarry','budgetRecovery'].includes(el.dataset.bind))renderBasic();
    if(el.dataset.bind==='budgetType'){if(isPercentBudget(draft))draft.budgetPercent??=25;renderBasic();}
    if(['budget','budgetMode','budgetType','budgetPercent','budgetShortfall','budgetFloor','budgetLossCarry','budgetRecovery'].includes(el.dataset.bind))budgetEditor.changed(el.dataset.bind);
    if(['budget','budgetMode','budgetType','budgetPercent','budgetShortfall','budgetFloor','budgetLossCarry','budgetRecovery','profitReinvestPercent','leverage'].includes(el.dataset.bind)||el.dataset.bind.startsWith('actionRules.'))updateBudgetPreview();
    if(['budget','budgetMode','budgetType','budgetPercent','budgetShortfall','budgetFloor','budgetLossCarry','budgetRecovery','leverage'].includes(el.dataset.bind)||el.dataset.bind.endsWith('.leverage')){renderLeverage();updateActionPreview();}
    if(el.dataset.bind.endsWith('.timeframe')||el.dataset.bind.endsWith('.candle')||el.dataset.bind==='symbol')updateFormulaFeedback();
    if(el.dataset.bind.startsWith('exit.'))updateProtectionControls();
  }
  if(el.id==='formula-source'){currentRule().formula=el.value;$('#form-errors').hidden=true;$('#formula-count').textContent=el.value.length+' / 1000';$('#formula-feedback').className='formula-feedback';$('#formula-feedback').textContent='입력한 수식을 확인하는 중…';clearTimeout(formulaDebounce);++formulaRequest;formulaDebounce=setTimeout(()=>updateFormulaFeedback(),400);}

});
$('#symbol-picker').addEventListener('click',showSymbols);$('#watch-search-button').addEventListener('click',()=>{marketFilter='favorites';showSymbols();});$('#symbol-search').addEventListener('input',e=>{symbolResultLimit=100;renderSymbolResults(e.target.value);});
$('#indicator-button').addEventListener('click',openStudyLibrary);
document.addEventListener('change',event=>{
  if(event.target.id!=='formula-insert')return;
  const value=event.target.value;if(!value)return;
  const textarea=$('#formula-source');insertFormulaSnippet(textarea,value);currentRule().formula=textarea.value;event.target.value='';updateFormulaFeedback();
});
document.addEventListener('keydown',event=>{
  if(event.target.id==='symbol-search'&&['ArrowDown','Enter'].includes(event.key)&&!event.isComposing){
    const first=$('#symbol-results .symbol-result');if(first){event.preventDefault();if(event.key==='Enter')first.click();else first.focus();}return;
  }
  if(event.target.closest('#symbol-results')&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
    const results=$('#symbol-results .symbol-result'),index=results.indexOf(event.target.closest('.symbol-result'));if(index<0)return;event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?results.length-1:Math.max(0,Math.min(results.length-1,index+(event.key==='ArrowDown'?1:-1)));results[next]?.focus();return;
  }
  if(event.target.id==='formula-source'&&event.key==='Tab'){event.preventDefault();const textarea=event.target;textarea.setRangeText('  ',textarea.selectionStart,textarea.selectionEnd,'end');currentRule().formula=textarea.value;updateFormulaFeedback();}
});
$('#fit-chart').addEventListener('click',()=>applyChartRange('all'));
$('#fullscreen-chart').addEventListener('click',()=>{try{openChartModal(currentInstrument(),{interval:currentInterval,candleType});}catch(error){toast(error.message,true);}});
$('#clear-lines').addEventListener('click',()=>{drawnLines.forEach(l=>candleSeries.removePriceLine(l));drawnLines=[];persistChartView();toast('추가한 수평선을 지웠습니다.');});
$('#mobile-market-button').addEventListener('click',openMarket);
$('#close-market').addEventListener('click',closeMarket);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMarket();});
$('#bot-form').addEventListener('submit',saveBot);
$('#delete-bot').addEventListener('click',()=>{const bot=bots.find(b=>b.id===draft.id);confirmAction('이 봇을 삭제할까요?',bot.name+'의 설정을 삭제합니다. 포지션·미해결 주문이 있으면 삭제가 거절됩니다.',async()=>{await api('/bots/'+bot.id,{method:'DELETE'});$('#bot-dialog').close();await syncWorkspace();toast('봇 설정을 삭제했습니다.');},'삭제');});
$('#confirm-action').addEventListener('click',()=>{$('#confirm-dialog').close();const callback=confirmCallback;confirmCallback=null;Promise.resolve(callback?.()).catch(error=>toast(error.message,true));});
$('#export-log').addEventListener('click',()=>download('futures-workroom-activity.json',{environment:serverState?.environment,logs}));
$('#export-bots').addEventListener('click',()=>download('futures-workroom-bots.json',{version:1,environment:serverState?.environment,bots}));
$('#help-button').addEventListener('click',()=>{goPage('settings');});
$('#check-app-update').addEventListener('click',async()=>{
 const button=$('#check-app-update'),status=$('#app-update-status');button.disabled=true;status.textContent='새 버전을 확인하는 중…';
 try{const result=await api('/app/update');status.textContent='현재 v'+result.version+' · 정식 릴리즈 v'+result.latest+' · '+(result.available?'새 버전이 있습니다.':result.ahead?'설치 버전이 정식 릴리즈보다 앞서 있습니다.':'최신 릴리즈입니다.');const link=document.createElement('a');link.href=result.downloadUrl||result.releaseUrl;link.target='_blank';link.rel='noreferrer';link.textContent=result.downloadUrl?'Windows ZIP 다운로드 ↗':'릴리즈 보기 ↗';status.append(document.createTextNode(' '),link);}
 catch(error){status.textContent='확인하지 못했습니다: '+error.message;}finally{button.disabled=false;}
});
$$('dialog:not(#bot-dialog)').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}}));
window.addEventListener('hashchange',()=>goPage(location.hash.slice(1)));
installConnectionUI({refresh:syncWorkspace,toast});
installNetworkUI({toast,onContext:setConnectionLocal});
const transportUI=installTransportUI({toast,refresh:syncWorkspace});
installStudyUI({notify:toast});
installTradeHistoryUI({getState:()=>serverState,notify:toast});
installAccountEquityUI();
manualUI=installManualUI({notify:toast,refresh:()=>syncWorkspace(),settings:()=>goPage('settings')});
appearanceUI=installAppearanceUI({notify:toast,onSaved(){renderOffice();const summary=$('#bot-appearance-summary');if(summary&&draft)summary.innerHTML=appearanceCard(draft);renderEditorStatus();}});
botTools=installBotTools({api,getState:()=>serverState,refresh:()=>syncWorkspace(),toast,onBudgetBaselineReset(b){if(draft?.id===b.id&&$('#bot-dialog').open){draft.runtime=structuredClone(b.runtime);updateBudgetPreview();renderEditorStatus();}},onBudgetMoved(included){rosterTab=included?'operating':'archive';renderBots();if($('#bot-dialog').open)$('#bot-dialog').close();$('#multi-bot-dialog')?.close();},onCopy(source){const copied=copyBotSettings(source);try{saveAppearance(copied,appearanceFor(source));}catch(error){toast('외형 복사: '+error.message,true);}if($('#bot-dialog').open)$('#bot-dialog').close();$('#multi-bot-dialog')?.close();openBot(null,'basic',copied);toast('복사본을 불러왔습니다. 종목·예산을 확인한 뒤 저장하세요.');},onSettingsReset(source){if($('#bot-dialog').open)$('#bot-dialog').close();$('#multi-bot-dialog')?.close();openBot(source.id,'basic',resetBotSettings(source));}});
multiUI=installMultiUI({onSaved(bot){rosterTab=bot.budgetIncluded===false?'archive':'operating';},api,getState:()=>serverState,getSymbols:()=>SYMBOLS,getInsights:()=>positionInsights,refresh:()=>syncWorkspace(),toast,pickSymbol:callback=>{multiSymbolPick=callback;showSymbols('multi');},onToggle:(kind,id)=>botControls.action(kind,id),onTrade:(member,close)=>{goPage('home');selectSymbol(member.symbol,'usdm');if(close){const position=serverState?.account?.positions.find(p=>p.symbol===member.symbol&&(serverState.positionMode!=='HEDGE'||p.positionSide===member.positionDirection));if(!position){toast('보유 포지션을 찾을 수 없습니다.',true);return;}manualUI.prepareClose(position,member.id);}else manualUI.prepareBot(member.id);if(matchMedia('(max-width:900px)').matches)openMarket();$('#manual-order-ticket').scrollIntoView({block:'start'});},appearance:bot=>appearanceUI.open(bot),onTools:id=>botTools.open(id)});
$('#mobile-market-button').setAttribute('aria-label','호가와 주문 열기');$('.read-only-label').innerHTML=icon('chart')+'계좌 추이';
icons();syncChartButtons();renderMarket();renderHomeTable();renderBots();renderActivity();initChart();goPage(location.hash.slice(1)||'home');
async function bootstrap(){
  try{await syncWorkspace();await loadSymbols();await loadMarkets();if(!localStorage.getItem('fw-migrated-v2')&&legacyBots.length){let imported=true;for(const legacy of legacyBots.filter(old=>!bots.some(b=>b.id===old.id))){try{await api('/bots',{method:'POST',body:legacy});}catch(error){imported=false;toast('이전 설정 가져오기: '+error.message,true);}}if(imported)localStorage.setItem('fw-migrated-v2','true');await syncWorkspace();}await updateChart(true);}
  catch(error){marketError=error.message;renderRuntimeBanner();}
}
bootstrap();setInterval(()=>syncWorkspace().catch(()=>{}),3000);setInterval(()=>{if(currentPage==='home')updateChart(false);},3000);setInterval(()=>loadSymbols().catch(error=>{marketError=error.message;renderRuntimeBanner();}),15000);
const clockFormat=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function updateClock(){const now=new Date(),stamp=clockFormat.format(now);for(const id of ['local-clock','rail-clock']){const node=$('#'+id);if(node.textContent!==stamp)node.textContent=stamp;if(node.tagName==='TIME')node.dateTime=now.toISOString();}}
updateClock();setInterval(updateClock,1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateClock();});

refreshFavorites();
setInterval(()=>{if(!document.hidden&&$('#symbol-dialog').open)refreshFavorites();},5000);
window.addEventListener('focus',()=>{if($('#symbol-dialog').open)refreshFavorites();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$('#symbol-dialog').open)refreshFavorites();});
setInterval(()=>loadMarkets().catch(()=>{}),60000);
