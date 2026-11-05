import { createHash, randomUUID } from 'node:crypto';
import { BinanceClient } from './binance.mjs';
import {transportSettings} from './streams.mjs';
import {StorageRecovery,isStorageError} from './storage-recovery.mjs';
import {MultiBots} from './multi-bots.mjs';
import {isTemporary,isRateLimited,isLocalRateLimit} from './binance-rate.mjs';
import { ManualTrading } from './manual-trading.mjs';
import {PositionImports} from './position-import.mjs';
import {accountView,withAccountEquity} from './account-view.mjs';
import {PositionInsights} from './position-insights.mjs';
import {TradeHistory} from './trade-history.mjs';
import {TradeExcursions} from './trade-excursions.mjs';
import {PositionCostEstimates} from './position-costs.mjs';
import {PositionReconciliation} from './position-reconciliation.mjs';
import {SharedPositions} from './shared-positions.mjs';
import {OrderCancellation} from './order-cancellation.mjs';
import {OrderDeadlines} from './order-deadlines.mjs';
import {rememberDeletedBot} from './history-bots.mjs';
import {reconcileConfirmedSharedFees,sharedQuantityPending} from './confirmed-shared-fees.mjs';
import {ClosePositionFlow,knownOrderSettlement} from './close-position-flow.mjs';
import {CloseOrderRecovery,pendingMarketRemainder} from './close-order-recovery.mjs';
import {managementWasEnabled} from './management-state.mjs';
import {EntryCapacityError,isEntryCapacityError, entryOrder, exitOrder, protectiveOrders, quantize, symbolFilters } from './orders.mjs';
import {PostOnlyRetries,isPostOnlyRejection} from './post-only-retries.mjs';
import {BudgetSelection} from './budget-selection.mjs';
import {BudgetBaselines} from './budget-baseline.mjs';
import {budgetIncluded,allocatedAmount,withheldProfit,resolveBudgets,budgetSignature,isPercentBudget} from '../public/budget.js';
import { makeBot, validateBot, positionMargin, effectiveBudget } from '../public/core.js';
import { upgradeBot } from '../public/formula.js';
import {ruleIntervals,evaluateRuleFormula} from '../public/formula-runtime.js';
import {FORMULA_TIMEFRAMES,formulaSymbols,formulaMarketRequests} from '../public/formula.js';
import {normalizeBrackets,leverageCap,MAX_LEVERAGE} from '../public/leverage.js';
import { ACTIONS, isEntry, isStop, actionDirection, upgradeActions } from '../public/actions.js';
import {protectionEnabled,hasProtection,protectionBasis,protectionPricePercent} from '../public/protection.js';

