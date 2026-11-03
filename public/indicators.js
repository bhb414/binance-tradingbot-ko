export function heikinAshi(candles) {
  const result=[];
  for (const candle of candles) {
    const previous=result.at(-1);
    const open=previous?(previous.open+previous.close)/2:(candle.open+candle.close)/2;
    const close=(candle.open+candle.high+candle.low+candle.close)/4;
    result.push({...candle,open,close,high:Math.max(candle.high,open,close),low:Math.min(candle.low,open,close)});
  }
  return result;
}
export function bollingerBands(candles,period=20,sigma=2) {
  if(!Number.isInteger(period)||period<2||period>300||!Number.isFinite(sigma)||sigma<=0||sigma>10)throw new Error('볼린저 기간은 2~300, 표준편차 배수는 0보다 크고 10 이하여야 합니다.');
  return candles.flatMap((c,i)=>{
    if(i<period-1)return [];
    const values=candles.slice(i-period+1,i+1).map(x=>x.close);
    const middle=values.reduce((s,v)=>s+v,0)/period;
    const deviation=Math.sqrt(values.reduce((s,v)=>s+(v-middle)**2,0)/period);
    return [{time:c.time,middle,upper:middle+sigma*deviation,lower:middle-sigma*deviation}];
  });
}
export function formulaSeries(candles) {
  const heikin=heikinAshi(candles);
  const result=Object.fromEntries(['open','high','low','close','volume'].map(k=>[k,candles.map(c=>c[k])]));
  for(const key of ['open','high','low','close'])result['heikin'+key[0].toUpperCase()+key.slice(1)]=heikin.map(c=>c[key]);
  for(const period of [5,20,60])result[`sma${period}`]=candles.map((_,i)=>i<period-1?null:candles.slice(i-period+1,i+1).reduce((s,c)=>s+c.close,0)/period);
  return result;
}
