import {MAX_SCRIPT_PLOTS,MAX_SCRIPT_BACKGROUNDS} from './study-limits.js';
import {compileStudyFormula} from './study-expression.js';
import {formulaSeries} from './indicators.js';
import {shiftStudyPoints,projectStudyPoints} from './study-time.js';
export const SCRIPT_EXAMPLES=[
{name:'골든·데드크로스 매수·매도 화살표',source:'단기 = VWMA(하이킨종가, 6, 거래량)\n장기 = SMA(하이킨종가, 55)\n선("단기", 단기)\n선("장기", 장기)\n매수신호("골든크로스", 상향돌파(단기, 장기))\n매도신호("데드크로스", 하향돌파(단기, 장기))'},
{name:'이격 막대 · 0 기준으로 색상',source:'이격 = VWMA(하이킨종가, 5, 거래량) - SMA(하이킨종가, 5)\n막대("이격", 이격)\n선("0 기준선", 0)',placement:'pane'},
{name:'이격 막대 · 다른 선식으로 색상',source:'이격 = VWMA(하이킨종가, 5, 거래량) - SMA(하이킨종가, 5)\n기준 = SMA(이격, 5)\n막대("이격", 이격, 기준)\n선("색 기준선", 기준)',placement:'pane'},
{name:'화살표 · 글자 지정 · 같은 봉에 쌓기',source:'전환 = 상향돌파(SMA(하이킨종가, 6), SMA(하이킨종가, 20))\n화살표("교차", 전환)\n화살표("양봉 확인", 전환 and 하이킨종가 > 하이킨시가)\n배경("전환 봉", 전환)'},
{name:'교차한 봉 배경 · 매수·매도 시점',source:'기울기 = 변화율(SMA(SMA(하이킨종가, 20), 20), 1)\n선("기울기", 기울기)\n선("0 기준선", 0)\n배경("매수 시점", 하향돌파(기울기, 0))\n배경("매도 시점", 상향돌파(기울기, 0))',placement:'pane'},
{name:'조건 유지 구간 배경',source:'단기 = SMA(하이킨종가, 6)\n장기 = SMA(하이킨종가, 20)\n선("단기", 단기)\n선("장기", 장기)\n배경("단기 > 장기", 단기 > 장기)\n배경("단기 < 장기", 단기 < 장기)',placement:'overlay'},
{name:'이평 2개와 미래 3봉 예상',source:'단기 = VWMA(하이킨종가, 6, 거래량)\n장기 = SMA(하이킨종가, 55)\n선("VWMA 6", 단기)\n선("SMA 55", 장기)\n예상선("단기 예상", 단기, 3, 3)\n예상선("장기 예상", 장기, 3, 3)'},
{name:'조건에 따라 선 선택',source:'단기 = SMA(종가, 6)\n장기 = SMA(종가, 55)\n선("조건선", 조건(단기 > 장기, 단기, 장기))'},
{name:'선행선 · 26봉 앞으로 이동',source:'전환 = (최고(고가, 9) + 최저(저가, 9)) / 2\n기준 = (최고(고가, 26) + 최저(저가, 26)) / 2\n선("전환선", 전환)\n선("기준선", 기준)\n선("선행 A", (전환 + 기준) / 2, 26)\n선("선행 B", (최고(고가, 52) + 최저(저가, 52)) / 2, 26)\n선("후행선", 종가, -26)'}];
const cache=new Map();
function statements(source){let current='',depth=0,quoted=false,comment=false,line=1,first=1,result=[];
 for(let i=0;i<=source.length;i++){const c=source[i]??'\n';if(comment){if(c!=='\n')continue;comment=false;}if(!quoted&&c==='/'&&source[i+1]==='/'){comment=true;i++;continue;}if(c==='"'&&source[i-1]!=='\\')quoted=!quoted;if(!quoted){if(c==='(')depth++;if(c===')')depth--;if(depth<0)throw Error(line+'행: 괄호를 확인하세요.');}
  if((c==='\n'||c===';')&&!quoted&&depth===0){if(current.trim())result.push({text:current.trim(),line:first});current='';first=line+(c==='\n'?1:0);}else current+=c;if(c==='\n')line++;
 }if(depth||quoted)throw Error('닫히지 않은 괄호 또는 따옴표가 있습니다.');if(result.length>48)throw Error('스크립트는 48문장 이내로 작성하세요.');return result;
}
function args(text){let start=0,depth=0,quoted=false,out=[];for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'&&text[i-1]!=='\\')quoted=!quoted;if(!quoted){if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;if(c===','&&depth===0){out.push(text.slice(start,i).trim());start=i+1;}}}out.push(text.slice(start).trim());return out;}
const integer=(s,min,max,fallback)=>{const v=s===undefined?fallback:Number(s);if(!/^-?\d+$/.test(String(v))||!Number.isInteger(v)||v<min||v>max)throw Error('표시 이동 -300~300, 예상 봉 수 1~120, 기울기 비교 1~300, 기준봉 0 또는 1을 확인하세요.');return v;};
export function compileStudyScript(source){
 if(typeof source!=='string'||!source.trim()||source.length>8000)throw Error('스크립트는 1~8,000자로 작성하세요.');if(cache.has(source))return cache.get(source);
 const names=new Map(),variables=[],plots=[],backgrounds=[],api=globalThis.AnalysisFormula;
 const expression=text=>{let transformed=text;for(const token of api.tokenize(text).filter(t=>t.type==='id'&&names.has(t.value)).reverse())transformed=transformed.slice(0,token.position)+names.get(token.value)+'.종가'+transformed.slice(token.position+token.value.length);const compiled=compileStudyFormula(transformed);
  const visit=node=>{if(node?.type==='symbol'&&![...names.values()].includes(node.symbol))throw Error('다른 종목 참조는 봇 조건식에서 사용하세요.');if(node&&typeof node==='object')for(const v of Object.values(node)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}};visit(compiled.ast);return compiled;};
 for(const statement of statements(source)){try{const match=statement.text.match(/^(선|예상선|막대|histogram|plot|forecast|매수신호|매도신호|buySignal|sellSignal|배경|bgcolor|화살표|화살표신호|arrow)\s*\(([\s\S]*)\)$/i);
  if(match){
   const values=args(match[2]),name=match[1].toLowerCase(),projection=['예상선','forecast'].includes(name),histogram=['막대','histogram'].includes(name),generic=['화살표','화살표신호','arrow'].includes(name),signal=generic||['매수신호','매도신호','buysignal','sellsignal'].includes(name),background=['배경','bgcolor'].includes(name);
   if(background?backgrounds.length>=MAX_SCRIPT_BACKGROUNDS:plots.length>=MAX_SCRIPT_PLOTS)throw Error(background?'한 지표는 배경 조건을 최대 '+MAX_SCRIPT_BACKGROUNDS+'개 사용합니다.':'한 지표는 선·막대·신호를 합쳐 최대 '+MAX_SCRIPT_PLOTS+'개 출력합니다.');
   if(values.length<2||values.length>(signal||background?2:projection?5:3))throw Error(background?'배경("이름", 조건)':generic?'화살표("글자", 조건)':signal?'매수신호("이름", 조건) 또는 매도신호("이름", 조건)':projection?'예상선("이름", 수식, 예상봉수, 기울기비교봉수, 기준봉)':histogram?'막대("이름", 수식, 색 기준식 선택)':'선("이름", 수식, 표시이동봉수)');
   let label;try{label=JSON.parse(values[0]);}catch{throw Error('선·신호 이름은 "이름"처럼 큰따옴표로 감싸세요.');}
   if(typeof label!=='string'||!generic&&!label.trim()||label.length>40)throw Error('선·신호 이름은 1~40자로 입력하세요.');
   if(background)backgrounds.push({key:'bg'+backgrounds.length,label:label.trim(),background:true,compiled:expression(values[1])});
   else plots.push({key:'line'+plots.length,label:label.trim()||'화살표 '+(plots.length+1),projection,compiled:expression(values[1]),...(histogram?{histogram:true,reference:expression(values[2]??'0')}:signal?{signal:true,side:generic||['매수신호','buysignal'].includes(name)?'buy':'sell',...(generic?{generic:true,text:label.trim()}:{})}:projection?{horizon:integer(values[2],1,120,3),slopeBars:integer(values[3],1,300,3),lag:integer(values[4],0,1,1)}:{offset:integer(values[2],-300,300,0)})});
  }else{const assignment=statement.text.match(/^([A-Za-z_가-힣][A-Za-z0-9_가-힣]*)\s*=([^=][\s\S]*)$/);if(!assignment)throw Error('이름 = 수식, 선("이름", 수식), 매수신호("이름", 조건) 또는 매도신호("이름", 조건)으로 작성하세요.');const name=assignment[1],normalized=name.toLowerCase();if(names.has(name)||Object.hasOwn(api.variableAliases,normalized)||Object.hasOwn(api.functionAliases,normalized)||Object.hasOwn(api.constantAliases||{},normalized)||['선','예상선','막대','histogram','plot','forecast','매수신호','매도신호','buysignal','sellsignal','배경','bgcolor','화살표','화살표신호','arrow','constructor','__proto__','prototype','and','or','not','true','false'].includes(normalized))throw Error('이미 사용 중인 이름입니다: '+name);if(variables.length===24)throw Error('변수는 최대 24개입니다.');const compiled=expression(assignment[2]),key='V'+variables.length;variables.push({name,key,compiled});names.set(name,key);}
 }catch(error){throw Error(statement.line+'행: '+error.message);}}
 if(!plots.length&&!backgrounds.length)throw Error('막대(), 선(), 예상선(), 매수신호() 또는 매도신호() 또는 배경()을 하나 이상 추가하세요.');const result={variables,plots,backgrounds};if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(source,result);return result;
}
export function scriptStudyData(source,raw,interval='1m',styles={}){
 try{const program=compileStudyScript(source),series=formulaSeries(raw);series.symbols=Object.create(null);let remaining=2000000;
  const calculate=compiled=>{if(remaining<=0)throw Error('스크립트 계산량이 한도를 초과했습니다.');const r=compiled.evaluateSeries(series,{maxSteps:Math.min(1000000,remaining)});remaining-=r.steps||0;if(!r.ok)throw Error(r.error);return r.values;};
  for(const item of program.variables){const values=calculate(item.compiled);series.symbols[item.key]={close:values,volume:series.volume};}
  const plots=[...program.plots,...program.backgrounds].map(item=>{const values=calculate(item.compiled),reference=item.histogram?calculate(item.reference):null,style=styles[item.key],data=item.histogram?raw.map((c,i)=>({time:c.time,...(Number.isFinite(values[i])&&Number.isFinite(reference[i])?{value:values[i],color:values[i]>=reference[i]?(style?.color||'#249b78'):(style?.negative||'#df6879')}:{})})):item.signal||item.background?raw.map((c,i)=>({time:c.time,...(typeof values[i]==='boolean'||Number.isFinite(values[i])?{value:values[i]?1:0}:{})})):item.projection?projectStudyPoints(values,raw,{...item,interval}).data:shiftStudyPoints(values,raw,item.offset,interval);return {key:item.key,label:item.label,projection:item.projection,...(item.histogram?{histogram:true}:{}),...(item.signal?{signal:true,side:item.side,...(item.generic?{generic:true,text:item.text}:{})}:{}),...(item.background?{background:true}:{}),data};});return {levels:[],error:null,plots};
 }catch(error){return {levels:[],error:error.message,plots:[]};}
}
