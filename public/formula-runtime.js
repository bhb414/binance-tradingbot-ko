import {compileFormula,formulaTimeframes} from './formula.js';
import {formulaSeries} from './indicators.js';

export function ruleIntervals(source){return formulaTimeframes(source);}
export function evaluateRuleFormula(source,snapshots,position={}){
  const formula=compileFormula(source),intervals=formulaTimeframes(formula),clock=intervals[0]||'1m',frames={};
  for(const interval of intervals.length?intervals:[clock]){
    const snapshot=snapshots[interval];if(!snapshot)throw new Error(interval+' 봉을 조회하지 못했습니다.');
    const data=snapshot.candles.filter(c=>c.time*1000<=snapshot.serverNow);
    if(data.length<2||!Number.isFinite(data.at(-1).closeTime)||snapshot.serverNow-data.at(-1).closeTime>120000)throw new Error(interval+' 최신 봉을 확인할 수 없어 조건 실행을 중단했습니다.');
    const series=formulaSeries(data);
    if(position.quantity>0){series.averagePrice=data.map(()=>position.entryPrice);series.profit=data.map(c=>(c.close/position.entryPrice-1)*100*(position.direction==='LONG'?1:-1)*position.leverage);}
    frames[interval]=series;
  }
  const market=snapshots[clock],data=market.candles.filter(c=>c.time*1000<=market.serverNow),result=formula.evaluate(frames[clock],data.length-1,{frames,maxSteps:100000});
  if(!result.ok)throw new Error(result.error);
  return {result,market,bar:data.at(-1).time,interval:clock};
}
