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
