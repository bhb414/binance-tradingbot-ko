import test from 'node:test';import assert from 'node:assert/strict';
import {formulaSnippets,snippetOptions,completionQuery,completionMatches,snippetEdit,bracketEdit,textDifference,completionStillCurrent} from '../public/formula-snippets.js';
import {formulaEditorMarkup} from '../public/formula-editor.js';

test('data and function palettes insert only a bare field or empty function with no example frames or history',()=>{
 for(const options of [{},{chart:true},{symbols:['A','B']}])for(const item of formulaSnippets(options)){assert.doesNotMatch(item.insert,/[@\[\],<>]|\d/);assert.equal(item.insert,item.name+(item.function?'()':''));}
 const options=snippetOptions();assert.match(options,/value="SMA\(\)"/);assert.match(options,/value="VWMA\(\)"/);assert.doesNotMatch(options,/@|\[1\]/);
 const markup=formulaEditorMarkup({formula:''});assert.match(markup,/value="종가"/);assert.match(markup,/value="발생\(\)"/);assert.doesNotMatch(markup,/value="SMA\(종가/);
});

test('chart completions exclude current position and clock values while multi-symbol completions preserve aliases',()=>{
 assert.ok(!formulaSnippets({chart:true}).some(s=>/현재수익률|시간범위|평균매수가/.test(s.name)));
 const result=completionMatches('B.하이킨',{symbols:['A','B']});assert.equal(result.length,4);assert.ok(result.every(s=>s.insert.startsWith('B.하이킨')));
 assert.ok(completionMatches('vw').some(s=>s.insert==='VWMA()'));assert.ok(completionMatches('거래량가중').some(s=>s.insert==='VWMA()'));
 assert.ok(completionMatches('상향').some(s=>s.insert==='상향돌파()'));
});

test('completion queries replace only the typed prefix, respect existing selections and never treat @timeframes as data',()=>{
 assert.deepEqual(completionQuery('SMA(하이킨종가, 6)',7),{query:'하이킨',start:4,end:7});
 assert.deepEqual(completionQuery('A.종',3),{query:'A.종',start:0,end:3});
 assert.equal(completionQuery('종가@1m',5),null);assert.equal(completionQuery('SMA(',4),null);
 assert.deepEqual(completionQuery('SMA(',4,4,{force:true}),{query:'',start:4,end:4});
 assert.equal(completionQuery('종가',0,2),null);
});

test('function snippets place the caret inside parentheses and reuse existing argument lists without overwriting them',()=>{
 assert.deepEqual(snippetEdit('VW',0,2,'VWMA()'),{text:'VWMA()',caret:5});
 assert.deepEqual(snippetEdit('SM(종가, 6)',0,2,'SMA()'),{text:'SMA(종가, 6)',caret:4});
 assert.deepEqual(snippetEdit('SM (종가, 6)',0,2,'SMA()'),{text:'SMA (종가, 6)',caret:5});
 assert.deepEqual(snippetEdit('종가 > 하이킨',5,8,'하이킨종가'),{text:'종가 > 하이킨종가',caret:10});
 assert.equal(snippetEdit('12345',5,5,'VWMA()',10),null);
});


test('completion in the middle of identifiers reuses matching suffixes and keeps all trailing arguments and conditions',()=>{
 const original='상향돌파(VWMA(하이킨종가, 6), SMA(종가, 20))@1m[1]',start=original.indexOf('VWMA'),caret=start+2,query=completionQuery(original,caret),result=snippetEdit(original,query.start,query.end,'VWMA()');assert.equal(result.text,original);assert.equal(result.caret,start+5);
 const middle='SMA(하이킨종가[1], 6) + 종가@3m[1]',q=completionQuery(middle,7),completed=snippetEdit(middle,q.start,q.end,'하이킨종가');assert.equal(completed.text,middle);assert.equal(completed.caret,9);
 assert.deepEqual(snippetEdit('VWMA + 종가',0,2,'VWMA()'),{text:'VWMA() + 종가',caret:5});
 assert.deepEqual(snippetEdit('vwma(종가,6)',0,2,'VWMA()'),{text:'VWma(종가,6)',caret:5});
 const other='하이시가, 6)) AND 종가 > 0';assert.equal(snippetEdit(other,0,2,'하이킨종가').text,'하이킨종가시가, 6)) AND 종가 > 0');
 assert.deepEqual(snippetEdit('SM A(종가,6)',0,2,'SMA()'),{text:'SMA() A(종가,6)',caret:4});
});

test('a completion generated before a caret move, selection or later input cannot edit the new location',()=>{
 const snapshot={text:'SMA(하이,6)',caret:6};assert.equal(completionStillCurrent(snapshot.text,6,6,snapshot),true);
 for(const [text,start,end]of [[snapshot.text,5,5],[snapshot.text,6,8],['SMA(하이킨,6)',7,7]])assert.equal(completionStillCurrent(text,start,end,snapshot),false);
});

test('matching parentheses and brackets wrap selections, skip existing closers and delete only empty pairs',()=>{
 assert.deepEqual(bracketEdit('VWMA',4,4,'('),{text:'VWMA()',caret:5});
 assert.deepEqual(bracketEdit('상향돌파(VWMA())',10,10,')'),{text:'상향돌파(VWMA())',caret:11});
 assert.deepEqual(bracketEdit('종가',2,2,'['),{text:'종가[]',caret:3});
 assert.deepEqual(bracketEdit('종가[1]',4,4,']'),{text:'종가[1]',caret:5});
 assert.deepEqual(bracketEdit('SMA() + 종가',4,4,'Backspace'),{text:'SMA + 종가',caret:3});
 assert.deepEqual(bracketEdit('종가+시가',0,5,'('),{text:'(종가+시가)',caret:6});
 assert.equal(bracketEdit('',0,0,'Backspace'),null);assert.equal(bracketEdit('종가',0,0,'Backspace'),null);
 assert.equal(bracketEdit('종가',2,2,'(',3),null);
});

test('surgical edits preserve unchanged prefixes and tails for native undo history',()=>{
 for(const [before,after]of [['VWMA(하이,6))@1m[1]','VWMA(하이킨종가,6))@1m[1]'],['SMA() + 종가','SMA + 종가'],['VWMA()','VWMA()']]){
  const diff=textDifference(before,after);assert.equal(before.slice(0,diff.start)+diff.text+before.slice(diff.end),after);
  if(before.endsWith('))@1m[1]'))assert.ok(diff.end<=before.indexOf(',6'));
 }
});
