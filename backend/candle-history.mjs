// Preserve warm-up history while replacing the current candle on each refresh.
export function candleHistory(budget,key,limit,load,{force=false}={}){
  if(force)budget.cache.delete('candles:'+key+':'+limit);
  return budget.cached('candles:'+key+':'+limit,budget.pollIntervalMs||2500,async()=>{
    const old=force?null:budget.histories.get(key+':'+limit);
    let fresh=await load(old?Math.min(3,limit):limit);
    if(old?.length&&(!fresh.length||fresh[0].time>old.at(-1).time||fresh.at(-1).time<old.at(-1).time))fresh=await load(limit);
    const overlap=old?.length&&fresh.some(c=>c.time===old.at(-1).time);
    const merged=overlap?[...new Map([...old,...fresh].map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time).slice(-limit):fresh;
    budget.histories.set(key+':'+limit,merged);if(budget.histories.size>128)budget.histories.delete(budget.histories.keys().next().value);
    return merged;
  });
}
