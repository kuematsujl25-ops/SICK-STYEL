import {provenance,authorizationScope} from '../scripts/ai-staff/observation-provenance.js';
import {identityFromAuth} from '../scripts/ai-staff/account-identity.js';
import {applicability,authIdentity} from './helpers/policy-applicability.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {Utf8Capture,bytesHash} from '../scripts/ai-staff/utf8-capture.js';
import {saveEvidence,readEvidence,createEvidenceDirectory} from '../scripts/ai-staff/run-evidence.js';
import {executeGuarded,replayRunEvidence,PROFILE,hash,runtimeArgs,runtimeSettings} from '../scripts/ai-staff/delegate-runtime.js';
import {validateComparisonBaseline} from '../scripts/ai-staff/transcript-baseline.js';
import {parseRunArgs,LIMITS,analysisPrompt,delegatePrompt} from '../scripts/ai-staff/delegate.js';
import {FIXTURES,fixtureInput} from '../scripts/ai-staff/eval-fixtures.js';
import {createJob,taskPacket} from '../lib/ai-team.js';
const packet=taskPacket(createJob(fixtureInput(FIXTURES[0]))),session=randomUUID(),model='claude-opus-5-5',delegate='ss-data-auditor';
const output={summary:'売上は未確認。原価が未取得です。📦',fact_ids:['d1'],missing_data:['原価'],hypotheses:[],recommendations:[],approvals_required:['本人確認'],limitations:['架空データ']};
const row=m=>({session_id:session,uuid:randomUUID(),...m});
const startupRows=()=>[row({type:'system',subtype:'hook_started',hook_event:'SessionStart',hook_id:'hook1',hook_name:'SessionStart:startup'}),
 row({type:'system',subtype:'hook_response',hook_event:'SessionStart',hook_id:'hook1',hook_name:'SessionStart:startup',exit_code:0,outcome:'success',stdout:'{}'})];
const baselineRows=()=>[...startupRows(),row({type:'system',subtype:'init',claude_code_version:'2.1.296',model,tools:[],mcp_servers:[],apiKeySource:'none',permissionMode:'dontAsk'}),
 row({type:'rate_limit_event',rate_limit_info:{status:'allowed',isUsingOverage:false,overageStatus:'rejected'}}),
 row({type:'assistant',message:{model,content:[{type:'text',text:JSON.stringify(output)}]}}),
 row({type:'result',result:JSON.stringify(output),subtype:'success',is_error:false,terminal_reason:'completed',stop_reason:'end_turn',safety_stops:0,api_error_status:null,queued_turn_count:0,permission_denials:[],num_turns:1})];
const jsonl=rows=>rows.map(JSON.stringify).join('\n')+'\n';

test('UTF-8: 日本語/4byte/結合文字を全バイト位置・1byteずつ分割しても元bytesと本文を保持',()=>{
 const text='売上は未確認📦・e\u0301・𠮷・意図された置換文字�\n',raw=Buffer.from(text);
 for(let i=0;i<=raw.length;i++){
  const c=new Utf8Capture(10000);c.write(raw.subarray(0,i));c.write(raw.subarray(i));const r=c.end();
  assert.equal(r.text,text);assert.deepEqual(r.raw,raw);assert.equal(r.raw_bytes_sha256,bytesHash(raw));assert.equal(r.decoded_utf8_sha256,bytesHash(Buffer.from(text)));assert.equal(r.utf8_valid,true);
 }
 const c=new Utf8Capture(10000);for(const byte of raw)c.write(Buffer.from([byte]));assert.equal(c.end().text,text);
});

test('UTF-8: 不正列・途中切れを拒否、byte上限と元bytes hashを保持し置換して成功させない',()=>{
 for(const raw of [Buffer.from([0xff]),Buffer.from([0xe5,0x41]),Buffer.from([0xf0,0x9f]),Buffer.from([0xc0,0xaf])]){
  const c=new Utf8Capture(100);try{c.write(raw)}catch{}const r=c.end();assert.equal(r.utf8_valid,false);assert.deepEqual(r.raw,raw);assert.equal(r.raw_bytes_sha256,bytesHash(raw));
 }
 const c=new Utf8Capture(3);assert.throws(()=>c.write(Buffer.from('売上')));const r=c.end();assert.equal(r.truncated,true);assert.equal(r.bytes_seen,6);assert.equal(r.bytes_stored,3);assert.equal(r.utf8_valid,false);
});

