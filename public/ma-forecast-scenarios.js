import {createHMA} from './adaptive-cycle.js';
import {theoreticalCyclePeriod} from './cycle-reference.js';
import {FORECAST_METHODS,FORECAST_CANDIDATES} from './ma-forecast.js';

const finite=Number.isFinite;
const label=key=>FORECAST_METHODS.find(([id])=>id===key)?.[1]||key;
const number=(x,d=3)=>finite(x)?x.toLocaleString('ko-KR',{maximumFractionDigits:d}):'미확인';
const sourceValue=(c,source)=>source==='hl2'?(c.high+c.low)/2:source==='hlc3'?(c.high+c.low+c.close)/3:source==='ohlc4'?(c.open+c.high+c.low+c.close)/4:c[source];

// One frozen assumed close for every virtual raw OHLC candle. Recalculate HA
// open/high/low causally when needed; do not turn a future real candle into input.
export function assumedForecastValues(price,candles,index,source,kind,horizon){
 let previous=candles[index];const result=[];
 for(let h=1;h<=horizon;h++){
  const open=kind==='heikin'?(previous.open+previous.close)/2:price;
  const c={open,close:price,high:Math.max(price,open),low:Math.min(price,open)};
  result.push(sourceValue(c,source));previous=c;
 }
 return result;
}

// Streaming extension uses the same KAMA/HMA states as the chart. EMA starts
// from its actual anchor value, and price/volume queues contain no later bar.
export function extendForecastAverage(line,values,volumes,index,future,futureVolume){
 const base=line.values[index];if(!finite(base))return [];
 const n=line.period,type=line.type,out=[base];let state;
 if(type==='KAMA'){
  const prices=values.slice(index-n+1,index+1),changes=[];let at=0,changeAt=0,volatility=0,previous=values[index],running=base;
  for(let i=Math.max(1,index-n+1);i<=index;i++){if(!finite(values[i])||!finite(values[i-1]))continue;const d=Math.abs(values[i]-values[i-1]);changes.push(d);volatility+=d;}
  const quick=2/3,steady=2/31;
  for(const value of future){
   const change=Math.abs(value-previous);if(changes.length<n){changes.push(change);volatility+=change;}else{volatility+=change-changes[changeAt];changes[changeAt]=change;changeAt=(changeAt+1)%n;}previous=value;
   const old=prices[at];prices[at]=value;at=(at+1)%n;const efficiency=volatility>0?Math.min(1,Math.abs(value-old)/volatility):0;
   running+=(steady+efficiency*(quick-steady))**2*(value-running);out.push(finite(running)?running:null);
  }return out;
 }
 if(type==='HMA'){
  state=createHMA(n);
  for(let i=Math.max(0,index-n-Math.floor(Math.sqrt(n))-2);i<=index;i++)state.push(values[i]);
  for(const v of future)out.push(state.push(v));return out;
 }
 let running=base;
 const prices=values.slice(Math.max(0,index-n+1),index+1),weights=volumes.slice(Math.max(0,index-n+1),index+1);
 let sum=prices.reduce((a,b)=>a+b,0),sumVolume=weights.reduce((a,b)=>a+(finite(b)&&b>=0?b:0),0),sumPV=prices.reduce((s,v,i)=>s+v*(finite(weights[i])&&weights[i]>=0?weights[i]:0),0),at=0;
 for(const v of future){
  if(type==='EMA'){running+=2/(n+1)*(v-running);out.push(finite(running)?running:null);continue;}
  const old=prices[at],oldVolume=finite(weights[at])&&weights[at]>=0?weights[at]:0;
  sum+=v-old;sumVolume+=futureVolume-oldVolume;sumPV+=v*futureVolume-old*oldVolume;
  prices[at]=v;weights[at]=futureVolume;at=(at+1)%n;
  const next=type==='VWMA'?(sumVolume>1e-12?sumPV/sumVolume:null):sum/n;
  out.push(finite(next)?next:null);
 }
 return out;
}

export function forecastCrossings(first,second,referenceSide,limit){
 const scale=Math.max(1,Math.abs(first[0]||0),Math.abs(second[0]||0)),epsilon=scale*1e-10;
 if(!finite(first[0])||!finite(second[0]))return {crossBars:null,touchBars:null};
 const initial=first[0]-second[0],side=Math.abs(initial)>epsilon?Math.sign(initial):referenceSide;
 let touchBars=Math.abs(initial)<=epsilon?0:null,crossBars=null;
 for(let h=1;h<=limit;h++){
  if(!finite(first[h])||!finite(second[h]))break;
  const d=first[h]-second[h];
  if(touchBars===null&&(Math.abs(d)<=epsilon||side&&side*d<0))touchBars=h;
  if(crossBars===null&&side&&side*d < -epsilon){crossBars=h;break;}
 }
 return {crossBars,touchBars};
}

