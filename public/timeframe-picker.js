import {CHART_TIMEFRAMES,chartIntervalLabel} from './chart-timeframes.js';
export function installTimeframePicker({root,onSelect}){
 root.className='chart-interval-more';root.innerHTML='<button type="button" class="interval-more-button" aria-label="봉 주기 더보기" aria-haspopup="true" aria-expanded="false">⋯</button><div class="interval-more-menu" hidden aria-label="전체 봉 주기">'+[['분','m'],['시간','h'],['일·주·월','other']].map(([label,unit])=>'<div role="group" aria-label="'+label+' 주기"><small>'+label+'</small><div>'+CHART_TIMEFRAMES.filter(([key])=>unit==='other'?!/[mh]$/.test(key):key.endsWith(unit)).map(([key,text])=>'<button type="button" data-extra-interval="'+key+'" aria-pressed="false">'+text+'</button>').join('')+'</div></div>').join('')+'</div>';
 const button=root.querySelector('.interval-more-button'),menu=root.querySelector('.interval-more-menu'),close=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false');};
 button.addEventListener('click',()=>{const open=menu.hidden;menu.hidden=!open;button.setAttribute('aria-expanded',String(open));if(open)menu.querySelector('[aria-pressed="true"]')?.focus();});
 menu.addEventListener('click',event=>{const item=event.target.closest('[data-extra-interval]');if(!item)return;close();onSelect(item.dataset.extraInterval);button.focus();});
 root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();button.focus();}});
 document.addEventListener('pointerdown',event=>{if(!root.contains(event.target))close();});
 return {sync(interval){const extra=!['1m','5m','15m','1h','4h','1d'].includes(interval);button.textContent=extra?chartIntervalLabel(interval)+' ⋯':'⋯';button.classList.toggle('active',extra);button.setAttribute('aria-label','봉 주기 더보기 · 현재 '+chartIntervalLabel(interval));for(const item of menu.querySelectorAll('[data-extra-interval]'))item.setAttribute('aria-pressed',String(item.dataset.extraInterval===interval));},close};
}
export function fillTimeframeSelect(select){select.innerHTML=CHART_TIMEFRAMES.map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('');}