test('実executor代替: JSONL全バイト位置でchunk分割しても日本語を破損せず、監査も同じ結果',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ss-chunk-'));
 writeFileSync(join(dir,'started.json'),JSON.stringify({stage:'startup',session_id:session}),{mode:0o600});
 const original=jsonl(baselineRows()),raw=Buffer.from(original);
 const launch=chunks=>()=>{
  const p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();
  p.stdin.on('finish',()=>queueMicrotask(()=>p.emit('close',0,null)));p.kill=()=>queueMicrotask(()=>p.emit('close',null,'SIGKILL'));
  queueMicrotask(()=>{for(const chunk of chunks)p.stdout.write(chunk)});return p;
 };
 try{
  for(let i=0;i<=raw.length;i++){
   const r=await executeGuarded({args:[],cwd:dir,env:{},prompt:'fixture',session,dir,model,mode:'baseline',spawnProcess:launch([raw.subarray(0,i),raw.subarray(i)])});
   assert.equal(r.stdout.text,original,'split '+i);assert.deepEqual(r.stdout.raw,raw);
   assert.deepEqual(validateComparisonBaseline(r.stdout.text,{packet,model,session_id:session,limits:LIMITS}).output,output);
  }
  const bad=Buffer.concat([Buffer.from(jsonl(startupRows())),Buffer.from([0xf0,0x9f])]);
  await assert.rejects(executeGuarded({args:[],cwd:dir,env:{},prompt:'fixture',session,dir,mode:'baseline',spawnProcess:launch([bad])}),e=>e.capture.stdout.utf8_valid===false);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('比較条件: モデル/指示/ターン/effort/timeout/stream-json共通、差は委譲toolと例外指示',()=>{
 const options={session,delegate,model,definition:{tools:[]},settings:'/safe/settings.json'};
 const parent=runtimeArgs({...options,mode:'baseline'}),delegated=runtimeArgs(options),value=(a,key)=>a[a.indexOf(key)+1];
 for(const f of ['--model','--max-turns','--effort','--output-format','--permission-mode','--mcp-config'])assert.equal(value(parent,f),value(delegated,f));
 assert.equal(value(parent,'--tools'),'');assert.equal(value(delegated,'--tools'),'Agent');assert.ok(!parent.includes('--json-schema')&&!delegated.includes('--json-schema'));
 assert.ok(delegatePrompt(packet,delegate).endsWith(analysisPrompt(packet)));
 assert.equal(runtimeSettings('/g','/p','baseline').hooks.PreToolUse[0].hooks[0].args.at(-1),'deny');
 assert.ok(parseRunArgs(['x.json','--provider','claude','--model',model,'--run','--comparison-baseline','--delegation-approval','a.json']));
 assert.throws(()=>parseRunArgs(['x.json','--provider','claude','--run','--comparison-baseline']));
 assert.throws(()=>parseRunArgs(['x.json','--provider','claude','--model',model,'--run','--comparison-baseline','--delegate',delegate,'--delegation-approval','a.json']));
});

test('親単独監査: 追加tool・余分な結果・別model・過剰turn・失敗・overageを拒否',()=>{
 for(const mutate of [r=>r[2].tools.push('Agent'),r=>r[4].message.content.push({type:'tool_use',name:'Read'}),r=>r.push(row(r.at(-1))),
  r=>r[2].model='other',r=>r[5].num_turns=99,r=>r[5].is_error=true,r=>r[3].rate_limit_info.isUsingOverage=true]){
  const rows=baselineRows();mutate(rows);assert.throws(()=>validateComparisonBaseline(jsonl(rows),{packet,model,session_id:session,limits:LIMITS}));
 }
});

test('私有証拠: cleanup後もraw/marker/承認を再監査でき、改変・欠落・権限緩和を拒否',()=>{
 const root=mkdtempSync(join(tmpdir(),'ss-evidence-')),dir=createEvidenceDirectory(root),source_hash=hash('fixture source');
 const stdout=jsonl(baselineRows()),c=new Utf8Capture(4000000);c.write(Buffer.from(stdout));const capture=c.end(),{raw,text,...meta}=capture;
 const approval={version:1,profile:PROFILE,mode:'baseline',token:randomUUID(),delegate,model,packet_sha256:hash(packet),settings_sha256:hash([]),source_sha256:source_hash,
  checked_at:new Date().toISOString(),subscription_confirmed:true,extra_usage_disabled:true,no_additional_charge_confirmed:true,usage_available:true,
  effective_policy_reviewed:true,no_other_hooks_or_plugins:true,no_remote_or_mdm_policy:true,quality_review_required:true};
 try{
  const proof=saveEvidence(dir,{'stdout.bytes':raw,'stdout.utf8.txt':text,'started.json':JSON.stringify({stage:'startup',session_id:session}),
   'approval-token.used':'','approval.json':JSON.stringify(approval),'packet.json':JSON.stringify(packet),'inventory.json':'[]'},
   {audit_status:'accepted',mode:'baseline',session,delegate,model,source_sha256:source_hash,started_at:new Date().toISOString(),streams:{stdout:meta},execution:{exit_code:0,signal:null,prompt_released:true,stopped:false}});
  assert.equal(statSync(dir).mode&0o777,0o700);assert.equal(statSync(join(dir,'stdout.bytes')).mode&0o777,0o600);
  assert.equal(readEvidence(dir,proof.manifest_sha256).files['stdout.bytes'].equals(raw),true);
  assert.deepEqual(replayRunEvidence(dir,proof.manifest_sha256).checked.output,output);
  assert.equal(replayRunEvidence(dir,proof.manifest_sha256).quality_approved,false);
  writeFileSync(join(dir,'stdout.bytes'),'changed');assert.throws(()=>replayRunEvidence(dir,proof.manifest_sha256));
  writeFileSync(join(dir,'stdout.bytes'),raw);rmSync(join(dir,'started.json'));assert.throws(()=>replayRunEvidence(dir,proof.manifest_sha256));
  symlinkSync(join(dir,'packet.json'),join(dir,'started.json'));assert.throws(()=>readEvidence(dir,proof.manifest_sha256));
  assert.throws(()=>readEvidence(dir,hash('wrong anchor')));
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('委譲の私有証拠: 元作業dir削除後も実ガードmarkerと非同期全文を再照合、used/tool欠落を拒否',async()=>{
 const f=await import('./helpers/async-run.js'),{decide}=await import('../scripts/ai-staff/delegate-guard.js');
 const root=mkdtempSync(join(tmpdir(),'ss-delegated-evidence-')),work=join(root,'work');mkdirSync(work,{mode:0o700});
 const policy=join(work,'policy.json');writeFileSync(policy,JSON.stringify({version:1,session_id:f.session,delegate:f.delegate,packet:f.packet,expires_at:new Date(Date.now()+60000).toISOString()}),{mode:0o600});
 decide([policy,'startup'],JSON.stringify({hook_event_name:'SessionStart',source:'startup',session_id:f.session}));
 decide([policy,'tool'],JSON.stringify({hook_event_name:'PreToolUse',tool_name:'Agent',tool_use_id:f.tool,tool_input:f.input,session_id:f.session}));
 const rows=f.fixture();rows.splice(4,0,
  {session_id:f.session,uuid:randomUUID(),type:'system',subtype:'hook_started',hook_event:'PreToolUse',hook_id:'guard_tool',hook_name:'PreToolUse:Agent'},
  {session_id:f.session,uuid:randomUUID(),type:'system',subtype:'hook_response',hook_event:'PreToolUse',hook_id:'guard_tool',hook_name:'PreToolUse:Agent',exit_code:0,outcome:'success',stdout:'{}'});
 const c=new Utf8Capture(4000000);c.write(Buffer.from(jsonl(rows)));const {raw,text,...meta}=c.end(),source_hash=hash('fixture');
 const approval={version:1,profile:PROFILE,mode:'delegated',token:randomUUID(),delegate:f.delegate,model:f.model,packet_sha256:hash(f.packet),settings_sha256:hash([]),source_sha256:source_hash,
  checked_at:new Date().toISOString(),subscription_confirmed:true,extra_usage_disabled:true,no_additional_charge_confirmed:true,usage_available:true,
  effective_policy_reviewed:true,no_other_hooks_or_plugins:true,no_remote_or_mdm_policy:true,quality_review_required:true};
 const files={'stdout.bytes':raw,'stdout.utf8.txt':text,'approval-token.used':'','approval.json':JSON.stringify(approval),'packet.json':JSON.stringify(f.packet),'inventory.json':'[]'};
 for(const n of ['policy.json','started.json','tool.json','used'])files[n]=readFileSync(join(work,n));
 const dir=createEvidenceDirectory(root);
 try{
  const proof=saveEvidence(dir,files,{audit_status:'accepted',mode:'delegated',session:f.session,delegate:f.delegate,model:f.model,source_sha256:source_hash,
    started_at:new Date().toISOString(),streams:{stdout:meta},execution:{exit_code:0,signal:null,prompt_released:true,stopped:false}});
  rmSync(work,{recursive:true,force:true});
  assert.deepEqual(replayRunEvidence(dir,proof.manifest_sha256).checked.output,f.output);
  assert.equal(replayRunEvidence(dir,proof.manifest_sha256).guardEvidence.one_shot,true);
  for(const n of ['used','tool.json']){const old=readFileSync(join(dir,n));rmSync(join(dir,n));assert.throws(()=>replayRunEvidence(dir,proof.manifest_sha256));writeFileSync(join(dir,n),old,{mode:0o600});}
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('限定plugin証拠のreplay:旧承認再利用・設定差分・consent/policy欠損を拒否',async()=>{
 const {sessionPluginBinding,SESSION_PLUGIN_PROFILE}=await import('../scripts/ai-staff/session-plugin-binding.js');
 const {SESSION_PLUGIN_IDS}=await import('../scripts/ai-staff/session-plugin-plan.js');
 const {BUILTIN_PLUGINS,verifyHeadlessLaunch}=await import('../scripts/ai-staff/delegate-runtime.js');
 const root=mkdtempSync(join(tmpdir(),'ss-plugin-replay-')),time=new Date().toISOString(),source=hash('fixture source');
 const inventory=[{path:'/synthetic/settings.json',sha256:hash('fixture')}];
 const envelope=kind=>({version:1,observer:'assistant',kind,checked_at:time,identity_sha256:applicability().identity.identity_sha256});
 const policyEvidence=JSON.stringify({...envelope('policy'),cli:applicability(),endpoint:{dep_enrolled:false,mdm_enrolled:false,inventory_sha256:hash(inventory)}});
 const consentEvidence=JSON.stringify({version:1,authority:'user',identity_sha256:applicability().identity.identity_sha256,
  source_references:[{author:'user',thread_id:'synthetic',message_ref:'synthetic-user-message',quote:'synthetic user consent'}],
  scope:authorizationScope({mode:'baseline',delegate,model,packet})});
 const observation={version:3,managed_policy:'confirmed_absent',remote_policy:'not_applicable_to_current_credential',remote_control:'headless_not_requested',remote_applicability:applicability(),
  observation:provenance('policy'),evidence_ref:'/synthetic/policy',evidence_sha256:hash(policyEvidence),checked_at:time};
 const usageEvidence=JSON.stringify({...envelope('usage'),account:{url:'https://claude.ai/settings/account',account_sha256:applicability().identity.account_sha256},
  usage:{url:'https://claude.ai/settings/usage',subscription_type:'pro',extra_usage_enabled:false,session_used_percent:0,weekly_used_percent:4}});
 const usage={version:2,source:'claude.ai_account_and_usage_ui',observation:provenance('usage'),checked_at:time,
  browser_account_sha256:applicability().identity.account_sha256,cli_identity_sha256:applicability().identity.identity_sha256,
  subscription_type:'pro',extra_usage_enabled:false,usage_available:true,evidence_ref:'/synthetic/usage',evidence_sha256:hash(usageEvidence)};
 const usageText=JSON.stringify(usage);
 const policyText=JSON.stringify(observation);
 const state={inventory,policyObservation:observation,planInput:{managedState:'confirmed_absent',
  userSettings:{enabledPlugins:Object.fromEntries(SESSION_PLUGIN_IDS.map(id=>[id,true])),
   extraKnownMarketplaces:{'openai-codex':{source:{source:'github',repo:'openai/codex-plugin-cc'}}},
   theme:'dark',inputNeededNotifEnabled:true,agentPushNotifEnabled:true},
  installed:Object.fromEntries(SESSION_PLUGIN_IDS.map(id=>[id,{version:'fixture',tree_sha256:hash(id)}]))}};
 const token=randomUUID();
 const binding=sessionPluginBinding({...state,cliVersion:'2.1.296 (Claude Code)',mode:'baseline',packet,model,sourceHash:source,policyObservationHash:hash(policyText),usageObservationHash:hash(usageText),userAuthorizationHash:hash(consentEvidence),identitySha256:applicability().identity.identity_sha256,token,checkedAt:time});
 const approval={version:1,profile:SESSION_PLUGIN_PROFILE,mode:'baseline',token,delegate,model,
  packet_sha256:hash(packet),settings_sha256:hash(inventory),source_sha256:source,checked_at:time,
  subscription_confirmed:true,extra_usage_disabled:true,no_additional_charge_confirmed:true,usage_available:true,
  effective_policy_reviewed:true,no_other_hooks_or_plugins:true,no_mdm_policy:true,policy_applicability_reviewed:true,quality_review_required:true,
  identity_sha256:applicability().identity.identity_sha256,usage_observation_sha256:hash(usageText),binding_sha256:binding.binding_sha256,plugin_ids:[...SESSION_PLUGIN_IDS],session_only_three_plugins:true,
  codex_plugin_hooks_absent_acknowledged:true,persistent_settings_changes_allowed:false,managed_override_allowed:false,
  other_plugins_disabled_allowed:false,independent_review_confirmed:true,remote_control:'headless_not_requested',remote_policy:'not_applicable_to_current_credential',
  approval_evidence_ref:'/synthetic/consent',approval_evidence_sha256:hash(consentEvidence)};
 const rows=baselineRows();rows[2].plugins=BUILTIN_PLUGINS.map(name=>({name,path:'builtin',source:`${name}@builtin`}));
 const capture=new Utf8Capture(4000000);capture.write(Buffer.from(jsonl(rows)));const {raw,text,...meta}=capture.end();
 const definitionText=readFileSync(join(process.cwd(),'scripts/ai-staff/agents',delegate+'.md'),'utf8');
 const {agentDefinition}=await import('../scripts/ai-staff/delegate.js');
 const definition=agentDefinition(delegate,definitionText),options={session,delegate,model,definition,settings:'/synthetic/settings.json',mode:'baseline'};
 const args=runtimeArgs(options),invocation={args,session,delegate,model,mode:'baseline'};
 const launch=verifyHeadlessLaunch({...options,args});
 const files={'definition.txt':definitionText,'invocation.json':JSON.stringify(invocation),
  'usage-observation.json':usageText,'usage-evidence.txt':usageEvidence,'live-applicability.json':JSON.stringify(applicability()),'launch-applicability.json':JSON.stringify(launch),'stdout.bytes':raw,'stdout.utf8.txt':text,'started.json':JSON.stringify({stage:'startup',session_id:session}),
  'approval-token.used':'','approval.json':JSON.stringify(approval),'packet.json':JSON.stringify(packet),
  'inventory.json':JSON.stringify(inventory),'final-inventory.json':JSON.stringify(inventory),'plugin-state.json':JSON.stringify(state),
  'plugin-binding.json':JSON.stringify(binding),'policy-observation.json':policyText,'policy-evidence.txt':policyEvidence,
  'consent-evidence.txt':consentEvidence,'settings.json':JSON.stringify(runtimeSettings('/guard','/policy','baseline',binding))};
 const metadata={audit_status:'accepted',mode:'baseline',session,delegate,model,source_sha256:source,cli_version:'2.1.296 (Claude Code)',
  started_at:time,streams:{stdout:meta},execution:{exit_code:0,signal:null,prompt_released:true,stopped:false}};
 try{
  const check=f=>{const dir=createEvidenceDirectory(root),proof=saveEvidence(dir,f,metadata);return ()=>replayRunEvidence(dir,proof.manifest_sha256)};
  assert.deepEqual(check(files)().checked.output,output);
  // Re-anchor altered bundles to test semantic checks independently of per-file integrity checks.
  for(const patch of [
   ...[{email:'other@example.com'},{orgId:'22222222-2222-4222-8222-222222222222'}].map(p=>({'live-applicability.json':JSON.stringify({...applicability(),identity:identityFromAuth({...authIdentity(),...p})})})),
   {'usage-observation.json':JSON.stringify({...usage,browser_account_sha256:'c'.repeat(64)})},
   {'usage-evidence.txt':'changed'},{'approval.json':JSON.stringify({...approval,identity_sha256:'c'.repeat(64)})},{'live-applicability.json':JSON.stringify({...applicability(),remote_cache:'present'})},
   {'invocation.json':JSON.stringify({...invocation,args:[...args,'--resume']})},
   {'launch-applicability.json':JSON.stringify({...launch,remote_control:'disconnected'})},{'final-inventory.json':'[]'},{'consent-evidence.txt':'changed'},{'policy-evidence.txt':'changed'},
   {'approval.json':JSON.stringify({...approval,profile:PROFILE})},{'approval.json':JSON.stringify({...approval,token:'invalid'})},
   {'approval.json':JSON.stringify({...approval,mode:'delegated'})},{'settings.json':JSON.stringify({enabledPlugins:{}})}])
    assert.throws(check({...files,...patch}));
  for(const name of ['policy-observation.json','plugin-binding.json','consent-evidence.txt','final-inventory.json','live-applicability.json','launch-applicability.json','usage-observation.json','usage-evidence.txt']){
   const bad={...files};delete bad[name];assert.throws(check(bad));
  }
 }finally{rmSync(root,{recursive:true,force:true})}
});
