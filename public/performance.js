export function botPerformance(bot,insights,fills=[]){
  const fees=fills.filter(f=>f.botId===bot.id&&f.fee!=null),fee=Number.isFinite(bot.fees)?bot.fees:fees.filter(f=>f.feeAsset==='USDT').reduce((sum,f)=>sum+Number(f.fee||0),0);
  const funding=insights?.botFunding?.[bot.id],base=Number(bot.budget),pnl=Number.isFinite(bot.pnl)?bot.pnl:null;
  const gross=pnl===null?null:pnl+fee,net=pnl!==null&&funding?.complete&&!bot.costsPending&&!fees.some(f=>f.feeAsset!=='USDT')?pnl+funding.funding:null;
  return {gross,net,fee,funding:funding?.funding??null,grossPercent:base>0&&gross!==null?gross/base*100:null,netPercent:base>0&&net!==null?net/base*100:null,reason:funding?.reason||'수수료·펀딩 조회 확인 필요'};
}
