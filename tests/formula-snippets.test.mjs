import test from 'node:test';import assert from 'node:assert/strict';
import {formulaSnippets,snippetOptions,completionQuery,completionMatches,snippetEdit} from '../public/formula-snippets.js';
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

test('completion queries replace a whole identifier, respect existing selections and never treat @timeframes as data',()=>{
 assert.deepEqual(completionQuery('SMA(하이킨종가, 6)',7),{query:'하이킨',start:4,end:9});
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
