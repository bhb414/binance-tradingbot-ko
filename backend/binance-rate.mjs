const states=new WeakMap();
export const isRateLimited=error=>!error?.uncertain&&([418,429].includes(error?.status)||[-1003,-1015].includes(error?.code));
export const isTemporary=error=>!error?.uncertain&&(isRateLimited(error)||error?.temporary===true);
export class RateLimitError extends Error{
  constructor(retryAt,message='바이낸스 호출 제한 대기 · 제한 해제 후 자동 재개합니다.'){super(message);this.name='RateLimitError';this.status=429;this.retryAt=retryAt;this.temporary=true;this.uncertain=false;}
}
// Endpoint weight estimates plus observed IP usage, shared by chart and trading clients.
export function requestWeight(endpoint,p={}){
  if(endpoint.startsWith('/api/v3/')){if(endpoint.endsWith('/exchangeInfo'))return 20;if(endpoint.endsWith('/depth'))return 5;if(endpoint.endsWith('/klines'))return 2;if(endpoint.endsWith('/ticker/24hr'))return p.symbol?2:80;}
  if(endpoint.endsWith('/ticker/24hr'))return p.symbol?1:40;
  if(endpoint.endsWith('/openOrders')||endpoint.endsWith('/openAlgoOrders'))return p.symbol?1:40;
  if(endpoint.endsWith('/klines')){const n=Number(p.limit||500);return n<100?1:n<500?2:n<=1000?5:10;}
  if(endpoint.endsWith('/depth'))return Number(p.limit||100)<=50?2:Number(p.limit)<=100?5:Number(p.limit)<=500?10:20;
  if(endpoint.endsWith('/account')||endpoint.endsWith('/positionRisk'))return 5;
  if(endpoint.endsWith('/income')||endpoint.endsWith('/positionSide/dual'))return 30;
  if(endpoint.endsWith('/symbolConfig')||endpoint.endsWith('/userTrades'))return 5;
  if(endpoint.endsWith('/premiumIndex'))return p.symbol?1:10;
  if(endpoint.endsWith('/ticker'))return p.symbol?5:40;
  return 1;
}
export function publicTTL(endpoint,p={}){
  if(endpoint.endsWith('/exchangeInfo'))return 300000;
  if(endpoint.endsWith('/ticker/24hr')||endpoint.endsWith('/ticker'))return p.symbol?2500:30000;
  if(endpoint.endsWith('/depth'))return 1500;
  if(endpoint.endsWith('/premiumIndex'))return 2500;
  return 0;
}
export const publicKey=(endpoint,p={})=>'public:'+endpoint+'?'+new URLSearchParams(Object.entries(p).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,String(v)]));
export class RequestBudget{
  constructor({now=Date.now,limit=2400}={}){this.now=now;this.limit=limit;this.blockedUntil=0;this.minute=-1;this.used=0;this.cache=new Map();this.histories=new Map();}
  roll(){const minute=Math.floor(this.now()/60000);if(this.minute!==minute){this.minute=minute;this.used=0;}}
  reserve(weight,{priority=false}={}){this.roll();if(this.now()<this.blockedUntil)throw new RateLimitError(this.blockedUntil);const ceiling=Math.floor(this.limit*(priority ? 0.95 : 0.75));if(this.used+weight>ceiling)throw new RateLimitError((this.minute+1)*60000+1000,'바이낸스 요청량 조절 대기 · 자동 재개합니다.');this.used+=weight;}
  observe(response,data){
    this.roll();const value=response.headers?.get('x-mbx-used-weight-1m');if(value!==null&&value!==undefined&&Number.isFinite(Number(value)))this.used=Math.max(this.used,Number(value));
    const limit=data?.rateLimits?.find(r=>r.rateLimitType==='REQUEST_WEIGHT'&&r.interval==='MINUTE'&&r.intervalNum===1)?.limit;if(Number(limit)>0)this.limit=Math.min(this.limit,Number(limit));
    if([418,429].includes(response.status)||[-1003,-1015].includes(Number(data?.code))){
      const retry=response.headers?.get('retry-after'),seconds=Number(retry),date=Date.parse(retry),ban=Number(String(data?.msg||'').match(/banned until\s+(\d{13})/i)?.[1]);
      const until=retry&&Number.isFinite(seconds)?this.now()+Math.max(1,seconds)*1000:Number.isFinite(date)?date:this.now()+(response.status===418?120000:60000);
      this.blockedUntil=Math.max(this.blockedUntil,until,ban||0);
    }
  }
  cached(key,ttl,load){
    const previous=this.cache.get(key);if(previous&&previous.expires>this.now())return previous.promise;
    const entry={expires:Infinity,promise:Promise.resolve().then(load)};this.cache.set(key,entry);
    entry.promise.then(()=>{entry.expires=this.now()+ttl;},()=>{if(this.cache.get(key)===entry)this.cache.delete(key);});
    if(this.cache.size>512)for(const [k,v] of this.cache)if(v.expires<=this.now())this.cache.delete(k);
    return entry.promise;
  }
  snapshot(){this.roll();return {usedWeight:this.used,weightLimit:this.limit,blockedUntil:this.blockedUntil};}
}
export function sharedBudget(base,fetchImpl=fetch,now=Date.now){
  let clocks=states.get(fetchImpl);if(!clocks){clocks=new WeakMap();states.set(fetchImpl,clocks);}let hosts=clocks.get(now);if(!hosts){hosts=new Map();clocks.set(now,hosts);}
  const host=new URL(base).host;if(!hosts.has(host))hosts.set(host,new RequestBudget({now}));return hosts.get(host);
}
