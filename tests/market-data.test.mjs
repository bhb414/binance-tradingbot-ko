import test from 'node:test';
import assert from 'node:assert/strict';
import {MarketData,normalizeCandles} from '../backend/market-data.mjs';
import {createServer} from '../server.mjs';
import {emptyState} from '../backend/store.mjs';
const now=1800000000000;
const instrument=(symbol,extra={})=>({symbol,baseAsset:'BTC',quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL',status:'TRADING',filters:[{filterType:'PRICE_FILTER',tickSize:'0.10'}],...extra});
function harness(failed=null){
  const calls=[],fetchImpl=async(url,options)=>{
    const u=new URL(url),market=u.hostname.startsWith('eapi')?'options':u.hostname.startsWith('dapi')?'coinm':u.hostname.startsWith('data-api')?'spot':'usdm',symbol=u.searchParams.get('symbol')||'BTCUSDT';calls.push({url,options,market});
    if(market===failed)throw Error('network unavailable');let data;
    if(u.pathname.endsWith('/exchangeInfo'))data=market==='options'?{optionSymbols:[instrument('BTC-261225-80000-C',{underlying:'BTCUSDT',side:'CALL',expiryDate:now+10000}),instrument('EXPIRED',{expiryDate:now-1})]}:{symbols:market==='usdm'?[instrument('BTCUSDT'),instrument('INTCUSDT',{baseAsset:'INTC',contractType:'TRADIFI_PERPETUAL'}),instrument('CLOSED',{status:'SETTLING'})]:market==='coinm'?[instrument('BTCUSD_PERP',{status:undefined,contractStatus:'TRADING',quoteAsset:'USD',marginAsset:'BTC'})]:[instrument('BTCUSDT',{isSpotTradingAllowed:true,contractType:undefined})]};
    else if(u.pathname.endsWith('/klines'))data=market==='options'?[{openTime:now-60000,open:'10',high:'12',low:'9',close:'11',volume:'1',closeTime:now-1}]:[[now-60000,'100','120','90','110','3',now-1]];
    else if(u.pathname.endsWith('/depth'))data={bids:[['100','2']],asks:[['101','3']]};
    else if(u.pathname.endsWith('/premiumIndex'))data={symbol,markPrice:'110',lastFundingRate:'0.0001'};
    else data=[{symbol,lastPrice:market==='spot'?'200':'110',high:'120',low:'90',highPrice:'120',lowPrice:'90',open:'100',priceChangePercent:'10',quoteVolume:'1000',amount:'1000'}];
    return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  };
  return {service:new MarketData({fetchImpl,now:()=>now}),calls};
}
test('read-only market catalogs retain TradFi, COIN-M, spot and options with independent identities',async()=>{
  const {service,calls}=harness(),catalog=await service.catalog();assert.equal(catalog.errors.length,0);assert.ok(catalog.symbols.some(s=>s.symbol==='INTCUSDT'&&s.contractType==='TRADIFI_PERPETUAL'));assert.ok(catalog.symbols.some(s=>s.id==='spot:BTCUSDT'));assert.ok(catalog.symbols.some(s=>s.id==='usdm:BTCUSDT'));assert.ok(catalog.symbols.some(s=>s.market==='coinm'));assert.ok(catalog.symbols.some(s=>s.market==='options'));assert.ok(!catalog.symbols.some(s=>['EXPIRED','CLOSED'].includes(s.symbol)));
  assert.ok(calls.every(call=>call.options.method==='GET'&&!Object.keys(call.options.headers).some(h=>/api.?key/i.test(h))&&!call.url.includes('signature')));
});
test('charts normalize options object bars and distinguish the same symbol across spot and futures',async()=>{
  const {service}=harness(),spot=await service.quote('spot','BTCUSDT','1h'),future=await service.quote('usdm','BTCUSDT','1h'),option=await service.quote('options','BTC-261225-80000-C','15m');assert.equal(spot.ticker.lastPrice,200);assert.equal(future.ticker.lastPrice,110);assert.equal(spot.premium,null);assert.equal(future.premium.lastFundingRate,.0001);assert.equal(option.candles[0].close,11);assert.ok(Math.abs(option.ticker.priceChangePercent-10)<1e-9);assert.deepEqual(normalizeCandles([[now,'1','2','0.5','1.5','2',now+59999]])[0].close,1.5);
});
test('a failed market is reported without hiding the remaining markets, and invalid requests never become arbitrary fetches',async()=>{
  const {service,calls}=harness('coinm'),catalog=await service.catalog();assert.ok(catalog.errors.some(e=>e.market==='coinm'));assert.ok(catalog.symbols.some(s=>s.symbol==='INTCUSDT'));const before=calls.length;await assert.rejects(()=>service.quote('https://example.com','BTCUSDT','1h'));await assert.rejects(()=>service.quote('usdm','BTCUSDT','unbounded'));await assert.rejects(()=>service.quote('usdm','../../account','1h'));assert.equal(calls.length,before);
});
test('market quote HTTP routes require the local token and only provide read operations',async()=>{
  const state=emptyState(),store={state,async load(){return state;},async save(){}},marketData={async catalog(){return {symbols:[{symbol:'INTCUSDT',market:'usdm'}],errors:[]};},async quote(market,symbol,interval){return {market,symbol,interval,candles:[]};}};
  const {server}=await createServer({store,marketData});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{const base='http://127.0.0.1:'+server.address().port,session=await(await fetch(base+'/api/session')).json();assert.equal((await fetch(base+'/api/market-data/catalog')).status,403);const headers={'X-Workroom-Token':session.token};const result=await(await fetch(base+'/api/market-data/quote?market=usdm&symbol=INTCUSDT&interval=1h',{headers})).json();assert.equal(result.symbol,'INTCUSDT');assert.equal((await fetch(base+'/api/market-data/quote',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,404);}finally{await new Promise(resolve=>server.close(resolve));}
});

test('expanded chart periods pass their exact native interval to public candles',async()=>{const {service,calls}=harness();for(const interval of ['3m','30m','2h','6h','8h','12h','3d','1w','1M']){const q=await service.quote('usdm','BTCUSDT',interval);assert.ok(q.candles.length);assert.ok(calls.some(c=>new URL(c.url).pathname.endsWith('/klines')&&new URL(c.url).searchParams.get('interval')===interval));}});

test('historical pages use only the public candle endpoint, exclude the cursor and share cached requests',async()=>{
 const {service,calls}=harness(),before=now/1000;const [a,b]=await Promise.all([service.history('usdm','BTCUSDT','1m',before),service.history('usdm','BTCUSDT','1m',before)]);assert.deepEqual(a,b);assert.equal(a.candles.length,1);assert.equal(a.exhausted,false);const sent=calls.filter(c=>new URL(c.url).pathname.endsWith('/klines'));assert.equal(sent.length,1);const url=new URL(sent[0].url);assert.equal(url.searchParams.get('endTime'),String(now-1));assert.equal(url.searchParams.get('limit'),'500');assert.ok(calls.every(c=>/exchangeInfo|klines/.test(new URL(c.url).pathname)));await service.history('usdm','BTCUSDT','1m',before);assert.equal(calls.length,2);const end=await service.history('usdm','BTCUSDT','1m',a.candles[0].time);assert.equal(end.candles.length,0);assert.equal(end.exhausted,true);
});
test('history validates cursors and page sizes before any request and separates markets',async()=>{
 const {service,calls}=harness();for(const [market,symbol,interval,before,limit]of [['bad','BTCUSDT','1m',now/1000,500],['usdm','../account','1m',now/1000,500],['usdm','BTCUSDT','bad',now/1000,500],['usdm','BTCUSDT','1m',0,500],['usdm','BTCUSDT','1m',Infinity,500],['usdm','BTCUSDT','1m',now/1000,1001],['usdm','BTCUSDT','1m',now/1000,1.5]])await assert.rejects(()=>service.history(market,symbol,interval,before,limit));assert.equal(calls.length,0);await service.history('spot','BTCUSDT','1h',now/1000);await service.history('usdm','BTCUSDT','1h',now/1000);assert.equal(calls.filter(c=>new URL(c.url).pathname.endsWith('/klines')).length,2);
});
test('historical candle HTTP access requires a local session and preserves exact cursor parameters',async()=>{
 const state=emptyState(),store={state,async load(){return state;},async save(){}},calls=[],marketData={async history(...args){calls.push(args);return {candles:[],exhausted:true};}},app=await createServer({store,marketData});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));try{const base='http://127.0.0.1:'+app.server.address().port,session=await(await fetch(base+'/api/session')).json(),path='/api/market-data/history?market=spot&symbol=BTCUSDT&interval=30m&before=1700000000&limit=500';assert.equal((await fetch(base+path)).status,403);const response=await fetch(base+path,{headers:{'X-Workroom-Token':session.token}});assert.equal(response.status,200);assert.deepEqual(calls,[['spot','BTCUSDT','30m',1700000000,500]]);}finally{await new Promise(resolve=>app.server.close(resolve));}
});
