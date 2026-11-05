import test from 'node:test';import assert from 'node:assert/strict';import {signatureAt} from '../public/formula-signature.js';

test('parameter help follows the actual caret inside nested functions with intact trailing arguments',()=>{
 const text='상향돌파(VWMA(하이킨종가, 6), SMA(종가, 20))@1m[1]';
 for(const [needle,name,argument]of [['하이킨종가','VWMA',0],['6)','VWMA',1],['종가, 20','SMA',0],['20)','SMA',1]]){const caret=text.indexOf(needle)+1,help=signatureAt(text,caret);assert.equal(help.name,name);assert.equal(help.argument,argument);}
 const outer=signatureAt(text,text.indexOf('SMA')-1);assert.equal(outer.name,'상향돌파');assert.equal(outer.argument,1);
});

test('unknown or misspelled inner calls never fall through to unrelated outer parameter help',()=>{
 for(const prefix of ['상향돌파(VWMMA(하이킨종가, ','상향돌파(없는함수(종가, ','상향돌파(VW('])assert.equal(signatureAt(prefix,prefix.length),null);
 const typed='상향돌파(VWMA(하이킨종가, 6), 종가)';assert.equal(signatureAt(typed,typed.indexOf('VWMA')+2),null);
});

test('grouping does not hide a surrounding call but historical index editing does',()=>{
 const grouped='상향돌파((하이킨종가 + 종가';assert.equal(signatureAt(grouped,grouped.length).name,'상향돌파');
 const index='상향돌파(종가[1';assert.equal(signatureAt(index,index.length),null);
 const closed='상향돌파(VWMA(종가, 6), ';assert.equal(signatureAt(closed,closed.length).argument,1);
});
