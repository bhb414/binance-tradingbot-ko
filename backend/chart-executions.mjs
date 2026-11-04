const positive=v=>Number.isFinite(Number(v))&&Number(v)>0;
const epsilon=1e-7;
export function chartExecutions(state,{symbol,startTime=0,endTime=Date.now(),now=Date.now(),limit=2000}={}){
 if(typeof symbol!=='string'||!/^[A-Z0-9_-]{2,80}$/.test(symbol))throw Error('체결 조회 종목을 확인하세요.');
 if(!Number.isSafeInteger(startTime)||!Number.isSafeInteger(endTime)||startTime<0||endTime<startTime||endTime>4102444800000)throw Error('체결 조회 기간을 확인하세요.');
 const orders=(state.orders||[]).filter(o=>o.scope===state.scope&&o.parameters?.symbol===symbol),byId=new Map(orders.map(o=>[o.id,o])),byNative=new Map(orders.map(o=>[[o.botId||'',o.orderId].join('|'),o])),fills=(state.fills||[]).filter(f=>f.scope===state.scope&&f.symbol===symbol),seen=new Set(),groups=new Map(),fees=new Map();
 for(const f of fills){if(seen.has(f.id))continue;seen.add(f.id);const order=byId.get(f.clientOrderId)||byId.get(String(f.id).slice(0,String(f.id).lastIndexOf(':')))||byNative.get([f.botId||'',f.orderId].join('|'));
  if(f.fee!=null){if(order){const list=fees.get(order.id)||[];list.push(f);fees.set(order.id,list);}continue;}
  if(!positive(f.quantity)||!positive(f.price))continue;const key=order?.id||f.id,group=groups.get(key)||{order,rows:[]};group.rows.push(f);groups.set(key,group);
 }
 const events=new Map(),names=new Map((state.bots||[]).map(b=>[b.id,b.name]));
 for(const[key,{order,rows}]of groups){
  const costs=new Map();for(const f of fees.get(key)||[])if(positive(f.tradeQuantity)&&positive(f.tradePrice)&&positive(f.at))costs.set(f.tradeId!=null?'trade:'+f.tradeId:f.id,f);
  const exact=[...costs.values()],total=rows.reduce((s,f)=>s+Number(f.quantity),0),nativeTotal=exact.reduce((s,f)=>s+Number(f.tradeQuantity),0),precise=exact.length>0&&Math.abs(nativeTotal-total)<=Math.max(epsilon,total*epsilon);
  for(const f of precise?exact:rows){const first=rows[0],side=f.side||order?.parameters?.side||first.side;if(!['BUY','SELL'].includes(side))continue;
   const nativeTime=precise?Number(f.at):positive(f.tradeTime)?Number(f.tradeTime):null,at=nativeTime??Number(f.at);if(!positive(at)||at<startTime||at>endTime||at>now)continue;
   const role=f.role||order?.role||first.role,action=f.action||first.action||order?.action||'',entry=role==='entry'||/^(ENTER|OPEN)_/.test(action)||role==='manual'&&order?.action==='OPEN',exit=['exit','take','stop'].includes(role)||/^(EXIT|CLOSE)_/.test(action)||role==='manual'&&order?.action==='CLOSE',direction=f.direction||order?.direction||first.direction||action.match(/(LONG|SHORT)$/)?.[1]||(entry?(side==='BUY'?'LONG':'SHORT'):exit?(side==='SELL'?'LONG':'SHORT'):null);
   const kind=entry?'entry':exit?'exit':'trade',label=(direction==='LONG'?'롱 ':direction==='SHORT'?'숏 ':'')+(kind==='entry'?'진입':kind==='exit'?(role==='take'?'익절':role==='stop'?'손절':'정리'):'체결'),quantity=Number(precise?f.tradeQuantity:f.quantity),price=Number(precise?f.tradePrice:f.price),tradeId=f.tradeId??(!precise?String(f.id).match(/:trade:(\d+)$/)?.[1]:null),orderId=f.orderId||order?.orderId||null;
   const id=tradeId!=null&&orderId!=null?[symbol,orderId,tradeId,side].join('|'):String(f.id),botId=f.botId??first.botId??null,name=botId?(names.get(botId)||'삭제된 봇'):'별도 주문',existing=events.get(id);
   if(existing){existing.quote+=quantity*price;existing.quantity+=quantity;existing.price=existing.quote/existing.quantity;existing.labels=[...new Set([...existing.labels,label])];existing.botNames=[...new Set([...existing.botNames,name])];existing.timeEstimated||=nativeTime===null;}
   else events.set(id,{id,symbol,at,side,quantity,price,quote:quantity*price,kind,direction,labels:[label],botNames:[name],timeEstimated:nativeTime===null});
  }
 }
 const all=[...events.values()].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)),rows=all.slice(-limit).map(({quote,...r})=>r);return {rows,total:all.length,truncated:all.length>limit,revision:(state.fills||[]).length,source:'local-journal'};
}
