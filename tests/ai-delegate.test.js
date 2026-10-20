import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {TeamError,emptyTeam,transitionTeam,taskPacket,buildPrompt} from '../lib/ai-team.js';
import {claudeEnv,subscriptionEnv} from '../scripts/ai-staff/cli.js';
import {parseRunArgs,agentDefinition,loadDelegateDefinition,delegateEnv,versionAtLeast,checkDelegateCli,
  claudeBaselineArgs,claudeDelegateArgs,delegatePrompt,validateTranscript,buildManifest,delegationUnavailable,
  DELEGATION_UNAVAILABLE,DELEGATES,CHILD_DISALLOWED,LIMITS} from '../scripts/ai-staff/delegate.js';

const now='2026-10-18T01:00:00.000Z';
const facts=[{id:'f1',label:'架空の在庫',value:12,unit:'点',source:'fixture',observed_at:now,kind:'observed'},
  {id:'f2',label:'未取得の原価',value:null,unit:'JPY',source:'fixture',observed_at:now,kind:'observed'}];
const packetOf=(objective,list=facts)=>taskPacket(transitionTeam(transitionTeam(emptyTeam(),{action:'toggle',enabled:true},now),
  {action:'create',job:{role:'coo',title:'架空',objective,facts:list}},now).jobs[0]);
const packet=packetOf('TASK-BODY-MARKER 確認する');
// Realistic child prompt: exactly the original packet JSON, including every facts value.
const childPrompt=JSON.stringify(packet);
// Non-operational reference definitions, read as plain text for offline validation only.
const sourceText=name=>readFileSync(fileURLToPath(new URL(`../scripts/ai-staff/agents/${name}.md`,import.meta.url)),'utf8');
const output=()=>({summary:'SECRET-SUMMARY-MARKER 原価が未取得のため利益は判断できません。',fact_ids:['f1'],missing_data:['原価'],
  hypotheses:[],recommendations:[],approvals_required:['本人確認'],limitations:['架空のテストデータ']});
const AG='toolu_agent_1';
const transcript=(patch={})=>[
  {type:'system',subtype:'hook_started',hook_name:'SessionStart'},
  {type:'system',subtype:'init',model:'claude-sonnet-5-5',tools:['Agent'],mcp_servers:[],apiKeySource:'none',
    permissionMode:'dontAsk',agents:['ss-data-auditor'],...patch.init},
  {type:'assistant',parent_tool_use_id:null,message:{content:[{type:'text',text:'委任します'},
    {type:'tool_use',id:AG,name:'Agent',input:{subagent_type:'ss-data-auditor',description:'監査',prompt:childPrompt,...patch.agentInput}}]}},
  {type:'user',parent_tool_use_id:AG,message:{content:'監査してください'}},
  {type:'assistant',parent_tool_use_id:AG,message:{content:[{type:'thinking',thinking:'…'},{type:'text',text:'所見: f1'}]}},
  {type:'user',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:AG,content:'所見: f1'}]}},
  {type:'result',subtype:'success',is_error:false,num_turns:2,duration_ms:1200,duration_api_ms:1000,
    permission_denials:[],structured_output:output(),...patch.result}];
const jsonl=msgs=>msgs.map(m=>JSON.stringify(m)).join('\n')+'\n';
const check=(msgs,opts={})=>validateTranscript(typeof msgs==='string'?msgs:jsonl(msgs),{delegate:'ss-data-auditor',model:'claude-sonnet-5-5',packet,...opts});
const rejects=(msgs,label)=>assert.throws(()=>check(msgs),e=>e instanceof TeamError&&/結果は保存しません/.test(e.message)&&!e.message.includes('SECRET-SUMMARY-MARKER'),label);
const edit=fn=>{const t=transcript();fn(t);return t;};

