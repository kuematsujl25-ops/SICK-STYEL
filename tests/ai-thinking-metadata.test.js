import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateTranscript} from '../scripts/ai-staff/delegate.js';
import {fixture,packet,model,delegate,session} from './helpers/async-run.js';
const event=(total=50,delta=50)=>({type:'system',subtype:'thinking_tokens',estimated_tokens:total,estimated_tokens_delta:delta,uuid:randomUUID(),session_id:session});
const check=rows=>validateTranscript(rows.map(JSON.stringify).join('\n'),{packet,model,delegate,session_id:session});
const withMetadata=()=>{const rows=fixture(),at=rows.findLastIndex(x=>x.subtype==='init')+1;rows.splice(at,0,event(),event(200,150));return {rows,at}};

test('既知thinking metadataは継続init後の概算進捗だけとして受理しusageやactionを変更しない',()=>{
 const {rows}=withMetadata(),a=check(rows),b=check(fixture());assert.deepEqual(a.output,b.output);assert.deepEqual(a.result,b.result);
 assert.equal(a.counts.parent_agent_calls,1);assert.equal(a.counts.child_tool_calls,0);
 const reset=withMetadata();reset.rows.splice(reset.at+2,0,event(0,0));assert.deepEqual(check(reset.rows).output,b.output);
 assert.equal(a.audit.quality_approved,false);assert.equal(a.audit.server_tool_calls,b.audit.server_tool_calls);
});

test('thinking metadataの未知field/型/値/session/重複/子帰属を拒否',()=>{
 for(const patch of [{estimated_tokens:'50'},{estimated_tokens:null},{estimated_tokens:-1},{estimated_tokens:1.5},{estimated_tokens:Number.MAX_SAFE_INTEGER+1},
  {estimated_tokens_delta:'50'},{estimated_tokens_delta:-1},{estimated_tokens_delta:1.5},{estimated_tokens_delta:51},
  {session_id:randomUUID()},{uuid:'bad'},{subtype:'unknown_system'},{user_message_uuid:randomUUID()},
  {parent_tool_use_id:null},{agent_id:'child'},{message:{content:[{type:'tool_use',name:'Bash'}]}},{permission:'allow'}]){
  const {rows,at}=withMetadata();Object.assign(rows[at],patch);assert.throws(()=>check(rows),JSON.stringify(patch));
 }
 for(const key of Object.keys(event())){const {rows,at}=withMetadata();delete rows[at][key];assert.throws(()=>check(rows),key);}
 const {rows,at}=withMetadata();rows[at+1].uuid=rows[at].uuid;assert.throws(()=>check(rows));
});

test('初期化前/初回turn/子動作中/最終本文後/result後は拒否し既存permission制御も維持',()=>{
 const rows=fixture();
 for(const at of [0,3,9,rows.findLastIndex(x=>x.subtype==='init'),rows.length-2,rows.length]){
  const bad=fixture();bad.splice(at,0,event());assert.throws(()=>check(bad),'position '+at);
 }
 const {rows:bad}=withMetadata();bad.at(-1).permission_denials=[{tool_name:'Bash'}];assert.throws(()=>check(bad));
});
