export function workroomPerformance(bots){
 const baseBudget=bots.reduce((sum,bot)=>sum+(Number.isFinite(bot.budget)?Math.max(0,bot.budget):0),0);
 const complete=bots.every(bot=>Number.isFinite(bot.pnl)),pnl=complete?bots.reduce((sum,bot)=>sum+bot.pnl-(bot.statsReset?.realized||0),0):null;
 return {baseBudget,pnl,roi:pnl!==null&&baseBudget>0?pnl/baseBudget*100:null};
}
export const EMOTION_LEVELS={ecstatic:{label:'환호',color:'#4f9f7b'},excited:{label:'신남',color:'#69ad83'},happy:{label:'미소',color:'#88b99a'},neutral:{label:'평온',color:'#a3afa0'},uneasy:{label:'걱정',color:'#c7aa7d'},sad:{label:'시무룩',color:'#c18c98'},distressed:{label:'울먹임',color:'#b4788b'},unknown:{label:'확인 필요',color:'#9ba9b5'}};
const signed=(value,digits=2)=>(value>=0?'+':'')+value.toFixed(digits);
export function positionEmotion(bot){
 const quantity=Number(bot.quantity??bot.runtime?.quantity)||0;
 if(!quantity)return {kind:'none',value:null,roi:null,label:'보유 포지션 없음'};
 if(bot.runtime?.syncHold||bot.error||!Number.isFinite(bot.pnl)||!Number.isFinite(bot.runtime?.realized))return {kind:'unknown',value:null,roi:null,label:'포지션 손익 확인 필요'};
 const value=bot.pnl-bot.runtime.realized,estimated=quantity*Number(bot.entryPrice||bot.runtime?.entryPrice||0)/Math.max(1,Number(bot.leverage)||1),margin=Number(bot.used)>0?Number(bot.used):estimated>0?estimated:null,base=margin||Number(bot.budget),roi=base>0?value/base*100:null;
 const kind=Math.abs(value)<1e-8||roi!==null&&Math.abs(roi)<=.05?'neutral':roi===null?(value>0?'happy':'sad'):roi>=10?'ecstatic':roi>=3?'excited':roi>0?'happy':roi<=-10?'distressed':roi<=-3?'sad':'uneasy';
 return {kind,value,roi,label:'현재 포지션 미실현손익 '+signed(value)+' USDT'+(roi!==null?' · '+(margin?'증거금':'기준예산')+' 대비 '+signed(roi)+'%':'')+' · '+EMOTION_LEVELS[kind].label};
}
export function emotionBubble(bot){
 const mood=positionEmotion(bot);if(mood.kind==='none')return '';
 const {kind}=mood,color=EMOTION_LEVELS[kind].color;
 const eyes=kind==='ecstatic'?'<path d="M-7 -7 L-5 -4 L-2 -3 L-5 -1 L-7 2 L-8 -1 L-11 -3 L-8 -4Z M7 -7 L9 -4 L12 -3 L9 -1 L7 2 L6 -1 L3 -3 L6 -4Z" fill="currentColor" stroke-width="1"/>':kind==='excited'||kind==='happy'?'<path d="M-10 -2 Q-7 -8 -4 -2 M4 -2 Q7 -8 10 -2"/>':kind==='unknown'?'<path d="M-3 -7 Q5 -9 4 -3 L0 1 M0 5 V6"/>':'<path d="M-7 -5 V-2 M7 -5 V-2"/>';
 const mouth=kind==='ecstatic'||kind==='excited'?'<path d="M-7 3 Q0 15 7 3Z" fill="currentColor" stroke-width="1"/>':kind==='happy'?'<path d="M-6 4 Q0 10 6 4"/>':kind==='uneasy'?'<path d="M-7 6 L-3 4 L1 6 L5 4 L8 6"/>':kind==='sad'||kind==='distressed'?'<path d="M-6 8 Q0 0 6 8"/>':kind==='neutral'?'<path d="M-6 5 H6"/>':'';
 const detail=kind==='distressed'?'<path d="M-11 0 Q-16 7 -11 9 Q-6 7 -11 0 M11 0 Q6 7 11 9 Q16 7 11 0" fill="#96c2d2" stroke="none"/>':kind==='uneasy'?'<path d="M12 -12 Q7 -5 12 -3 Q17 -5 12 -12" fill="#9ec5d3" stroke="none"/>':kind==='excited'||kind==='ecstatic'?'<path d="M-11 4 H-8 M8 4 H11" stroke="#d59c9b" stroke-width="3"/>':'';
 return `<g class="mood-bubble mood-${kind}" transform="translate(46 -70)" role="img" aria-label="${mood.label}"><title>${mood.label}</title><circle r="18" fill="#fffdf6" stroke="${color}" stroke-width="2.5"/><circle r="13" fill="${color}" opacity=".13"/><g fill="none" stroke="${color}" color="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${eyes}${mouth}${detail}</g></g>`;
}
export function workstationEffect(bot,x,y){
 const mood=positionEmotion(bot);if(!Number.isFinite(mood.value)||Math.abs(mood.value)<1e-8)return '';
 const gain=mood.value>0,fill=gain?'#e7c26c':'#d5a8a4',edge=gain?'#a77f36':'#aa777d',sign=gain?'+':'−';
 const coin=delay=>`<g class="coin-float" style="--coin-delay:${delay}s"><path d="M-6 -10 H6 V-7 H10 V7 H6 V10 H-6 V7 H-10 V-7 H-6Z" fill="${fill}" stroke="${edge}" stroke-width="2"/><path d="M-3 -6 H3 M-3 6 H3 M0 -7 V7" fill="none" stroke="#fff3ca" stroke-width="2"/><text x="16" y="5" fill="${gain?'#4b8b68':'#b07886'}">${sign}</text></g>`;
 const id=String(bot.id).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return `<g class="workstation-effect ${gain?'gain':'loss'}" transform="translate(${x-89} ${y-68})" data-station-bot="${id}" role="img" aria-label="${mood.label}"><title>${mood.label} · 현재 손익 상태를 나타내는 시각 효과</title>${coin(0)}${coin(2)}</g>`;
}