const TERMINAL=new Set(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','FINISHED']);
const active=o=>!TERMINAL.has(o.status);
const POSITION_MISMATCH_ERROR='거래소 포지션과 봇 체결 원장이 다릅니다. 수동 거래·다른 봇의 포지션을 자동 인수하지 않습니다.';
const initialRuntime=()=>({runEnabled:false,managementEnabled:false,importPending:false,entryBlocked:null,quantity:0,entryPrice:0,entries:0,realized:0,lastSignal:null,lastBar:null,lastEntryAt:0,lastExitAt:0,lastEvaluation:null,error:null,waiting:null,guardKey:null,mismatchSince:0,syncHold:false,direction:null,ruleSignals:{},positionEpoch:0});
const number=value=>Number(value||0);

export class TradingEngine {
  constructor(store,{clientFactory=options=>new BinanceClient(options),now=Date.now,credentialStore=null}={}){
    this.store=store;this.clientFactory=clientFactory;this.now=now;this.client=null;this.connected=false;this.tradingEnabled=false;this.hedge=false;this.accountSnapshot=null;this.accountScope=null;this.accountAt=0;this.connectionError=null;this.waiting=null;this.writeError=null;this.queue=Promise.resolve();this.timer=null;this.lastTimeSync=0;this.lastTick=0;
    this.credentialStore=credentialStore;this.credentialError=null;this.reconnectAt=0;
    this.manual=new ManualTrading(this);this.multi=new MultiBots(this);this.storage=new StorageRecovery(this);
    this.orderChecks=new WeakMap();this.positionChecks=new WeakMap();this.accountRevisionAt=0;this.lastCycleAt=0;
    this.orderCancellation=new OrderCancellation(this);this.deadlines=new OrderDeadlines(this);this.positionMismatchError=POSITION_MISMATCH_ERROR;this.shared=new SharedPositions(this);this.closeRecovery=new CloseOrderRecovery(this);this.closeFlow=new ClosePositionFlow(this);this.positionReconciliation=new PositionReconciliation(this);this.positionImports=new PositionImports(this);this.budgetSelection=new BudgetSelection(this);this.budgetBaselines=new BudgetBaselines(this);this.postOnly=new PostOnlyRetries(this);this.positionInsights=new PositionInsights(this);this.tradeHistory=new TradeHistory(this);this.excursions=new TradeExcursions(this);this.positionCostEstimates=new PositionCostEstimates(this);this.connectionId=null;
  }
  get state(){return this.store.state;}
  serial(callback){const result=this.queue.then(callback,callback);this.queue=result.catch(()=>{});return result;}
  async init(){await this.store.load();this.state.dataTransport=transportSettings(this.state.dataTransport);this.client=this.clientFactory({environment:this.state.environment});for(let i=0;i<this.state.bots.length;i++){const old=this.state.bots[i],b=upgradeActions(upgradeBot(old));b.runtime={...initialRuntime(),...old.runtime,managementEnabled:managementWasEnabled(old.runtime),runEnabled:false,waiting:null};if(!b.runtime.direction&&(b.runtime.quantity>0||this.state.orders.some(o=>o.botId===b.id&&o.role==='entry'&&active(o))))b.runtime.direction=old.direction||'LONG';delete b.direction;this.state.bots[i]=b;}this.client.configureDataTransport?.(this.state.dataTransport);this.multi.init();this.excursions.init();this.postOnly.recoverLegacy();this.closeRecovery.recoverLegacy();this.closeFlow.recoverLegacy();this.manual.recoverInterrupted();await this.checkpoint();await this.restoreConnection();return this;}
  startTimer(){this.timer=setInterval(()=>{this.timerCycle();},1000);this.timer.unref?.();}
  timerCycle(){const interval=this.state.dataTransport?.mode==='rest'?this.state.dataTransport.restIntervalSeconds*1000:1000;const regular=this.now()-this.lastCycleAt>=interval;if(this.timerBusy||!regular&&!this.deadlines.due())return;if(regular)this.lastCycleAt=this.now();this.timerBusy=true;const cycle=(async()=>{if(!this.connected&&this.reconnectAt&&this.now()>=this.reconnectAt)await this.restoreConnection();await this.tick({deadlinesOnly:!regular});})();return cycle.catch(error=>{this.connectionError=this.client.redact?.(error.message)||error.message;}).finally(()=>{this.timerBusy=false;});}
  async stopTimer(){clearInterval(this.timer);await this.queue;this.client.closeStreams?.();}
  async setDataTransport(input){return this.serial(async()=>{this.storage.healthy();const next=transportSettings(input);this.state.dataTransport=next;await this.checkpoint();this.client.configureDataTransport?.(next);this.accountAt=0;this.lastCycleAt=0;this.orderChecks=new WeakMap();this.positionChecks=new WeakMap();return this.snapshot();});}
  async pollTrackedOrder(order,load,{force=false}={}){
    const now=this.now(),revision=this.client.accountRevision||0,previous=this.orderChecks.get(order),push=this.client.userStream?.status==='connected',interval=push?60000:(this.state.dataTransport?.restIntervalSeconds||3)*1000;
    if(!force&&this.client.transport&&order.status!=='UNKNOWN'&&previous&&now-previous.at<interval&&previous.revision===revision)return;
    const before=[order.status,order.appliedQty].join(':');await load();this.orderChecks.set(order,{at:this.now(),revision});if(before!==[order.status,order.appliedQty].join(':'))this.accountAt=0;
  }
  note(title,message,botId=null,level='info'){const last=this.state.logs[0];if(last?.message===message&&this.now()-last.at<30000)return;this.state.logs.unshift({id:randomUUID(),at:this.now(),title,message,botId,level});this.state.logs=this.state.logs.slice(0,1000);}
  async checkpoint(){return this.storage.checkpoint();}
  budgetUsage(b){const r=b.runtime||{},info=r.quantity>0?this.liveAccount()?.positions.find(p=>p.symbol===b.symbol&&(this.hedge?p.positionSide===r.direction:true)):null;return {used:info?positionMargin(info,b.leverage,b.margin)*(this.shared.active(b.symbol)?r.quantity/Math.abs(info.quantity):1):(r.quantity||0)*(r.entryPrice||0)/b.leverage,reserved:this.ownOrders(b).filter(o=>active(o)&&o.role==='entry').reduce((sum,o)=>sum+o.margin*Math.max(0,1-number(o.appliedQty)/number(o.parameters.quantity)),0)};}
  budgetRoots(candidate=null){const roots=[...this.state.bots.filter(b=>!b.multiBotId).map(b=>({...b,...this.budgetUsage(b)})),...this.multi.groups.map(p=>({...p,runtime:{...p.runtime,realized:this.multi.realized(p)},...this.multi.workers(p).reduce((s,b)=>{const u=this.budgetUsage(b);return {used:s.used+u.used,reserved:s.reserved+u.reserved};},{used:0,reserved:0})}))];if(!candidate||candidate.multiBotId)return roots;const old=roots.find(b=>b.id===candidate.id),view={...old,...candidate,runtime:{...old?.runtime,...candidate.runtime},used:old?.used||0,reserved:old?.reserved||0};return [...roots.filter(b=>b.id!==candidate.id),view];}
  budgetView(b){const roots=this.budgetRoots(b.multiBotId?null:b),all=resolveBudgets(roots,this.accountSnapshot?.walletBalance??Infinity,this.accountSnapshot?.availableBalance);let allocation=all.get(b.id);if(b.multiBotId){const parent=this.multi.get(b.multiBotId),root=all.get(parent.id),weight=parent.legs.find(l=>l.alias===b.multiAlias)?.weight||0;allocation={...root,target:root.target*weight/100,limit:root.limit*weight/100,signature:budgetSignature(b)};}return {...b,...(roots.find(root=>root.id===b.id)||this.budgetUsage(b)),runtime:roots.find(root=>root.id===b.id)?.runtime??b.runtime,budgetAllocation:allocation};}
  budgetLimit(b){return effectiveBudget(this.budgetView(b));}
  allocatedBudget(exceptId=null){const roots=this.budgetRoots(),all=resolveBudgets(roots,this.accountSnapshot?.walletBalance??Infinity,this.accountSnapshot?.availableBalance);return roots.filter(b=>b.id!==exceptId&&budgetIncluded(b)).reduce((sum,b)=>sum+all.get(b.id).limit,0);}
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
  async availableRead(read){try{return await read();}catch(error){if(!isLocalRateLimit(error))throw error;this.defer(error);return null;}}
  defer(error){
    if(isLocalRateLimit(error)){const wait={kind:'rate-limit',local:true,message:'호출량 조절 대기 · 이 조회를 제외한 감시는 계속합니다.',retryAt:Number(error.retryAt)||this.now()+1000};return wait;}
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
  async formulaMarkets(symbol,source,cache=new Map(),aliases={}){
    const names=formulaSymbols(source),requests=formulaMarketRequests(symbol,source,aliases),feeds=new Map();
    await Promise.all(requests.map(async item=>{if(!cache.has(item.key))cache.set(item.key,this.market(item.symbol,item.interval));feeds.set(item.key,await cache.get(item.key));}));
    const intervals=ruleIntervals(source),result={};
    for(const interval of intervals.length?intervals:['1m']){
      const primary=feeds.get(symbol+'@'+interval);
      result[interval]=names.length?{...primary,symbols:Object.fromEntries(names.map(name=>[name,feeds.get((aliases[name]||name)+'@'+interval)]))}:primary;
    }
    return result;
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
    this.storage.healthy();
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
    const permitted=allowTrading===true&&account.canTrade!==false;
    if(this.state.scope&&this.state.scope!==scope){for(const b of this.state.bots)b.runtime=initialRuntime();for(const p of this.multi.groups)p.runtime={runEnabled:false,error:null,stopSignals:{}};}
    for(const b of this.state.bots)b.runtime.runEnabled=false;this.multi.stopFlags();
    this.state.scope=scope;this.state.environment=environment;this.state.orderPermission={scope,enabled:permitted};
    this.note('계좌 연결',`${environment==='live'?'실전':'테스트넷'} 계좌 연결 · ${mode.dualSidePosition?'헤지':'단방향'} 모드 · ${permitted?'주문 허용':'조회 전용'}. 봇 신규 진입은 일시정지 상태입니다.`);
    try{await this.checkpoint();}catch(error){candidate.clearCredentials();throw error;}
    const previous=this.client;this.client=candidate;previous?.clearCredentials();this.connected=true;this.connectionId=randomUUID();this.hedge=Boolean(mode.dualSidePosition);this.tradingEnabled=permitted;this.connectionError=null;this.writeError=null;this.credentialError=null;this.reconnectAt=0;this.accountSnapshot=this.normalizeAccount(account,positions,orders);this.accountScope=scope;this.accountAt=this.now();this.lastTimeSync=this.now();this.accountRevisionAt=this.client.accountRevision||0;this.client.configureDataTransport?.(this.state.dataTransport);this.storage.bind();return this.snapshot();
  }
  async disconnect(){return this.serial(async()=>{this.storage.healthy();if(this.hasExposure())throw new Error('봇 포지션 또는 미해결 주문이 남아 있어 연결을 해제할 수 없습니다. 먼저 주문과 포지션을 정리해 주세요.');await this.credentialStore?.clear();this.credentialError=null;this.reconnectAt=0;for(const b of this.state.bots)b.runtime.runEnabled=false;this.client.clearCredentials();this.client=this.clientFactory({environment:this.state.environment});this.client.configureDataTransport?.(this.state.dataTransport);this.connected=false;this.tradingEnabled=false;this.multi.stopFlags();this.state.orderPermission=null;this.accountSnapshot=null;this.accountScope=null;this.connectionError=null;this.note('연결 해제','계좌 연결을 해제하고 저장된 키와 메모리의 키를 제거했습니다.');await this.checkpoint();return this.snapshot();});}
  async setTrading(enabled){return this.serial(async()=>{
    if(typeof enabled!=='boolean')throw new Error('주문 허용은 켜짐 또는 꺼짐으로 지정해 주세요.');
    if(!enabled&&this.storage.stop())return this.snapshot();
    if(enabled&&!this.connected)throw new Error('계좌를 먼저 연결해 주세요.');
    if(enabled&&this.writeError)throw new Error(this.writeError);
    if(this.tradingEnabled===enabled&&this.state.orderPermission?.scope===this.state.scope&&this.state.orderPermission.enabled===enabled)return this.snapshot();
    if(enabled){await this.refreshAccount(true);if(!this.accountSnapshot.canTrade)throw new Error('이 API 키에는 선물 거래 권한이 없습니다.');}
    this.tradingEnabled=enabled;this.state.orderPermission={scope:this.state.scope,enabled};
    if(!enabled){for(const b of this.state.bots)b.runtime.runEnabled=false;this.multi.stopFlags();}
    this.note('주문 권한 변경',enabled?'주문 실행을 허용하고 설정을 저장했습니다. 봇 시작은 개별 선택합니다.':'주문 실행을 끄고 설정을 저장했습니다. 기존 포지션·미체결 주문은 유지됩니다.');
    await this.checkpoint();return this.snapshot();
  });}
  normalizeAccount(account,positions,orders){return accountView(account,positions,orders,this.hedge);}
  async refreshAccount(force=false){if(!this.connected)return null;const revision=this.client.accountRevision||0,push=this.client.userStream?.status==='connected',ttl=this.client.transport?(push?60000:this.state.dataTransport.restIntervalSeconds*1000):4500;if(!force&&this.accountAt&&revision===this.accountRevisionAt&&this.now()-this.accountAt<ttl)return this.accountSnapshot;const [account,positions,orders]=await Promise.all([this.client.account(),this.client.positions(),this.client.openOrders()]);this.accountSnapshot=this.normalizeAccount(account,positions,orders);this.accountAt=this.now();this.accountRevisionAt=revision;for(const p of this.accountSnapshot.positions)this.client.streams?.touch('premium',p.symbol);return this.accountSnapshot;}
  liveAccount(){const account=this.accountSnapshot,streams=this.client.streams;if(!account||!streams||this.state.dataTransport.mode!=='websocket')return account?withAccountEquity(account):account;return withAccountEquity(account,account.positions.map(p=>{const c=streams.channels.get('market'),hit=c&&streams.fresh('premium:'+p.symbol+':',c),mark=Number(hit?.value?.markPrice);return mark>0?{...p,markPrice:mark,unrealizedProfit:(mark-p.entryPrice)*p.quantity,notional:Math.abs(p.quantity)*mark}:p;}));}
  ownOrders(b){return this.state.orders.filter(o=>o.botId===b.id&&o.scope===this.state.scope);}
  decorate(b){const r=b.runtime,info=r.quantity>0?this.liveAccount()?.positions.find(p=>p.symbol===b.symbol&&(this.hedge?p.positionSide===r.direction:true)):null;const used=info?positionMargin(info,b.leverage,b.margin)*(this.shared.active(b.symbol)?r.quantity/Math.abs(info.quantity):1):r.quantity*r.entryPrice/b.leverage;const reserved=this.ownOrders(b).filter(o=>active(o)&&o.role==='entry').reduce((sum,o)=>sum+o.margin*Math.max(0,1-number(o.appliedQty)/number(o.parameters.quantity)),0);const resetAt=b.statsReset?.scope===this.state.scope?b.statsReset.at:0,fees=this.state.fills.filter(f=>f.scope===this.state.scope&&f.botId===b.id&&f.fee!=null&&f.at>resetAt);return {...this.budgetView(b),statsReset:b.statsReset?.scope===this.state.scope?b.statsReset:null,runtime:{...r,orderRetry:this.postOnly.notice(b),waiting:this.storage.fault?{kind:'storage',message:this.writeError,retryAt:this.storage.fault.retryAt}:r.waiting},fees:fees.filter(f=>f.feeAsset==='USDT').reduce((sum,f)=>sum+number(f.fee),0),costsPending:fees.some(f=>f.feeAsset!=='USDT')||this.ownOrders(b).some(o=>o.appliedQty>0&&!o.feesFetched),budgetMode:b.budgetMode||'fixed',effectiveBudget:this.budgetLimit(b),used,reserved,budgetWarning:used+reserved>this.budgetLimit(b)?'보유·미체결 주문 증거금이 운용예산을 초과했습니다. 새 진입은 남은 예산 안에서만 가능합니다.':null,pnl:r.realized+(info?(this.shared.active(b.symbol)?(info.markPrice-r.entryPrice)*r.quantity*(r.direction==='LONG'?1:-1):info.unrealizedProfit):0),status:r.importPending?'paused':r.runEnabled||r.quantity>0||this.ownOrders(b).some(active)?'running':'paused',task:r.importPending?'imported':r.quantity>0?'position':this.ownOrders(b).some(active)?'waiting':'watching',entryPaused:!r.runEnabled,error:r.error,quantity:r.quantity,entryPrice:r.entryPrice,positionDirection:r.direction};}
  orderView(b,rule=null,direction=b.runtime.direction){return {...this.decorate(b),direction,leverage:this.shared.leverage(b,isEntry(rule?.action)&&!b.runtime.quantity?rule.leverage:b.leverage),entryPercent:rule?.sizePercent??b.entryPercent,order:rule?.order||b.order};}
  snapshot(){return {capabilities:{budgetBaselineReset:true,budgetSelection:true,dynamicBudget:true,availablePercentBudget:true,homeOrderCancellation:true,closeSettlement:true,leveragedProtection:true,botStatisticsReset:true,sharedPositions:this.shared.supported},dataTransport:{settings:this.state.dataTransport,...this.client.transportStatus?.()},version:2,environment:this.state.environment,connected:this.connected,connectionId:this.connectionId,tradingEnabled:this.tradingEnabled,orderPermission:{enabled:this.state.orderPermission?.scope===this.state.scope&&this.state.orderPermission?.enabled===true},credentials:{saved:Boolean(this.credentialStore?.saved),error:this.credentialError,storagePath:this.credentialStore?.filename||null},positionMode:this.hedge?'HEDGE':'ONE_WAY',account:this.connected?this.liveAccount():null,accountAt:this.accountAt,lastTick:this.lastTick,waiting:this.storage.fault?{kind:'storage',message:this.writeError,retryAt:this.storage.fault.retryAt}:this.waiting,requestBudget:this.client?.rate?.snapshot()||null,error:this.writeError||this.connectionError||this.credentialError,storageFault:this.storage.status(),storageHealth:this.state.storageHealth||null,bots:[...this.state.bots.filter(b=>!b.multiBotId).map(b=>this.decorate(b)),...this.multi.snapshot()],positionOwners:this.state.bots.map(b=>this.decorate(b)),manualOrders:this.manual.snapshot(),logs:this.state.logs,fillsRevision:this.state.fills.length,fills:this.state.fills.filter(f=>f.scope===this.state.scope).slice(-300).reverse(),orders:this.state.orders.filter(o=>o.scope===this.state.scope&&active(o)).map(o=>({id:o.id,botId:o.botId,source:o.source||'bot',role:o.role,status:o.status,symbol:o.parameters.symbol,side:o.parameters.side,type:o.parameters.type,quantity:o.parameters.quantity,price:o.parameters.price||o.parameters.triggerPrice,executedQuantity:o.appliedQty,kind:o.kind}))};}
  async saveBot(input){return this.serial(async()=>{this.storage.healthy();
    if(!input||typeof input!=='object')throw new Error('봇 설정을 확인해 주세요.');
    if(input.kind==='multi'||this.multi.has(input.id))return this.multi.save(input);
    if(this.state.bots.find(b=>b.id===input.id)?.multiBotId)throw Error('다중종목 봇 설정에서 수정하세요.');
    const existing=this.state.bots.find(b=>b.id===input.id),base=upgradeActions(upgradeBot({...makeBot(),...input}));
    const allowed=['id','name','symbol','budget','budgetMode','budgetType','budgetPercent','budgetShortfall','budgetFloor','profitReinvestPercent','budgetIncluded','entryPercent','maxEntries','leverage','margin','color','conditionMode','formula','formulaTimeframe','formulaCandle','rules','order','reentry','exit','actionRules'];
    const b=Object.fromEntries(allowed.map(k=>[k,base[k]]));if(!/^[a-zA-Z0-9_-]{1,64}$/.test(b.id))throw new Error('봇 식별자를 확인해 주세요.');
    b.budgetIncluded=input.budgetIncluded===undefined?existing?.budgetIncluded:input.budgetIncluded;b.profitReinvestPercent=input.profitReinvestPercent===undefined?existing?.profitReinvestPercent??100:input.profitReinvestPercent;for(const key of ['budgetType','budgetPercent','budgetShortfall','budgetFloor'])if(input[key]===undefined)b[key]=existing?.[key];
    if(!['mint','lavender','amber'].includes(b.color))throw new Error('캐릭터 색상을 확인해 주세요.');
    const limits=await this.leverageLimits(b.symbol),symbols=(await this.catalog()).map(s=>s.symbol);const errors=validateBot({...b,runtime:existing?.runtime,used:existing?.runtime.quantity*existing?.runtime.entryPrice/b.leverage||0,reserved:existing?this.decorate(existing).reserved:0},this.state.bots,{balance:this.accountSnapshot?.walletBalance??Infinity,symbols,enforceAllocationLimit:false,maxLeverage:existing&&(existing.runtime.quantity>0||this.ownOrders(existing).some(active))?(limits.maxLeverage||125):leverageCap(limits,this.budgetLimit({...b,runtime:existing?.runtime}))});
    await this.budgetSelection.assertSave(b,existing);
    if(errors.length)throw new Error(errors.join('\n'));
    if(existing&&(existing.runtime.quantity>0||this.ownOrders(existing).some(active))){
      const locked=['symbol','margin','leverage'];
      if(locked.some(key=>JSON.stringify(existing[key])!==JSON.stringify(b[key])))throw new Error('보유 포지션·미해결 주문이 있으면 담당 종목·증거금 모드·레버리지는 변경할 수 없습니다.');
    }
    b.statsReset=existing?.statsReset||null;b.name=b.name.trim();b.runtime=existing?{...existing.runtime,runEnabled:false,entryBlocked:null}:initialRuntime();b.runtime.orderRetries={};if(!existing||!existing.runtime.quantity&&!this.ownOrders(existing).some(active))b.runtime.ruleSignals={};if(!budgetIncluded(b))b.runtime.managementEnabled=false;
    if(existing)this.state.bots[this.state.bots.indexOf(existing)]=b;else this.state.bots.push(b);
    this.note(existing?'봇 설정 저장':'봇 생성',`${b.name} · ${b.symbol} · 예산 ${b.budget} USDT · 신규 진입 일시정지`,b.id);await this.checkpoint();this.positionInsights.cache=null;return this.decorate(b);
  });}
  async resetBotStatistics(id){return this.serial(async()=>{
    this.storage.healthy();if(!this.connected)throw Error('계좌를 연결한 뒤 초기화해 주세요.');
    const multi=this.multi.has(id),root=multi?this.multi.get(id):this.bot(id);if(root.multiBotId)throw Error('다중종목 봇 전체에서 초기화하세요.');
    const members=multi?this.multi.workers(root):[root];if(multi&&members.length!==root.legs.length)throw Error('종목별 운용 기록이 누락되어 초기화할 수 없습니다.');
    if(root.runtime.runEnabled||members.some(b=>b.runtime.runEnabled))throw Error('봇을 정지한 뒤 초기화해 주세요.');
    const unsettled=(o,b)=>active(o)||o.parameters.type==='LIMIT'&&(o.orderPolicy||b.order).remainder==='market'&&!o.fallbackDone&&['CANCELED','EXPIRED'].includes(o.status);
    if(members.some(b=>b.runtime.quantity>0||b.runtime.syncHold||this.ownOrders(b).some(o=>unsettled(o,b))))throw Error('보유 포지션·미해결 주문 또는 수량 불일치가 있어 초기화할 수 없습니다.');
    if(members.some(b=>this.ownOrders(b).some(o=>o.appliedQty>0&&!o.feesFetched)))throw Error('체결 수수료 확인이 끝난 뒤 초기화해 주세요.');
    await this.refreshAccount(true);
    for(const symbol of new Set(members.map(b=>b.symbol))){
      if(this.accountSnapshot.positions.some(p=>p.symbol===symbol&&Math.abs(p.quantity)>0))throw Error('이 종목에 실제 보유 포지션이 있어 초기화할 수 없습니다.');
      const standard=await this.client.openOrders(symbol),response=await this.client.openAlgoOrders(symbol),algos=Array.isArray(response)?response:response?.orders;
      if(!Array.isArray(standard)||!Array.isArray(algos))throw Error('거래소 주문 상태를 확인하지 못했습니다.');
      if(standard.length||algos.length)throw Error('이 종목의 미체결·보호 주문을 정리한 뒤 초기화해 주세요.');
    }
    const at=this.now();for(const b of members)b.statsReset={at,scope:this.state.scope,realized:b.runtime.realized};
    if(multi)root.statsReset={at,scope:this.state.scope,realized:this.multi.realized(root)};
    this.positionInsights.cache=null;this.note('봇 기록·통계 초기화',root.name+' · 이 시점부터 새 집계 · 체결 원장과 실제 운용한도 유지',root.id);await this.checkpoint();
    return multi?this.multi.view(root):this.decorate(root);
  });}
  async removeBot(id){return this.serial(async()=>{this.storage.healthy();if(this.multi.has(id))return this.multi.remove(id);const b=this.bot(id);if(b.multiBotId)throw Error('다중종목 봇에서 삭제하세요.');if(b.runtime.quantity>0||this.ownOrders(b).some(active))throw new Error('포지션 또는 미해결 주문이 있는 봇은 삭제할 수 없습니다.');rememberDeletedBot(this.state,b,[b],{now:this.now(),walletBalance:this.accountSnapshot?.walletBalance,availableBalance:this.accountSnapshot?.availableBalance});this.state.bots=this.state.bots.filter(item=>item!==b);this.note('봇 삭제',b.name+'의 설정을 삭제했습니다.',b.id);await this.checkpoint();});}
  bot(id){const b=this.state.bots.find(item=>item.id===id);if(!b)throw new Error('봇을 찾을 수 없습니다.');return b;}
  requireCancellation(){this.storage.healthy();if(!this.connected)throw Error('계좌를 연결한 뒤 주문을 취소하세요.');if(this.writeError)throw Error(this.writeError);}
  requireTrading(){this.storage.healthy();if(!this.connected)throw new Error('설정에서 API 키를 먼저 연결해 주세요.');if(!this.tradingEnabled)throw new Error('연결 설정에서 주문 실행을 허용해 주세요.');if(this.writeError)throw new Error(this.writeError);}
  async startBot(id){return this.serial(()=>{if(this.multi.has(id))return this.multi.start(id);if(this.bot(id).multiBotId)throw Error('다중종목 봇 전체를 시작하세요.');return this.startRuntime(id);});}
  async startRuntime(id){
    this.requireTrading();const b=this.bot(id),r=b.runtime;if(!budgetIncluded(b))throw Error('보관 중인 봇입니다. 운용으로 이동한 뒤 시작하세요.');if(r.runEnabled)return this.decorate(b);
    if(this.manual.records.some(order=>order.botId!==b.id&&(this.shared.supported?order.status==='UNKNOWN':active(order))&&order.parameters.symbol===b.symbol))throw new Error('같은 종목의 별도 수동 주문이 남아 있습니다. 먼저 수동 주문 상태를 확인하고 정리해 주세요.');
    if(!this.shared.supported&&this.state.bots.some(other=>other!==b&&other.symbol===b.symbol&&(other.runtime.runEnabled||other.runtime.quantity>0||this.ownOrders(other).some(active))))throw new Error('같은 종목은 한 봇만 운용할 수 있습니다. 다른 봇의 진입·포지션·주문을 먼저 정리해 주세요.');
    await this.refreshAccount(true);const total=this.allocatedBudget();if(!r.quantity&&b.budgetShortfall!=='available'&&total>this.accountSnapshot.walletBalance+1e-8)throw new Error('전체 봇 배정 예산이 계좌 USDT 잔고를 초과합니다.');
    if(this.shared.supported){await this.shared.ensure(b.symbol);if(!this.shared.active(b.symbol)&&!r.quantity)throw Error('공유 계좌의 미체결 체결을 대조한 뒤 다시 시작해 주세요.');}
    await this.syncBotPosition(b,true);if(r.syncHold)throw new Error(r.error||'거래소와 봇의 포지션 수량이 일치하지 않습니다.');
    if(this.shared.supported&&!await this.shared.ensure(b.symbol))throw Error('공유 계좌의 체결 대조가 먼저 필요합니다.');
    const orders=await this.client.openOrders(b.symbol),algos=await this.client.openAlgoOrders(b.symbol);const algoRows=Array.isArray(algos)?algos:algos.orders||[];
    const known=new Set(this.ownOrders(b).map(o=>o.id));if(!this.shared.supported&&(orders.some(o=>!known.has(o.clientOrderId))||algoRows.some(o=>!known.has(o.clientAlgoId))))throw new Error('이 종목에 봇 소유가 아닌 미체결 주문이 있습니다.');
    if(this.ownOrders(b).some(o=>o.status==='UNKNOWN'))throw new Error('접수 여부가 확인되지 않은 주문이 있어 새 진입을 중단합니다.');
    const info=await this.symbolInfo(b.symbol),limits=await this.leverageLimits(b.symbol);
    if(!r.quantity&&!this.shared.exposure(b.symbol)&&b.actionRules.some(rule=>rule.enabled&&isEntry(rule.action)&&rule.leverage>leverageCap(limits,this.budgetLimit(b))))throw new Error('이 종목과 배정 예산에서 허용하는 진입 조건의 레버리지를 초과합니다.');
    if(this.shared.active(b.symbol)&&this.shared.exposure(b.symbol)){const configs=await this.client.symbolConfig(b.symbol),config=Array.isArray(configs)?configs[0]:configs;this.shared.syncSettings(b.symbol,config);}
    for(const rule of b.actionRules.filter(rule=>rule.enabled)){
      const snapshots=await this.formulaMarkets(b.symbol,rule.formula),{market}=evaluateRuleFormula(rule.formula,snapshots,{...r,leverage:b.leverage},{now:this.now()+(this.client.offset||0)});
      const view=this.orderView(b,rule,actionDirection(rule.action));if(isEntry(rule.action)&&!r.quantity&&this.budgetLimit(b)>0){try{const plan=entryOrder(view,info,{...market.book,lastPrice:market.ticker.lastPrice},this.accountSnapshot.availableBalance,this.hedge);protectiveOrders(view,info,plan.parameters.quantity,Number(plan.parameters.price||market.ticker.lastPrice),this.hedge);}catch(error){if(!isEntryCapacityError(error)||b.budgetShortfall!=='available'&&!isPercentBudget(b))throw error;}}
    }
    if(!r.quantity&&!this.ownOrders(b).some(active)&&(!this.shared.active(b.symbol)||!this.shared.exposure(b.symbol))){
      try{await this.client.changeMargin(b.symbol,b.margin);}catch(e){if(e.code!==-4046)throw e;}
    }
    const configRows=await this.client.symbolConfig(b.symbol),config=Array.isArray(configRows)?configRows[0]:configRows;
    if(!Number.isInteger(Number(config?.leverage))||number(config.leverage)<1||number(config.leverage)>MAX_LEVERAGE||String(config?.marginType).toUpperCase()!==b.margin||r.quantity&&number(config.leverage)!==b.leverage)throw new Error('거래소의 증거금 모드·레버리지가 봇 설정과 일치하지 않습니다.');
    b.leverage=number(config.leverage);if(this.shared.active(b.symbol))this.shared.syncSettings(b.symbol,config);
    r.runEnabled=true;r.managementEnabled=true;r.entryBlocked=null;r.importPending=false;for(const rule of b.actionRules.filter(rule=>isStop(rule.action)))delete r.ruleSignals[rule.id];r.error=null;r.waiting=null;r.lastSignal=null;r.lastBar=null;r.syncHold=false;this.note('조건 감시 시작',`${b.name} · ${b.symbol} · ${this.state.environment==='live'?'실전':'테스트넷'}`,b.id);await this.checkpoint();return this.decorate(b);
  }
  async pauseBot(id){return this.serial(()=>{if(this.storage.stop(id))return this.multi.has(id)?this.multi.view(this.multi.get(id)):this.decorate(this.bot(id));if(this.multi.has(id))return this.multi.pause(id);const b=this.bot(id);if(b.multiBotId)throw Error('다중종목 봇 전체를 정지하세요.');return this.pauseRuntime(b);});}
  async pauseRuntime(b){if(this.storage.stop(b.id))return this.decorate(this.bot(b.id));b.runtime.runEnabled=false;b.runtime.entryBlocked=null;await this.checkpoint();if(this.tradingEnabled)for(const o of this.ownOrders(b).filter(o=>active(o)&&o.role==='entry'))await this.cancelStandard(b,o,true);this.note('신규 진입 중지',`${b.name} · 미체결 진입 취소 확인 · 보유 포지션과 청산 주문은 계속 관리합니다.`,b.id);await this.checkpoint();return this.decorate(b);}
  async submit(b,parameters,{kind='standard',role='entry',margin=0,group=null,guardKey=null,parent=null,ruleId=null,direction=b.runtime.direction,orderPolicy=null,timeframe=null,closeScope='bot',closeIntentId=null,onPostOnlyRejected=null}={}){
    this.requireTrading();const sequence=this.state.nextIntent++;const id='fw_'+createHash('sha256').update(b.id+this.state.scope).digest('hex').slice(0,9)+'_'+sequence;
    const order={id,botId:b.id,scope:this.state.scope,kind,role,parameters:{...parameters},margin,group:group||id,guardKey,status:'UNKNOWN',createdAt:this.now(),appliedQty:0,appliedQuote:0,feesFetched:false,parent,ruleId,direction,orderPolicy,timeframe,closeScope,closeIntentId,positionEpoch:role==='entry'?null:this.rulePosition(b,{closeScope,action:'EXIT_'+direction}).positionEpoch,leverage:b.leverage,marginType:b.margin};
    const parentOrder=parent?this.state.orders.find(o=>o.id===parent):null,parentFallback=parentOrder?.fallbackDone;if(parentOrder)parentOrder.fallbackDone=true;
    this.state.orders.push(order);await this.checkpoint();
    try{
      const result=kind==='algo'?await this.client.placeAlgo({...parameters,clientAlgoId:id}):await this.client.placeOrder({...parameters,newClientOrderId:id});
      order.acceptedAt=this.now();
      if(kind==='algo'){order.status=result.algoStatus||'NEW';order.algoId=result.algoId;}else await this.applyOrder(b,order,result);this.postOnly.accepted(b,order);
    }catch(error){order.error=this.client.redact?.(error.message)||error.message;order.errorCode=error.code??null;if(!error.uncertain)order.status='REJECTED';if(isRateLimited(error)){order.retryable=true;if(parentOrder)parentOrder.fallbackDone=parentFallback;await this.checkpoint();throw error;}if(ruleId&&isPostOnlyRejection(error,parameters,kind)){this.postOnly.rejected(b,order,error);onPostOnlyRejected?.();await this.checkpoint();return order;}if(await this.closeRecovery.rejected(b,order,error)){await this.checkpoint();return order;}b.runtime.error=order.error;b.runtime.runEnabled=false;this.note(error.uncertain?'주문 접수 확인 필요':'주문 거절',`${b.name} · ${order.error}`,b.id,'error');}
    await this.checkpoint();return order;
  }
  recordBudgetProfit(b,gross){const root=b.multiBotId?this.multi.get(b.multiBotId):b;root.runtime.budgetWithheld=(Number(root.runtime.budgetWithheld)||0)+withheldProfit(root,gross);}
  async applyOrder(b,o,data){
    const quantity=number(data.executedQty),quote=number(data.cumQuote||data.cumQuoteQty)||(quantity*number(data.avgPrice));
    if(o.parameters.symbol!==b.symbol&&(sharedQuantityPending(quantity,number(o.appliedQty))||sharedQuantityPending(number(o.appliedQty),quantity)))throw new Error('이전 종목 '+o.parameters.symbol+' 주문의 체결 수량 대조가 필요합니다. 현재 종목 포지션은 변경하지 않았습니다.');
    if(this.shared.active(o.parameters.symbol)&&o.kind!=='ledger'){await this.shared.accepted(b,o,data);return;}
    if(quantity+1e-12<o.appliedQty)throw new Error('주문 누적 체결 수량이 감소했습니다. 새 진입을 중단합니다.');
    const delta=quantity-o.appliedQty,r=b.runtime,beforeQuantity=r.quantity,beforePrice=r.entryPrice;
    if(delta>1e-12){const value=quote-o.appliedQuote;if(!(value>0))throw new Error('체결 금액을 확인할 수 없습니다.');const fillPrice=value/delta;
      if(o.role==='entry'){
        if(r.quantity>0&&r.direction!==(o.direction||r.direction))throw new Error('반대 방향 진입 체결을 확인했습니다. 계좌를 확인해 주세요.');
        if(!r.quantity)r.positionEpoch++;r.direction=o.direction||r.direction||'LONG';
        if(!this.ownOrders(b).some(other=>other!==o&&other.group===o.group&&other.counted)&&!o.counted)r.entries++;
        o.counted=true;r.entryPrice=(r.quantity*r.entryPrice+value)/(r.quantity+delta);r.quantity+=delta;r.lastEntryAt=this.now();
      }else{const closed=Math.min(r.quantity,delta);const gross=(fillPrice-r.entryPrice)*closed*(b.runtime.direction==='LONG'?1:-1);r.realized+=gross;this.recordBudgetProfit(b,gross);r.quantity=Math.max(0,r.quantity-delta);if(r.quantity<1e-12){r.quantity=0;r.entryPrice=0;r.entries=0;r.entryBlocked=null;r.lastExitAt=this.now();}}
      this.state.fills.push({id:o.id+':'+quantity,scope:o.scope,botId:b.id,at:this.now(),symbol:b.symbol,side:o.parameters.side,role:o.role,action:o.role==='entry'?'ENTER_'+o.direction:o.ruleId?'EXIT_'+o.direction:'CLOSE',ruleId:o.ruleId,quantity:delta,price:fillPrice,clientOrderId:o.id,orderId:data.orderId||o.orderId,direction:o.direction||r.direction,leverage:o.leverage||b.leverage,positionEpoch:r.positionEpoch,tradeTime:Number(data.updateTime||data.time)||null});
      this.excursions.fill(b,{epoch:r.positionEpoch,role:o.role,quantity:delta,price:fillPrice,direction:o.direction||r.direction,leverage:o.leverage||b.leverage,at:Number(data.updateTime||data.time)||this.now(),beforeQuantity,beforePrice});
      this.note('체결 확인',`${b.name} · ${o.parameters.side} ${delta} · ${fillPrice}`,b.id);
    }
    o.appliedQty=quantity;o.appliedQuote=quote;o.status=data.status||o.status;o.orderId=data.orderId||o.orderId;
  }
  async refreshOrder(b,o,{includeFees=true}={}){
    if(includeFees&&reconcileConfirmedSharedFees(this.state,o)&&!active(o))return;
    const symbol=o.parameters.symbol;
    try{
      if(o.kind==='algo'){
        const data=await this.client.queryAlgo(o.id);o.algoStatus=data.algoStatus;
        if(data.actualOrderId&&String(data.actualOrderId)!=='0'){o.childOrderId=data.actualOrderId;await this.applyOrder(b,o,await this.client.queryOrder(symbol,{orderId:data.actualOrderId}));}
        else o.status=['NEW','TRIGGERING','TRIGGERED'].includes(data.algoStatus)?data.algoStatus==='NEW'?'NEW':'UNKNOWN':data.algoStatus||'UNKNOWN';
      }else await this.applyOrder(b,o,await this.client.queryOrder(symbol,o.id));
      if(includeFees&&!active(o)&&o.orderId&&!o.feesFetched&&!o.sharedManaged){const fills=await this.client.trades(symbol,o.orderId);for(const trade of fills){const legacyKey='fee:'+o.orderId+':'+trade.id,key='fee:'+o.scope+':'+symbol+':'+o.orderId+':'+trade.id;if(this.state.fills.some(f=>f.id===key||f.id===legacyKey&&f.scope===o.scope&&f.botId===b.id&&f.symbol===symbol))continue;const fee=number(trade.commission);if(trade.commissionAsset==='USDT')b.runtime.realized-=fee;this.state.fills.push({id:key,scope:o.scope,botId:b.id,at:number(trade.time)||this.now(),symbol,fee,feeAsset:trade.commissionAsset,clientOrderId:o.id,orderId:o.orderId,tradeId:trade.id,tradeQuantity:Number(trade.qty)||null,tradePrice:Number(trade.price)||null,positionEpoch:this.state.fills.find(f=>f.scope===o.scope&&f.clientOrderId===o.id&&f.quantity>0)?.positionEpoch??null,leverage:o.leverage||null,direction:o.direction});}o.feesFetched=true;}
    }catch(error){if([-2013,-2011,-4143].includes(error.code)){o.lastQueryError=error.code;if(o.status==='UNKNOWN'&&!knownOrderSettlement(o))b.runtime.error='주문 접수 여부가 아직 확인되지 않았습니다. 중복 전송하지 않고 조회를 계속합니다.';}else throw error;}
  }
  async cancelStandard(b,o,abortRemainder=false){this.storage.healthy();if(abortRemainder){o.fallbackDone=true;await this.checkpoint();}try{o.timing||={};o.timing.cancelRequestedAt||=this.now();const result=await this.client.cancelOrder(b.symbol,o.id);await this.applyOrder(b,o,result);if(o.status==='CANCELED')o.timing.cancelConfirmedAt||=this.now();}catch(error){if(![-2011,-2013].includes(error.code)&&!error.uncertain)throw error;}await this.refreshOrder(b,o);if(o.status==='CANCELED'){o.timing||={};o.timing.cancelConfirmedAt||=this.now();}await this.checkpoint();}
  async cancelGuard(b,o){this.storage.healthy();try{await this.client.cancelAlgo(o.id);}catch(error){if(![-2011,-2013,-4143].includes(error.code)&&!error.uncertain)throw error;}await this.refreshOrder(b,o);await this.checkpoint();}
  positionMatches(b){
    if(this.shared.active(b.symbol))return !this.shared.book(b.symbol).pending&&this.shared.matches(b.symbol,this.shared.book(b.symbol));
    const positions=this.accountSnapshot?.positions.filter(p=>p.symbol===b.symbol)||[],expected=b.runtime.quantity;
    const own=positions.find(p=>this.hedge?p.positionSide===b.runtime.direction:true),other=positions.some(p=>this.hedge&&!b.runtime.imported&&p.positionSide!==b.runtime.direction&&Math.abs(p.quantity)>0),actual=Math.abs(own?.quantity||0);
    const reversed=!this.hedge&&own&&((own.quantity>0)!==(b.runtime.direction==='LONG'));
    const priceMatches=!expected||!actual||Math.abs(number(own?.entryPrice)-b.runtime.entryPrice)<=Math.max(1e-8,b.runtime.entryPrice*1e-8);
    return !other&&!reversed&&priceMatches&&Math.abs(actual-expected)<=1e-9;
  }
  async syncBotPosition(b,immediate=false){
    const r=b.runtime;if(this.shared.supported&&!this.shared.active(b.symbol))await this.shared.ensure(b.symbol);if(this.shared.active(b.symbol)){const ready=await this.shared.sync(b.symbol,{force:immediate});r.syncHold=!ready;if(ready&&r.error===POSITION_MISMATCH_ERROR)r.error=null;return;}
    if(!this.positionMatches(b)){
      const revision=this.client.accountRevision||0,signature=JSON.stringify([r.quantity,r.entryPrice,r.direction,this.accountSnapshot?.positions.filter(p=>p.symbol===b.symbol).map(p=>[p.quantity,p.entryPrice,p.positionSide])]),previous=this.positionChecks.get(b);
      // Account and order streams need not arrive together. Verify owned executions
      // before treating an observed account change as an external position change.
      if(immediate||!previous||previous.client!==this.client||previous.revision!==revision||previous.signature!==signature||this.now()-previous.at>=5000){
        this.positionChecks.set(b,{at:this.now(),revision,signature,client:this.client});
        for(const order of this.ownOrders(b).filter(o=>active(o)&&o.parameters.symbol===b.symbol))await this.pollTrackedOrder(order,()=>this.refreshOrder(b,order),{force:true});
        await this.refreshAccount(true);
      }
    }
    if(this.positionMatches(b)){
      const recovered=r.syncHold;r.syncHold=false;r.mismatchSince=0;
      if(r.error===POSITION_MISMATCH_ERROR)r.error=null;
      if(recovered)this.note('포지션 대조 완료',b.name+' · 봇 체결 원장과 거래소 보유 수량이 일치합니다.',b.id);
      return;
    }
    r.syncHold=true;r.mismatchSince||=this.now();
    if(await this.positionReconciliation.reconcile(b,POSITION_MISMATCH_ERROR))return;
    if(immediate||this.now()-r.mismatchSince>15000){r.runEnabled=false;r.error=POSITION_MISMATCH_ERROR;}
  }
  guardWait(b,message){const r=b.runtime;r.guardWaiting=true;r.waiting={kind:'order-settlement',message,retryAt:this.now()+3000};if(r.error==='보호 주문 변경을 위한 기존 주문의 취소 확인을 기다립니다.')r.error=null;return false;}
  clearGuardWait(b){const r=b.runtime;if(r.error==='보호 주문 변경을 위한 기존 주문의 취소 확인을 기다립니다.')r.error=null;if(r.guardWaiting){delete r.guardWaiting;if(r.waiting?.kind==='order-settlement'&&!r.closePending)r.waiting=null;}}
  async ensureGuards(b,info){
    const r=b.runtime,guards=this.ownOrders(b).filter(o=>o.kind==='algo'&&active(o));
    if(!r.quantity){for(const o of guards)await this.cancelGuard(b,o);r.guardKey=null;if(this.ownOrders(b).some(o=>o.kind==='algo'&&active(o)))return this.guardWait(b,'기존 보호 주문 취소 확인 중 · 확인 후 자동 계속');this.clearGuardWait(b);return true;}
    if(r.syncHold)return false;
    const key=[r.quantity,r.entryPrice,b.exit.stopLoss,b.exit.takeProfit,b.exit.price,protectionEnabled(b.exit,'stopLoss'),protectionEnabled(b.exit,'takeProfit'),...(protectionBasis(b.exit)==='leveraged'?['leveraged',b.leverage]:[])].join(':');
    const desired=protectiveOrders(this.orderView(b),info,r.quantity,r.entryPrice,this.hedge);
    for(const plan of desired){const existing=guards.find(o=>o.guardKey===key&&o.role===plan.role);if(existing){if(existing.status==='UNKNOWN')return knownOrderSettlement(existing)?this.guardWait(b,'보호 주문 체결 확인 중 · 확인 후 자동 계속'):false;continue;}
      const rejected=this.ownOrders(b).find(o=>o.guardKey===key&&o.role===plan.role&&o.status==='REJECTED'&&!o.retryable);if(rejected)throw new Error('보호 주문이 거절되었습니다: '+rejected.error);
      const o=await this.submit(b,plan.parameters,{kind:'algo',role:plan.role,guardKey:key});if(o.status!=='NEW')return false;
    }
    r.guardKey=desired.length?key:null;await this.checkpoint();
    const current=o=>o.guardKey===key&&desired.some(plan=>plan.role===o.role);
    for(const old of guards.filter(o=>!current(o)))await this.cancelGuard(b,old);
    const pendingMessage='보호 주문 변경을 위한 기존 주문의 취소 확인을 기다립니다.';
    if(this.ownOrders(b).some(o=>o.kind==='algo'&&active(o)&&!current(o)))return this.guardWait(b,pendingMessage);
    this.clearGuardWait(b);
    return true;
  }
  async closeBot(id){return this.serial(async()=>{if(this.multi.has(id))return this.multi.close(id);this.requireTrading();const b=this.bot(id);b.runtime.runEnabled=false;await this.closePosition(b,'사용자 전량 청산');return this.decorate(b);});}
  async cancelBotOrder(id,orderId){return this.serial(()=>this.cancelBotOrderRuntime(id,orderId));}
  async cancelBotOrderRuntime(id,orderId){this.requireCancellation();const b=this.bot(id),order=this.ownOrders(b).find(o=>o.id===orderId&&o.kind==='standard');if(!order)throw new Error('이 봇의 일반 주문을 찾을 수 없습니다.');await this.refreshOrder(b,order);if(order.status==='UNKNOWN')throw new Error('접수 여부 확인 후 취소할 수 있습니다.');if(active(order))await this.cancelStandard(b,order,true);await this.refreshAccount(true);await this.syncBotPosition(b,true);if(this.tradingEnabled&&!b.runtime.syncHold)await this.ensureGuards(b,await this.symbolInfo(b.symbol));this.note('사용자 미체결 취소',b.name+' · '+order.status+' · 잔량 시장가 전환 중단',b.id);await this.checkpoint();return this.decorate(b);}
  async closePosition(b,reason){return this.closeFlow.request(b,reason);}

  async tick({deadlinesOnly=false}={}){return this.serial(async()=>{
    this.lastTick=this.now();if(this.storage.fault&&!await this.storage.recover())return;if(!this.connected)return;
    const blockedUntil=this.client.rate?.blockedUntil||0;if(this.now()<blockedUntil&&(!this.waiting||this.waiting.retryAt<blockedUntil)){this.defer({status:429,retryAt:blockedUntil});await this.checkpoint();}
    if(this.now()<(this.waiting?.retryAt||0))return;
    let deferred=false;const handled=new Set(),service=()=>this.deadlines.run(handled);
    try{
      if(this.now()-this.lastTimeSync>60000)await this.availableRead(async()=>{await this.client.syncTime();this.lastTimeSync=this.now();});
      await service();if(deadlinesOnly){this.excursions.observe();await this.checkpoint();return;}
      await service();await this.availableRead(()=>this.manual.refreshPending({beforeEach:service}));
      for(const b of this.state.bots)for(const o of this.ownOrders(b).filter(o=>active(o)||!o.feesFetched&&o.orderId)){await service();if(active(o)||!o.feesFetched&&o.orderId)await this.availableRead(()=>this.pollTrackedOrder(o,()=>this.refreshOrder(b,o)));}
      await service();const account=await this.availableRead(()=>this.refreshAccount());await service();await this.availableRead(()=>this.shared.syncAll({beforeEach:service}));if(account)this.connectionError=null;
      for(const b of this.state.bots){
        await service();if(handled.has(b.multiBotId?'multi:'+b.multiBotId:b.id))continue;
        try{await this.tickBot(b);if(!b.runtime.closeRecovery&&!b.runtime.closePending&&!b.runtime.guardWaiting)b.runtime.waiting=null;}
        catch(error){if(isStorageError(error))throw error;if(isTemporary(error)){const wait=this.defer(error);if(isLocalRateLimit(error)){b.runtime.waiting=wait;continue;}deferred=true;break;}b.runtime.runEnabled=false;b.runtime.waiting=null;b.runtime.error=this.client.redact?.(error.message)||error.message;this.note('봇 확인 필요',b.name+' · '+b.runtime.error,b.id,'error');}
      }
      if(!deferred){for(const p of this.multi.groups){await service();if(handled.has('multi:'+p.id))continue;try{await this.multi.tick(p);p.runtime.waiting=null;}catch(error){if(isStorageError(error))throw error;if(isTemporary(error)){const wait=this.defer(error);if(isLocalRateLimit(error)){p.runtime.waiting=wait;continue;}deferred=true;break;}p.runtime.runEnabled=false;p.runtime.cancelEntries=true;p.runtime.error=this.client.redact?.(error.message)||error.message;for(const b of this.multi.workers(p))b.runtime.runEnabled=false;this.note('다중종목 확인 필요',p.name+' · '+p.runtime.error,p.id,'error');}}}
      if(!deferred)this.waiting=null;
    }catch(error){if(!isTemporary(error))throw error;this.defer(error);}
    this.excursions.observe();await this.checkpoint();
  });}
  async settlePending(b,info){
    const r=b.runtime;
    for(const o of this.ownOrders(b).filter(o=>o.kind==='standard'&&o.parameters.type==='LIMIT'&&!o.fallbackDone)){
      if(o.fallbackDone)continue;const policy=o.orderPolicy||b.order;
      if(o.role!=='entry'&&this.closeRecovery.stale(b,o)){if(active(o))await this.cancelStandard(b,o,true);else o.fallbackDone=true;continue;}
      if(o.role!=='entry'&&o.closeScope!=='account'&&!r.quantity&&active(o))await this.cancelStandard(b,o,true);
      if(!active(o)&&!['CANCELED','EXPIRED'].includes(o.status)){o.fallbackDone=true;continue;}
      if(this.now()-o.createdAt<policy.timeout*1000)continue;
      o.timing||={};o.timing.deadlineAt=o.createdAt+policy.timeout*1000;o.timing.timeoutCheckedAt||=this.now();
      if(active(o))await this.cancelStandard(b,o);
      if(o.fallbackDone)continue;
      const remainder=number(o.parameters.quantity)-o.appliedQty;
      if(!active(o)&&['CANCELED','EXPIRED'].includes(o.status)&&policy.remainder==='market'&&remainder>1e-12&&(o.role!=='entry'||r.runEnabled)){
        await this.refreshAccount(true);await this.syncBotPosition(b,true);if(r.syncHold)return;
        if(o.role!=='entry'){if(this.closeRecovery.stale(b,o)){o.fallbackDone=true;continue;}const siblings=this.ownOrders(b).filter(other=>other!==o&&other.kind==='standard'&&other.role!=='entry'&&active(other)&&other.parameters.side===o.parameters.side);if(siblings.length){if(siblings.some(other=>other.status==='UNKNOWN'))return;if(siblings.reduce((sum,other)=>sum+Math.max(0,number(other.parameters.quantity)-number(other.appliedQty)),0)>=remainder-1e-9){o.fallbackDone=true;o.remainderResolution='covered-by-existing-close';}continue;}}
        const market=await this.market(b.symbol,o.timeframe||b.formulaTimeframe),filters=symbolFilters(info,'MARKET');
        let quantity=quantize(String(o.role==='entry'?remainder:Math.min(remainder,this.rulePosition(b,{closeScope:o.closeScope,action:'EXIT_'+(o.direction||r.direction)}).quantity)),filters.step);
        if(number(quantity)<filters.minQty||o.role==='entry'&&number(quantity)*number(market.ticker.lastPrice)<filters.minNotional){o.fallbackDone=true;continue;}
        const view=this.orderView(b,{sizePercent:100,order:{...policy,type:'MARKET'}},o.direction||r.direction);
        let parameters,margin=0;
        if(o.role==='entry'){let plan;try{plan=entryOrder(view,info,{...market.book,lastPrice:market.ticker.lastPrice},this.accountSnapshot.availableBalance,this.hedge);}catch(error){if(!isEntryCapacityError(error))throw error;o.fallbackDone=true;this.blockEntry(b,{id:o.ruleId,sizePercent:100,order:policy,leverage:b.leverage},error);continue;}quantity=quantize(String(Math.min(number(quantity),number(plan.parameters.quantity))),filters.step);parameters={...plan.parameters,quantity};margin=number(quantity)*number(market.ticker.lastPrice)/b.leverage;}
        else parameters=exitOrder(view,info,market.book,quantity,this.hedge);
        if(number(quantity)>=filters.minQty)await this.submit(b,parameters,{role:o.role,margin,group:o.group,parent:o.id,ruleId:o.ruleId,direction:o.direction,orderPolicy:{...policy,type:'MARKET'},timeframe:o.timeframe,closeScope:o.closeScope||'bot'});
        else o.fallbackDone=true;
      }else if(!active(o))o.fallbackDone=true;
    }
  }
  rulePosition(b,rule){
    if(rule?.closeScope!=='account'||isEntry(rule.action)||isStop(rule.action))return {...b.runtime,leverage:b.leverage};
    const direction=actionDirection(rule.action),position=this.liveAccount()?.positions.find(p=>p.symbol===b.symbol&&(!direction||(p.quantity>0?'LONG':'SHORT')===direction));
    return {...b.runtime,quantity:Math.abs(position?.quantity||0),entryPrice:position?.entryPrice||0,direction:position?(position.quantity>0?'LONG':'SHORT'):direction,leverage:position?.leverage||b.leverage,positionEpoch:this.shared.book(b.symbol)?.epochs?.[position?(position.quantity>0?'LONG':'SHORT'):direction]??b.runtime.positionEpoch};
  }
  async evaluateRules(b,{phase='all',markets=new Map(),append=false,cachedOnly=false}={}){
    const r=b.runtime,results=[];r.ruleSignals||={};
    for(const rule of b.actionRules.filter(rule=>rule.enabled)){
      if(phase==='management'&&isEntry(rule.action)||phase==='entry'&&!isEntry(rule.action))continue;
      if(isEntry(rule.action)&&(!r.runEnabled||r.quantity&&r.direction!==actionDirection(rule.action)))continue;
      if(cachedOnly&&formulaMarketRequests(b.symbol,rule.formula).some(item=>!markets.has(item.key)))continue;
      if(isStop(rule.action)&&!r.runEnabled)continue;
      const position=this.rulePosition(b,rule);if(!isStop(rule.action)&&!isEntry(rule.action)&&(!position.quantity||actionDirection(rule.action)&&actionDirection(rule.action)!==position.direction))continue;
      const snapshots=await this.formulaMarkets(b.symbol,rule.formula,markets),{market,result,bar,interval}=evaluateRuleFormula(rule.formula,snapshots,position,{now:this.now()+(this.client.offset||0)});
      const signal=r.ruleSignals[rule.id]||={fired:false,lastBar:null,lastExecutionAt:0,epoch:position.positionEpoch};
      if(!isEntry(rule.action)&&signal.epoch!==position.positionEpoch){signal.fired=false;signal.lastBar=null;signal.epoch=position.positionEpoch;}
      this.postOnly.observe(b,rule,result);if(!result.missing&&!result.pass)signal.fired=false;
      signal.lastEvaluation={at:this.now(),bar,interval,pass:result.pass,missing:result.missing};
      const ready=isStop(rule.action)?!signal.fired:rule.reentry.mode==='bar'?signal.lastBar!==bar:rule.reentry.mode==='cooldown'?this.now()-signal.lastExecutionAt>=rule.reentry.cooldown*1000:!signal.fired;
      const eligible=isStop(rule.action)?r.runEnabled:isEntry(rule.action)?r.runEnabled&&(!r.quantity||r.direction===actionDirection(rule.action))&&(!b.maxEntries||r.entries<b.maxEntries)&&this.now()-r.lastExitAt>=(rule.reentry.afterExitCooldown??rule.reentry.cooldown)*1000:true;
      results.push({rule,signal,market,bar,interval,ready:eligible&&ready&&!result.missing&&result.pass&&this.postOnly.ready(b,rule)});
    }
    r.lastEvaluation={at:this.now(),rules:[...(append?r.lastEvaluation?.rules||[]:[]),...results.map(x=>({id:x.rule.id,action:x.rule.action,...x.signal.lastEvaluation,ready:x.ready}))]};return results;
  }
  async prepareEntryLeverage(b,target){
    this.requireTrading();
    const getConfig=async()=>{const rows=await this.client.symbolConfig(b.symbol);return Array.isArray(rows)?rows.find(row=>row.symbol===b.symbol)||rows[0]:rows;};
    let config=await getConfig();
    if(this.shared.active(b.symbol)&&this.shared.exposure(b.symbol)){this.shared.syncSettings(b.symbol,config);await this.checkpoint();return;}
    if(!Number.isInteger(target)||target<1||target>MAX_LEVERAGE||String(config?.marginType).toUpperCase()!==b.margin)throw new Error('진입 전 증거금 모드·레버리지를 확인해 주세요.');
    if(b.runtime.quantity&&number(config?.leverage)!==b.leverage)throw new Error('보유 포지션의 레버리지가 변경되었습니다. 계좌 설정을 확인해 주세요.');
    if(number(config?.leverage)!==target){
      if(b.runtime.quantity||this.accountSnapshot.positions.some(p=>p.symbol===b.symbol&&Math.abs(p.quantity)>0)||this.accountSnapshot.orders.some(o=>o.symbol===b.symbol)||this.ownOrders(b).some(active))throw new Error('같은 종목에 포지션·미체결 주문이 있어 레버리지를 바꿀 수 없습니다.');
      // A failed or uncertain configuration response must never continue to an order.
      const response=await this.client.changeLeverage(b.symbol,target);if(number(response?.leverage)!==target)throw new Error('거래소 레버리지 적용 응답을 확인하지 못했습니다.');
      config=await getConfig();if(number(config?.leverage)!==target||String(config?.marginType).toUpperCase()!==b.margin)throw new Error('거래소 레버리지 적용을 확인하지 못했습니다.');
      await this.refreshAccount(true);
    }
    b.leverage=target;if(this.shared.active(b.symbol))this.shared.syncSettings(b.symbol,config);await this.checkpoint();
  }
  entryKey(b,rule){const r=b.runtime;return JSON.stringify([b.symbol,b.budget,b.budgetMode,this.budgetLimit(b),r.quantity,r.entryPrice,r.positionEpoch,b.leverage,rule.id,rule.sizePercent,rule.leverage,rule.order,this.accountSnapshot?.availableBalance]);}
  async entryRetryReady(b,rule){
    const block=b.runtime.entryBlocked;if(!block)return true;
    const ready=block.ruleId!==rule.id||block.key!==this.entryKey(b,rule)||this.now()>=block.retryAt;
    if(!ready){if(b.runtime.lastEvaluation)b.runtime.lastEvaluation.budgetBlocked=true;return false;}
    if(this.now()-this.accountAt>=5000)await this.refreshAccount(true);
    return true;
  }
  blockEntry(b,rule,error){
    const r=b.runtime,previous=r.entryBlocked,key=this.entryKey(b,rule),label=error.reason==='no-margin'?'진입 대기 · 예산 부족':error.reason==='min-quantity'?'진입 대기 · 최소 수량':'진입 대기 · 최소 금액',message=error.message+' 조건 감시와 보유 포지션 정리는 계속하며, 주문 가능한 금액이 생기면 다시 확인합니다.';
    r.entryBlocked={reason:error.reason,label,message,ruleId:rule.id,key,at:previous?.at||this.now(),checkedAt:this.now(),retryAt:this.now()+Math.max(5000,Math.min(30000,(this.state.dataTransport?.restIntervalSeconds||15)*1000)),...error.details};
    if(r.lastEvaluation){r.lastEvaluation.budgetBlocked=true;r.lastEvaluation.entryBlocked=r.entryBlocked;}
    if(!previous||previous.ruleId!==rule.id||previous.reason!==error.reason||previous.key!==key)this.note('진입 대기',b.name+' · '+error.message,b.id);
    return {blocked:true};
  }
  async executeRule(b,item,info){
    const {rule,signal,market,bar}=item,r=b.runtime;if(!this.postOnly.ready(b,rule))return {deferred:true};let parameters,margin=0;
    if(isStop(rule.action)){
      signal.fired=true;signal.lastBar=bar;signal.lastExecutionAt=this.now();await this.pauseRuntime(b);
      this.note('조건 정지',b.name+' · 조건식 충족으로 신규 진입을 정지했습니다.',b.id);await this.checkpoint();return;
    }
    if(r.closeRecovery||r.closePending||this.ownOrders(b).some(knownOrderSettlement))return {deferred:true};
    if(this.ownOrders(b).some(o=>o.role!=='entry'&&pendingMarketRemainder(o,b))){await this.settlePending(b,info);return {deferred:true};}
    if(isEntry(rule.action)){
      try{
      await this.refreshAccount(true);await this.syncBotPosition(b);if(r.syncHold)return;
      const view=this.orderView(b,rule,actionDirection(rule.action));let plan=entryOrder(view,info,{...market.book,lastPrice:market.ticker.lastPrice},this.accountSnapshot.availableBalance,this.hedge);
      protectiveOrders(view,info,plan.parameters.quantity,number(plan.parameters.price||market.ticker.lastPrice),this.hedge);
      await this.prepareEntryLeverage(b,view.leverage);
      plan=entryOrder(view,info,{...market.book,lastPrice:market.ticker.lastPrice},this.accountSnapshot.availableBalance,this.hedge);
      protectiveOrders(view,info,plan.parameters.quantity,number(plan.parameters.price||market.ticker.lastPrice),this.hedge);parameters=plan.parameters;margin=plan.margin;r.direction=actionDirection(rule.action);

      r.entryBlocked=null;
      }catch(error){if(isEntryCapacityError(error))return this.blockEntry(b,rule,error);throw error;}
    }else{
      for(const o of this.ownOrders(b).filter(o=>active(o)&&o.role==='entry'))await this.cancelStandard(b,o,true);
      if(this.ownOrders(b).some(o=>active(o)&&o.kind==='standard'))return;
      await this.refreshAccount(true);await this.syncBotPosition(b);const position=this.rulePosition(b,rule);if(r.syncHold||!position.quantity)return;
      parameters=exitOrder({...this.orderView(b,rule),direction:position.direction},info,{...market.book,lastPrice:market.ticker.lastPrice},rule.sizePercent===100?position.quantity:position.quantity*rule.sizePercent/100,this.hedge);
    }
    const previousSignal={...signal},previousLastBar=r.lastBar,previousEntryAt=r.lastEntryAt;
    signal.fired=true;signal.lastBar=bar;signal.lastExecutionAt=this.now();if(isEntry(rule.action)){r.lastBar=bar;r.lastEntryAt=this.now();}
    this.note('조건 행동 실행',b.name+' · '+ACTIONS[rule.action]+' · '+rule.sizePercent+'%',b.id);
    let intent;try{intent=await this.submit(b,parameters,{role:isEntry(rule.action)?'entry':'exit',margin,ruleId:rule.id,direction:isEntry(rule.action)?r.direction:this.rulePosition(b,rule).direction,orderPolicy:rule.order,timeframe:item.interval,closeScope:rule.closeScope||'bot',onPostOnlyRejected:()=>{Object.assign(signal,previousSignal);r.lastBar=previousLastBar;r.lastEntryAt=previousEntryAt;}});}catch(error){if(isRateLimited(error)){Object.assign(signal,previousSignal);r.lastBar=previousLastBar;r.lastEntryAt=previousEntryAt;await this.checkpoint();}throw error;}
    if(intent.status==='REJECTED'&&!['post-only','reduce-only-reconcile','reduce-only-resolved','reduce-only-unresolved'].includes(intent.errorKind)&&r.quantity)r.error='조건 주문이 거절되었습니다: '+intent.error;
    if(r.closeRecovery)return;
    await this.refreshAccount(true);await this.syncBotPosition(b);await this.ensureGuards(b,info);
  }
  async tickBot(b,{pendingOnly=false}={}){
    if(b.runtime.closeRecovery&&!await this.closeRecovery.reconcile(b))return;
    if(b.runtime.closePending){await this.closeFlow.advance(b);return;}
    if(!budgetIncluded(b))return;
    const r=b.runtime,accountManagement=r.managementEnabled&&b.actionRules.some(rule=>rule.enabled&&rule.closeScope==='account'&&!isEntry(rule.action)&&!isStop(rule.action)&&this.rulePosition(b,rule).quantity>0);if(!r.runEnabled&&!r.quantity&&!accountManagement&&!this.ownOrders(b).some(active)){if(r.syncHold)await this.syncBotPosition(b);return;}
    await this.syncBotPosition(b);if(!this.tradingEnabled||r.syncHold||r.importPending)return;
    const info=await this.symbolInfo(b.symbol);
    if(this.shared.active(b.symbol))for(const o of this.ownOrders(b).filter(o=>o.kind==='standard'&&o.role!=='entry'&&o.closeScope!=='account'&&active(o)&&number(o.parameters.quantity)-number(o.appliedQty)>r.quantity+1e-9)){await this.cancelStandard(b,o,true);this.note('정리 잔량 취소',b.name+' · 공유 보유 수량 감소로 초과 정리 주문 취소',b.id);}
    if(!r.quantity){for(const o of this.ownOrders(b).filter(o=>active(o)&&o.kind==='standard'&&o.role!=='entry'&&o.closeScope!=='account'))await this.cancelStandard(b,o,true);}
    if(r.quantity&&hasProtection(b.exit)){
      const premium=await this.client.premium(b.symbol),last=number((await this.symbolTicker(b.symbol))?.lastPrice),reference=b.exit.price==='MARK_PRICE'?number(premium.markPrice):last;
      const change=(reference/r.entryPrice-1)*100*(r.direction==='LONG'?1:-1);
      const take=protectionEnabled(b.exit,'takeProfit')&&change>=protectionPricePercent(b.exit,'takeProfit',b.leverage),stop=protectionEnabled(b.exit,'stopLoss')&&change<=-protectionPricePercent(b.exit,'stopLoss',b.leverage);
      if(reference>0&&(take||stop)){await this.closePosition(b,take?'익절 조건':'손절 조건');return;}
    }
    const protectedPosition=await this.ensureGuards(b,info);if(r.quantity&&!protectedPosition)return;
    if(b.multiBotId)return; // Shared conditions must run before pending-entry fallbacks.
    const markets=new Map(),management=await this.evaluateRules(b,{phase:'management',markets}),stops=management.filter(i=>i.ready&&isStop(i.rule.action)),exits=management.filter(i=>i.ready&&!isStop(i.rule.action));
    if(stops.length){await this.executeRule(b,stops[0],info);return;}
    const closing=this.ownOrders(b).some(o=>o.role!=='entry'&&o.kind==='standard'&&(active(o)||pendingMarketRemainder(o,b))||active(o)&&(o.childOrderId||o.status==='UNKNOWN'));
    if(closing){await this.settlePending(b,info);await this.refreshAccount();await this.syncBotPosition(b);await this.ensureGuards(b,info);return;}
    if(exits.length){await this.evaluateRules(b,{phase:'entry',markets,append:true,cachedOnly:true});await this.executeRule(b,exits[0],info);return;}
    if(this.postOnly.pending(b).some(record=>record.role==='exit'))return;
    if(this.ownOrders(b).some(o=>o.kind==='standard'&&(active(o)||o.parameters.type==='LIMIT'&&!o.fallbackDone&&['CANCELED','EXPIRED'].includes(o.status)))){await this.settlePending(b,info);await this.refreshAccount();await this.syncBotPosition(b);await this.ensureGuards(b,info);return;}
    if(pendingOnly)return;
    const items=await this.evaluateRules(b,{phase:'entry',markets,append:true}),entries=items.filter(i=>i.ready&&isEntry(i.rule.action));
    if(new Set(entries.map(i=>actionDirection(i.rule.action))).size>1){this.note('진입 신호 충돌',b.name+' · 롱과 숏 진입이 동시에 충족되어 보류합니다.',b.id);r.lastEvaluation.conflict=true;return;}
    if(!entries.length){r.entryBlocked=null;return;}
    const item=entries[0];if(!await this.entryRetryReady(b,item.rule))return;
    const usage=this.decorate(b);
    if(usage.used+usage.reserved>=this.budgetLimit(b)){this.blockEntry(b,item.rule,new EntryCapacityError('no-margin',{remainingBudget:Math.max(0,this.budgetLimit(b)-usage.used-usage.reserved)}));return;}
    const limits=await this.leverageLimits(b.symbol),leverage=this.shared.leverage(b,r.quantity?b.leverage:item.rule.leverage);
    if(leverage>leverageCap(limits,this.budgetLimit(b))){r.lastEvaluation.budgetBlocked=true;return;}
    try{entryOrder(this.orderView(b,item.rule,actionDirection(item.rule.action)),info,{...item.market.book,lastPrice:item.market.ticker.lastPrice},this.accountSnapshot.availableBalance,this.hedge);}
    catch(error){if(isEntryCapacityError(error)){this.blockEntry(b,item.rule,error);return;}throw error;}
    await this.executeRule(b,item,info);
  }
}
