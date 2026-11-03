import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath,pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { StateStore } from './backend/store.mjs';
import { TradingEngine } from './backend/engine.mjs';
import { MarketData } from './backend/market-data.mjs';
import { CredentialStore } from './backend/credentials.mjs';
import {acquireServerLock} from './backend/app-lifecycle.mjs';
import {checkUpdate} from './backend/app-update.mjs';
const appDirectory=fileURLToPath(new URL('./',import.meta.url));

const root=path.resolve(fileURLToPath(new URL('./public/',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
export async function createServer({dataDirectory=process.env.WORKROOM_DATA_DIR||fileURLToPath(new URL('./.runtime/',import.meta.url)),clientFactory,store,credentialStore=store?null:new CredentialStore(dataDirectory),marketData=new MarketData()}={}){
  const engine=await new TradingEngine(store||new StateStore(dataDirectory),{clientFactory,credentialStore}).init(),token=randomBytes(32).toString('hex');
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':mime['.json']});res.end(JSON.stringify(data));};
    try{
      const port=server.address()?.port,hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
      if(!hosts.has(req.headers.host)){json(403,{error:'로컬 주소로 접속해 주세요.'});return;}
      const url=new URL(req.url,'http://'+req.headers.host),pathname=decodeURIComponent(url.pathname);
      if(pathname==='/health'){if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}json(200,{ok:true,mode:engine.state.environment,trading:engine.tradingEnabled});return;}
      if(pathname.startsWith('/api/')){
        const origin=req.headers.origin;
        if(origin&&!hosts.has(new URL(origin).host)||req.headers['sec-fetch-site']==='cross-site'){json(403,{error:'다른 사이트에서 이 로컬 앱을 조작할 수 없습니다.'});return;}
        if(pathname==='/api/session'&&req.method==='GET'){json(200,{token});return;}
        const supplied=Buffer.from(String(req.headers['x-workroom-token']||'')),expected=Buffer.from(token);
        if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){json(403,{error:'앱 세션을 새로고침해 주세요.'});return;}
        let body={};
        if(['POST','PUT','DELETE'].includes(req.method)){
          if(!String(req.headers['content-type']||'').startsWith('application/json')){json(415,{error:'JSON 요청이 필요합니다.'});return;}
          let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>65536){json(413,{error:'요청이 너무 큽니다.'});return;}}
          body=text?JSON.parse(text):{};
        }
        if(req.method==='GET'&&pathname==='/api/status'){json(200,engine.snapshot());return;}
        if(req.method==='GET'&&pathname==='/api/app/update'){json(200,await checkUpdate(appDirectory));return;}
        if(req.method==='GET'&&pathname==='/api/positions/insights'){json(200,await engine.positionInsights.get());return;}
        if(req.method==='GET'&&pathname==='/api/market-data/catalog'){json(200,await marketData.catalog());return;}
        if(req.method==='GET'&&pathname==='/api/market-data/quote'){json(200,await marketData.quote(url.searchParams.get('market')||'usdm',url.searchParams.get('symbol')||'BTCUSDT',url.searchParams.get('interval')||'15m'));return;}
        if(req.method==='GET'&&pathname==='/api/symbols'){const [symbols,tickers]=await Promise.all([engine.catalog(),engine.client.tickers()]);json(200,{environment:engine.state.environment,asOf:Date.now(),symbols:symbols.map(s=>({symbol:s.symbol,baseAsset:s.baseAsset})),tickers});return;}
        if(req.method==='GET'&&pathname==='/api/market'){json(200,await engine.market(url.searchParams.get('symbol')||'BTCUSDT',url.searchParams.get('interval')||'15m'));return;}
        if(req.method==='GET'&&pathname==='/api/leverage'){json(200,await engine.serial(()=>engine.leverageLimits(url.searchParams.get('symbol'))));return;}
        if(req.method==='GET'&&pathname==='/api/position-import/context'){json(200,await engine.serial(()=>engine.positionImports.context()));return;}
        if(req.method==='POST'&&pathname==='/api/position-import/preview'){json(200,await engine.serial(()=>engine.positionImports.preview(body)));return;}
        if(req.method==='POST'&&pathname==='/api/position-import/commit'){json(200,await engine.serial(()=>engine.positionImports.commit(body.previewId)));return;}
        if(req.method==='GET'&&pathname==='/api/manual/context'){json(200,await engine.serial(()=>engine.manual.context(url.searchParams.get('symbol'),url.searchParams.get('botId')||null)));return;}
        if(req.method==='POST'&&pathname==='/api/manual/preview'){json(200,await engine.serial(()=>engine.manual.preview(body)));return;}
        if(req.method==='POST'&&pathname==='/api/manual/submit'){json(200,await engine.serial(()=>engine.manual.submit(body.planId)));return;}
        const manualCancel=/^\/api\/manual\/orders\/([A-Za-z0-9_-]{1,60})\/cancel$/.exec(pathname),manualStatus=/^\/api\/manual\/requests\/([a-f0-9-]{36})$/.exec(pathname);
        if(req.method==='POST'&&manualCancel){json(200,await engine.serial(()=>engine.manual.cancel(manualCancel[1])));return;}
        if(req.method==='GET'&&manualStatus){json(200,await engine.serial(()=>engine.manual.requestStatus(manualStatus[1])));return;}
        if(req.method==='POST'&&pathname==='/api/connection'){json(200,await engine.connect(body));return;}
        if(req.method==='POST'&&pathname==='/api/connection/reconnect'){json(200,await engine.restoreConnection());return;}
        if(req.method==='DELETE'&&pathname==='/api/connection'){json(200,await engine.disconnect());return;}
        if(req.method==='POST'&&pathname==='/api/trading'){json(200,await engine.setTrading(body.enabled,body.liveAcknowledgement));return;}
        if(req.method==='POST'&&pathname==='/api/bots'){json(200,await engine.saveBot(body));return;}
        const cancelBotOrder=/^\/api\/bots\/([A-Za-z0-9_-]+)\/orders\/([A-Za-z0-9_-]{1,60})\/cancel$/.exec(pathname);
        if(req.method==='POST'&&cancelBotOrder){json(200,await engine.cancelBotOrder(cancelBotOrder[1],cancelBotOrder[2]));return;}
        const match=/^\/api\/bots\/([A-Za-z0-9_-]+)(?:\/(start|pause|close))?$/.exec(pathname);
        if(match){const [,id,action]=match;if(req.method==='POST'&&action){json(200,await engine[({start:'startBot',pause:'pauseBot',close:'closeBot'})[action]](id));return;}if(req.method==='DELETE'&&!action){await engine.removeBot(id);json(200,{ok:true});return;}}
        json(404,{error:'지원하지 않는 요청입니다.'});return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      const filename=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
      const data=await readFile(filename);res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'text/plain; charset=utf-8'});res.end(req.method==='HEAD'?undefined:data);
    }catch(error){if(res.headersSent){res.end();return;}json(error.code==='ENOENT'?404:error.status===429?429:String(req.url).startsWith('/api/')?400:404,{error:engine.client.redact?.(error.message)||'요청을 처리하지 못했습니다.'});}
  });
  server.on('listening',()=>engine.startTimer());server.on('close',()=>engine.stopTimer());return {server,engine};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  let release=async()=>{};
  try{
    const port=Number(process.env.PORT||8896),dataDirectory=process.env.WORKROOM_DATA_DIR||path.join(appDirectory,'.runtime');
    release=await acquireServerLock(appDirectory,dataDirectory,port);
    const {server,engine}=await createServer({dataDirectory});
    server.listen(port,'127.0.0.1',()=>{const url=`http://127.0.0.1:${server.address().port}`;console.log(`Futures Workroom\nLocal: ${url}\nBinance ${engine.state.environment}; ${engine.connected?'saved account reconnected; order execution off.':'account not connected. Check Settings.'}\nCtrl+C to stop.`);if(process.argv.includes('--open')&&process.platform==='win32')execFile('cmd.exe',['/c','start','',url],{windowsHide:true});});
    server.on('error',async error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is in use. Set PORT to another port.`:error.message);await release();process.exitCode=1;});
    let closing=false;const close=async()=>{if(closing)return;closing=true;clearInterval(engine.timer);await engine.serial(async()=>{for(const b of engine.state.bots)b.runtime.runEnabled=false;await engine.checkpoint();});server.close(async()=>{await release();});server.closeIdleConnections();};process.once('SIGINT',close);process.once('SIGTERM',close);
  }catch(error){await release();console.error(error.message);process.exitCode=1;}
}

