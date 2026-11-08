import {CHART_TIMEFRAMES,chartIntervalLabel} from './chart-timeframes.js';
import {installChartMenu} from './chart-menu.js';
export function installTimeframePicker({root,onSelect}){
 root.className='chart-interval-more chart-timeframe-picker';root.innerHTML='<button type="button" class="chart-timeframe-button" aria-label="차트 봉 주기 선택" aria-haspopup="menu" aria-expanded="false"><span>15분</span><i aria-hidden="true">⌄</i></button><div class="interval-more-menu" role="menu" hidden aria-label="전체 봉 주기">'+[['분','m'],['시간','h'],['일·주·월','other']].map(([label,unit])=>'<div role="group" aria-label="'+label+' 주기"><small>'+label+'</small><div>'+CHART_TIMEFRAMES.filter(([key])=>unit==='other'?!/[mh]$/.test(key):key.endsWith(unit)).map(([key,text])=>'<button type="button" role="menuitemradio" data-extra-interval="'+key+'" aria-checked="false">'+text+'</button>').join('')+'</div></div>').join('')+'</div>';
 const button=root.querySelector('.chart-timeframe-button'),menu=root.querySelector('.interval-more-menu'),items=[...menu.querySelectorAll('[data-extra-interval]')];
 const picker=installChartMenu(root,button,menu,{onOpen:()=>menu.querySelector('[aria-checked="true"]')?.focus({preventScroll:true})});
 const sync=interval=>{button.querySelector('span').textContent=chartIntervalLabel(interval);button.setAttribute('aria-label','차트 봉 주기 선택 · 현재 '+chartIntervalLabel(interval));for(const item of items)item.setAttribute('aria-checked',String(item.dataset.extraInterval===interval));};
 menu.addEventListener('click',event=>{const item=event.target.closest('[data-extra-interval]');if(!item)return;sync(item.dataset.extraInterval);picker.close();onSelect(item.dataset.extraInterval);button.focus({preventScroll:true});});
 root.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();if(menu.hidden){picker.open();return;}const index=items.indexOf(root.ownerDocument.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus({preventScroll:true});});
 sync('15m');return {sync,close:picker.close};
}
export function fillTimeframeSelect(select){select.innerHTML=CHART_TIMEFRAMES.map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('');}
