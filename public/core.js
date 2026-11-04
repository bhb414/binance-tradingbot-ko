import {randomId} from './id.js';
import { compileFormula, DEFAULT_FORMULA, formulaTimeframes, FORMULA_TIMEFRAMES } from './formula.js';
import { ACTIONS, isEntry, isStop } from './actions.js';
import { BUDGET_MODES,effectiveBudget,budgetIncluded,allocatedAmount } from './budget.js';
import {MAX_LEVERAGE} from './leverage.js';
import {protectionEnabled,hasProtection,protectionBasis,protectionPricePercent} from './protection.js';
export { BUDGET_MODES,effectiveBudget } from './budget.js';
export const DEMO_BALANCE = 5000;
export const SYMBOLS = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', short: 'BTC', price: 68432.8, change: 2.34, color: '#f6a54c', volume: '1.42B' },
  { symbol: 'ETHUSDT', name: 'Ethereum', short: 'ETH', price: 2486.42, change: 1.72, color: '#a5aef8', volume: '812.6M' },
  { symbol: 'SOLUSDT', name: 'Solana', short: 'SOL', price: 162.35, change: -0.86, color: '#b999f5', volume: '326.4M' },
  { symbol: 'BNBUSDT', name: 'BNB', short: 'BNB', price: 568.21, change: 0.92, color: '#f0ce69', volume: '189.2M' },
  { symbol: 'XRPUSDT', name: 'XRP', short: 'XRP', price: 0.5148, change: -1.24, color: '#aebdcc', volume: '98.5M' },
  { symbol: 'DOGEUSDT', name: 'Dogecoin', short: 'DOGE', price: 0.15821, change: 4.18, color: '#c6a857', volume: '245.1M' }
];
export const METRICS = { close: '종가', open: '시가', high: '고가', low: '저가', volume: '거래량', sma: '단순이동평균', ema: '지수이동평균', rsi: 'RSI', bb_upper: '볼린저 상단', bb_lower: '볼린저 하단', atr: 'ATR', profit: '포지션 수익률' };
export const OPERATORS = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', cross_up: '상향돌파', cross_down: '하향돌파' };
export const INTERVALS = FORMULA_TIMEFRAMES;
export const uid = () => randomId();
export const makeCondition = () => ({ id: uid(), type: 'condition', metric: 'close', period: 20, timeframe: '15m', offset: 0, candle: 'closed', operator: 'cross_up', targetType: 'metric', targetMetric: 'ema', targetPeriod: 20, targetTimeframe: '15m', targetOffset: 0, targetCandle: 'closed', value: 30 });
export const makeGroup = () => ({ id: uid(), type: 'group', logic: 'AND', children: [makeCondition()] });
export function makeBot(overrides = {}) {
  return { id: uid(), name: '새로운 봇', symbol: 'BTCUSDT', budget: 500, budgetMode:'fixed', entryPercent: 25, maxEntries: 0, leverage: 3, margin: 'ISOLATED', direction: 'LONG', status: 'paused', task: 'watching', color: 'mint', pnl: 0, used: 0, reserved: 0, conditionMode:'formula', formula:DEFAULT_FORMULA, formulaTimeframe:'15m', formulaCandle:'closed', rules: makeGroup(), order: { type: 'LIMIT', price: 'bid', ticks: 0, timeout: 15, remainder: 'cancel', postOnly: true }, reentry: { mode: 'rearm', cooldown: 60, afterExitCooldown:0 }, exit: { takeProfit: 3, stopLoss: 1.5, price: 'MARK_PRICE', basis:'price' }, ...overrides };
}
export function seedBots() {
  return [
    makeBot({ id: 'btc-trend', name: '비트 추세', budget: 1200, used: 300, leverage: 3, status: 'running', task: 'position', pnl: 24.8, color: 'mint' }),
    makeBot({ id: 'eth-momentum', name: '이더 모멘텀', symbol: 'ETHUSDT', budget: 900, leverage: 2, status: 'running', task: 'watching', color: 'lavender', pnl: 12.4 }),
    makeBot({ id: 'sol-pullback', name: '솔 눌림', symbol: 'SOLUSDT', budget: 500, leverage: 3, status: 'paused', task: 'watching', color: 'amber' })
  ];
}
export function allocations(bots) { const assigned = bots.filter(b=>!b.multiBotId).reduce((sum, b) => sum + allocatedAmount(b), 0); return { assigned, available: DEMO_BALANCE - assigned, used: bots.reduce((sum, b) => sum + Number(b.used || 0) + Number(b.reserved || 0), 0) }; }
export function validateBot(bot, bots = [], {balance=DEMO_BALANCE,symbols=SYMBOLS.map(s=>s.symbol),maxLeverage=125,enforceAllocationLimit=true}={}) {
  const errors = [];
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  if (!bot.name?.trim() || bot.name.trim().length > 32) errors.push('봇 이름을 1~32자로 입력해 주세요.');
  if (!symbols.includes(bot.symbol)) errors.push('지원하는 종목을 선택해 주세요.');
  if (!finite(bot.budget) || bot.budget < 10) errors.push('운용 예산은 10 USDT 이상이어야 합니다.');
  if (bot.budgetIncluded!==undefined&&typeof bot.budgetIncluded!=='boolean') errors.push('운용예산 포함 여부를 확인해 주세요.');
  if (!Object.hasOwn(BUDGET_MODES,bot.budgetMode||'fixed')) errors.push('예산의 손익 반영 방식을 확인해 주세요.');
  if (enforceAllocationLimit && budgetIncluded(bot) && finite(bot.budget) && bots.filter(b => !b.multiBotId && b.id !== bot.id).reduce((s,b) => s + allocatedAmount(b), 0) + effectiveBudget(bot) > balance) errors.push('봇들의 배정 예산 합계가 계좌 잔고 한도를 초과합니다.');
  if (!finite(bot.entryPercent) || bot.entryPercent <= 0 || bot.entryPercent > 100) errors.push('1회 진입 비율은 0보다 크고 100% 이하여야 합니다.');
  if (!Number.isInteger(bot.maxEntries) || bot.maxEntries < 0 || bot.maxEntries > 20) errors.push('포지션당 진입 횟수는 제한 없음 또는 1~20회로 설정해 주세요.');
  if(maxLeverage<1)errors.push('배정 예산이 종목의 명목 한도를 초과합니다. 예산을 줄여 주세요.');
  else if (!Number.isInteger(bot.leverage) || bot.leverage < 1 || bot.leverage > (bot.actionRules?MAX_LEVERAGE:maxLeverage)) errors.push(`레버리지 설정 범위는 1~${bot.actionRules?MAX_LEVERAGE:maxLeverage}배입니다.`);
  if (!['ISOLATED','CROSSED'].includes(bot.margin)) errors.push('증거금 모드를 확인해 주세요.');
  if (!bot.actionRules&&!['LONG','SHORT'].includes(bot.direction)) errors.push('진입 방향을 확인해 주세요.');
  if (!['MARKET','LIMIT'].includes(bot.order?.type)) errors.push('주문 방식을 확인해 주세요.');
  if (!['bid','ask','last'].includes(bot.order?.price)) errors.push('가격 기준을 확인해 주세요.');
  if (!Number.isInteger(bot.order?.ticks) || Math.abs(bot.order.ticks) > 100) errors.push('가격 조정은 -100~100틱으로 입력해 주세요.');
  if (!finite(bot.order?.timeout) || bot.order.timeout < 1 || bot.order.timeout > 3600) errors.push('체결 대기시간은 1~3,600초로 입력해 주세요.');
  if (!['cancel','market'].includes(bot.order?.remainder)) errors.push('미체결 잔량 처리 방식을 확인해 주세요.');
  if (!['rearm','bar','cooldown'].includes(bot.reentry?.mode) || !finite(bot.reentry?.cooldown) || bot.reentry.cooldown < 0 || bot.reentry.cooldown > 86400) errors.push('재진입 설정을 확인해 주세요.');
  for(const [kind,label] of [['takeProfit','익절'],['stopLoss','손절']]){
    const enabled=bot.exit?.[kind+'Enabled'];if(enabled!==undefined&&typeof enabled!=='boolean')errors.push(label+' 사용 여부를 확인해 주세요.');
    if(protectionEnabled(bot.exit,kind)&&(!finite(bot.exit?.[kind])||bot.exit[kind]<=0||bot.exit[kind]>1000))errors.push('사용하는 '+label+' 기준을 0보다 크고 1,000% 이하로 입력해 주세요.');
  }
  if(!['price','leveraged'].includes(protectionBasis(bot.exit)))errors.push('TP·SL 계산 기준을 확인해 주세요.');
  const entries=Array.isArray(bot.actionRules)?bot.actionRules.filter(r=>r?.enabled&&isEntry(r.action)):[{action:'ENTER_'+bot.direction,leverage:bot.leverage}];
  if(hasProtection(bot.exit)&&['price','leveraged'].includes(protectionBasis(bot.exit)))for(const entry of entries){try{const leverage=bot.runtime?.quantity>0?bot.leverage:entry.leverage??bot.leverage;
    if(entry.action==='ENTER_LONG'&&protectionEnabled(bot.exit,'stopLoss')&&protectionPricePercent(bot.exit,'stopLoss',leverage)>=100||entry.action==='ENTER_SHORT'&&protectionEnabled(bot.exit,'takeProfit')&&protectionPricePercent(bot.exit,'takeProfit',leverage)>=100)errors.push('청산 목표 가격이 0 이하가 되지 않도록 비율을 설정해 주세요.');
  }catch(error){errors.push(error.message);}}
  if (hasProtection(bot.exit)&&!['MARK_PRICE','CONTRACT_PRICE'].includes(bot.exit?.price)) errors.push('청산 조건 가격 기준을 확인해 주세요.');
  let count = 0;
  function inspect(node, depth = 0) {
    if (++count > 40 || depth > 3) { errors.push('조건은 40개 항목, 그룹은 3단계까지 설정할 수 있습니다.'); return; }
    if (node?.type === 'group') {
      if (!['AND','OR'].includes(node.logic) || !Array.isArray(node.children) || !node.children.length) { errors.push('조건 그룹에 조건을 하나 이상 넣어 주세요.'); return; }
      node.children.forEach(child => inspect(child, depth + 1));
    } else if (node?.type === 'condition') {
      if (!(node.metric in METRICS) || !(node.operator in OPERATORS) || !INTERVALS.includes(node.timeframe) || !['closed','live'].includes(node.candle)) errors.push('분석 조건의 지표·비교·봉 설정을 확인해 주세요.');
      if (!Number.isInteger(node.period) || node.period < 1 || node.period > 500 || !Number.isInteger(node.offset) || node.offset < 0 || node.offset > 100) errors.push('지표 기간은 1~500, 봉 위치는 0~100으로 입력해 주세요.');
      if (node.targetType === 'value') { if (!finite(node.value)) errors.push('비교할 숫자를 입력해 주세요.'); }
      else if (node.targetType === 'metric') {
        if (!(node.targetMetric in METRICS) || !Number.isInteger(node.targetPeriod) || node.targetPeriod < 1 || node.targetPeriod > 500 || !INTERVALS.includes(node.targetTimeframe) || !Number.isInteger(node.targetOffset) || node.targetOffset < 0 || node.targetOffset > 100 || !['closed','live'].includes(node.targetCandle)) errors.push('오른쪽 지표 설정을 확인해 주세요.');
        if (node.operator.startsWith('cross') && (node.timeframe !== node.targetTimeframe || node.candle !== node.targetCandle)) errors.push('돌파 비교의 양쪽 봉 주기와 봉 상태를 같게 설정해 주세요.');
      } else errors.push('비교 대상을 확인해 주세요.');
    } else errors.push('조건 형식을 확인해 주세요.');
  }
  if(bot.actionRules) {
    if(!Array.isArray(bot.actionRules)||bot.actionRules.length<1||bot.actionRules.length>20)errors.push('조건·행동은 1~20개로 설정해 주세요.');
    else {
      if(!bot.actionRules.some(r=>r?.enabled))errors.push('실행할 조건·행동을 하나 이상 켜 주세요.');
      const ids=new Set();
      for(const [index,r] of bot.actionRules.entries()){
        const prefix=`조건 ${index+1}: `;
        if(!r||typeof r!=='object'){errors.push(prefix+'조건 형식을 확인해 주세요.');continue;}
        if(typeof r.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(r.id)||ids.has(r.id))errors.push(prefix+'고유 식별자가 필요합니다.');ids.add(r.id);
        if(typeof r.enabled!=='boolean'||!Object.hasOwn(ACTIONS,r.action))errors.push(prefix+'실행 행동을 확인해 주세요.');
        if(r.closeScope!==undefined&&!['bot','account'].includes(r.closeScope))errors.push(prefix+'정리 대상을 확인해 주세요.');
        if(r.formulaVersion!==2)errors.push(prefix+'이전 조건을 새 봉 주기 문법으로 변환해 주세요.');
        if(isEntry(r.action)&&(!Number.isInteger(r.leverage)||r.leverage<1||r.leverage>(r.enabled?maxLeverage:MAX_LEVERAGE)))errors.push(prefix+`진입 레버리지는 1~${r.enabled?maxLeverage:MAX_LEVERAGE}배로 설정해 주세요.`);
        if(!isStop(r.action)&&(!finite(r.sizePercent)||r.sizePercent<=0||r.sizePercent>100))errors.push(prefix+'주문 비율은 0보다 크고 100% 이하여야 합니다.');
        if(r.action==='CLOSE_ALL'&&r.sizePercent!==100)errors.push(prefix+'전체 정리는 보유 수량의 100%로 설정해 주세요.');
        if(!isStop(r.action)&&(!['MARKET','LIMIT'].includes(r.order?.type)||!['bid','ask','last'].includes(r.order?.price)||!Number.isInteger(r.order?.ticks)||Math.abs(r.order.ticks)>100||!finite(r.order?.timeout)||r.order.timeout<1||r.order.timeout>3600||!['cancel','market'].includes(r.order?.remainder)||typeof r.order?.postOnly!=='boolean'))errors.push(prefix+'주문 방식을 확인해 주세요.');
        if(!isStop(r.action)&&(!['rearm','bar','cooldown'].includes(r.reentry?.mode)||!finite(r.reentry?.cooldown)||r.reentry.cooldown<0||r.reentry.cooldown>86400))errors.push(prefix+'중복 실행 방지 설정을 확인해 주세요.');
        if(isEntry(r.action)&&(!finite(r.reentry?.afterExitCooldown)||r.reentry.afterExitCooldown<0||r.reentry.afterExitCooldown>86400))errors.push(prefix+'전량 정리 후 진입 대기는 0~86,400초로 설정해 주세요.');
        if(r.enabled||r.formula){try{formulaTimeframes(r.formula);}catch(error){errors.push(prefix+error.message);}}
      }
    }
  } else if(bot.conditionMode==='formula') {
    if(!INTERVALS.includes(bot.formulaTimeframe)||!['closed','live'].includes(bot.formulaCandle))errors.push('수식의 봉 주기와 봉 상태를 확인해 주세요.');
    try { compileFormula(bot.formula); } catch(error) { errors.push(error.message); }
  } else inspect(bot.rules);
  return [...new Set(errors)];
}
export function startErrors(bot, bots) {
  const errors = validateBot(bot, bots);
  if (bots.some(b => b.id !== bot.id && b.symbol === bot.symbol && b.status === 'running' && (b.margin !== bot.margin || b.leverage !== bot.leverage))) errors.push('같은 종목에서 실행 중인 봇과 증거금 모드 또는 레버리지가 충돌합니다.');
  return errors;
}
export function budgetUsage(bot){
  const inPositions=Math.max(0,Number(bot.used)||0),pending=Math.max(0,Number(bot.reserved)||0),committed=inPositions+pending;
  const limit=effectiveBudget(bot);
  return {inPositions,pending,available:Math.max(0,limit-committed),overBudget:Math.max(0,committed-limit)};
}
export function positionMargin(position,leverage,margin){
  if(!position||!Math.abs(Number(position.quantity)||0))return 0;
  if(margin==='ISOLATED'&&Number(position.isolatedMargin)>0)return Number(position.isolatedMargin);
  if(Number(position.initialMargin)>0)return Number(position.initialMargin);
  return Math.abs(Number(position.quantity))*(Number(position.markPrice)||Number(position.entryPrice)||0)/Math.max(1,Number(leverage)||1);
}
export function describeRule(node) {
  if (node.type === 'group') return '(' + node.children.map(describeRule).join(` ${node.logic} `) + ')';
  const metric = (key,period,tf,offset,candle) => `${tf} ${candle === 'closed' ? '완성봉' : '진행봉'} ${METRICS[key]}${['sma','ema','rsi','atr','bb_upper','bb_lower'].includes(key) ? `(${period})` : ''}${offset ? ` ${offset}봉 전` : ''}`;
  return `${metric(node.metric,node.period,node.timeframe,node.offset,node.candle)} ${OPERATORS[node.operator]} ${node.targetType === 'value' ? node.value : metric(node.targetMetric,node.targetPeriod,node.targetTimeframe,node.targetOffset,node.targetCandle)}`;
}
export function makeCandles(symbol, interval = '15m') {
  const info = SYMBOLS.find(s => s.symbol === symbol) || SYMBOLS[0];
  const seconds = { '1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1d':86400 }[interval] || 900;
  let seed = symbol.split('').reduce((s,c)=>s+c.charCodeAt(0),0) + seconds;
  const random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed/4294967296; };
  const end = Math.floor(Date.UTC(2026,10,2,12,0,0)/1000/seconds)*seconds;
  const data = [];
  let prev = info.price * .974;
  for (let i=0;i<260;i++) {
    const open = prev;
    const close = Math.max(info.price * .5,open + (random()-.46)*info.price*.0027 + Math.sin(i*.095)*info.price*.00045);
    data.push({time:end-(259-i)*seconds,open,high:Math.max(open,close)+random()*info.price*.0011,low:Math.min(open,close)-random()*info.price*.0011,close,volume:random()*900+120});
    prev=close;
  }
  const ratio=info.price/data.at(-1).close;
  return data.map(c=>({...c,open:c.open*ratio,high:c.high*ratio,low:c.low*ratio,close:c.close*ratio}));
}
export function movingAverage(data,period) { return data.flatMap((c,i)=>i < period-1 ? [] : [{time:c.time,value:data.slice(i-period+1,i+1).reduce((sum,x)=>sum+x.close,0)/period}]); }
