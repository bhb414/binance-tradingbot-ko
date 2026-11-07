import './analysis-formula.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prices=['시가','고가','저가','종가','거래량','하이킨시가','하이킨고가','하이킨저가','하이킨종가'];
const positions=['현재수익률','가격변동률','현재손익','포지션보유','평균매수가'];
const functions=[['조건','판단에 따라 값 선택'],['최고','최근 N봉 최고값'],['최저','최근 N봉 최저값'],['다음봉','가정한 다음 봉의 지표·조건 계산'],['SMA','이동평균'],['EMA','지수이동평균'],['VWMA','거래량 가중이동평균'],['KAMA','카우프만 적응 이동평균'],['HMA','헐 이동평균 · HullMA'],['주기추정','파형 한 바퀴의 반복 주기 추정'],['교차간격','최근 완료된 반대 교차 사이 봉 수'],['경과봉수','조건 발생 이후 경과 봉 수'],['NW','나다라야–왓슨 중심선'],['백분위수','과거 분포'],['표준편차','모집단 표준편차'],['RSI','상대강도지수'],['ATR','일반 봉 평균 진폭'],['볼린저상단','상단선'],['볼린저중심','중심선'],['볼린저하단','하단선'],['상향돌파','앞 값이 뒤 값을 상향 돌파'],['하향돌파','앞 값이 뒤 값을 하향 돌파'],['발생','최근 참인 봉 수 범위'],['발생횟수','최근 참인 봉 수'],['신규발생','거짓→참 발생 수 범위'],['신규발생횟수','거짓→참 발생 수'],['절대값','절대값'],['최대','두 값 중 큰 값'],['최소','두 값 중 작은 값'],['증감','N봉 전과의 차이'],['변화율','N봉 전 대비 변화율'],['범위내','하한·상한 사이']];
export function formulaSnippets({chart=false,symbols=[],script=false}={}){
 const api=globalThis.AnalysisFormula,item=(name,description,group,fn=false)=>({name,description,group,insert:name+(fn?'()':''),function:fn,aliases:Object.entries(fn?api.functionAliases:api.variableAliases).filter(([,canonical])=>canonical===(fn?api.functionAliases:api.variableAliases)[name.toLowerCase()]).map(([alias])=>alias)});
 const result=prices.map(name=>item(name,name.startsWith('하이킨')?'하이킨아시 가격':'일반 봉 데이터','봉 데이터'));
 result.push(...functions.map(([name,description])=>item(name,description,'함수',true)));if(script)result.push(item('막대','수식을 막대로 표시 · 0 또는 선식 기준으로 색상','스크립트',true),item('선','수식을 선으로 표시 · 선택한 봉 수만큼 이동','스크립트',true),item('예상선','최근 기울기를 미래 봉 위치에 연장','스크립트',true),item('매수신호','조건이 참인 봉에 매수 화살표 · 표시 전용','스크립트',true),item('매도신호','조건이 참인 봉에 매도 화살표 · 표시 전용','스크립트',true),item('배경','조건이 참인 봉의 배경을 세로로 칠하기','스크립트',true),item('화살표','글자·방향·위치·쌓기 순서를 정하는 신호','스크립트',true));
 if(!chart){
  result.push(...positions.slice(0,4).map(name=>item(name,'현재 보유 포지션','현재 포지션',true)),item('평균매수가','현재 평균 진입가','현재 포지션'));
  result.push(...[['요일','현재 요일'],['시각','현재 시각'],['시간범위','현재 시각이 범위 안인지']].map(([name,description])=>item(name,description,'요일·시간',true)));
  result.push(...['월요일','화요일','수요일','목요일','금요일','토요일','일요일','한국시간','미국동부','UTC'].map(name=>({name,description:'요일·시간대 상수',group:'요일·시간',insert:name,function:false,aliases:[]})));
  for(const symbol of symbols)for(const field of [...prices,...positions])result.push({name:symbol+'.'+field,description:symbol+' 종목 데이터',group:symbol+' 종목',insert:symbol+'.'+field,function:false,aliases:[]});
 }
 return result;
}
export function snippetOptions(options={}){
 const groups=new Map();for(const item of formulaSnippets(options)){if(!groups.has(item.group))groups.set(item.group,[]);groups.get(item.group).push(item);}
 return [...groups].map(([group,items])=>'<optgroup label="'+esc(group)+'">'+items.map(item=>'<option value="'+esc(item.insert)+'">'+esc(item.name+(item.function?'()':'')+' · '+item.description)+'</option>').join('')+'</optgroup>').join('');
}
export function completionQuery(text,start,end=start,{force=false}={}){
 if(start!==end)return null;const before=text.slice(0,start),match=before.match(/[A-Za-z_\u3131-\uD79D][A-Za-z0-9_.\u3131-\uD79D]*$/),query=match?.[0]||'',from=start-query.length;
 if(query&&from>0&&/[A-Za-z0-9_.@\u3131-\uD79D]/.test(text[from-1]))return null;
 if(!query&&!force)return null;
 return {query,start:from,end:start};
}
export function completionMatches(query,options={}){
 const value=query.toLowerCase(),rank=item=>item.name.toLowerCase().startsWith(value)?0:item.aliases.some(alias=>alias.startsWith(value))?1:2;
 return formulaSnippets(options).filter(item=>!value||[item.name,item.description,...item.aliases].some(word=>word.toLowerCase().includes(value))).sort((a,b)=>rank(a)-rank(b)).slice(0,10);
}
export function snippetEdit(text,start,end,insert,maxLength=1000){
 const fn=insert.endsWith('()'),name=fn?insert.slice(0,-2):insert,right=text.slice(end),typed=text.slice(start,end);
 // Complete only the prefix before the caret. Reuse matching suffix characters
 // without replacing them, including an existing function argument list.
 let overlap=0;
 if(start!==end&&name.toLowerCase().startsWith(typed.toLowerCase())){
  const missing=name.slice(typed.length);
  for(let n=1;n<=Math.min(missing.length,right.length);n++)if(missing.toLowerCase().endsWith(right.slice(0,n).toLowerCase()))overlap=n;
 }
 const value=name.slice(0,name.length-overlap),suffix=right.slice(overlap),opening=fn?suffix.match(/^\s*\(/):null;
 const head=text.slice(0,start)+value+right.slice(0,overlap),tail=fn&&!opening?'()'+suffix:suffix,next=head+tail;
 if(next.length>maxLength)return null;
 return {text:next,caret:head.length+(opening?opening[0].length:fn?1:0)};
}
export function textDifference(before,after){
 let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
 let tail=0;while(tail<before.length-start&&tail<after.length-start&&before[before.length-1-tail]===after[after.length-1-tail])tail++;
 return {start,end:before.length-tail,text:after.slice(start,after.length-tail)};
}
export function applyFormulaEdit(textarea,result){
 if(!result)return false;const before=textarea.value,top=textarea.scrollTop,left=textarea.scrollLeft;
 textarea.focus({preventScroll:true});
 if(result.text!==before){
  const edit=textDifference(before,result.text);textarea.setSelectionRange(edit.start,edit.end);
  let native=false;try{native=document.execCommand('insertText',false,edit.text);}catch{}
  if(!native||textarea.value!==result.text){
   const remaining=textDifference(textarea.value,result.text);textarea.setRangeText(remaining.text,remaining.start,remaining.end,'end');
   textarea.setSelectionRange(result.caret,result.caret);textarea.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText',data:edit.text}));
  }
 }
 textarea.setSelectionRange(result.caret,result.caret);textarea.scrollTop=top;textarea.scrollLeft=left;textarea.dispatchEvent(new Event('select',{bubbles:true}));return true;
}
export function insertFormulaSnippet(textarea,insert,range){
 return applyFormulaEdit(textarea,snippetEdit(textarea.value,range?.start??textarea.selectionStart,range?.end??textarea.selectionEnd,insert,textarea.maxLength>0?textarea.maxLength:1000));
}
export function bracketEdit(text,start,end,key,maxLength=1000){
 const pairs={'(':')','[':']'},selected=text.slice(start,end),right=text.slice(end);
 if(pairs[key]){
  const pair=selected||!right||/^[\s,\])><=+*/-]/.test(right),insert=key+selected+(pair?pairs[key]:'');
  const next=text.slice(0,start)+insert+right;return next.length<=maxLength?{text:next,caret:start+1+(selected?selected.length:0)}:null;
 }
 if(start!==end)return null;
 if((key===')'||key===']')&&right.startsWith(key))return {text,caret:start+1};
 if(key==='Backspace'&&start>0&&Object.hasOwn(pairs,text[start-1])&&pairs[text[start-1]]===text[start])return {text:text.slice(0,start-1)+text.slice(start+1),caret:start-1};
 return null;
}
export function completionStillCurrent(text,start,end,snapshot){return !!snapshot&&text===snapshot.text&&start===end&&start===snapshot.caret;}
export function editorViewport(){const view=window.visualViewport,left=view?.offsetLeft||0,top=view?.offsetTop||0;return {left,top,width:view?.width||innerWidth,height:view?.height||innerHeight,right:left+(view?.width||innerWidth),bottom:top+(view?.height||innerHeight)};}
export function installFormulaCompletion(textarea,{chart=false,symbols=[],onShow=()=>{}}={}){
 const controller=new AbortController(),menu=document.createElement('div'),host=textarea.closest('dialog')||textarea.parentElement;
 menu.className='formula-completion';menu.hidden=true;menu.id=textarea.id+'-completion';menu.setAttribute('role','listbox');menu.setAttribute('aria-label','수식 자동완성');host.append(menu);
 textarea.setAttribute('aria-autocomplete','list');textarea.setAttribute('aria-controls',menu.id);textarea.setAttribute('aria-expanded','false');
 let items=[],active=-1,range=null,snapshot=null,composing=false,accepting=false,dismissed=false,lastComposition=-Infinity;
 const listen=(target,event,handler,options={})=>target?.addEventListener(event,handler,{...options,signal:controller.signal});
 function hide(){menu.hidden=true;textarea.setAttribute('aria-expanded','false');textarea.removeAttribute('aria-activedescendant');}
 function highlight(){if(active<0)textarea.removeAttribute('aria-activedescendant');[...menu.querySelectorAll('[role=option]')].forEach((node,i)=>{node.setAttribute('aria-selected',String(i===active));if(i===active){textarea.setAttribute('aria-activedescendant',node.id);const top=node.offsetTop,bottom=top+node.offsetHeight;if(top<menu.scrollTop)menu.scrollTop=top;else if(bottom>menu.scrollTop+menu.clientHeight)menu.scrollTop=bottom-menu.clientHeight;}});}
 function position(){
  const style=getComputedStyle(textarea),mirror=document.createElement('div');
  for(const key of ['font','lineHeight','letterSpacing','padding','border','boxSizing','wordBreak','overflowWrap','tabSize'])mirror.style[key]=style[key];
  Object.assign(mirror.style,{position:'fixed',visibility:'hidden',whiteSpace:'pre-wrap',width:textarea.clientWidth+'px'});mirror.textContent=textarea.value.slice(0,textarea.selectionStart);const marker=document.createElement('span');marker.textContent='\u200b';mirror.append(marker);document.body.append(mirror);
  const rect=textarea.getBoundingClientRect(),boundary=host.getBoundingClientRect(),viewport=editorViewport(),width=Math.max(140,Math.min(400,rect.width-8,viewport.width-24,boundary.width-24)),caretTop=rect.top+marker.offsetTop-textarea.scrollTop;
  menu.style.width=width+'px';menu.style.left=Math.max(viewport.left+12,boundary.left+12,Math.min(rect.left+marker.offsetLeft-textarea.scrollLeft,Math.min(viewport.right,boundary.right)-width-12))+'px';
  const line=parseFloat(style.lineHeight)||20,below=Math.min(viewport.bottom,boundary.bottom)-12-caretTop-line-5,above=caretTop-Math.max(viewport.top,boundary.top)-17,under=below>=Math.min(140,above);menu.style.maxHeight=Math.max(40,Math.min(viewport.width<540?190:260,under?below:above))+'px';
  const top=under?caretTop+line+5:caretTop-menu.offsetHeight-5;menu.style.top=Math.max(viewport.top+12,boundary.top+12,top)+'px';mirror.remove();if(caretTop<rect.top||caretTop>rect.bottom)hide();
 }
 function update(force=false){
  if(composing||accepting||dismissed&&!force||document.activeElement!==textarea){hide();return;}
  range=completionQuery(textarea.value,textarea.selectionStart,textarea.selectionEnd,{force});items=range?completionMatches(range.query,{chart,symbols:typeof symbols==='function'?symbols():symbols}):[];
  if(!items.length){hide();return;}active=force?0:-1;snapshot={text:textarea.value,caret:textarea.selectionStart};menu.innerHTML=items.map((item,i)=>'<button type="button" role="option" tabindex="-1" id="'+menu.id+'-'+i+'" data-completion="'+i+'" aria-selected="false"><span>'+esc(item.name+(item.function?'()':''))+'</span><small>'+esc(item.description)+'</small></button>').join('')+'<div class="completion-hint">↑↓ 선택 · Tab 완성 · Esc 닫기</div>';
  menu.hidden=false;textarea.setAttribute('aria-expanded','true');onShow();position();highlight();
 }
 function choose(index){if(!items[index]||!range)return;if(!completionStillCurrent(textarea.value,textarea.selectionStart,textarea.selectionEnd,snapshot)){hide();return;}accepting=true;hide();insertFormulaSnippet(textarea,items[index].insert,range);accepting=false;dismissed=true;hide();}
 listen(textarea,'compositionstart',()=>{composing=true;hide();});listen(textarea,'compositionend',()=>{composing=false;lastComposition=performance.now();dismissed=false;update();});
 listen(textarea,'input',()=>{if(!accepting)dismissed=false;update();});listen(textarea,'blur',hide);listen(textarea,'click',()=>{dismissed=false;update();});listen(textarea,'scroll',hide);
 listen(textarea,'keydown',event=>{
  if(event.isComposing||composing||event.keyCode===229)return;
  if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&event.code==='Space'){event.preventDefault();dismissed=false;update(true);return;}
  if(!menu.hidden){
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();active=active<0?(event.key==='ArrowDown'?0:items.length-1):(active+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;highlight();return;}
  else if(event.key==='Tab'&&!event.shiftKey||event.key==='Enter'&&active>=0&&performance.now()-lastComposition>100){event.preventDefault();event.stopImmediatePropagation();choose(active<0?0:active);return;}
  else if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();dismissed=true;hide();return;}
  else if(['ArrowLeft','ArrowRight','Home','End','Enter'].includes(event.key))hide();
  }
  if(!event.ctrlKey&&!event.altKey&&!event.metaKey){const result=bracketEdit(textarea.value,textarea.selectionStart,textarea.selectionEnd,event.key,textarea.maxLength);if(result){event.preventDefault();event.stopImmediatePropagation();hide();applyFormulaEdit(textarea,result);}}
 },{capture:true});
 listen(textarea,'beforeinput',event=>{if(!event.cancelable||event.isComposing||composing)return;const key=event.inputType==='insertText'?event.data:event.inputType==='deleteContentBackward'?'Backspace':null;if(!key)return;const result=bracketEdit(textarea.value,textarea.selectionStart,textarea.selectionEnd,key,textarea.maxLength);if(result){event.preventDefault();hide();applyFormulaEdit(textarea,result);}});
 listen(document,'selectionchange',()=>{if(document.activeElement===textarea&&!menu.hidden&&!accepting&&!completionStillCurrent(textarea.value,textarea.selectionStart,textarea.selectionEnd,snapshot))hide();});
 listen(menu,'pointerdown',event=>event.preventDefault());listen(menu,'click',event=>{const button=event.target.closest('[data-completion]');if(button)choose(Number(button.dataset.completion));});
 listen(host,'close',hide);listen(host,'scroll',event=>{if(!menu.contains(event.target))hide();},{capture:true,passive:true});listen(window,'resize',()=>{if(!menu.hidden)position();});listen(window.visualViewport,'resize',()=>{if(!menu.hidden)position();});listen(window.visualViewport,'scroll',()=>{if(!menu.hidden)position();});
 return {get visible(){return !menu.hidden;},hide,update,dispose(){hide();controller.abort();menu.remove();textarea.removeAttribute('aria-controls');textarea.removeAttribute('aria-autocomplete');textarea.removeAttribute('aria-expanded');}};
}
