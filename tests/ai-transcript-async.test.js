// Hand-authored synthetic protocol fixture. No saved model response, personal path or live IDs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyTeam,transitionTeam,taskPacket,TeamError} from '../lib/ai-team.js';
import {validateTranscript} from '../scripts/ai-staff/delegate.js';
const time='2026-10-20T01:00:00.000Z',model='claude-opus-5-5',delegate='ss-data-auditor';
const session='10000000-0000-4000-8000-000000000001';
const facts=[{id:'f1',label:'架空売上',value:100,unit:'JPY',source:'fixture',observed_at:time,kind:'observed'},
  {id:'f2',label:'架空原価',value:null,unit:'JPY',source:'fixture',observed_at:time,kind:'observed'}];
const packet=taskPacket(transitionTeam(transitionTeam(emptyTeam(),{action:'toggle',enabled:true},time),
  {action:'create',job:{role:'coo',title:'架空',objective:'不足条件を確認',facts}},time).jobs[0]);
const output={summary:'原価は未取得。利益を評価できません。',fact_ids:['f1'],missing_data:['原価'],
  hypotheses:[],recommendations:[],approvals_required:[],limitations:['架空データ。鮮度基準は未確認。']};
const tool='tool_fixture',task='task_fixture',run='run_fixture',description='架空監査',waiting='担当からの回答を待ちます。';
const childText='原価は未取得。利益は評価できません。';
const input={subagent_type:delegate,description,prompt:JSON.stringify(packet)};
const stats=()=>({spawned:1,completed:1,failed:0,max_depth:1,spawned_by_subagents:0,started_in_background:1,
  requested:{background:0,foreground:0,unset:1},by_type:{[delegate]:1},
  killed:{parent:0,user:0,system:0},refused:{depth_limit:0,concurrency_limit:0,budget:0}});
const fixture=()=>{
  const init={type:'system',subtype:'init',model,claude_code_version:'2.1.296',tools:['Task'],
    apiKeySource:'none',permissionMode:'dontAsk',mcp_servers:[],agents:[delegate]};
  const assistant=(name,content,extra={})=>({type:'assistant',parent_tool_use_id:null,message:{id:name,model,content},...extra});
  const result=(index,text,extra={})=>({type:'result',subtype:'success',is_error:false,result_index:index,result:text,
    terminal_reason:'completed',stop_reason:'end_turn',safety_stops:0,api_error_status:null,queued_turn_count:0,
    permission_denials:[],num_turns:1,subagent_stats:stats(),...extra});
  return [
    {type:'system',subtype:'hook_started',hook_event:'SessionStart',hook_name:'SessionStart:startup',hook_id:'hook_fixture'},
    {type:'system',subtype:'hook_response',hook_event:'SessionStart',hook_name:'SessionStart:startup',hook_id:'hook_fixture',exit_code:0,outcome:'success'},
    init,
    assistant('parent_launch',[{type:'tool_use',id:tool,name:'Agent',input:structuredClone(input)}],{wire_tool_inputs:{[tool]:structuredClone(input)}}),
    {type:'rate_limit_event',rate_limit_info:{status:'allowed',isUsingOverage:false,overageStatus:'rejected'}},
    {type:'system',subtype:'background_tasks_changed',tasks:[{task_id:task,run_id:run,task_type:'local_agent',subagent_type:delegate,description}]},
    {type:'system',subtype:'task_started',task_id:task,run_id:run,tool_use_id:tool,task_type:'local_agent',
      subagent_type:delegate,description,is_backgrounded:true,spawn_depth:1,prompt:input.prompt},
    {type:'user',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:tool,content:'起動通知'}]},
      tool_use_result:{isAsync:true,status:'async_launched',agentId:task,resolvedModel:model,prompt:input.prompt,canReadOutputFile:false,canContinueAgent:false},
      tool_result_meta:[{id:tool,permission_decision:{decision:'accept',source:'config'}}]},
    assistant('parent_wait',[{type:'text',text:waiting}]),
    assistant('child_reply',[{type:'text',text:childText}],{parent_tool_use_id:tool,agent_id:task,subagent_type:delegate}),
    {type:'system',subtype:'task_updated',task_id:task,run_id:run,patch:{status:'completed',end_time:1792458001000}},
    {type:'system',subtype:'task_notification',task_id:task,run_id:run,tool_use_id:tool,status:'completed',summary:childText,usage:{tool_uses:0}},
    {type:'system',subtype:'background_tasks_changed',tasks:[]},
    structuredClone(init),
    assistant('parent_final',[{type:'text',text:JSON.stringify(output)}]),
    result(0,waiting),
    result(1,JSON.stringify(output),{origin:{kind:'task-notification',producer:'session-task',runId:run}}),
  ].map((m,i)=>({...m,session_id:session,uuid:`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`}));
};
const check=(rows,opts={})=>validateTranscript(rows.map(m=>JSON.stringify(m)).join('\n'),
  {packet,delegate,model,session_id:session,...opts});
