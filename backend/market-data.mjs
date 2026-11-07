import {CHART_INTERVALS} from '../public/chart-timeframes.js';
import {sharedBudget,requestWeight,publicTTL,publicKey} from './binance-rate.mjs';
import {BinanceError} from './binance.mjs';
import {candleHistory} from './candle-history.mjs';
import {sharedStreams,transportSettings} from './streams.mjs';
const SOURCES=Object.freeze({
  usdm:{base:'https://fapi.binance.com',prefix:'/fapi/v1',label:'USDⓈ-M 선물'},
  coinm:{base:'https://dapi.binance.com',prefix:'/dapi/v1',label:'COIN-M 선물'},
  spot:{base:'https://data-api.binance.vision',prefix:'/api/v3',label:'현물'},
  options:{base:'https://eapi.binance.com',prefix:'/eapi/v1',label:'옵션'}
});
const number=value=>value===undefined||value===null||value===''?null:Number.isFinite(Number(value))?Number(value):null;
const rows=value=>Array.isArray(value)?value:value?[value]:[];
export function normalizeInstrument(market,row){
  const option=market==='options',baseAsset=row.baseAsset||(row.underlying?row.underlying.replace(/(USDT|USDC|BTC|ETH)$/,''):row.symbol.split('-')[0]),quoteAsset=row.quoteAsset||(market==='coinm'?'USD':'USDT');
  return {id:market+':'+row.symbol,market,symbol:row.symbol,baseAsset,quoteAsset,marginAsset:row.marginAsset||quoteAsset,contractType:row.contractType||(option?'OPTIONS':'SPOT'),underlyingType:row.underlyingType||null,status:row.status||row.contractStatus,expiryDate:option?row.expiryDate:row.contractType?.includes('PERPETUAL')?null:row.deliveryDate||null,optionSide:row.side||null,strikePrice:option?row.strikePrice:null,tickSize:row.filters?.find(f=>f.filterType==='PRICE_FILTER')?.tickSize||null};
}
export function normalizeCandles(data){return rows(data).map(row=>Array.isArray(row)?{time:Number(row[0])/1000,open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5]),closeTime:Number(row[6])}:{time:Number(row.openTime)/1000,open:Number(row.open),high:Number(row.high),low:Number(row.low),close:Number(row.close),volume:Number(row.volume),closeTime:Number(row.closeTime)}).filter(c=>[c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)).sort((a,b)=>a.time-b.time);}
function normalizeTicker(market,data,instrument){
  const raw=rows(data).find(t=>t.symbol===instrument.symbol)||{},last=number(raw.lastPrice),open=number(raw.openPrice??raw.open);
  return {...raw,symbol:instrument.symbol,lastPrice:last,highPrice:number(raw.highPrice??raw.high),lowPrice:number(raw.lowPrice??raw.low),priceChangePercent:market==='options'?(last!==null&&open>0?(last/open-1)*100:null):number(raw.priceChangePercent),quoteVolume:number(raw.quoteVolume??raw.amount),baseVolume:number(raw.baseVolume??raw.volume),quoteAsset:instrument.quoteAsset};
}
export class MarketData {
  constructor({fetchImpl=fetch,now=Date.now}={}){this.fetch=fetchImpl;this.now=now;this.cache=new Map();this.sources=new Map();this.historyPages=new Map();}
  configureDataTransport(settings){this.transport=transportSettings(settings);this.cache.clear();for(const [market,source]of Object.entries(SOURCES)){const budget=sharedBudget(source.base,this.fetch,this.now);budget.pollIntervalMs=this.transport.restIntervalSeconds*1000;if(this.fetch===globalThis.fetch&&market!=='options')sharedStreams(budget,{market,now:this.now}).configure(this.transport);}}
  stream(market){return sharedBudget(this.source(market).base,this.fetch,this.now).streams;}
  close(){for(const source of Object.values(SOURCES))sharedBudget(source.base,this.fetch,this.now).streams?.close();}
  source(market){if(!Object.hasOwn(SOURCES,market))throw new Error('지원하지 않는 조회 시장입니다.');return SOURCES[market];}
  cached(key,ttl,load){const previous=this.cache.get(key);if(previous?.expires>this.now())return previous.promise;const entry={expires:this.now()+ttl,promise:Promise.resolve().then(load)};this.cache.set(key,entry);entry.promise.catch(()=>{if(this.cache.get(key)===entry)this.cache.delete(key);});return entry.promise;}
  async request(market,endpoint,parameters={}){
    const source=this.source(market),state=this.sources.get(market)||{tail:Promise.resolve(),last:0,blockedUntil:0};this.sources.set(market,state);
    const run=async()=>{
      const budget=sharedBudget(source.base,this.fetch,this.now);
      const wait=state.last+120-this.now();if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));state.last=this.now();const weight=requestWeight(source.prefix+endpoint,parameters);budget.reserve(weight,{source:'market',method:'GET',endpoint:source.prefix+endpoint});
      const query=new URLSearchParams(Object.entries(parameters).filter(([,v])=>v!==undefined).map(([key,value])=>[key,String(value)]));
      let response;budget.recordSent?.('market','GET',source.prefix+endpoint,weight);try{response=await this.fetch(source.base+source.prefix+endpoint+(query.size?'?'+query:''),{method:'GET',headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000),redirect:'error'});}catch{throw new BinanceError(source.label+' 공개 시세에 연결하지 못했습니다.',{temporary:true,retryAt:this.now()+5000});}
      budget.observe(response);let data;try{data=await response.json();}catch{throw new BinanceError(source.label+' 시세 응답 확인 대기',{status:response.status,temporary:true,retryAt:budget.blockedUntil||this.now()+5000});}
      budget.observe(response,data);if(!response.ok||Number(data?.code)<0)throw new BinanceError(source.label+': '+String(data?.msg||'시세 조회 실패').slice(0,250),{code:Number(data?.code),status:response.status,temporary:response.status>=500,retryAt:budget.blockedUntil||this.now()+5000});return data;
    };
    const send=()=>{const result=state.tail.then(run,run);state.tail=result.catch(()=>{});return result;},baseTTL=publicTTL(source.prefix+endpoint,parameters),ttl=baseTTL?Math.max(baseTTL,this.transport?.restIntervalSeconds*1000||0):0;
    return ttl?sharedBudget(source.base,this.fetch,this.now).cached(publicKey(source.prefix+endpoint,parameters),ttl,send):send();
  }
  info(market){return this.cached('info:'+market,300000,()=>this.request(market,'/exchangeInfo'));}
  tickers(market){const load=()=>this.request(market,market==='options'?'/ticker':'/ticker/24hr'),stream=this.stream(market);return stream?stream.tickers(sharedBudget(this.source(market).base,this.fetch,this.now),load):this.cached('tickers:'+market,Math.max(30000,this.transport?.restIntervalSeconds*1000||0),load);}
  async instruments(market){const info=await this.info(market);return (info.symbols||info.optionSymbols||[]).filter(row=>(row.status||row.contractStatus)==='TRADING'&&(!row.expiryDate||row.expiryDate>this.now())&&(market!=='spot'||row.isSpotTradingAllowed!==false)).map(row=>normalizeInstrument(market,row));}
  async catalog(){return this.cached('catalog',30000,async()=>{
    const result=await Promise.allSettled(Object.keys(SOURCES).map(async market=>{const [instruments,tickers]=await Promise.all([this.instruments(market),this.tickers(market).catch(()=>[])]),bySymbol=new Map(rows(tickers).map(t=>[t.symbol,t]));return instruments.map(instrument=>{const ticker=normalizeTicker(market,bySymbol.get(instrument.symbol),instrument);return {...instrument,price:ticker.lastPrice,change:ticker.priceChangePercent};});}));
    const markets=Object.keys(SOURCES),symbols=[],errors=[];result.forEach((item,index)=>{if(item.status==='fulfilled')symbols.push(...item.value);else errors.push({market:markets[index],error:item.reason.message});});if(!symbols.length)throw new Error(errors.map(e=>e.error).join(' / '));return {environment:'live',asOf:this.now(),symbols,errors};
  });}
  async history(market,symbol,interval,before,limit=500){
    this.source(market);
    if(!CHART_INTERVALS.includes(interval)||typeof symbol!=='string'||!/^[A-Z0-9_-]{2,80}$/.test(symbol))throw Error('과거 봉의 종목·주기를 확인해 주세요.');
    if(!Number.isSafeInteger(before)||before<=0||before>Math.ceil(this.now()/1000)+86400||!Number.isInteger(limit)||limit<1||limit>1000)throw Error('과거 봉 조회 시각·개수를 확인해 주세요.');
    const key=[market,symbol,interval,before,limit].join(':'),old=this.historyPages.get(key);if(old?.expires>this.now())return old.promise;
    const entry={expires:this.now()+3600000,promise:Promise.resolve().then(async()=>{
      const instrument=(await this.instruments(market)).find(row=>row.symbol===symbol);if(!instrument)throw Error('이 시장에서 조회 가능한 종목이 아닙니다.');
      const raw=normalizeCandles(await this.request(market,'/klines',{symbol,interval,endTime:before*1000-1,limit})),candles=[...new Map(raw.filter(c=>c.time<before).map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time).slice(-limit);
      return {market,symbol,interval,candles,before,nextBefore:candles[0]?.time??before,exhausted:candles.length===0,asOf:this.now()};
    })};this.historyPages.set(key,entry);entry.promise.catch(()=>{if(this.historyPages.get(key)===entry)this.historyPages.delete(key);});if(this.historyPages.size>64)this.historyPages.delete(this.historyPages.keys().next().value);return entry.promise;
  }
  async quote(market,symbol,interval='15m'){
    this.source(market);if(!CHART_INTERVALS.includes(interval))throw new Error('지원하지 않는 봉 주기입니다.');
    if(typeof symbol!=='string'||symbol.length>80)throw new Error('종목을 확인해 주세요.');
    const instrument=(await this.instruments(market)).find(row=>row.symbol===symbol);if(!instrument)throw new Error('이 시장에서 조회 가능한 종목이 아닙니다.');
    const budget=sharedBudget(this.source(market).base,this.fetch,this.now),stream=this.stream(market),read=(kind,load)=>stream?stream.read(budget,kind,symbol,load):load(),candles=force=>candleHistory(budget,this.source(market).prefix+'/klines:'+symbol+':'+interval,1000,async limit=>normalizeCandles(await this.request(market,'/klines',{symbol,interval,limit})),{force});
    return this.cached('quote:'+market+':'+symbol+':'+interval,this.transport?.mode==='rest'?this.transport.restIntervalSeconds*1000:1000,async()=>{
      const [rawCandles,book,tickerData,premium]=await Promise.all([
        stream?stream.candles(budget,symbol,interval,1000,candles):candles(),read('book',()=>this.request(market,'/depth',{symbol,limit:10})),
        read('ticker',()=>this.request(market,market==='options'?'/ticker':'/ticker/24hr',{symbol})),['usdm','coinm'].includes(market)?read('premium',()=>this.request(market,'/premiumIndex',{symbol})):Promise.resolve(null)
      ]);
      const ticker=normalizeTicker(market,tickerData,instrument),premiumRow=rows(premium).find(row=>row.symbol===symbol)||rows(premium)[0]||null;
      return {environment:'live',market,instrument,asOf:this.now(),serverNow:this.now(),candles:rawCandles,book:{bids:book.bids||[],asks:book.asks||[]},ticker,premium:premiumRow?{markPrice:number(premiumRow.markPrice),lastFundingRate:number(premiumRow.lastFundingRate)}:null};
    });
  }
}
