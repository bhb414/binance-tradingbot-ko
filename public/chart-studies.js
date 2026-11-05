import {directionalMovement,commodityChannel,moneyFlow,bollingerArrays,nadarayaWatson,nadarayaEnvelope,kernelSlope} from './study-calculations.js';
import {POSITION_FIELDS} from './formula-position.js';
import {randomId} from './id.js';
import {heikinAshi,formulaSeries} from './indicators.js';
import {compileFormula} from './formula.js';

export const STUDY_KEY='fw-chart-studies-v1';
export const MAX_STUDIES=12;
export {CHART_TIMEFRAMES as TIMEFRAMES} from './chart-timeframes.js';
import {CHART_TIMEFRAMES as TIMEFRAMES} from './chart-timeframes.js';
export const SOURCES=[['close','종가'],['open','시가'],['high','고가'],['low','저가'],['hl2','고가·저가 평균'],['hlc3','고가·저가·종가 평균'],['ohlc4','시가·고가·저가·종가 평균']];
const length=(key,label,value,min=1)=>({key,label,value,min,max:300,step:1});
const choice=(key,label,value,options)=>({key,label,value,options});
const plot=(key,label,color,extra={})=>({key,label,color,...extra});
const nwFields=()=>[choice('kernel','커널 종류','gaussian',[['gaussian','Gaussian · 가우시안'],['rationalQuadratic','Rational Quadratic · 유리 이차']]),length('lookback','계산 봉 수 (현재 포함)',100,2),{key:'bandwidth',label:'곡선 부드러움 (Bandwidth)',value:8,min:.1,max:300,step:.1},{key:'alpha',label:'RQ 상대 가중치 (Gaussian에서는 미사용)',value:1,min:.1,max:100,step:.1},length('slopeBars','기울기 비교 봉 수',3),{key:'neutral',label:'기울기 중립 범위 (± %/봉)',value:.01,min:0,max:100,step:.001}];
const nwNote='현재와 과거 봉만 사용하는 비재도색 계산입니다. 진행 중인 봉의 값은 변합니다. Bandwidth를 키우면 곡선이 부드러워지고 반응이 느려집니다. 계산 봉 수는 현재 봉을 포함한 창의 길이로 Bandwidth와 다릅니다. 일반 종가: 가격 소스 종가 + 일반 캔들. 하이킨종가: 가격 소스 종가 + 하이킨아시. RQ 가중치는 RQ 커널에만 적용합니다.';
export const STUDIES={
  NW:{name:'나다라야–왓슨 인벨로프 · NW',english:'Nadaraya-Watson Envelope · Kernel Regression · 비재도색',group:'trend',pane:false,source:true,gaps:true,bandFill:'#6493b5',fields:[...nwFields(),length('errorPeriod','밴드 평균 오차 기간',20),{key:'multiplier',label:'밴드 폭 배수',value:3,min:0,max:10,step:.1}],plots:[plot('middle','중심선','#28a782',{directional:true,negative:'#d36579'}),plot('upper','상단선','#6493b5'),plot('lower','하단선','#6493b5')],note:nwNote+' 중심선은 커널 가중평균입니다. 상·하단은 중심선 ± 각 봉에서 관측한 절대오차의 이동평균 × 배수입니다. 밴드 폭이 변하면 상·하단 기울기도 달라집니다. 중심선 색상은 설정한 비교 봉 수와 중립 범위를 사용합니다. 중심선은 설정한 계산 봉 수, 밴드는 추가로 평균 오차 기간 − 1봉이 필요합니다.'},
  NW_SLOPE:{name:'나다라야–왓슨 기울기 · NW',english:'Nadaraya-Watson Slope · 봉당 변화율 · 비재도색',shortLabel:'NW Δ',group:'momentum',pane:true,source:true,gaps:true,precision:4,percent:true,unit:'%/봉',fields:nwFields(),plots:[plot('main','기울기 %/봉','#28a782',{directional:true,negative:'#d36579'})],note:nwNote+' 기울기 = (현재 중심선 − N봉 전 중심선) ÷ |N봉 전 중심선| × 100 ÷ N입니다. 단위는 봉당 변화율(%)이며 화면상의 각도가 아닙니다. 중립 범위 안은 회색입니다. 인벨로프와 같은 곡선을 보려면 커널·계산 봉 수·Bandwidth·RQ 가중치·가격 소스·캔들 기준을 맞추세요. 준비 봉 부족·0 나눗셈은 빈 값입니다.'},
  FORMULA:{name:'수식 지표',english:'Custom Formula · 나만의 보조지표',group:'custom',pane:false,fields:[{key:'name',label:'지표 이름',value:'나의 수식',type:'text',maxLength:32},choice('placement','표시 위치','overlay',[['overlay','가격 차트 위'],['pane','별도 패널']]),{key:'formula',label:'지표 수식',value:'종가[0:3]/3',type:'formula',maxLength:1000}],plots:[plot('main','수식선','#6493b5')],note:'[0]은 현재 봉, [1]은 직전 봉입니다. [0:3]은 0·1·2봉 값의 합계이며 끝 번호 3은 제외합니다. 종가는 일반 캔들, 하이킨종가는 합성 캔들입니다. 차트 유형을 바꿔도 이 기준은 유지합니다. NW(하이킨종가, 100, 8)은 가우시안 중심선입니다. ATR(14)은 일반 봉으로 계산하며, NW + ATR × 배수는 기본 NW의 평균 절대오차 밴드와 다릅니다.'},
  SMA:{name:'이동평균선',english:'Simple Moving Average',group:'trend',pane:false,source:true,fields:[length('period','기간',20)],plots:[plot('main','이동평균선','#528f85')]},
  EMA:{name:'지수이동평균선',english:'Exponential Moving Average',group:'trend',pane:false,source:true,fields:[length('period','기간',20)],plots:[plot('main','지수이동평균선','#5688c4')]},
  BB:{name:'볼린저밴드',english:'Bollinger Bands',group:'trend',pane:false,source:true,fields:[length('period','기간',20,2),{key:'multiplier',label:'표준편차 배수',value:2,min:0.1,max:10,step:0.1},choice('basis','중심선 종류','SMA',[['SMA','단순 이동평균'],['EMA','지수 이동평균']])],plots:[plot('upper','상단선','#aa91c5'),plot('middle','중심선','#bcadd0',{lineStyle:2}),plot('lower','하단선','#aa91c5')]},
  RSI:{name:'상대강도지수',english:'Relative Strength Index',group:'momentum',pane:true,source:true,fields:[length('period','기간',14,2),{key:'upper',label:'상단 기준',value:70,min:1,max:100,step:1},{key:'lower',label:'하단 기준',value:30,min:0,max:99,step:1}],plots:[plot('main','RSI','#9c81bd')]},
  MACD:{name:'MACD',english:'Moving Average Convergence Divergence',group:'momentum',pane:true,source:true,fields:[length('fast','빠른 기간',12),length('slow','느린 기간',26,2),length('signal','시그널 기간',9),choice('average','이동평균 종류','EMA',[['EMA','지수 이동평균'],['SMA','단순 이동평균']])],plots:[plot('main','MACD선','#5688c4'),plot('signal','시그널선','#d39b62'),plot('histogram','히스토그램','#70b69b',{histogram:true,negative:'#d98e9a'})]},
  STOCH:{name:'스토캐스틱',english:'Stochastic Oscillator',group:'momentum',pane:true,fields:[length('period','%K 기간',14),length('smooth','%K 평활',3),length('signal','%D 기간',3),{key:'upper',label:'상단 기준',value:80,min:1,max:100,step:1},{key:'lower',label:'하단 기준',value:20,min:0,max:99,step:1}],plots:[plot('main','%K','#5688c4'),plot('signal','%D','#d39b62')]},
  ATR:{name:'평균 진폭',english:'Average True Range',group:'volatility',pane:true,fields:[length('period','기간',14),choice('average','평활 방식','RMA',[['RMA','와일더 평활 (RMA)'],['SMA','단순 이동평균'],['EMA','지수 이동평균']])],plots:[plot('main','ATR','#cd8c79')]},
  VWAP:{name:'거래량 가중 평균가격',english:'Volume Weighted Average Price',group:'volume',pane:false,source:true,defaultSource:'hlc3',fields:[choice('anchor','초기화 기준 (UTC)','day',[['day','매일 00:00'],['week','매주 월요일 00:00'],['month','매월 1일 00:00']])],plots:[plot('main','VWAP','#c59a5a')],note:'UTC 기준으로 누적 거래대금 ÷ 누적 거래량을 계산합니다. 첫 구간은 조회된 봉부터 계산합니다.'},
  DMI:{name:'방향성 지수 · DMI',english:'Directional Movement Index · +DI / -DI / ADX',group:'trend',pane:true,precision:2,gaps:true,fields:[length('period','DI 기간',14),length('smoothing','ADX 평활 기간',14),{key:'weak',label:'낮은 강도 기준선',value:20,min:0,max:99,step:1},{key:'strong',label:'높은 강도 기준선',value:25,min:1,max:100,step:1}],plots:[plot('plus','+DI','#28a782'),plot('minus','-DI','#d36579'),plot('adx','ADX','#688fc1')],note:'+DI·-DI는 상승·하락 방향, ADX는 방향을 구분하지 않는 추세 강도입니다. DI와 ADX는 와일더 평활(RMA)을 사용합니다.'},
  ADX:{name:'추세 강도 · ADX',english:'Average Directional Index',group:'trend',pane:true,precision:2,gaps:true,fields:[length('period','DI 기간',14),length('smoothing','ADX 평활 기간',14),{key:'weak',label:'낮은 강도 기준선',value:20,min:0,max:99,step:1},{key:'strong',label:'높은 강도 기준선',value:25,min:1,max:100,step:1}],plots:[plot('main','ADX','#688fc1')],note:'DMI의 ADX선만 별도 표시합니다. DI 기간과 ADX 평활 기간을 같게 설정하면 DMI의 ADX값과 일치합니다.'},
  CCI:{name:'상품 채널 지수 · CCI',english:'Commodity Channel Index',group:'momentum',pane:true,source:true,defaultSource:'hlc3',precision:2,gaps:true,fields:[length('period','기간',20,2),{key:'upper',label:'상단 기준',value:100,min:1,max:500,step:1},{key:'lower',label:'하단 기준',value:-100,min:-500,max:0,step:1}],plots:[plot('main','CCI','#a486bf')],note:'선택 가격과 이동평균의 차이를 평균 절대편차 × 0.015로 나눈 값입니다. 상·하단 기준을 넘을 수 있습니다.'},
  MFI:{name:'자금 흐름 지수 · MFI',english:'Money Flow Index · 가격과 거래량',group:'volume',pane:true,source:true,defaultSource:'hlc3',precision:2,gaps:true,fields:[length('period','기간',14,2),{key:'upper',label:'상단 기준',value:80,min:1,max:100,step:1},{key:'lower',label:'하단 기준',value:20,min:0,max:99,step:1}],plots:[plot('main','MFI','#b69758')],note:'가격과 거래량으로 양·음의 자금 흐름을 계산합니다. 비교할 이전 봉이 없거나 구간 내 양·음 흐름이 모두 0이면 값을 표시하지 않습니다.'},
  BBW:{name:'볼린저 밴드폭 · BBW',english:'Bollinger BandWidth · 밴드 확장·수축',group:'volatility',pane:true,source:true,precision:2,gaps:true,fields:[length('period','기간',20,2),{key:'multiplier',label:'표준편차 배수',value:2,min:0.1,max:10,step:0.1},choice('basis','중심선 종류','SMA',[['SMA','단순 이동평균'],['EMA','지수 이동평균']])],plots:[plot('main','밴드폭 %','#c19560')],note:'(상단 − 하단) ÷ 중심선 × 100입니다. 비교할 볼린저밴드와 기간·배수·가격 소스·캔들 기준을 맞춰 사용하세요.'},
  BBP:{name:'볼린저 %B · 밴드 내 위치',english:'Bollinger Bands %B · Percent B',group:'momentum',pane:true,source:true,precision:3,gaps:true,fields:[length('period','기간',20,2),{key:'multiplier',label:'표준편차 배수',value:2,min:0.1,max:10,step:0.1},choice('basis','중심선 종류','SMA',[['SMA','단순 이동평균'],['EMA','지수 이동평균']])],plots:[plot('main','%B','#598fa6')],note:'(선택 가격 − 하단) ÷ (상단 − 하단)입니다. 0은 하단, 0.5는 중심선, 1은 상단이며 밴드 밖에서는 0 미만·1 초과가 됩니다. 비교할 밴드 설정을 맞춰 주세요.'},
  VOLUME:{name:'거래량',english:'Volume',group:'volume',pane:true,fields:[],plots:[plot('main','거래량','#a0d0bd',{histogram:true,negative:'#e3b3bc'})]}
};

