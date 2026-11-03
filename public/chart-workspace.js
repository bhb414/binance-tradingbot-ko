export const CHART_WORKSPACE_KEY='fw-chart-workspace-v1';
const markets=['usdm','coinm','spot','options'],intervals=['1m','5m','15m','1h','4h','1d'],presets=['custom','1d','7d','all'];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const defaults=()=>({version:1,selection:{market:'usdm',symbol:'BTCUSDT',interval:'15m',candleType:'standard',range:'custom'},views:{},lines:{}});
export const instrumentKey=(market,symbol)=>market+':'+symbol;
export const chartViewKey=(market,symbol,interval)=>instrumentKey(market,symbol)+':'+interval;
const validInstrument=key=>typeof key==='string'&&/^(usdm|coinm|spot|options):[A-Z0-9_\-]{2,80}$/.test(key);
const validView=key=>typeof key==='string'&&/^(usdm|coinm|spot|options):[A-Z0-9_\-]{2,80}:(1m|5m|15m|1h|4h|1d)$/.test(key);
export function normalizeChartWorkspace(value){
  const next=defaults();if(!value||value.version!==1)return next;
  const selected=value.selection||{};
  if(markets.includes(selected.market))next.selection.market=selected.market;
  if(typeof selected.symbol==='string'&&/^[A-Z0-9_\-]{2,80}$/.test(selected.symbol))next.selection.symbol=selected.symbol;
  if(intervals.includes(selected.interval))next.selection.interval=selected.interval;
  if(['standard','heikin'].includes(selected.candleType))next.selection.candleType=selected.candleType;
  if(presets.includes(selected.range))next.selection.range=selected.range;
  for(const [key,view] of Object.entries(value.views||{}).slice(-40)){
    if(!validView(key)||!view||typeof view!=='object')continue;const offset=view.offset;
    const clean={panes:{}};
    if(offset&&finite(offset.from)&&finite(offset.to)&&offset.from<offset.to&&offset.from>=-100000&&offset.to<=10000&&offset.to-offset.from>=2)clean.offset={from:offset.from,to:offset.to};
    if(view.price&&typeof view.price.autoScale==='boolean'){
      clean.price={autoScale:view.price.autoScale};
      if(finite(view.price.from)&&finite(view.price.to)&&view.price.to>view.price.from&&Math.abs(view.price.from)<1e15&&Math.abs(view.price.to)<1e15)Object.assign(clean.price,{from:view.price.from,to:view.price.to});
    }
    for(const [id,factor] of Object.entries(view.panes||{}).slice(0,21))if(/^[a-zA-Z0-9_-]{1,64}$/.test(id)&&finite(factor)&&factor>=.001&&factor<=100)clean.panes[id]=factor;
    next.views[key]=clean;
  }
  for(const [key,prices] of Object.entries(value.lines||{}).slice(-40))if(validInstrument(key)&&Array.isArray(prices))next.lines[key]=prices.filter(price=>finite(price)&&price>0&&price<1e15).slice(-50);
  return next;
}
export function rangeOffset(range,count){
  if(!range||!finite(range.from)||!finite(range.to)||range.to-range.from<2||count<1)return null;
  return {from:range.from-count,to:range.to-count};
}
export function restoredRange(offset,count){
  if(!offset||!finite(offset.from)||!finite(offset.to)||count<1)return null;
  const width=Math.min(Math.max(2,offset.to-offset.from),count+100),to=Math.min(count+100,Math.max(Math.min(count,5),count+offset.to));
  return {from:Math.max(-5,to-width),to};
}
export function presetRange(count,interval,preset){
  const seconds={ '1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400 }[interval]||900;
  const bars=preset==='all'?count:preset==='1d'?86400/seconds:preset==='7d'?604800/seconds:165;
  return {from:Math.max(0,count-Math.max(8,Math.min(count,bars))),to:count+7};
}
export class ChartWorkspace{
  constructor(storage,onError=()=>{}){this.storage=storage;this.onError=onError;try{this.value=normalizeChartWorkspace(JSON.parse(storage?.getItem(CHART_WORKSPACE_KEY)||'null'));}catch{this.value=defaults();}}
  get selection(){return {...this.value.selection};}
  view(market,symbol,interval){return this.value.views[chartViewKey(market,symbol,interval)]||{};}
  lines(market,symbol){return [...(this.value.lines[instrumentKey(market,symbol)]||[])];}
  select(patch){this.value=normalizeChartWorkspace({...this.value,selection:{...this.value.selection,...patch}});this.save();}
  remember(market,symbol,interval,{range,count,panes,lines,price}){
    const key=chartViewKey(market,symbol,interval),offset=rangeOffset(range,count);
    if(!validView(key)||!offset)return;
    delete this.value.views[key];this.value.views[key]={offset,panes,price};
    if(lines){const instrument=instrumentKey(market,symbol);delete this.value.lines[instrument];this.value.lines[instrument]=lines;}
    this.value=normalizeChartWorkspace(this.value);this.save();
  }
  save(){try{this.storage?.setItem(CHART_WORKSPACE_KEY,JSON.stringify(this.value));}catch(error){if(!this.warned){this.warned=true;this.onError(error);}}}
}
