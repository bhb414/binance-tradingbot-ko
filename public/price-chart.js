import {chartLabelPreferences} from './chart-labels.js';
import {heikinAshi} from './indicators.js';
import {chartType,CHART_TYPE_IDS} from './chart-types.js';
const up='#35b98c',down='#df6879';
export function priceChartData(raw,type){
 const candles=type==='heikin'?heikinAshi(raw):raw,ohlc=['standard','heikin','bar'].includes(type);
 return {candles,points:candles.map(c=>ohlc?{time:c.time,open:c.open,high:c.high,low:c.low,close:c.close}:{time:c.time,value:c.close})};
}
export function priceChartOptions(type,L){
 const common={lastValueVisible:false,priceLineVisible:false};
 if(type==='standard'||type==='heikin')return {...common,upColor:up,downColor:down,borderUpColor:up,borderDownColor:down,wickUpColor:up,wickDownColor:down};
 if(type==='bar')return {...common,upColor:up,downColor:down,thinBars:true,openVisible:true};
 const line={lineWidth:2,lineStyle:0,lineType:type==='step'?L.LineType.WithSteps:L.LineType.Simple,crosshairMarkerVisible:true,pointMarkersVisible:type==='line-markers',pointMarkersRadius:3};
 if(type==='area')return {...common,...line,lineColor:'#36977d',topColor:'#35b98c40',bottomColor:'#35b98c04'};
 if(type==='baseline')return {...common,...line,baseValue:{type:'price',price:0},topLineColor:'#209e78',bottomLineColor:'#db6377',topFillColor1:'#35b98c32',topFillColor2:'#35b98c08',bottomFillColor1:'#df687908',bottomFillColor2:'#df687932'};
 return {...common,...line,color:'#3b947e'};
}
// Keep the data, scale, price guides and attached indicator primitives alive.
// Only the primary graph's paint is hidden, so indicator arrows/fills stay visible.
export function priceGraphOptions(type,L,visible=true){
 const options=priceChartOptions(type,L);
 if(['standard','heikin'].includes(type))return {...options,wickVisible:visible,borderVisible:visible,...(!visible?{upColor:'transparent',downColor:'transparent',borderUpColor:'transparent',borderDownColor:'transparent',wickUpColor:'transparent',wickDownColor:'transparent'}:{})};
 if(type==='bar')return {...options,...(!visible?{upColor:'transparent',downColor:'transparent'}:{})};
 return {...options,lineVisible:visible,...(!visible?{color:'transparent',lineColor:'transparent',topColor:'transparent',bottomColor:'transparent',topLineColor:'transparent',bottomLineColor:'transparent',topFillColor1:'transparent',topFillColor2:'transparent',bottomFillColor1:'transparent',bottomFillColor2:'transparent',pointMarkersVisible:false,crosshairMarkerVisible:false}:{})};
}
export class PriceChart{
 constructor(chart,{type='standard',library=window.LightweightCharts,onReplace=()=>{},preferences=chartLabelPreferences}={}){
  this.chart=chart;this.L=library;this.onReplace=onReplace;this.type=CHART_TYPE_IDS.includes(type)?type:'standard';this.kind=chartType(this.type).series;this.raw=[];this.baseline=null;this.baselinePrice=null;this.updatingBaseline=false;
  this.visible=preferences.value.price!==false;this.series=chart.addSeries(library[this.kind],priceGraphOptions(this.type,library,this.visible),0);
  this.unsubscribeVisibility=preferences.subscribe(value=>this.setVisible(value.price!==false));
  this.rangeChanged=()=>this.updateBaseline();chart.timeScale().subscribeVisibleLogicalRangeChange(this.rangeChanged);
 }
 setVisible(visible){
  if(this.visible===visible)return;this.visible=visible;
  const options=priceGraphOptions(this.type,this.L,visible);if(this.type==='baseline'&&this.baselinePrice!==null)options.baseValue.price=this.baselinePrice;this.series.applyOptions(options);
  if(this.baseline)this.baseline.applyOptions({lineVisible:visible,axisLabelVisible:visible});
 }
 render(type,raw,priceFormat){
  if(!CHART_TYPE_IDS.includes(type))type='standard';const kind=chartType(type).series,range=this.chart.timeScale().getVisibleLogicalRange(),data=priceChartData(raw,type);
  this.type=type;this.raw=raw;
  if(kind!==this.kind){
   const old=this.series,scale=old.priceScale(),scaleOptions=scale.options(),priceRange=scale.getVisibleRange();
   this.series=this.chart.addSeries(this.L[kind],{...priceGraphOptions(type,this.L,this.visible),priceFormat},0);this.series.setData(data.points);this.baseline=null;this.baselinePrice=null;this.kind=kind;
   this.onReplace(this.series,old);this.chart.removeSeries(old);this.series.setSeriesOrder(0);
   this.series.priceScale().applyOptions({autoScale:scaleOptions.autoScale});if(!scaleOptions.autoScale&&priceRange)this.series.priceScale().setVisibleRange(priceRange);
   if(range)this.chart.timeScale().setVisibleLogicalRange(range);
  }else{const options=priceGraphOptions(type,this.L,this.visible);if(type==='baseline'&&this.baselinePrice!==null)options.baseValue.price=this.baselinePrice;this.series.applyOptions({...options,priceFormat});this.series.setData(data.points);}
  this.updateBaseline();return data.candles;
 }
 updateBaseline(){
  if(this.type!=='baseline'||!this.raw.length||this.updatingBaseline)return;
  const range=this.chart.timeScale().getVisibleLogicalRange(),from=Math.max(0,Math.floor(range?.from??0)),to=Math.min(this.raw.length-1,Math.ceil(range?.to??this.raw.length-1)),values=this.raw.slice(from,to+1).map(c=>c.close).filter(Number.isFinite);if(!values.length)return;
  const price=(Math.min(...values)+Math.max(...values))/2;if(price===this.baselinePrice)return;this.updatingBaseline=true;
  try{this.baselinePrice=price;this.series.applyOptions({baseValue:{type:'price',price}});const options={price,title:'기준선',color:'#8c9b94',lineWidth:1,lineStyle:2,lineVisible:this.visible,axisLabelVisible:this.visible};if(this.baseline)this.baseline.applyOptions(options);else this.baseline=this.series.createPriceLine(options);}finally{this.updatingBaseline=false;}
 }
 clear(){this.raw=[];this.series.setData([]);if(this.baseline)this.series.removePriceLine(this.baseline);this.baseline=null;this.baselinePrice=null;}
 destroy(){this.unsubscribeVisibility();this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.rangeChanged);}
}
