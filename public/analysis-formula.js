// Adapted from the user's 2026-10-27 analysis formula engine.
// Deliberately parses expressions; never executes JavaScript from input.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AnalysisFormula = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_SOURCE_LENGTH = 1000;
  const MAX_TOKENS = 600;
  const MAX_DEPTH = 80;
  const MAX_WINDOW = 500;
  const timeframes = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'];
  const identifierStart = char => !!char && /[A-Za-z_\u3131-\uD79D]/.test(char);
  const identifierPart = char => !!char && /[A-Za-z0-9_\u3131-\uD79D]/.test(char);

  class FormulaError extends Error {
    constructor(message, position) {
      super(position == null ? message : `${message} (${position + 1}번째 글자)`);
      this.name = 'FormulaError';
      this.position = position;
    }
  }

  function tokenize(source) {
    if (typeof source !== 'string' || !source.trim()) throw new FormulaError('조건식을 입력하세요', 0);
    if (source.length > MAX_SOURCE_LENGTH) throw new FormulaError(`조건식은 ${MAX_SOURCE_LENGTH}자 이하여야 합니다`, MAX_SOURCE_LENGTH);
    const tokens = [];
    let index = 0;
    const push = (type, value, position = index) => {
      tokens.push({ type, value, position });
      if (tokens.length > MAX_TOKENS) throw new FormulaError('조건식이 너무 복잡합니다', position);
    };
    while (index < source.length) {
      const char = source[index];
      if (/\s/.test(char)) { index += 1; continue; }
      const position = index;
      const pair = source.slice(index, index + 2);
      if (['>=', '<=', '==', '!=', '&&', '||'].includes(pair)) {
        push('op', pair, position); index += 2; continue;
      }
      const singleMap = { '×': '*', '÷': '/', '≥': '>=', '≤': '<=', '≠': '!=', '＝': '=', '％': '%' };
      if ('+-*/%><=!,()[]:@'.includes(char) || singleMap[char]) {
        const value = singleMap[char] || char;
        const type = char === '@' ? 'at' : char === '(' ? 'lparen' : char === ')' ? 'rparen' : char === '[' ? 'lbracket' : char === ']' ? 'rbracket' : char === ',' ? 'comma' : char === ':' ? 'colon' : 'op';
        push(type, value, position); index += 1; continue;
      }
      if (/\d/.test(char) || (char === '.' && /\d/.test(source[index + 1] || ''))) {
        let end = index;
        while (/\d/.test(source[end] || '')) end += 1;
        if (source[end] === '.') {
          end += 1;
          while (/\d/.test(source[end] || '')) end += 1;
        }
        if (/[eE]/.test(source[end] || '')) {
          let exponentEnd = end + 1;
          if (/[+-]/.test(source[exponentEnd] || '')) exponentEnd += 1;
          const exponentStart = exponentEnd;
          while (/\d/.test(source[exponentEnd] || '')) exponentEnd += 1;
          if (exponentEnd === exponentStart) throw new FormulaError('숫자의 지수 표기가 올바르지 않습니다', end);
          end = exponentEnd;
        }
        if (identifierStart(source[end])) {
          while (identifierPart(source[end])) end += 1;
          push('id', source.slice(index, end), position); index = end; continue;
        }
        const value = Number(source.slice(index, end));
        if (!Number.isFinite(value)) throw new FormulaError('숫자가 올바르지 않습니다', position);
        push('number', value, position); index = end; continue;
      }
      if (identifierStart(char)) {
        let end = index + 1;
        while (identifierPart(source[end])) end += 1;
        const raw = source.slice(index, end);
        const upper = raw.toUpperCase();
        if (upper === 'AND' || raw === '그리고') push('op', '&&', position);
        else if (upper === 'OR' || raw === '또는') push('op', '||', position);
        else if (upper === 'NOT' || raw === '아님') push('op', '!', position);
        else if (upper === 'TRUE' || raw === '참') push('number', 1, position);
        else if (upper === 'FALSE' || raw === '거짓') push('number', 0, position);
        else push('id', raw, position);
        index = end; continue;
      }
      throw new FormulaError(`사용할 수 없는 문자 '${char}'입니다`, position);
    }
    push('eof', '', source.length);
    return tokens;
  }

  class Parser {
    constructor(tokens) { this.tokens = tokens; this.index = 0; this.depth = 0; }
    current() { return this.tokens[this.index]; }
    take(type, value) {
      const token = this.current();
      if (token.type !== type || (value != null && token.value !== value)) return null;
      this.index += 1; return token;
    }
    expect(type, value, message) {
      const token = this.take(type, value);
      if (!token) throw new FormulaError(message, this.current().position);
      return token;
    }
    nested(callback) {
      this.depth += 1;
      if (this.depth > MAX_DEPTH) throw new FormulaError('괄호나 함수 중첩이 너무 깊습니다', this.current().position);
      try { return callback(); } finally { this.depth -= 1; }
    }
    parse() {
      const expression = this.parseOr();
      this.expect('eof', null, '조건식 뒤에 해석할 수 없는 내용이 있습니다');
      return expression;
    }
    parseOr() { return this.parseBinary(() => this.parseAnd(), ['||']); }
    parseAnd() { return this.parseBinary(() => this.parseCompare(), ['&&']); }
    parseCompare() { return this.parseBinary(() => this.parseAdd(), ['>', '>=', '<', '<=', '=', '==', '!=']); }
    parseAdd() { return this.parseBinary(() => this.parseMultiply(), ['+', '-']); }
    parseMultiply() { return this.parseBinary(() => this.parseUnary(), ['*', '/', '%']); }
    parseBinary(next, operators) {
      let left = next();
      while (this.current().type === 'op' && operators.includes(this.current().value)) {
        const operator = this.current(); this.index += 1;
        left = { type: 'binary', operator: operator.value, left, right: next(), position: operator.position };
      }
      return left;
    }
    parseUnary() {
      const token = this.current();
      if (token.type === 'op' && ['+', '-', '!'].includes(token.value)) {
        this.index += 1;
        return { type: 'unary', operator: token.value, value: this.parseUnary(), position: token.position };
      }
      return this.parsePostfix();
    }
    parsePostfix() {
      let value = this.parsePrimary();
      while (this.current().type==='at'||this.current().type==='lbracket') {
        if(this.take('at')){
          const frame=this.expect('id',null,'@ 뒤에 5m, 1h 같은 봉 주기를 입력하세요');
          if(!timeframes.includes(frame.value))throw new FormulaError('지원하는 봉 주기: '+timeframes.join(', '),frame.position);
          value={type:'timeframe',value,interval:frame.value,position:frame.position};continue;
        }
        this.take('lbracket');
        // A suffix after @ shifts bars in that frame, never bars of an outer feed.
        const framed=value.type==='timeframe'?value:null,subject=framed?framed.value:value;
        const lag = this.expect('number', null, '대괄호에는 과거 봉 수를 숫자로 입력하세요');
        if (!Number.isInteger(lag.value) || lag.value < 0 || lag.value > MAX_WINDOW) {
          throw new FormulaError(`과거 봉 수는 0~${MAX_WINDOW} 정수여야 합니다`, lag.position);
        }
        if(this.take('colon')){
          const end=this.expect('number',null,'구간 끝 봉 번호를 숫자로 입력하세요');
          if(!Number.isInteger(end.value)||end.value<=lag.value||end.value>MAX_WINDOW+1||end.value-lag.value>MAX_WINDOW)throw new FormulaError(`구간은 시작보다 큰 끝 번호를 쓰고 최대 ${MAX_WINDOW}봉까지 지정하세요 (끝 번호 제외)`,end.position);
          this.expect('rbracket',null,"구간 끝 번호 뒤에 ']'가 필요합니다");
          value={type:'range',value:subject,start:lag.value,end:end.value,position:lag.position};
        }else{
          this.expect('rbracket', null, "과거 봉 수 뒤에 ']'가 필요합니다");
          value = { type: 'lag', value:subject, lag: lag.value, position: lag.position };
        }
        if(framed)value={...framed,value};
      }
      return value;
    }
    parsePrimary() {
      const number = this.take('number');
      if (number) return { type: 'number', value: number.value, position: number.position };
      const identifier = this.take('id');
      if (identifier) {
        if (!this.take('lparen')) return { type: 'variable', name: identifier.value, position: identifier.position };
        const args = [];
        if (!this.take('rparen')) {
          do { args.push(this.nested(() => this.parseOr())); } while (this.take('comma'));
          this.expect('rparen', null, "함수 인수 뒤에 ')'가 필요합니다");
        }
        return { type: 'call', name: identifier.value, args, position: identifier.position };
      }
      if (this.take('lparen')) {
        const value = this.nested(() => this.parseOr());
        this.expect('rparen', null, "괄호를 닫는 ')'가 필요합니다");
        return value;
      }
      throw new FormulaError('숫자, 데이터 또는 괄호가 필요합니다', this.current().position);
    }
  }

  function normalizeName(value) { return String(value).replace(/\s+/g, '').toLowerCase(); }
  const variableAliases = {
    '종가': 'close', 'close': 'close',
    '시가': 'open', 'open': 'open',
    '고가': 'high', 'high': 'high',
    '저가': 'low', 'low': 'low',
    '거래량': 'volume', 'volume': 'volume',
    '5일선': 'sma5', '이평5': 'sma5', 'sma5': 'sma5',
    '20일선': 'sma20', '이평20': 'sma20', 'sma20': 'sma20',
    '60일선': 'sma60', '이평60': 'sma60', 'sma60': 'sma60',
    '평균매수가': 'averagePrice', '진입가': 'averagePrice', 'averageprice': 'averagePrice',
    '수익률': 'profit', 'profit': 'profit', '포지션수익률': 'profit',
    '하이킨시가': 'heikinOpen', '하이킨아시시가': 'heikinOpen', 'heikinopen': 'heikinOpen',
    '하이킨고가': 'heikinHigh', '하이킨아시고가': 'heikinHigh', 'heikinhigh': 'heikinHigh',
    '하이킨저가': 'heikinLow', '하이킨아시저가': 'heikinLow', 'heikinlow': 'heikinLow',
    '하이킨종가': 'heikinClose', '하이킨아시종가': 'heikinClose', 'heikinclose': 'heikinClose',
  };
  const functionAliases = {
    'abs': 'abs', '절대값': 'abs',
    'min': 'min', '최소': 'min', 'max': 'max', '최대': 'max',
    'sma': 'sma', '평균': 'sma', '이평': 'sma',
    'ema': 'ema', '지수이평': 'ema', 'rsi': 'rsi',
    '봉': 'frame', 'frame': 'frame',
    'stdev': 'stdev', '표준편차': 'stdev',
    'change': 'change', '증감': 'change',
    'changepct': 'changePct', '변화율': 'changePct',
    'crossup': 'crossUp', '상향돌파': 'crossUp',
    'crossdown': 'crossDown', '하향돌파': 'crossDown',
    'between': 'between', '범위내': 'between',
    'bbupper': 'bbUpper', '볼린저상단': 'bbUpper',
    'bbmiddle': 'bbMiddle', '볼린저중심': 'bbMiddle',
    'bblower': 'bbLower', '볼린저하단': 'bbLower',
    'atr': 'atr', '에이티알': 'atr',
  };

  function resolveVariable(name) {
    const normalized = normalizeName(name);
    const key = Object.prototype.hasOwnProperty.call(variableAliases, normalized) ? variableAliases[normalized] : null;
    if (!key) throw new FormulaError(`알 수 없는 데이터 '${name}'입니다`);
    return key;
  }
  function resolveFunction(name) {
    const normalized = normalizeName(name);
    const key = Object.prototype.hasOwnProperty.call(functionAliases, normalized) ? functionAliases[normalized] : null;
    if (!key) throw new FormulaError(`알 수 없는 함수 '${name}'입니다`);
    return key;
  }
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const truthy = value => finite(value) && Number(value) !== 0;

  function validateAst(node) {
    if (node.type === 'variable') resolveVariable(node.name);
    if (node.type === 'call') {
      const name = resolveFunction(node.name);
      const arity = { abs: [1], min: [2], max: [2], sma: [2], ema: [2], rsi: [2], frame: [3], stdev: [2], change: [2], changePct: [2], crossUp: [2], crossDown: [2], between: [3], bbUpper: [3], bbMiddle: [2, 3], bbLower: [3], atr: [1] }[name];
      if (!arity.includes(node.args.length)) throw new FormulaError(`${node.name} 함수의 인수 개수가 맞지 않습니다`, node.position);
      if (['sma','ema','rsi','stdev','bbUpper','bbMiddle','bbLower'].includes(name)) {
        const period=node.args[1];
        if (period.type!=='number'||!Number.isInteger(period.value)||period.value<1||period.value>MAX_WINDOW) throw new FormulaError(`지표 기간은 1~${MAX_WINDOW} 정수로 입력하세요`, period.position);
      }
      if (name==='atr' && (node.args[0].type!=='number'||!Number.isInteger(node.args[0].value)||node.args[0].value<1||node.args[0].value>MAX_WINDOW)) throw new FormulaError('ATR 기간을 1~500 정수로 입력하세요',node.position);
      if (name==='frame' && (node.args[1].type!=='number'||![1,3,5,15,30,60,240,1440].includes(node.args[1].value)||node.args[2].type!=='number'||![0,1].includes(node.args[2].value))) throw new FormulaError('봉(수식, 주기 분, 봉상태 0 또는 1) 형식을 확인하세요',node.position);
      node.args.forEach(validateAst);
    }
    if (node.type === 'binary') { validateAst(node.left); validateAst(node.right); }
    if (node.type === 'unary' || node.type === 'lag' || node.type === 'range' || node.type==='timeframe') validateAst(node.value);
  }

  function readWindowPeriod(node, context, index, fallback) {
    const value = evaluateNode(node, context, index);
    const period = Math.round(Number(value));
    if (!Number.isFinite(period) || period < 1 || period > MAX_WINDOW) return fallback;
    return period;
  }

  function rolling(node, context, index, period, mode) {
    if (index - period + 1 < 0) return null;
    const values = [];
    for (let offset = period - 1; offset >= 0; offset -= 1) {
      const value = evaluateNode(node, context, index - offset);
      if (!finite(value)) return null;
      values.push(Number(value));
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (mode === 'mean') return mean;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  }

  function wilderAtr(context, index, period) {
    const high = context.series.high, low = context.series.low, close = context.series.close;
    if (!Array.isArray(high) || !Array.isArray(low) || !Array.isArray(close)) return null;
    const cacheKey = `atr:${period}`;
    if (!context.indicatorCache.has(cacheKey)) {
      const length = Math.min(context.length, high.length, low.length, close.length);
      const values = Array(length).fill(null);
      const seed = [];
      let previousClose = null, average = null;
      for (let offset = 0; offset < length; offset += 1) {
        const currentHigh = high[offset], currentLow = low[offset], currentClose = close[offset];
        if (![currentHigh, currentLow, currentClose].every(finite)) {
          seed.length = 0;
          previousClose = null;
          average = null;
          continue;
        }
        const trueRange = previousClose == null
          ? Number(currentHigh) - Number(currentLow)
          : Math.max(
            Number(currentHigh) - Number(currentLow),
            Math.abs(Number(currentHigh) - Number(previousClose)),
            Math.abs(Number(currentLow) - Number(previousClose)),
          );
        previousClose = Number(currentClose);
        if (average == null) {
          seed.push(trueRange);
          if (seed.length < period) continue;
          average = seed.reduce((sum, value) => sum + value, 0) / period;
        } else {
          average = (average * (period - 1) + trueRange) / period;
        }
        values[offset] = average;
      }
      context.indicatorCache.set(cacheKey, values);
    }
    return context.indicatorCache.get(cacheKey)[index] ?? null;
  }

  function evaluateCall(node, context, index) {
    const name = resolveFunction(node.name);
    // Explicit frame wrappers preserve previously saved mixed-timeframe rules.
    // They are syntax-checked and saved, but the single-frame demo reports missing data.
    if (name === 'frame') return null;
    if (name === 'ema' || name === 'rsi') {
      const period = readWindowPeriod(node.args[1],context,index,0);
      if (!period) return null;
      const cacheKey = `${name}:${JSON.stringify(node.args[0])}:${period}`;
      if (!context.indicatorCache.has(cacheKey)) {
        const values=Array(context.length).fill(null); let previous=null, average=null, gain=0, loss=0, seed=[];
        for (let i=0;i<context.length;i++) {
          const value=evaluateNode(node.args[0],context,i);
          if (!finite(value)) { previous=null;average=null;gain=0;loss=0;seed=[];continue; }
          if (name==='ema') {
            if (average==null) { seed.push(value);if(seed.length<period)continue;average=seed.reduce((s,v)=>s+v,0)/period; }
            else average=value*(2/(period+1))+average*(1-2/(period+1));
            values[i]=average;
          } else {
            if (previous==null) { previous=value;continue; }
            const delta=value-previous;previous=value;
            if (seed.length<period) { seed.push(delta);gain+=Math.max(0,delta);loss+=Math.max(0,-delta);if(seed.length<period)continue;gain/=period;loss/=period; }
            else { gain=(gain*(period-1)+Math.max(0,delta))/period;loss=(loss*(period-1)+Math.max(0,-delta))/period; }
            values[i]=gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
          }
        }
        context.indicatorCache.set(cacheKey,values);
      }
      return context.indicatorCache.get(cacheKey)[index] ?? null;
    }
    if (name === 'abs') { const value = evaluateNode(node.args[0], context, index); return finite(value) ? Math.abs(Number(value)) : null; }
    if (name === 'min' || name === 'max') {
      const values = node.args.map(arg => evaluateNode(arg, context, index));
      if (!values.every(finite)) return null;
      return name === 'min' ? Math.min(...values.map(Number)) : Math.max(...values.map(Number));
    }
    if (name === 'sma' || name === 'stdev') {
      const period = readWindowPeriod(node.args[1], context, index, 0);
      return period ? rolling(node.args[0], context, index, period, name === 'sma' ? 'mean' : 'stdev') : null;
    }
    if (name === 'change' || name === 'changePct') {
      const period = readWindowPeriod(node.args[1], context, index, 0);
      if (!period || index - period < 0) return null;
      const current = evaluateNode(node.args[0], context, index), previous = evaluateNode(node.args[0], context, index - period);
      if (![current, previous].every(finite)) return null;
      if (name === 'change') return Number(current) - Number(previous);
      return Number(previous) === 0 ? null : (Number(current) / Number(previous) - 1) * 100;
    }
    if (name === 'crossUp' || name === 'crossDown') {
      if (index < 1) return null;
      const currentA = evaluateNode(node.args[0], context, index), currentB = evaluateNode(node.args[1], context, index);
      const previousA = evaluateNode(node.args[0], context, index - 1), previousB = evaluateNode(node.args[1], context, index - 1);
      if (![currentA, currentB, previousA, previousB].every(finite)) return null;
      return name === 'crossUp'
        ? Number(previousA) <= Number(previousB) && Number(currentA) > Number(currentB) ? 1 : 0
        : Number(previousA) >= Number(previousB) && Number(currentA) < Number(currentB) ? 1 : 0;
    }
    if (name === 'between') {
      const values = node.args.map(arg => evaluateNode(arg, context, index));
      if (!values.every(finite)) return null;
      return Number(values[0]) >= Number(values[1]) && Number(values[0]) <= Number(values[2]) ? 1 : 0;
    }
    if (name === 'bbUpper' || name === 'bbMiddle' || name === 'bbLower') {
      const period = readWindowPeriod(node.args[1], context, index, 0);
      if (!period) return null;
      const mean = rolling(node.args[0], context, index, period, 'mean');
      if (!finite(mean) || name === 'bbMiddle') return mean;
      const deviation = rolling(node.args[0], context, index, period, 'stdev');
      const multiple = evaluateNode(node.args[2], context, index);
      if (![deviation, multiple].every(finite)) return null;
      return name === 'bbUpper' ? Number(mean) + Number(multiple) * Number(deviation) : Number(mean) - Number(multiple) * Number(deviation);
    }
    if (name === 'atr') {
      const period = readWindowPeriod(node.args[0], context, index, 0);
      return period ? wilderAtr(context, index, period) : null;
    }
    return null;
  }

  function evaluateNode(node, context, index) {
    context.steps += 1;
    if (context.steps > context.maxSteps) throw new FormulaError('조건식 계산량이 너무 큽니다');
    if (index < 0 || index >= context.length) return null;
    if (node.type === 'number') return node.value;
    if(node.type==='timeframe'){
      const feed=context.frames?.[node.interval];
      if(!feed)return null;
      if(!context.frameContexts.has(node.interval))context.frameContexts.set(node.interval,makeContext(feed,{maxSteps:context.maxSteps,frames:context.frames},context.budget));
      const target=context.frameContexts.get(node.interval);
      return evaluateNode(node.value,target,target.length-1);
    }
    if (node.type === 'variable') {
      const series = context.series[resolveVariable(node.name)];
      return series ? series[index] : null;
    }
    if (node.type === 'lag') return evaluateNode(node.value, context, index - node.lag);
    if(node.type==='range'){
      let sum=0;for(let offset=node.start;offset<node.end;offset++){const value=evaluateNode(node.value,context,index-offset);if(!finite(value))return null;sum+=value;}return sum;
    }
    if (node.type === 'unary') {
      const value = evaluateNode(node.value, context, index);
      if (node.operator === '!') return !finite(value) ? null : truthy(value) ? 0 : 1;
      if (!finite(value)) return null;
      return node.operator === '-' ? -Number(value) : Number(value);
    }
    if (node.type === 'binary') {
      if (node.operator === '&&') {
        const left = evaluateNode(node.left, context, index);
        if (finite(left) && !truthy(left)) return 0;
        const right=evaluateNode(node.right,context,index);
        if (finite(right) && !truthy(right)) return 0;
        return finite(left) && finite(right) ? 1 : null;
      }
      if (node.operator === '||') {
        const left = evaluateNode(node.left, context, index);
        if (truthy(left)) return 1;
        const right=evaluateNode(node.right,context,index);
        if (truthy(right)) return 1;
        return finite(left) && finite(right) ? 0 : null;
      }
      const left = evaluateNode(node.left, context, index), right = evaluateNode(node.right, context, index);
      if (![left, right].every(finite)) return null;
      const a = Number(left), b = Number(right);
      if (node.operator === '+') return a + b;
      if (node.operator === '-') return a - b;
      if (node.operator === '*') return a * b;
      if (node.operator === '/') return b === 0 ? null : a / b;
      if (node.operator === '%') return b === 0 ? null : a % b;
      if (node.operator === '>') return a > b ? 1 : 0;
      if (node.operator === '>=') return a >= b ? 1 : 0;
      if (node.operator === '<') return a < b ? 1 : 0;
      if (node.operator === '<=') return a <= b ? 1 : 0;
      if (node.operator === '=' || node.operator === '==') return a === b ? 1 : 0;
      if (node.operator === '!=') return a !== b ? 1 : 0;
    }
    if (node.type === 'call') return evaluateCall(node, context, index);
    return null;
  }

  function makeContext(series,options={},budget={steps:0}){
    const context={series,length:Number(options.length??Object.values(series)[0]?.length??0),maxSteps:Number(options.maxSteps||20000),indicatorCache:new Map(),frames:options.frames,frameContexts:new Map(),budget};
    Object.defineProperty(context,'steps',{get:()=>budget.steps,set:value=>{budget.steps=value;}});
    return context;
  }
  function compile(source) {
    const ast = new Parser(tokenize(source)).parse();
    validateAst(ast);
    return {
      source,
      ast,
      evaluate(series, index, options = {}) {
        const context = makeContext(series,options);
        try {
          const value = evaluateNode(ast, context, index);
          return { ok: true, value, pass: truthy(value), missing: value == null || !finite(value), steps: context.steps };
        } catch (error) {
          return { ok: false, value: null, pass: false, missing: false, error: error.message, steps: context.steps };
        }
      },
      evaluateSeries(series, options = {}) {
        const length=Number(options.length??Object.values(series)[0]?.length??0);
        if(!Number.isInteger(length)||length<0||length>5000)return {ok:false,values:[],error:'지표 계산은 5,000봉 이내에서 가능합니다',steps:0};
        const maxSteps=Number.isFinite(options.maxSteps)&&options.maxSteps>0?Math.min(2000000,Math.floor(options.maxSteps)):1000000;
        const context=makeContext(series,{length,maxSteps}),values=[];
        try{
          for(let index=0;index<length;index++){const value=evaluateNode(ast,context,index);values.push(finite(value)?Number(value):null);}
          return {ok:true,values,steps:context.steps};
        }catch(error){return {ok:false,values:[],error:error.message,steps:context.steps};}
      },
    };
  }

  return { FormulaError, compile, tokenize, variableAliases, functionAliases, timeframes, limits: { maxSourceLength: MAX_SOURCE_LENGTH, maxWindow: MAX_WINDOW } };
});