export function createStudy(type,overrides={}){
  const definition=STUDIES[type];if(!definition)throw new Error('지원하지 않는 지표입니다.');
  return validateStudy({id:'study-'+randomId(),type,visible:true,source:definition.defaultSource||'close',candle:'chart',timeframes:TIMEFRAMES.map(([key])=>key),params:Object.fromEntries(definition.fields.map(field=>[field.key,field.value])),styles:Object.fromEntries(definition.plots.map(item=>[item.key,{color:item.color,negative:item.negative||'#d98e9a',...(item.directional?{neutral:'#9aa4ad'}:{}),width:1,lineStyle:item.lineStyle||0,visible:true}])),...overrides});
}
export function validateStudy(value){
  const definition=STUDIES[value?.type];if(!definition||typeof value.id!=='string'||!/^[\w-]{1,80}$/.test(value.id))throw new Error('지표 설정 형식을 확인해 주세요.');
  if(!SOURCES.some(([key])=>key===value.source)||!['chart','standard','heikin'].includes(value.candle)||typeof value.visible!=='boolean')throw new Error('지표의 계산 기준을 확인해 주세요.');
  if(!Array.isArray(value.timeframes)||!value.timeframes.length||value.timeframes.some(tf=>!TIMEFRAMES.some(([key])=>key===tf)))throw new Error('표시할 봉 주기를 하나 이상 선택해 주세요.');
  const params={};for(const field of definition.fields){const input=value.params?.[field.key];if(field.type==='text'||field.type==='formula'){if(typeof input!=='string'||!input.trim()||input.length>field.maxLength)throw new Error(field.label+'을 1~'+field.maxLength+'자로 입력해 주세요.');params[field.key]=input.trim();continue;}if(field.options?!field.options.some(([key])=>key===input):typeof input!=='number'||!Number.isFinite(input)||input<field.min||input>field.max||field.step===1&&!Number.isInteger(input))throw new Error(field.label+' 값을 확인해 주세요.');params[field.key]=input;}
  if(value.type==='FORMULA')compileStudyFormula(params.formula);
  if(value.type==='MACD'&&params.fast>=params.slow)throw new Error('빠른 기간은 느린 기간보다 짧아야 합니다.');
  if(['RSI','STOCH','CCI','MFI'].includes(value.type)&&params.lower>=params.upper)throw new Error('하단 기준은 상단 기준보다 작아야 합니다.');
  if(['DMI','ADX'].includes(value.type)&&params.weak>=params.strong)throw new Error('낮은 강도 기준선은 높은 강도 기준선보다 작아야 합니다.');
  const styles={};for(const item of definition.plots){const style=value.styles?.[item.key];if(!style||!/^#[\da-f]{6}$/i.test(style.color)||!/^#[\da-f]{6}$/i.test(style.negative)||![1,2,3,4].includes(style.width)||![0,1,2].includes(style.lineStyle)||typeof style.visible!=='boolean')throw new Error('지표 선의 스타일을 확인해 주세요.');if(item.directional&&!/^#[\da-f]{6}$/i.test(style.neutral??'#9aa4ad'))throw new Error('지표 중립 색상을 확인해 주세요.');styles[item.key]={color:style.color,negative:style.negative,...(item.directional?{neutral:style.neutral??'#9aa4ad'}:{}),width:style.width,lineStyle:style.lineStyle,visible:style.visible};}
  const fill=value.type==='BB'||definition.bandFill?(value.fill??{visible:true,color:definition.bandFill||'#aa91c5',transparency:90}):null;if(fill&&(typeof fill.visible!=='boolean'||!/^#[\da-f]{6}$/i.test(fill.color)||typeof fill.transparency!=='number'||!Number.isFinite(fill.transparency)||fill.transparency<0||fill.transparency>100))throw new Error('밴드 배경색과 투명도(0~100%)를 확인해 주세요.');
  return {...(fill?{fill:{visible:fill.visible,color:fill.color,transparency:fill.transparency}}:{}),id:value.id,type:value.type,visible:value.visible,source:value.source,candle:value.candle,timeframes:[...new Set(value.timeframes)],params,styles};
}
export const defaultStudies=()=>[createStudy('SMA',{id:'default-ma20'}),createStudy('SMA',{id:'default-ma60',params:{period:60},styles:{main:{color:'#be9e60',negative:'#d98e9a',width:1,lineStyle:0,visible:true}}}),createStudy('BB',{id:'default-bb'}),createStudy('VOLUME',{id:'default-volume'})];
export function decodeStudies(serialized){const value=JSON.parse(serialized);if(!value||value.version!==1||!Array.isArray(value.studies)||value.studies.length>MAX_STUDIES)throw new Error('지표 설정 형식을 확인해 주세요.');const previous=['1m','5m','15m','1h','4h','1d'];const studies=value.studies.map(s=>validateStudy({...s,timeframes:value.timeframeVersion!==2&&s.timeframes?.length===previous.length&&previous.every(tf=>s.timeframes.includes(tf))?TIMEFRAMES.map(([tf])=>tf):s.timeframes}));if(new Set(studies.map(s=>s.id)).size!==studies.length)throw new Error('지표 식별자가 중복됐습니다.');return {version:1,timeframeVersion:2,studies};}
export function parseStudies(serialized){try{return decodeStudies(serialized).studies;}catch{return defaultStudies();}}
export const studyLabel=study=>['NW','NW_SLOPE'].includes(study.type)?(study.type==='NW'?'NW':'NW 기울기')+' '+(study.params.kernel==='gaussian'?'G':'RQ')+' '+study.params.bandwidth+' · '+(study.type==='NW'?study.params.lookback:study.params.slopeBars)+'봉':study.type==='FORMULA'?study.params.name:study.type+(['SMA','EMA','BB','RSI','ATR','STOCH','CCI','MFI','BBW','BBP'].includes(study.type)?' '+study.params.period:'')+(['BB','BBW','BBP'].includes(study.type)?' · '+study.params.multiplier:['DMI','ADX'].includes(study.type)?' '+study.params.period+' / '+study.params.smoothing:study.type==='MACD'?' '+[study.params.fast,study.params.slow,study.params.signal].join(' / '):'');
const slopePercent=value=>(Math.abs(value)<.00005?0:value).toFixed(4)+'%';
const slopePriceFormat={type:'custom',minMove:.0001,formatter:slopePercent,tickmarksFormatter:values=>values.map(slopePercent)};
export function studyPriceFormat(study,priceFormat){
 const definition=STUDIES[study.type];if(study.type==='VOLUME')return {type:'volume'};
 if(definition.percent)return slopePriceFormat;
 const precision=definition.precision??(study.type==='FORMULA'&&studyPane(study)?6:['RSI','STOCH'].includes(study.type)?2:null);
 return precision===null?priceFormat:{type:'price',precision,minMove:10**-precision};
}
export const studyPane=study=>study.type==='FORMULA'?study.params.placement==='pane':STUDIES[study.type].pane;
export const studyActive=(study,interval)=>study.visible&&study.timeframes.includes(interval)&&(Object.values(study.styles).some(style=>style.visible)||(study.type==='BB'||STUDIES[study.type].bandFill)&&study.fill?.visible&&study.fill.transparency<100);
const formulaCache=new Map();
export function compileStudyFormula(source){
  if(formulaCache.has(source))return formulaCache.get(source);
  const compiled=compileFormula(source),api=globalThis.AnalysisFormula;
  function visit(node){if(!node||typeof node!=='object')return;const name=String(node.name||'').replace(/\s+/g,'').toLowerCase();if((node.type==='variable'&&POSITION_FIELDS.includes(api.variableAliases[name])||node.type==='call'&&POSITION_FIELDS.includes(api.functionAliases[name])))throw new Error('차트 수식에서는 포지션 수익률·평균 진입가를 사용할 수 없습니다.');if(node.type==='timeframe'||node.type==='call'&&api.functionAliases[name]==='frame')throw new Error('지표 수식은 현재 차트의 봉 주기를 사용합니다. @주기는 봇 조건식에서 사용할 수 있습니다.');for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}}
  visit(compiled.ast);if(formulaCache.size>=32)formulaCache.delete(formulaCache.keys().next().value);formulaCache.set(source,compiled);return compiled;
}
export function formulaStudyResult(source,candles,options={}){return compileStudyFormula(source).evaluateSeries(formulaSeries(candles),options);}
export function average(values,period,kind='SMA'){
  const output=values.map(()=>null);let running=null,window=[];
  values.forEach((value,index)=>{if(value==null||!Number.isFinite(value)){window=[];running=null;return;}window.push(value);if(window.length>period)window.shift();if(window.length<period)return;if(kind==='SMA'||running===null)running=window.reduce((sum,n)=>sum+n,0)/period;else{const alpha=kind==='RMA'?1/period:2/(period+1);running+=alpha*(value-running);}output[index]=running;});return output;
}
function sourceValues(candles,source){return candles.map(c=>source==='hl2'?(c.high+c.low)/2:source==='hlc3'?(c.high+c.low+c.close)/3:source==='ohlc4'?(c.open+c.high+c.low+c.close)/4:c[source]);}
export function studyData(study,raw,candleType='standard'){
  const kind=study.candle==='chart'?candleType:study.candle,candles=kind==='heikin'?heikinAshi(raw):raw,values=sourceValues(candles,study.source),p=study.params,arrays={},levels=[];let error=null;
  switch(study.type){
    case 'NW':case 'NW_SLOPE':{const middle=nadarayaWatson(values,p);arrays.slope=kernelSlope(middle,p.slopeBars);if(study.type==='NW')Object.assign(arrays,nadarayaEnvelope(values,middle,p.errorPeriod,p.multiplier));else{arrays.main=arrays.slope;levels.push(...new Set([-p.neutral,0,p.neutral]));}break;}
    case 'SMA':case 'EMA':arrays.main=average(values,p.period,study.type);break;
    case 'BB':case 'BBW':case 'BBP':{
      const bands=bollingerArrays(values,average(values,p.period,p.basis),p.period,p.multiplier);
      if(study.type==='BB')Object.assign(arrays,bands);
      else if(study.type==='BBW')arrays.main=values.map((_,i)=>bands.upper[i]===null||bands.middle[i]===0?null:(bands.upper[i]-bands.lower[i])/bands.middle[i]*100);
      else{arrays.main=values.map((value,i)=>bands.upper[i]===null||bands.upper[i]===bands.lower[i]?null:(value-bands.lower[i])/(bands.upper[i]-bands.lower[i]));levels.push(0,.5,1);}break;
    }
    case 'DMI':case 'ADX':{const data=directionalMovement(candles,p.period,p.smoothing);if(study.type==='DMI')Object.assign(arrays,data);else arrays.main=data.adx;levels.push(p.weak,p.strong);break;}
    case 'CCI':arrays.main=commodityChannel(values,p.period);levels.push(p.lower,0,p.upper);break;
    case 'MFI':arrays.main=moneyFlow(candles,values,p.period);levels.push(p.lower,50,p.upper);break;
    case 'RSI':{
      const changes=values.map((value,i)=>i?value-values[i-1]:null),up=average(changes.map(value=>value==null?null:Math.max(0,value)),p.period,'RMA'),down=average(changes.map(value=>value==null?null:Math.max(0,-value)),p.period,'RMA');
      arrays.main=up.map((value,i)=>value==null?null:!value&&!down[i]?50:!down[i]?100:100-100/(1+value/down[i]));levels.push(p.upper,50,p.lower);break;
    }
    case 'MACD':{const fast=average(values,p.fast,p.average),slow=average(values,p.slow,p.average);arrays.main=fast.map((n,i)=>n==null||slow[i]==null?null:n-slow[i]);arrays.signal=average(arrays.main,p.signal,p.average);arrays.histogram=arrays.main.map((n,i)=>n==null||arrays.signal[i]==null?null:n-arrays.signal[i]);levels.push(0);break;}
    case 'STOCH':{const k=candles.map((c,i)=>{if(i<p.period-1)return null;const sample=candles.slice(i-p.period+1,i+1),high=Math.max(...sample.map(x=>x.high)),low=Math.min(...sample.map(x=>x.low));return high===low?null:(c.close-low)/(high-low)*100;});arrays.main=average(k,p.smooth);arrays.signal=average(arrays.main,p.signal);levels.push(p.upper,50,p.lower);break;}
    case 'ATR':arrays.main=average(candles.map((c,i)=>i?Math.max(c.high-c.low,Math.abs(c.high-candles[i-1].close),Math.abs(c.low-candles[i-1].close)):c.high-c.low),p.period,p.average);break;
    case 'VWAP':{let key=null,total=0,weighted=0;arrays.main=candles.map((c,i)=>{const date=new Date(c.time*1000),group=p.anchor==='day'?Math.floor(c.time/86400):p.anchor==='week'?Math.floor((c.time+3*86400)/604800):date.getUTCFullYear()*12+date.getUTCMonth();if(group!==key){key=group;total=0;weighted=0;}total+=c.volume;weighted+=values[i]*c.volume;return total>0?weighted/total:null;});break;}
    case 'VOLUME':arrays.main=raw.map(c=>c.volume);break;
    case 'FORMULA':{try{const result=formulaStudyResult(p.formula,raw);arrays.main=result.values;if(!result.ok)error=result.error;}catch(problem){error=problem.message;arrays.main=[];}break;}
  }
  return {levels,error,plots:STUDIES[study.type].plots.map(item=>{let started=false;return {...item,data:(arrays[item.key]||[]).flatMap((value,index)=>{if(value==null||!Number.isFinite(value))return study.type==='FORMULA'||STUDIES[study.type].gaps&&started?[{time:raw[index].time}]:[];started=true;return [{time:raw[index].time,value,...(item.directional?{color:(arrays.slope[index]??0)>p.neutral?study.styles[item.key].color:(arrays.slope[index]??0)<-p.neutral?study.styles[item.key].negative:study.styles[item.key].neutral}:item.histogram?{color:(study.type==='VOLUME'?candles[index].close>=candles[index].open:value>=0)?study.styles[item.key].color:study.styles[item.key].negative}:{})}];})};})};
}
