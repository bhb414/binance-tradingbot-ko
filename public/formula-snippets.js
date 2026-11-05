import './analysis-formula.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prices=['시가','고가','저가','종가','거래량','하이킨시가','하이킨고가','하이킨저가','하이킨종가'];
const positions=['현재수익률','가격변동률','현재손익','포지션보유','평균매수가'];
const functions=[['다음봉','가정한 다음 봉의 지표·조건 계산'],['SMA','이동평균'],['EMA','지수이동평균'],['VWMA','거래량 가중이동평균'],['NW','나다라야–왓슨 중심선'],['백분위수','과거 분포'],['표준편차','모집단 표준편차'],['RSI','상대강도지수'],['ATR','일반 봉 평균 진폭'],['볼린저상단','상단선'],['볼린저중심','중심선'],['볼린저하단','하단선'],['상향돌파','앞 값이 뒤 값을 상향 돌파'],['하향돌파','앞 값이 뒤 값을 하향 돌파'],['발생','최근 참인 봉 수 범위'],['발생횟수','최근 참인 봉 수'],['신규발생','거짓→참 발생 수 범위'],['신규발생횟수','거짓→참 발생 수'],['절대값','절대값'],['최대','두 값 중 큰 값'],['최소','두 값 중 작은 값'],['증감','N봉 전과의 차이'],['변화율','N봉 전 대비 변화율'],['범위내','하한·상한 사이']];
export function formulaSnippets({chart=false,symbols=[]}={}){
 const api=globalThis.AnalysisFormula,item=(name,description,group,fn=false)=>({name,description,group,insert:name+(fn?'()':''),function:fn,aliases:Object.entries(fn?api.functionAliases:api.variableAliases).filter(([,canonical])=>canonical===(fn?api.functionAliases:api.variableAliases)[name.toLowerCase()]).map(([alias])=>alias)});
 const result=prices.map(name=>item(name,name.startsWith('하이킨')?'하이킨아시 가격':'일반 봉 데이터','봉 데이터'));
 result.push(...functions.map(([name,description])=>item(name,description,'함수',true)));
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
 return {query,start:from,end:start+(text.slice(start).match(/^[A-Za-z0-9_.\u3131-\uD79D]*/)?.[0].length||0)};
}
export function completionMatches(query,options={}){
 const value=query.toLowerCase(),rank=item=>item.name.toLowerCase().startsWith(value)?0:item.aliases.some(alias=>alias.startsWith(value))?1:2;
 return formulaSnippets(options).filter(item=>!value||[item.name,item.description,...item.aliases].some(word=>word.toLowerCase().includes(value))).sort((a,b)=>rank(a)-rank(b)).slice(0,10);
}
export function snippetEdit(text,start,end,insert,maxLength=1000){
 const fn=insert.endsWith('()'),name=fn?insert.slice(0,-2):insert,right=text.slice(end),opening=fn?right.match(/^\s*\(/):null,value=opening?name:insert;
 const next=text.slice(0,start)+value+right;if(next.length>maxLength)return null;
 return {text:next,caret:start+value.length+(opening?opening[0].length:fn?-1:0)};
}
export function insertFormulaSnippet(textarea,insert,range){
 const result=snippetEdit(textarea.value,range?.start??textarea.selectionStart,range?.end??textarea.selectionEnd,insert,textarea.maxLength>0?textarea.maxLength:1000);
 if(!result)return false;textarea.value=result.text;textarea.focus();textarea.setSelectionRange(result.caret,result.caret);textarea.dispatchEvent(new Event('input',{bubbles:true}));return true;
}
export function installFormulaCompletion(textarea,{chart=false,symbols=[],onShow=()=>{}}={}){
 const controller=new AbortController(),menu=document.createElement('div'),host=textarea.closest('dialog')||textarea.parentElement;
 menu.className='formula-completion';menu.hidden=true;menu.id=textarea.id+'-completion';menu.setAttribute('role','listbox');menu.setAttribute('aria-label','수식 자동완성');host.append(menu);
 textarea.setAttribute('aria-autocomplete','list');textarea.setAttribute('aria-controls',menu.id);textarea.setAttribute('aria-expanded','false');
 let items=[],active=0,range=null,composing=false,accepting=false,dismissed=false;
 const listen=(target,event,handler,options={})=>target?.addEventListener(event,handler,{...options,signal:controller.signal});
 function hide(){menu.hidden=true;textarea.setAttribute('aria-expanded','false');textarea.removeAttribute('aria-activedescendant');}
 function highlight(){[...menu.querySelectorAll('[role=option]')].forEach((node,i)=>{node.setAttribute('aria-selected',String(i===active));if(i===active){textarea.setAttribute('aria-activedescendant',node.id);const top=node.offsetTop,bottom=top+node.offsetHeight;if(top<menu.scrollTop)menu.scrollTop=top;else if(bottom>menu.scrollTop+menu.clientHeight)menu.scrollTop=bottom-menu.clientHeight;}});}
 function position(){
  const style=getComputedStyle(textarea),mirror=document.createElement('div');
  for(const key of ['font','lineHeight','letterSpacing','padding','border','boxSizing','wordBreak','overflowWrap','tabSize'])mirror.style[key]=style[key];
  Object.assign(mirror.style,{position:'fixed',visibility:'hidden',whiteSpace:'pre-wrap',width:textarea.clientWidth+'px'});mirror.textContent=textarea.value.slice(0,textarea.selectionStart);const marker=document.createElement('span');marker.textContent='\u200b';mirror.append(marker);document.body.append(mirror);
  const rect=textarea.getBoundingClientRect(),boundary=host.getBoundingClientRect(),width=Math.max(140,Math.min(400,rect.width-8,innerWidth-24,boundary.width-24)),caretTop=rect.top+marker.offsetTop-textarea.scrollTop;
  menu.style.width=width+'px';menu.style.left=Math.max(12,boundary.left+12,Math.min(rect.left+marker.offsetLeft-textarea.scrollLeft,Math.min(innerWidth,boundary.right)-width-12))+'px';
  let top=caretTop+(parseFloat(style.lineHeight)||20)+5;if(top+menu.offsetHeight>Math.min(innerHeight,boundary.bottom)-12)top=caretTop-menu.offsetHeight-5;
  menu.style.top=Math.max(12,boundary.top+12,top)+'px';mirror.remove();if(caretTop<rect.top||caretTop>rect.bottom)hide();
 }
 function update(force=false){
  if(composing||accepting||dismissed&&!force||document.activeElement!==textarea){hide();return;}
  range=completionQuery(textarea.value,textarea.selectionStart,textarea.selectionEnd,{force});items=range?completionMatches(range.query,{chart,symbols:typeof symbols==='function'?symbols():symbols}):[];
  if(!items.length){hide();return;}active=0;menu.innerHTML=items.map((item,i)=>'<button type="button" role="option" tabindex="-1" id="'+menu.id+'-'+i+'" data-completion="'+i+'" aria-selected="false"><span>'+esc(item.name+(item.function?'()':''))+'</span><small>'+esc(item.description)+'</small></button>').join('')+'<div class="completion-hint">↑↓ 선택 · Enter / Tab 입력 · Esc 닫기</div>';
  menu.hidden=false;textarea.setAttribute('aria-expanded','true');onShow();position();highlight();
 }
 function choose(index){if(!items[index]||!range)return;accepting=true;hide();insertFormulaSnippet(textarea,items[index].insert,range);accepting=false;hide();}
 listen(textarea,'compositionstart',()=>{composing=true;hide();});listen(textarea,'compositionend',()=>{composing=false;dismissed=false;update();});
 listen(textarea,'input',()=>{if(!accepting)dismissed=false;update();});listen(textarea,'blur',hide);listen(textarea,'click',()=>{dismissed=false;update();});listen(textarea,'scroll',hide);
 listen(textarea,'keydown',event=>{
  if(event.isComposing||composing||event.keyCode===229)return;
  if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&event.code==='Space'){event.preventDefault();dismissed=false;update(true);return;}
  if(menu.hidden)return;
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();active=(active+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;highlight();}
  else if(event.key==='Enter'||event.key==='Tab'&&!event.shiftKey){event.preventDefault();event.stopImmediatePropagation();choose(active);}
  else if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();dismissed=true;hide();}
  else if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))hide();
 },{capture:true});
 listen(menu,'pointerdown',event=>event.preventDefault());listen(menu,'click',event=>{const button=event.target.closest('[data-completion]');if(button)choose(Number(button.dataset.completion));});
 listen(host,'close',hide);listen(host,'scroll',event=>{if(!menu.contains(event.target))hide();},{capture:true,passive:true});listen(window,'resize',()=>{if(!menu.hidden)position();});
 return {hide,update,dispose(){hide();controller.abort();menu.remove();textarea.removeAttribute('aria-controls');textarea.removeAttribute('aria-autocomplete');textarea.removeAttribute('aria-expanded');}};
}
