import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {strictJson,canonicalInputHash,verifyInputHashes} from '../scripts/ai-staff/delegate-guard.js';
const raw=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

test('canonical hashは再帰的なobjectキー順だけを無視し、値/型/配列順/fieldを保持',()=>{
 const a={z:[{b:2,a:1},null,'1'],a:{y:false,x:'日本語'}};
 const b={a:{x:'日本語',y:false},z:[{a:1,b:2},null,'1']};
 assert.notEqual(raw(a),raw(b));assert.equal(canonicalInputHash(a),canonicalInputHash(b));
 for(const change of [v=>v.z.reverse(),v=>v.z[0].a='1',v=>v.z[0].a=3,v=>v.z[1]=0,v=>v.a.y='false',v=>v.a.x+=' ',v=>v.a.extra=null,v=>delete v.a.y]){
  const c=structuredClone(a);change(c);assert.notEqual(canonicalInputHash(a),canonicalInputHash(c));
 }
 assert.notEqual(canonicalInputHash(-0),canonicalInputHash(0));
 for(const v of [NaN,Infinity,undefined])assert.throws(()=>canonicalInputHash(v));
});

test('strict JSONは重複/escaped重複/nested重複/不正数を拒否、文字列内容は不変',()=>{
 for(const s of ['{"a":1,"a":1}','{"a":1,"\\u0061":2}','{"x":[{"k":null,"k":false}]}','{"n":1e400}','{"x":1,}'])assert.throws(()=>strictJson(s));
 const text=' { "s":"a\\\"b\\\\c", "a":[{},[],null,true,false,-0,1e2], "x":{"__proto__":1} } ';
 assert.deepEqual(strictJson(text),JSON.parse(text));
 assert.equal(Object.is(strictJson('-0'),-0),true);
});

test('hook raw hashを保持しcanonicalを別検証、legacyは事後監査だけで6順序を照合',()=>{
 const input={subagent_type:'ss-data-auditor',description:'架空',prompt:'{"n":1,"a":[2,3]}'};
 const ordered={description:input.description,prompt:input.prompt,subagent_type:input.subagent_type};
 const receipt={input_sha256:raw(ordered),input_canonical_sha256:canonicalInputHash(ordered)};
 const out=verifyInputHashes(input,receipt);assert.equal(out.input_sha256,raw(ordered));assert.notEqual(out.input_sha256,raw(input));
 assert.throws(()=>verifyInputHashes(input,{...receipt,input_sha256:raw('different')}));
 assert.throws(()=>verifyInputHashes(input,{...receipt,input_canonical_sha256:raw('different')}));
 const legacy={input_sha256:raw(ordered)};assert.throws(()=>verifyInputHashes(input,legacy));
 assert.deepEqual(verifyInputHashes(input,legacy,{allowLegacy:true}).legacy_key_order_evidence,['description','prompt','subagent_type']);
 for(const patch of [{description:'架空 '},{prompt:'{"n":"1","a":[2,3]}'},{prompt:'{"n":1,"a":[3,2]}'},{prompt:'{"a":[2,3],"n":1}'},{description:null},{extra:'field'}])
  assert.throws(()=>verifyInputHashes({...input,...patch},receipt));
});
