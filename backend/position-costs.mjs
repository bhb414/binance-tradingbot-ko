import {buildOpenPositionCosts} from './trade-history.mjs';
export class PositionCostEstimates{
 constructor(engine){this.engine=engine;this.client=null;this.rates=new Map();this.lastFundingRefresh=0;}
 async rate(symbol,client){
  const now=this.engine.now(),old=this.rates.get(symbol);if(old?.promise)return old.promise;if(old&&old.expires>now)return old.value;
  const entry={promise:null,value:null,expires:0};this.rates.set(symbol,entry);
  const promise=(async()=>{try{
   if(typeof client.commissionRate!=='function')throw Error('unsupported');
   const row=await client.commissionRate(symbol),raw=row?.takerCommissionRate,rate=Number(raw);
   if(row?.symbol!==symbol||raw==null||raw===''||!Number.isFinite(rate)||rate<0||rate>1)throw Error('invalid rate');
   entry.value={rate,asOf:this.engine.now(),reason:null};entry.expires=this.engine.now()+300000;
  }catch(error){entry.value={rate:null,asOf:this.engine.now(),reason:'정리 수수료율 조회 대기'};entry.expires=Math.max(this.engine.now()+30000,Number(error.retryAt)||0);}return entry.value;})();
  entry.promise=promise;try{return await promise;}finally{entry.promise=null;}
 }
 async get(){
  const e=this.engine,client=e.client,scope=e.state.scope;
  if(this.client!==client){this.client=client;this.rates.clear();this.lastFundingRefresh=0;}
  const held=e.state.bots.filter(b=>Number(b.runtime?.quantity)>0);
  if(!e.connected||!held.length)return {connectionId:e.connectionId,asOf:e.now(),byBot:{}};
  const latestEntry=Math.max(0,...held.map(b=>Number(b.runtime.lastEntryAt)||Number(b.runtime.imported?.at)||0)),previous=e.positionInsights.fundingSnapshot?.(),force=(!previous||previous.endTime<latestEntry)&&e.now()-this.lastFundingRefresh>=15000;
  if(force)this.lastFundingRefresh=e.now();
  const [fundingResult,rateResults]=await Promise.all([e.positionInsights.get({force}).then(()=>e.positionInsights.fundingSnapshot?.()).catch(()=>null),Promise.all([...new Set(held.map(b=>b.symbol))].map(async symbol=>[symbol,await this.rate(symbol,client)]))]);
  if(client!==e.client||scope!==e.state.scope||!e.connected)throw Error('계좌가 변경되었습니다. 비용 정보를 다시 조회하세요.');
  const basis=buildOpenPositionCosts({state:e.state,now:e.now(),funding:fundingResult}),rates=new Map(rateResults),byBot={};
  for(const bot of e.state.bots.filter(b=>Number(b.runtime?.quantity)>0)){
   const row=basis[bot.id],rate=rates.get(bot.symbol);
   if(!row){byBot[bot.id]={symbol:bot.symbol,quantity:bot.runtime.quantity,entryPrice:bot.runtime.entryPrice,direction:bot.runtime.direction,positionEpoch:bot.runtime.positionEpoch,complete:false,reasons:['진입·비용 기록 확인 필요']};continue;}
   const reasons=[...row.reasons,...(rate?.rate==null?['정리 수수료율 조회 대기']:[])];
   byBot[bot.id]={...row,complete:reasons.length===0,reasons:[...new Set(reasons)],takerRate:rate?.rate??null,rateAsOf:rate?.asOf??null};
  }
  return {connectionId:e.connectionId,asOf:e.now(),byBot,method:'보유분 진입 수수료·발생 펀딩 배분 + 현재 평가가격 기준 시장가 정리 수수료 예상'};
 }
}