const rejects=(fn,label)=>{const rows=fixture();fn(rows);assert.throws(()=>check(rows),TeamError,label);};

test('非同期: session/tool/task/runと完了原因を結ぶ2結果だけを受理し、品質/guard実証とは分ける',()=>{
  const r=check(fixture());
  assert.deepEqual(r.output,output);assert.equal(r.audit.run_id,run);assert.equal(r.audit.child_completed,true);
  assert.equal(r.audit.quality_approved,false);assert.equal(r.audit.guard_execution_proven,false);
  assert.equal(r.counts.parent_agent_calls,1);assert.equal(r.counts.child_tool_calls,0);
  for(const name of ['Agent','Task']){
    const rows=fixture();rows[2].tools=[name];rows[13].tools=[name];rows[3].message.content[0].name=name;
    assert.deepEqual(check(rows).output,output);
  }
  assert.throws(()=>check(fixture(),{session_id:undefined}),TeamError);
  assert.throws(()=>check(fixture(),{model:null}),TeamError);
});

test('非同期: sessionの混入・欠落・重複IDは全イベントで拒否、必須証拠の欠落も拒否',()=>{
  for(let i=0;i<fixture().length;i++){
    rejects(r=>r[i].session_id='10000000-0000-4000-8000-000000000099','session '+i);
    rejects(r=>delete r[i].session_id,'missing session '+i);
    rejects(r=>delete r[i].uuid,'missing uuid '+i);
    if(i>0)rejects(r=>r[i].uuid=r[0].uuid,'duplicate '+i);
    rejects(r=>r.splice(i,1),'missing event '+i);
  }
});

