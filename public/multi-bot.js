import {budgetIncluded,allocatedAmount,budgetSettingsErrors,requestedBudget} from './budget.js';
import {randomId} from './id.js';
import {makeBot,validateBot,effectiveBudget} from './core.js';
import {makeActionRule,isEntry,isStop} from './actions.js';
import {formulaSymbols,formulaTimeframes} from './formula.js';
import {MAX_LEVERAGE} from './leverage.js';
export const MULTI_ACTIONS={MULTI:'종목별 매매',STOP_BOT:'봇 정지'};
export const TARGET_ACTIONS={ENTER_LONG:'롱 진입',ENTER_SHORT:'숏 진입',EXIT_LONG:'롱 정리',EXIT_SHORT:'숏 정리',CLOSE_ALL:'해당 종목 전량 정리'};
export const multiOrder=()=>({type:'MARKET',price:'bid',ticks:0,timeout:15,remainder:'cancel',postOnly:false});
export function multiTarget(alias,extra={}){return {alias,enabled:true,action:'ENTER_LONG',closeScope:'bot',sizePercent:25,leverage:3,order:multiOrder(),...extra};}
export function multiRule(legs,extra={}){return {...makeActionRule({action:'MULTI',formula:'FALSE@1h',reentry:{mode:'rearm',cooldown:0,afterExitCooldown:0}}),targets:legs.map(leg=>multiTarget(leg.alias)),...extra};}
export function makeMultiBot(extra={}){
 const legs=[{alias:'A',symbol:'BTCUSDT',weight:50},{alias:'B',symbol:'ETHUSDT',weight:50}];
 return {id:randomId(),kind:'multi',name:'새 다중종목 봇',budget:500,budgetMode:'fixed',profitReinvestPercent:100,maxEntries:0,margin:'ISOLATED',color:'mint',legs,exit:{takeProfit:3,stopLoss:1.5,price:'MARK_PRICE',basis:'price',takeProfitEnabled:false,stopLossEnabled:false},actionRules:[multiRule(legs)],...extra};
}
export function validateMulti(bot,{symbols,balance=Infinity,availableBalance=null,otherAllocated=0,previous=null}={}){
 if(!bot||typeof bot!=='object')return ['봇 설정 형식을 확인하세요.'];
 const errors=[];if(bot.budgetIncluded!==undefined&&typeof bot.budgetIncluded!=='boolean')errors.push('운용예산 포함 여부를 확인하세요.');const known=new Set(symbols||[]),aliases=new Set(),assets=new Set();
 if(typeof bot.id!=='string'||!/^[A-Za-z0-9_-]{1,48}$/.test(bot.id))errors.push('봇 식별자를 확인하세요.');
 if(typeof bot.name!=='string'||!bot.name.trim()||bot.name.length>30)errors.push('이름은 1~30자로 입력하세요.');
 errors.push(...budgetSettingsErrors(bot));
 if(bot.profitReinvestPercent!==undefined&&(!Number.isFinite(bot.profitReinvestPercent)||bot.profitReinvestPercent<0||bot.profitReinvestPercent>100))errors.push('이익 예산 반영 비율은 0~100%로 입력하세요.');
 if(!['fixed','pnl','capped','floor'].includes(bot.budgetMode)||!['ISOLATED','CROSSED'].includes(bot.margin))errors.push('예산 운용·증거금 모드를 확인하세요.');
 if(!Number.isInteger(bot.maxEntries)||bot.maxEntries<0||bot.maxEntries>20)errors.push('종목별 진입 횟수는 0(제한 없음)~20회로 지정하세요.');
 if(!Array.isArray(bot.legs)||bot.legs.length<2||bot.legs.length>8)return [...errors,'다중종목 봇은 2~8개 종목을 지정하세요.'];
 if(bot.legs.some(leg=>!leg||typeof leg!=='object'))return [...errors,'종목 설정 형식을 확인하세요.'];
 for(const leg of bot.legs){
  if(!leg||typeof leg!=='object'){errors.push('종목 설정 형식을 확인하세요.');continue;}
  if(!/^[A-Z]$/.test(leg.alias)||aliases.has(leg.alias))errors.push('종목 별칭은 중복 없는 A~Z여야 합니다.');aliases.add(leg.alias);
  if(!known.has(leg.symbol)||assets.has(leg.symbol))errors.push('거래 가능한 서로 다른 USDT 선물 종목을 선택하세요.');assets.add(leg.symbol);
  if(!Number.isFinite(leg.weight)||leg.weight<=0||leg.weight>100)errors.push('종목 비중은 0 초과~100%로 입력하세요.');
 }
 if(bot.legs.reduce((s,l)=>s+l.weight,0)>100+1e-9)errors.push('종목 비중 합계는 100% 이하여야 합니다.');
 if(budgetIncluded(bot)&&bot.budgetShortfall!=='available'&&(!previous||!budgetIncluded(previous)||requestedBudget({...bot,runtime:previous.runtime,used:previous.used,reserved:previous.reserved},balance,availableBalance)>requestedBudget(previous,balance,availableBalance))&&requestedBudget({...bot,runtime:previous?.runtime,used:previous?.used,reserved:previous?.reserved},balance,availableBalance)+otherAllocated>balance+1e-8)errors.push('다른 봇 예산을 포함한 배정액이 지갑 잔고를 초과합니다.');
 if(!Array.isArray(bot.actionRules)||!bot.actionRules.length||bot.actionRules.length>20)return [...errors,'조건은 1~20개로 지정하세요.'];
 if(!bot.actionRules.some(r=>r?.enabled))errors.push('실행할 조건을 하나 이상 켜세요.');
 const ids=new Set();
 for(const [index,rule]of bot.actionRules.entries()){
  if(!rule||typeof rule!=='object'){errors.push('조건 형식을 확인하세요.');continue;}
  const prefix='조건 '+(index+1)+': ';
  if(typeof rule.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(rule.id)||ids.has(rule.id))errors.push(prefix+'식별자를 확인하세요.');ids.add(rule.id);
  if(!['MULTI','STOP_BOT'].includes(rule.action)||typeof rule.enabled!=='boolean')errors.push(prefix+'행동을 확인하세요.');
  try{if(rule.enabled||rule.formula){formulaTimeframes(rule.formula);for(const name of formulaSymbols(rule.formula))if(!aliases.has(name)&&!known.has(name))errors.push(prefix+name+' 종목·별칭이 없습니다.');}}catch(error){errors.push(prefix+error.message);}
  const targets=Array.isArray(rule.targets)?rule.targets.filter(t=>t?.enabled):[];
  if(rule.action==='MULTI'&&(!Array.isArray(rule.targets)||!targets.length))errors.push(prefix+'매매할 종목을 하나 이상 선택하세요.');
  const selected=new Set();
  for(const target of Array.isArray(rule.targets)?rule.targets:[]){
   if(!target||typeof target!=='object'){errors.push(prefix+'대상 형식을 확인하세요.');continue;}
   if(!aliases.has(target.alias)||selected.has(target.alias))errors.push(prefix+'대상 별칭을 확인하세요.');selected.add(target.alias);
   if(typeof target.enabled!=='boolean'||!Object.hasOwn(TARGET_ACTIONS,target.action))errors.push(prefix+'종목별 행동을 확인하세요.');
   const leg=bot.legs.find(l=>l.alias===target.alias);if(!leg)continue;
   const fake={...makeBot(),name:bot.name,symbol:leg.symbol,budget:bot.budget,exit:bot.exit,actionRules:[makeActionRule({...target,id:rule.id,enabled:rule.enabled&&target.enabled,formula:rule.formula,reentry:rule.reentry})]};
   if(!fake.actionRules[0].enabled){fake.actionRules[0].enabled=true;fake.actionRules[0].formula=rule.formula||'FALSE@1h';}
   errors.push(...validateBot(fake,[],{symbols,balance:Infinity,maxLeverage:MAX_LEVERAGE,enforceAllocationLimit:false}).map(message=>prefix+leg.alias+' '+message));
  }
  if(isStop(rule.action)){const fake={...makeBot(),budget:bot.budget,symbol:bot.legs[0].symbol,exit:bot.exit,actionRules:[makeActionRule({...rule,enabled:true})]};errors.push(...validateBot(fake,[],{symbols,balance:Infinity,maxLeverage:MAX_LEVERAGE,enforceAllocationLimit:false}));}
 }
 return [...new Set(errors)];
}
export function multiAliases(bot){return Object.fromEntries(bot.legs.map(leg=>[leg.alias,leg.symbol]));}
export const memberId=(bot,leg)=>bot.id+'_'+leg.alias;
export function multiAllocations(bot,realized=0){const total=effectiveBudget({...bot,runtime:{...bot.runtime,realized}});return bot.legs.map(leg=>({...leg,budget:total*leg.weight/100}));}
