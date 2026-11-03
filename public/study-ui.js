import {STUDIES,STUDY_KEY,MAX_STUDIES,TIMEFRAMES,SOURCES,createStudy,validateStudy,parseStudies,defaultStudies,studyLabel,formulaStudyResult} from './chart-studies.js';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const paths={settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',close:'M6 6l12 12M6 18L18 6',up:'M6 15l6-6 6 6',down:'M6 9l6 6 6-6'};
export const studyIcon=name=>'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';
let studies;try{studies=parseStudies(localStorage.getItem(STUDY_KEY));}catch{studies=defaultStudies();}
const listeners=new Set();let category='all',editing=null,toast=()=>{};
let adding=false,context='home',previewTimer;const previewCandles={home:[],modal:[]};
const formulaExamples=[{name:'3봉 평균 · 직접 계산',value:'(종가[0]+종가[1]+종가[2])/3',placement:'overlay'},{name:'지수이동평균 20',value:'EMA(종가, 20)',placement:'overlay'},{name:'이평선 차이',value:'EMA(종가, 12)-EMA(종가, 26)',placement:'pane'},{name:'직전 봉 대비 등락률 (%)',value:'(종가/종가[1]-1)*100',placement:'pane'},{name:'거래량 비율',value:'거래량/SMA(거래량, 20)',placement:'pane'},{name:'3봉 평균 · 구간 합계',value:'종가[0:3]/3',placement:'overlay'}];
export function setStudyPreviewData(kind,candles){previewCandles[kind]=candles;if(editing?.type==='FORMULA'&&context===kind)scheduleFormulaPreview();}
export const getStudies=()=>structuredClone(studies);
export function subscribeStudies(listener){listeners.add(listener);return()=>listeners.delete(listener);}
function commit(next){
  if(next.length>MAX_STUDIES)throw new Error('지표는 최대 '+MAX_STUDIES+'개까지 추가할 수 있습니다.');
  const checked=next.map(validateStudy);localStorage.setItem(STUDY_KEY,JSON.stringify({version:1,studies:checked}));studies=checked;
  for(const listener of listeners)listener();if($('#indicator-dialog').open)renderLibrary();
}
export function studyControls(study){const name=esc(studyLabel(study));return '<button type="button" class="study-icon-button" data-study-edit="'+study.id+'" aria-label="'+name+' 설정" title="설정">'+studyIcon('settings')+'</button><button type="button" class="study-icon-button '+(!study.visible?'is-off':'')+'" data-study-toggle="'+study.id+'" aria-label="'+name+(study.visible?' 숨기기':' 표시하기')+'" title="'+(study.visible?'숨기기':'표시하기')+'">'+studyIcon('eye')+'</button><button type="button" class="study-icon-button" data-study-remove="'+study.id+'" aria-label="'+name+' 삭제" title="삭제">'+studyIcon('close')+'</button>';}
function renderLibrary(){
  const query=$('#study-search').value.toLowerCase().replace(/\s/g,'');
  $('#study-added-count').textContent=studies.length;$('#study-library-status').textContent='추가된 지표 '+studies.length+' / '+MAX_STUDIES;
  const results=$('#study-catalog');
  if(category==='added'){
    const items=studies.filter(study=>(studyLabel(study)+STUDIES[study.type].name+STUDIES[study.type].english).toLowerCase().replace(/\s/g,'').includes(query));
    results.innerHTML=items.length?items.map(study=>{const index=studies.findIndex(item=>item.id===study.id);return '<div class="study-added-row"><span class="study-type-mark" style="--study-color:'+study.styles[STUDIES[study.type].plots[0].key].color+'">'+study.type+'</span><div class="study-result-name"><strong>'+esc(studyLabel(study))+'</strong><small>'+STUDIES[study.type].name+' · '+(study.visible?'표시 중':'숨김')+'</small></div><div class="study-row-controls"><button type="button" class="study-icon-button" data-study-move="'+study.id+'" data-step="-1" aria-label="'+esc(studyLabel(study))+' 위로" '+(!index?'disabled':'')+'>'+studyIcon('up')+'</button><button type="button" class="study-icon-button" data-study-move="'+study.id+'" data-step="1" aria-label="'+esc(studyLabel(study))+' 아래로" '+(index===studies.length-1?'disabled':'')+'>'+studyIcon('down')+'</button>'+studyControls(study)+'</div></div>';}).join(''):'<p class="study-empty">추가된 지표가 없습니다. 목록에서 지표를 추가해 보세요.</p>';
  }else{
    const items=Object.entries(STUDIES).filter(([type,definition])=>(category==='all'||category===definition.group)&&(type+definition.name+definition.english).toLowerCase().replace(/\s/g,'').includes(query));
    results.innerHTML=items.length?items.map(([type,definition])=>{const count=studies.filter(study=>study.type===type).length;return '<button type="button" class="study-catalog-row" data-study-add="'+type+'" aria-label="'+(type==='FORMULA'?'수식':type)+' 지표 추가"><span class="study-type-mark" style="--study-color:'+definition.plots[0].color+'">'+(type==='FORMULA'?'ƒ(x)':type)+'</span><span class="study-result-name"><strong>'+definition.name+'</strong><small>'+definition.english+'</small></span><span class="study-result-meta">'+(count?'<small>'+count+'개 사용 중</small>':'')+'<span>'+(type==='FORMULA'?'위치 선택':definition.pane?'별도 패널':'차트 위')+'</span></span><span class="study-add-mark">＋</span></button>';}).join(''):'<p class="study-empty">검색된 지표가 없습니다.</p>';
  }
}
export function openStudyLibrary(options={}){context=options.context==='modal'?'modal':'home';category='all';$('#study-search').value='';document.querySelectorAll('[data-study-category]').forEach(button=>button.classList.toggle('active',button.dataset.studyCategory===category));renderLibrary();$('#indicator-dialog').showModal();}
const options=(items,value)=>items.map(([key,label])=>'<option value="'+key+'" '+(key===value?'selected':'')+'>'+label+'</option>').join('');
function fieldMarkup(field){const value=editing.params[field.key];return '<label class="field '+(field.type==='formula'?'study-formula-field':'')+'"><span>'+field.label+'</span>'+(field.type==='formula'?'<textarea id="study-formula-source" data-study-field="formula" aria-label="지표 수식" rows="5" maxlength="1000" spellcheck="false" autocomplete="off" autocapitalize="off">'+esc(value)+'</textarea>':field.type==='text'?'<input type="text" data-study-field="'+field.key+'" aria-label="'+field.label+'" value="'+esc(value)+'" maxlength="'+field.maxLength+'">':field.options?'<select data-study-field="'+field.key+'" aria-label="'+field.label+'">'+options(field.options,value)+'</select>':'<input type="number" data-study-field="'+field.key+'" aria-label="'+field.label+'" value="'+value+'" min="'+field.min+'" max="'+field.max+'" step="'+field.step+'">')+'</label>';}
function openSettings(id,{newStudy=null}={}){
  editing=structuredClone(newStudy||studies.find(study=>study.id===id));adding=!!newStudy;if(!editing)return;
  const definition=STUDIES[editing.type];$('#study-settings-title').textContent=definition.name+' 설정';$('#study-settings-subtitle').textContent=studyLabel(editing);$('#study-settings-error').hidden=true;
  $('#study-input-panel').innerHTML='<div class="study-fields">'+definition.fields.map(fieldMarkup).join('')+(definition.source?'<label class="field"><span>가격 소스</span><select data-study-source aria-label="가격 소스">'+options(SOURCES,editing.source)+'</select></label>':'')+(editing.type==='FORMULA'?'':'<label class="field"><span>캔들 계산 기준</span><select data-study-candle aria-label="캔들 계산 기준">'+options([['chart','차트와 같게'],['standard','일반 캔들'],['heikin','하이킨아시']],editing.candle)+'</select></label>')+'</div>'+(editing.type==='FORMULA'?'<label class="study-formula-example">예제 수식<select id="study-formula-example" aria-label="지표 수식 예제"><option value="">예제를 선택해 입력</option>'+formulaExamples.map((item,index)=>'<option value="'+index+'">'+item.name+'</option>').join('')+'</select></label><div id="study-formula-status" class="study-formula-status" role="status"></div><p class="study-formula-help"><code>종가 · 시가 · 고가 · 저가 · 거래량 · 하이킨종가</code><br><code>+ − * / · SMA() · EMA() · RSI() · ATR() · 볼린저상단()</code></p>':'')+'<p class="study-input-note">'+(definition.note||'기간은 현재 차트의 봉 개수입니다. 하이킨아시를 선택하면 합성 가격으로 계산합니다.')+'</p>';
  $('#study-style-panel').innerHTML=definition.plots.map(item=>{const style=editing.styles[item.key];return '<div class="study-style-row"><label><input type="checkbox" data-study-style="'+item.key+'" data-style-key="visible" '+(style.visible?'checked':'')+' aria-label="'+item.label+' 표시"><strong>'+item.label+'</strong></label><div class="study-style-options"><label>색상<input type="color" data-study-style="'+item.key+'" data-style-key="color" value="'+style.color+'" aria-label="'+item.label+' 색상"></label>'+(item.histogram?'<label>음수·하락 색상<input type="color" data-study-style="'+item.key+'" data-style-key="negative" value="'+style.negative+'" aria-label="'+item.label+' 하락 색상"></label>':'<label>두께<select data-study-style="'+item.key+'" data-style-key="width" aria-label="'+item.label+' 두께">'+options([[1,'1 px'],[2,'2 px'],[3,'3 px'],[4,'4 px']],style.width)+'</select></label><label>선 종류<select data-study-style="'+item.key+'" data-style-key="lineStyle" aria-label="'+item.label+' 선 종류">'+options([[0,'실선'],[2,'파선'],[1,'점선']],style.lineStyle)+'</select></label>')+'</div></div>';}).join('');
  $('#study-visibility-panel').innerHTML='<p class="study-input-note">선택한 봉 주기의 차트에서만 표시합니다. 각 주기의 봉으로 계산합니다.</p><div class="study-timeframes">'+TIMEFRAMES.map(([key,label])=>'<label><input type="checkbox" data-study-timeframe="'+key+'" '+(editing.timeframes.includes(key)?'checked':'')+'>'+label+'</label>').join('')+'</div><label class="study-visibility-toggle"><input type="checkbox" data-study-visible '+(editing.visible?'checked':'')+'>이 지표 표시</label>';
  switchSettingsTab('input');$('#study-settings-dialog').showModal();updateFormulaPreview();
}
function scheduleFormulaPreview(){clearTimeout(previewTimer);previewTimer=setTimeout(updateFormulaPreview,180);}
function updateFormulaPreview(){
  const output=$('#study-formula-status');if(!output||editing?.type!=='FORMULA')return;
  try{validateStudy(editing);const candles=previewCandles[context];if(!candles.length){output.className='study-formula-status';output.textContent='문법 정상 · 시세 수신 후 계산값을 표시합니다.';return;}const result=formulaStudyResult(editing.params.formula,candles);if(!result.ok)throw new Error(result.error);const last=result.values.at(-1);output.className='study-formula-status'+(last==null?' is-warning':'');output.textContent=last==null?'문법 정상 · 현재 봉은 과거 데이터 부족 또는 0 나눗셈으로 계산값이 없습니다.':'문법 정상 · 최신 봉 계산값 '+last.toLocaleString('en-US',{maximumFractionDigits:8});}
  catch(error){output.className='study-formula-status is-error';output.textContent=error.message;}
}
function switchSettingsTab(tab){document.querySelectorAll('[data-study-settings-tab]').forEach(button=>{const active=button.dataset.studySettingsTab===tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',active);});for(const name of ['input','style','visibility'])$('#study-'+name+'-panel').hidden=name!==tab;}
export function installStudyUI({notify}){
  toast=notify;$('#study-search').addEventListener('input',renderLibrary);
  const custom=document.createElement('button');custom.type='button';custom.dataset.studyCategory='custom';custom.textContent='수식 만들기';document.querySelector('[data-study-category="all"]').after(custom);
  $('#study-settings-dialog').addEventListener('close',()=>{clearTimeout(previewTimer);editing=null;adding=false;});
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    try{
      if(button.dataset.studyCategory){category=button.dataset.studyCategory;document.querySelectorAll('[data-study-category]').forEach(item=>item.classList.toggle('active',item===button));renderLibrary();}
      if(button.dataset.studyAdd){const study=createStudy(button.dataset.studyAdd);if(study.type==='FORMULA'){if(studies.length>=MAX_STUDIES)throw new Error('지표는 최대 '+MAX_STUDIES+'개까지 추가할 수 있습니다.');openSettings(study.id,{newStudy:study});}else{commit([...studies,study]);toast(STUDIES[study.type].name+' 지표를 추가했습니다.');}}
      if(button.dataset.studyEdit){const source=button.closest('[data-study-context]')?.dataset.studyContext;if(source)context=source;openSettings(button.dataset.studyEdit);}
      if(button.dataset.studyToggle)commit(studies.map(study=>study.id===button.dataset.studyToggle?{...study,visible:!study.visible}:study));
      if(button.dataset.studyRemove)commit(studies.filter(study=>study.id!==button.dataset.studyRemove));
      if(button.dataset.studyMove){const next=[...studies],index=next.findIndex(study=>study.id===button.dataset.studyMove),target=index+Number(button.dataset.step);if(index>=0&&target>=0&&target<next.length){[next[index],next[target]]=[next[target],next[index]];commit(next);}}
      if(button.dataset.studySettingsTab)switchSettingsTab(button.dataset.studySettingsTab);
    }catch(error){toast(error.name==='QuotaExceededError'?'브라우저에 지표 설정을 저장하지 못했습니다.':error.message,true);}
  });
  $('#study-settings-form').addEventListener('input',event=>{
    if(!editing)return;const input=event.target;
    if(input.dataset.studyField)editing.params[input.dataset.studyField]=input.type==='number'?input.valueAsNumber:input.value;
    if(input.hasAttribute('data-study-source'))editing.source=input.value;
    if(input.hasAttribute('data-study-candle'))editing.candle=input.value;
    if(input.dataset.studyStyle){const key=input.dataset.styleKey;editing.styles[input.dataset.studyStyle][key]=key==='visible'?input.checked:['width','lineStyle'].includes(key)?Number(input.value):input.value;}
    if(input.hasAttribute('data-study-timeframe'))editing.timeframes=[...document.querySelectorAll('[data-study-timeframe]:checked')].map(item=>item.dataset.studyTimeframe);
    if(input.hasAttribute('data-study-visible'))editing.visible=input.checked;
    if(editing.type==='FORMULA')scheduleFormulaPreview();
  });
  $('#study-settings-form').addEventListener('change',event=>{if(event.target.id!=='study-formula-example'||!editing||event.target.value==='')return;const example=formulaExamples[Number(event.target.value)];editing.params.formula=example.value;editing.params.placement=example.placement;$('#study-formula-source').value=example.value;document.querySelector('[data-study-field="placement"]').value=example.placement;updateFormulaPreview();});
  $('#study-settings-form').addEventListener('submit',event=>{event.preventDefault();try{const value=validateStudy(editing);if(value.type==='FORMULA'&&previewCandles[context].length){const result=formulaStudyResult(value.params.formula,previewCandles[context]);if(!result.ok)throw new Error(result.error);}if(!adding&&!studies.some(study=>study.id===value.id))throw new Error('이 지표는 이미 삭제되었습니다.');commit(adding?[...studies,value]:studies.map(study=>study.id===value.id?value:study));$('#study-settings-dialog').close();toast('지표 설정을 저장했습니다.');}catch(error){$('#study-settings-error').textContent=error.message;$('#study-settings-error').hidden=false;}});
}
