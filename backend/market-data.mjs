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
  constructor({fetchImpl=fetch,now=Date.now}={}){this.fetch=fetchImpl;this.now=now;this.cache=new Map();this.sources=new Map();}
  source(market){if(!Object.hasOwn(SOURCES,market))throw new Error('지원하지 않는 조회 시장입니다.');return SOURCES[market];}
  cached(key,ttl,load){const previous=this.cache.get(key);if(previous?.expires>this.now())return previous.promise;const entry={expires:this.now()+ttl,promise:Promise.resolve().then(load)};this.cache.set(key,entry);entry.promise.catch(()=>{if(this.cache.get(key)===entry)this.cache.delete(key);});return entry.promise;}
  async request(market,endpoint,parameters={}){
    const source=this.source(market),state=this.sources.get(market)||{tail:Promise.resolve(),last:0,blockedUntil:0};this.sources.set(market,state);
    const run=async()=>{
      if(this.now()<state.blockedUntil)throw new Error(source.label+' 공개 시세 호출 제한 대기 중입니다.');
      const wait=state.last+120-this.now();if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));state.last=this.now();
      const query=new URLSearchParams(Object.entries(parameters).filter(([,v])=>v!==undefined).map(([key,value])=>[key,String(value)]));
      let response;try{response=await this.fetch(source.base+source.prefix+endpoint+(query.size?'?'+query:''),{method:'GET',headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000),redirect:'error'});}catch{throw new Error(source.label+' 공개 시세에 연결하지 못했습니다.');}
      if([418,429].includes(response.status))state.blockedUntil=this.now()+Math.max(1,Number(response.headers.get('retry-after'))||60)*1000;
      const data=await response.json();if(!response.ok||Number(data?.code)<0)throw new Error(source.label+': '+String(data?.msg||'시세 조회 실패').slice(0,250));return data;
    };
    const result=state.tail.then(run,run);state.tail=result.catch(()=>{});return result;
  }
  info(market){return this.cached('info:'+market,300000,()=>this.request(market,'/exchangeInfo'));}
  tickers(market){return this.cached('tickers:'+market,30000,()=>this.request(market,market==='options'?'/ticker':'/ticker/24hr'));}
  async instruments(market){const info=await this.info(market);return (info.symbols||info.optionSymbols||[]).filter(row=>(row.status||row.contractStatus)==='TRADING'&&(!row.expiryDate||row.expiryDate>this.now())&&(market!=='spot'||row.isSpotTradingAllowed!==false)).map(row=>normalizeInstrument(market,row));}
  async catalog(){return this.cached('catalog',30000,async()=>{
    const result=await Promise.allSettled(Object.keys(SOURCES).map(async market=>{const [instruments,tickers]=await Promise.all([this.instruments(market),this.tickers(market).catch(()=>[])]),bySymbol=new Map(rows(tickers).map(t=>[t.symbol,t]));return instruments.map(instrument=>{const ticker=normalizeTicker(market,bySymbol.get(instrument.symbol),instrument);return {...instrument,price:ticker.lastPrice,change:ticker.priceChangePercent};});}));
    const markets=Object.keys(SOURCES),symbols=[],errors=[];result.forEach((item,index)=>{if(item.status==='fulfilled')symbols.push(...item.value);else errors.push({market:markets[index],error:item.reason.message});});if(!symbols.length)throw new Error(errors.map(e=>e.error).join(' / '));return {environment:'live',asOf:this.now(),symbols,errors};
  });}
  async quote(market,symbol,interval='15m'){
    this.source(market);if(!['1m','3m','5m','15m','30m','1h','4h','1d'].includes(interval))throw new Error('지원하지 않는 봉 주기입니다.');
    if(typeof symbol!=='string'||symbol.length>80)throw new Error('종목을 확인해 주세요.');
    const instrument=(await this.instruments(market)).find(row=>row.symbol===symbol);if(!instrument)throw new Error('이 시장에서 조회 가능한 종목이 아닙니다.');
    return this.cached('quote:'+market+':'+symbol+':'+interval,2500,async()=>{
      const [rawCandles,book,tickerData,premium]=await Promise.all([
        this.request(market,'/klines',{symbol,interval,limit:1000}),this.request(market,'/depth',{symbol,limit:10}),
        this.request(market,market==='options'?'/ticker':'/ticker/24hr',{symbol}),['usdm','coinm'].includes(market)?this.request(market,'/premiumIndex',{symbol}):Promise.resolve(null)
      ]);
      const ticker=normalizeTicker(market,tickerData,instrument),premiumRow=rows(premium).find(row=>row.symbol===symbol)||rows(premium)[0]||null;
      return {environment:'live',market,instrument,asOf:this.now(),serverNow:this.now(),candles:normalizeCandles(rawCandles),book:{bids:book.bids||[],asks:book.asks||[]},ticker,premium:premiumRow?{markPrice:number(premiumRow.markPrice),lastFundingRate:number(premiumRow.lastFundingRate)}:null};
    });
  }
}
