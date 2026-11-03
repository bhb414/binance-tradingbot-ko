export function workroomPerformance(bots){
 const baseBudget=bots.reduce((sum,bot)=>sum+(Number.isFinite(bot.budget)?Math.max(0,bot.budget):0),0);
 const complete=bots.every(bot=>Number.isFinite(bot.pnl)),pnl=complete?bots.reduce((sum,bot)=>sum+bot.pnl,0):null;
 return {baseBudget,pnl,roi:pnl!==null&&baseBudget>0?pnl/baseBudget*100:null};
}
export function positionEmotion(bot){
 const quantity=Number(bot.quantity??bot.runtime?.quantity)||0;
 if(!quantity)return {kind:'none',value:null,label:'보유 포지션 없음'};
 if(bot.runtime?.syncHold||bot.error||!Number.isFinite(bot.pnl)||!Number.isFinite(bot.runtime?.realized))return {kind:'unknown',value:null,label:'포지션 손익 확인 필요'};
 const value=bot.pnl-bot.runtime.realized;
 return {kind:value>1e-8?'happy':value< -1e-8?'sad':'neutral',value,label:'현재 포지션 미실현 손익 '+(value>=0?'+':'')+value.toFixed(2)+' USDT'};
}
export function emotionBubble(bot){
 const mood=positionEmotion(bot);if(mood.kind==='none')return '';
 const color={happy:'#71b987',sad:'#d99797',neutral:'#c6b77c',unknown:'#a6afb7'}[mood.kind];
 const mouth=mood.kind==='happy'?'<path d="M-5 1 Q0 8 5 1"/>':mood.kind==='sad'?'<path d="M-5 5 Q0 -1 5 5"/>':mood.kind==='unknown'?'<path d="M-2 -5 Q4 -6 3 -2 L0 1 M0 4 L0 5"/>':'<path d="M-4 3 H4"/>';
 return `<g class="mood-bubble mood-${mood.kind}" transform="translate(27 -53)" role="img" aria-label="${mood.label}"><title>${mood.label}</title><circle r="14" fill="#fffdf6" stroke="${color}" stroke-width="2"/><circle r="10" fill="${color}" opacity=".24"/><g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round">${mood.kind==='unknown'?'':'<path d="M-4 -4 V-3 M4 -4 V-3"/>'}${mouth}</g></g>`;
}