test('引数: 不明・重複・Codexでの委任・未知の委任先/モデルを認証前に拒否',()=>{
  assert.deepEqual(parseRunArgs(['t.json']),{filename:'t.json',provider:'codex',delegate:null,model:null,run:false});
  assert.deepEqual(parseRunArgs(['t.json','--provider','claude','--delegate','ss-qa-security','--model','claude-opus-5-5','--run']),
    {filename:'t.json',provider:'claude',delegate:'ss-qa-security',model:'claude-opus-5-5',run:true});
  for(const args of [[],['--run'],['t.json','--run','--run'],['t.json','--provider','claude','--provider','claude'],
    ['t.json','--provider','claude','--delegate','general-purpose'],['t.json','--delegate','ss-data-auditor'],
    ['t.json','--provider','codex','--model','claude-opus-5-5'],['t.json','--provider','claude','--model','opus'],
    ['t.json','--provider','claude','--max-turns','50'],['t.json','--provider=claude'],['t.json','--provider','paid-api'],
    ['t.json','--provider','claude','--delegate'],['t.json','--provider','claude','--delegate','--run'],
    ['t.json','--provider','claude','--resume','x'],['t.json','--plan']])
    assert.throws(()=>parseRunArgs(args),TeamError,JSON.stringify(args));
});

test('通常委任実行: 停止中のため定義読込・起動引数・CLI確認は無条件に失敗し、プロセスを呼ばない',()=>{
  let calls=0;const run=()=>{calls++;return {status:0,stdout:'2.1.296 (Claude Code)',stderr:''};};
  const definition=agentDefinition('ss-data-auditor',sourceText('ss-data-auditor'));
  const attempts=[()=>delegationUnavailable(),()=>loadDelegateDefinition('ss-data-auditor'),
    ()=>loadDelegateDefinition('ss-data-auditor',fileURLToPath(new URL('../scripts/ai-staff/agents',import.meta.url))),
    ()=>loadDelegateDefinition('../secrets'),()=>checkDelegateCli({},run),
    ()=>checkDelegateCli(delegateEnv({PATH:'/bin',SICKSTYLE_ENABLE_DELEGATION:'1'}),run),
    ()=>claudeDelegateArgs({delegate:'ss-data-auditor',definition,schema:'{}',model:'claude-sonnet-5-5'}),
    ()=>claudeDelegateArgs({delegate:'ss-qa-security',definition:{...definition,tools:['Read']},schema:'{}'})];
  for(const attempt of attempts)
    assert.throws(attempt,e=>e instanceof TeamError&&e.message===DELEGATION_UNAVAILABLE);
  assert.equal(calls,0,'no subprocess/auth call');
});

test('委任先定義（非稼働の参考資料）: 3担当は道具なし・委任不可・dontAsk・maxTurns 8で、改変は拒否',()=>{
  assert.deepEqual([...DELEGATES].sort(),['ss-data-auditor','ss-profit-inventory','ss-qa-security']);
  for(const name of DELEGATES){
    const text=sourceText(name);const d=agentDefinition(name,text);
    assert.deepEqual(d.tools,[]);assert.equal(d.model,'inherit');assert.equal(d.permissionMode,'dontAsk');
    assert.equal(d.maxTurns,8);assert.deepEqual([...d.disallowedTools].sort(),[...CHILD_DISALLOWED].sort());
    assert.match(d.prompt,/SICK STYLE専用/);assert.match(d.prompt,/分析のみ/);assert.match(d.prompt,/null/);
    assert.match(d.prompt,/fact ID/);assert.match(d.prompt,/架空/);
    for(const [from,to] of [['tools: []','tools: [Read]'],['maxTurns: 8','maxTurns: 50'],['model: inherit','model: claude-opus-5-5'],
      ['permissionMode: dontAsk','permissionMode: bypassPermissions'],['Agent, Task, ','Task, '],[`name: ${name}`,'name: other'],
      ['maxTurns: 8\n','maxTurns: 8\nhooks: x\n']])
      assert.throws(()=>agentDefinition(name,text.replace(from,to)),TeamError,from);
  }
  assert.throws(()=>agentDefinition('../secrets',sourceText('ss-data-auditor')),TeamError);
});

