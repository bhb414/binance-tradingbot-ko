import {createHmac} from 'node:crypto';
import {RequestBudget} from './binance-rate.mjs';
const DAY=86400000,ENDPOINT='/sapi/v1/accountSnapshot',budgets=new WeakMap();
// SAPI IP limits are per endpoint (12,000/min), independent of the futures budget.
function budget(client){let clocks=budgets.get(client.fetch);if(!clocks){clocks=new WeakMap();budgets.set(client.fetch,clocks);}if(!clocks.has(client.now))clocks.set(client.now,new RequestBudget({now:client.now,limit:12000}));return clocks.get(client.now);}
export function dailyWalletSnapshots(response,{now=Date.now()}={}){
 if(response?.code!==200||!Array.isArray(response.snapshotVos)||response.snapshotVos.length>30)throw Error('바이낸스 과거 잔고 응답을 확인하지 못했습니다.');
 const rows=new Map();let skipped=0;
 for(const item of response.snapshotVos){
  if(String(item.type).toUpperCase()!=='FUTURES')throw Error('선물계좌의 과거 잔고가 아닙니다.');
  const at=Number(item.updateTime),assets=item.data?.assets;if(!Number.isSafeInteger(at)||at<=0||at>now||!Array.isArray(assets))throw Error('과거 잔고의 시각과 자산 정보를 확인하지 못했습니다.');
  const matches=assets.filter(a=>a.asset==='USDT');if(!matches.length){skipped++;continue;}const raw=matches[0].walletBalance,wallet=Number(raw);
  if(matches.length!==1||raw===null||raw===''||raw===undefined||!Number.isFinite(wallet))throw Error('과거 USDT 지갑잔고를 확인하지 못했습니다.');
  if(rows.has(at)&&rows.get(at).wallet!==wallet)throw Error('같은 시각의 과거 잔고가 서로 다릅니다.');
  rows.set(at,{at,wallet});
 }
 // Snapshot unrealized PnL is documented as an opening-time value; never use it
 // or marginBalance to manufacture historical account equity.
 return {points:[...rows.values()].sort((a,b)=>a.at-b.at),skipped};
}
export async function fetchAccountSnapshots(client){
 if(client.environment!=='live')throw Error('바이낸스 과거 잔고는 실전 계좌에서 조회할 수 있습니다.');
 if(!client.apiKey||!client.secret)throw Error('API 계좌를 먼저 연결하세요.');
 const now=client.now(),rate=budget(client);rate.reserve(2400,{source:'account-history',method:'GET',endpoint:ENDPOINT});
 const query=new URLSearchParams({type:'FUTURES',startTime:String(now-29*DAY),endTime:String(now),limit:'30',recvWindow:'5000',timestamp:String(Math.round(now+client.offset))}).toString();
 const signature=createHmac('sha256',client.secret).update(query).digest('hex');let response,data;
 rate.recordSent('account-history','GET',ENDPOINT,2400);
 try{response=await client.fetch('https://api.binance.com'+ENDPOINT+'?'+query+'&signature='+signature,{method:'GET',headers:{Accept:'application/json','X-MBX-APIKEY':client.apiKey},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('바이낸스 과거 잔고 응답이 지연됐습니다. 잠시 후 다시 불러오세요.');}
 try{data=await response.json();}catch{data=null;}
 rate.observe({status:response.status,headers:{get:name=>response.headers.get(name==='x-mbx-used-weight-1m'?'x-sapi-used-ip-weight-1m':name)}},data);
 if(!response.ok||data?.code!==200)throw Object.assign(Error(client.redact(data?.msg||'바이낸스 과거 잔고 조회에 실패했습니다.')),{status:response.status,retryAt:rate.blockedUntil});
 return dailyWalletSnapshots(data,{now});
}
