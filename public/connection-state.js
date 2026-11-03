export function connectionView(state,marketError=null){
 const connected=state?.connected===true,enabled=connected&&state?.tradingEnabled===true,environment=state?.environment==='live'?'실전':'테스트넷';
 const storage=!!state?.storageFault,permission=storage?state?.orderPermission?.enabled===true:connected?enabled:state?.orderPermission?.enabled===true,botProblem=state?.bots?.find(bot=>bot.error);
 const warning=state?.error||(botProblem?botProblem.name+' · '+botProblem.error:null)||state?.waiting?.message||marketError||'';
 const healthLabel=storage?'저장 오류':state?.waiting?(state.waiting.kind==='rate-limit'?'호출 제한':'연결 재시도'):botProblem?'봇 경고':warning?'조회 경고':'';
 const orderLabel=storage?'저장 복구 대기':connected?(enabled?'주문 허용':'주문 꺼짐'):permission?'연결 대기':'연결 설정';
 return {connected,enabled,permission,environment,connectionState:connected?(enabled?'trading':'readonly'):'disconnected',orderLabel,warning,healthLabel,summary:'바이낸스 '+environment+' · '+(connected?'계좌 연결됨':'계좌 미연결')+' · '+orderLabel+(warning?' · '+warning:'')};
}
