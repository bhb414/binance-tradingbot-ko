import { createHash, randomUUID } from 'node:crypto';
import { BinanceClient } from './binance.mjs';
import {isTemporary,isRateLimited} from './binance-rate.mjs';
import { ManualTrading } from './manual-trading.mjs';
import {PositionImports} from './position-import.mjs';
import {accountView} from './account-view.mjs';
import {PositionInsights} from './position-insights.mjs';
import { entryOrder, exitOrder, protectiveOrders, quantize, symbolFilters } from './orders.mjs';
import { makeBot, validateBot, positionMargin, effectiveBudget } from '../public/core.js';
import { upgradeBot } from '../public/formula.js';
import {ruleIntervals,evaluateRuleFormula} from '../public/formula-runtime.js';
import {FORMULA_TIMEFRAMES} from '../public/formula.js';
import {normalizeBrackets,leverageCap,MAX_LEVERAGE} from '../public/leverage.js';
import { ACTIONS, isEntry, isStop, actionDirection, upgradeActions } from '../public/actions.js';
import {protectionEnabled,hasProtection} from '../public/protection.js';

const TERMINAL=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const active=o=>!TERMINAL.has(o.status);
const initialRuntime=()=>({runEnabled:false,importPending:false,quantity:0,entryPrice:0,entries:0,realized:0,lastSignal:null,lastBar:null,lastEntryAt:0,lastExitAt:0,lastEvaluation:null,error:null,waiting:null,guardKey:null,mismatchSince:0,syncHold:false,direction:null,ruleSignals:{},positionEpoch:0});
const number=value=>Number(value||0);