test('環境変数: API認証・Claude Code上書き・Node注入を除外し、自動メモリ無効と委任上限を固定',()=>{
  const source={PATH:'/bin',HOME:'/Users/x',USER:'x',CLAUDE_CONFIG_DIR:'/Users/x/.claude',ANTHROPIC_API_KEY:'fake',
    anthropic_auth_token:'fake',CLAUDE_CODE_OAUTH_TOKEN:'fake',CLAUDE_CODE_USE_BEDROCK:'1',CLAUDE_CODE_SUBAGENT_MODEL:'x',
    CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH:'9',CLAUDE_CODE_DISABLE_AUTO_MEMORY:'0',NODE_OPTIONS:'--require /tmp/x.js',
    CODEX_API_KEY:'fake',OPENAI_API_KEY:'fake'};
  assert.deepEqual(claudeEnv(source),{PATH:'/bin',HOME:'/Users/x',USER:'x',CLAUDE_CONFIG_DIR:'/Users/x/.claude',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1'});
  assert.equal(subscriptionEnv(source).CODEX_API_KEY,undefined);
  const env=delegateEnv(source);
  assert.equal(env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH,'1');assert.equal(env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS,'2');
  assert.equal(env.ANTHROPIC_API_KEY,undefined);assert.equal(env.NODE_OPTIONS,undefined);
});

test('CLI版判定（純粋関数）: 2.1.296以上だけを受理',()=>{
  for(const v of ['2.1.296 (Claude Code)','2.1.300','2.2.0','3.0.0\n'])assert.ok(versionAtLeast(v),v);
  for(const v of ['2.1.295 (Claude Code)','2.0.999','1.9.9','','v2.1.296','unknown'])assert.ok(!versionAtLeast(v),v);
});

test('起動引数: 既定はツールなし・空MCP・委任設定なし、フック無効化なし',()=>{
  const baseline=claudeBaselineArgs({schema:'{}'});
  assert.equal(baseline[baseline.indexOf('--tools')+1],'');assert.ok(!baseline.includes('--model'));
  assert.equal(baseline[baseline.indexOf('--output-format')+1],'json');
  assert.equal(baseline[baseline.indexOf('--mcp-config')+1],'{"mcpServers":{}}');assert.ok(baseline.includes('--strict-mcp-config'));
  for(const f of ['--agents','--allowedTools','--permission-mode','--max-turns'])assert.ok(!baseline.includes(f),f);
  const withModel=claudeBaselineArgs({schema:'{}',model:'claude-sonnet-5-5'});
  assert.equal(withModel[withModel.indexOf('--model')+1],'claude-sonnet-5-5');
  for(const a of [...baseline,...withModel])assert.ok(!/disableAllHooks|bypassPermissions|dangerously|--setting-sources|--resume|--continue|--fork|safe-mode/.test(a),a);
});

test('委任プロンプト（提案文・純粋関数）: 基本指示を保持し、委任先1回だけ・依頼JSONそのままを明示',()=>{
  const prompt=delegatePrompt(packet,'ss-data-auditor');
  assert.ok(prompt.endsWith(buildPrompt(packet)),'baseline prompt unchanged');
  assert.match(prompt,/subagent_type="ss-data-auditor" を1回だけ/);assert.match(prompt,/他のエージェント・他のツール/);
  assert.match(prompt,/JSON1行だけ/);assert.ok(buildPrompt(packet).includes('\n'+childPrompt+'\n'),'child prompt is the embedded packet JSON');
  assert.throws(()=>delegatePrompt(packet,'general-purpose'),TeamError);
});

test('記録検証（事後・確認専用）: 正常な委任1回の記録だけを受理し、件数・モデル・ツールを返す',()=>{
  const r=check(transcript());
  assert.equal(r.init_model,'claude-sonnet-5-5');assert.deepEqual(r.init_tools,['Agent']);
  assert.deepEqual(r.counts,{transcript_lines:7,parent_agent_calls:1,child_messages:2,child_tool_calls:0,
    structured_output_calls:0,permission_denials:0,hook_events:1});
  assert.equal(r.output.fact_ids[0],'f1');
  assert.equal(check(transcript(),{model:null}).init_model,'claude-sonnet-5-5');
  // Key order does not matter; the canonical parsed JSON must be identical.
  const reordered=JSON.stringify(Object.fromEntries(Object.entries(packet).reverse()));
  assert.notEqual(reordered,childPrompt);assert.equal(check(transcript({agentInput:{prompt:reordered}})).counts.parent_agent_calls,1);
  // SDK structured-output tool: accepted only after delegation, once, with identical validated input.
  const so=edit(t=>{t[1].tools=['Agent','StructuredOutput'];t.splice(6,0,
    {type:'assistant',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'toolu_so',name:'StructuredOutput',input:output()}]}},
    {type:'user',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:'toolu_so',content:'ok'}]}});});
  assert.equal(check(so).counts.structured_output_calls,1);
});

