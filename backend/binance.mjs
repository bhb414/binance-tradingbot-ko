import { createHmac } from 'node:crypto';

export const ENDPOINTS=Object.freeze({testnet:'https://demo-fapi.binance.com',live:'https://fapi.binance.com'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class BinanceError extends Error {
  constructor(message,{code,status,uncertain=false}={}){super(message);this.name='BinanceError';this.code=code;this.status=status;this.uncertain=uncertain;}
}
export function signParameters(parameters,secret){const query=new URLSearchParams(Object.entries(parameters).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>[k,String(v)])).toString();return query+'&signature='+createHmac('sha256',secret).update(query).digest('hex');}
export class BinanceClient {
  constructor({environment='testnet',apiKey='',secret='',fetchImpl=fetch,minGap=120,now=Date.now}={}){
    if(!Object.hasOwn(ENDPOINTS,environment))throw new Error('지원하지 않는 접속 환경입니다.');
    this.environment=environment;this.base=ENDPOINTS[environment];this.apiKey=apiKey;this.secret=secret;this.fetch=fetchImpl;this.now=now;this.offset=0;this.minGap=minGap;this.tail=Promise.resolve();this.lastRequest=0;this.blockedUntil=0;this.cache=new Map();
  }
  clearCredentials(){this.apiKey='';this.secret='';}
  redact(message){let text=String(message||'바이낸스 요청 실패');for(const value of [this.apiKey,this.secret])if(value)text=text.split(value).join('[비공개]');return text.slice(0,400);}
  request(method,endpoint,parameters={},signed=false){
    const run=async()=>{
      if(this.now()<this.blockedUntil)throw new BinanceError('바이낸스 호출 제한 대기 중입니다.',{status:429});
      const wait=this.lastRequest+this.minGap-this.now();if(wait>0)await delay(wait);this.lastRequest=this.now();
      if(signed&&(!this.apiKey||!this.secret))throw new Error('설정에서 API 키를 먼저 연결해 주세요.');
      const values={...parameters};if(signed){values.recvWindow=5000;values.timestamp=Math.round(this.now()+this.offset);}
      const query=signed?signParameters(values,this.secret):new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])).toString();
      const read=method==='GET',headers={Accept:'application/json'};if(signed)headers['X-MBX-APIKEY']=this.apiKey;if(!read)headers['Content-Type']='application/x-www-form-urlencoded';
      let response;
      try{response=await this.fetch(this.base+endpoint+(read&&query?'?'+query:''),{method,headers,...(!read?{body:query}:{}),signal:AbortSignal.timeout(10000),redirect:'error'});}
      catch{throw new BinanceError('바이낸스 응답을 받지 못했습니다. 주문 요청은 접수 여부를 조회합니다.',{uncertain:!read});}
      let data;try{data=await response.json();}catch{throw new BinanceError('바이낸스 응답 형식을 확인할 수 없습니다.',{status:response.status,uncertain:!read});}
      if(response.status===429||response.status===418){const retry=Math.max(1,Number(response.headers.get('retry-after'))||60);this.blockedUntil=this.now()+retry*1000;}
      if(!response.ok||Number(data?.code)<0)throw new BinanceError(this.redact(data?.msg||`바이낸스 HTTP ${response.status}`),{code:data?.code,status:response.status,uncertain:!read&&(response.status>=500||[-1006,-1007,-4116].includes(data?.code))});
      return data;
    };
    const result=this.tail.then(run,run);this.tail=result.catch(()=>{});return result;
  }
  async cached(key,ttl,load){const hit=this.cache.get(key);if(hit&&hit.expires>this.now())return hit.promise;const entry={expires:this.now()+ttl,promise:Promise.resolve().then(load)};this.cache.set(key,entry);try{return await entry.promise;}catch(e){if(this.cache.get(key)===entry)this.cache.delete(key);throw e;}}
  async syncTime(){const before=this.now(),result=await this.request('GET','/fapi/v1/time');this.offset=Number(result.serverTime)-(before+this.now())/2;return this.now()+this.offset;}
  exchangeInfo(){return this.cached('exchangeInfo',300000,()=>this.request('GET','/fapi/v1/exchangeInfo'));}
  tickers(){return this.cached('tickers',8000,()=>this.request('GET','/fapi/v1/ticker/24hr'));}
  klines(symbol,interval,limit=1000){return this.cached(`klines:${symbol}:${interval}:${limit}`,2500,async()=>{const rows=await this.request('GET','/fapi/v1/klines',{symbol,interval,limit});return rows.map(r=>({time:Number(r[0])/1000,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closeTime:Number(r[6])}));});}
  book(symbol){return this.cached('book:'+symbol,1500,()=>this.request('GET','/fapi/v1/depth',{symbol,limit:10}));}
  premium(symbol){return this.cached('premium:'+symbol,2500,()=>this.request('GET','/fapi/v1/premiumIndex',{symbol}));}
  account(){return this.request('GET','/fapi/v3/account',{},true);}
  positionMode(){return this.request('GET','/fapi/v1/positionSide/dual',{},true);}
  positions(){return this.request('GET','/fapi/v3/positionRisk',{},true);}
  income(parameters){return this.request('GET','/fapi/v1/income',parameters,true);}
  openOrders(symbol){return this.request('GET','/fapi/v1/openOrders',{symbol},true);}
  openAlgoOrders(symbol){return this.request('GET','/fapi/v1/openAlgoOrders',{symbol},true);}
  symbolConfig(symbol){return this.request('GET','/fapi/v1/symbolConfig',{symbol},true);}
  leverageBrackets(symbol){return this.request('GET','/fapi/v1/leverageBracket',{symbol},true);}
  changeMargin(symbol,marginType){return this.request('POST','/fapi/v1/marginType',{symbol,marginType},true);}
  changeLeverage(symbol,leverage){return this.request('POST','/fapi/v1/leverage',{symbol,leverage},true);}
  placeOrder(parameters){return this.request('POST','/fapi/v1/order',parameters,true);}
  queryOrder(symbol,id){return this.request('GET','/fapi/v1/order',{symbol,...(typeof id==='object'?id:{origClientOrderId:id})},true);}
  cancelOrder(symbol,id){return this.request('DELETE','/fapi/v1/order',{symbol,origClientOrderId:id},true);}
  placeAlgo(parameters){return this.request('POST','/fapi/v1/algoOrder',parameters,true);}
  queryAlgo(id){return this.request('GET','/fapi/v1/algoOrder',{clientAlgoId:id},true);}
  cancelAlgo(id){return this.request('DELETE','/fapi/v1/algoOrder',{clientAlgoId:id},true);}
  trades(symbol,orderId){return this.request('GET','/fapi/v1/userTrades',{symbol,orderId,limit:1000},true);}
}
