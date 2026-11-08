// Causal streaming calculations shared by chart studies and the expression engine.
const finite=Number.isFinite;
export function createWMA(period){
 let queue=[],at=0,sum=0,weighted=0;
 return {push(value){
  if(!finite(value)){queue=[];at=0;sum=0;weighted=0;return null;}
  if(queue.length<period){queue.push(value);sum+=value;weighted+=queue.length*value;return queue.length===period?weighted/(period*(period+1)/2):null;}
  weighted=weighted-sum+period*value;sum+=value-queue[at];queue[at]=value;at=(at+1)%period;return weighted/(period*(period+1)/2);
 }};
}
export function createHMA(period){
 const half=createWMA(Math.max(1,Math.floor(period/2))),full=createWMA(period),root=createWMA(Math.max(1,Math.floor(Math.sqrt(period))));
 return {push(value){const a=half.push(value),b=full.push(value);return root.push(finite(a)&&finite(b)?2*a-b:null);}};
}
export function createKAMA(period,fast=2,slow=30){
 let prices=[],changes=[],priceAt=0,changeAt=0,sum=0,volatility=0,previous=null,result=null;
 const quick=2/(fast+1),steady=2/(slow+1);
 return {push(value){
  if(!finite(value)){prices=[];changes=[];priceAt=0;changeAt=0;sum=0;volatility=0;previous=null;result=null;return null;}
  if(previous!==null){const change=Math.abs(value-previous);if(changes.length<period){changes.push(change);volatility+=change;}else{volatility+=change-changes[changeAt];changes[changeAt]=change;changeAt=(changeAt+1)%period;}}
  previous=value;
  if(prices.length<period){prices.push(value);sum+=value;if(prices.length<period)return null;result=sum/period;return result;}
  const old=prices[priceAt];prices[priceAt]=value;priceAt=(priceAt+1)%period;const efficiency=volatility>0?Math.min(1,Math.abs(value-old)/volatility):0,coefficient=(steady+efficiency*(quick-steady))**2;
  result+=coefficient*(value-result);return finite(result)?result:null;
 }};
}
export function createBarsSince(){
 let at=-1,last=null;
 return {push(value){at++;if(!finite(value)){last=null;return null;}if(value!==0)last=at;return last===null?null:at-last;}};
}
// Ignore arithmetic roundoff, not displayed price precision or a price tick.
// Relative scaling also preserves genuine differences in very small prices.
export function crossSide(a,b){
 if(!finite(a)||!finite(b))return null;
 const difference=a-b,tolerance=64*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b));
 return Math.abs(difference)<=tolerance?0:Math.sign(difference);
}
export function createCrossTracker(){
 let at=-1,previous=0,direction=null,last=null,gap=null;
 return {get elapsed(){return last===null?null:at-last;},get direction(){return direction;},push(a,b){
  at++;const side=crossSide(a,b);if(side===null){previous=0;direction=null;last=null;gap=null;return null;}
  // Equality keeps the last known side; only an actual change of side crosses.
  if(side){if(previous&&side!==previous){if(last!==null)gap=at-last;last=at;direction=side;}previous=side;}return gap;
 }};
}
function spectrumState(period,window){
 const angle=2*Math.PI/period,center=(window-1)/2,tt=window*(window*window-1)/12;
 let c=0,s=0,tc=0,ts=0,cc=0,ss=0,cs=0;
 for(let j=0;j<window;j++){const x=Math.cos(angle*j),y=Math.sin(angle*j),t=j-center;c+=x;s+=y;tc+=t*x;ts+=t*y;cc+=x*x;ss+=y*y;cs+=x*y;}
 cc-=c*c/window+tc*tc/tt;ss-=s*s/window+ts*ts/tt;cs-=c*s/window+tc*ts/tt;
 const determinant=cc*ss-cs*cs;
 return {re:0,im:0,rotationC:Math.cos(angle),rotationS:Math.sin(angle),endC:Math.cos(angle*(window-1)),endS:Math.sin(angle*(window-1)),power(mean,slope,variance){
  const dc=this.re-mean*c-slope*tc,ds=-this.im-mean*s-slope*ts;
  return determinant>0&&variance>0?Math.max(0,Math.min(1,(ss*dc*dc-2*cs*dc*ds+cc*ds*ds)/(determinant*variance))):0;
 }};
}
// Detrended rolling lag correlations must have a distinct positive peak and
// agree with a sinusoidal fit. This is an estimate, never a crossover forecast.
export function createCycleEstimator(window,minimum,maximum,tick=()=>{},{candidates=false}={}){
 const sources=[],sum=[0],squares=[0],times=[0],products=new Float64Array(maximum+2),spectra=new Map();
 for(let k=minimum-(candidates?1:0);k<=maximum+(candidates?1:0);k++){tick();spectra.set(k,spectrumState(k,window));}
 let anchor=null,valid=0;
 const segment=(array,a,b)=>array[b+1]-array[a];
 return {push(value){
  const index=sources.length;if(anchor===null&&finite(value))anchor=value;const z=finite(value)?value-anchor:0;
  sources.push(z);sum.push(sum.at(-1)+z);squares.push(squares.at(-1)+z*z);times.push(times.at(-1)+index*z);valid=finite(value)?valid+1:0;
  const start=index-window+1,out=start>0?sources[start-1]:0,ready=valid>=window,tt=window*(window*window-1)/12;
  let mean=0,slope=0,variance=0;
  if(ready){const total=segment(sum,start,index),raw=segment(squares,start,index)-total*total/window;mean=total/window;slope=(segment(times,start,index)-(start+(window-1)/2)*total)/tt;variance=Math.max(0,raw-slope*slope*tt);if(variance<=Number.EPSILON*128*Math.max(raw,1e-300))variance=0;}
  let left=null,middle=null,best=null,bestScore=0;const correlations=candidates?new Map():null;
  for(let k=minimum-1;k<=maximum+1;k++){
   tick();products[k]+=(index>=k?sources[index-k]*z:0)-(start>0?sources[start-1]*sources[start-1+k]:0);
   const spectral=spectra.get(k);if(spectral){const re=spectral.re-out,im=spectral.im;spectral.re=spectral.rotationC*re-spectral.rotationS*im+z*spectral.endC;spectral.im=spectral.rotationS*re+spectral.rotationC*im-z*spectral.endS;}
   let correlation=null;
   if(ready&&variance>0){
    const count=window-k,a=segment(sum,start,index-k),b=segment(sum,start+k,index),tvar=count*(count*count-1)/12,ta=segment(times,start,index-k)-(start+(count-1)/2)*a,tb=segment(times,start+k,index)-(start+k+(count-1)/2)*b;
    const va=segment(squares,start,index-k)-a*a/count-2*slope*ta+slope*slope*tvar,vb=segment(squares,start+k,index)-b*b/count-2*slope*tb+slope*slope*tvar,cov=products[k]-a*b/count-slope*(ta+tb)+slope*slope*tvar;
    if(va>0&&vb>0)correlation=Math.max(-1,Math.min(1,cov/Math.sqrt(va*vb)));
   }
   if(correlations&&k>=minimum&&k<=maximum)correlations.set(k,correlation);
   const candidate=k-1;
   if(candidate>=minimum&&candidate<=maximum&&middle!==null&&left!==null&&correlation!==null&&middle>=left&&middle>correlation&&middle>=.55){
    const power=spectra.get(candidate).power(mean,slope,variance),score=middle*power;
    if(power>=.35&&score>bestScore){best=candidate;bestScore=score;}
   }
   left=middle;middle=correlation;
  }
  if(!candidates)return best;
  if(!ready||variance<=0)return {period:null,confirmed:false,candidates:[]};
  const powers=new Map([...spectra].map(([period,spectral])=>[period,spectral.power(mean,slope,variance)]));
  const describe=period=>({period,explainedFraction:powers.get(period),correlation:correlations.get(period),confirmed:period===best});
  const peaks=[...powers].filter(([period,power])=>period>=minimum&&period<=maximum&&power>1e-10&&power>=(powers.get(period-1)??-1)&&power>(powers.get(period+1)??-1)).map(([period])=>describe(period)).sort((a,b)=>b.explainedFraction-a.explainedFraction);
  const selected=best===null?[]:[describe(best)];
  for(const peak of peaks){if(selected.every(candidate=>Math.abs(1/candidate.period-1/peak.period)>=1/window))selected.push(peak);if(selected.length>=3)break;}
  return {period:selected[0]?.period??null,confirmed:selected[0]?.confirmed??false,candidates:selected};
 }};
}
export const kama=(values,period,fast=2,slow=30)=>{const state=createKAMA(period,fast,slow);return values.map(value=>state.push(value));};
export const hma=(values,period)=>{const state=createHMA(period);return values.map(value=>state.push(value));};
export const cyclePeriod=(values,window=200,minimum=8,maximum=100)=>{const state=createCycleEstimator(window,minimum,maximum);return values.map(value=>state.push(value));};

// Exploratory chart candidates retain weak spectral peaks with explicit quality metadata.
// Formula/bot cyclePeriod continues to return only the original confirmed estimate.
export const cycleCandidateSeries=(values,window=200,minimum=8,maximum=100)=>{const state=createCycleEstimator(window,minimum,maximum,()=>{},{candidates:true});return values.map(value=>state.push(value));};
