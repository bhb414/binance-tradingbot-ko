import {positionEmotion} from './workroom-metrics.js';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const close=(a,b)=>Math.abs(a-b)<=Math.max(1e-8,Math.abs(b)*1e-8);
const unknown=reason=>({state:'unknown',net:null,roi:null,reason});
export function positionNetReturn(bot,costs={},now=Date.now()){
 const mood=positionEmotion(bot);
 if(mood.kind==='none')return {state:'none',net:null,roi:null};
 if(mood.kind==='unknown')return unknown('현재 포지션 손익·수량 확인 필요');
 if(bot.kind==='multi'){
  const held=(bot.members||[]).filter(b=>Number(b.quantity)>0),parts=held.map(b=>positionNetReturn(b,costs,now));
  if(!parts.length||parts.some(p=>p.state!=='ready'))return unknown(parts.find(p=>p.state!=='ready')?.reason||'종목별 비용 확인 필요');
  const base=Number(bot.used)>0?Number(bot.used):parts.reduce((s,p)=>s+p.margin,0);if(!(base>0))return unknown('보유 증거금 확인 필요');
  const net=parts.reduce((s,p)=>s+p.net,0);return {state:'ready',net,roi:net/base*100,margin:base,entryFee:parts.reduce((s,p)=>s+p.entryFee,0),funding:parts.reduce((s,p)=>s+p.funding,0),closingFee:parts.reduce((s,p)=>s+p.closingFee,0),asOf:Math.min(...parts.map(p=>p.asOf)),rate:null};
 }
 const cost=costs[bot.id],quantity=Number(bot.quantity??bot.runtime?.quantity),entryPrice=Number(bot.entryPrice||bot.runtime?.entryPrice),direction=bot.positionDirection||bot.runtime?.direction;
 if(!cost)return unknown('진입 수수료·펀딩·정리 수수료율 조회 중');
 if(!Number.isFinite(cost.fundingAsOf)||now-cost.fundingAsOf>90000||!Number.isFinite(cost.rateAsOf)||now-cost.rateAsOf>330000)return unknown('최근 비용 내역 갱신 대기');
 if(!cost.complete)return unknown(cost.reasons?.join(' · ')||'비용 내역 확인 필요');
 if(cost.symbol!==bot.symbol||cost.direction!==direction||!close(Number(cost.quantity),quantity)||!close(Number(cost.entryPrice),entryPrice)||cost.positionEpoch!=null&&bot.runtime?.positionEpoch!=null&&cost.positionEpoch!==bot.runtime.positionEpoch)return unknown('포지션 변경 후 비용 내역 갱신 중');
 if(![cost.entryFee,cost.funding,cost.takerRate].every(finite)||cost.takerRate<0||cost.takerRate>1||!['LONG','SHORT'].includes(direction))return unknown('비용 내역 확인 필요');
 const mark=entryPrice+mood.value/quantity*(direction==='LONG'?1:-1),fallback=quantity*entryPrice/Math.max(1,Number(bot.leverage)||1),margin=Number(bot.used)>0?Number(bot.used):fallback;
 if(!(mark>0&&quantity>0&&margin>0))return unknown('평가 가격·보유 증거금 확인 필요');
 const closingFee=quantity*mark*cost.takerRate,net=mood.value-cost.entryFee+cost.funding-closingFee;
 return {state:'ready',net,roi:net/margin*100,margin,entryFee:cost.entryFee,funding:cost.funding,closingFee,rate:cost.takerRate,asOf:cost.fundingAsOf};
}
