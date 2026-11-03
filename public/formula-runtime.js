import {compileFormula,formulaTimeframes} from './formula.js';
import {formulaSeries} from './indicators.js';
export function ruleIntervals(source){return formulaTimeframes(source);}
function unavailable(message){const error=new Error(message);error.temporary=true;error.retryAt=Date.now()+3000;throw error;}
function candles(snapshot,interval){
 if(!snapshot)unavailable(interval+' 봉을 조회하지 못했습니다.');
 const data=snapshot.candles.filter(c=>c.time*1000<=snapshot.serverNow);
 if(data.length<2||!Number.isFinite(data.at(-1).closeTime)||snapshot.serverNow-data.at(-1).closeTime>120000)unavailable(interval+' 최신 봉을 확인할 수 없어 조건 판단을 기다립니다.');
 return data;
}
function positionSeries(series,data,position={}){
 if(!(position.quantity>0))return series;
 if(Number.isFinite(position.entryPrice)&&position.entryPrice>0){series.averagePrice=data.map(()=>position.entryPrice);series.profit=data.map(c=>(c.close/position.entryPrice-1)*100*(position.direction==='LONG'?1:-1)*position.leverage);}
 if(Number.isFinite(position.profitValue))series.profit=data.map(()=>position.profitValue);
 return series;
}
export function evaluateRuleFormula(source,snapshots,position={}){
 const formula=compileFormula(source),intervals=formulaTimeframes(formula),clock=intervals[0]||'1m',frames={},aligned={};
 for(const interval of intervals.length?intervals:[clock]){
  const snapshot=snapshots[interval],primary=candles(snapshot,interval),named=Object.entries(snapshot.symbols||{}),byName=new Map();
  for(const [name,feed]of named){const rows=candles(feed,interval);if(rows.at(-1).time!==primary.at(-1).time)unavailable(name+'과 기준 종목의 최신 봉 시각이 달라 동기화를 기다립니다.');byName.set(name,new Map(rows.map(row=>[row.time,row])));}
  let start=primary.length-1;
  if(named.length){for(;start>=0;start--){if([...byName.values()].some(map=>!map.has(primary[start].time)))break;if(start<primary.length-1&&primary[start].closeTime+1!==primary[start+1].time*1000)break;}start++;}
  else start=0;
  const data=primary.slice(start);if(data.length<2)unavailable('종목 간 공통 봉이 부족합니다.');
  const series=positionSeries(formulaSeries(data),data,position);
  if(named.length){series.symbols=Object.create(null);for(const [name]of named){const rows=data.map(row=>byName.get(name).get(row.time));series.symbols[name]=positionSeries(formulaSeries(rows),rows,position.symbols?.[name]);}}
  frames[interval]=series;aligned[interval]=data;
 }
 const market=snapshots[clock],data=aligned[clock],result=formula.evaluate(frames[clock],data.length-1,{frames,maxSteps:200000});
 if(!result.ok)throw new Error(result.error);
 return {result,market,bar:data.at(-1).time,interval:clock};
}