test('記録検証: 敵対的・不完全な記録はすべて保存前に拒否し、出力内容を表示しない',()=>{
  const child=(content)=>edit(t=>t.splice(4,0,{type:'assistant',parent_tool_use_id:AG,message:{content}}));
  const cases={
    'child tool_use':child([{type:'tool_use',id:'c1',name:'Read',input:{file_path:'/etc/hosts'}}]),
    'child Agent':child([{type:'tool_use',id:'c1',name:'Agent',input:{subagent_type:'general-purpose',prompt:'x'}}]),
    'child tool_result':edit(t=>t.splice(4,0,{type:'user',parent_tool_use_id:AG,message:{content:[{type:'tool_result',tool_use_id:'c1',content:'x'}]}})),
    'depth 2':edit(t=>t.splice(4,0,{type:'assistant',parent_tool_use_id:'toolu_grandchild',message:{content:[{type:'text',text:'x'}]}})),
    'child after agent result':edit(t=>t.splice(6,0,{type:'assistant',parent_tool_use_id:AG,message:{content:[{type:'text',text:'late'}]}})),
    'parent Bash':edit(t=>t[2].message.content.push({type:'tool_use',id:'b1',name:'Bash',input:{command:'ls'}})),
    'parent TaskCreate':edit(t=>t[2].message.content[1].name='TaskCreate'),
    'fork':transcript({agentInput:{fork:true}}),
    'missing description':edit(t=>delete t[2].message.content[1].input.description),
    'duplicate JSON key':transcript({agentInput:{prompt:childPrompt.replace('{','{"version":2,')}}),
    'parent SendMessage':edit(t=>t[2].message.content.push({type:'tool_use',id:'s1',name:'SendMessage',input:{}})),
    'two Agent calls':edit(t=>t.splice(6,0,{type:'assistant',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'toolu_2',name:'Agent',input:{subagent_type:'ss-data-auditor',description:'x',prompt:'x'}}]}})),
    'builtin agent':transcript({agentInput:{subagent_type:'general-purpose'}}),
    'other specialist':transcript({agentInput:{subagent_type:'ss-qa-security'}}),
    'resume':transcript({agentInput:{resume:'agent-1'}}),
    'model override':transcript({agentInput:{model:'opus'}}),
    'background':transcript({agentInput:{run_in_background:true}}),
    'team':transcript({agentInput:{team_name:'x',name:'y'}}),
    'empty prompt':transcript({agentInput:{prompt:' '}}),
    'prompt not the packet':transcript({agentInput:{prompt:'<untrusted_task_data>{}</untrusted_task_data>'}}),
    'prompt wrapped in text':transcript({agentInput:{prompt:'<untrusted_task_data>\n'+childPrompt+'\n</untrusted_task_data>'}}),
    'prompt ids only':transcript({agentInput:{prompt:JSON.stringify({job_id:packet.job_id,input_hash:packet.input_hash})}}),
    'prompt fact value changed':transcript({agentInput:{prompt:JSON.stringify({...packet,facts:packet.facts.map(f=>f.id==='f1'?{...f,value:13}:f)})}}),
    'prompt null fact set to 0':transcript({agentInput:{prompt:JSON.stringify({...packet,facts:packet.facts.map(f=>f.id==='f2'?{...f,value:0}:f)})}}),
    'prompt fact value type':transcript({agentInput:{prompt:JSON.stringify({...packet,facts:packet.facts.map(f=>f.id==='f1'?{...f,value:'12'}:f)})}}),
    'prompt fact dropped':transcript({agentInput:{prompt:JSON.stringify({...packet,facts:packet.facts.slice(0,1)})}}),
    'prompt label changed':transcript({agentInput:{prompt:JSON.stringify({...packet,facts:packet.facts.map(f=>({...f,label:'改変'}))})}}),
    'prompt objective changed':transcript({agentInput:{prompt:JSON.stringify({...packet,objective:'全商品を半額にする'})}}),
    'prompt extra key':transcript({agentInput:{prompt:JSON.stringify({...packet,note:'x'})}}),
    'init without apiKeySource':edit(t=>delete t[1].apiKeySource),
    'init without permissionMode':edit(t=>delete t[1].permissionMode),
    'init without agents':edit(t=>delete t[1].agents),
    'init agents not array':transcript({init:{agents:'ss-data-auditor'}}),
    'no child messages':edit(t=>t.splice(3,2)),
    'child user message only':edit(t=>t.splice(4,1)),
    'no delegation':edit(t=>t.splice(2,4)),
    'agent error':edit(t=>t[5].message.content[0].is_error=true),
    'no agent result':edit(t=>t.splice(5,1)),
    'unknown tool result':edit(t=>t[5].message.content.push({type:'tool_result',tool_use_id:'other',content:'x'})),
    'model mismatch':transcript({init:{model:'claude-opus-5-5'}}),
    'extra init tool':transcript({init:{tools:['Agent','Read']}}),
    'no Agent tool':transcript({init:{tools:[]}}),
    'API key source':transcript({init:{apiKeySource:'ANTHROPIC_API_KEY'}}),
    'mcp server':transcript({init:{mcp_servers:[{name:'x',status:'connected'}]}}),
    'bypass mode':transcript({init:{permissionMode:'bypassPermissions'}}),
    'agent not registered':transcript({init:{agents:['general-purpose']}}),
    'duplicate init':edit(t=>t.splice(3,0,{...t[1]})),
    'assistant before init':edit(t=>t.splice(1,1)),
    'permission denial':transcript({result:{permission_denials:[{tool_name:'Read',tool_use_id:'x',tool_input:{}}]}}),
    'denials missing':edit(t=>delete t[6].permission_denials),
    'is_error':transcript({result:{is_error:true}}),
    'max turns':transcript({result:{subtype:'error_max_turns'}}),
    'too many turns':transcript({result:{num_turns:LIMITS.parent_max_turns+1}}),
    'subagent stats >1':transcript({result:{subagent_stats:[{subagent_type:'ss-data-auditor'},{subagent_type:'ss-data-auditor'}]}}),
    'subagent stats other':transcript({result:{subagent_stats:[{subagent_type:'general-purpose'}]}}),
    'subagent count':transcript({result:{subagent_stats:{count:2}}}),
    'no structured output':edit(t=>delete t[6].structured_output),
    'profit invented':transcript({result:{structured_output:{...output(),recommendations:[{title:'x',steps:['x'],kpi:'x',estimated_profit_jpy:100000,cost_jpy:null,effort_hours:null,evidence_ids:['f1'],risks:['x']}]}}}),
    'null fact as evidence':transcript({result:{structured_output:{...output(),fact_ids:['f2']}}}),
    'extra output key':transcript({result:{structured_output:{...output(),post_to_instagram:true}}}),
    'partial (no result)':edit(t=>t.pop()),
    'output after result':edit(t=>t.push({type:'assistant',parent_tool_use_id:null,message:{content:[{type:'text',text:'x'}]}})),
    'unknown type':edit(t=>t.splice(3,0,{type:'stream_event',event:{}})),
    'unknown system':edit(t=>t.splice(3,0,{type:'system',subtype:'task_started'})),
    'unknown content':edit(t=>t[4].message.content.push({type:'server_tool_use',name:'web_search'})),
    'structured before delegation':edit(t=>t.splice(2,0,{type:'assistant',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'so',name:'StructuredOutput',input:output()}]}})),
    'structured mismatch':edit(t=>t.splice(6,0,{type:'assistant',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'so',name:'StructuredOutput',input:{...output(),summary:'別内容'}}]}},
      {type:'user',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:'so',content:'ok'}]}})),
  };
  for(const [label,msgs] of Object.entries(cases))rejects(msgs,label);
  for(const raw of ['','not json\n',jsonl(transcript()).replace('"type":"result"','"type":"result"}{'),'[1,2]\n',
    jsonl(transcript())+'x'.repeat(LIMITS.max_transcript_bytes),'{}\n'.repeat(LIMITS.max_transcript_lines+1)])
    rejects(raw,'raw '+raw.slice(0,20));
  assert.throws(()=>validateTranscript(jsonl(transcript()),{delegate:'general-purpose',packet}),TeamError);
  // The expected original packet is mandatory and must itself be intact; a different packet never matches.
  const strict=opts=>assert.throws(()=>validateTranscript(jsonl(transcript()),{delegate:'ss-data-auditor',model:'claude-sonnet-5-5',...opts}),
    e=>e instanceof TeamError&&/結果は保存しません/.test(e.message),JSON.stringify(Object.keys(opts)));
  strict({});strict({packet:null});strict({facts});
  strict({packet:{...packet,facts:packet.facts.map(f=>f.id==='f1'?{...f,value:13}:f)}});
  strict({packet:packetOf('TASK-BODY-MARKER 確認する',facts.map(f=>f.id==='f1'?{...f,value:13}:f))});
  strict({packet:packetOf('TASK-BODY-MARKER 確認する')});
});

