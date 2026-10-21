// Guard-only tests (local processes, no model/network). They do not prove Claude Code CLI integration.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chmodSync,existsSync,mkdtempSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {emptyTeam,transitionTeam,taskPacket} from '../lib/ai-team.js';
import {checkEvent,checkPolicy,canonicalJson,GuardDenied,USED_FILE} from '../scripts/ai-staff/delegate-guard.js';

const GUARD=fileURLToPath(new URL('../scripts/ai-staff/delegate-guard.js',import.meta.url));
const now='2026-10-18T01:00:00.000Z';
const facts=[{id:'f1',label:'架空の在庫',value:12,unit:'点',source:'fixture',observed_at:now,kind:'observed'},
  {id:'f2',label:'未取得の原価',value:null,unit:'JPY',source:'fixture',observed_at:now,kind:'observed'}];
const packet=taskPacket(transitionTeam(transitionTeam(emptyTeam(),{action:'toggle',enabled:true},now),
  {action:'create',job:{role:'coo',title:'架空',objective:'TASK-BODY-MARKER 確認する',facts}},now).jobs[0]);
const SESSION=randomUUID();
const prompt=canonicalJson(packet);

function setup({policy={},ttl=10*60*1000}={}){
  const dir=mkdtempSync(join(tmpdir(),'ss-guard-'));
  chmodSync(dir,0o700);
  const file=join(dir,'policy.json');
  writeFileSync(file,JSON.stringify({version:1,session_id:SESSION,delegate:'ss-data-auditor',packet,
    expires_at:new Date(Date.now()+ttl).toISOString(),...policy}),{mode:0o600});
  return {dir,file};
}
const event=(patch={},input={})=>({session_id:SESSION,transcript_path:'/nonexistent/x.jsonl',cwd:'/nonexistent',
  permission_mode:'dontAsk',hook_event_name:'PreToolUse',tool_name:'Agent',tool_use_id:'toolu_1',
  tool_input:{subagent_type:'ss-data-auditor',description:'監査',prompt,...input},...patch});
const run=(args,stdin)=>new Promise(resolve=>{
  const p=spawn(process.execPath,[GUARD,...args],{stdio:['pipe','pipe','pipe']});
  let out='',err='';
  p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);
  p.on('close',code=>resolve({code,out,err}));
  p.stdin.on('error',()=>{});
  p.stdin.end(typeof stdin==='string'?stdin:JSON.stringify(stdin));
});
const denied=async(args,stdin,label)=>{
  const r=await run(args,stdin);
  assert.equal(r.code,2,label);assert.equal(r.out,'',label);
  assert.ok(!r.err.includes('TASK-BODY-MARKER')&&!r.err.includes(SESSION),label);
  return r;
};

test('正しいAgent要求: allow/updatedInputを返さず空JSON・exit0で既存permissionへ委ねる。2回目は拒否',async()=>{
  const {dir,file}=setup();
  const r=await run([file],event());
  assert.equal(r.code,0);assert.deepEqual(JSON.parse(r.out),{});
  assert.ok(!/allow|updatedInput|permissionDecision/.test(r.out));
  assert.equal(readFileSync(join(dir,USED_FILE),'utf8'),'');
  await denied([file],event(),'2回目');
});

test('並列20件でも通過は最多1件',async()=>{
  const {file}=setup();
  const rs=await Promise.all(Array.from({length:20},()=>run([file],event())));
  assert.equal(rs.filter(r=>r.code===0).length,1);
  assert.equal(rs.filter(r=>r.code===2).length,19);
});

test('依頼データの改変（値・null・型・順序・キー・前後の文字）を拒否',async()=>{
  const mut=fn=>{const p=structuredClone(packet);fn(p);return canonicalJson(p);};
  const cases={
    value:mut(p=>{p.facts[0].value=13;}),nullToZero:mut(p=>{p.facts[1].value=0;}),type:mut(p=>{p.facts[0].value='12';}),
    order:mut(p=>{p.facts.reverse();}),extraKey:mut(p=>{p.note='x';}),missingKey:mut(p=>{delete p.title;}),
    objective:mut(p=>{p.objective+='!';}),padded:' '+prompt,tagged:`<untrusted_task_data>${prompt}</untrusted_task_data>`,
    pretty:JSON.stringify(JSON.parse(prompt),null,1),idOnly:JSON.stringify({job_id:packet.job_id}),
    duplicateKey:prompt.replace('{','{"version":2,'),notJson:'TASK',
  };
  for(const [label,p] of Object.entries(cases)){const {file}=setup();await denied([file],event({},{prompt:p}),label);}
});

