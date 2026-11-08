// Optional display keys preserve the shape of legacy saved documents.
export const defaultChartLabels=()=>({studies:true,current:true,positions:true});
export function normalizeChartLabels(value){
 const result=defaultChartLabels();if(value===undefined)return result;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('차트 우측 라벨 설정을 확인해 주세요.');
 for(const key of Object.keys(result))if(value[key]!==undefined){if(typeof value[key]!=='boolean')throw Error('차트 우측 라벨 설정을 확인해 주세요.');result[key]=value[key];}
 if(value.price!==undefined){if(typeof value.price!=='boolean')throw Error('가격 그래프 표시 설정을 확인해 주세요.');result.price=value.price;}
 if(value.studyCrosshairDots!==undefined){if(typeof value.studyCrosshairDots!=='boolean')throw Error('십자선 지표 점 표시 설정을 확인해 주세요.');result.studyCrosshairDots=value.studyCrosshairDots;}
 return result;
}
export class ChartLabelPreferences{
 constructor(){this.value=defaultChartLabels();this.listeners=new Set();this.writer=null;this.busy=false;}
 get ready(){return !!this.writer;}
 subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 publish(){for(const listener of this.listeners)listener(this.value);}
 apply(value){this.value=normalizeChartLabels(value);this.publish();}
 configure(writer){this.writer=writer;this.publish();}
 async set(key,visible){
  if((!['price','studyCrosshairDots'].includes(key)&&!Object.hasOwn(this.value,key))||typeof visible!=='boolean')throw Error('차트 표시 설정을 확인해 주세요.');
  if(!this.ready)throw Error('지표 설정을 먼저 불러와 주세요.');if(this.busy)throw Error('차트 라벨을 저장 중입니다.');
  this.busy=true;this.publish();
  try{const next={...this.value,[key]:visible};await this.writer(next);this.apply(next);}finally{this.busy=false;this.publish();}
 }
}
export const chartLabelPreferences=new ChartLabelPreferences();
export function applyStudyAxisLabels(rows,visible){
 for(const row of rows)for(const plot of row.plots)plot.series.applyOptions({title:!plot.fillOnly&&visible?(plot.axisTitle||''):'',lastValueVisible:false});
}
export function applyStudyCrosshairDots(rows,visible){
 for(const row of rows)for(const plot of row.plots){const supported=plot.crosshairDots??(!plot.histogram&&!plot.fillOnly&&!plot.projection&&!plot.anchorOnly);plot.series.applyOptions({crosshairMarkerVisible:!!visible&&supported});}
}
export function installChartLabelMenu(host,{preferences=chartLabelPreferences,onError=()=>{}}={}){
 if(!host)return;
 host.classList.add('chart-label-menu');
 host.innerHTML='<button type="button" class="toolbar-button chart-label-button" aria-label="차트 우측 라벨 설정" aria-expanded="false"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h8l10 8-9 9-9-10zM7 8h.01"/></svg>라벨</button><div class="chart-label-panel" role="group" aria-label="차트 우측 라벨" hidden><strong>우측 라벨 표시</strong>'+[['studies','지표 이름'],['current','현재가'],['positions','진입 평단']].map(([key,label])=>'<label><input type="checkbox" data-axis-label="'+key+'" aria-label="우측 '+label+' 표시">'+label+'</label>').join('')+'<small>선은 유지하고 우측 라벨만 숨깁니다.</small><strong>십자선 표시</strong><label><input type="checkbox" data-axis-label="studyCrosshairDots" aria-label="십자선 지표 점 표시">지표 위 점 표시</label><small>십자선과 지표 값은 유지합니다.<br>서버에 저장 · 다른 기기에서도 복원</small><output role="status"></output></div>';
 const button=host.querySelector('button'),panel=host.querySelector('.chart-label-panel'),output=host.querySelector('output');
 const close=()=>{panel.hidden=true;button.setAttribute('aria-expanded','false');};
 button.addEventListener('click',()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));});
 const sync=value=>{for(const input of host.querySelectorAll('input')){const key=input.dataset.axisLabel;input.checked=key==='studyCrosshairDots'?value[key]!==false:value[key];input.disabled=!preferences.ready||preferences.busy;}if(preferences.busy)output.textContent='저장 중…';};
 const unsubscribe=preferences.subscribe(sync);sync(preferences.value);
 panel.addEventListener('change',async event=>{const key=event.target.dataset.axisLabel;if(!key)return;try{await preferences.set(key,event.target.checked);output.textContent='저장됨';}catch(error){sync(preferences.value);output.textContent=error.message;onError(error.message);}});
 const outside=event=>{if(!host.contains(event.target))close();},escape=event=>{if(event.key==='Escape'&&!panel.hidden){event.stopPropagation();close();button.focus();}};
 document.addEventListener('click',outside);host.addEventListener('keydown',escape);
 return()=>{unsubscribe();document.removeEventListener('click',outside);host.removeEventListener('keydown',escape);};
}
