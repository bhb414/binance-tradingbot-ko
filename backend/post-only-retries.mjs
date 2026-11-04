// Only a definitive GTX rejection is safe to retry. Unknown acceptance is never retried here.
export function isPostOnlyRejection(error,parameters,kind='standard'){
 return kind==='standard'&&parameters.type==='LIMIT'&&parameters.timeInForce==='GTX'&&Number(error?.code)===-5022&&!error.uncertain&&!error.temporary&&(!error.status||error.status>=200&&error.status<500&&![418,429].includes(error.status));
}
export class PostOnlyRetries{
 constructor(engine){this.e=engine;}
 position(b,record){return record.role==='entry'?b.runtime:this.e.rulePosition(b,{action:'EXIT_'+record.direction,closeScope:record.closeScope});}
 ready(b,rule){const record=b.runtime.orderRetries?.[rule.id];if(!record)return true;if(record.epoch!==this.position(b,record).positionEpoch){delete b.runtime.orderRetries[rule.id];return true;}return this.e.now()>=record.retryAt;}
 observe(b,rule,result){if(!result.missing&&!result.pass&&b.runtime.orderRetries)delete b.runtime.orderRetries[rule.id];}
 accepted(b,order){if(order.ruleId&&b.runtime.orderRetries)delete b.runtime.orderRetries[order.ruleId];}
 rejected(b,order,error){
  const r=b.runtime,records=r.orderRetries||={},previous=records[order.ruleId],attempts=(previous?.attempts||0)+1,seconds=Math.min(30,5*2**Math.min(3,attempts-1)),at=this.e.now(),action=(order.direction==='LONG'?'롱':'숏')+(order.role==='entry'?' 진입':' 정리');
  const record={ruleId:order.ruleId,role:order.role,direction:order.direction,closeScope:order.closeScope||'bot',attempts,at,retryAt:at+seconds*1000,label:action+' · 메이커 주문 대기',message:action+' 주문이 메이커 전용 조건에 맞지 않아 접수되지 않았습니다. '+seconds+'초 뒤에도 조건이 충족되면 최신 호가로 다시 시도합니다.',loggedAt:previous?.loggedAt||0};record.epoch=this.position(b,record).positionEpoch;records[order.ruleId]=record;
  Object.assign(order,{errorKind:'post-only',errorCode:Number(error.code),fallbackDone:true,feesFetched:true});
  if(!previous||at-record.loggedAt>=60000){this.e.note('메이커 주문 재시도 대기',b.name+' · '+record.message,b.id);record.loggedAt=at;}
 }
 pending(b){return Object.values(b.runtime.orderRetries||{}).filter(record=>{const signal=b.runtime.ruleSignals?.[record.ruleId]?.lastEvaluation,position=this.position(b,record);return signal?.pass&&!signal.missing&&record.epoch===position.positionEpoch&&(record.role==='entry'?b.runtime.runEnabled&&(!position.quantity||position.direction===record.direction):position.quantity>0&&position.direction===record.direction);});}
 notice(b){const records=this.pending(b).sort((a,b)=>(a.role==='exit'?0:1)-(b.role==='exit'?0:1)||b.at-a.at);return records[0]||null;}
}
