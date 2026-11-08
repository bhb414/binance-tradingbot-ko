const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize=name=>String(name).toLowerCase();
const variables={close:'종가',open:'시가',high:'고가',low:'저가',volume:'거래량',heikinclose:'하이킨 종가',heikinopen:'하이킨 시가',heikinhigh:'하이킨 고가',heikinlow:'하이킨 저가',averageprice:'평균 진입가',profit:'포지션 수익률'};
function operand(node){
  if(node.type==='number')return String(node.value);
  if(node.type==='variable')return variables[normalize(node.name)]||node.name;
  if(node.type==='lag')return operand(node.value)+' ['+node.lag+'봉 전]';
  if(node.type==='range')return operand(node.value)+'의 '+node.start+'~'+(node.end-1)+'봉 전 합계';
  if(node.type==='unary')return node.operator+'('+operand(node.value)+')';
  if(node.type==='binary')return '('+operand(node.left)+' '+node.operator+' '+operand(node.right)+')';
  if(node.type==='call'){
    const args=node.args.map(operand),name=normalize(node.name);
    if(['sma','평균','이평','ema','지수이평','rsi'].includes(name))return args[0]+'의 '+args[1]+'봉 '+(name==='ema'||name==='지수이평'?'지수이동평균':name==='rsi'?'RSI':'단순이동평균');
    const bands={bbupper:'상단',볼린저상단:'상단',bbmiddle:'중심',볼린저중심:'중심',bblower:'하단',볼린저하단:'하단'};
    if(bands[name])return args[0]+'의 볼린저 '+bands[name]+' ('+args[1]+'봉'+(args[2]?', '+args[2]+'배':'')+')';
    return node.name+'('+args.join(', ')+')';
  }
  return '';
}
export function crossExplanationMarkup(ast){
  const calls=[];
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='call'&&['상향돌파','하향돌파','crossup','crossdown'].includes(normalize(node.name)))calls.push(node);
    if(node.type==='call')node.args.forEach(visit);
    else if(node.type==='binary'){visit(node.left);visit(node.right);}
    else if(node.type==='unary'||node.type==='lag')visit(node.value);
  }
  visit(ast);if(!calls.length)return '';
  return '<div class="cross-explanation-heading">돌파 함수, 이렇게 읽으세요</div>'+calls.map(node=>{
    const up=['상향돌파','crossup'].includes(normalize(node.name)),a=esc(operand(node.args[0])),b=esc(operand(node.args[1]));
    return '<div class="cross-explanation-item"><div class="cross-function-name">'+(up?'상향돌파':'하향돌파')+'(<span>A</span>, <span>B</span>)</div><dl class="cross-operands"><div><dt>A · 돌파하는 값</dt><dd>'+a+'</dd></div><div><dt>B · 기준이 되는 값</dt><dd>'+b+'</dd></div></dl><p><strong>“'+a+'” 값이 “'+b+'” 기준을 '+(up?'아래에서 위로':'위에서 아래로')+' 돌파하는 순간</strong></p><small>마지막 확인 A '+(up?'&lt;':'&gt;')+' B → 현재 봉 A '+(up?'&gt;':'&lt;')+' B · 같은 값·계산 오차는 이전 쪽 유지 · 같은 쪽 재접촉 제외</small></div>';
  }).join('')+'<p class="cross-explanation-note">수식 안의 각 돌파 함수에 대한 설명입니다. AND·OR·NOT과 [N봉 전]은 입력한 수식대로 적용됩니다.</p>';
}
