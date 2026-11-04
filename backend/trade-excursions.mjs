// Observed, pre-cost trade excursions. This module never requests market data or places orders.
const eps=1e-9,number=v=>Number(v)||0;
export const excursionKey=(scope,botId,epoch)=>JSON.stringify([scope,botId,epoch]);
export function excursionView(record){
 if(!record)return {status:'missing',reason:'기능 적용 전 완료 거래 · 미수집',maxProfit:null,maxLoss:null,maxProfitPercent:null,maxLossPercent:null};
 const status=record.uncertain?'uncertain':record.partial||!record.markSamples?'partial':'observed',usable=!record.uncertain&&record.samples>0;
 return {status,reason:record.reason||(!record.markSamples?'보유 중 마크가격 관측 없음':record.partial?'보유 도중부터 관측':''),observedFrom:record.observedFrom,lastObservedAt:record.lastObservedAt,closedAt:record.closedAt,samples:record.samples,markSamples:record.markSamples,gaps:record.gaps||0,maxProfit:usable?record.maxProfit:null,maxLoss:usable?record.maxLoss:null,maxProfitPercent:usable&&record.marginKnown?record.maxProfitPercent:null,maxLossPercent:usable&&record.marginKnown?record.maxLossPercent:null,maxProfitAt:usable?record.maxProfitAt:null,maxLossAt:usable?record.maxLossAt:null};
}
export function excursionStats(trades){
 const closed=trades.filter(t=>t.closedAt),known=closed.filter(t=>t.excursion?.status==='observed'),percent=known.filter(t=>t.excursion.maxProfitPercent!=null&&t.excursion.maxLossPercent!=null);
 const values=(rows,key)=>rows.map(t=>t.excursion[key]),max=(rows,key)=>rows.length?Math.max(...values(rows,key)):null,min=(rows,key)=>rows.length?Math.min(...values(rows,key)):null,mean=(rows,key)=>rows.length?values(rows,key).reduce((a,b)=>a+b,0)/rows.length:null;
 return {collected:known.length,missing:closed.filter(t=>t.excursion?.status==='missing').length,partial:closed.length-known.length-closed.filter(t=>t.excursion?.status==='missing').length,withGaps:known.filter(t=>t.excursion.gaps).length,maximumProfit:max(known,'maxProfit'),maximumLoss:min(known,'maxLoss'),averageProfit:mean(known,'maxProfit'),averageLoss:mean(known,'maxLoss'),maximumProfitPercent:max(percent,'maxProfitPercent'),maximumLossPercent:min(percent,'maxLossPercent'),averageProfitPercent:mean(percent,'maxProfitPercent'),averageLossPercent:mean(percent,'maxLossPercent')};
}
export class TradeExcursions{
 constructor(engine){this.e=engine;this.rows=null;this.index=new Map();}
 records(){const rows=this.e.state.tradeExcursions||=[];if(rows!==this.rows){this.rows=rows;this.index=new Map(rows.map(r=>[excursionKey(r.scope,r.botId,r.positionEpoch),r]));}return rows;}
 get(b,epoch=b.runtime.positionEpoch){this.records();return this.index.get(excursionKey(this.e.state.scope,b.id,epoch));}
 interval(){return this.e.state.dataTransport?.mode==='rest'?Math.max(1000,number(this.e.state.dataTransport.restIntervalSeconds)*1000):1000;}
 init(){this.e.state.excursionTracking||={version:1,startedAt:this.e.now()};this.records();for(const b of this.e.state.bots)if(b.runtime.quantity>eps&&!this.get(b))this.seed(b,{epoch:b.runtime.positionEpoch,quantity:b.runtime.quantity,price:b.runtime.entryPrice,direction:b.runtime.direction,at:this.e.now(),partial:true});}
 seed(b,{epoch,quantity=0,price=0,direction,at,partial=false}){
  const r={scope:this.e.state.scope,botId:b.id,symbol:b.symbol,direction,positionEpoch:epoch,openedAt:partial?null:at,observedFrom:this.e.now(),closedAt:null,quantity,averagePrice:price,realizedGross:0,entryMargin:0,marginKnown:!partial,partial,maxProfit:0,maxLoss:0,maxProfitPercent:partial?null:0,maxLossPercent:partial?null:0,maxProfitAt:null,maxLossAt:null,samples:0,markSamples:0,gaps:0,lastObservedAt:null};
  this.records().push(r);this.index.set(excursionKey(r.scope,r.botId,epoch),r);return r;
 }
 invalidate(r,reason){r.uncertain=true;r.reason=reason;}
 sample(r,mark,at,{market=false}={}){
  if(!(mark>0)||at<(r.lastObservedAt||0))return;
  if(r.lastObservedAt&&at-r.lastObservedAt>Math.max(5000,3*this.interval()))r.gaps++;
  const pnl=r.realizedGross+(mark-r.averagePrice)*r.quantity*(r.direction==='LONG'?1:-1),percent=r.marginKnown&&r.entryMargin>0?pnl/r.entryMargin*100:null;
  if(!r.samples||pnl>r.maxProfit){if(pnl>=r.maxProfit){r.maxProfit=pnl;r.maxProfitAt=at;}}
  if(!r.samples||pnl<r.maxLoss){if(pnl<=r.maxLoss){r.maxLoss=pnl;r.maxLossAt=at;}}
  if(percent!=null){r.maxProfitPercent=Math.max(r.maxProfitPercent??0,percent);r.maxLossPercent=Math.min(r.maxLossPercent??0,percent);}
  r.lastObservedAt=at;r.samples++;if(market)r.markSamples++;
 }
 fill(b,{epoch=b.runtime.positionEpoch,role,quantity,price,direction=b.runtime.direction,leverage=b.leverage,at=this.e.now(),beforeQuantity=0,beforePrice=0,imported=false}){
  if(!(quantity>eps&&price>0)||!['LONG','SHORT'].includes(direction))return;
  this.e.state.excursionTracking||={version:1,startedAt:this.e.now()};
  let r=this.get(b,epoch);
  if(!r)r=this.seed(b,{epoch,quantity:beforeQuantity,price:beforePrice,direction,at,partial:beforeQuantity>eps||imported||at<this.e.state.excursionTracking.startedAt});
  if(r.closedAt||r.direction!==direction||r.symbol!==b.symbol){this.invalidate(r,'체결과 관측 포지션 대조 필요');return;}
  if(r.lastObservedAt&&at<r.lastObservedAt)this.invalidate(r,'늦게 확인된 체결로 관측 구간 확인 필요');
  if(Math.abs(r.quantity-beforeQuantity)>Math.max(eps,beforeQuantity*1e-7))this.invalidate(r,'체결과 관측 수량 대조 필요');
  if(imported){r.partial=true;r.marginKnown=false;r.reason='수동 포지션 인수 전 구간 미수집';}
  if(role==='entry'){
   r.averagePrice=(r.quantity*r.averagePrice+quantity*price)/(r.quantity+quantity);r.quantity+=quantity;
   if(leverage>0)r.entryMargin+=quantity*price/leverage;else r.marginKnown=false;
  }else{
   const closed=Math.min(quantity,r.quantity);if(quantity>r.quantity+eps)this.invalidate(r,'정리 전 진입 수량 미확인');
   r.realizedGross+=(price-r.averagePrice)*closed*(direction==='LONG'?1:-1);r.quantity=Math.max(0,r.quantity-quantity);
  }
  this.sample(r,price,Math.max(at,r.lastObservedAt||0));
  if(role!=='entry'&&r.quantity<=eps){r.quantity=0;r.closedAt=at;}
 }
 observe(){
  const e=this.e;if(!e.connected)return;const account=e.liveAccount?.()||e.accountSnapshot;if(!account)return;
  for(const b of e.state.bots){
   const rt=b.runtime;if(!(rt.quantity>eps)||rt.syncHold||e.shared?.active(b.symbol)&&e.shared.book(b.symbol)?.pending)continue;
   if(e.state.orders.some(o=>o.scope===e.state.scope&&o.botId===b.id&&(o.sharedPending||o.status==='UNKNOWN')))continue;
   const p=account.positions.find(p=>p.symbol===b.symbol&&(p.positionSide==='BOTH'||p.positionSide===rt.direction)&&number(p.quantity)*(rt.direction==='LONG'?1:-1)>0);
   if(!p)continue;
   let mark=number(p.markPrice);const streams=e.client?.streams;
   if(streams&&e.state.dataTransport?.mode==='websocket'){const channel=streams.channels.get('market'),hit=channel&&streams.fresh('premium:'+b.symbol+':',channel);mark=number(hit?.value?.markPrice);}
   else if(e.now()-number(e.accountAt)>Math.max(30000,this.interval()*2))continue;
   if(!(mark>0))continue;
   let r=this.get(b);if(!r)r=this.seed(b,{epoch:rt.positionEpoch,quantity:rt.quantity,price:rt.entryPrice,direction:rt.direction,at:e.now(),partial:true});
   if(Math.abs(r.quantity-rt.quantity)>Math.max(eps,rt.quantity*1e-7)||Math.abs(r.averagePrice-rt.entryPrice)>Math.max(eps,rt.entryPrice*1e-7)){this.invalidate(r,'운용 포지션과 관측 기록 대조 필요');continue;}
   this.sample(r,mark,e.now(),{market:true});
  }
 }
}
