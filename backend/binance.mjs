import { createHmac } from 'node:crypto';
import {fetchAccountSnapshots} from './account-snapshots.mjs';
import {sharedBudget,requestWeight,publicTTL,publicKey} from './binance-rate.mjs';
import {candleHistory} from './candle-history.mjs';
import {sharedStreams,transportSettings} from './streams.mjs';
import {UserStream} from './user-stream.mjs';
import {RequestQueue,requestPriority} from './request-queue.mjs';

export const ENDPOINTS=Object.freeze({testnet:'https://demo-fapi.binance.com',live:'https://fapi.binance.com'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class BinanceError extends Error {
  constructor(message,{code,status,uncertain=false,temporary=false,retryAt=0}={}){super(message);this.name='BinanceError';this.code=code;this.status=status;this.uncertain=uncertain;this.temporary=temporary;this.retryAt=retryAt;}
}
export function signParameters(parameters,secret){const query=new URLSearchParams(Object.entries(parameters).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>[k,String(v)])).toString();return query+'&signature='+createHmac('sha256',secret).update(query).digest('hex');}
export class BinanceClient {
  constructor({environment='testnet',apiKey='',secret='',fetchImpl=fetch,minGap=120,now=Date.now}={}){
    if(!Object.hasOwn(ENDPOINTS,environment))throw new Error('지원하지 않는 접속 환경입니다.');
    this.environment=environment;this.base=ENDPOINTS[environment];this.apiKey=apiKey;this.secret=secret;this.fetch=fetchImpl;this.now=now;this.offset=0;this.minGap=minGap;this.tail=Promise.resolve();this.requests=new RequestQueue({now});this.lastRequest=0;this.blockedUntil=0;this.mutationRevision=0;this.cache=new Map();this.rate=sharedBudget(this.base,fetchImpl,now);
  }
  clearCredentials(){this.closeStreams();this.apiKey='';this.secret='';}
  configureDataTransport(settings){this.cache.clear();this.transport=transportSettings(settings);this.rate.pollIntervalMs=this.transport.restIntervalSeconds*1000;if(this.fetch===globalThis.fetch&&this.environment==='live'){this.streams=sharedStreams(this.rate,{now:this.now});this.streams.configure(this.transport);if(this.transport.mode==='websocket'&&this.apiKey){if(!this.userStream||this.userStream.closed)this.userStream=new UserStream(this,{now:this.now});this.userStream.start();}else{this.userStream?.close();this.userStream=null;}}}
  get accountRevision(){return this.mutationRevision+(this.userStream?.revision||0);}
  closeStreams(){this.userStream?.close();this.userStream=null;}
  transportStatus(){return {settings:this.transport||transportSettings(),market:this.streams?.status()||null,account:this.userStream?.view()||{status:this.transport?.mode==='rest'?'rest':'unavailable'}};}
  listenKey(){return this.request('POST','/fapi/v1/listenKey',{},false,true);}
  keepListenKey(){return this.request('PUT','/fapi/v1/listenKey',{},false,true);}
  readMarket(kind,symbol,load){return this.streams?this.streams.read(this.rate,kind,symbol,load):this.transport?this.cached('poll:'+kind+':'+symbol,this.transport.restIntervalSeconds*1000,load):load();}
  redact(message){let text=String(message||'바이낸스 요청 실패');for(const value of [this.apiKey,this.secret])if(value)text=text.split(value).join('[비공개]');return text.slice(0,400);}
  request(method,endpoint,parameters={},signed=false,keyOnly=false,{priority=requestPriority(method,endpoint,parameters)}={}){
    const run=async()=>{
      const wait=this.lastRequest+this.minGap-this.now();if(wait>0)await delay(wait);this.lastRequest=this.now();const weight=requestWeight(endpoint,parameters);this.rate.reserve(weight,{priority:method!=='GET'||signed||keyOnly||Boolean(parameters.symbol)||/\/(time|exchangeInfo)$/.test(endpoint),source:'trading',method,endpoint});
      if(signed&&(!this.apiKey||!this.secret))throw new Error('설정에서 API 키를 먼저 연결해 주세요.');
      const values={...parameters};if(signed){values.recvWindow=5000;values.timestamp=Math.round(this.now()+this.offset);}
      const query=signed?signParameters(values,this.secret):new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])).toString();
      const read=method==='GET',headers={Accept:'application/json'};if(signed||keyOnly)headers['X-MBX-APIKEY']=this.apiKey;if(!read)headers['Content-Type']='application/x-www-form-urlencoded';
      if(!read&&!keyOnly)this.mutationRevision++;
      let response;this.rate.recordSent?.('trading',method,endpoint,weight);
      try{response=await this.fetch(this.base+endpoint+(read&&query?'?'+query:''),{method,headers,...(!read?{body:query}:{}),signal:AbortSignal.timeout(10000),redirect:'error'});}
      catch{throw new BinanceError('바이낸스 응답을 받지 못했습니다. 주문 요청은 접수 여부를 조회합니다.',{uncertain:!read&&!keyOnly,temporary:read||keyOnly,retryAt:this.now()+5000});}
      this.rate.observe(response);
      let data;try{data=await response.json();}catch{throw new BinanceError('바이낸스 응답 형식을 확인할 수 없습니다.',{status:response.status,uncertain:!read&&!keyOnly&&![418,429].includes(response.status),temporary:(read||keyOnly)&&(response.ok||response.status>=500||[418,429].includes(response.status)),retryAt:this.rate.blockedUntil||this.now()+5000});}
      this.rate.observe(response,data);this.blockedUntil=this.rate.blockedUntil;
      if(!response.ok||Number(data?.code)<0)throw new BinanceError(this.redact(data?.msg||`바이낸스 HTTP ${response.status}`),{code:data?.code,status:response.status,temporary:(read||keyOnly)&&response.status>=500,retryAt:this.rate.blockedUntil||this.now()+5000,uncertain:!read&&!keyOnly&&(response.status>=500||[-1006,-1007,-4116].includes(data?.code))});
      return data;
    };
    const send=()=>{const result=this.requests.enqueue(run,{priority,onTiming:timing=>this.rate.usage.timed?.({source:'trading',method,endpoint,...timing})});this.tail=Promise.allSettled([this.tail,result]).then(()=>{});return result;};
    const baseTTL=method==='GET'&&!signed?publicTTL(endpoint,parameters):0,ttl=baseTTL?Math.max(baseTTL,this.rate.pollIntervalMs||0):0;return ttl?this.rate.cached(publicKey(endpoint,parameters),ttl,send):send();
  }
  async cached(key,ttl,load){const hit=this.cache.get(key);if(hit&&hit.expires>this.now())return hit.promise;const entry={expires:this.now()+ttl,promise:Promise.resolve().then(load)};this.cache.set(key,entry);try{return await entry.promise;}catch(e){if(this.cache.get(key)===entry)this.cache.delete(key);throw e;}}
  async syncTime(){const before=this.now(),result=await this.request('GET','/fapi/v1/time');this.offset=Number(result.serverTime)-(before+this.now())/2;return this.now()+this.offset;}
  exchangeInfo(){return this.cached('exchangeInfo',300000,()=>this.request('GET','/fapi/v1/exchangeInfo'));}
  tickers(){const load=()=>this.request('GET','/fapi/v1/ticker/24hr');return this.streams?this.streams.tickers(this.rate,load):this.cached('tickers',Math.max(30000,this.rate.pollIntervalMs||0),load);}
  ticker(symbol){return this.readMarket('ticker',symbol,()=>this.request('GET','/fapi/v1/ticker/24hr',{symbol}));}
  klines(symbol,interval,limit=1000){const load=force=>candleHistory(this.rate,'/fapi/v1/klines:'+symbol+':'+interval,limit,async size=>{const rows=await this.request('GET','/fapi/v1/klines',{symbol,interval,limit:size});return rows.map(r=>({time:Number(r[0])/1000,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closeTime:Number(r[6])}));},{force});return this.streams?this.streams.candles(this.rate,symbol,interval,limit,load):load();}
  book(symbol){return this.readMarket('book',symbol,()=>this.request('GET','/fapi/v1/depth',{symbol,limit:10}));}
  premium(symbol){return this.readMarket('premium',symbol,()=>this.request('GET','/fapi/v1/premiumIndex',{symbol}));}
  account(){return this.request('GET','/fapi/v3/account',{},true);}
  positionMode(){return this.request('GET','/fapi/v1/positionSide/dual',{},true);}
  positions(){return this.request('GET','/fapi/v3/positionRisk',{},true);}
  accountSnapshots(){return fetchAccountSnapshots(this);}
  income(parameters){return this.request('GET','/fapi/v1/income',parameters,true);}
  openOrders(symbol){return this.request('GET','/fapi/v1/openOrders',{symbol},true);}
  openAlgoOrders(symbol){return this.request('GET','/fapi/v1/openAlgoOrders',{symbol},true);}
  symbolConfig(symbol){return this.request('GET','/fapi/v1/symbolConfig',{symbol},true);}
  commissionRate(symbol){return this.cached('commission-rate:'+symbol,300000,()=>this.request('GET','/fapi/v1/commissionRate',{symbol},true));}
  leverageBrackets(symbol){return this.request('GET','/fapi/v1/leverageBracket',{symbol},true);}
  changeMargin(symbol,marginType){return this.request('POST','/fapi/v1/marginType',{symbol,marginType},true);}
  changeLeverage(symbol,leverage){return this.request('POST','/fapi/v1/leverage',{symbol,leverage},true);}
  placeOrder(parameters){return this.request('POST','/fapi/v1/order',parameters,true);}
  queryOrder(symbol,id){return this.request('GET','/fapi/v1/order',{symbol,...(typeof id==='object'?id:{origClientOrderId:id})},true);}
  cancelOrder(symbol,id){return this.request('DELETE','/fapi/v1/order',{symbol,...(typeof id==='object'?id:{origClientOrderId:id})},true);}
  placeAlgo(parameters){return this.request('POST','/fapi/v1/algoOrder',parameters,true);}
  queryAlgo(id){return this.request('GET','/fapi/v1/algoOrder',{clientAlgoId:id},true);}
  cancelAlgo(id){return this.request('DELETE','/fapi/v1/algoOrder',{clientAlgoId:id},true);}
  tradesAfter(symbol,fromId){return this.request('GET','/fapi/v1/userTrades',{symbol,fromId,limit:1000},true);}
  trades(symbol,orderId){return this.request('GET','/fapi/v1/userTrades',{symbol,orderId,limit:1000},true);}
}