test('引数・追加キー・委任先・セッション・子・他ツール・不正入力・上限超過を拒否',async()=>{
  const {tool_input:base}=event();
  const cases=[
    ['model',event({},{model:'claude-opus-5-5'})],['resume',event({},{resume:'x'})],['background',event({},{run_in_background:true})],
    ['missing description',event({tool_input:{subagent_type:base.subagent_type,prompt}})],
    ['wrong agent',event({},{subagent_type:'ss-qa-security'})],['builtin agent',event({},{subagent_type:'general-purpose'})],
    ['session',event({session_id:randomUUID()})],['child agent_id',event({agent_id:'a1'})],['child agent_type null',event({agent_type:null})],
    ['TaskCreate',event({tool_name:'TaskCreate'})],['agent lowercase',event({tool_name:'agent'})],
    ['fork',event({},{fork:true})],['fork session',event({},{fork_session:true})],['Bash',event({tool_name:'Bash',tool_input:{command:'true'}})],
    ['StructuredOutput',event({tool_name:'StructuredOutput',tool_input:{}})],['PostToolUse',event({hook_event_name:'PostToolUse'})],
    ['malformed','{not json'],['array','[]'],['empty',''],['oversize',JSON.stringify(event({pad:'x'.repeat(300*1024)}))],
  ];
  for(const [label,stdin] of cases){const {dir,file}=setup();await denied([file],stdin,label);assert.ok(!existsSync(join(dir,USED_FILE)),label);}
  const {file}=setup();
  await denied([],event(),'no args');await denied([file,'extra'],event(),'extra args');
  await denied(['policy.json'],event(),'relative');await denied([file+'/../policy.json'],event(),'non-normalized');
});

test('policy不正（期限切れ・長すぎる期限・形式・symlink・権限）はfail closed',async()=>{
  for(const [label,opt] of [['expired',{ttl:-1000}],['long ttl',{ttl:2*60*60*1000}],
    ['bad session',{policy:{session_id:'abc'}}],['bad delegate',{policy:{delegate:'general-purpose'}}],
    ['bad packet',{policy:{packet:{...packet,objective:'改変'}}}],['extra key',{policy:{allow:true}}]]){
    const {file}=setup(opt);await denied([file],event(),label);
  }
  {const {dir,file}=setup();const link=join(dir,'link.json');symlinkSync(file,link);await denied([link],event(),'symlink');}
  {const {file}=setup();chmodSync(file,0o644);await denied([file],event(),'file perms');}
  {const {dir,file}=setup();chmodSync(dir,0o755);await denied([file],event(),'dir perms');}
  {const {dir,file}=setup();writeFileSync(join(dir,USED_FILE),'');await denied([file],event(),'pre-used');}
  {const dir=mkdtempSync(join(tmpdir(),'ss-guard-'));chmodSync(dir,0o700);const file=join(dir,'policy.json');
    writeFileSync(file,'{bad',{mode:0o600});await denied([file],event(),'malformed policy');}
});

test('純粋関数: checkPolicy/checkEventは許可値を返さず、不正はGuardDenied',()=>{
  const policy=checkPolicy({version:1,session_id:SESSION,delegate:'ss-data-auditor',packet,expires_at:new Date(Date.now()+60000).toISOString()});
  assert.equal(checkEvent(event(),policy),true);
  assert.throws(()=>checkEvent(event({tool_name:'Read'}),policy),GuardDenied);
  assert.throws(()=>checkPolicy({version:1,session_id:SESSION,delegate:'ss-data-auditor',packet,expires_at:'never'}),GuardDenied);
});

 test('Agent/Task互換は同一の一回枠・拒否条件を共有する',async()=>{
  for(const tool_name of ['Agent','Task']){
    const {file}=setup();
    const ok=await run([file],event({tool_name}));assert.equal(ok.code,0);assert.equal(ok.out,'{}');
    await denied([file],event({tool_name:tool_name==='Agent'?'Task':'Agent'}),'alias cannot reset once');
    for(const patch of [{subagent_type:'ss-qa-security'},{model:'opus'},{resume:'x'},{fork:true},{run_in_background:false}]){
      const {file}=setup();await denied([file],event({tool_name},patch),'same input restrictions');
    }
    const {file:child}=setup();await denied([child],event({tool_name,agent_id:'child'}),'child alias');
  }
 });
