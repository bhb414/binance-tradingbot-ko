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
export class PriceChart{
 constructor(chart,{type='standard',library=window.LightweightCharts,onReplace=()=>{}}={}){
  this.chart=chart;this.L=library;this.onReplace=onReplace;this.type=CHART_TYPE_IDS.includes(type)?type:'standard';this.kind=chartType(this.type).series;this.raw=[];this.baseline=null;this.baselinePrice=null;this.updatingBaseline=false;
  this.series=chart.addSeries(library[this.kind],priceChartOptions(this.type,library),0);
  this.rangeChanged=()=>this.updateBaseline();chart.timeScale().subscribeVisibleLogicalRangeChange(this.rangeChanged);
 }
 render(type,raw,priceFormat){
  if(!CHART_TYPE_IDS.includes(type))type='standard';const kind=chartType(type).series,range=this.chart.timeScale().getVisibleLogicalRange(),data=priceChartData(raw,type);
  this.type=type;this.raw=raw;
  if(kind!==this.kind){
   const old=this.series,scale=old.priceScale(),scaleOptions=scale.options(),priceRange=scale.getVisibleRange();
   this.series=this.chart.addSeries(this.L[kind],{...priceChartOptions(type,this.L),priceFormat},0);this.series.setData(data.points);this.baseline=null;this.baselinePrice=null;this.kind=kind;
   this.onReplace(this.series,old);this.chart.removeSeries(old);this.series.setSeriesOrder(0);
   this.series.priceScale().applyOptions({autoScale:scaleOptions.autoScale});if(!scaleOptions.autoScale&&priceRange)this.series.priceScale().setVisibleRange(priceRange);
   if(range)this.chart.timeScale().setVisibleLogicalRange(range);
  }else{const options=priceChartOptions(type,this.L);if(type==='baseline'&&this.baselinePrice!==null)options.baseValue.price=this.baselinePrice;this.series.applyOptions({...options,priceFormat});this.series.setData(data.points);}
  this.updateBaseline();return data.candles;
 }
 updateBaseline(){
  if(this.type!=='baseline'||!this.raw.length||this.updatingBaseline)return;
  const range=this.chart.timeScale().getVisibleLogicalRange(),from=Math.max(0,Math.floor(range?.from??0)),to=Math.min(this.raw.length-1,Math.ceil(range?.to??this.raw.length-1)),values=this.raw.slice(from,to+1).map(c=>c.close).filter(Number.isFinite);if(!values.length)return;
  const price=(Math.min(...values)+Math.max(...values))/2;if(price===this.baselinePrice)return;this.updatingBaseline=true;
  try{this.baselinePrice=price;this.series.applyOptions({baseValue:{type:'price',price}});const options={price,title:'기준선',color:'#8c9b94',lineWidth:1,lineStyle:2,axisLabelVisible:true};if(this.baseline)this.baseline.applyOptions(options);else this.baseline=this.series.createPriceLine(options);}finally{this.updatingBaseline=false;}
 }
 clear(){this.raw=[];this.series.setData([]);if(this.baseline)this.series.removePriceLine(this.baseline);this.baseline=null;this.baselinePrice=null;}
 destroy(){this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.rangeChanged);}
}
