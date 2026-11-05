import {installFormulaCompletion} from './formula-snippets.js';
import './analysis-formula.js';
const occurrenceHelp=['봉마다 확인할 조건. 참인 봉을 각각 1회로 셉니다. 주문 횟수가 아닙니다.','최근 N봉 · 1~500. 현재 봉 포함이며 전체 뒤 [1]을 붙이면 완성봉만 셉니다.','최소 횟수 포함 · 0~N.','최대 횟수 포함 · 생략하면 N.'];
const startHelp=['거짓 → 참으로 바뀐 봉만 1회로 셉니다. 3봉 연속 참이면 신규 발생은 1회입니다.',...occurrenceHelp.slice(1)];
const signature={
 occurs:{params:['조건','최근 봉 수','최소 횟수','최대 횟수 (선택)'],help:occurrenceHelp},
 countTrue:{params:['조건','최근 봉 수'],help:occurrenceHelp},
 occursStarts:{params:['조건','최근 봉 수','최소 횟수','최대 횟수 (선택)'],help:startHelp},
 countStarts:{params:['조건','최근 봉 수'],help:startHelp},
 currentReturn:{position:true,params:[],help:["현재 마크가격 기준 · 진입 증거금 대비 수익률(%) · 보유 배수 반영. 예: 20배에서 유리하게 0.5% 움직이면 +10%. 수수료·펀딩 제외."]},
 priceChange:{position:true,params:[],help:["평균 진입가 대비 현재 마크가격 변화(%). 보유 배수는 반영하지 않습니다. 롱은 상승, 숏은 하락할 때 양수입니다."]},
 currentPnl:{position:true,params:[],help:["현재 보유분의 미실현손익(USDT). 수수료·펀딩과 이전 정리의 실현손익은 제외합니다."]},
 hasPosition:{position:true,params:[],help:["포지션이 있으면 1, 없으면 0입니다. 포지션이 없을 때 다른 수익률·손익 함수는 미확인값입니다."]},
 weekday:{calendar:true,params:["시간대 (선택)"],help:["현재 감시 시각의 요일. 월요일=1 ~ 일요일=7. 기본 한국시간 · 한국시간/미국동부/UTC 중 선택."]},
 clockTime:{calendar:true,params:["시간대 (선택)"],help:["현재 감시 시각을 HHMM으로 반환. 예: 930 = 09:30. 기본 한국시간 · 한국시간/미국동부/UTC 중 선택."]},
 timeWindow:{calendar:true,params:["시작 HHMM","종료 HHMM","시간대 (선택)"],help:["시작 포함. 예: 900 = 09:00. 2300, 600처럼 자정을 넘는 구간도 지원합니다.","종료 미포함. 예: 1800 = 18:00 직전까지. 종료에만 2400을 사용할 수 있습니다.","기본 한국시간. 한국시간/미국동부/UTC. 미국 동부시간의 서머타임은 자동 반영합니다."]},
  crossUp:{params:['A · 돌파하는 값','B · 기준 값'],help:['앞 값 A가 뒤 기준 B를 아래에서 위로 돌파합니다.','뒤 인수 B가 기준입니다. 이전 A ≤ B에서 현재 A > B로 바뀌는 순간입니다.']},
  crossDown:{params:['A · 돌파하는 값','B · 기준 값'],help:['앞 값 A가 뒤 기준 B를 위에서 아래로 돌파합니다.','뒤 인수 B가 기준입니다. 이전 A ≥ B에서 현재 A < B로 바뀌는 순간입니다.']},
  sma:{params:['데이터','기간'],help:['평균을 계산할 데이터. 예: 종가, 거래량.','평균에 사용할 봉 수 · 1~500 정수.']},
  nextBar:{params:['계산할 지표·조건','다음 시가','다음 고가','다음 저가','다음 종가','다음 거래량 (선택)'],help:['가정한 1봉을 추가한 뒤 계산할 식입니다. 실제 미래 데이터나 가격 예측이 아닙니다. 결과는 현재 시점에 표시합니다.','일반 봉 시가의 가정값. 숫자 또는 현재·과거 데이터의 수식을 넣습니다.','일반 봉 고가. 가정 시가·종가 이상이어야 합니다.','일반 봉 저가. 가정 시가·종가 이하여야 합니다.','일반 봉 종가. SMA(하이킨종가, 6)처럼 이평식도 가능합니다. OHLC로 다음 하이킨아시를 다시 계산합니다.','예상 거래량 · 0 이상. 생략하면 다음 거래량은 미확인이므로 VWMA·거래량 지표도 미확인일 수 있습니다.']},
  vwma:{params:['데이터','기간','거래량 (선택)'],help:['거래량 가중이동평균. 예: 종가 또는 하이킨종가. 현재·과거 봉만 사용합니다.','현재 봉 포함 · 1~500 정수. 가격 × 거래량 합계 ÷ 거래량 합계입니다.','생략하면 데이터 종목의 거래량. 여러 종목을 조합한 데이터에는 A.거래량처럼 직접 지정합니다. 거래량 합계가 0이거나 누락·음수이면 미확인입니다.']},
  ema:{params:['데이터','기간'],help:['지수이동평균을 계산할 데이터. 예: 종가.','EMA 기간 · 1~500 정수.']},
  percentile:{params:['데이터','조회 봉 수','백분위 (0~100)'],help:['값을 작은 순서로 정렬한 뒤 해당 위치를 선형 보간합니다. 누락값이 있으면 미확인입니다.','현재 포함 · 1~500 정수. 함수 뒤 [1]은 직전 완성봉부터 조회합니다.','5와 95 사이가 과거 차이값 분포의 중앙 약 90%입니다. 미래 포함 확률이나 최근 실제 가격 전체의 포함률은 아닙니다.']},
  nw:{params:['데이터','계산 봉 수','Bandwidth'],help:['가우시안 NW 중심선. 예: 하이킨종가. 현재·과거 봉만 사용하며 기본 NW 지표의 Gaussian 중심선과 같습니다.','현재 봉 포함 · 2~500 정수. 전체 창이 준비된 뒤부터 계산합니다.','곡선 부드러움 · 0.1~300. 클수록 부드럽고 반응이 느립니다. 예: 8. ATR 배수와는 다릅니다.']},
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
export function installSignatureHelp(textarea,popup,options={}){
  let dismissed=false;const controller=new AbortController(),originalDescription=textarea.getAttribute('aria-describedby');
  const listen=(element,event,handler,options={})=>element?.addEventListener(event,handler,{...options,signal:controller.signal});
  function hide(){popup.hidden=true;if(originalDescription)textarea.setAttribute('aria-describedby',originalDescription);else textarea.removeAttribute('aria-describedby');}
  function update(reset=false){
    if(reset)dismissed=false;
    const help=signatureAt(textarea.value,textarea.selectionStart);
    if(document.activeElement!==textarea||dismissed||!help){hide();return;}
    popup.innerHTML='<div class="signature-line"><b>'+esc(help.name)+'</b>( '+help.params.map((param,index)=>'<span class="'+(index===help.argument?'active':'')+'">'+esc(param)+'</span>').join(', ')+' )</div><p>'+esc(help.help[help.argument]||'함수의 인수 개수를 확인하세요.')+'</p><small>'+(help.position?'현재 보유분 기준 · @봉주기·[1]로 과거 손익이 되지 않습니다.':help.calendar?'현재 감시 시각 · @봉주기·[1]로 이동하지 않습니다.':options.chart?'현재 차트 봉 주기 · 직전 봉: [1]':'주기 예: @5m · 직전 봉: [1]')+' <span>Esc 닫기</span></small>';
    popup.hidden=false;textarea.setAttribute('aria-describedby',popup.id);
    const mirror=document.createElement('div'),style=getComputedStyle(textarea);
    for(const key of ['font','lineHeight','letterSpacing','padding','border','boxSizing','wordBreak','overflowWrap','tabSize'])mirror.style[key]=style[key];
    Object.assign(mirror.style,{position:'fixed',visibility:'hidden',whiteSpace:'pre-wrap',width:textarea.clientWidth+'px',height:'auto'});
    mirror.textContent=textarea.value.slice(0,textarea.selectionStart);const marker=document.createElement('span');marker.textContent='\u200b';mirror.append(marker);document.body.append(mirror);
    const rect=textarea.getBoundingClientRect(),lineHeight=parseFloat(style.lineHeight),caretTop=rect.top+marker.offsetTop-textarea.scrollTop;
    const boundary=(textarea.closest('dialog')||textarea.parentElement).getBoundingClientRect(),viewportWidth=document.documentElement.clientWidth;
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
  const completion=installFormulaCompletion(textarea,{...options,onShow(){hide();}});
  return {update,hide(){hide();completion.hide();},dispose(){hide();completion.dispose();controller.abort();}};
}
