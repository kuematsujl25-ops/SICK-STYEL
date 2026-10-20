import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {hash,PROFILE,verifyApproval,runtimeArgs,runtimeSettings,settingsSnapshot,executeGuarded,verifyGuardEvidence} from '../scripts/ai-staff/delegate-runtime.js';
import {decide} from '../scripts/ai-staff/delegate-guard.js';
import {parseRunArgs} from '../scripts/ai-staff/delegate.js';
import {FIXTURES,fixtureInput} from '../scripts/ai-staff/eval-fixtures.js';
import {createJob,taskPacket} from '../lib/ai-team.js';
const packet=taskPacket(createJob(fixtureInput(FIXTURES[0]))),session=randomUUID(),delegate='ss-data-auditor',model='claude-opus-5-5';
const ctx={packet,delegate,model,inventory:[],source_hash:hash('source')};
const approval=()=>({version:1,profile:PROFILE,token:randomUUID(),delegate,model,packet_sha256:hash(packet),settings_sha256:hash([]),
  source_sha256:ctx.source_hash,checked_at:new Date().toISOString(),subscription_confirmed:true,extra_usage_disabled:true,
  no_additional_charge_confirmed:true,usage_available:true,effective_policy_reviewed:true,no_other_hooks_or_plugins:true,
  no_remote_or_mdm_policy:true,quality_review_required:true});
const setup=()=>{const dir=mkdtempSync(join(tmpdir(),'ss-runtime-test-')),policy=join(dir,'policy.json');
  writeFileSync(policy,JSON.stringify({version:1,session_id:session,delegate,packet,expires_at:new Date(Date.now()+60000).toISOString()}),{mode:0o600});return {dir,policy}};
const tool={hook_event_name:'PreToolUse',session_id:session,tool_name:'Agent',tool_use_id:'toolu_test',
  tool_input:{description:'架空監査',subagent_type:delegate,prompt:JSON.stringify(packet)}};
const startup={hook_event_name:'SessionStart',source:'startup',session_id:session};

test('実行オプトインは固定モデルとrunが必要、承認の欠損・期限・担当/入力/ソース/設定不一致を拒否',()=>{
  assert.ok(parseRunArgs(['x.json','--provider','claude','--delegate',delegate,'--model',model,'--run','--delegation-approval','a.json']));
  for(const flag of ['--run','--model']){const a=['x.json','--provider','claude','--delegate',delegate,'--model',model,'--run','--delegation-approval','a.json'];
    const n=a.indexOf(flag);a.splice(n,flag==='--run'?1:2);assert.throws(()=>parseRunArgs(a));}
  assert.ok(verifyApproval(approval(),ctx));
  for(const key of Object.keys(approval())){const a=approval();delete a[key];assert.throws(()=>verifyApproval(a,ctx),key);}
  for(const patch of [{checked_at:new Date(Date.now()-610000).toISOString()},{checked_at:new Date(Date.now()+10000).toISOString()},
    {extra_usage_disabled:false},{no_remote_or_mdm_policy:false},{packet_sha256:hash('wrong')},{model:'opus'},{token:'abc'}])
    assert.throws(()=>verifyApproval({...approval(),...patch},ctx));
  assert.throws(()=>verifyApproval(approval(),{...ctx,delegate:'ss-profit-inventory'}));
  assert.throws(()=>verifyApproval(approval(),{...ctx,inventory:[{path:'new',sha256:null}]}));
});

test('起動設定:全ツール対象deny-onlyフック・onFailure block・MCPなし、既存policy無効化フラグなし',()=>{
  const settings=runtimeSettings('/safe/guard.js','/safe/policy.json');
  assert.deepEqual(Object.keys(settings),['hooks']);assert.equal(settings.hooks.PreToolUse[0].matcher,'*');
  for(const group of Object.values(settings.hooks))assert.equal(group[0].hooks[0].onFailure,'block');
  const args=runtimeArgs({session,delegate,model,definition:{tools:[]},settings:'/safe/settings.json'});
  assert.equal(args[args.indexOf('--tools')+1],'Agent');assert.ok(args.includes('--include-hook-events'));
  assert.ok(!/disableAllHooks|bypassPermissions|--setting-sources|--restricted|--bare|--safe-mode/.test(args.join(' ')));
});

