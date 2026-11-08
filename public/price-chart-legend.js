import {chartLabelPreferences} from './chart-labels.js';
import {chartTypeIcon,chartTypeLabel} from './chart-types.js';
import {chartIntervalLabel} from './chart-timeframes.js';
const priceFields=[['open','O','시가'],['high','H','고가'],['low','L','저가'],['close','C','종가']];
export function candleLegendValues(candle,format=String){return priceFields.map(([key,label,name])=>({key,label,name,text:candle?.[key]!=null&&Number.isFinite(Number(candle[key]))?format(Number(candle[key])):'—'}));}
const eye='<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0"/>';
export class PriceChartLegend{
 constructor({preferences=chartLabelPreferences}={}){
  this.preferences=preferences;this.type='standard';this.element=document.createElement('div');this.element.className='study-chart-legend price-chart-legend';
  this.element.innerHTML='<span class="price-legend-kind"></span><span class="price-legend-name"></span><span class="price-legend-ohlc" aria-label="선택 봉 시가 고가 저가 종가">'+priceFields.map(([key,label,name])=>'<span data-price-field="'+key+'" title="'+name+'">'+label+' <output>—</output></span>').join('')+'</span><span class="price-legend-change" title="선택 봉 시가 대비 종가 변화"></span><output class="price-legend-status" role="status"></output><button type="button" class="study-icon-button price-legend-toggle"></button>';
  this.name=this.element.querySelector('.price-legend-name');this.icon=this.element.querySelector('.price-legend-kind');this.status=this.element.querySelector('.price-legend-status');this.button=this.element.querySelector('button');this.ohlc=this.element.querySelector('.price-legend-ohlc');this.change=this.element.querySelector('.price-legend-change');this.fields=new Map([...this.element.querySelectorAll('[data-price-field]')].map(node=>[node.dataset.priceField,node.querySelector('output')]));
  this.button.addEventListener('click',async()=>{try{this.error='';await preferences.set('price',preferences.value.price===false);}catch(error){this.error=error.message;}this.sync();});
  this.unsubscribe=preferences.subscribe(()=>this.sync());this.sync();
 }
 update(type){this.type=type;this.sync();}
 setInstrument(key){if(key===this.key)return;this.key=key;const [,symbol,interval]=String(key||'').split(':');this.instrument=symbol&&interval?symbol+' · '+chartIntervalLabel(interval):'';this.sync();}
 setCandle(candle,format){
  for(const {key,text}of candleLegendValues(candle,format)){const output=this.fields.get(key);if(output.textContent!==text)output.textContent=text;}
  const valid=Number.isFinite(candle?.close)&&Number.isFinite(candle?.open),color=valid?(candle.close>=candle.open?'#249b78':'#df6879'):'';this.ohlc.style.setProperty('--candle-color',color);this.change.style.color=color;
  const delta=valid?candle.close-candle.open:NaN;this.change.textContent=valid&&candle.open!==0?(delta>=0?'+':'−')+(format||String)(Math.abs(delta))+' ('+(delta>=0?'+':'')+(delta/candle.open*100).toFixed(2)+'%)':'';
 }
 sync(){
  const visible=this.preferences.value.price!==false,label=visible?'가격 그래프 숨기기':'가격 그래프 표시';
  this.name.textContent=this.instrument||'가격';this.name.title=chartTypeLabel(this.type);this.icon.innerHTML=chartTypeIcon(this.type);
  this.button.innerHTML='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'+eye+(!visible?'<path d="M3 3l18 18"/>':'')+'</svg>';
  this.button.setAttribute('aria-label',label);this.button.setAttribute('aria-pressed',String(visible));this.button.title=label+' · 보조지표와 가격 기준선은 유지';this.button.disabled=!this.preferences.ready||this.preferences.busy;
  this.element.classList.toggle('is-muted',!visible);this.status.textContent=this.error||(this.preferences.busy?'저장 중…':visible?'':'숨김');this.status.title=this.error||'';
 }
 destroy(){this.unsubscribe();this.element.remove();}
}
