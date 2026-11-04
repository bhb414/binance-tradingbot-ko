export function botPerformance(bot,insights,fills=[]){
  const reset=bot.statsReset,fees=fills.filter(f=>f.botId===bot.id&&f.fee!=null&&(!reset||f.at>reset.at)),fee=Number.isFinite(bot.fees)?bot.fees:fees.filter(f=>f.feeAsset==='USDT').reduce((sum,f)=>sum+Number(f.fee||0),0);
  const funding=insights?.botFunding?.[bot.id],base=Number(bot.budget),pnl=Number.isFinite(bot.pnl)?bot.pnl-(reset?.realized||0):null;
  const fundingCurrent=!reset||funding?.statsResetAt===reset.at,gross=pnl===null?null:pnl+fee,net=pnl!==null&&fundingCurrent&&funding?.complete&&!bot.costsPending&&!fees.some(f=>f.feeAsset!=='USDT')?pnl+funding.funding:null;
  return {gross,net,fee,funding:fundingCurrent?funding?.funding??null:null,grossPercent:base>0&&gross!==null?gross/base*100:null,netPercent:base>0&&net!==null?net/base*100:null,reason:!fundingCurrent?'통계 초기화 후 펀딩 재조회 중':funding?.reason||'수수료·펀딩 조회 확인 필요'};
}
