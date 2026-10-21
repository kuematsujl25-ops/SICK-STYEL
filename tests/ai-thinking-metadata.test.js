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

test('両親epochのinit後から最終result前の各位置でmetadataは状態を変えない',()=>{
 const base=fixture(),expected=check(base),firstInit=base.findIndex(x=>x.subtype==='init'),lastResult=base.findLastIndex(x=>x.type==='result');
 for(let at=firstInit+1;at<=lastResult;at++){
  const rows=fixture();rows.splice(at,0,event(),event(171,121),event(0,0));const actual=check(rows);
  assert.deepEqual(actual.output,expected.output);assert.deepEqual(actual.result,expected.result);
  assert.deepEqual(actual.audit,expected.audit);assert.deepEqual({...actual.counts,transcript_lines:expected.counts.transcript_lines},expected.counts,'position '+at);
 }
});

test('初期化前/最終result後と未完hookの位置は拒否する',()=>{
 const base=fixture(),firstInit=base.findIndex(x=>x.subtype==='init'),firstResult=base.findIndex(x=>x.type==='result');
 for(const at of [...Array(firstInit+1).keys(),base.length]){
  const rows=fixture();rows.splice(at,0,event());assert.throws(()=>check(rows),'position '+at);
 }
 const rows=fixture();rows.splice(4,0,{type:'system',subtype:'hook_started',hook_id:'pending',hook_name:'PreToolUse',hook_event:'PreToolUse',session_id:session,uuid:randomUUID()},event());assert.throws(()=>check(rows));
});

test('初回担当中でも不正metadataと子帰属を拒否しtool/permission/完了検証を維持',()=>{
 for(const patch of [{parent_tool_use_id:'tool_fixture',agent_id:'task_fixture',subagent_type:delegate},
  {parent_tool_use_id:null},{agent_id:'task_fixture'},{task_id:'task_fixture'},{tool_use_id:'tool_fixture'},
  {permission:'allow'},{result:'completed'},{estimated_tokens:NaN},{estimated_tokens:Infinity},
  {estimated_tokens_delta:null},{estimated_tokens_delta:Number.MAX_SAFE_INTEGER+1},{subtype:'unknown_system'}]){
  const rows=fixture();rows.splice(8,0,{...event(),...patch});assert.throws(()=>check(rows));
 }
 for(const mutate of [rows=>rows.splice(rows.findIndex(x=>x.subtype==='task_notification'),1),
  rows=>{rows.at(-1).permission_denials=[{tool_name:'Bash'}]},
  rows=>{rows.find(x=>x.agent_id).message.content.push({type:'tool_use',name:'Bash',id:'bad',input:{}})},
  rows=>{rows.find(x=>x.subtype==='task_updated').patch.status='failed'},
  rows=>{rows.find(x=>x.subtype==='hook_response').exit_code=1}]){
  const rows=fixture();rows.splice(8,0,event());mutate(rows);assert.throws(()=>check(rows));
 }
});

test('result間に許すのは厳密thinkingだけで他のイベントや不正metadataは拒否',()=>{
 for(const e of [{...event(),permission:'allow'},{...event(),parent_tool_use_id:'tool_fixture'},
  {...event(),session_id:randomUUID()},{...event(),subtype:'task_notification'},
  {type:'rate_limit_event',rate_limit_info:{status:'allowed',isUsingOverage:false,overageStatus:'rejected'},uuid:randomUUID(),session_id:session}]){
  const rows=fixture();rows.splice(rows.length-1,0,e);assert.throws(()=>check(rows));
 }
});
