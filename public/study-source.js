import './analysis-formula.js';
export const isCustomStudy=study=>['FORMULA','SCRIPT'].includes(study?.type);
export const studySource=study=>study?.type==='SCRIPT'?study.params?.script??'':study?.params?.formula??'';
// Inspect only top-level statements. Comparisons, quoted plot names and comments
// must not turn an ordinary expression into a variable assignment.
export function studyInputType(source){
 if(typeof source!=='string')return 'FORMULA';let statement='',depth=0,quoted=false,escaped=false,comment=false;const statements=[];
 for(let i=0;i<=source.length;i++){const c=source[i]??'\n';if(comment){if(c!=='\n')continue;comment=false;}if(!quoted&&c==='/'&&source[i+1]==='/'){comment=true;i++;continue;}
  if(quoted){statement+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"'){quoted=true;statement+=c;continue;}if(c==='('||c==='[')depth++;if(c===')'||c===']')depth=Math.max(0,depth-1);
  if((c==='\n'||c===';')&&depth===0){if(statement.trim())statements.push(statement.trim());statement='';}else statement+=c;
 }if(statement.trim())statements.push(statement.trim());const api=globalThis.AnalysisFormula;
 for(const text of statements){if(/^(?:선|예상선|막대|histogram|plot|forecast|매수신호|매도신호|buySignal|sellSignal|배경|bgcolor|화살표|화살표신호|arrow)\s*\(/i.test(text))return 'SCRIPT';const m=/^([A-Za-z_가-힣][A-Za-z0-9_가-힣]*)\s*=(?!=)/.exec(text);if(m){const name=m[1].toLowerCase();if(!Object.hasOwn(api.variableAliases,name)&&!Object.hasOwn(api.functionAliases,name)&&!Object.hasOwn(api.constantAliases||{},name))return 'SCRIPT';}}
 return 'FORMULA';
}
