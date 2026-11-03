// Read-only visual fixture. It owns no account credentials and cannot send orders.
import {createServer} from '../server.mjs';
import {emptyState} from '../backend/store.mjs';
import {makeBot} from '../public/core.js';
import {upgradeActions} from '../public/actions.js';
const names=['비트 추세','이더 모멘텀','솔 눌림','구름 탐색','새벽 지킴이','파도 타기','라임','별빛'],symbols=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT'];
const bots=names.map((name,index)=>({...upgradeActions(makeBot({id:'scene-'+index,name,symbol:symbols[index%6],budget:500,color:['mint','lavender','amber'][index%3]})),status:index<5?'running':'paused',task:index%2?'position':'watching',used:index<5?125:0,reserved:0,pnl:index===1?-5.2:index<3?12.4:0,quantity:index<3?1:0,runtime:{runEnabled:index<5,quantity:index<3?1:0,realized:index<3?2:0}}));
const state=emptyState(),store={state,async load(){},async save(){}};
const client={clearCredentials(){},offset:0,redact:value=>String(value),async exchangeInfo(){return {symbols:symbols.map(symbol=>({symbol,baseAsset:symbol.replace('USDT',''),status:'TRADING',quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL'}))};},async tickers(){return symbols.map(symbol=>({symbol,lastPrice:'100',priceChangePercent:'0',quoteVolume:'100000'}));},async book(){return {bids:[['100','1']],asks:[['101','1']]};},async premium(){return {};},async klines(){return [];}};
const marketData={async catalog(){return {symbols:[],errors:[]};},async quote(){throw new Error('맵 화면 검증용');}};
const app=await createServer({store,clientFactory:()=>client,marketData}),snapshot=app.engine.snapshot.bind(app.engine);
app.engine.snapshot=()=>({...snapshot(),bots,error:'맵 화면 검증용 · 가상 캐릭터 · 실제 계좌·주문 없음'});
app.server.listen(8897,'127.0.0.1',()=>console.log('Read-only room preview: http://127.0.0.1:8897/#bots'));
process.once('SIGINT',()=>app.server.close());