test('非同期: identity・順序・全結果の権限/安全/回数を厳格に確認',()=>{
  const cases=[
    r=>r[5].tasks[0].run_id='other',r=>r[6].tool_use_id='other',r=>r[6].task_id='other',
    r=>r[6].run_id='other',r=>r[6].spawn_depth=2,r=>r[6].subagent_type='ss-qa-security',
    r=>r[7].tool_use_result.agentId='other',r=>r[7].tool_use_result.resolvedModel='other',
    r=>r[7].tool_result_meta[0].id='other',r=>r[7].tool_result_meta[0].permission_decision.decision='deny',
    r=>r[7].tool_result_meta[0].permission_decision.source='bypass',r=>r[7].message.content[0].is_error=true,
    r=>r[9].agent_id='other',r=>r[9].parent_tool_use_id='grandchild',r=>r[9].subagent_type='other',
    r=>r[9].message.model='other',r=>r[10].run_id='other',r=>r[10].patch.status='failed',
    r=>r[11].tool_use_id='other',r=>r[11].task_id='other',r=>r[11].run_id='other',
    r=>r[11].status='failed',r=>r[11].usage.tool_uses=1,r=>r[11].summary+='changed',
    r=>r[16].origin.runId='other',r=>r[16].origin.producer='other',r=>r[16].origin.kind='other',
    r=>delete r[16].origin,r=>r[15].origin={kind:'task-notification',producer:'session-task',runId:run},
    r=>r[16].result_index=0,r=>r[15].result_index=1,
    r=>r[13].permissionMode='bypassPermissions',r=>r[13].model='other',r=>r[13].apiKeySource='api',
    r=>{r[2].mcp_servers=[{name:'other'}];r[13].mcp_servers=[{name:'other'}];},
    r=>r[13].agents.push('new'),r=>r[13].tools=['Task','Read'],
    r=>{r[2].claude_code_version='2.1.999';r[13].claude_code_version='2.1.999';},
    r=>r[4].rate_limit_info.isUsingOverage=true,r=>r[4].rate_limit_info.status='rejected',
    r=>r[1].exit_code=2,r=>r[1].outcome='error',
    r=>{[r[10],r[11]]=[r[11],r[10]];},r=>{[r[12],r[13]]=[r[13],r[12]];},
    r=>r.push({...r[16],uuid:'20000000-0000-4000-8000-999999999999',result_index:2}),
  ];
  for(const [i,mutate] of cases.entries())rejects(mutate,'mutation '+i);
  for(const i of [15,16])for(const mutate of [
    m=>m.permission_denials=[{tool_name:'Agent'}],m=>delete m.permission_denials,m=>m.is_error=true,
    m=>m.subtype='error',m=>m.safety_stops=1,m=>m.api_error_status=429,m=>m.queued_turn_count=1,
    m=>m.subagent_stats.spawned=2,m=>m.subagent_stats.completed=0,m=>m.subagent_stats.failed=1,
    m=>m.subagent_stats.max_depth=2,m=>m.subagent_stats.spawned_by_subagents=1,
    m=>m.subagent_stats.by_type.other=1,m=>m.subagent_stats.killed.user=1,m=>m.subagent_stats.refused.budget=1,
    m=>m.num_turns=13,m=>m.usage={server_tool_use:{web_search_requests:1,web_fetch_requests:0}}
  ])rejects(r=>mutate(r[i]),'result safety '+i);
});

test('非同期: 入力3か所とwire照合、別ツール/子ツール/二重委譲/再開/モデル指定を拒否',()=>{
  for(const mutate of [
    r=>r[3].message.content[0].input.prompt='{}',r=>r[3].wire_tool_inputs[tool].prompt='{}',
    r=>r[6].prompt='{}',r=>r[7].tool_use_result.prompt='{}',
    r=>r[3].message.content[0].name='Read',r=>r[3].message.content[0].name='TaskCreate',
    r=>r[3].message.content.push({...r[3].message.content[0],id:'tool_second'}),
    r=>r[9].message.content.push({type:'tool_use',id:'childtool',name:'Task',input:{}}),
    r=>r[9].message.content.push({type:'tool_result',tool_use_id:tool,content:'x'}),
    r=>r[14].message.content.push({type:'tool_use',id:'late',name:'Agent',input}),
    r=>r[8].wire_tool_inputs={[tool]:input},
    r=>r[3].agent_id=task
  ])rejects(mutate,'input/tool');
  for(const key of ['resume','fork','model','run_in_background','name','team_name'])
    rejects(r=>{r[3].message.content[0].input[key]='x';r[3].wire_tool_inputs[tool][key]='x';},key);
});

test('非同期: 最後だけ採用せず出力を対応付ける。曖昧な候補・非JSON・子の品質シグナル',()=>{
  rejects(r=>r[16].result=JSON.stringify({...output,summary:'すり替え'}),'result mismatch');
  rejects(r=>{r[14].message.content[0].text='説明\\n'+JSON.stringify(output);r[16].result=r[14].message.content[0].text;},'non JSON');
  rejects(r=>{r[8].message.content[0].text=JSON.stringify(output);r[15].result=JSON.stringify(output);},'competing JSON');
  rejects(r=>r[16].structured_output={...output,summary:'すり替え'},'structured mismatch');
  const rows=fixture();rows[9].message.content[0].text='月次データなので許容範囲です。';rows[11].summary=rows[9].message.content[0].text;
  assert.deepEqual(check(rows).audit.child_quality_signals,['invented_freshness_threshold']);
});
