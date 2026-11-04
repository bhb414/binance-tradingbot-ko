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
export const STUDIES={
  FORMULA:{name:'수식 지표',english:'Custom Formula · 나만의 보조지표',group:'custom',pane:false,fields:[{key:'name',label:'지표 이름',value:'나의 수식',type:'text',maxLength:32},choice('placement','표시 위치','overlay',[['overlay','가격 차트 위'],['pane','별도 패널']]),{key:'formula',label:'지표 수식',value:'종가[0:3]/3',type:'formula',maxLength:1000}],plots:[plot('main','수식선','#6493b5')],note:'[0]은 현재 봉, [1]은 직전 봉입니다. [0:3]은 0·1·2봉 값의 합계이며 끝 번호 3은 제외합니다. 종가는 일반 캔들, 하이킨종가는 합성 캔들입니다. 차트 유형을 바꿔도 이 기준은 유지합니다.'},
  SMA:{name:'이동평균선',english:'Simple Moving Average',group:'trend',pane:false,source:true,fields:[length('period','기간',20)],plots:[plot('main','이동평균선','#528f85')]},
  EMA:{name:'지수이동평균선',english:'Exponential Moving Average',group:'trend',pane:false,source:true,fields:[length('period','기간',20)],plots:[plot('main','지수이동평균선','#5688c4')]},
  BB:{name:'볼린저밴드',english:'Bollinger Bands',group:'trend',pane:false,source:true,fields:[length('period','기간',20,2),{key:'multiplier',label:'표준편차 배수',value:2,min:0.1,max:10,step:0.1},choice('basis','중심선 종류','SMA',[['SMA','단순 이동평균'],['EMA','지수 이동평균']])],plots:[plot('upper','상단선','#aa91c5'),plot('middle','중심선','#bcadd0',{lineStyle:2}),plot('lower','하단선','#aa91c5')]},
  RSI:{name:'상대강도지수',english:'Relative Strength Index',group:'momentum',pane:true,source:true,fields:[length('period','기간',14,2),{key:'upper',label:'상단 기준',value:70,min:1,max:100,step:1},{key:'lower',label:'하단 기준',value:30,min:0,max:99,step:1}],plots:[plot('main','RSI','#9c81bd')]},
  MACD:{name:'MACD',english:'Moving Average Convergence Divergence',group:'momentum',pane:true,source:true,fields:[length('fast','빠른 기간',12),length('slow','느린 기간',26,2),length('signal','시그널 기간',9),choice('average','이동평균 종류','EMA',[['EMA','지수 이동평균'],['SMA','단순 이동평균']])],plots:[plot('main','MACD선','#5688c4'),plot('signal','시그널선','#d39b62'),plot('histogram','히스토그램','#70b69b',{histogram:true,negative:'#d98e9a'})]},
  STOCH:{name:'스토캐스틱',english:'Stochastic Oscillator',group:'momentum',pane:true,fields:[length('period','%K 기간',14),length('smooth','%K 평활',3),length('signal','%D 기간',3),{key:'upper',label:'상단 기준',value:80,min:1,max:100,step:1},{key:'lower',label:'하단 기준',value:20,min:0,max:99,step:1}],plots:[plot('main','%K','#5688c4'),plot('signal','%D','#d39b62')]},
  ATR:{name:'평균 진폭',english:'Average True Range',group:'volatility',pane:true,fields:[length('period','기간',14),choice('average','평활 방식','RMA',[['RMA','와일더 평활 (RMA)'],['SMA','단순 이동평균'],['EMA','지수 이동평균']])],plots:[plot('main','ATR','#cd8c79')]},
  VWAP:{name:'거래량 가중 평균가격',english:'Volume Weighted Average Price',group:'volume',pane:false,source:true,defaultSource:'hlc3',fields:[choice('anchor','초기화 기준 (UTC)','day',[['day','매일 00:00'],['week','매주 월요일 00:00'],['month','매월 1일 00:00']])],plots:[plot('main','VWAP','#c59a5a')],note:'UTC 기준으로 누적 거래대금 ÷ 누적 거래량을 계산합니다. 첫 구간은 조회된 봉부터 계산합니다.'},
  VOLUME:{name:'거래량',english:'Volume',group:'volume',pane:true,fields:[],plots:[plot('main','거래량','#a0d0bd',{histogram:true,negative:'#e3b3bc'})]}
};

