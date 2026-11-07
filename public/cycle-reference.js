// Theoretical frequency response belongs to the MA filter, not to market prices.
export const THEORY_CYCLE_AVERAGES=['SMA','EMA','HMA'];
const theoryCache=new Map();
const wmaWeights=n=>Array.from({length:n},(_,i)=>(n-i)/(n*(n+1)/2));
function weights(kind,n){
 if(kind==='SMA')return Array(n).fill(1/n);
 const full=wmaWeights(n),half=wmaWeights(Math.max(1,Math.floor(n/2))),root=wmaWeights(Math.max(1,Math.floor(Math.sqrt(n)))),combined=full.map((v,i)=>2*(half[i]||0)-v),result=Array(combined.length+root.length-1).fill(0);
 for(let i=0;i<combined.length;i++)for(let j=0;j<root.length;j++)result[i+j]+=combined[i]*root[j];return result;
}
export function theoreticalCyclePeriod(kind,fast,slow){
 if(!THEORY_CYCLE_AVERAGES.includes(kind)||![fast,slow].every(n=>Number.isInteger(n)&&n>=1&&n<=500)||fast>=slow)return null;
 const key=[kind,fast,slow].join(':');if(theoryCache.has(key))return theoryCache.get(key);
 let gain;
 if(kind==='EMA'){
  const response=(n,c,s)=>{const a=2/(n+1),q=1-a,re=1-q*c,im=q*s,den=re*re+im*im;return [a*re/den,-a*im/den];};
  gain=w=>{const c=Math.cos(w),s=Math.sin(w),a=response(fast,c,s),b=response(slow,c,s);return (a[0]-b[0])**2+(a[1]-b[1])**2;};
 }else{
  const a=weights(kind,fast),b=weights(kind,slow),difference=Array.from({length:Math.max(a.length,b.length)},(_,i)=>(a[i]||0)-(b[i]||0));
  gain=w=>{const c=Math.cos(w),s=-Math.sin(w);let re=0,im=0;for(let i=difference.length-1;i>=0;i--){const next=re*c-im*s+difference[i];im=re*s+im*c;re=next;}return re*re+im*im;};
 }
 const step=Math.PI/4096;let peak=0,maximum=0;
 for(let i=1;i<=4096;i++){const w=i*step,value=gain(w);if(value>maximum){maximum=value;peak=w;}}
 let result=null;
 if(maximum>1e-20){let lo=Math.max(step/100,peak-step),hi=Math.min(Math.PI,peak+step);for(let i=0;i<60;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(gain(a)>gain(b))hi=b;else lo=a;}const middle=(lo+hi)/2,omega=gain(Math.PI)>gain(middle)?Math.PI:middle;result=2*Math.PI/omega;}
 if(theoryCache.size>=128)theoryCache.delete(theoryCache.keys().next().value);theoryCache.set(key,result);return result;
}
export const cycleReferenceName=study=>study.params.reference==='theory'?'SMA 이론':'실측 후보';
const number=value=>Number.isFinite(value)?value.toLocaleString('ko-KR',{maximumFractionDigits:2}):null;
export const cycleBars=value=>number(value)===null?'미확인':number(value)+'봉';
export function cycleReferenceMessage(study,meta){
 if(Number.isFinite(meta?.period)){if(study.params.reference!=='theory'&&meta?.candidateConfirmed===false){const candidate=meta.candidates?.find(c=>c.period===meta.period);return '참고 후보 · 반복성 약함'+(candidate?' · 파형 설명력 '+Math.round(candidate.explainedFraction*100)+'%':'');}return '';}
 if(study.params.reference==='theory')return 'SMA 이론 기준 표시 대기 · 기준 봉 데이터와 기간을 확인하세요.';
 return (meta?.available??0)<study.params.lookback?'실측 주기 미확인 · 분석 가능한 '+(meta?.available??0)+' / '+study.params.lookback+'봉':'실측 주기 미확인 · 반복성 기준 미충족';
}
export const cyclePhaseName=meta=>meta?.direction===1?'골든크로스':meta?.direction===-1?'데드크로스':null;
export const cycleElapsedColor=(study,meta)=>meta?.direction===-1?study.styles.elapsed.negative:study.styles.elapsed.color;
export function cycleReadings(study,meta){
 const candidates=study.params.reference!=='theory'&&meta?.candidates?.length?' · 후보 '+meta.candidates.map(c=>cycleBars(c.period)+'(설명력 '+Math.round(c.explainedFraction*100)+'%)').join(' / ')+' · 설명력은 예측 확률이 아닙니다.':'';
 return cycleReferenceName(study)+(meta?.candidateConfirmed===false&&Number.isFinite(meta?.period)?' (참고)':'')+' 주기 '+cycleBars(meta?.period)+' · 1배 기준 '+cycleBars(meta?.basis)+(study.params.basis==='half'?' (선택 주기의 ½)':'')+' · 최근 돌파 간격 '+cycleBars(meta?.interval)+' · '+(cyclePhaseName(meta)?cyclePhaseName(meta)+' 이후 ':'')+'경과 '+cycleBars(meta?.elapsed)+(study.params.reference==='theory'?' · 실제 교차 '+study.params.average+' '+study.params.fast+'·'+study.params.slow+' / 이론 참조 SMA '+study.params.fast+'·'+study.params.slow:'')+candidates+(study.params.predictionSource==='previous'?' · 예상·이전경과 '+cycleBars(meta?.prediction):'')+(['current','remaining'].includes(study.params.predictionSource)?' · '+(meta?.forecastMethodLabel||'교차 예상')+(Number.isFinite(meta?.forecastAssumedClose)?' · 가정 종가 '+meta.forecastAssumedClose.toLocaleString('ko-KR',{maximumFractionDigits:8}):'')+' · 예상 교차 경과 '+cycleBars(meta?.forecastTarget)+' · 남은 '+cycleBars(meta?.forecastRemaining)+(study.params.predictionSource==='current'?' · 종료 직전 경과 '+cycleBars(meta?.forecastEnd):'')+(Number.isFinite(meta?.forecastContributors)?' · '+meta.forecastContributors+'/'+meta.forecastCandidates+'개 평균':'')+(meta?.forecastStatus?' · '+meta.forecastStatus:''):'');
}
export function cycleLegendValues(study,meta){
 const ratio=study.params.display==='ratio',base=ratio?meta?.basis:meta?.period,tag=cycleReferenceName(study)+(meta?.candidateConfirmed===false&&Number.isFinite(meta?.period)?'(참고)':'')+(ratio&&study.params.basis==='half'?' ½':'');
 const value=(key,label)=>{const raw=meta?.[key];if(!Number.isFinite(raw))return label+' 미확인';if(!ratio)return label+' '+cycleBars(raw);return Number.isFinite(meta?.basis)&&meta.basis>0?label+' '+number(raw/meta.basis)+'배':label+' '+cycleBars(raw)+' · 배수 대기';};
 return {period:tag+' '+(ratio?'1배 ':'')+cycleBars(base),interval:study.params.predictionSource&&study.params.predictionSource!=='interval'?value('prediction',study.params.predictionSource==='previous'?'예상·이전경과':(study.params.forecastMethod==='mean-bars'?'평균':['fastest','fastest-range'].includes(study.params.forecastMethod)?'최단':'예상')+(study.params.predictionSource==='remaining'?' 예상경과':' 종료'))+(study.params.predictionSource==='remaining'?' · '+value('forecastRemaining','남은'):''):value('interval','간격'),elapsed:value('elapsed',meta?.direction===1?'골든 경과':meta?.direction===-1?'데드 경과':'경과')};
}
