// Wilder smoothing starts after a full window of valid observations.
export function wilderAverage(values,period){
 let sum=0,count=0,previous=null;
 return values.map(value=>{if(!Number.isFinite(value)){sum=0;count=0;previous=null;return null;}if(previous===null){sum+=value;if(++count<period)return null;previous=sum/period;}else previous+=(value-previous)/period;return previous;});
}
export function directionalMovement(candles,period=14,smoothing=14){
 const up=[],down=[],ranges=[];
 for(let i=0;i<candles.length;i++){
  const c=candles[i],p=candles[i-1];if(!p||![c.high,c.low,p.high,p.low,p.close].every(Number.isFinite)){up.push(null);down.push(null);ranges.push(null);continue;}
  const rise=c.high-p.high,fall=p.low-c.low;up.push(rise>fall&&rise>0?rise:0);down.push(fall>rise&&fall>0?fall:0);ranges.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));
 }
 const positive=wilderAverage(up,period),negative=wilderAverage(down,period),tr=wilderAverage(ranges,period);
 const plus=positive.map((v,i)=>v===null||tr[i]===null?null:tr[i]>0?100*v/tr[i]:0),minus=negative.map((v,i)=>v===null||tr[i]===null?null:tr[i]>0?100*v/tr[i]:0);
 const dx=plus.map((v,i)=>v===null||minus[i]===null?null:v+minus[i]>0?100*Math.abs(v-minus[i])/(v+minus[i]):0);
 return {plus,minus,adx:wilderAverage(dx,smoothing)};
}
export function commodityChannel(values,period){
 return values.map((value,i)=>{if(i<period-1)return null;const window=values.slice(i-period+1,i+1);if(!window.every(Number.isFinite))return null;const mean=window.reduce((n,v)=>n+v,0)/period,deviation=window.reduce((n,v)=>n+Math.abs(v-mean),0)/period;return deviation>0?(value-mean)/(.015*deviation):null;});
}
export function moneyFlow(candles,prices,period){
 const flow=prices.map((price,i)=>{const volume=candles[i].volume;if(!i||![price,prices[i-1],volume].every(Number.isFinite)||volume<0)return null;return {positive:price>prices[i-1]?price*volume:0,negative:price<prices[i-1]?price*volume:0};});
 return flow.map((_,i)=>{if(i<period)return null;const window=flow.slice(i-period+1,i+1);if(window.some(v=>v===null))return null;const positive=window.reduce((n,v)=>n+v.positive,0),negative=window.reduce((n,v)=>n+v.negative,0);return positive+negative>0?100*positive/(positive+negative):null;});
}
export function bollingerArrays(values,middle,period,multiplier){
 const upper=values.map(()=>null),lower=values.map(()=>null);
 for(let i=period-1;i<values.length;i++){const sample=values.slice(i-period+1,i+1);if(!sample.every(Number.isFinite)||!Number.isFinite(middle[i]))continue;const mean=sample.reduce((n,v)=>n+v,0)/period,deviation=Math.sqrt(sample.reduce((n,v)=>n+(v-mean)**2,0)/period);upper[i]=middle[i]+deviation*multiplier;lower[i]=middle[i]-deviation*multiplier;}
 return {middle,upper,lower};
}
