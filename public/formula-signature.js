import {installFormulaCompletion,editorViewport} from './formula-snippets.js';
import './analysis-formula.js';
const occurrenceHelp=['봉마다 확인할 조건. 참인 봉을 각각 1회로 셉니다. 주문 횟수가 아닙니다.','최근 N봉 · 1~500. 현재 봉 포함이며 전체 뒤 [1]을 붙이면 완성봉만 셉니다.','최소 횟수 포함 · 0~N.','최대 횟수 포함 · 생략하면 N.'];
const startHelp=['거짓 → 참으로 바뀐 봉만 1회로 셉니다. 3봉 연속 참이면 신규 발생은 1회입니다.',...occurrenceHelp.slice(1)];
const signature={
 choose:{params:['판단','참일 때 값','거짓일 때 값'],help:['조건이 참이면 두 번째 값, 거짓이면 세 번째 값을 사용합니다.']},
 highest:{params:['데이터','최근 봉 수'],help:['현재 포함 최근 N봉의 최고값입니다.']},lowest:{params:['데이터','최근 봉 수'],help:['현재 포함 최근 N봉의 최저값입니다.']},
 histogram:{params:['"막대 이름"','수식','색 기준식 (선택)'],help:['수식을 0부터 원값까지 막대로 표시합니다. 스타일에서 기준 이상·미만 색상을 선택합니다.','표시할 값입니다.','생략은 0. 상수·수식·앞에서 정의한 변수 가능. 값이 기준과 같으면 기준 이상 색상이며, 기준식이 미수집이면 해당 봉은 비웁니다.']},
 plot:{params:['"선 이름"','수식','표시 이동 봉 수 (선택)'],help:['차트 스크립트 전용. 양수는 오른쪽, 음수는 왼쪽으로 표시합니다. 미래 가격 데이터가 아닙니다.']},forecast:{params:['"예상선 이름"','수식','예상 봉 수','기울기 비교 봉 수','기준봉 0 또는 1'],help:['최근 기울기를 미래로 연장하는 차트 스크립트 전용 점선입니다.','원본 지표 수식 또는 변수.','생략 3봉 · 최대 120봉.','생략 3봉. 변화량을 비교 봉 수로 나눕니다.','생략 1: 직전 완성봉. 0: 진행 중인 봉.']},
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
  arrow:{params:['"표시할 글자"','표시할 조건'],help:['차트 전용 화살표. 글자를 자유롭게 지정하고 ""로 비울 수 있습니다. 스타일에서 방향·위치·쌓기 순서를 정합니다.','조건이 참인 봉마다 표시합니다. 같은 봉·위치의 신호는 세로로 쌓이며 쌓기 순서가 작은 신호부터 배치합니다. 주문은 전송하지 않습니다.']},
  bgcolor:{params:['"배경 이름"','칠할 조건'],help:['가격 차트의 봉 한 칸을 세로로 칠합니다. 스타일에서 색상·투명도를 설정합니다. 실제 주문은 전송하지 않습니다.','참인 봉마다 칠하고 돌파 조건은 교차한 봉만 칠합니다. 진행봉은 바뀔 수 있고 조건 뒤 [1]은 이전 봉 조건을 현재 봉에 표시합니다.']},
  buySignal:{params:['"신호 이름"','표시할 조건'],help:['차트 전용 매수 화살표. 이름을 큰따옴표로 감쌉니다. 실제 주문은 전송하지 않습니다.','참인 봉마다 표시합니다. 진행봉은 바뀔 수 있으며 조건 뒤 [1]은 이전 봉 조건을 현재 봉에 표시합니다.']},
  sellSignal:{params:['"신호 이름"','표시할 조건'],help:['차트 전용 매도 화살표. 이름을 큰따옴표로 감쌉니다. 실제 주문은 전송하지 않습니다.','상향돌파()·하향돌파()는 교차한 봉에만 참입니다. 일반 조건은 참인 봉마다 표시합니다.']},
  crossUp:{params:['A · 돌파하는 값','B · 기준 값'],help:['앞 값 A가 뒤 기준 B의 아래쪽에서 실제 위쪽으로 넘어간 봉에만 참입니다.','같거나 계산 오차만큼 가까우면 마지막 위·아래 상태를 유지합니다. 위→같음→위는 제외하고 아래→같음→위만 인정합니다. 주기분석과 같은 기준입니다.']},
  crossDown:{params:['A · 돌파하는 값','B · 기준 값'],help:['앞 값 A가 뒤 기준 B의 위쪽에서 실제 아래쪽으로 넘어간 봉에만 참입니다.','같거나 계산 오차만큼 가까우면 마지막 위·아래 상태를 유지합니다. 아래→같음→아래는 제외하고 위→같음→아래만 인정합니다. 주기분석과 같은 기준입니다.']},
  kama:{params:['데이터','효율비율 기간','빠른 평활 기간 (선택)','느린 평활 기간 (선택)'],help:['카우프만 적응 이동평균. 일반 종가·하이킨종가 등 가격 수식을 받습니다.','1~500 정수. 첫 값은 해당 기간의 단순평균입니다.','생략하면 2. 느린 평활 기간보다 작아야 합니다.','생략하면 30. 거래량은 사용하지 않습니다.']},
  hma:{params:['데이터','기간'],help:['헐 이동평균. HullMA()도 같은 함수입니다. WMA는 시간 가중이며 거래량을 사용하지 않습니다.','1~500 정수. 절반·제곱근 기간은 소수점 버림, 최소 1봉입니다.']},
  cyclePeriod:{params:['분석할 값','조회 봉 수','최소 주기','최대 주기'],help:['파형의 한 바퀴 반복 길이를 봉 수로 추정합니다. 자기상관과 정현파 적합도가 약하면 미확인입니다.','16~500 정수. 최대 주기의 2배 이상이어야 합니다. 현재 봉 포함이며 함수 뒤 [1]은 직전 완성봉 기준입니다.','4 이상 정수. 최대 주기보다 작아야 합니다.','조회 봉 수의 절반 이하. 골든→데드 간격과 구분하며 교차를 예언하는 값이 아닙니다.']},
  barsSince:{params:['발생 조건'],help:['참인 봉은 0, 다음 봉부터 1·2·3…입니다. 첫 발생 전이나 중간 데이터가 미확인이면 미확인입니다. 참인 봉마다 다시 0이 됩니다.']},
  crossInterval:{params:['단기 값','장기 기준 값'],help:['두 값의 골든→데드 또는 데드→골든이 완료된 봉 수입니다. 다음 반대 교차까지 유지합니다.','같은 방향의 반복 터치는 구간을 새로 시작하지 않습니다. 충분한 교차 기록이 없으면 미확인입니다.']},
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
  const text=String(source).slice(0,caret),stack=[];let quoted=false,comment=false;
  if(/[A-Za-z_\u3131-\uD79D][A-Za-z0-9_\u3131-\uD79D]*$/.test(text)&&/^[A-Za-z0-9_\u3131-\uD79D]*\s*\(/.test(String(source).slice(caret)))return null;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(comment){if(c==='\n')comment=false;continue;}if(c==='"'&&text[i-1]!=='\\')quoted=!quoted;if(quoted||c==='"')continue;if(c==='/'&&text[i+1]==='/'){comment=true;i++;continue;}
    if(c==='('){const name=text.slice(0,i).match(/([A-Za-z_\u3131-\uD79D][A-Za-z0-9_\u3131-\uD79D]*)\s*$/)?.[1];stack.push({type:'(',name,arg:0});}
    else if(c==='[')stack.push({type:'['});
    else if(c===')'||c===']'){const type=c===')'?'(':'[';if(stack.at(-1)?.type===type)stack.pop();}
    else if(c===','&&stack.at(-1)?.type==='(')stack.at(-1).arg++;
  }
  if(comment||stack.at(-1)?.type==='[')return null;
  const call=[...stack].reverse().find(item=>item.name);
  if(!call||!signature[(globalThis.AnalysisFormula.functionAliases[call.name.toLowerCase()]||({'막대':'histogram','histogram':'histogram','선':'plot','예상선':'forecast','plot':'plot','forecast':'forecast','매수신호':'buySignal','매도신호':'sellSignal','buysignal':'buySignal','sellsignal':'sellSignal','배경':'bgcolor','bgcolor':'bgcolor','화살표':'arrow','화살표신호':'arrow','arrow':'arrow'}[call.name.toLowerCase()]))])return null;
  const definition=signature[(globalThis.AnalysisFormula.functionAliases[call.name.toLowerCase()]||({'막대':'histogram','histogram':'histogram','선':'plot','예상선':'forecast','plot':'plot','forecast':'forecast','매수신호':'buySignal','매도신호':'sellSignal','buysignal':'buySignal','sellsignal':'sellSignal','배경':'bgcolor','bgcolor':'bgcolor','화살표':'arrow','화살표신호':'arrow','arrow':'arrow'}[call.name.toLowerCase()]))];
  return {...definition,name:call.name,argument:call.arg};
}
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function installSignatureHelp(textarea,popup,options={}){
  let dismissed=false,composing=false,completion=null;const controller=new AbortController(),originalDescription=textarea.getAttribute('aria-describedby');
  const listen=(element,event,handler,options={})=>element?.addEventListener(event,handler,{...options,signal:controller.signal});
  function hide(){popup.hidden=true;if(originalDescription)textarea.setAttribute('aria-describedby',originalDescription);else textarea.removeAttribute('aria-describedby');}
  function update(reset=false){
    if(reset)dismissed=false;
    const help=signatureAt(textarea.value,textarea.selectionStart);
    if(document.activeElement!==textarea||dismissed||composing||completion?.visible||!help){hide();return;}
    const description=help.help[help.argument]||(help.params.length?'인수 '+(help.argument+1)+' · 함수 인수 개수를 확인하세요.':help.help[0]||'');
    popup.innerHTML='<div class="signature-line"><b>'+esc(help.name)+'</b>( '+help.params.map((param,index)=>'<span class="'+(index===help.argument?'active':'')+'">'+esc(param)+'</span>').join(', ')+' )</div><p title="'+esc(description)+'">'+esc(description)+'</p>';

    popup.hidden=false;textarea.setAttribute('aria-describedby',popup.id);
    const mirror=document.createElement('div'),style=getComputedStyle(textarea);
    for(const key of ['font','lineHeight','letterSpacing','padding','border','boxSizing','wordBreak','overflowWrap','tabSize'])mirror.style[key]=style[key];
    Object.assign(mirror.style,{position:'fixed',visibility:'hidden',whiteSpace:'pre-wrap',width:textarea.clientWidth+'px',height:'auto'});
    mirror.textContent=textarea.value.slice(0,textarea.selectionStart);const marker=document.createElement('span');marker.textContent='\u200b';mirror.append(marker);document.body.append(mirror);
    const rect=textarea.getBoundingClientRect(),lineHeight=parseFloat(style.lineHeight),caretTop=rect.top+marker.offsetTop-textarea.scrollTop;
    const boundary=(textarea.closest('dialog')||textarea.parentElement).getBoundingClientRect(),viewport=editorViewport(),viewportWidth=viewport.width;
    const width=Math.min(430,rect.width-12,boundary.width-24,viewportWidth-24);popup.style.width=width+'px';
    const left=Math.max(viewport.left+12,boundary.left+12,Math.min(rect.left+marker.offsetLeft-textarea.scrollLeft,Math.min(viewport.right,boundary.right)-width-12));
    let top=caretTop+lineHeight+6;
    if(top+popup.offsetHeight>Math.min(boundary.bottom-12,viewport.bottom-12))top=caretTop-popup.offsetHeight-6;
    popup.style.left=left+'px';popup.style.top=Math.max(viewport.top+12,boundary.top+12,top)+'px';mirror.remove();
    if(caretTop<rect.top||caretTop>rect.bottom)hide();
  }
  const refresh=()=>queueMicrotask(()=>update(true));
  listen(textarea,'input',refresh);listen(textarea,'click',refresh);listen(textarea,'select',refresh);listen(textarea,'compositionstart',()=>{composing=true;hide();});listen(textarea,'compositionend',()=>{composing=false;refresh();});listen(document,'selectionchange',()=>{if(document.activeElement===textarea)refresh();});listen(textarea,'keyup',event=>{if(event.key!=='Escape')update();});listen(textarea,'focus',()=>update(true));listen(textarea,'blur',hide);listen(textarea,'scroll',()=>update());
  listen(textarea,'keydown',event=>{if(event.key==='Escape'&&!popup.hidden){event.preventDefault();event.stopPropagation();dismissed=true;hide();}if(event.ctrlKey&&event.shiftKey&&event.code==='Space'){event.preventDefault();completion?.hide();update(true);}});
  listen(textarea.closest('.editor-body'),'scroll',hide,{passive:true});listen(window,'resize',()=>update());listen(window.visualViewport,'resize',()=>update());listen(window.visualViewport,'scroll',()=>update());
  completion=installFormulaCompletion(textarea,{...options,onShow(){hide();}});
  return {update,hide(){hide();completion.hide();},dispose(){hide();completion.dispose();controller.abort();}};
}
