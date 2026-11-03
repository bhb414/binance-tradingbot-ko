export class PositionInsights{
  constructor(engine){this.engine=engine;this.cache=null;this.pending=null;}
  async get(){
    const e=this.engine;if(!e.connected)throw new Error('계좌를 먼저 연결해 주세요.');const client=e.client,scope=e.state.scope;
    if(this.cache?.client===client&&this.cache.until>e.now())return this.cache.value;
    if(this.pending?.client===client)return this.pending.promise;
    const promise=this.load(client,scope);this.pending={client,promise};try{return await promise;}finally{if(this.pending?.promise===promise)this.pending=null;}
  }
  async load(client,scope){
    const e=this.engine,endTime=e.now(),startTime=endTime-30*86400000;
    const events=[...(e.state.fills||[]),...(e.state.positionImports||[])].filter(row=>row.scope===scope&&row.botId&&Number.isFinite(row.at));
    const queryStart=Math.max(endTime-89*86400000,Math.min(startTime,...events.map(row=>row.at)));
    const [configs,realized]=await Promise.allSettled([client.symbolConfig(),this.income(client,queryStart,endTime)]);
    if(client!==e.client||scope!==e.state.scope||!e.connected)throw new Error('계좌가 변경되었습니다. 포지션 정보를 다시 조회해 주세요.');
    const settings={};if(configs.status==='fulfilled')for(const item of Array.isArray(configs.value)?configs.value:[]){if(!item?.symbol)continue;const margin=String(item.marginType).toUpperCase(),leverage=Number(item.leverage);if(['ISOLATED','CROSSED'].includes(margin)&&leverage>0)settings[item.symbol]={margin,leverage};}
    const rows=realized.status==='fulfilled'?realized.value:[],bySymbol={},netBySymbol={},costsBySymbol={};
    for(const row of rows.filter(row=>row.time>=startTime)){
      const costs=costsBySymbol[row.symbol]||={commission:0,funding:0,complete:true};
      if(row.asset!=='USDT'){costs.complete=false;continue;}
      if(row.incomeType==='REALIZED_PNL')bySymbol[row.symbol]=(bySymbol[row.symbol]||0)+row.income;
      if(row.incomeType==='COMMISSION')costs.commission+=row.income;
      if(row.incomeType==='FUNDING_FEE')costs.funding+=row.income;
      netBySymbol[row.symbol]=(netBySymbol[row.symbol]||0)+row.income;
    }
    const value={connectionId:e.connectionId,asOf:endTime,settings,settingsError:configs.status==='rejected'?'종목 설정 조회 실패':null,realized:{startTime,endTime,complete:realized.status==='fulfilled',bySymbol,netBySymbol,costsBySymbol,...(realized.status==='rejected'?{error:'손익·수수료·펀딩을 모두 조회하지 못했습니다.'}:{})},botFunding:this.botFunding(rows,queryStart,realized.status==='fulfilled')};
    this.cache={client,value,until:e.now()+(realized.status==='fulfilled'?60000:15000)};return value;
  }
  async income(client,startTime,endTime){
    const amounts=[],seen=new Set();let requests=0;
    const read=async(start,end)=>{
      if(++requests>24)throw new Error('손익 조회 범위 초과');
      const rows=await client.income({startTime:start,endTime:end,limit:1000});if(!Array.isArray(rows))throw new Error('손익 응답 확인 실패');
      if(rows.length>=1000){if(start>=end)throw new Error('동일 시각 손익 조회 한도 초과');const mid=Math.floor((start+end)/2);await read(start,mid);await read(mid+1,end);return;}
      for(const row of rows){const value=Number(row.income),at=Number(row.time);if(!['REALIZED_PNL','COMMISSION','FUNDING_FEE'].includes(row.incomeType)||!row.symbol||!Number.isFinite(value)||!Number.isFinite(at)||at<startTime||at>endTime)continue;
        const key=row.incomeType+':'+String(row.tranId??row.tradeId+':'+row.time+':'+row.symbol);if(seen.has(key))continue;seen.add(key);amounts.push({...row,income:value,time:at});}
    };
    await read(startTime,endTime);return amounts;
  }
  botFunding(rows,startTime,complete){
    const e=this.engine,result={};
    for(const bot of e.state.bots||[]){
      const events=[...(e.state.fills||[]).filter(f=>f.scope===e.state.scope&&f.botId===bot.id&&f.quantity).map(f=>({at:f.at,delta:(f.role==='entry'?1:-1)*f.quantity})),...(e.state.positionImports||[]).filter(f=>f.scope===e.state.scope&&f.botId===bot.id).map(f=>({at:f.at,quantity:f.quantity}))].sort((a,b)=>a.at-b.at);
      const valid=complete&&(!events.length?!bot.runtime.quantity:events[0].at>=startTime)&&!e.hedge;
      let funding=0,known=valid;
      for(const row of rows.filter(row=>row.symbol===bot.symbol&&row.incomeType==='FUNDING_FEE')){
        let quantity=0;for(const event of events){if(event.at>row.time)break;quantity=event.quantity??Math.max(0,quantity+event.delta);}
        if(quantity>1e-10){if(row.asset!=='USDT')known=false;else funding+=row.income;}
      }
      result[bot.id]={complete:known,funding:known?funding:null,startTime:events[0]?.at||e.now(),endTime:e.now(),reason:known?null:e.hedge?'헤지 모드의 종목 펀딩은 봇별 귀속을 구분할 수 없습니다.':'펀딩 조회 범위 또는 포지션 인수 기록 확인이 필요합니다.'};
    }
    return result;
  }
}
