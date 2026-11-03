export const ACTIONS = Object.freeze({ENTER_LONG:'롱 진입',ENTER_SHORT:'숏 진입',EXIT_LONG:'롱 정리',EXIT_SHORT:'숏 정리',CLOSE_ALL:'전체 정리',STOP_BOT:'봇 정지'});
export const isEntry = action => action==='ENTER_LONG'||action==='ENTER_SHORT';
export const isStop = action => action==='STOP_BOT';
export const actionDirection = action => action.endsWith('_LONG')?'LONG':action.endsWith('_SHORT')?'SHORT':null;
export const defaultOrder = () => ({type:'LIMIT',price:'bid',ticks:0,timeout:15,remainder:'cancel',postOnly:true});
export function makeActionRule(overrides={}) {
  return {id:globalThis.crypto.randomUUID(),enabled:true,action:'ENTER_LONG',formula:'',formulaVersion:2,sizePercent:25,leverage:3,order:defaultOrder(),reentry:{mode:'rearm',cooldown:60,afterExitCooldown:0},...overrides};
}
export function upgradeActions(bot) {
  if(Array.isArray(bot.actionRules)&&bot.actionRules.some(rule=>rule&&isEntry(rule.action)&&rule.leverage==null))bot={...bot,actionRules:bot.actionRules.map(rule=>rule&&isEntry(rule.action)&&rule.leverage==null?{...rule,leverage:bot.leverage||3}:rule)};
  if(Array.isArray(bot.actionRules)&&bot.actionRules.some(rule=>rule?.reentry&&rule.reentry.afterExitCooldown==null))bot={...bot,actionRules:bot.actionRules.map(rule=>rule?.reentry&&rule.reentry.afterExitCooldown==null?{...rule,reentry:{...rule.reentry,afterExitCooldown:rule.reentry.cooldown}}:rule)};
  if(Array.isArray(bot.actionRules)&&bot.actionRules.every(rule=>rule?.formulaVersion===2))return bot;
  if(Array.isArray(bot.actionRules))return {...bot,actionRules:bot.actionRules.map(rule=>{
    if(!rule||typeof rule!=='object')return rule;
    if(rule.formulaVersion===2)return rule;
    const {timeframe='15m',candle='closed',...rest}=rule;
    return {...rest,formulaVersion:2,formula:rule.formula?.trim()&&!rule.formula.includes('@')?`(${rule.formula})@${timeframe}${candle==='closed'?'[1]':''}`:rule.formula};
  })};
  const side=bot.direction==='SHORT'?'SHORT':'LONG';
  const rules=[makeActionRule({id:'legacy-entry',action:'ENTER_'+side,leverage:bot.leverage||3,formula:bot.formula||'',formulaVersion:1,timeframe:bot.formulaTimeframe||'15m',candle:bot.formulaCandle||'closed',sizePercent:bot.entryPercent??25,order:{...defaultOrder(),...bot.order},reentry:{mode:'rearm',cooldown:60,...bot.reentry}})];
  for(const action of ['ENTER_LONG','ENTER_SHORT','EXIT_LONG','EXIT_SHORT'])if(action!==rules[0].action)rules.push(makeActionRule({enabled:false,action,sizePercent:isEntry(action)?25:100,order:isEntry(action)?defaultOrder():{...defaultOrder(),type:'MARKET',postOnly:false}}));
  return upgradeActions({...bot,actionRules:rules});
}
