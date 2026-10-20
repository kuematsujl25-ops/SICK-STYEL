import {TeamError,validateOutput} from '../../lib/ai-team.js';
// Narrow print/stream-json profile for the no-tools half of a paired evaluation. Unknown shapes stop.
export function validateComparisonBaseline(stdout,{packet,model,session_id,limits}){
  const fail=()=>{throw new TeamError('親単独比較の記録が未確認です。成果物は保存しません');};
  let rows;try{rows=stdout.trim().split('\n').map(x=>JSON.parse(x))}catch{fail()}
  if(rows.length>limits.max_transcript_lines)fail();
  const uuids=new Set();let init=null,hook=null,hookDone=false,result=null,text='',rates=0,turns=0;
  for(const m of rows){
    if(!m||m.session_id!==session_id||typeof m.uuid!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(m.uuid)||
      uuids.has(m.uuid)||m.parent_tool_use_id!=null||m.agent_id!==undefined||m.agent_type!==undefined||result)fail();
    uuids.add(m.uuid);
    if(m.type==='system'){
      if(m.subtype==='hook_started'){
        if(hook||m.hook_event!=='SessionStart'||typeof m.hook_id!=='string')fail();hook=m;continue;
      }
      if(m.subtype==='hook_response'){
        if(!hook||hookDone||m.hook_id!==hook.hook_id||m.hook_name!==hook.hook_name||m.hook_event!=='SessionStart'||
          m.exit_code!==0||m.outcome!=='success'||!['','{}'].includes(m.stdout||''))fail();hookDone=true;continue;
      }
      if(m.subtype!=='init'||init||!hookDone||m.claude_code_version!=='2.1.296'||m.model!==model||
        m.apiKeySource!=='none'||m.permissionMode!=='dontAsk'||!Array.isArray(m.tools)||m.tools.length||
        !Array.isArray(m.mcp_servers)||m.mcp_servers.length)fail();init=m;continue;
    }
    if(!init)fail();
    if(m.type==='rate_limit_event'){
      if(m.rate_limit_info?.status!=='allowed'||m.rate_limit_info.isUsingOverage!==false||m.rate_limit_info.overageStatus!=='rejected')fail();rates++;continue;
    }
    if(m.type==='assistant'){
      if(m.message?.model!==model||!Array.isArray(m.message.content)||++turns>limits.parent_max_turns)fail();
      for(const c of m.message.content){if(!c||!['text','thinking','redacted_thinking'].includes(c.type))fail();
        if(c.type==='text'){if(typeof c.text!=='string')fail();text+=c.text;}}
      continue;
    }
    if(m.type!=='result'||m.result!==text||m.structured_output!==undefined||m.subtype!=='success'||m.is_error!==false||
      m.terminal_reason!=='completed'||m.stop_reason!=='end_turn'||m.safety_stops!==0||m.api_error_status!==null||
      m.queued_turn_count!==0||!Array.isArray(m.permission_denials)||m.permission_denials.length||
      !Number.isInteger(m.num_turns)||m.num_turns<1||m.num_turns>limits.parent_max_turns||
      m.origin!==undefined||(m.subagent_stats!==undefined&&m.subagent_stats.spawned!==0))fail();
    result=m;
  }
  if(!result||!rates||!hookDone)fail();
  let output;try{output=validateOutput(JSON.parse(text),packet.facts)}catch{fail()}
  return {output,init_model:model,init_tools:[],counts:{transcript_lines:rows.length,parent_agent_calls:0,child_tool_calls:0,hook_events:2},
    result:{num_turns:result.num_turns},audit:{profile:'claude-2.1.296-baseline-v1',quality_approved:false}};
}
