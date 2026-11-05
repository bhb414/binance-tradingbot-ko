import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
export const DEFAULT_EQUITY_INTERVAL=60;
export function equityInterval(value){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<5||value>86400)throw Error('기록 간격은 5~86,400초 사이의 정수로 입력하세요.');return value;}
const valid=value=>typeof value==='number'&&Number.isFinite(value);
const point=row=>row?{at:row.at,wallet:row.wallet,unrealized:row.unrealized,equity:row.equity,intervalSeconds:row.interval_seconds,gapBefore:Boolean(row.gap_before),...(row.source==='binance-daily'?{source:'binance-daily'}:{})}:null;
export class AccountEquityStore{
 constructor(directory,{now=Date.now}={}){this.filename=directory?path.join(directory,'account-equity.sqlite'):':memory:';this.directory=directory;this.now=now;this.db=null;this.error=null;this.retryAt=0;this.closed=false;this.open();}
 open(){if(this.closed||this.db||this.now()<this.retryAt)return;try{if(this.directory)mkdirSync(this.directory,{recursive:true});this.db=new DatabaseSync(this.filename);this.db.exec('PRAGMA busy_timeout=25; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS equity_accounts(scope TEXT PRIMARY KEY,id TEXT NOT NULL,interval_seconds INTEGER NOT NULL DEFAULT 60,revision INTEGER NOT NULL DEFAULT 0,entries INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS equity_samples(scope TEXT NOT NULL,at INTEGER NOT NULL,wallet REAL NOT NULL,unrealized REAL NOT NULL,equity REAL NOT NULL,interval_seconds INTEGER NOT NULL,gap_before INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,at)); CREATE TABLE IF NOT EXISTS equity_daily_wallet(scope TEXT NOT NULL,at INTEGER NOT NULL,wallet REAL NOT NULL,PRIMARY KEY(scope,at)); CREATE TABLE IF NOT EXISTS equity_history_imports(scope TEXT PRIMARY KEY,attempt_at INTEGER NOT NULL DEFAULT 0,imported_at INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,error TEXT);');this.error=null;this.retryAt=0;}catch(error){this.fault(error);try{this.db?.close();}catch{}this.db=null;}}
 fault(error){this.error='계좌 잔고 기록 저장을 확인해 주세요: '+String(error.message||error).slice(0,180);this.retryAt=this.now()+30000;}
 ready(){this.open();if(!this.db||this.now()<this.retryAt)throw Error(this.error||'계좌 잔고 기록 저장소를 열지 못했습니다.');}
 account(scope){this.ready();if(typeof scope!=='string'||!scope||scope.length>100)throw Error('연결된 계좌를 확인하세요.');this.db.prepare('INSERT OR IGNORE INTO equity_accounts(scope,id) VALUES(?,?)').run(scope,randomUUID());return this.db.prepare('SELECT * FROM equity_accounts WHERE scope=?').get(scope);}
 last(scope){return point(this.db.prepare('SELECT * FROM equity_samples WHERE scope=? ORDER BY at DESC LIMIT 1').get(scope));}
 observe(scope,value,at=this.now()){
  this.ready();if(!Number.isSafeInteger(at)||at<=0||![value?.walletBalance,value?.unrealizedProfit].every(valid))throw Error('관측 시각과 계좌 잔고를 확인하세요.');const equity=value.walletBalance+value.unrealizedProfit;if(!valid(equity))throw Error('평가잔고를 계산하지 못했습니다.');
  const settings=this.account(scope),last=this.last(scope);if(last&&at-last.at<settings.interval_seconds*1000)return false;
  const gap=Boolean(last&&at-last.at>Math.max(settings.interval_seconds,last.intervalSeconds)*1500);
  try{this.db.exec('BEGIN IMMEDIATE');this.db.prepare('INSERT INTO equity_samples VALUES(?,?,?,?,?,?,?)').run(scope,at,value.walletBalance,value.unrealizedProfit,equity,settings.interval_seconds,Number(gap));this.db.prepare('UPDATE equity_accounts SET entries=entries+1 WHERE scope=?').run(scope);this.db.exec('COMMIT');this.error=null;return true;}catch(error){try{this.db.exec('ROLLBACK');}catch{}this.fault(error);throw Error(this.error);}
 }
 configure(scope,{intervalSeconds,revision}){equityInterval(intervalSeconds);const current=this.account(scope);if(revision!==current.revision)throw Object.assign(Error('다른 화면에서 기록 간격이 변경됐습니다. 다시 불러온 뒤 저장하세요.'),{httpStatus:409});if(intervalSeconds===current.interval_seconds)return;this.db.prepare('UPDATE equity_accounts SET interval_seconds=?,revision=revision+1 WHERE scope=?').run(intervalSeconds,scope);}
 history(scope){
  this.account(scope);const status=this.db.prepare('SELECT * FROM equity_history_imports WHERE scope=?').get(scope),daily=this.db.prepare('SELECT COUNT(*) AS count,MIN(at) AS first_at,MAX(at) AS last_at FROM equity_daily_wallet WHERE scope=?').get(scope);
  return {source:'binance-daily',maxDays:30,storedPoints:daily.count,firstAt:daily.first_at,lastAt:daily.last_at,attemptAt:status?.attempt_at||0,importedAt:status?.imported_at||0,retryAt:status?.retry_at||0,error:status?.error||null};
 }
 historyAttempt(scope,at){this.account(scope);this.db.prepare('INSERT INTO equity_history_imports(scope,attempt_at,retry_at) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET attempt_at=excluded.attempt_at,retry_at=excluded.retry_at,error=NULL').run(scope,at,at+60000);}
 historyError(scope,message,retryAt){this.ready();this.db.prepare('UPDATE equity_history_imports SET error=?,retry_at=? WHERE scope=?').run(String(message).slice(0,400),retryAt,scope);}
 importDaily(scope,points,at=this.now()){
  this.account(scope);if(!Array.isArray(points)||points.length>30||!Number.isSafeInteger(at)||points.some(p=>!Number.isSafeInteger(p.at)||p.at<=0||p.at>at||!valid(p.wallet)))throw Error('과거 지갑잔고 기록을 확인하세요.');
  try{this.db.exec('BEGIN IMMEDIATE');const insert=this.db.prepare('INSERT INTO equity_daily_wallet VALUES(?,?,?) ON CONFLICT(scope,at) DO UPDATE SET wallet=excluded.wallet');for(const p of points)insert.run(scope,p.at,p.wallet);this.db.prepare('INSERT INTO equity_history_imports(scope,attempt_at,imported_at,retry_at) VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET imported_at=excluded.imported_at,retry_at=excluded.retry_at,error=NULL').run(scope,at,at,at+6*3600000);this.db.exec('COMMIT');}
  catch(error){try{this.db.exec('ROLLBACK');}catch{}this.fault(error);throw Error(this.error);}
 }
 view(scope,{before=null,limit=1500}={}){
  if(before!==null&&(!Number.isSafeInteger(before)||before<=0)||!Number.isSafeInteger(limit)||limit<1||limit>2500)throw Error('이전 기록 위치와 조회 개수를 확인하세요.');
  const settings=this.account(scope),firstObserved=point(this.db.prepare('SELECT * FROM equity_samples WHERE scope=? ORDER BY at LIMIT 1').get(scope));
  // Only prepend daily wallet snapshots before detailed observation began. Never
  // overwrite measured equity or invent it for a historical day.
  const union="SELECT at,wallet,unrealized,equity,interval_seconds,gap_before,'observed' AS source FROM equity_samples WHERE scope=? UNION ALL SELECT at,wallet,NULL,NULL,86400,0,'binance-daily' FROM equity_daily_wallet WHERE scope=? AND at<?",parameters=[scope,scope,firstObserved?.at??Number.MAX_SAFE_INTEGER];
  const first=point(this.db.prepare('SELECT * FROM ('+union+') ORDER BY at LIMIT 1').get(...parameters)),latest=point(this.db.prepare('SELECT * FROM ('+union+') ORDER BY at DESC LIMIT 1').get(...parameters)),total=this.db.prepare('SELECT COUNT(*) AS count FROM ('+union+')').get(...parameters).count;
  const rows=this.db.prepare('SELECT * FROM ('+union+')'+(before===null?'':' WHERE at<?')+' ORDER BY at DESC LIMIT ?').all(...parameters,...(before===null?[]:[before]),limit),points=rows.reverse().map(point);
  return {collectionId:settings.id,intervalSeconds:settings.interval_seconds,revision:settings.revision,totalPoints:total,first,firstObserved,latest,points,history:this.history(scope),hasMore:Boolean(points.length&&first.at<points[0].at)};
 }
 close(){this.closed=true;try{this.db?.close();}catch{}this.db=null;}
}
export class AccountEquityRecorder{
 constructor(engine,store,{now=()=>engine.now()}={}){this.engine=engine;this.store=store;this.now=now;this.timer=null;this.state='waiting';this.reason='계좌 연결을 기다립니다.';this.historyJob=null;}
 source(){
  const e=this.engine,now=this.now();if(!e.connected||!e.state.scope)return {reason:'계좌 미연결 · 기존 기록만 표시합니다.'};
  if(e.accountScope!==e.state.scope)return {reason:'계좌 연결 변경을 확인하고 있습니다.'};
  const age=now-e.accountAt,rest=e.state.dataTransport?.restIntervalSeconds||15,maxAge=e.client?.userStream?.status==='connected'?120000:Math.max(10000,rest*2000);
  if(!e.accountAt||age<0||age>maxAge)return {reason:'새 계좌 정보를 기다립니다. 미수집 구간은 채워 넣지 않습니다.'};
  if((e.client.accountRevision||0)!==(e.accountRevisionAt||0))return {reason:'체결·입출금 이후 계좌 갱신을 기다립니다.'};
  const account=e.liveAccount();if(!account||![account.walletBalance,account.unrealizedProfit].every(valid))return {reason:'계좌 잔고를 확인하지 못했습니다.'};
  if(e.state.dataTransport?.mode==='websocket'&&age>5000){const streams=e.client.streams,c=streams?.channels.get('market'),positions=(account.positions||[]).filter(p=>(p.marginAsset||'USDT')==='USDT'&&p.quantity);if(positions.some(p=>!c||!streams.fresh('premium:'+p.symbol+':',c)))return {reason:'보유 포지션의 새 마크가격을 기다립니다.'};}
  return {account,at:now,sourceAt:e.accountAt};
 }
 capture(){try{const source=this.source();if(!source.account){this.state='waiting';this.reason=source.reason;return false;}const saved=this.store.observe(this.engine.state.scope,source.account,source.at);this.state='recording';this.reason='설정한 간격으로 계좌 잔고를 기록합니다.';return saved;}catch(error){this.state='error';this.reason=this.store.error||error.message;return false;}}
 start(){this.capture();this.timer=setInterval(()=>this.capture(),1000);this.timer.unref?.();}
 view(query={}){
  const e=this.engine,base={available:Boolean(e.state.scope),connected:e.connected,connectionId:e.connectionId,asOf:this.now(),environment:e.state.environment,currency:'USDT',market:'usdm',current:null,recording:{state:this.state,message:this.reason,error:this.store.error},points:[],first:null,latest:null,totalPoints:0,hasMore:false,intervalSeconds:DEFAULT_EQUITY_INTERVAL,revision:0,collectionId:null};
  const source=this.source();if(source.account)base.current={at:source.at,wallet:source.account.walletBalance,unrealized:source.account.unrealizedProfit,equity:source.account.walletBalance+source.account.unrealizedProfit};
  if(!base.available)return base;
  try{return {...base,...this.store.view(e.state.scope,query)};}catch(error){if(error.message.includes('조회 개수'))throw error;return {...base,recording:{state:'error',message:this.store.error||error.message,error:this.store.error||error.message}};}
 }
 async importHistory(input){
  const e=this.engine,scope=e.state.scope,client=e.client,connectionId=e.connectionId;
  if(!e.connected||!scope||e.accountScope!==scope||input?.connectionId!==connectionId)throw Object.assign(Error('연결된 계좌가 변경됐습니다. 다시 불러온 뒤 시도하세요.'),{httpStatus:409});
  if(e.state.environment!=='live'||typeof client.accountSnapshots!=='function')throw Error('바이낸스 실전 계좌를 연결한 뒤 과거 잔고를 불러오세요.');
  if(this.historyJob){if(this.historyJob.scope!==scope||this.historyJob.client!==client)throw Error('이전 계좌의 과거 조회가 끝난 뒤 다시 시도하세요.');await this.historyJob.promise;return this.view();}
  const previous=this.store.history(scope);if(previous.retryAt>this.now()){if(previous.error)throw Error(previous.error+' · 잠시 후 다시 불러오세요.');return this.view();}
  const job={scope,client};this.historyJob=job;
  job.promise=(async()=>{this.store.historyAttempt(scope,this.now());try{
   const result=await client.accountSnapshots();if(!e.connected||e.state.scope!==scope||e.accountScope!==scope||e.client!==client||e.connectionId!==connectionId)throw Error('과거 조회 중 연결된 계좌가 변경돼 결과를 저장하지 않았습니다.');
   this.store.importDaily(scope,result.points,this.now());
  }catch(error){const message=client.redact?.(error.message)||'바이낸스 과거 잔고를 불러오지 못했습니다.';try{this.store.historyError(scope,message,Math.max(this.now()+60000,Number(error.retryAt)||0));}catch{}throw Error(message);}})();
  try{await job.promise;return this.view();}finally{if(this.historyJob===job)this.historyJob=null;}
 }
 configure(input){if(!this.engine.state.scope)throw Error('계좌를 연결한 뒤 기록 간격을 설정하세요.');if(this.engine.connected&&this.engine.accountScope!==this.engine.state.scope||input?.connectionId!==this.engine.connectionId)throw Object.assign(Error('연결된 계좌가 변경됐습니다. 다시 불러온 뒤 저장하세요.'),{httpStatus:409});this.store.configure(this.engine.state.scope,input);this.capture();return this.view();}
 close(){clearInterval(this.timer);this.store.close();}
}
