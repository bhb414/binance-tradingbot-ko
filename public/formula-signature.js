import './analysis-formula.js';
const signature={
 weekday:{calendar:true,params:["시간대 (선택)"],help:["현재 감시 시각의 요일. 월요일=1 ~ 일요일=7. 기본 한국시간 · 한국시간/미국동부/UTC 중 선택."]},
 clockTime:{calendar:true,params:["시간대 (선택)"],help:["현재 감시 시각을 HHMM으로 반환. 예: 930 = 09:30. 기본 한국시간 · 한국시간/미국동부/UTC 중 선택."]},
 timeWindow:{calendar:true,params:["시작 HHMM","종료 HHMM","시간대 (선택)"],help:["시작 포함. 예: 900 = 09:00. 2300, 600처럼 자정을 넘는 구간도 지원합니다.","종료 미포함. 예: 1800 = 18:00 직전까지. 종료에만 2400을 사용할 수 있습니다.","기본 한국시간. 한국시간/미국동부/UTC. 미국 동부시간의 서머타임은 자동 반영합니다."]},
  crossUp:{params:['A · 돌파하는 값','B · 기준 값'],help:['앞 값 A가 뒤 기준 B를 아래에서 위로 돌파합니다.','뒤 인수 B가 기준입니다. 이전 A ≤ B에서 현재 A > B로 바뀌는 순간입니다.']},
  crossDown:{params:['A · 돌파하는 값','B · 기준 값'],help:['앞 값 A가 뒤 기준 B를 위에서 아래로 돌파합니다.','뒤 인수 B가 기준입니다. 이전 A ≥ B에서 현재 A < B로 바뀌는 순간입니다.']},
  sma:{params:['데이터','기간'],help:['평균을 계산할 데이터. 예: 종가, 거래량.','평균에 사용할 봉 수 · 1~500 정수.']},
  ema:{params:['데이터','기간'],help:['지수이동평균을 계산할 데이터. 예: 종가.','EMA 기간 · 1~500 정수.']},
  rsi:{params:['데이터','기간'],help:['상승·하락 강도를 계산할 데이터.','RSI 기간 · 1~500 정수.']},
  stdev:{params:['데이터','기간'],help:['표준편차를 계산할 데이터.','기간 · 1~500 정수.']},
  bbUpper:{params:['데이터','기간','배수'],help:['볼린저밴드를 계산할 데이터.','이동평균·표준편차 기간 · 1~500 정수.','중심선에 더할 표준편차 배수. 예: 2.']},
  bbMiddle:{params:['데이터','기간','배수 (선택)'],help:['볼린저 중심선의 데이터.','이동평균 기간 · 1~500 정수.','중심선 계산에는 영향을 주지 않습니다.']},
  bbLower:{params:['데이터','기간','배수'],help:['볼린저밴드를 계산할 데이터.','이동평균·표준편차 기간 · 1~500 정수.','중심선에서 뺄 표준편차 배수. 예: 2.']},
  atr:{params:['기간'],help:['일반 고가·저가·종가의 평균 진폭 · 1~500 정수.']},
  abs:{params:['값'],help:['값의 절대값.']},min:{params:['값 A','값 B'],help:['두 값 중 작은 값을 반환합니다.','비교할 두 번째 값.']},max:{params:['값 A','값 B'],help:['두 값 중 큰 값을 반환합니다.','비교할 두 번째 값.']},
  between:{params:['값','하한','상한'],help:['범위를 확인할 값.','하한 포함.','상한 포함.']},
  change:{params:['데이터','봉 수'],help:['증감을 계산할 데이터.','현재 값에서 N봉 전 값을 뺍니다.']},changePct:{params:['데이터','봉 수'],help:['변화율을 계산할 데이터.','N봉 전 대비 변화율(%).']}
};
export function signatureAt(source,caret){
  const text=String(source).slice(0,caret),stack=[];
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='('){const name=text.slice(0,i).match(/([A-Za-z_\u3131-\uD79D][A-Za-z0-9_\u3131-\uD79D]*)\s*$/)?.[1];stack.push({type:'(',name,arg:0});}
    else if(c==='[')stack.push({type:'['});
    else if(c===')'||c===']'){const type=c===')'?'(':'[';if(stack.at(-1)?.type===type)stack.pop();}
    else if(c===','&&stack.at(-1)?.type==='(')stack.at(-1).arg++;
  }
  const call=[...stack].reverse().find(item=>item.name&&signature[globalThis.AnalysisFormula.functionAliases[item.name.toLowerCase()]]);
  if(!call)return null;
  const definition=signature[globalThis.AnalysisFormula.functionAliases[call.name.toLowerCase()]];
  return {...definition,name:call.name,argument:call.arg};
}
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function installSignatureHelp(textarea,popup){
  let dismissed=false;const controller=new AbortController();
  const listen=(element,event,handler,options={})=>element.addEventListener(event,handler,{...options,signal:controller.signal});
  function hide(){popup.hidden=true;textarea.setAttribute('aria-describedby','formula-syntax-note');}
  function update(reset=false){
    if(reset)dismissed=false;
    const help=signatureAt(textarea.value,textarea.selectionStart);
    if(document.activeElement!==textarea||dismissed||!help){hide();return;}
    popup.innerHTML='<div class="signature-line"><b>'+esc(help.name)+'</b>( '+help.params.map((param,index)=>'<span class="'+(index===help.argument?'active':'')+'">'+esc(param)+'</span>').join(', ')+' )</div><p>'+esc(help.help[help.argument]||'함수의 인수 개수를 확인하세요.')+'</p><small>'+(help.calendar?'현재 감시 시각 · @봉주기·[1]로 이동하지 않습니다.':'주기 예: @5m · 직전 봉: [1]')+' <span>Esc 닫기</span></small>';
    popup.hidden=false;textarea.setAttribute('aria-describedby','formula-signature');
    const mirror=document.createElement('div'),style=getComputedStyle(textarea);
    for(const key of ['font','lineHeight','letterSpacing','padding','border','boxSizing','wordBreak','overflowWrap','tabSize'])mirror.style[key]=style[key];
    Object.assign(mirror.style,{position:'fixed',visibility:'hidden',whiteSpace:'pre-wrap',width:textarea.clientWidth+'px',height:'auto'});
    mirror.textContent=textarea.value.slice(0,textarea.selectionStart);const marker=document.createElement('span');marker.textContent='\u200b';mirror.append(marker);document.body.append(mirror);
    const rect=textarea.getBoundingClientRect(),lineHeight=parseFloat(style.lineHeight),caretTop=rect.top+marker.offsetTop-textarea.scrollTop;
    const boundary=textarea.closest('dialog').getBoundingClientRect(),viewportWidth=document.documentElement.clientWidth;
    const width=Math.min(430,rect.width-12,boundary.width-24,viewportWidth-24);popup.style.width=width+'px';
    const left=Math.max(12,boundary.left+12,Math.min(rect.left+marker.offsetLeft-textarea.scrollLeft,Math.min(viewportWidth,boundary.right)-width-12));
    let top=caretTop+lineHeight+6;
    if(top+popup.offsetHeight>Math.min(boundary.bottom-12,innerHeight-12))top=caretTop-popup.offsetHeight-6;
    popup.style.left=left+'px';popup.style.top=Math.max(boundary.top+12,top)+'px';mirror.remove();
    if(caretTop<rect.top||caretTop>rect.bottom)hide();
  }
  listen(textarea,'input',()=>update(true));listen(textarea,'click',()=>update(true));listen(textarea,'keyup',event=>{if(event.key!=='Escape')update();});listen(textarea,'focus',()=>update(true));listen(textarea,'blur',hide);listen(textarea,'scroll',()=>update());
  listen(textarea,'keydown',event=>{if(event.key==='Escape'&&!popup.hidden){event.preventDefault();event.stopPropagation();dismissed=true;hide();}if(event.ctrlKey&&event.shiftKey&&event.code==='Space'){event.preventDefault();update(true);}});
  listen(textarea.closest('.editor-body'),'scroll',hide,{passive:true});listen(window,'resize',hide);
  return {update,hide,dispose(){hide();controller.abort();}};
}
