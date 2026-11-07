import {FORECAST_CANDIDATES,FORECAST_DEFAULTS,FORECAST_METHODS} from './ma-forecast.js';
import {calculateForecastScenarios} from './ma-forecast-scenarios.js';
import {cycleRemainingText} from './cycle-reference.js';

export const CYCLE_FORECAST_DEFAULTS={predictionSource:'interval',forecastMethod:'fastest',forecastRangeBars:26,forecastSlopeBars:3,forecastSearchBars:120,...Object.fromEntries(FORECAST_CANDIDATES.map(([key])=>['forecast'+key[0].toUpperCase()+key.slice(1),true]))};
export function migrateCycleForecast(value){
 if(value?.type!=='CYCLE')return value;
 return {...value,params:{...CYCLE_FORECAST_DEFAULTS,...value.params}};
}
export function cycleForecastFields(){
 const choice=(key,label,value,options)=>({key,label,value,options}),length=(key,label,value,max)=>({key,label,value,min:1,max,step:1});
 return [choice('predictionSource','예상 봉수·배수 기준','interval',[['previous','이전 완료 경과'],['current','현재 시나리오 · 종료 직전 경과'],['remaining','현재 경과 + 예상 남은 봉수'],['interval','기존 교차 간격']]),choice('forecastMethod','교차 예상 계산 방식','fastest',FORECAST_METHODS),length('forecastRangeBars','예상 고가·저가 범위 N봉',26,300),length('forecastSlopeBars','예상 기울기 비교 봉 수',3,300),length('forecastSearchBars','예상 교차 검색 최대 봉 수',120,500),...FORECAST_CANDIDATES.map(([key,,label])=>({...choice('forecast'+key[0].toUpperCase()+key.slice(1),'예상 후보 · '+label,true,[[true,'포함'],[false,'제외']]),type:'checkbox'}))];
}
export function cyclePredictionLabel(study){
 const source=study.params.predictionSource;
 if(source==='previous')return '예상 · 이전경과';
 if(source==='interval')return '간격';
 const prefix=study.params.forecastMethod==='mean-bars'?'평균':['fastest','fastest-range'].includes(study.params.forecastMethod)?'최단':'예상';
 return prefix+(source==='remaining'?' 예상경과':' 종료');
}

const cache=new Map(),finite=Number.isFinite;
const num=(v,d=3)=>finite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:d}):'미확인';
export function cycleForecastReadings(study,meta){
 const rate=study.params.display==='ratio',value=v=>!finite(v)?'미확인':rate?(meta.basis>0?num(v/meta.basis)+'배':num(v)+'봉 · 배수 대기'):num(v)+'봉';
 if(study.params.predictionSource==='previous')return '이전 완료 경과 '+value(meta.prediction)+' · 이전 교차 간격 − 1봉';
 if(!['current','remaining'].includes(study.params.predictionSource))return '';
 return (meta.forecastMethodLabel||'교차 예상')+(finite(meta.forecastAssumedClose)?' · 가정 종가 '+num(meta.forecastAssumedClose,8):'')+' · 현재 경과 '+value(meta.elapsed)+' + 예상 남은 '+cycleRemainingText(study,meta)+' ≈ 예상 교차 경과 '+value(meta.forecastTarget)+(study.params.predictionSource==='current'?' · 종료 직전 경과 '+value(meta.forecastEnd):'')+(finite(meta.forecastContributors)?' · '+meta.forecastContributors+'/'+meta.forecastCandidates+'개 평균':'')+(meta.forecastStatus?' · '+meta.forecastStatus:'');
}

// Cache only an unchanged causal prefix. Any past OHLC/volume/MA change
// invalidates every following prediction. Basis/reference conversion stays in
// CYCLE, so changing the denominator never changes a predicted crossing time.
export function cycleForecastSeries({values,candles,volumes,fast,slow,elapsed,source,kind,params:p}){
 const options={...FORECAST_DEFAULTS,method:p.forecastMethod,showCrossing:true,searchBars:p.forecastSearchBars,rangeBars:p.forecastRangeBars,slopeBars:p.forecastSlopeBars,horizon:1,anchor:'live',crossA:'0',crossB:'1'};
 for(const [key]of FORECAST_CANDIDATES)options[key]=p['forecast'+key[0].toUpperCase()+key.slice(1)];
 const key=JSON.stringify([source,kind,p.average,p.fast,p.slow,options]);
 const previous=cache.get(key),signatures=[],data=[];
 const lines=[{key:'ma0',slot:0,type:p.average,period:p.fast,values:fast},{key:'ma1',slot:1,type:p.average,period:p.slow,values:slow}];
 let same=!!previous,side=0;
 for(let i=0;i<candles.length;i++){
  const c=candles[i],signature=[c.time,values[i],c.open,c.high,c.low,c.close,volumes[i],fast[i],slow[i]].join('|');signatures.push(signature);
  if(finite(fast[i])&&finite(slow[i])&&fast[i]!==slow[i])side=Math.sign(fast[i]-slow[i]);
  if(same&&previous.signatures[i]===signature){data.push(previous.data[i]);continue;}
  same=false;
  if(!finite(fast[i])||!finite(slow[i])){data.push({forecastEnd:null,forecastTarget:null,forecastRemaining:null});continue;}
  const last=finite(elapsed[i])?i-elapsed[i]:null;
  const result=calculateForecastScenarios({values,candles,volumes,lines,index:i,source,kind,params:options,historyInfo:{last,side},metricsOnly:true}),m=result.comparison;
  data.push({forecastEnd:finite(m.crossBars)&&finite(elapsed[i])?elapsed[i]+m.crossBars-1:null,forecastTarget:finite(m.crossBars)&&finite(elapsed[i])?elapsed[i]+m.crossBars:null,forecastRemaining:finite(m.crossBars)?m.crossBars:null,
   forecastMethodLabel:result.selected?.label||m.message,forecastAssumedClose:m.assumedClose,
   forecastContributors:result.selected?.id==='mean-bars'?result.selected.contributors:undefined,forecastCandidates:result.selected?.totalCandidates,
   forecastStatus:finite(m.crossBars)?'':finite(m.touchBars)?'접촉 '+m.touchBars+'봉 · 교차 미확인':'검색 '+p.forecastSearchBars+'봉 내 교차 미확인'});
 }
 cache.delete(key);cache.set(key,{signatures,data});while(cache.size>8)cache.delete(cache.keys().next().value);
 return data;
}
