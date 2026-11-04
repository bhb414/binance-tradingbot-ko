export const CHART_TIMEFRAMES=Object.freeze([['1m','1분'],['3m','3분'],['5m','5분'],['15m','15분'],['30m','30분'],['1h','1시간'],['2h','2시간'],['4h','4시간'],['6h','6시간'],['8h','8시간'],['12h','12시간'],['1d','1일'],['3d','3일'],['1w','1주'],['1M','1개월']]);
export const CHART_INTERVALS=Object.freeze(CHART_TIMEFRAMES.map(([key])=>key));
export const chartIntervalLabel=key=>CHART_TIMEFRAMES.find(([value])=>value===key)?.[1]||key;
export function chartIntervalSeconds(key){const n=Number(key.slice(0,-1)),unit=key.at(-1);return n*({m:60,h:3600,d:86400,w:604800,M:2592000}[unit]||0);}
export function chartBarEnd(time,interval){if(interval==='1M'){const d=new Date(time*1000);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000;}return time+chartIntervalSeconds(interval);}
