import {compileFormula} from './formula.js';
import {POSITION_FIELDS} from './formula-position.js';
const formulaCache=new Map();
export function compileStudyFormula(source){
  if(formulaCache.has(source))return formulaCache.get(source);
  const compiled=compileFormula(source),api=globalThis.AnalysisFormula;
  function visit(node){if(!node||typeof node!=='object')return;const name=String(node.name||'').replace(/\s+/g,'').toLowerCase();if((node.type==='variable'&&POSITION_FIELDS.includes(api.variableAliases[name])||node.type==='call'&&POSITION_FIELDS.includes(api.functionAliases[name])))throw new Error('차트 수식에서는 포지션 수익률·평균 진입가를 사용할 수 없습니다.');if(node.type==='timeframe'||node.type==='call'&&api.functionAliases[name]==='frame')throw new Error('지표 수식은 현재 차트의 봉 주기를 사용합니다. @주기는 봇 조건식에서 사용할 수 있습니다.');for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}}
  visit(compiled.ast);if(formulaCache.size>=32)formulaCache.delete(formulaCache.keys().next().value);formulaCache.set(source,compiled);return compiled;
}
