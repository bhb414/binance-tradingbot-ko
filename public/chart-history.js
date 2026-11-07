export const CHART_HISTORY_PAGE=500;
const keyOf=c=>[c.market,c.symbol,c.interval].join(':');
const valid=c=>c&&['time','open','high','low','close','volume'].every(k=>Number.isFinite(c[k]))&&c.time>=0;
export function mergeChartCandles(older=[],fresh=[]){return [...new Map([...older,...fresh].filter(valid).map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time);}
export function historyRange(range,added,manual=false){
 if(!range||!Number.isFinite(range.from)||!Number.isFinite(range.to)||range.to<=range.from)return null;
 if(!manual)return {from:range.from+added,to:range.to+added};
 const width=range.to-range.from,from=Math.max(0,added+10-width);return {from,to:from+width};
}
// Historical pages and live quotes share timestamps, but never share bot state.
export class ChartHistory{
 constructor({request,getRange=()=>null,setRange=()=>{},onChange=()=>{},now=Date.now,delay=250}={}){Object.assign(this,{request,getRange,setRange,onChange,now,delay});this.entries=new Map();this.listeners=new Set();this.current=null;}
 subscribe(listener){this.listeners.add(listener);listener(this.view());return()=>this.listeners.delete(listener);}
 view(){const e=this.current;return {count:e?.snapshot?.candles.length||0,oldest:e?.snapshot?.candles[0]?.time,loading:!!e?.loading,exhausted:!!e?.exhausted,error:e?.error||''};}
 publish(){for(const listener of this.listeners)listener(this.view());}
 select(context){
  const key=keyOf(context);if(this.current?.key===key)return this.current;clearTimeout(this.timer);
  let entry=this.entries.get(key);if(!entry){entry={key,context:{...context},snapshot:null,loading:false,exhausted:false,error:'',retryAt:0};this.entries.set(key,entry);if(this.entries.size>4)this.entries.delete(this.entries.keys().next().value);}
  this.current=entry;this.publish();return entry;
 }
 update(context,snapshot){
  const e=this.select(context),fresh=mergeChartCandles([],snapshot.candles),old=e.snapshot?.candles||[];
  const gap=old.length&&fresh.length&&fresh[0].time>old.at(-1).time;if(gap){e.exhausted=false;e.error='';}
  e.snapshot={...snapshot,candles:mergeChartCandles(gap?[]:old,fresh)};this.publish();return e.snapshot;
 }
 viewChanged(range){
  clearTimeout(this.timer);const e=this.current;if(!e?.snapshot?.candles.length||e.loading||e.exhausted||this.now()<e.retryAt||!range||!Number.isFinite(range.from)||range.from>40)return;
  this.timer=setTimeout(()=>{if(this.current===e)this.loadOlder();},this.delay);
 }
 async loadOlder({manual=false}={}){
  clearTimeout(this.timer);const e=this.current,rows=e?.snapshot?.candles;if(!rows?.length||e.loading||e.exhausted||(!manual&&this.now()<e.retryAt))return {added:0};
  const before=rows[0].time;e.loading=true;e.error='';this.publish();
  try{
   const q=new URLSearchParams({...e.context,before:String(before),limit:String(CHART_HISTORY_PAGE)}),data=await this.request('/market-data/history?'+q);
   if(data.market!==e.context.market||data.symbol!==e.context.symbol||data.interval!==e.context.interval||!Array.isArray(data.candles))throw Error('과거 봉 응답을 확인해 주세요.');
   if(e.snapshot.candles[0]?.time!==before)return {added:0};
   const previous=e.snapshot.candles,older=mergeChartCandles([],data.candles).filter(c=>c.time<before),candles=mergeChartCandles(older,previous),added=candles.length-previous.length;
   e.exhausted=!!data.exhausted||added===0;if(!added)return {added:0};
   const range=this.current===e?historyRange(this.getRange(),added,manual):null;e.snapshot={...e.snapshot,candles};
   if(this.current===e){this.onChange(e.snapshot,e.context);if(range)this.setRange(range);}return {added};
  }catch(error){e.error=error.message||'과거 봉 조회를 다시 시도해 주세요.';e.retryAt=this.now()+30000;return {added:0,error:e.error};}
  finally{e.loading=false;if(this.current===e)this.publish();}
 }
 deactivate(){clearTimeout(this.timer);this.current=null;this.publish();}
 destroy(){clearTimeout(this.timer);this.listeners.clear();this.current=null;}
}
export function installChartHistoryButton(button,history,{onError=()=>{}}={}){
 if(!button)return;
 const unsubscribe=history.subscribe(v=>{button.disabled=v.loading||v.exhausted||!v.count;button.textContent=v.loading?'불러오는 중…':v.exhausted?'이전 봉 없음':v.error?'조회 재시도':v.count?'이전 봉 · '+v.count.toLocaleString('ko-KR')+'봉':'이전 봉';button.dataset.candleCount=String(v.count);const oldest=v.oldest==null?'':new Date(v.oldest*1000).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});button.title=v.error||'현재 '+v.count.toLocaleString('ko-KR')+'봉'+(oldest?' · '+oldest+'부터 (한국시간)':'')+' · '+(v.exhausted?'거래소의 이전 봉이 없습니다.':'500봉씩 추가 · 차트를 과거로 이동해도 자동 조회');button.setAttribute('aria-busy',String(v.loading));});
 button.addEventListener('click',async()=>{const r=await history.loadOlder({manual:true});if(r.error)onError(r.error);});return unsubscribe;
}
