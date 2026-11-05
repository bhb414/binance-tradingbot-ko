const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function historyBotOptions(bots){
 const group=(name,rows)=>rows.length?'<optgroup label="'+name+'">'+rows.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+(b.deleted?' · 삭제됨':'')+'</option>').join('')+'</optgroup>':'';
 return '<option value="">봇 전체 · 삭제된 봇의 기록 포함</option>'+group('운용·보관 중인 봇',bots.filter(b=>!b.deleted))+group('삭제된 봇',bots.filter(b=>b.deleted));
}
export const historyBudgetCaption=bot=>bot.deleted?(bot.budgetKnown===false?'삭제 전 기준예산 미확인':'삭제 시점 기준예산'):'현재 기준예산';
