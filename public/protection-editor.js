import {protectionEnabled,hasProtection,protectionBasis,PROTECTION_BASES,protectionPricePercent,protectionSummary} from './protection.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('ko-KR',{maximumFractionDigits:6}):'—';
const description=exit=>protectionBasis(exit)==='leveraged'?'진입 증거금(평균 진입가 × 보유 수량 ÷ 진입 시 적용한 배수)에 비해 이익·손실이 몇 %일 때 정리할지 정합니다. 예: 증거금 5 USDT로 100 USDT 규모를 거래하는 것이 20배입니다. 종목 가격이 1% 움직이면 이 증거금의 손익은 약 20% 움직입니다. 수수료·펀딩·나중에 추가한 증거금은 계산에서 제외합니다.':'종목 가격이 평균 진입가에서 몇 % 움직이면 정리할지 정합니다. 예: 롱의 익절 +5%는 100 → 105, 손절 -5%는 100 → 95입니다. 증거금에 비해 몇 % 벌고 잃는지를 뜻하지 않습니다. 숏은 가격 방향이 반대입니다.';
function example(exit){
 const leveraged=protectionBasis(exit)==='leveraged',parts=[];
 for(const [kind,label]of [['takeProfit','익절'],['stopLoss','손절']])if(protectionEnabled(exit,kind)){
  const percent=protectionPricePercent(exit,kind,20),sign=kind==='stopLoss'?-1:1;
  parts.push(label+' '+(sign<0?'-':'+')+fmt(exit[kind])+'% → '+(leveraged?'손익 약 '+(sign<0?'-':'+')+fmt(5*Number(exit[kind])/100)+' USDT · ':'')+'종목 가격 '+fmt(100*(1+sign*percent/100))+' USDT'+(leveraged?' (가격 '+(sign<0?'-':'+')+fmt(percent)+'%)':''));
 }
 return parts.length?'예: 평균 진입가 100 USDT'+(leveraged?' · 진입 증거금 5 USDT로 100 USDT 규모 거래(20배)':'')+' 롱에서 '+parts.join(' / ')+'. 실제 보호 주문 가격은 종목의 가격 단위에 맞춥니다.':'TP·SL을 사용하지 않습니다. 자동 정리가 필요하면 조건·행동 탭에 정리 조건을 설정하세요.';
}
export function protectionEditorMarkup(exit,{bind='data-bind'}={}){
 if(!['data-bind','data-pf-bind'].includes(bind))throw Error('보호 주문 입력 형식을 확인하세요.');
 const basis=protectionBasis(exit),active=hasProtection(exit);
 const control=(kind,label)=>{const enabled=protectionEnabled(exit,kind),stop=kind==='stopLoss';return '<div class="protection-control '+(!enabled?'is-disabled':'')+'" data-protection-control="'+kind+'"><div class="protection-control-heading"><strong>'+label+'</strong><div class="protection-enable-options" role="group" aria-label="'+label+' 사용 여부">'+[[true,'켜짐','켜기'],[false,'꺼짐','끄기']].map(([value,text,action])=>'<button type="button" data-protection-toggle="'+kind+'" data-protection-value="'+value+'" aria-label="'+label+' '+action+'" aria-pressed="'+(enabled===value)+'">'+text+'</button>').join('')+'</div></div><label class="field"><span data-protection-field-label="'+kind+'">'+(stop?'손절':'익절')+' 목표 · '+(basis==='leveraged'?'진입 증거금 대비 손익률':'종목 가격 변동률')+'</span><span class="input-unit protection-amount"><span class="protection-sign '+(stop?'negative':'positive')+'" aria-hidden="true">'+(stop?'-':'+')+'</span><input '+bind+'="exit.'+kind+'" data-protection-amount="'+kind+'" type="number" inputmode="decimal" min="0.01" max="1000" step="any" aria-label="'+label+' 목표 %" value="'+esc(exit?.[kind])+'" '+(!enabled?'disabled':'')+'><span>%</span></span></label></div>';};
 return '<div class="protection-basis-heading"><strong>TP·SL 계산 기준</strong></div><div class="protection-basis-options" role="group" aria-label="TP·SL 계산 기준">'+PROTECTION_BASES.map(([key,label])=>'<button type="button" data-protection-basis="'+key+'" aria-pressed="'+(key===basis)+'"><strong>'+label+'</strong><small>'+(key==='price'?'평균 진입가에서 가격이 움직인 %':'진입에 쓴 증거금 대비 손익 % · 배수 반영')+'</small></button>').join('')+'</div><p class="protection-intro" data-protection-description>'+esc(description(exit))+'</p><div class="protection-grid">'+control('takeProfit','익절 TP')+control('stopLoss','손절 SL')+'</div><p class="protection-current-summary" data-protection-summary>'+esc(protectionSummary(exit))+'</p><p class="protection-example" data-protection-example>'+esc(example(exit))+'</p><div class="form-grid"><label class="field"><span>보호 주문 가격 기준</span><select '+bind+'="exit.price" data-protection-price aria-label="보호 주문 가격 기준" '+(!active?'disabled':'')+'>'+[['MARK_PRICE','마크 가격 · 거래소 평가 가격'],['CONTRACT_PRICE','최종 체결가 · 마지막 거래 가격']].map(([value,label])=>'<option value="'+value+'" '+(exit?.price===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label></div><p class="protection-example">마크 가격은 거래소가 계산하는 평가 가격이고, 최종 체결가는 마지막 실제 거래 가격입니다. 선택한 가격이 목표에 도달하면 시장가로 정리하며 체결 가격은 달라질 수 있습니다. 추가 진입하면 평균 진입가를 기준으로 다시 계산합니다.</p>';
}
export function applyProtectionChoice(exit,data){
 if(data.protectionBasis!==undefined){if(!['price','leveraged'].includes(data.protectionBasis))return false;exit.basis=data.protectionBasis;return true;}
 const kind=data.protectionToggle;if(!['takeProfit','stopLoss'].includes(kind))return false;
 exit[kind+'Enabled']=data.protectionValue==='true';
 if(exit[kind+'Enabled']&&!(Number.isFinite(exit[kind])&&exit[kind]>0))exit[kind]=kind==='takeProfit'?3:1.5;
 if(exit[kind+'Enabled']&&!['MARK_PRICE','CONTRACT_PRICE'].includes(exit.price))exit.price='MARK_PRICE';
 return true;
}
export function syncProtectionEditor(root,exit){
 for(const kind of ['takeProfit','stopLoss']){
  const enabled=protectionEnabled(exit,kind),input=root.querySelector('[data-protection-amount="'+kind+'"]');if(input)input.disabled=!enabled;
  root.querySelector('[data-protection-control="'+kind+'"]')?.classList.toggle('is-disabled',!enabled);
 }
 const select=root.querySelector('[data-protection-price]');if(select)select.disabled=!hasProtection(exit);
 const summary=root.querySelector('[data-protection-summary]');if(summary)summary.textContent=protectionSummary(exit);
 const note=root.querySelector('[data-protection-example]');if(note)note.textContent=example(exit);
}
