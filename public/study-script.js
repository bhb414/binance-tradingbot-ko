import {compileStudyFormula} from './study-expression.js';
import {formulaSeries} from './indicators.js';
import {shiftStudyPoints,projectStudyPoints} from './study-time.js';
export const SCRIPT_EXAMPLES=[
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
 const names=new Map(),variables=[],plots=[],api=globalThis.AnalysisFormula;
 const expression=text=>{let transformed=text;for(const token of api.tokenize(text).filter(t=>t.type==='id'&&names.has(t.value)).reverse())transformed=transformed.slice(0,token.position)+names.get(token.value)+'.종가'+transformed.slice(token.position+token.value.length);const compiled=compileStudyFormula(transformed);
  const visit=node=>{if(node?.type==='symbol'&&![...names.values()].includes(node.symbol))throw Error('다른 종목 참조는 봇 조건식에서 사용하세요.');if(node&&typeof node==='object')for(const v of Object.values(node)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}};visit(compiled.ast);return compiled;};
 for(const statement of statements(source)){try{const match=statement.text.match(/^(선|예상선|plot|forecast)\s*\(([\s\S]*)\)$/i);
  if(match){if(plots.length===6)throw Error('한 스크립트는 최대 6개 선을 그립니다.');const values=args(match[2]),projection=['예상선','forecast'].includes(match[1].toLowerCase());if(values.length<2||values.length>(projection?5:3))throw Error(projection?'예상선("이름", 수식, 예상봉수, 기울기비교봉수, 기준봉)':'선("이름", 수식, 표시이동봉수)');let label;try{label=JSON.parse(values[0]);}catch{throw Error('선 이름은 "이름"처럼 큰따옴표로 감싸세요.');}if(typeof label!=='string'||!label.trim()||label.length>40)throw Error('선 이름은 1~40자로 입력하세요.');plots.push({key:'line'+plots.length,label:label.trim(),projection,compiled:expression(values[1]),...(projection?{horizon:integer(values[2],1,120,3),slopeBars:integer(values[3],1,300,3),lag:integer(values[4],0,1,1)}:{offset:integer(values[2],-300,300,0)})});
  }else{const assignment=statement.text.match(/^([A-Za-z_가-힣][A-Za-z0-9_가-힣]*)\s*=([^=][\s\S]*)$/);if(!assignment)throw Error('이름 = 수식 또는 선("이름", 수식)으로 작성하세요.');const name=assignment[1],normalized=name.toLowerCase();if(names.has(name)||Object.hasOwn(api.variableAliases,normalized)||Object.hasOwn(api.functionAliases,normalized)||Object.hasOwn(api.constantAliases||{},normalized)||['선','예상선','plot','forecast','constructor','__proto__','prototype','and','or','not','true','false'].includes(normalized))throw Error('이미 사용 중인 이름입니다: '+name);if(variables.length===24)throw Error('변수는 최대 24개입니다.');const compiled=expression(assignment[2]),key='V'+variables.length;variables.push({name,key,compiled});names.set(name,key);}
 }catch(error){throw Error(statement.line+'행: '+error.message);}}
 if(!plots.length)throw Error('선() 또는 예상선()을 하나 이상 추가하세요.');const result={variables,plots};if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(source,result);return result;
}
export function scriptStudyData(source,raw,interval='1m'){
 try{const program=compileStudyScript(source),series=formulaSeries(raw);series.symbols=Object.create(null);let remaining=2000000;
  const calculate=compiled=>{if(remaining<=0)throw Error('스크립트 계산량이 한도를 초과했습니다.');const r=compiled.evaluateSeries(series,{maxSteps:Math.min(1000000,remaining)});remaining-=r.steps||0;if(!r.ok)throw Error(r.error);return r.values;};
  for(const item of program.variables){const values=calculate(item.compiled);series.symbols[item.key]={close:values,volume:series.volume};}
  const plots=program.plots.map(item=>{const values=calculate(item.compiled),data=item.projection?projectStudyPoints(values,raw,{...item,interval}).data:shiftStudyPoints(values,raw,item.offset,interval);return {key:item.key,label:item.label,projection:item.projection,data};});return {levels:[],error:null,plots};
 }catch(error){return {levels:[],error:error.message,plots:[]};}
}

