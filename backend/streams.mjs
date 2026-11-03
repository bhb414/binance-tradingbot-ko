// Shared push subscriptions. REST is used for snapshots, warm-up and bounded recovery.
const unref=timer=>{timer?.unref?.();return timer;};
const finite=(...values)=>values.every(value=>Number.isFinite(Number(value)));
export const DEFAULT_TRANSPORT=Object.freeze({mode:'websocket',restIntervalSeconds:15});
export function transportSettings(value=DEFAULT_TRANSPORT){
 const mode=value?.mode??'websocket',seconds=Number(value?.restIntervalSeconds??15);
 if(!['websocket','rest'].includes(mode)||!Number.isFinite(seconds)||seconds<3||seconds>300||!Number.isInteger(seconds))throw Error('조회 방식과 REST 조회 간격(3~300초)을 확인하세요.');
 return {mode,restIntervalSeconds:seconds};
}
export class MarketStreams{
 constructor({market='usdm',now=Date.now,WebSocketImpl=globalThis.WebSocket}={}){
  this.market=market;this.now=now;this.WS=WebSocketImpl;this.settings={...DEFAULT_TRANSPORT};this.channels=new Map();this.subscriptions=new Map();this.values=new Map();this.histories=new Map();this.counter=0;this.closed=false;
  this.maintenance=unref(setInterval(()=>this.sweep(),10000));
 }
 configure(settings){const next=transportSettings(settings),changed=next.mode!==this.settings.mode;if(JSON.stringify(next)!==JSON.stringify(this.settings))this.budget?.cache.clear();this.settings=next;if(changed){this.values.clear();this.histories.clear();for(const c of this.channels.values())this.disconnect(c);if(next.mode==='websocket')for(const c of this.channels.values())this.connect(c);}}
 endpoint(route){if(this.market==='usdm')return 'wss://fstream.binance.com/'+route+'/stream';if(this.market==='coinm')return 'wss://dstream.binance.com/stream';if(this.market==='spot')return 'wss://data-stream.binance.vision/stream';return null;}
 channel(route){if(this.market!=='usdm')route='market';let c=this.channels.get(route);if(!c){c={route,status:'idle',socket:null,generation:0,attempt:0,sent:new Set(),lastMessageAt:0,retryAt:0};this.channels.set(route,c);}return c;}
 touch(kind,symbol='',interval=''){
  const lower=symbol.toLowerCase(),stream=kind==='allTickers'?'!ticker@arr':lower+(kind==='book'?'@depth10'+(this.market==='spot'?'@100ms':'@500ms'):kind==='premium'?'@markPrice@1s':kind==='candles'?'@kline_'+interval:'@ticker'),route=kind==='book'?'public':'market',c=this.channel(route);
  const key=kind+':'+symbol+':'+interval;let sub=this.subscriptions.get(stream);if(!sub){sub={stream,key,kind,symbol,interval,route:c.route,usedAt:this.now()};this.subscriptions.set(stream,sub);}sub.usedAt=this.now();
  if(this.settings.mode==='websocket'){this.connect(c);this.flushSoon(c);}return {key,c,sub};
 }
 connect(c){
  if(this.closed||this.settings.mode!=='websocket'||!this.WS||c.socket||this.now()<c.retryAt||![...this.subscriptions.values()].some(s=>s.route===c.route))return;
  c.status='connecting';c.generation++;const generation=c.generation;
  try{
   const socket=new this.WS(this.endpoint(c.route));c.socket=socket;
   const current=()=>c.socket===socket&&c.generation===generation;
   c.connectTimer=unref(setTimeout(()=>{if(current()&&c.status==='connecting')socket.close();},15000));
   socket.addEventListener('open',()=>{if(!current())return;clearTimeout(c.connectTimer);c.status='connected';c.attempt=0;c.sent.clear();c.openedAt=this.now();c.lastMessageAt=this.now();this.flushSoon(c);});
   socket.addEventListener('message',event=>{if(!current())return;try{const message=JSON.parse(String(event.data));if(message.code!==undefined){c.status='subscription-error';socket.close();return;}if(message.result!==undefined)return;c.lastMessageAt=this.now();const payload=message.data??message;for(const data of Array.isArray(payload)?payload:[payload])this.ingest(c,data,message.stream);}catch{}});
   socket.addEventListener('error',()=>{if(current()){c.status='reconnecting';socket.close();}});
   socket.addEventListener('close',()=>{if(!current())return;this.lost(c);});
  }catch{this.lost(c);}
 }
 lost(c){clearTimeout(c.connectTimer);clearTimeout(c.flushTimer);c.flushTimer=null;c.socket=null;c.status='reconnecting';c.generation++;c.sent.clear();c.retryAt=this.now()+Math.min(60000,1000*2**Math.min(c.attempt++,6));for(const [key,v] of this.values)if(v.route===c.route)this.values.delete(key);clearTimeout(c.retryTimer);c.retryTimer=unref(setTimeout(()=>this.connect(c),Math.max(1,c.retryAt-this.now())));}
 disconnect(c){clearTimeout(c.connectTimer);clearTimeout(c.retryTimer);clearTimeout(c.flushTimer);c.flushTimer=null;const socket=c.socket;c.socket=null;c.generation++;c.sent.clear();c.status='idle';c.retryAt=0;socket?.close();}
 flushSoon(c){if(c.flushTimer||c.status!=='connected')return;c.flushTimer=unref(setTimeout(()=>{c.flushTimer=null;this.flush(c);},1000));}
 flush(c){
  if(c.status!=='connected'||c.socket?.readyState!==1)return;
  const wanted=new Set([...this.subscriptions.values()].filter(s=>s.route===c.route).map(s=>s.stream)),add=[...wanted].filter(s=>!c.sent.has(s)),remove=[...c.sent].filter(s=>!wanted.has(s));
  try{if(remove.length){c.socket.send(JSON.stringify({method:'UNSUBSCRIBE',params:remove,id:String(++this.counter)}));for(const s of remove)c.sent.delete(s);}if(add.length){if(wanted.size>1000){c.status='subscription-limit';return;}c.socket.send(JSON.stringify({method:'SUBSCRIBE',params:add,id:String(++this.counter)}));for(const s of add)c.sent.add(s);}}catch{c.socket?.close();}
 }
 ingest(c,data,stream){
  if(!data||data.st===2&&this.market==='usdm')return;
  const symbol=data.s||stream?.split('@')[0]?.toUpperCase();if(!symbol)return;
  let key,value;
  if(data.e==='kline'&&data.k){const k=data.k;if(!finite(k.t,k.T,k.o,k.h,k.l,k.c,k.v))return;key='candles:'+symbol+':'+k.i;value={time:Number(k.t)/1000,closeTime:Number(k.T),open:Number(k.o),high:Number(k.h),low:Number(k.l),close:Number(k.c),volume:Number(k.v)};}
  else if(data.e==='markPriceUpdate'&&finite(data.p)){key='premium:'+symbol+':';value={symbol,markPrice:data.p,indexPrice:data.i,lastFundingRate:data.r,nextFundingTime:data.T};}
  else if((data.e==='depthUpdate'||data.lastUpdateId!==undefined)&&Array.isArray(data.b??data.bids)&&Array.isArray(data.a??data.asks)){key='book:'+symbol+':';value={lastUpdateId:data.u??data.lastUpdateId,bids:data.b??data.bids,asks:data.a??data.asks};}
  else if(data.e==='24hrTicker'&&finite(data.c)){key='ticker:'+symbol+':';value={symbol,lastPrice:data.c,priceChangePercent:data.P,highPrice:data.h,lowPrice:data.l,quoteVolume:data.q,volume:data.v,openPrice:data.o};}
  else return;
  const old=this.values.get(key),eventTime=Number(data.E)||this.now();if(old&&eventTime<old.eventTime)return;
  this.values.set(key,{value,eventTime,receivedAt:this.now(),generation:c.generation,route:c.route});
  if(key.startsWith('candles:'))for(const [historyKey,history] of this.histories)if(historyKey.startsWith(key+':'))this.merge(history,value,c.generation);
 }
 merge(history,candle,generation){
  if(history.generation!==generation)return;const last=history.rows.at(-1);if(!last||candle.time<last.time)return;
  if(candle.time>last.time&&candle.time*1000!==last.closeTime+1){history.generation=-1;return;}
  history.rows=(candle.time===last.time?[...history.rows.slice(0,-1),candle]:[...history.rows,candle]).slice(-history.limit);
 }
 fresh(key,c){const value=this.values.get(key);return c.status==='connected'&&value?.generation===c.generation&&this.now()-value.receivedAt<15000?value:null;}
 async read(budget,kind,symbol,load){
  const {key,c}=this.touch(kind,symbol);
  if(this.settings.mode==='websocket'){const hit=this.fresh(key,c);if(hit)return hit.value;}
  return budget.cached('transport-rest:'+key,this.settings.restIntervalSeconds*1000,load);
 }
 async candles(budget,symbol,interval,limit,load){
  const {key,c}=this.touch('candles',symbol,interval),historyKey=key+':'+limit;
  if(this.settings.mode==='websocket'){
   const hit=this.fresh(key,c),history=this.histories.get(historyKey);
   if(hit&&history?.generation===c.generation){this.merge(history,hit.value,c.generation);if(history.generation===c.generation)return history.rows;}
  }
  const generation=c.generation,previous=this.histories.get(historyKey),force=Boolean(previous&&previous.generation!==generation),cacheKey='transport-rest:'+historyKey+':'+generation;
  if(force)budget.cache.delete(cacheKey);
  const rows=await budget.cached(cacheKey,this.settings.restIntervalSeconds*1000,()=>load(force));
  if(this.settings.mode==='websocket'&&generation===c.generation){
   const history={rows:[...rows],limit,generation};this.histories.set(historyKey,history);
   const hit=this.fresh(key,c);if(hit)this.merge(history,hit.value,generation);
   return history.generation===c.generation?history.rows:rows;
  }
  return rows;
 }
 async tickers(budget,load){
  const {c}=this.touch('allTickers'),seed=await budget.cached('transport-tickers',this.settings.mode==='websocket'?300000:Math.max(30000,this.settings.restIntervalSeconds*1000),load);
  if(this.settings.mode!=='websocket')return seed;
  return seed.map(row=>{const hit=this.fresh('ticker:'+row.symbol+':',c);return hit?{...row,...hit.value}:row;});
 }
 sweep(){
  for(const [stream,s] of this.subscriptions)if(this.now()-s.usedAt>120000)this.subscriptions.delete(stream);
  for(const c of this.channels.values()){
   const used=[...this.subscriptions.values()].some(s=>s.route===c.route);
   if(!used){this.disconnect(c);continue;}
   if(c.status==='connected'&&(this.now()-c.lastMessageAt>30000||this.now()-c.openedAt>23*3600000)){c.socket?.close();continue;}
   this.connect(c);this.flushSoon(c);
  }
  if(this.values.size>5000)for(const [key,v]of this.values)if(this.now()-v.receivedAt>180000)this.values.delete(key);
  if(this.histories.size>128)this.histories.delete(this.histories.keys().next().value);
 }
 status(){return {channels:[...this.channels.values()].filter(c=>[...this.subscriptions.values()].some(s=>s.route===c.route)).map(c=>({type:c.route,status:c.status,subscriptions:c.sent.size,lastMessageAt:c.lastMessageAt,retryAt:c.retryAt})),subscriptions:this.subscriptions.size};}
 close(){this.closed=true;clearInterval(this.maintenance);for(const c of this.channels.values())this.disconnect(c);}
}
export function sharedStreams(budget,options={}){
 if(!budget.streams||budget.streams.closed)budget.streams=new MarketStreams(options);
 budget.streams.budget=budget;return budget.streams;
}
