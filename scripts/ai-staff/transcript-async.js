// Offline audit profile for the observed 2.1.296 async stream. NOT an execution/permission gate.
// Accept one causally linked task and two correlated parent turns, never "take the last result".
import {TeamError,validateOutput} from '../../lib/ai-team.js';
import {qualitySignals} from './quality-policy.js';
import {checkServerToolUsage,checkSubagentStats} from './transcript-stats.js';

const fail=reason=>{throw new TeamError(`委任実行の記録を確認できませんでした（非同期: ${reason}）。結果は保存しません`);};
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const canon=v=>Array.isArray(v)?v.map(canon):obj(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const same=(a,b)=>JSON.stringify(canon(a))===JSON.stringify(canon(b));
const keys=(v,ks)=>obj(v)&&same(Object.keys(v).sort(),[...ks].sort());
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const agent=n=>n==='Agent'||n==='Task';
const check=(ok,why)=>{if(!ok)fail(why);};
const withoutUuid=({uuid:ignored,...rest})=>rest;

export function validateAsyncTranscript(rows,{delegate,model,packet,session_id,limits}){
  check(uuid(session_id),'実行前に固定したsession_idが必要');
  check(typeof model==='string'&&model.length>0,'固定モデルが必要');
  let init=null,epoch=-1,call=null,task=null,active=null,cleared=false,launch=false,updated=false,notified=false;
  let childMessages=0,childAssistant=0,childText='',hookEvents=0,rateEvents=0;
  const uuids=new Set(),hooks=new Map(),parentText=['',''],results=[],childIds=new Set(),parentIds=new Map();
  const serverReports=[];
  const packetText=JSON.stringify(canon(packet));
  const exactPrompt=p=>{
    let v;try{v=JSON.parse(p)}catch{fail('promptのJSON');}
    check(typeof p==='string'&&JSON.stringify(v)===p&&JSON.stringify(canon(v))===packetText,'原本prompt');
  };
  const taskIdentity=m=>check(task&&m.task_id===task.task_id&&m.run_id===task.run_id,'task/run ID');
  const checkUsage=u=>serverReports.push(checkServerToolUsage(u));
  for(const m of rows){
    check(obj(m)&&m.session_id===session_id&&uuid(m.uuid)&&!uuids.has(m.uuid),'session/重複イベント');
    uuids.add(m.uuid);
    const parent=m.parent_tool_use_id??null;
    if(results.length)check(m.type==='result'||(results.length===1&&m.type==='system'&&m.subtype==='thinking_tokens'),'結果後のイベント');
    if(parent!==null)check(call&&task&&parent===call.id&&!updated&&!notified&&launch,'子の階層・順序');
    else check(!Object.hasOwn(m,'agent_id')&&!Object.hasOwn(m,'agent_type'),'親の子ID');
    if(m.type==='system'){
      check(parent===null,'system階層');
      if(m.subtype==='hook_started'){
        check(id(m.hook_id)&&!hooks.has(m.hook_id)&&['SessionStart','PreToolUse'].includes(m.hook_event)&&
          typeof m.hook_name==='string','hook開始');
        if(m.hook_event==='PreToolUse')check(call&&!launch,'hook順序');
        hooks.set(m.hook_id,{event:m.hook_event,name:m.hook_name,done:false});hookEvents++;continue;
      }
      if(m.subtype==='hook_response'){
        const h=hooks.get(m.hook_id);
        check(h&&!h.done&&h.event===m.hook_event&&h.name===m.hook_name&&m.exit_code===0&&m.outcome==='success','hook応答');
        if(h.event==='PreToolUse'){
          let value;try{value=JSON.parse(m.stdout||'{}')}catch{fail('hook出力');}
          check(keys(value,[]),'hookはdeny-only');
        }
        h.done=true;hookEvents++;continue;
      }
      if(m.subtype==='init'){
        check(epoch<1&&m.model===model&&m.claude_code_version==='2.1.296'&&m.permissionMode==='dontAsk'&&
          m.apiKeySource==='none'&&Array.isArray(m.mcp_servers)&&m.mcp_servers.length===0&&
          Array.isArray(m.tools)&&m.tools.length===1&&agent(m.tools[0])&&Array.isArray(m.agents)&&m.agents.includes(delegate),'initの安全設定');
        if(init){
          check(notified&&cleared&&same(withoutUuid(init),withoutUuid(m)),'継続initの原因・設定一致');
        }else check(!call,'初期化順序');
        epoch++;init??=m;continue;
      }
      if(m.subtype==='thinking_tokens'){
        // Fixed 2.1.296 emits progress from stream_event in either parent epoch.
        // This metadata never advances task, hook, permission or completion state.
        // Optional user_message_uuid from other producers is deliberately unsupported here.
        check(keys(m,['type','subtype','estimated_tokens','estimated_tokens_delta','uuid','session_id'])&&
          init&&(epoch===0||epoch===1)&&
          [...hooks.values()].every(h=>h.done),'thinking metadataの形・段階');
        check(Number.isSafeInteger(m.estimated_tokens)&&m.estimated_tokens>=0&&
          Number.isSafeInteger(m.estimated_tokens_delta)&&m.estimated_tokens_delta>=0&&
          m.estimated_tokens_delta<=m.estimated_tokens,'thinking metadataの値');
        continue;
      }
      check(init&&epoch===0,'taskイベントの段階');
      if(m.subtype==='background_tasks_changed'){
        check(call&&Array.isArray(m.tasks),'背景一覧');
        if(!active){
          check(!task&&m.tasks.length===1,'背景開始一覧');
          const t=m.tasks[0];
          check(id(t.task_id)&&id(t.run_id)&&t.task_type==='local_agent'&&
            t.subagent_type===delegate&&t.description===call.input.description,'背景担当');
          active=t;
        }else{
          check(notified&&!cleared&&m.tasks.length===0,'背景終了一覧');
          cleared=true;
        }
        continue;
      }
      if(m.subtype==='task_started'){
        check(call&&active&&!task&&id(m.task_id)&&id(m.run_id)&&m.task_id===active.task_id&&
          m.run_id===active.run_id&&m.tool_use_id===call.id&&m.subagent_type===delegate&&
          m.description===call.input.description&&m.task_type==='local_agent'&&
          m.is_backgrounded===true&&m.spawn_depth===1,'task開始');
        exactPrompt(m.prompt);task=m;continue;
      }
      if(m.subtype==='task_updated'){
        taskIdentity(m);
        check(launch&&!updated&&!notified&&childAssistant>0&&
          keys(m.patch,['status','end_time'])&&m.patch.status==='completed'&&
          Number.isFinite(m.patch.end_time)&&m.patch.end_time>0,'task完了更新');
        updated=true;continue;
      }
      if(m.subtype==='task_notification'){
        taskIdentity(m);
        check(updated&&!notified&&m.tool_use_id===call.id&&m.status==='completed'&&
          m.summary===childText&&m.usage?.tool_uses===0,'task完了通知');
        checkServerToolUsage(m.usage);
        notified=true;continue;
      }
      fail('未対応system');
    }
    if(m.type==='rate_limit_event'){
      check(init&&parent===null&&m.rate_limit_info?.status==='allowed'&&
        m.rate_limit_info.isUsingOverage===false&&m.rate_limit_info.overageStatus==='rejected','利用枠/追加使用');
      rateEvents++;continue;
    }
    if(m.type==='result'){
      check(epoch===1&&notified&&cleared&&parent===null&&results.length<2&&
        m.result_index===results.length&&m.subtype==='success'&&m.is_error===false&&
        m.terminal_reason==='completed'&&m.stop_reason==='end_turn'&&m.safety_stops===0&&
        m.api_error_status===null&&m.queued_turn_count===0&&
        Array.isArray(m.permission_denials)&&m.permission_denials.length===0&&
        Number.isInteger(m.num_turns)&&m.num_turns>=1&&m.num_turns<=limits.parent_max_turns,'結果状態・番号');
      checkSubagentStats(m.subagent_stats,{delegate});checkUsage(m.usage);
      check(m.result===parentText[results.length]&&m.result.trim().length>0,'親出力と結果の一致');
      if(results.length===0){
        check(!Object.hasOwn(m,'origin')&&m.structured_output===undefined,'初回結果の出自');
        // The first turn may only be the waiting message, not a competing JSON answer.
        let parsed=false;try{JSON.parse(m.result);parsed=true}catch{}
        check(!parsed,'複数の成果候補');
      }else{
        check(keys(m.origin,['kind','producer','runId'])&&m.origin.kind==='task-notification'&&
          m.origin.producer==='session-task'&&m.origin.runId===task.run_id,'継続結果の出自');
      }
      results.push(m);continue;
    }
    check(['assistant','user'].includes(m.type)&&init,'未対応message');
    const content=m.message?.content;
    check(Array.isArray(content)&&content.length>0&&content.every(c=>obj(c)&&
      ['text','thinking','redacted_thinking','tool_use','tool_result'].includes(c.type)),'内容');
    if(m.wire_tool_inputs!==undefined)check(m.type==='assistant'&&parent===null&&
      content.filter(c=>c.type==='tool_use').length===1,'送信入力の位置');
    if(m.tool_use_result!==undefined||m.tool_result_meta!==undefined)
      check(m.type==='user'&&parent===null&&content.length===1&&content[0].type==='tool_result','起動メタデータの位置');
    if(m.type==='assistant')checkUsage(m.message?.usage);
    else checkServerToolUsage(m.message?.usage);
    if(parent!==null){
      check(m.agent_id===task.task_id&&m.subagent_type===delegate&&m.type==='assistant'&&
        m.message.model===model&&id(m.message.id)&&!parentIds.has(m.message.id),'子のID・モデル');
      check(++childMessages<=limits.max_child_messages,'子メッセージ上限');
      childIds.add(m.message.id);
      check(childIds.size<=limits.child_max_turns,'子ターン上限');
      for(const c of content){
        check(!['tool_use','tool_result'].includes(c.type),'子ツール');
        if(c.type==='text'){check(typeof c.text==='string','子text');childText+=c.text;}
      }
      childAssistant++;continue;
    }
    if(m.type==='assistant'){
      check(m.message.model===model&&id(m.message.id)&&!childIds.has(m.message.id),'親モデル・ID');
      check(!parentIds.has(m.message.id)||parentIds.get(m.message.id)===epoch,'親ターン混在');
      parentIds.set(m.message.id,epoch);
    }
    for(const c of content){
      if(c.type==='text'){
        check(m.type==='assistant'&&typeof c.text==='string','親text');
        parentText[epoch]+=c.text;
      }else if(c.type==='tool_use'){
        check(m.type==='assistant'&&epoch===0&&!call&&id(c.id)&&agent(c.name)&&
          keys(c.input,['description','subagent_type','prompt'])&&c.input.subagent_type===delegate&&
          typeof c.input.description==='string'&&c.input.description.trim().length>0&&c.input.description.length<=200,'委任内容/回数');
        exactPrompt(c.input.prompt);
        check(keys(m.wire_tool_inputs,[c.id])&&same(m.wire_tool_inputs[c.id],c.input),'送信入力一致');
        call=c;
      }else if(c.type==='tool_result'){
        check(m.type==='user'&&epoch===0&&task&&!launch&&c.tool_use_id===call.id&&!c.is_error,'起動応答');
        const r=m.tool_use_result,meta=m.tool_result_meta;
        check(r?.isAsync===true&&r.status==='async_launched'&&r.agentId===task.task_id&&
          r.resolvedModel===model&&r.canReadOutputFile===false&&r.canContinueAgent===false,'子起動確認');
        exactPrompt(r.prompt);
        check(Array.isArray(meta)&&meta.length===1&&meta[0].id===call.id&&
          same(meta[0].permission_decision,{decision:'accept',source:'config'}),'通常権限の承認');
        launch=true;
      }else check(m.type==='assistant','親thinking');
    }
  }
  check(results.length===2&&rateEvents>0&&hooks.size>0&&[...hooks.values()].every(h=>h.done)&&
    childAssistant>0&&childText.trim().length>0,'記録の完全性');
  const turns=results.reduce((sum,r)=>sum+r.num_turns,0);
  check(turns<=limits.parent_max_turns,'親の総ターン上限');
  let output;
  try{output=validateOutput(JSON.parse(results[1].result),packet.facts)}catch{fail('最終JSON/根拠');}
  if(results[1].structured_output!==undefined)
    check(same(results[1].structured_output,output),'構造化成果一致');
  return {output,init_model:model,init_tools:[...init.tools],
    counts:{transcript_lines:rows.length,parent_agent_calls:1,child_messages:childMessages,child_tool_calls:0,
      structured_output_calls:0,permission_denials:0,hook_events:hookEvents},
    result:{num_turns:turns,duration_ms:results.reduce((s,r)=>s+(Number.isFinite(r.duration_ms)?r.duration_ms:0),0),
      duration_api_ms:null,subagent_stats_present:true},
    audit:{profile:'claude-2.1.296-async-v1',session_id,tool_use_id:call.id,task_id:task.task_id,run_id:task.run_id,
      tool_counts_scope:'observed_transcript',server_tool_usage_complete:serverReports.every(Boolean),
      server_tool_calls:serverReports.every(Boolean)?0:null,
      initial_result_index:0,final_result_index:1,child_completed:true,exact_packet:true,
      child_quality_signals:qualitySignals(childText),
      guard_execution_proven:false,quality_approved:false}};
}
