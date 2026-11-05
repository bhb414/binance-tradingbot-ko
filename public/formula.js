import {POSITION_FIELDS} from './formula-position.js';
import './analysis-formula.js';

export const compileFormula = source => globalThis.AnalysisFormula.compile(source);
export const DEFAULT_FORMULA = '상향돌파(종가, EMA(종가, 20))@15m[1]\nAND (하이킨종가 > 하이킨시가)@15m[1]';
export const FORMULA_TIMEFRAMES=globalThis.AnalysisFormula.timeframes;
const minutes=tf=>Number(tf.slice(0,-1))*({m:1,h:60,d:1440,w:10080,M:43200}[tf.at(-1)]);
// History operations must be inside one explicit frame. This prevents comparing
// a historical small candle with the eventual close of an unfinished larger one.
export function formulaTimeframes(formula){
  const ast=typeof formula==='string'?compileFormula(formula).ast:formula.ast||formula,frames=new Set(),api=globalThis.AnalysisFormula;
  const children=node=>node.type==='binary'?[node.left,node.right]:node.type==='call'?node.args:node.value&&typeof node.value==='object'?[node.value]:[];
  const hasFrame=node=>node.type==='timeframe'||children(node).some(hasFrame);
  function visit(node,scope=null){
    if(node.type==='timeframe'){
      frames.add(node.interval);visit(node.value,node.interval);return;
    }
    const name=node.type==='call'?api.functionAliases[node.name.toLowerCase()]:null;
    if(name==='frame')throw new Error('봉() 대신 EMA(종가, 20)@1h[1]처럼 봉 주기를 지정하세요.');
    const history=['occurs','countTrue','occursStarts','countStarts','sma','ema','vwma','nw','percentile','rsi','stdev','atr','change','changePct','crossUp','crossDown','bbUpper','bbMiddle','bbLower'].includes(name)||['lag','range'].includes(node.type);
    if(history&&children(node).some(hasFrame))throw new Error('과거 봉을 계산하는 함수 전체에 주기를 붙이세요. 예: 상향돌파(종가, EMA(종가, 20))@5m');
    if(history&&!scope)throw new Error('계산식 뒤에 봉 주기를 지정하세요. 예: EMA(종가, 20)@1h[1]');
    if(node.type==='variable'&&!scope&&!Object.hasOwn(api.constantAliases,node.name.toLowerCase())&&!POSITION_FIELDS.includes(api.variableAliases[node.name.toLowerCase()]))throw new Error('데이터 뒤에 봉 주기를 지정하세요. 예: 종가@5m[1]');
    children(node).forEach(child=>visit(child,scope));
  }
  visit(ast);if(frames.size>6)throw new Error('조건 하나에는 봉 주기를 최대 6개까지 사용할 수 있습니다.');
  return [...frames].sort((a,b)=>minutes(a)-minutes(b));
}
export function formulaSymbols(formula){
  const ast=typeof formula==='string'?compileFormula(formula).ast:formula.ast||formula,symbols=new Set();
  const visit=node=>{if(node.type==='symbol')symbols.add(node.symbol);if(node.type==='binary'){visit(node.left);visit(node.right);}else if(node.type==='call')node.args.forEach(visit);else if(node.value&&typeof node.value==='object')visit(node.value);};visit(ast);
  if(symbols.size>8)throw new Error('조건 하나에는 종목을 최대 8개까지 참조할 수 있습니다.');return [...symbols];
}
export function formulaMarketRequests(symbol,source,aliases={}){const frames=formulaTimeframes(source),names=formulaSymbols(source),pairs=[];for(const interval of frames.length?frames:['1m'])for(const target of new Set([symbol,...names.map(name=>aliases[name]||name)]))pairs.push({symbol:target,interval,key:target+'@'+interval});return pairs;}
export function applyWholeTimeframe(source,interval){
  if(!FORMULA_TIMEFRAMES.includes(interval))throw new Error('봉 주기를 확인하세요.');
  const text=source.trim();if(!text)throw new Error('먼저 수식을 입력하세요.');
  compileFormula(text);
  // Keep every history offset while assigning all data one frame.
  const unified=`(${text.replace(/@\s*\d+[mhdwM]/g,'')})@${interval}`;
  formulaTimeframes(unified);return unified;
}

const periodMinutes = { '1m':1,'3m':3,'5m':5,'15m':15,'30m':30,'1h':60,'4h':240,'1d':1440 };
export function ruleToFormula(rule, timeframe='15m', candle='closed') {
  if (rule.type==='group') return '('+rule.children.map(n=>ruleToFormula(n,timeframe,candle)).join(` ${rule.logic} `)+')';
  function metric(key,period,frame,offset,state) {
    let text=({close:'종가',open:'시가',high:'고가',low:'저가',volume:'거래량',profit:'수익률',sma:`SMA(종가, ${period})`,ema:`EMA(종가, ${period})`,rsi:`RSI(종가, ${period})`,bb_upper:`볼린저상단(종가, ${period}, 2)`,bb_lower:`볼린저하단(종가, ${period}, 2)`,atr:`ATR(${period})`})[key];
    if(offset)text+=`[${offset}]`;
    if(frame!==timeframe||state!==candle)text=`봉(${text}, ${periodMinutes[frame]}, ${state==='live'?1:0})`;
    return text;
  }
  const left=metric(rule.metric,rule.period,rule.timeframe,rule.offset,rule.candle);
  const right=rule.targetType==='value'?String(rule.value):metric(rule.targetMetric,rule.targetPeriod,rule.targetTimeframe,rule.targetOffset,rule.targetCandle);
  if(rule.operator==='cross_up'||rule.operator==='cross_down')return `${rule.operator==='cross_up'?'상향돌파':'하향돌파'}(${left}, ${right})`;
  return `${left} ${({gt:'>',gte:'>=',lt:'<',lte:'<=',eq:'='})[rule.operator]} ${right}`;
}
export function upgradeBot(bot) {
  if (bot.formula != null) return bot;
  const first=(node)=>node.type==='group'?first(node.children[0]):node;
  const leaf=first(bot.rules);
  const timeframe=leaf.timeframe||'15m',candle=leaf.candle||'closed';
  const upgraded={...bot,conditionMode:'formula',formula:ruleToFormula(bot.rules,timeframe,candle),formulaTimeframe:timeframe,formulaCandle:candle};
  try { compileFormula(upgraded.formula); }
  catch(error) { upgraded.conditionMode='legacy';upgraded.legacyMigrationError=error.message; }
  return upgraded;
}