function crossingHistory(first,second,index){
 let previous=null,last=null,direction=null,side=0;
 for(let i=0;i<=index;i++){
  if(!finite(first[i])||!finite(second[i])){previous=null;direction=null;last=null;side=0;continue;}
  const d=first[i]-second[i],event=previous===null?0:previous<=0&&d>0?1:previous>=0&&d<0?-1:0;
  if(d!==0)side=Math.sign(d);
  if(event&&event!==direction){last=i;direction=event;}
  previous=d;
 }
 return {last,side};
}

export function calculateForecastScenarios({values,candles,volumes,lines,index,source='close',kind='standard',params:p,historyInfo=null,metricsOnly=false}){
 const count=Math.max(p.searchBars,p.horizon),first=lines.find(l=>l.slot===Number(p.crossA)),second=lines.find(l=>l.slot===Number(p.crossB));
 const empty={paths:{},candidates:[],selected:null,comparison:{message:'비교할 두 이평의 과거 봉이 부족합니다.',caption:'비교할 두 이평의 과거 봉이 부족합니다.'}};
 if(index<0||!first||!second||!finite(first.values[index])||!finite(second.values[index]))return empty;
 const history=historyInfo||crossingHistory(first.values,second.values,index),short=first.period<=second.period?first:second,long=short===first?second:first;
 const basisPeriod=theoreticalCyclePeriod('SMA',Math.min(first.period,second.period),Math.max(first.period,second.period)),basis=finite(basisPeriod)?basisPeriod/(p.ratioBasis==='half'?2:1):null;
 const volume=finite(volumes[index])&&volumes[index]>=0?volumes[index]:0;
 const window=candles.slice(Math.max(0,index-p.rangeBars+1),index+1),enoughRange=window.length===p.rangeBars;
 const candidates=[
  {id:'slope',price:null},
  {id:'close',price:candles[index].close},
  {id:'low',price:enoughRange?Math.min(...window.map(c=>c.low)):null,reason:enoughRange?null:'고저가 범위의 봉이 부족합니다.'},
  {id:'high',price:enoughRange?Math.max(...window.map(c=>c.high)):null,reason:enoughRange?null:'고저가 범위의 봉이 부족합니다.'},
  {id:'short',price:short.values[index]},
  {id:'long',price:long.values[index]},
  {id:'cross-close',price:history.last===null?null:candles[history.last].close,reason:history.last===null?'조회 범위에 마지막 교차가 없습니다.':null}
 ];
 const cache=new Map(),linear=line=>{
  const base=line.values[index],before=line.values[index-p.slopeBars];
  if(!finite(base)||!finite(before))return [];
  const slope=(base-before)/p.slopeBars;
  return Array.from({length:count+1},(_,h)=>base+slope*h);
 };
 const fixed=(line,price)=>{
  const key=line.key+':'+price;if(cache.has(key))return cache.get(key);
  const future=assumedForecastValues(price,candles,index,source,kind,count),result=extendForecastAverage(line,values,volumes,index,future,volume);cache.set(key,result);return result;
 };
 const aggregate=['fastest','fastest-range','mean-price','mean-bars'].includes(p.method),included=id=>FORECAST_CANDIDATES.some(([key,method])=>method===id&&p[key]!==false);
 for(const c of candidates){
  c.label=label(c.id);
  c.included=included(c.id);
  if(aggregate&&(!c.included||p.method==='fastest-range'&&!['low','high'].includes(c.id)||p.method==='mean-price'&&c.id==='slope')){c.reason=c.id==='slope'&&p.method==='mean-price'?'기울기 방식에는 평균낼 가정 종가가 없습니다.':'선택 후보에서 제외';c.crossBars=null;c.touchBars=null;continue;}
  if(c.id!=='slope'&&!finite(c.price)){c.crossBars=null;c.touchBars=null;continue;}
  const a=c.id==='slope'?linear(first):fixed(first,c.price),b=c.id==='slope'?linear(second):fixed(second,c.price);
  if(!a.length||!b.length){c.reason='이평 계산에 필요한 봉이 부족합니다.';c.crossBars=null;c.touchBars=null;continue;}
  Object.assign(c,forecastCrossings(a,b,history.side,p.searchBars));
  c.nextGap=finite(a[1])&&finite(b[1])?a[1]-b[1]:null;
 }
 const pool=candidates.filter(c=>!aggregate||c.included).filter(c=>p.method!=='fastest-range'||['low','high'].includes(c.id));
 let selected;
 if(p.method==='mean-price'){
  const used=pool.filter(c=>finite(c.price)&&!c.reason),price=used.length?used.reduce((s,c)=>s+c.price,0)/used.length:null;
  selected={id:'mean-price',label:label('mean-price'),price,contributors:used.length,reason:used.length?null:'평균낼 가정 종가를 하나 이상 선택하세요.'};
  if(used.length)Object.assign(selected,forecastCrossings(fixed(first,price),fixed(second,price),history.side,p.searchBars));
 }else if(p.method==='mean-bars'){
  const crossed=pool.filter(c=>finite(c.crossBars)&&!c.reason),touched=pool.filter(c=>finite(c.touchBars)&&!c.reason);
  selected={id:'mean-bars',label:label('mean-bars'),price:null,crossBars:crossed.length?crossed.reduce((s,c)=>s+c.crossBars,0)/crossed.length:null,touchBars:touched.length?touched.reduce((s,c)=>s+c.touchBars,0)/touched.length:null,contributors:crossed.length,totalCandidates:pool.length,reason:pool.some(c=>!c.reason)?null:'평균낼 가정을 하나 이상 선택하세요.'};
 }else if(['fastest','fastest-range'].includes(p.method)){
  selected=pool.filter(c=>finite(c.crossBars)).sort((a,b)=>a.crossBars-b.crossBars||Math.abs(a.nextGap??Infinity)-Math.abs(b.nextGap??Infinity))[0];
  // A touch is useful information, but never label it a strict crossover.
  if(!selected)selected=pool.filter(c=>!c.reason&&finite(c.touchBars)).sort((a,b)=>a.touchBars-b.touchBars)[0]||pool.find(c=>!c.reason);
 }else selected=candidates.find(c=>c.id===p.method);
 if(!selected){const message='계산할 후보를 하나 이상 선택하세요.';return {...empty,candidates,comparison:{message,caption:message}};}
 const paths={};
 if(!metricsOnly&&!selected.reason)for(const line of lines){
  let path;
  if(selected.id==='mean-bars'){
   const used=pool.filter(c=>!c.reason&&finite(c.crossBars)).map(c=>c.id==='slope'?linear(line):fixed(line,c.price));
   path=used.length?Array.from({length:p.horizon+1},(_,h)=>{const values=used.map(a=>a[h]).filter(finite);return values.length?values.reduce((s,x)=>s+x,0)/values.length:null;}):[];
  }else path=selected.id==='slope'?linear(line):fixed(line,selected.price);
  paths[line.key]=path.slice(0,p.horizon+1);
 }
 const elapsed=history.last===null?null:index-history.last,cross=selected.crossBars,touch=selected.touchBars;
 const remainingRatio=finite(cross)&&basis?cross/basis:null,finalElapsed=finite(cross)&&elapsed!==null?elapsed+cross-1:null,finalRatio=finalElapsed!==null&&basis?finalElapsed/basis:null;
 const refLabel=first.type+' '+first.period+' / '+second.type+' '+second.period;
 const selectedName=label(selected.id),priceText=finite(selected.price)?' · 가정 '+number(selected.price,8):'';
 const meanText=selected.id==='mean-bars'?'교차 봉수 평균 ':'교차 ';
 const result=selected.reason?selected.reason:finite(cross)?meanText+number(cross)+'봉'+(basis?' · 남은 '+number(remainingRatio)+'배':'')+(finalRatio!==null?' · 종료 경과 '+number(finalRatio)+'배':'')+(selected.id==='mean-bars'?' · '+selected.contributors+'/'+selected.totalCandidates+'개 평균':''):'검색 '+p.searchBars+'봉 내 교차 없음'+(finite(touch)?' · 접촉 '+number(touch)+'봉':'');
 const message=selectedName+priceText+' · '+result+(selected.id==='mean-price'?' · '+selected.contributors+'개 가격 평균':'')+(selected.id==='mean-bars'&&!finite(cross)?' · '+selected.contributors+'/'+selected.totalCandidates+'개 평균':'');
 const caption=(p.anchor==='closed'?'완성봉':'진행봉')+' 기준 · '+refLabel+' · '+message+(basis?' · 1배 = 두 기간의 SMA 이론 '+number(basis,4)+'봉'+(p.ratioBasis==='half'?' (½)':' (전체)'):' · 배수 기준 미확인')+' · 표시 '+p.horizon+'봉 / 검색 '+p.searchBars+'봉'+(selected.id==='mean-bars'?' · 점선은 후보 이평경로의 평균이며 교차 봉수 평균과 만나는 위치는 다를 수 있습니다.':'');
 return {paths,candidates,selected:{...selected},comparison:{message,caption,referenceLabel:refLabel,crossBars:cross,touchBars:touch,remainingRatio,finalElapsedBars:finalElapsed,finalElapsedRatio:finalRatio,elapsedBars:elapsed,basisBars:basis,lastCrossIndex:history.last,lastCrossClose:history.last===null?null:candles[history.last].close,selectedMethod:selected.id,assumedClose:selected.price,searchBars:p.searchBars}};
}
