// Synthetic protocol only; no saved model output or real customer data.
import {emptyTeam,transitionTeam,taskPacket} from '../../lib/ai-team.js';
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
export {packet,fixture,model,delegate,session,output,input,tool};
