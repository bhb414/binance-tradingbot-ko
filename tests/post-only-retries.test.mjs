
import test from 'node:test';import assert from 'node:assert/strict';import {isPostOnlyRejection} from '../backend/post-only-retries.mjs';
test('only a definitive standard GTX limit rejection receives automatic maker retries',()=>{
 const parameters={type:'LIMIT',timeInForce:'GTX'},error={code:-5022,status:400};assert.equal(isPostOnlyRejection(error,parameters),true);assert.equal(isPostOnlyRejection({...error,status:200},parameters),true);
 for(const e of [{...error,uncertain:true},{...error,temporary:true},{...error,status:503},{...error,status:429},{...error,code:-2010},{...error,code:-1007}])assert.equal(isPostOnlyRejection(e,parameters),false);
 assert.equal(isPostOnlyRejection(error,{type:'MARKET'}),false);assert.equal(isPostOnlyRejection(error,{type:'LIMIT',timeInForce:'GTC'}),false);assert.equal(isPostOnlyRejection(error,parameters,'algo'),false);
});
