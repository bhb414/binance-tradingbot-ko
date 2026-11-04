// Account entry prices are independent of chart candle style and bot ownership.
export function chartEntryLines(state,market,symbol){
 if(market!=='usdm'||!state?.connected||!Array.isArray(state.account?.positions))return [];
 const lines=new Map();
 for(const p of state.account.positions){
  const quantity=Number(p.quantity),price=Number(p.entryPrice);
  if(p.symbol!==symbol||!Number.isFinite(quantity)||quantity===0||!Number.isFinite(price)||price<=0)continue;
  const direction=['LONG','SHORT'].includes(p.positionSide)?p.positionSide:quantity>0?'LONG':'SHORT',key=market+':'+symbol+':'+direction;
  lines.set(key,{key,symbol,direction,price,color:direction==='LONG'?'#249b78':'#d95b70',title:(direction==='LONG'?'롱':'숏')+' 평단'});
 }
 return [...lines.values()];
}
export class PositionPriceLines{
 constructor(series,{lineStyle=2,summary=null}={}){this.series=series;this.lineStyle=lineStyle;this.summary=summary;this.lines=new Map();this.specs=[];}
 setSeries(series){const specs=this.specs;this.clear();this.series=series;this.update(specs);}
 update(specs){
  this.specs=specs;
  const wanted=new Set(specs.map(s=>s.key));
  for(const [key,entry]of this.lines)if(!wanted.has(key)){this.series.removePriceLine(entry.line);this.lines.delete(key);}
  for(const spec of specs){
   const options={id:spec.key,price:spec.price,color:spec.color,title:spec.title,lineWidth:1,lineStyle:this.lineStyle,lineVisible:true,axisLabelVisible:true},signature=JSON.stringify(options),entry=this.lines.get(spec.key);
   if(!entry)this.lines.set(spec.key,{line:this.series.createPriceLine(options),signature});
   else if(entry.signature!==signature){entry.line.applyOptions(options);entry.signature=signature;}
  }
  if(this.summary){const text=specs.map(s=>s.symbol+' '+s.title+' '+this.series.priceFormatter().format(s.price)).join(' · ');if(this.summary.textContent!==text)this.summary.textContent=text;}
 }
 clear(){this.update([]);}
}