export class TradingEngine {
  constructor(store,{clientFactory=options=>new BinanceClient(options),now=Date.now,credentialStore=null}={}){
    this.store=store;this.clientFactory=clientFactory;this.now=now;this.client=null;this.connected=false;this.tradingEnabled=false;this.hedge=false;this.accountSnapshot=null;this.accountAt=0;this.connectionError=null;this.waiting=null;this.writeError=null;this.queue=Promise.resolve();this.timer=null;this.lastTimeSync=0;this.lastTick=0;
    this.credentialStore=credentialStore;this.credentialError=null;this.reconnectAt=0;
    this.manual=new ManualTrading(this);
    this.positionImports=new PositionImports(this);this.positionInsights=new PositionInsights(this);this.connectionId=null;
  }
  get state(){return this.store.state;}
  serial(callback){const result=this.queue.then(callback,callback);this.queue=result.catch(()=>{});return result;}
  async init(){await this.store.load();this.client=this.clientFactory({environment:this.state.environment});for(let i=0;i<this.state.bots.length;i++){const old=this.state.bots[i],b=upgradeActions(upgradeBot(old));b.runtime={...initialRuntime(),...old.runtime,runEnabled:false,waiting:null};if(!b.runtime.direction&&(b.runtime.quantity>0||this.state.orders.some(o=>o.botId===b.id&&o.role==='entry'&&active(o))))b.runtime.direction=old.direction||'LONG';delete b.direction;this.state.bots[i]=b;}this.manual.recoverInterrupted();await this.checkpoint();await this.restoreConnection();return this;}
  startTimer(){this.timer=setInterval(()=>{if(this.timerBusy)return;this.timerBusy=true;(async()=>{if(!this.connected&&this.reconnectAt&&this.now()>=this.reconnectAt)await this.restoreConnection();await this.tick();})().catch(error=>{this.connectionError=this.client.redact?.(error.message)||error.message;}).finally(()=>{this.timerBusy=false;});},3000);this.timer.unref?.();}
  async stopTimer(){clearInterval(this.timer);await this.queue;}
  note(title,message,botId=null,level='info'){const last=this.state.logs[0];if(last?.message===message&&this.now()-last.at<30000)return;this.state.logs.unshift({id:randomUUID(),at:this.now(),title,message,botId,level});this.state.logs=this.state.logs.slice(0,1000);}
  async checkpoint(){try{await this.store.save();}catch{this.writeError='주문 원장을 저장하지 못했습니다. 새 주문을 중단했습니다.';this.tradingEnabled=false;throw new Error(this.writeError);}}
  hasExposure(){return this.state.bots.some(b=>b.runtime?.quantity>0)||this.state.orders.some(active);}
  async catalog(){const data=await this.client.exchangeInfo();return data.symbols.filter(s=>s.status==='TRADING'&&s.quoteAsset==='USDT'&&s.marginAsset==='USDT'&&['PERPETUAL','TRADIFI_PERPETUAL'].includes(s.contractType));}
  async symbolInfo(symbol){const item=(await this.catalog()).find(s=>s.symbol===symbol);if(!item)throw new Error('거래 가능한 USDT 무기한 선물 종목이 아닙니다.');return item;}
  async market(symbol,interval){
    await this.symbolInfo(symbol);
    if(!FORMULA_TIMEFRAMES.includes(interval))throw new Error('지원하지 않는 봉 주기입니다.');
    const [candles,book,premium,ticker]=await Promise.all([this.client.klines(symbol,interval),this.client.book(symbol),this.client.premium(symbol),this.symbolTicker(symbol)]);
    if(!ticker)throw new Error('종목 시세를 확인할 수 없습니다.');
    return {environment:this.state.environment,asOf:this.now(),serverNow:this.now()+this.client.offset,candles,book,premium,ticker};
  }
  async symbolTicker(symbol){return this.client.ticker?this.client.ticker(symbol):(await this.client.tickers()).find(t=>t.symbol===symbol);}
  defer(error){
    const kind=isRateLimited(error)?'rate-limit':'connection',message=kind==='rate-limit'?'호출 제한 대기 · 제한 해제 후 자동 재개':'시세·계좌 조회 대기 · 연결 회복 후 자동 재개';
    const retryAt=Math.max(this.now()+1000,Number(error.retryAt)||this.now()+(kind==='rate-limit'?60000:5000));
    if(!this.waiting||this.waiting.kind!==kind)this.note('자동 재개 대기',message);
    this.waiting={kind,message,retryAt};for(const b of this.state.bots)if(b.runtime.runEnabled||b.runtime.quantity||this.ownOrders(b).some(active))b.runtime.waiting={...this.waiting};
  }
  async leverageLimits(symbol){
    await this.symbolInfo(symbol);
    if(!this.connected)return {symbol,environment:this.state.environment,available:false,reason:'계좌 연결 후 종목별 레버리지 한도를 조회합니다.'};
    const response=await this.client.leverageBrackets(symbol);
    return {symbol,environment:this.state.environment,available:true,...normalizeBrackets(response,symbol)};
  }
  async formulaMarkets(symbol,source,cache=new Map()){
    const intervals=ruleIntervals(source);
    return Object.fromEntries(await Promise.all((intervals.length?intervals:['1m']).map(async interval=>[interval,await (cache.get(interval)||cache.set(interval,this.market(symbol,interval)).get(interval))])));
  }
  async restoreConnection(){return this.serial(async()=>{
    if(this.connected||!this.credentialStore)return this.snapshot();
    this.reconnectAt=0;let credentials;
    try{credentials=await this.credentialStore.load();this.credentialError=null;}
    catch(error){this.credentialError=error.message;return this.snapshot();}
    if(!credentials)return this.snapshot();
    try{return await this.connectAccount(credentials,{restoring:true});}
    catch{this.connectionError='저장된 키로 연결하지 못했습니다. 네트워크·API 권한·IP 제한을 확인해 주세요. 30초 후 다시 시도합니다.';this.reconnectAt=this.now()+30000;return this.snapshot();}
  });}
  async connect(input){return this.serial(()=>this.connectAccount(input));}
  async connectAccount({environment,apiKey,secret,allowTrading},{restoring=false}={}){
    if(!['testnet','live'].includes(environment))throw new Error('접속 환경을 확인해 주세요.');
    if(typeof apiKey!=='string'||typeof secret!=='string'||apiKey.length<16||secret.length<16||apiKey.length>512||secret.length>512)throw new Error('API Key와 HMAC Secret을 입력해 주세요.');
    apiKey=apiKey.trim();secret=secret.trim();if(apiKey.length<16||secret.length<16)throw new Error('API Key와 HMAC Secret을 입력해 주세요.');
    if(allowTrading!==undefined&&typeof allowTrading!=='boolean')throw new Error('주문 허용은 켜짐 또는 꺼짐으로 지정해 주세요.');
    const scope=environment+':'+createHash('sha256').update(apiKey).digest('hex').slice(0,32);
    if(restoring||allowTrading===undefined)allowTrading=this.state.orderPermission?.scope===scope&&this.state.orderPermission.enabled===true;
    if(this.hasExposure()&&scope!==this.state.scope)throw new Error('기존 계좌의 포지션·미해결 주문이 남아 있습니다. 동일한 계좌 키로 먼저 연결해 주세요.');
    const candidate=this.clientFactory({environment,apiKey:apiKey.trim(),secret:secret.trim()});
    let account,positions,mode,orders;
    try{
      await candidate.syncTime();[account,positions,mode,orders]=await Promise.all([candidate.account(),candidate.positions(),candidate.positionMode(),candidate.openOrders()]);
      if(this.credentialStore&&!restoring){try{await this.credentialStore.save({environment,apiKey,secret});}catch(error){this.credentialError=error.message;throw error;}}
    }catch(error){const message=candidate.redact?.(error.message)||'계좌 연결을 확인하지 못했습니다.';candidate.clearCredentials();throw new Error(message);}
    const previous=this.client;this.client=candidate;previous?.clearCredentials();this.connected=true;this.connectionId=randomUUID();this.hedge=Boolean(mode.dualSidePosition);this.tradingEnabled=allowTrading===true&&account.canTrade!==false;this.connectionError=null;this.writeError=null;
    if(this.state.scope&&this.state.scope!==scope){for(const b of this.state.bots)b.runtime=initialRuntime();}
    for(const b of this.state.bots)b.runtime.runEnabled=false;
    this.state.scope=scope;this.state.environment=environment;this.state.orderPermission={scope,enabled:this.tradingEnabled};this.accountSnapshot=this.normalizeAccount(account,positions,orders);this.accountAt=this.now();this.lastTimeSync=this.now();
    this.credentialError=null;this.reconnectAt=0;
    this.note('계좌 연결',`${environment==='live'?'실전':'테스트넷'} 계좌 연결 · ${this.hedge?'헤지':'단방향'} 모드 · ${this.tradingEnabled?'주문 허용':'조회 전용'}. 봇 신규 진입은 일시정지 상태입니다.`);
    await this.checkpoint();return this.snapshot();
  }
  async disconnect(){return this.serial(async()=>{if(this.hasExposure())throw new Error('봇 포지션 또는 미해결 주문이 남아 있어 연결을 해제할 수 없습니다. 먼저 주문과 포지션을 정리해 주세요.');await this.credentialStore?.clear();this.credentialError=null;this.reconnectAt=0;for(const b of this.state.bots)b.runtime.runEnabled=false;this.client.clearCredentials();this.client=this.clientFactory({environment:this.state.environment});this.connected=false;this.tradingEnabled=false;this.state.orderPermission=null;this.accountSnapshot=null;this.connectionError=null;this.note('연결 해제','계좌 연결을 해제하고 저장된 키와 메모리의 키를 제거했습니다.');await this.checkpoint();return this.snapshot();});}
  async setTrading(enabled){return this.serial(async()=>{
    if(typeof enabled!=='boolean')throw new Error('주문 허용은 켜짐 또는 꺼짐으로 지정해 주세요.');
    if(enabled&&!this.connected)throw new Error('계좌를 먼저 연결해 주세요.');
    if(enabled&&this.writeError)throw new Error(this.writeError);
    if(this.tradingEnabled===enabled&&this.state.orderPermission?.scope===this.state.scope&&this.state.orderPermission.enabled===enabled)return this.snapshot();
    if(enabled){await this.refreshAccount(true);if(!this.accountSnapshot.canTrade)throw new Error('이 API 키에는 선물 거래 권한이 없습니다.');}
    this.tradingEnabled=enabled;this.state.orderPermission={scope:this.state.scope,enabled};
    if(!enabled)for(const b of this.state.bots)b.runtime.runEnabled=false;
    this.note('주문 권한 변경',enabled?'주문 실행을 허용하고 설정을 저장했습니다. 봇 시작은 개별 선택합니다.':'주문 실행을 끄고 설정을 저장했습니다. 기존 포지션·미체결 주문은 유지됩니다.');
    await this.checkpoint();return this.snapshot();
  });}
  normalizeAccount(account,positions,orders){return accountView(account,positions,orders,this.hedge);}
  async refreshAccount(force=false){if(!this.connected)return null;if(!force&&this.now()-this.accountAt<4500)return this.accountSnapshot;const [account,positions,orders]=await Promise.all([this.client.account(),this.client.positions(),this.client.openOrders()]);this.accountSnapshot=this.normalizeAccount(account,positions,orders);this.accountAt=this.now();return this.accountSnapshot;}
  ownOrders(b){return this.state.orders.filter(o=>o.botId===b.id&&o.scope===this.state.scope);}
  decorate(b){const r=b.runtime,info=r.quantity>0?this.accountSnapshot?.positions.find(p=>p.symbol===b.symbol&&(this.hedge?p.positionSide===r.direction:true)):null;const used=info?positionMargin(info,b.leverage,b.margin):r.quantity*r.entryPrice/b.leverage;const reserved=this.ownOrders(b).filter(o=>active(o)&&o.role==='entry').reduce((sum,o)=>sum+o.margin*Math.max(0,1-number(o.appliedQty)/number(o.parameters.quantity)),0);const fees=this.state.fills.filter(f=>f.scope===this.state.scope&&f.botId===b.id&&f.fee!=null);return {...b,fees:fees.filter(f=>f.feeAsset==='USDT').reduce((sum,f)=>sum+number(f.fee),0),costsPending:fees.some(f=>f.feeAsset!=='USDT')||this.ownOrders(b).some(o=>o.appliedQty>0&&!o.feesFetched),budgetMode:b.budgetMode||'fixed',effectiveBudget:effectiveBudget(b),used,reserved,budgetWarning:used+reserved>effectiveBudget(b)?'보유·미체결 주문 증거금이 운용예산을 초과했습니다. 새 진입은 남은 예산 안에서만 가능합니다.':null,pnl:r.realized+(info?.unrealizedProfit||0),status:r.importPending?'paused':r.runEnabled||r.quantity>0||this.ownOrders(b).some(active)?'running':'paused',task:r.importPending?'imported':r.quantity>0?'position':this.ownOrders(b).some(active)?'waiting':'watching',entryPaused:!r.runEnabled,error:r.error,quantity:r.quantity,entryPrice:r.entryPrice,positionDirection:r.direction};}
  orderView(b,rule=null,direction=b.runtime.direction){return {...this.decorate(b),direction,leverage:isEntry(rule?.action)&&!b.runtime.quantity?rule.leverage:b.leverage,entryPercent:rule?.sizePercent??b.entryPercent,order:rule?.order||b.order};}
  snapshot(){return {version:2,environment:this.state.environment,connected:this.connected,connectionId:this.connectionId,tradingEnabled:this.tradingEnabled,orderPermission:{enabled:this.state.orderPermission?.scope===this.state.scope&&this.state.orderPermission?.enabled===true},credentials:{saved:Boolean(this.credentialStore?.saved),error:this.credentialError,storagePath:this.credentialStore?.filename||null},positionMode:this.hedge?'HEDGE':'ONE_WAY',account:this.connected?this.accountSnapshot:null,accountAt:this.accountAt,lastTick:this.lastTick,waiting:this.waiting,requestBudget:this.client?.rate?.snapshot()||null,error:this.writeError||this.connectionError||this.credentialError,bots:this.state.bots.map(b=>this.decorate(b)),manualOrders:this.manual.snapshot(),logs:this.state.logs,fills:this.state.fills.filter(f=>f.scope===this.state.scope).slice(-300).reverse(),orders:this.state.orders.filter(o=>o.scope===this.state.scope&&active(o)).map(o=>({id:o.id,botId:o.botId,source:o.source||'bot',role:o.role,status:o.status,symbol:o.parameters.symbol,side:o.parameters.side,type:o.parameters.type,quantity:o.parameters.quantity,price:o.parameters.price||o.parameters.triggerPrice,executedQuantity:o.appliedQty,kind:o.kind}))};}
  async saveBot(input){return this.serial(async()=>{
    if(!input||typeof input!=='object')throw new Error('봇 설정을 확인해 주세요.');
    const existing=this.state.bots.find(b=>b.id===input.id),base=upgradeActions(upgradeBot({...makeBot(),...input}));
    const allowed=['id','name','symbol','budget','budgetMode','entryPercent','maxEntries','leverage','margin','color','conditionMode','formula','formulaTimeframe','formulaCandle','rules','order','reentry','exit','actionRules'];
    const b=Object.fromEntries(allowed.map(k=>[k,base[k]]));if(!/^[a-zA-Z0-9_-]{1,64}$/.test(b.id))throw new Error('봇 식별자를 확인해 주세요.');
    if(!['mint','lavender','amber'].includes(b.color))throw new Error('캐릭터 색상을 확인해 주세요.');
    const limits=await this.leverageLimits(b.symbol),symbols=(await this.catalog()).map(s=>s.symbol);const errors=validateBot({...b,runtime:existing?.runtime,used:existing?.runtime.quantity*existing?.runtime.entryPrice/b.leverage||0,reserved:existing?this.decorate(existing).reserved:0},this.state.bots,{balance:this.accountSnapshot?.walletBalance??Infinity,symbols,enforceAllocationLimit:!existing||effectiveBudget({...b,runtime:existing.runtime})>effectiveBudget(existing),maxLeverage:existing&&(existing.runtime.quantity>0||this.ownOrders(existing).some(active))?(limits.maxLeverage||125):leverageCap(limits,effectiveBudget({...b,runtime:existing?.runtime}))});
    if(errors.length)throw new Error(errors.join('\n'));
    if(existing&&(existing.runtime.quantity>0||this.ownOrders(existing).some(active))){
      const locked=['symbol','margin','leverage'];
      if(locked.some(key=>JSON.stringify(existing[key])!==JSON.stringify(b[key])))throw new Error('보유 포지션·미해결 주문이 있으면 담당 종목·증거금 모드·레버리지는 변경할 수 없습니다.');
    }
    b.name=b.name.trim();b.runtime=existing?{...existing.runtime,runEnabled:false}:initialRuntime();if(!existing||!existing.runtime.quantity&&!this.ownOrders(existing).some(active))b.runtime.ruleSignals={};
    if(existing)this.state.bots[this.state.bots.indexOf(existing)]=b;else this.state.bots.push(b);
    this.note(existing?'봇 설정 저장':'봇 생성',`${b.name} · ${b.symbol} · 예산 ${b.budget} USDT · 신규 진입 일시정지`,b.id);await this.checkpoint();return this.decorate(b);
  });}
  async removeBot(id){return this.serial(async()=>{const b=this.bot(id);if(b.runtime.quantity>0||this.ownOrders(b).some(active))throw new Error('포지션 또는 미해결 주문이 있는 봇은 삭제할 수 없습니다.');this.state.bots=this.state.bots.filter(item=>item!==b);this.note('봇 삭제',b.name+'의 설정을 삭제했습니다.',b.id);await this.checkpoint();});}
  bot(id){const b=this.state.bots.find(item=>item.id===id);if(!b)throw new Error('봇을 찾을 수 없습니다.');return b;}
  requireTrading(){if(!this.connected)throw new Error('설정에서 API 키를 먼저 연결해 주세요.');if(!this.tradingEnabled)throw new Error('연결 설정에서 주문 실행을 허용해 주세요.');if(this.writeError)throw new Error(this.writeError);}
  async startBot(id){return this.serial(async()=>{
    this.requireTrading();const b=this.bot(id),r=b.runtime;if(r.runEnabled)return this.decorate(b);
    if(this.manual.records.some(order=>order.botId!==b.id&&active(order)&&order.parameters.symbol===b.symbol))throw new Error('같은 종목의 별도 수동 주문이 남아 있습니다. 먼저 수동 주문 상태를 확인하고 정리해 주세요.');
    if(this.state.bots.some(other=>other!==b&&other.symbol===b.symbol&&(other.runtime.runEnabled||other.runtime.quantity>0||this.ownOrders(other).some(active))))throw new Error('같은 종목은 한 봇만 운용할 수 있습니다. 다른 봇의 진입·포지션·주문을 먼저 정리해 주세요.');
    await this.refreshAccount(true);const total=this.state.bots.reduce((s,item)=>s+effectiveBudget(item),0);if(!r.quantity&&total>this.accountSnapshot.walletBalance)throw new Error('전체 봇 배정 예산이 계좌 USDT 잔고를 초과합니다.');
    await this.syncBotPosition(b,true);if(r.syncHold)throw new Error(r.error||'거래소와 봇의 포지션 수량이 일치하지 않습니다.');
    const orders=await this.client.openOrders(b.symbol),algos=await this.client.openAlgoOrders(b.symbol);const algoRows=Array.isArray(algos)?algos:algos.orders||[];
    const known=new Set(this.ownOrders(b).map(o=>o.id));if(orders.some(o=>!known.has(o.clientOrderId))||algoRows.some(o=>!known.has(o.clientAlgoId)))throw new Error('이 종목에 봇 소유가 아닌 미체결 주문이 있습니다.');
    if(this.ownOrders(b).some(o=>o.status==='UNKNOWN'))throw new Error('접수 여부가 확인되지 않은 주문이 있어 새 진입을 중단합니다.');
    const info=await this.symbolInfo(b.symbol),limits=await this.leverageLimits(b.symbol);
    if(!r.quantity&&b.actionRules.some(rule=>rule.enabled&&isEntry(rule.action)&&rule.leverage>leverageCap(limits,effectiveBudget(b))))throw new Error('이 종목과 배정 예산에서 허용하는 진입 조건의 레버리지를 초과합니다.');
    for(const rule of b.actionRules.filter(rule=>rule.enabled)){
      const snapshots=await this.formulaMarkets(b.symbol,rule.formula),{market}=evaluateRuleFormula(rule.formula,snapshots,{...r,leverage:b.leverage});
      const view=this.orderView(b,rule,actionDirection(rule.action));if(isEntry(rule.action)&&!r.quantity&&effectiveBudget(b)>0){const plan=entryOrder(view,info,{...market.book,lastPrice:market.ticker.lastPrice},this.accountSnapshot.availableBalance,this.hedge);protectiveOrders(view,info,plan.parameters.quantity,Number(plan.parameters.price||market.ticker.lastPrice),this.hedge);}
    }
    if(!r.quantity&&!this.ownOrders(b).some(active)){
      try{await this.client.changeMargin(b.symbol,b.margin);}catch(e){if(e.code!==-4046)throw e;}
    }
    const configRows=await this.client.symbolConfig(b.symbol),config=Array.isArray(configRows)?configRows[0]:configRows;
    if(!Number.isInteger(Number(config?.leverage))||number(config.leverage)<1||number(config.leverage)>MAX_LEVERAGE||String(config?.marginType).toUpperCase()!==b.margin||r.quantity&&number(config.leverage)!==b.leverage)throw new Error('거래소의 증거금 모드·레버리지가 봇 설정과 일치하지 않습니다.');
    b.leverage=number(config.leverage);
    r.runEnabled=true;r.importPending=false;for(const rule of b.actionRules.filter(rule=>isStop(rule.action)))delete r.ruleSignals[rule.id];r.error=null;r.waiting=null;r.lastSignal=null;r.lastBar=null;r.syncHold=false;this.note('조건 감시 시작',`${b.name} · ${b.symbol} · ${this.state.environment==='live'?'실전':'테스트넷'}`,b.id);await this.checkpoint();return this.decorate(b);
  });}
  async pauseBot(id){return this.serial(()=>this.pauseRuntime(this.bot(id)));}
  async pauseRuntime(b){b.runtime.runEnabled=false;await this.checkpoint();if(this.tradingEnabled)for(const o of this.ownOrders(b).filter(o=>active(o)&&o.role==='entry'))await this.cancelStandard(b,o,true);this.note('신규 진입 중지',`${b.name} · 미체결 진입 취소 확인 · 보유 포지션과 청산 주문은 계속 관리합니다.`,b.id);await this.checkpoint();return this.decorate(b);}
  async submit(b,parameters,{kind='standard',role='entry',margin=0,group=null,guardKey=null,parent=null,ruleId=null,direction=b.runtime.direction,orderPolicy=null,timeframe=null}={}){
    this.requireTrading();const sequence=this.state.nextIntent++;const id='fw_'+createHash('sha256').update(b.id+this.state.scope).digest('hex').slice(0,9)+'_'+sequence;
    const order={id,botId:b.id,scope:this.state.scope,kind,role,parameters:{...parameters},margin,group:group||id,guardKey,status:'UNKNOWN',createdAt:this.now(),appliedQty:0,appliedQuote:0,feesFetched:false,parent,ruleId,direction,orderPolicy,timeframe};
    const parentOrder=parent?this.state.orders.find(o=>o.id===parent):null,parentFallback=parentOrder?.fallbackDone;if(parentOrder)parentOrder.fallbackDone=true;
    this.state.orders.push(order);await this.checkpoint();
    try{
      const result=kind==='algo'?await this.client.placeAlgo({...parameters,clientAlgoId:id}):await this.client.placeOrder({...parameters,newClientOrderId:id});
      if(kind==='algo'){order.status=result.algoStatus||'NEW';order.algoId=result.algoId;}else await this.applyOrder(b,order,result);
    }catch(error){order.error=this.client.redact?.(error.message)||error.message;if(!error.uncertain)order.status='REJECTED';if(isRateLimited(error)){order.retryable=true;if(parentOrder)parentOrder.fallbackDone=parentFallback;await this.checkpoint();throw error;}b.runtime.error=order.error;b.runtime.runEnabled=false;this.note(error.uncertain?'주문 접수 확인 필요':'주문 거절',`${b.name} · ${order.error}`,b.id,'error');}
    await this.checkpoint();return order;
  }
  async applyOrder(b,o,data){
    const quantity=number(data.executedQty),quote=number(data.cumQuote||data.cumQuoteQty)||(quantity*number(data.avgPrice));
    if(quantity+1e-12<o.appliedQty)throw new Error('주문 누적 체결 수량이 감소했습니다. 새 진입을 중단합니다.');
    const delta=quantity-o.appliedQty,r=b.runtime;
    if(delta>1e-12){const value=quote-o.appliedQuote;if(!(value>0))throw new Error('체결 금액을 확인할 수 없습니다.');const fillPrice=value/delta;
      if(o.role==='entry'){
        if(r.quantity>0&&r.direction!==(o.direction||r.direction))throw new Error('반대 방향 진입 체결을 확인했습니다. 계좌를 확인해 주세요.');
        if(!r.quantity)r.positionEpoch++;r.direction=o.direction||r.direction||'LONG';
        if(!this.ownOrders(b).some(other=>other!==o&&other.group===o.group&&other.counted)&&!o.counted)r.entries++;
        o.counted=true;r.entryPrice=(r.quantity*r.entryPrice+value)/(r.quantity+delta);r.quantity+=delta;r.lastEntryAt=this.now();
      }else{const closed=Math.min(r.quantity,delta);r.realized+=(fillPrice-r.entryPrice)*closed*(b.runtime.direction==='LONG'?1:-1);r.quantity=Math.max(0,r.quantity-delta);if(r.quantity<1e-12){r.quantity=0;r.entryPrice=0;r.entries=0;r.lastExitAt=this.now();}}
      this.state.fills.push({id:o.id+':'+quantity,scope:o.scope,botId:b.id,at:this.now(),symbol:b.symbol,side:o.parameters.side,role:o.role,action:o.role==='entry'?'ENTER_'+o.direction:o.ruleId?'EXIT_'+o.direction:'CLOSE',ruleId:o.ruleId,quantity:delta,price:fillPrice});
      this.note('체결 확인',`${b.name} · ${o.parameters.side} ${delta} · ${fillPrice}`,b.id);
    }
    o.appliedQty=quantity;o.appliedQuote=quote;o.status=data.status||o.status;o.orderId=data.orderId||o.orderId;
  }
  async refreshOrder(b,o){
    try{
      if(o.kind==='algo'){
        const data=await this.client.queryAlgo(o.id);o.algoStatus=data.algoStatus;
        if(data.actualOrderId&&String(data.actualOrderId)!=='0'){o.childOrderId=data.actualOrderId;await this.applyOrder(b,o,await this.client.queryOrder(b.symbol,{orderId:data.actualOrderId}));}
        else o.status=['NEW','TRIGGERING','TRIGGERED'].includes(data.algoStatus)?data.algoStatus==='NEW'?'NEW':'UNKNOWN':data.algoStatus||'UNKNOWN';
      }else await this.applyOrder(b,o,await this.client.queryOrder(b.symbol,o.id));
      if(!active(o)&&o.orderId&&!o.feesFetched){const fills=await this.client.trades(b.symbol,o.orderId);for(const trade of fills){const legacyKey='fee:'+o.orderId+':'+trade.id,key='fee:'+o.scope+':'+b.symbol+':'+o.orderId+':'+trade.id;if(this.state.fills.some(f=>f.id===key||f.id===legacyKey&&f.scope===o.scope&&f.botId===b.id&&f.symbol===b.symbol))continue;const fee=number(trade.commission);if(trade.commissionAsset==='USDT')b.runtime.realized-=fee;this.state.fills.push({id:key,scope:o.scope,botId:b.id,at:number(trade.time)||this.now(),symbol:b.symbol,fee,feeAsset:trade.commissionAsset});}o.feesFetched=true;}
    }catch(error){if([-2013,-2011,-4143].includes(error.code)){o.lastQueryError=error.code;if(o.status==='UNKNOWN')b.runtime.error='주문 접수 여부가 아직 확인되지 않았습니다. 중복 전송하지 않고 조회를 계속합니다.';}else throw error;}
  }
  async cancelStandard(b,o,abortRemainder=false){if(abortRemainder){o.fallbackDone=true;await this.checkpoint();}try{const result=await this.client.cancelOrder(b.symbol,o.id);await this.applyOrder(b,o,result);}catch(error){if(![-2011,-2013].includes(error.code)&&!error.uncertain)throw error;}await this.refreshOrder(b,o);await this.checkpoint();}
  async cancelGuard(b,o){try{await this.client.cancelAlgo(o.id);}catch(error){if(![-2011,-2013,-4143].includes(error.code)&&!error.uncertain)throw error;}await this.refreshOrder(b,o);await this.checkpoint();}
  async syncBotPosition(b,immediate=false){
    const positions=this.accountSnapshot?.positions.filter(p=>p.symbol===b.symbol)||[],expected=b.runtime.quantity;
    const own=positions.find(p=>this.hedge?p.positionSide===b.runtime.direction:true),other=positions.some(p=>this.hedge&&!b.runtime.imported&&p.positionSide!==b.runtime.direction&&Math.abs(p.quantity)>0),actual=Math.abs(own?.quantity||0);
    const reversed=!this.hedge&&own&&((own.quantity>0)!==(b.runtime.direction==='LONG'));
    const priceMatches=!expected||!actual||Math.abs(number(own?.entryPrice)-b.runtime.entryPrice)<=Math.max(1e-8,b.runtime.entryPrice*1e-8);
    const matches=!other&&!reversed&&priceMatches&&Math.abs(actual-expected)<=1e-9;
    if(matches){b.runtime.syncHold=false;b.runtime.mismatchSince=0;return;}
    b.runtime.syncHold=true;b.runtime.mismatchSince||=this.now();
    if(immediate||this.now()-b.runtime.mismatchSince>15000){b.runtime.runEnabled=false;b.runtime.error='거래소 포지션과 봇 체결 원장이 다릅니다. 수동 거래·다른 봇의 포지션을 자동 인수하지 않습니다.';}
  }
  async ensureGuards(b,info){
    const r=b.runtime,guards=this.ownOrders(b).filter(o=>o.kind==='algo'&&active(o));
    if(!r.quantity){for(const o of guards)await this.cancelGuard(b,o);r.guardKey=null;return true;}
    if(r.syncHold)return false;
    const key=[r.quantity,r.entryPrice,b.exit.stopLoss,b.exit.takeProfit,b.exit.price,protectionEnabled(b.exit,'stopLoss'),protectionEnabled(b.exit,'takeProfit')].join(':');
    const desired=protectiveOrders(this.orderView(b),info,r.quantity,r.entryPrice,this.hedge);
    for(const plan of desired){const existing=guards.find(o=>o.guardKey===key&&o.role===plan.role);if(existing){if(existing.status==='UNKNOWN')return false;continue;}
      const rejected=this.ownOrders(b).find(o=>o.guardKey===key&&o.role===plan.role&&o.status==='REJECTED'&&!o.retryable);if(rejected)throw new Error('보호 주문이 거절되었습니다: '+rejected.error);
      const o=await this.submit(b,plan.parameters,{kind:'algo',role:plan.role,guardKey:key});if(o.status!=='NEW')return false;
    }
    r.guardKey=desired.length?key:null;await this.checkpoint();
    const current=o=>o.guardKey===key&&desired.some(plan=>plan.role===o.role);
    for(const old of guards.filter(o=>!current(o)))await this.cancelGuard(b,old);
    const pendingMessage='보호 주문 변경을 위한 기존 주문의 취소 확인을 기다립니다.';
    if(this.ownOrders(b).some(o=>o.kind==='algo'&&active(o)&&!current(o))){r.error=pendingMessage;return false;}
    if(r.error===pendingMessage)r.error=null;
    return true;
  }
  async closeBot(id){return this.serial(async()=>{this.requireTrading();const b=this.bot(id);b.runtime.runEnabled=false;await this.closePosition(b,'사용자 전량 청산');return this.decorate(b);});}
  async cancelBotOrder(id,orderId){return this.serial(async()=>{this.requireTrading();const b=this.bot(id),order=this.ownOrders(b).find(o=>o.id===orderId&&o.kind==='standard');if(!order)throw new Error('이 봇의 일반 주문을 찾을 수 없습니다.');await this.refreshOrder(b,order);if(order.status==='UNKNOWN')throw new Error('접수 여부 확인 후 취소할 수 있습니다.');if(active(order))await this.cancelStandard(b,order,true);await this.refreshAccount(true);await this.syncBotPosition(b,true);if(!b.runtime.syncHold)await this.ensureGuards(b,await this.symbolInfo(b.symbol));await this.checkpoint();return this.decorate(b);});}
  async closePosition(b,reason){
    this.requireTrading();const r=b.runtime;
    for(const o of this.ownOrders(b).filter(active)){if(o.kind==='algo')await this.cancelGuard(b,o);else await this.cancelStandard(b,o,true);}
    if(this.ownOrders(b).some(active))throw new Error('기존 주문의 취소·체결 결과를 확인한 뒤 청산합니다.');
    await this.refreshAccount(true);await this.syncBotPosition(b,true);if(r.syncHold)throw new Error(r.error);
    if(!r.quantity)return;const info=await this.symbolInfo(b.symbol),filters=symbolFilters(info,'MARKET'),quantity=quantize(String(r.quantity),filters.step);
    if(number(quantity)<=0)throw new Error('보유 수량이 거래소 청산 수량 단위보다 작습니다.');
    this.note('전량 청산 요청',`${b.name} · ${reason}`,b.id);
    await this.submit(b,{symbol:b.symbol,side:b.runtime.direction==='LONG'?'SELL':'BUY',type:'MARKET',quantity,positionSide:this.hedge?r.direction:'BOTH',...(!this.hedge?{reduceOnly:'true'}:{})},{role:'exit'});
  }
  async tick(){return this.serial(async()=>{
    this.lastTick=this.now();if(!this.connected)return;
    const blockedUntil=this.client.rate?.blockedUntil||0;if(this.now()<blockedUntil&&(!this.waiting||this.waiting.retryAt<blockedUntil)){this.defer({status:429,retryAt:blockedUntil});await this.checkpoint();}
    if(this.now()<(this.waiting?.retryAt||0))return;
    let deferred=false;
    try{
      if(this.now()-this.lastTimeSync>60000){await this.client.syncTime();this.lastTimeSync=this.now();}
      await this.manual.refreshPending();
      for(const b of this.state.bots)for(const o of this.ownOrders(b).filter(o=>active(o)||!o.feesFetched&&o.orderId))await this.refreshOrder(b,o);
      await this.refreshAccount(true);this.connectionError=null;
      for(const b of this.state.bots){
        try{await this.tickBot(b);b.runtime.waiting=null;}
        catch(error){if(isTemporary(error)){this.defer(error);deferred=true;break;}b.runtime.runEnabled=false;b.runtime.waiting=null;b.runtime.error=this.client.redact?.(error.message)||error.message;this.note('봇 확인 필요',b.name+' · '+b.runtime.error,b.id,'error');}
      }
      if(!deferred)this.waiting=null;
    }catch(error){if(!isTemporary(error))throw error;this.defer(error);}
    await this.checkpoint();
  });}
  async settlePending(b,info){
    const r=b.runtime;
    for(const o of this.ownOrders(b).filter(o=>o.kind==='standard'&&o.parameters.type==='LIMIT'&&!o.fallbackDone)){
      const policy=o.orderPolicy||b.order;
      if(o.role!=='entry'&&!r.quantity&&active(o))await this.cancelStandard(b,o,true);
      if(!active(o)&&!['CANCELED','EXPIRED'].includes(o.status)){o.fallbackDone=true;continue;}
      if(this.now()-o.createdAt<policy.timeout*1000)continue;
      if(active(o))await this.cancelStandard(b,o);
      const remainder=number(o.parameters.quantity)-o.appliedQty;
      if(!active(o)&&['CANCELED','EXPIRED'].includes(o.status)&&policy.remainder==='market'&&remainder>1e-12&&(o.role!=='entry'||r.runEnabled)){
        await this.refreshAccount(true);await this.syncBotPosition(b);if(r.syncHold)return;
        const market=await this.market(b.symbol,o.timeframe||b.formulaTimeframe),filters=symbolFilters(info,'MARKET');
        let quantity=quantize(String(o.role==='entry'?remainder:Math.min(remainder,r.quantity)),filters.step);
        if(number(quantity)<filters.minQty||o.role==='entry'&&number(quantity)*number(market.ticker.lastPrice)<filters.minNotional){o.fallbackDone=true;continue;}
        const view=this.orderView(b,{sizePercent:100,order:{...policy,type:'MARKET'}},o.direction||r.direction);
        let parameters,margin=0;
        if(o.role==='entry'){const plan=entryOrder(view,info,{...market.book,lastPrice:market.ticker.lastPrice},this.accountSnapshot.availableBalance,this.hedge);quantity=quantize(String(Math.min(number(quantity),number(plan.parameters.quantity))),filters.step);parameters={...plan.parameters,quantity};margin=number(quantity)*number(market.ticker.lastPrice)/b.leverage;}
        else parameters=exitOrder(view,info,market.book,quantity,this.hedge);
        if(number(quantity)>=filters.minQty)await this.submit(b,parameters,{role:o.role,margin,group:o.group,parent:o.id,ruleId:o.ruleId,direction:o.direction,orderPolicy:{...policy,type:'MARKET'},timeframe:o.timeframe});
        else o.fallbackDone=true;
      }else if(!active(o))o.fallbackDone=true;
    }
  }
  async evaluateRules(b,{phase='all',markets=new Map(),append=false,cachedOnly=false}={}){
    const r=b.runtime,results=[];r.ruleSignals||={};
    for(const rule of b.actionRules.filter(rule=>rule.enabled)){
      if(phase==='management'&&isEntry(rule.action)||phase==='entry'&&!isEntry(rule.action))continue;
      if(isEntry(rule.action)&&(!r.runEnabled||r.quantity&&r.direction!==actionDirection(rule.action)))continue;
      if(cachedOnly&&(ruleIntervals(rule.formula).length?ruleIntervals(rule.formula):['1m']).some(interval=>!markets.has(interval)))continue;
      if(isStop(rule.action)&&!r.runEnabled)continue;
      if(!isStop(rule.action)&&!isEntry(rule.action)&&(!r.quantity||actionDirection(rule.action)&&actionDirection(rule.action)!==r.direction))continue;
      const snapshots=await this.formulaMarkets(b.symbol,rule.formula,markets),{market,result,bar,interval}=evaluateRuleFormula(rule.formula,snapshots,{...r,leverage:b.leverage});
      const signal=r.ruleSignals[rule.id]||={fired:false,lastBar:null,lastExecutionAt:0,epoch:r.positionEpoch};
      if(!isEntry(rule.action)&&signal.epoch!==r.positionEpoch){signal.fired=false;signal.lastBar=null;signal.epoch=r.positionEpoch;}
      if(!result.missing&&!result.pass)signal.fired=false;
      signal.lastEvaluation={at:this.now(),bar,interval,pass:result.pass,missing:result.missing};
      const ready=isStop(rule.action)?!signal.fired:rule.reentry.mode==='bar'?signal.lastBar!==bar:rule.reentry.mode==='cooldown'?this.now()-signal.lastExecutionAt>=rule.reentry.cooldown*1000:!signal.fired;
      const eligible=isStop(rule.action)?r.runEnabled:isEntry(rule.action)?r.runEnabled&&(!r.quantity||r.direction===actionDirection(rule.action))&&(!b.maxEntries||r.entries<b.maxEntries)&&this.now()-r.lastExitAt>=(rule.reentry.afterExitCooldown??rule.reentry.cooldown)*1000:true;
      results.push({rule,signal,market,bar,interval,ready:eligible&&ready&&!result.missing&&result.pass});
    }
    r.lastEvaluation={at:this.now(),rules:[...(append?r.lastEvaluation?.rules||[]:[]),...results.map(x=>({id:x.rule.id,action:x.rule.action,...x.signal.lastEvaluation,ready:x.ready}))]};return results;
  }
  async prepareEntryLeverage(b,target){
    this.requireTrading();
    const getConfig=async()=>{const rows=await this.client.symbolConfig(b.symbol);return Array.isArray(rows)?rows.find(row=>row.symbol===b.symbol)||rows[0]:rows;};
    let config=await getConfig();
    if(!Number.isInteger(target)||target<1||target>MAX_LEVERAGE||String(config?.marginType).toUpperCase()!==b.margin)throw new Error('진입 전 증거금 모드·레버리지를 확인해 주세요.');
    if(b.runtime.quantity&&number(config?.leverage)!==b.leverage)throw new Error('보유 포지션의 레버리지가 변경되었습니다. 계좌 설정을 확인해 주세요.');
    if(number(config?.leverage)!==target){
      if(b.runtime.quantity||this.accountSnapshot.positions.some(p=>p.symbol===b.symbol&&Math.abs(p.quantity)>0)||this.accountSnapshot.orders.some(o=>o.symbol===b.symbol)||this.ownOrders(b).some(active))throw new Error('같은 종목에 포지션·미체결 주문이 있어 레버리지를 바꿀 수 없습니다.');
      // A failed or uncertain configuration response must never continue to an order.
      const response=await this.client.changeLeverage(b.symbol,target);if(number(response?.leverage)!==target)throw new Error('거래소 레버리지 적용 응답을 확인하지 못했습니다.');
      config=await getConfig();if(number(config?.leverage)!==target||String(config?.marginType).toUpperCase()!==b.margin)throw new Error('거래소 레버리지 적용을 확인하지 못했습니다.');
      await this.refreshAccount(true);
    }
    b.leverage=target;await this.checkpoint();
  }
  async executeRule(b,item,info){
    const {rule,signal,market,bar}=item,r=b.runtime;let parameters,margin=0;
    if(isStop(rule.action)){
      signal.fired=true;signal.lastBar=bar;signal.lastExecutionAt=this.now();await this.pauseRuntime(b);
      this.note('조건 정지',b.name+' · 조건식 충족으로 신규 진입을 정지했습니다.',b.id);await this.checkpoint();return;
    }
    if(isEntry(rule.action)){
      await this.refreshAccount(true);await this.syncBotPosition(b);if(r.syncHold)return;
      const view=this.orderView(b,rule,actionDirection(rule.action));let plan=entryOrder(view,info,{...market.book,lastPrice:market.ticker.lastPrice},this.accountSnapshot.availableBalance,this.hedge);
      protectiveOrders(view,info,plan.parameters.quantity,number(plan.parameters.price||market.ticker.lastPrice),this.hedge);
      await this.prepareEntryLeverage(b,view.leverage);
      plan=entryOrder(view,info,{...market.book,lastPrice:market.ticker.lastPrice},this.accountSnapshot.availableBalance,this.hedge);
      protectiveOrders(view,info,plan.parameters.quantity,number(plan.parameters.price||market.ticker.lastPrice),this.hedge);parameters=plan.parameters;margin=plan.margin;r.direction=actionDirection(rule.action);
    }else{
      for(const o of this.ownOrders(b).filter(o=>active(o)&&o.role==='entry'))await this.cancelStandard(b,o,true);
      if(this.ownOrders(b).some(o=>active(o)&&o.kind==='standard'))return;
      await this.refreshAccount(true);await this.syncBotPosition(b);if(r.syncHold||!r.quantity)return;
      parameters=exitOrder(this.orderView(b,rule),info,{...market.book,lastPrice:market.ticker.lastPrice},r.quantity*rule.sizePercent/100,this.hedge);
    }
    const previousSignal={...signal},previousLastBar=r.lastBar,previousEntryAt=r.lastEntryAt;
    signal.fired=true;signal.lastBar=bar;signal.lastExecutionAt=this.now();if(isEntry(rule.action)){r.lastBar=bar;r.lastEntryAt=this.now();}await this.checkpoint();
    this.note('조건 행동 실행',b.name+' · '+ACTIONS[rule.action]+' · '+rule.sizePercent+'%',b.id);
    let intent;try{intent=await this.submit(b,parameters,{role:isEntry(rule.action)?'entry':'exit',margin,ruleId:rule.id,direction:r.direction,orderPolicy:rule.order,timeframe:item.interval});}catch(error){if(isRateLimited(error)){Object.assign(signal,previousSignal);r.lastBar=previousLastBar;r.lastEntryAt=previousEntryAt;await this.checkpoint();}throw error;}
    if(intent.status==='REJECTED'&&r.quantity)r.error='조건 주문이 거절되었습니다: '+intent.error;
    await this.refreshAccount(true);await this.syncBotPosition(b);await this.ensureGuards(b,info);
  }
  async tickBot(b){
    const r=b.runtime;if(!r.runEnabled&&!r.quantity&&!this.ownOrders(b).some(active))return;
    await this.syncBotPosition(b);if(!this.tradingEnabled||r.syncHold||r.importPending)return;
    const info=await this.symbolInfo(b.symbol);
    if(!r.quantity){for(const o of this.ownOrders(b).filter(o=>active(o)&&o.kind==='standard'&&o.role!=='entry'))await this.cancelStandard(b,o,true);}
    if(r.quantity&&hasProtection(b.exit)){
      const premium=await this.client.premium(b.symbol),last=number((await this.symbolTicker(b.symbol))?.lastPrice),reference=b.exit.price==='MARK_PRICE'?number(premium.markPrice):last;
      const change=(reference/r.entryPrice-1)*100*(r.direction==='LONG'?1:-1);
      const take=protectionEnabled(b.exit,'takeProfit')&&change>=b.exit.takeProfit,stop=protectionEnabled(b.exit,'stopLoss')&&change<=-b.exit.stopLoss;
      if(reference>0&&(take||stop)){await this.closePosition(b,take?'익절 조건':'손절 조건');return;}
    }
    const protectedPosition=await this.ensureGuards(b,info);if(r.quantity&&!protectedPosition)return;
    const markets=new Map(),management=await this.evaluateRules(b,{phase:'management',markets}),stops=management.filter(i=>i.ready&&isStop(i.rule.action)),exits=management.filter(i=>i.ready&&!isStop(i.rule.action));
    if(stops.length){await this.executeRule(b,stops[0],info);return;}
    const closing=this.ownOrders(b).some(o=>active(o)&&(o.role!=='entry'&&o.kind==='standard'||o.childOrderId||o.status==='UNKNOWN'));
    if(closing){await this.settlePending(b,info);await this.refreshAccount(true);await this.syncBotPosition(b);await this.ensureGuards(b,info);return;}
    if(exits.length){await this.evaluateRules(b,{phase:'entry',markets,append:true,cachedOnly:true});await this.executeRule(b,exits[0],info);return;}
    if(this.ownOrders(b).some(o=>o.kind==='standard'&&(active(o)||o.parameters.type==='LIMIT'&&!o.fallbackDone&&['CANCELED','EXPIRED'].includes(o.status)))){await this.settlePending(b,info);await this.refreshAccount(true);await this.syncBotPosition(b);await this.ensureGuards(b,info);return;}
    const items=await this.evaluateRules(b,{phase:'entry',markets,append:true}),entries=items.filter(i=>i.ready&&isEntry(i.rule.action));
    if(new Set(entries.map(i=>actionDirection(i.rule.action))).size>1){this.note('진입 신호 충돌',b.name+' · 롱과 숏 진입이 동시에 충족되어 보류합니다.',b.id);r.lastEvaluation.conflict=true;return;}
    if(entries.length){const limits=await this.leverageLimits(b.symbol),leverage=r.quantity?b.leverage:entries[0].rule.leverage;if(leverage>leverageCap(limits,effectiveBudget(b))){r.lastEvaluation.budgetBlocked=true;return;}const usage=this.decorate(b);if(usage.used+usage.reserved>=effectiveBudget(b)){r.lastEvaluation.budgetBlocked=true;return;}await this.executeRule(b,entries[0],info);}
  }
}
