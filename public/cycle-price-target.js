import {assumedForecastValues,extendForecastAverage,forecastCrossings} from './ma-forecast-scenarios.js';
import {crossSide} from './adaptive-cycle.js';
const finite=Number.isFinite;
const formats=new Map(),percentFormat=new Intl.NumberFormat('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:4});
const number=(n,d=8)=>{if(!finite(n))return '미확인';if(!formats.has(d))formats.set(d,new Intl.NumberFormat('ko-KR',{maximumFractionDigits:d}));return formats.get(d).format(n);};
export function cyclePriceSummary(bars,multiplier,change){
 const value=!finite(change)?'계산 불가':(change<0?'−':change>0?'+':'')+percentFormat.format(Math.abs(change))+'%';
 return bars+'봉 후 · '+number(multiplier,2)+'배 변동 '+value;
}

// Solve the future constant raw close, not a linear extension of the MA slope.
// The shared extension matches appended flat OHLC candles, including HA sources.
export function createCyclePriceSolver(context){
 const cache=new Map();
 return {at(bars){
  if(cache.has(bars))return cache.get(bars);
  const result=solve(context,bars);cache.set(bars,result);return result;
 }};
}
function solve(c,bars){
 const empty=reason=>({price:null,reason});
 if(!c||!Number.isInteger(bars)||bars<1||bars>300)return empty('계산할 미래 봉을 선택하세요.');
 const {values,candles,volumes,lines,index,kind,source,referencePrice}=c;
 if(index<0||!lines.every(l=>finite(l.values[index]))||!finite(referencePrice)||referencePrice<=0)return empty('이평 계산에 필요한 기준 봉이 부족합니다.');
 const base=referencePrice,tolerance=Math.max(1e-14,base*1e-10),volume=finite(volumes[index])&&volumes[index]>=0?volumes[index]:0;
 let side=crossSide(lines[0].values[index],lines[1].values[index]);
 if(!side)for(let i=index-1;i>=0;i--){if(!lines.every(l=>finite(l.values[i])))break;side=crossSide(lines[0].values[i],lines[1].values[i]);if(side)break;}
 const evaluate=price=>{
  const future=assumedForecastValues(price,candles,index,source,kind,bars),paths=lines.map(l=>extendForecastAverage(l,values,volumes,index,future,volume));
  return {gap:paths[0][bars]-paths[1][bars],paths};
 };
 const gap=p=>evaluate(p).gap;
 const linear=lines.every(l=>l.type!=='KAMA')&&(kind!=='heikin'||['close','open'].includes(source));
 let roots=[];
 if(linear){
  const lo=base*.8,hi=base*1.2,a=gap(lo),b=gap(hi),coefficient=(b-a)/(hi-lo);
  if(!finite(a)||!finite(b))return empty('선택한 거래량·가격 소스로 이평을 계산할 수 없습니다.');
  if(Math.abs(b-a)<=tolerance)return empty(Math.max(Math.abs(a),Math.abs(b))<=tolerance?'이 시점에는 가격과 무관하게 두 이평이 같아져 고유한 교차 가격을 정할 수 없습니다.':'일정 종가를 바꿔도 이 시점의 이평 차이를 줄일 수 없습니다.');
  const root=lo-a/coefficient;if(finite(root)&&root>0&&Math.abs(gap(root))<=tolerance*8)roots=[root];
 }else{
  // KAMA and HA high/low sources can be nonlinear and have multiple roots.
  // Search positive prices from 0.000001x to 1000000x the reference; choose
  // the nearest verified root and explicitly identify the numerical estimate.
  const offsets=[0,...[.000001,.00001,.0001,.001,.002,.005,.01,.02,.05,.1,.2,.4,.7,1,1.5,2,3,4,6,8,10,Math.log(1e6)].flatMap(x=>[-x,x])].sort((a,b)=>a-b);
  const points=offsets.map(x=>({price:base*Math.exp(x)})).map(p=>({...p,gap:gap(p.price)}));
  if(points.every(p=>finite(p.gap)&&Math.abs(p.gap)<=tolerance))return empty('이 시점에는 고유한 교차 가격을 정할 수 없습니다.');
  for(let i=0;i<points.length;i++){
   const a=points[i],b=points[i+1];if(finite(a.gap)&&Math.abs(a.gap)<=tolerance)roots.push(a.price);
   if(!b||!finite(a.gap)||!finite(b.gap)||a.gap*b.gap>=0)continue;
   let lo=a.price,hi=b.price,g=a.gap;
   for(let n=0;n<55;n++){const mid=(lo+hi)/2,v=gap(mid);if(!finite(v))break;if(g*v<=0)hi=mid;else{lo=mid;g=v;}}
   const root=(lo+hi)/2;if(Math.abs(gap(root))<=tolerance*8)roots.push(root);
  }
 }
 roots=roots.filter(p=>finite(p)&&p>0).sort((a,b)=>Math.abs(a/base-1)-Math.abs(b/base-1));
 if(!roots.length)return empty(linear?'양수 종가로 이 시점에 만나는 교차 가격이 없습니다.':'양수 가격 탐색 범위에서 교차 경계를 찾지 못했습니다.');
 const price=roots[0],{paths}=evaluate(price),crossing=forecastCrossings(paths[0],paths[1],side,bars),delta=Math.max(price*1e-6,base*1e-8),above=gap(price+delta),below=gap(Math.max(price-delta,price/2));
 const crossingSide=side&&finite(above)&&side*above < -tolerance?'above':side&&finite(below)&&side*below < -tolerance?'below':null;
 const probePrice=crossingSide==='above'?price+delta:crossingSide==='below'?Math.max(price-delta,price/2):null;
 const probe=probePrice===null?null:evaluate(probePrice),probeCross=probe?forecastCrossings(probe.paths[0],probe.paths[1],side,bars).crossBars:null;
 return {price,reason:null,numerical:!linear,direction:side?-side:null,crossingSide,earlierCross:probeCross!==null&&probeCross<bars?probeCross:crossing.crossBars!==null&&crossing.crossBars<bars?crossing.crossBars:null,earlierTouch:crossing.touchBars!==null&&crossing.touchBars<bars?crossing.touchBars:null};
}

export function cyclePriceReading(study,context,solver,bars,meta){
 const result=solver.at(bars),multiplier=study.params.priceTargetMultiplier,change=result.price===null?null:(result.price/context.referencePrice-1)*100*multiplier;
 const direction=result.direction===1?'골든크로스':result.direction===-1?'데드크로스':'교차';
 const condition=result.crossingSide==='above'?'이 가격보다 높으면':result.crossingSide==='below'?'이 가격보다 낮으면':'방향 확인 필요';
 const elapsed=finite(meta?.elapsed)?meta.elapsed+bars:null,basis=meta?.basis;
 return {summary:cyclePriceSummary(bars,multiplier,change),bars,price:result.price,change,multiplier,
  elapsed:elapsed===null?'':('예상 경과 '+number(elapsed,2)+'봉'+(study.params.display==='ratio'&&basis>0?' · '+number(elapsed/basis,3)+'배':'')),
  target:result.price===null?'':number(result.price)+' · '+condition+' '+direction+' 방향',
  reference:'현재 기준종가 '+number(context.referencePrice)+' · '+'현재 진행봉까지 반영',
  notice:result.reason||(result.earlierCross?'이 경계의 교차 방향으로 움직이면 '+result.earlierCross+'봉째 먼저 교차합니다. '+bars+'봉째 최초 교차를 뜻하지 않습니다.':result.earlierTouch!==null?'이 가격에서는 '+result.earlierTouch+'봉째 이미 접촉합니다. '+bars+'봉째 최초 교차를 뜻하지 않습니다.':result.crossingSide?'두 이평이 만나는 경계값입니다. 실제 교차는 해당 가격을 넘어야 합니다.':'접촉만 계산됩니다. 이 가격 주변에서 엄격한 교차 방향을 정할 수 없습니다.'),
  assumption:'경과선의 완성봉·진행봉 설정과 별도로, 역산은 현재 진행봉까지 반영합니다. 다음 '+bars+'봉의 종가를 모두 같은 값으로 가정합니다. '+(context.kind==='heikin'?'실제 가격으로 하이킨아시를 다시 계산합니다. ':'')+(study.params.average==='VWMA'?'미래 거래량은 기준봉과 동일합니다. ':'')+(result.numerical?'수치 탐색한 가장 가까운 가격 경계입니다. ':'')+'표시값은 현재 기준종가 대비 가격 변동률 × '+number(multiplier,2)+'배입니다. 숏 수익률은 부호가 반대이며, 수수료·펀딩은 포함하지 않습니다.'};
}
