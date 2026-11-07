import {chartLabelPreferences} from './chart-labels.js';
import {chartTypeIcon,chartTypeLabel} from './chart-types.js';
const eye='<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0"/>';
export class PriceChartLegend{
 constructor({preferences=chartLabelPreferences}={}){
  this.preferences=preferences;this.type='standard';this.element=document.createElement('div');this.element.className='study-chart-legend price-chart-legend';
  this.element.innerHTML='<span class="price-legend-kind"></span><span class="price-legend-name"></span><output class="price-legend-status" role="status"></output><button type="button" class="study-icon-button price-legend-toggle"></button>';
  this.name=this.element.querySelector('.price-legend-name');this.icon=this.element.querySelector('.price-legend-kind');this.status=this.element.querySelector('output');this.button=this.element.querySelector('button');
  this.button.addEventListener('click',async()=>{try{this.error='';await preferences.set('price',preferences.value.price===false);}catch(error){this.error=error.message;}this.sync();});
  this.unsubscribe=preferences.subscribe(()=>this.sync());this.sync();
 }
 update(type){this.type=type;this.sync();}
 sync(){
  const visible=this.preferences.value.price!==false,label=visible?'가격 그래프 숨기기':'가격 그래프 표시';
  this.name.textContent='가격 · '+chartTypeLabel(this.type);this.icon.innerHTML=chartTypeIcon(this.type);
  this.button.innerHTML='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'+eye+(!visible?'<path d="M3 3l18 18"/>':'')+'</svg>';
  this.button.setAttribute('aria-label',label);this.button.setAttribute('aria-pressed',String(visible));this.button.title=label+' · 보조지표와 가격 기준선은 유지';this.button.disabled=!this.preferences.ready||this.preferences.busy;
  this.element.classList.toggle('is-muted',!visible);this.status.textContent=this.error||(this.preferences.busy?'저장 중…':visible?'':'숨김');this.status.title=this.error||'';
 }
 destroy(){this.unsubscribe();this.element.remove();}
}