test('設定不明/フック/プラグイン/環境上書きを無効化せず拒否、設定の変化はhashに反映',()=>{
  const {dir}=setup(),f=join(dir,'settings.json');
  try{
    const before=settingsSnapshot([f]);
    writeFileSync(f,'{}');assert.notEqual(hash(before),hash(settingsSnapshot([f])));
    for(const obj of [{hooks:{PreToolUse:[]}},{enabledPlugins:{x:true}},{env:{ANTHROPIC_API_KEY:'fixture'}},
      {disableAllHooks:true},{apiKeyHelper:'echo fixture'},{unknownFutureSetting:true}]){
      writeFileSync(f,JSON.stringify(obj));assert.throws(()=>settingsSnapshot([f]));assert.deepEqual(JSON.parse(readFileSync(f)),obj);
    }
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('実ガード: startupなしは拒否、startup/一回token/入力hashの証拠がすべて必要',()=>{
  const {dir,policy}=setup();
  try{
    assert.throws(()=>decide([policy,'tool'],JSON.stringify(tool)));assert.ok(!existsSync(join(dir,'used')));
    assert.deepEqual(decide([policy,'startup'],JSON.stringify(startup)),{});
    assert.throws(()=>decide([policy,'startup'],JSON.stringify(startup)));
    assert.deepEqual(decide([policy,'tool'],JSON.stringify(tool)),{});
    assert.throws(()=>decide([policy,'tool'],JSON.stringify(tool)));
    const rows=[{type:'system',subtype:'hook_response',hook_event:'SessionStart',exit_code:0,outcome:'success'},
      {type:'system',subtype:'hook_response',hook_event:'PreToolUse',exit_code:0,outcome:'success'},
      {message:{content:[{type:'tool_use',name:'Agent',id:tool.tool_use_id,input:tool.tool_input}]}}];
    const log=x=>x.map(JSON.stringify).join('\n');
    assert.equal(verifyGuardEvidence(log(rows),dir,session).quality_approved,false);
    for(const mutate of [r=>r.pop(),r=>r.shift(),r=>r.push(r[0]),r=>r[2].message.content[0].input.description='changed']){
      const bad=structuredClone(rows);mutate(bad);assert.throws(()=>verifyGuardEvidence(log(bad),dir,session));
    }
    rmSync(join(dir,'tool.json'));assert.throws(()=>verifyGuardEvidence(log(rows),dir,session));
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('代替プロセス:未ロード/異常hook/別sessionではpromptを送らず停止、正常startupだけが送信を解放',async()=>{
  for(const kind of ['missing-marker','bad-hook','wrong-session','normal']){
    const {dir,policy}=setup();let sent='';
    const spawnProcess=()=>{
      const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();
      p.stdin.on('data',d=>sent+=d);p.stdin.on('finish',()=>queueMicrotask(()=>p.emit('close',0,null)));
      p.kill=()=>queueMicrotask(()=>p.emit('close',null,'SIGKILL'));
      queueMicrotask(()=>{
        if(kind!=='missing-marker')decide([policy,'startup'],JSON.stringify(startup));
        const s=kind==='wrong-session'?randomUUID():session;
        p.stdout.write(JSON.stringify({type:'system',subtype:'hook_started',session_id:s,hook_id:'hook1',hook_event:'SessionStart'})+'\n');
        p.stdout.write(JSON.stringify({type:'system',subtype:'hook_response',session_id:s,hook_id:'hook1',hook_event:'SessionStart',exit_code:kind==='bad-hook'?1:0,outcome:'success',stdout:'{}'})+'\n');
      });return p;
    };
    try{
      const promise=executeGuarded({args:[],cwd:dir,env:{},prompt:'fixture task',session,dir,spawnProcess,timeout:1000});
      if(kind==='normal'){await promise;assert.equal(sent,'fixture task')}
      else{await assert.rejects(promise);assert.equal(sent,'')}
    }finally{rmSync(dir,{recursive:true,force:true})}
  }
});
