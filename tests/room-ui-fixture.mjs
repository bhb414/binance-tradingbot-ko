// Read-only visual fixture. It owns no account credentials and cannot send orders.
import {createServer} from '../server.mjs';
import {emptyState} from '../backend/store.mjs';
import {makeBot} from '../public/core.js';
import {upgradeActions} from '../public/actions.js';
const names=['비트 추세','이더 모멘텀','솔 눌림','구름 탐색','새벽 지킴이','파도 타기','라임','별빛'],symbols=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT'];
const stages=process.argv.includes('--stages'),held=stages?7:3,working=stages?7:5,stagePnl=[19,-6,4,-16,.5,2,8];
const bots=names.map((name,index)=>({...upgradeActions(makeBot({id:'scene-'+index,name,symbol:symbols[index%6],budget:500,color:['mint','lavender','amber'][index%3]})),status:index<working?'running':'paused',task:index%2?'position':'watching',used:index<working?125:0,reserved:0,pnl:stages?(stagePnl[index]??0):(index===1?-5.2:index<held?12.4:0),quantity:index<held?1:0,runtime:{runEnabled:index<working,quantity:index<held?1:0,realized:index<held?2:0}}));
const state=emptyState(),store={state,async load(){},async save(){}};
const client={clearCredentials(){},offset:0,redact:value=>String(value),async exchangeInfo(){return {symbols:symbols.map(symbol=>({symbol,baseAsset:symbol.replace('USDT',''),status:'TRADING',quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL'}))};},async tickers(){return symbols.map(symbol=>({symbol,lastPrice:'100',priceChangePercent:'0',quoteVolume:'100000'}));},async book(){return {bids:[['100','1']],asks:[['101','1']]};},async premium(){return {};},async klines(){return [];}};
const marketData={async catalog(){return {symbols:[],errors:[]};},async quote(){throw new Error('맵 화면 검증용');}};
const app=await createServer({store,clientFactory:()=>client,marketData}),snapshot=app.engine.snapshot.bind(app.engine);
const refresh=process.argv.includes('--refresh'),started=Date.now();
app.engine.snapshot=()=>{if(refresh){const phase=Math.floor((Date.now()-started)/3000)%8,bot=bots[0];bot.pnl=bot.runtime.realized+[20,-20,5,-1,0,12,-8,2][phase];bot.quantity=phase===4?0:1;bot.runtime.quantity=bot.quantity;bot.status=phase===5?'paused':'running';bot.task=phase%2?'position':'watching';}return {...snapshot(),bots,error:'맵 화면 검증용 · 가상 캐릭터 · 실제 계좌·주문 없음'};};
app.server.listen(8897,'127.0.0.1',()=>console.log('Read-only room preview: http://127.0.0.1:8897/#bots'));
process.once('SIGINT',()=>app.server.close());

if(process.argv.includes('--roster-probe')){
 const handle=app.server.listeners('request')[0];app.server.removeAllListeners('request');
 const probe="const root=document.querySelector('#office-roster-list');root.dataset.probeUpdates=0;root.dataset.probeAvatarRemovals=0;new MutationObserver(rows=>{root.dataset.probeUpdates=Number(root.dataset.probeUpdates)+1;for(const row of rows)for(const node of row.removedNodes)if(node.nodeType===1&&(node.matches('.office-roster-avatar')||node.querySelector('.office-roster-avatar')))root.dataset.probeAvatarRemovals=Number(root.dataset.probeAvatarRemovals)+1;}).observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','class','aria-label']});";
 app.server.on('request',(req,res)=>{if(req.url==='/__roster_probe.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(probe);return;}if(req.url==='/'||req.url==='/index.html'){const end=res.end;res.end=function(body,...args){return end.call(this,typeof body==='string'||Buffer.isBuffer(body)?body.toString().replace('</body>','<script type="module" src="/__roster_probe.js"></script></body>'):body,...args);};}handle(req,res);});
}
