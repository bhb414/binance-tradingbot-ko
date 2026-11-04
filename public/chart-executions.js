import {api} from './api.js';
import {chartBarEnd} from './chart-timeframes.js';
export function executionBars(rows,candles,interval){
 const byTime=new Map(),valid=[];
 for(const row of rows){if(!['BUY','SELL'].includes(row.side)||!Number.isFinite(row.at)||!(row.quantity>0&&row.price>0))continue;
  const t=row.at/1000;let low=0,high=candles.length-1,index=-1;while(low<=high){const mid=(low+high)>>1;if(candles[mid].time<=t){index=mid;low=mid+1;}else high=mid-1;}if(index<0)continue;
  const c=candles[index],end=Number.isFinite(c.closeTime)?(c.closeTime+1)/1000:chartBarEnd(c.time,interval);if(t>=end)continue;const r={...row,barTime:c.time,label:row.labels?.join(' · ')||'체결'};valid.push(r);const list=byTime.get(c.time)||[];list.push(r);byTime.set(c.time,list);
 }
 const markers=[];for(const[time,entries]of byTime)for(const side of ['BUY','SELL']){const matching=entries.filter(r=>r.side===side);if(!matching.length)continue;markers.push({id:'execution:'+time+':'+side,time,position:side==='BUY'?'belowBar':'aboveBar',shape:side==='BUY'?'arrowUp':'arrowDown',color:side==='BUY'?'#149b73':'#d6516b',text:(side==='BUY'?'B':'S')+(matching.length>1?' ×'+matching.length:''),size:1});}
 markers.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));return {markers,rows:valid};
}
const cache=new Map(),renderers=new Set(),preference='fw-chart-executions-visible-v1';let enabled=true;try{enabled=localStorage.getItem(preference)!=='0';}catch{}
function requestRows(path,connectionId,revision){const key=connectionId+':'+revision+':'+path,old=cache.get(key);if(old&&Date.now()-old.at<5000)return old.promise;const promise=api(path);cache.set(key,{at:Date.now(),promise});promise.catch(()=>cache.delete(key));if(cache.size>24)cache.delete(cache.keys().next().value);return promise;}
export class ChartExecutions{
 constructor(series,{toggle,inspector,createMarkers=window.LightweightCharts.createSeriesMarkers,load=requestRows}){
  this.createMarkers=createMarkers;this.plugin=createMarkers(series,[],{autoScale:false});this.toggle=toggle;this.inspector=inspector;this.load=load;this.version=0;this.key=null;this.rows=[];this.context=null;this.retryAt=0;this.signature='';renderers.add(this);
  if(toggle){toggle.checked=enabled;toggle.addEventListener('change',()=>{enabled=toggle.checked;try{localStorage.setItem(preference,enabled?'1':'0');}catch{}for(const item of renderers){if(item.toggle)item.toggle.checked=enabled;item.render();}});}
 }
 setSeries(series){this.plugin.detach();this.plugin=this.createMarkers(series,[],{autoScale:false});this.signature='';this.render();}
 clear(){this.version++;this.key=null;this.rows=[];this.context=null;this.render();}
 render(){const data=enabled&&this.context?executionBars(this.rows,this.context.candles,this.context.interval):{markers:[],rows:[]},signature=JSON.stringify(data.markers);if(signature!==this.signature){this.plugin.setMarkers(data.markers);this.signature=signature;}this.inspector?.setExecutions(data.rows);}
 async update({state,market,symbol,candles,interval}){
  if(market!=='usdm'||!state?.connected||!state.connectionId||!candles?.length){this.clear();if(this.toggle){this.toggle.disabled=true;this.toggle.title='연결된 USDT 선물 계좌의 앱 체결 원장만 표시합니다.';}return;}
  if(this.toggle)this.toggle.disabled=false;this.context={candles,interval};const from=Math.floor(candles[0].time*1000),last=candles.at(-1),to=Number.isFinite(last.closeTime)?last.closeTime:chartBarEnd(last.time,interval)*1000-1,key=JSON.stringify([state.connectionId,symbol,from,to,state.fillsRevision??state.fills?.[0]?.id??null]);
  if(key===this.key||Date.now()<this.retryAt){this.render();return;}this.key=key;const version=++this.version;this.rows=[];this.render();
  try{const data=await this.load('/chart-executions?symbol='+encodeURIComponent(symbol)+'&startTime='+from+'&endTime='+to,state.connectionId,state.fillsRevision??state.fills?.[0]?.id??null);if(version!==this.version)return;if(data.connectionId!==state.connectionId){this.clear();return;}this.rows=data.rows;this.render();if(this.toggle)this.toggle.title='B 매수 · S 매도 · 앱에 기록된 체결만 표시'+(data.truncated?' · 최근 2,000건':'')+'. 봉을 선택하면 개별 체결을 볼 수 있습니다.';}
  catch(error){if(version!==this.version)return;this.rows=[];this.key=null;this.retryAt=Date.now()+5000;this.render();if(this.toggle)this.toggle.title='체결 표시 조회: '+error.message;}
 }
}