test('子のメッセージ上限は文字列・配列・混在形式のすべてに適用',()=>{
  for(const kind of ['string','array','mixed']){
    const messages=count=>{
      const t=transcript();
      const users=Array.from({length:count},(_,i)=>({type:'user',parent_tool_use_id:AG,
        message:{content:kind==='string'||kind==='mixed'&&i%2===0?'入力':[{type:'text',text:'入力'}]}}));
      // Replace the original user + assistant with one assistant followed by count user messages.
      t.splice(3,2,t[4],...users);return t;
    };
    assert.equal(check(messages(LIMITS.max_child_messages-1)).counts.child_messages,LIMITS.max_child_messages,kind);
    assert.throws(()=>check(messages(LIMITS.max_child_messages)),/委任先の出力上限/,kind);
  }
});

test('実行記録（純粋関数）: ハッシュと件数だけを含め、依頼・出力・記録の本文を含めない',()=>{
  const stdout=jsonl(transcript());const checked=check(transcript());
  const m=buildManifest({mode:'delegated',packet,execution_id:'e',delegate:'ss-data-auditor',model:'claude-sonnet-5-5',
    cli_version:'2.1.296',definition:agentDefinition('ss-data-auditor',sourceText('ss-data-auditor')),prompt:delegatePrompt(packet,'ss-data-auditor'),
    stdout,output:checked.output,checked,started_at:now,finished_at:now,elapsed_ms:5});
  const text=JSON.stringify(m);
  for(const marker of ['TASK-BODY-MARKER','SECRET-SUMMARY-MARKER','所見','untrusted_task_data'])assert.ok(!text.includes(marker),marker);
  assert.equal(m.raw_transcript_persisted,false);assert.equal(m.limits.parent_max_turns,12);
  assert.equal(m.counts.child_tool_calls,0);assert.equal(m.init_model,'claude-sonnet-5-5');
  assert.match(m.hashes.transcript_sha256,/^[0-9a-f]{64}$/);assert.equal(m.hashes.input_hash,packet.input_hash);
});

test('記録のAgent/Task互換は正確な2名称のみ、二重委任・別担当・子・再開は拒否',()=>{
  for(const initName of ['Agent','Task'])for(const callName of ['Agent','Task']){
    const t=transcript({init:{tools:[initName]}});t[2].message.content[1].name=callName;
    assert.equal(check(t).counts.parent_agent_calls,1);
    for(const extra of [{resume:'x'},{fork:true},{model:'opus'},{subagent_type:'ss-qa-security'}]){
      const bad=structuredClone(t);Object.assign(bad[2].message.content[1].input,extra);rejects(bad,'alias constraints');
    }
    const child=structuredClone(t);child[4].message.content.push({type:'tool_use',id:'child',name:callName,input:{}});rejects(child,'child alias');
    const twice=structuredClone(t);twice[2].message.content.push({...twice[2].message.content[1],id:'second',name:callName==='Agent'?'Task':'Agent'});rejects(twice,'combined count');
  }
  for(const tools of [['Agent','Task'],['Task','Task'],['task'],['AgentTask'],['TaskCreate'],['Task','Read']])rejects(transcript({init:{tools}}),'exact tools');
});