export function createStudy(type,overrides={}){
  const definition=STUDIES[type];if(!definition)throw new Error('지원하지 않는 지표입니다.');
  return validateStudy({id:'study-'+randomId(),type,visible:true,source:definition.defaultSource||'close',candle:'chart',timeframes:TIMEFRAMES.map(([key])=>key),params:Object.fromEntries(definition.fields.map(field=>[field.key,field.value])),styles:Object.fromEntries(definition.plots.map(item=>[item.key,{color:item.color,negative:item.negative||'#d98e9a',width:1,lineStyle:item.lineStyle||0,visible:true}])),...overrides});
}
export function validateStudy(value){
  const definition=STUDIES[value?.type];if(!definition||typeof value.id!=='string'||!/^[\w-]{1,80}$/.test(value.id))throw new Error('지표 설정 형식을 확인해 주세요.');
  if(!SOURCES.some(([key])=>key===value.source)||!['chart','standard','heikin'].includes(value.candle)||typeof value.visible!=='boolean')throw new Error('지표의 계산 기준을 확인해 주세요.');
  if(!Array.isArray(value.timeframes)||!value.timeframes.length||value.timeframes.some(tf=>!TIMEFRAMES.some(([key])=>key===tf)))throw new Error('표시할 봉 주기를 하나 이상 선택해 주세요.');
  const params={};for(const field of definition.fields){const input=value.params?.[field.key];if(field.type==='text'||field.type==='formula'){if(typeof input!=='string'||!input.trim()||input.length>field.maxLength)throw new Error(field.label+'을 1~'+field.maxLength+'자로 입력해 주세요.');params[field.key]=input.trim();continue;}if(field.options?!field.options.some(([key])=>key===input):typeof input!=='number'||!Number.isFinite(input)||input<field.min||input>field.max||field.step===1&&!Number.isInteger(input))throw new Error(field.label+' 값을 확인해 주세요.');params[field.key]=input;}
  if(value.type==='FORMULA')compileStudyFormula(params.formula);
  if(value.type==='MACD'&&params.fast>=params.slow)throw new Error('빠른 기간은 느린 기간보다 짧아야 합니다.');
  if(['RSI','STOCH'].includes(value.type)&&params.lower>=params.upper)throw new Error('하단 기준은 상단 기준보다 작아야 합니다.');
  const styles={};for(const item of definition.plots){const style=value.styles?.[item.key];if(!style||!/^#[\da-f]{6}$/i.test(style.color)||!/^#[\da-f]{6}$/i.test(style.negative)||![1,2,3,4].includes(style.width)||![0,1,2].includes(style.lineStyle)||typeof style.visible!=='boolean')throw new Error('지표 선의 스타일을 확인해 주세요.');styles[item.key]={color:style.color,negative:style.negative,width:style.width,lineStyle:style.lineStyle,visible:style.visible};}
  const fill=value.type==='BB'?(value.fill??{visible:true,color:'#aa91c5',transparency:90}):null;if(fill&&(typeof fill.visible!=='boolean'||!/^#[\da-f]{6}$/i.test(fill.color)||typeof fill.transparency!=='number'||!Number.isFinite(fill.transparency)||fill.transparency<0||fill.transparency>100))throw new Error('볼린저밴드 배경색과 투명도(0~100%)를 확인해 주세요.');
  return {...(fill?{fill:{visible:fill.visible,color:fill.color,transparency:fill.transparency}}:{}),id:value.id,type:value.type,visible:value.visible,source:value.source,candle:value.candle,timeframes:[...new Set(value.timeframes)],params,styles};
}
export const defaultStudies=()=>[createStudy('SMA',{id:'default-ma20'}),createStudy('SMA',{id:'default-ma60',params:{period:60},styles:{main:{color:'#be9e60',negative:'#d98e9a',width:1,lineStyle:0,visible:true}}}),createStudy('BB',{id:'default-bb'}),createStudy('VOLUME',{id:'default-volume'})];
export function parseStudies(serialized){try{const value=JSON.parse(serialized);if(value.version!==1||!Array.isArray(value.studies)||value.studies.length>MAX_STUDIES)throw new Error();const previous=['1m','5m','15m','1h','4h','1d'];const studies=value.studies.map(s=>validateStudy({...s,timeframes:value.timeframeVersion!==2&&s.timeframes?.length===previous.length&&previous.every(tf=>s.timeframes.includes(tf))?TIMEFRAMES.map(([tf])=>tf):s.timeframes}));if(new Set(studies.map(s=>s.id)).size!==studies.length)throw new Error();return studies;}catch{return defaultStudies();}}
export const studyLabel=study=>study.type==='FORMULA'?study.params.name:study.type+(['SMA','EMA','BB','RSI','ATR','STOCH'].includes(study.type)?' '+study.params.period:'')+(study.type==='BB'?' · '+study.params.multiplier:study.type==='MACD'?' '+[study.params.fast,study.params.slow,study.params.signal].join(' / '):'');
export const studyPane=study=>study.type==='FORMULA'?study.params.placement==='pane':STUDIES[study.type].pane;
export const studyActive=(study,interval)=>study.visible&&study.timeframes.includes(interval)&&(Object.values(study.styles).some(style=>style.visible)||study.type==='BB'&&study.fill?.visible&&study.fill.transparency<100);
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
    case 'SMA':case 'EMA':arrays.main=average(values,p.period,study.type);break;
    case 'BB':{
      arrays.middle=average(values,p.period,p.basis);arrays.upper=values.map(()=>null);arrays.lower=values.map(()=>null);
      for(let i=p.period-1;i<values.length;i++){const sample=values.slice(i-p.period+1,i+1),mean=sample.reduce((sum,n)=>sum+n,0)/p.period,sd=Math.sqrt(sample.reduce((sum,n)=>sum+(n-mean)**2,0)/p.period);arrays.upper[i]=arrays.middle[i]+sd*p.multiplier;arrays.lower[i]=arrays.middle[i]-sd*p.multiplier;}break;
    }
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
  return {levels,error,plots:STUDIES[study.type].plots.map(item=>({...item,data:(arrays[item.key]||[]).flatMap((value,index)=>value==null||!Number.isFinite(value)?study.type==='FORMULA'?[{time:raw[index].time}]:[]:[{time:raw[index].time,value,...(item.histogram?{color:(study.type==='VOLUME'?candles[index].close>=candles[index].open:value>=0)?study.styles[item.key].color:study.styles[item.key].negative}:{})}])}))};
}
