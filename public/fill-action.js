// BUY/SELL alone cannot distinguish entries from reductions, especially for shorts.
import {ACTIONS} from './actions.js';
export function fillAction(fill){
 const role=typeof fill.role==='string'?fill.role.toLowerCase():'',action=typeof fill.action==='string'?fill.action.toUpperCase():'';
 const entry=role==='entry'||/^(ENTER|OPEN)(_|$)/.test(action),exit=['exit','take','stop'].includes(role)||/^(EXIT|CLOSE)(_|$)/.test(action);
 let kind=entry!==exit?(entry?'entry':'exit'):'unknown',direction=['LONG','SHORT'].includes(fill.direction)?fill.direction:['LONG','SHORT'].includes(fill.positionSide)?fill.positionSide:action.match(/_(LONG|SHORT)$/)?.[1]||null,side=['BUY','SELL'].includes(fill.side)?fill.side:null;
 const sideFor=(kind,direction)=>kind==='entry'?(direction==='LONG'?'BUY':'SELL'):(direction==='LONG'?'SELL':'BUY');
 if(kind!=='unknown'){
  if(!direction&&side)direction=kind==='entry'?(side==='BUY'?'LONG':'SHORT'):(side==='SELL'?'LONG':'SHORT');
  if(direction&&!side)side=sideFor(kind,direction);
  if(direction&&side&&side!==sideFor(kind,direction)){kind='unknown';direction=null;}
 }
 const label=kind==='unknown'?'매매 구분 미확인':direction?ACTIONS[(kind==='entry'?'ENTER_':'EXIT_')+direction]:(kind==='entry'?'진입':'정리')+' · 방향 미확인',sideLabel=side==='BUY'?'매수 BUY':side==='SELL'?'매도 SELL':'매수·매도 미확인',reason=kind==='exit'?(role==='take'?'익절 주문':role==='stop'?'손절 주문':''):'';
 return {kind,direction,side,label,sideLabel,reason};
}
export function fillActionMarkup(fill){
 const item=fillAction(fill);
 return '<span class="fill-action" data-kind="'+item.kind+'" data-direction="'+(item.direction||'unknown').toLowerCase()+'"><b>'+item.label+'</b><small>'+item.sideLabel+(item.reason?' · '+item.reason:'')+'</small></span>';
}
