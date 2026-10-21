import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync,readFileSync,chmodSync,symlinkSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {hash,PROFILE,verifyApproval,runtimeArgs,runtimeSettings,settingsSnapshot,executeGuarded,verifyGuardEvidence,BUILTIN_PLUGINS,verifyEffectivePlugins} from '../scripts/ai-staff/delegate-runtime.js';
import {decide,parentAuditRecord} from '../scripts/ai-staff/delegate-guard.js';
import {parseRunArgs} from '../scripts/ai-staff/delegate.js';
import {FIXTURES,fixtureInput} from '../scripts/ai-staff/eval-fixtures.js';
import {createJob,taskPacket} from '../lib/ai-team.js';
const packet=taskPacket(createJob(fixtureInput(FIXTURES[0]))),session=randomUUID(),delegate='ss-data-auditor',model='claude-opus-5-5';
const ctx={packet,delegate,model,inventory:[],source_hash:hash('source')};
const approval=()=>({version:1,profile:PROFILE,mode:'delegated',token:randomUUID(),delegate,model,packet_sha256:hash(packet),settings_sha256:hash([]),
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
    assert.throws(()=>decide([policy,'tool'],JSON.stringify(tool)));
    assert.ok(!existsSync(join(dir,'used')));assert.ok(!existsSync(join(dir,'tool.json')));
    writeFileSync(join(dir,'parent-audit.json'),JSON.stringify(parentAuditRecord(policy)),{mode:0o600});
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

test('no-action設定は全ツール禁止、正しい担当要求でも単回markerを作らない',()=>{
  const {dir,policy}=setup();
  try{
    const settings=runtimeSettings('/safe/guard.js',policy,'baseline');
    assert.equal(settings.hooks.PreToolUse[0].hooks[0].args.at(-1),'deny');
    const args=runtimeArgs({session,delegate,model,definition:{tools:[]},settings:'/safe/settings.json',mode:'baseline'});
    assert.equal(args[args.indexOf('--tools')+1],'');assert.ok(!args.includes('--allowedTools'));
    decide([policy,'startup'],JSON.stringify(startup));
    assert.throws(()=>decide([policy,'deny'],JSON.stringify(tool)));
    assert.ok(!existsSync(join(dir,'used')));assert.ok(!existsSync(join(dir,'tool.json')));
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('stdin後にだけイベントを出すプロセスで成立、欠落/異常startup・init前のrun/resultは拒否',async()=>{
  for(const kind of ['normal','init-first','missing-marker','bad-hook','wrong-session','missing-init','missing-startup',
    'early-result','early-assistant','early-task','early-tool','discord','missing-plugins','mcp','unknown-builtin','stderr','no-events']){
    const {dir,policy}=setup();let sent='',eventsBeforeInput=0;
    const init={type:'system',subtype:'init',session_id:session,claude_code_version:'2.1.296',
      tools:[],model,permissionMode:'dontAsk',apiKeySource:'none',mcp_servers:[],
      plugins:BUILTIN_PLUGINS.map(name=>({name,path:'builtin',source:`${name}@builtin`}))};
    if(kind==='discord')init.plugins.push({name:'discord',path:'/fixture',source:'discord@claude-plugins-official'});
    if(kind==='missing-plugins')delete init.plugins;
    if(kind==='mcp')init.mcp_servers.push({name:'discord',status:'connected'});
    if(kind==='unknown-builtin')init.plugins[0]={name:'new',path:'builtin',source:'new@builtin'};
    const spawnProcess=()=>{
      const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();
      p.stdin.on('data',d=>sent+=d);
      p.kill=()=>queueMicrotask(()=>p.emit('close',null,'SIGKILL'));
      // Unlike the old mock, this process cannot produce any event before stdin EOF.
      p.stdin.on('finish',()=>queueMicrotask(()=>{
        const emit=m=>{if(!sent)eventsBeforeInput++;p.stdout.write(JSON.stringify(m)+'\n')};
        if(kind==='no-events'){p.emit('close',0,null);return}
        if(kind==='stderr'){p.stderr.write('synthetic warning');return}
        if(kind.startsWith('early-')){
          const type={'early-result':'result','early-assistant':'assistant','early-task':'system','early-tool':'assistant'}[kind];
          emit({type,subtype:'task_started',session_id:session,message:{content:kind==='early-tool'?[{type:'tool_use',name:'Agent'}]:[]}});
          return;
        }
        if(kind!=='missing-marker')decide([policy,'startup'],JSON.stringify(startup));
        if(kind==='init-first')emit(init);
        const s=kind==='wrong-session'?randomUUID():session;
        if(kind!=='missing-startup'){
          emit({type:'system',subtype:'hook_started',session_id:s,hook_id:'h1',hook_event:'SessionStart'});
          emit({type:'system',subtype:'hook_response',session_id:s,hook_id:'h1',hook_event:'SessionStart',exit_code:kind==='bad-hook'?1:0,outcome:'success'});
        }
        if(!['missing-init','init-first'].includes(kind))emit(init);
        p.emit('close',0,null);
      }));return p;
    };
    try{
      const result=executeGuarded({args:[],cwd:dir,env:{},prompt:'synthetic no-action',session,dir,spawnProcess,timeout:100,mode:'baseline',model,requirePluginInit:true});
      if(['normal','init-first'].includes(kind)){
        const c=await result;assert.equal(c.prompt_delivery,'after_preflight_before_startup_audit');assert.equal(c.startup_audited,true);assert.equal(c.init_audited,true);
      }else await assert.rejects(result,e=>{assert.equal(e.capture.prompt_released,true);return true});
      assert.equal(sent,'synthetic no-action');assert.equal(eventsBeforeInput,0);
    }finally{rmSync(dir,{recursive:true,force:true})}
  }
  const init={claude_code_version:'2.1.296',mcp_servers:[],plugins:BUILTIN_PLUGINS.map(name=>({name,path:'builtin',source:`${name}@builtin`}))};
  assert.equal(verifyEffectivePlugins(init).discord_process_absence,'not_established');
});


test('Agent同期ガードは親監査の欠落・別session/policy・不正形式/権限/linkをtoken消費前に拒否',()=>{
  for(const kind of ['missing','session','policy','stage','extra','invalid','permissions','symlink','hardlink']){
    const {dir,policy}=setup(),audit=join(dir,'parent-audit.json');
    try{
      decide([policy,'startup'],JSON.stringify(startup));
      const receipt=parentAuditRecord(policy);
      if(kind==='session')receipt.session_id=randomUUID();
      if(kind==='policy')receipt.policy_sha256=hash('different packet');
      if(kind==='stage')receipt.stage='startup';
      if(kind==='extra')receipt.extra=true;
      if(kind!=='missing')writeFileSync(audit,kind==='invalid'?'null':JSON.stringify(receipt),{mode:0o600});
      if(kind==='permissions')chmodSync(audit,0o644);
      if(['symlink','hardlink'].includes(kind)){
        const target=join(dir,'other.json');writeFileSync(target,JSON.stringify(receipt),{mode:0o600});rmSync(audit);
        (kind==='symlink'?symlinkSync:linkSync)(target,audit);
      }
      assert.throws(()=>decide([policy,'tool'],JSON.stringify(tool)),kind);
      assert.ok(!existsSync(join(dir,'used')),kind);assert.ok(!existsSync(join(dir,'tool.json')),kind);
    }finally{rmSync(dir,{recursive:true,force:true})}
  }
});

test('親監査receiptは両イベントの検証後だけ発行し、発行前のAgentを同期拒否する',async()=>{
  for(const order of ['startup-first','init-first','bad-init','missing-startup']){
    const {dir,policy}=setup();
    const spawnProcess=()=>{
      const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();
      p.kill=()=>queueMicrotask(()=>p.emit('close',null,'SIGKILL'));
      p.stdin.on('finish',()=>queueMicrotask(()=>{
        const emit=m=>p.stdout.write(JSON.stringify({...m,session_id:session})+'\n');
        const init={type:'system',subtype:'init',tools:order==='bad-init'?['Bash']:['Agent'],model,permissionMode:'dontAsk',apiKeySource:'none',mcp_servers:[]};
        decide([policy,'startup'],JSON.stringify(startup));
        assert.throws(()=>decide([policy,'tool'],JSON.stringify(tool)));
        if(order==='init-first')emit(init);
        if(order!=='missing-startup'){
          emit({type:'system',subtype:'hook_started',hook_event:'SessionStart',hook_id:'h1'});
          assert.throws(()=>decide([policy,'tool'],JSON.stringify(tool)));
          emit({type:'system',subtype:'hook_response',hook_event:'SessionStart',hook_id:'h1',exit_code:0,outcome:'success'});
        }
        if(order!=='init-first')emit(init);
        if(['startup-first','init-first'].includes(order))assert.deepEqual(decide([policy,'tool'],JSON.stringify(tool)),{});
        else {assert.throws(()=>decide([policy,'tool'],JSON.stringify(tool)));assert.ok(!existsSync(join(dir,'used')));}
        p.emit('close',0,null);
      }));return p;
    };
    try{
      const run=executeGuarded({args:[],cwd:dir,env:{},prompt:'synthetic',session,dir,spawnProcess,model,mode:'delegated',timeout:100});
      if(['startup-first','init-first'].includes(order))await run;else await assert.rejects(run);
    }finally{rmSync(dir,{recursive:true,force:true})}
  }
});


test('重複キーのhook入力はsemantic hash/単回token以前に拒否する',()=>{
 const {dir,policy}=setup();
 try{
  decide([policy,'startup'],JSON.stringify(startup));
  writeFileSync(join(dir,'parent-audit.json'),JSON.stringify(parentAuditRecord(policy)),{mode:0o600});
  for(const text of [JSON.stringify(tool).replace('"tool_name":"Agent"','"tool_name":"Bash","tool_name":"Agent"'),
    JSON.stringify(tool).replace('"description":"架空監査"','"description":"変更","description":"架空監査"')]){
    assert.throws(()=>decide([policy,'tool'],text));assert.ok(!existsSync(join(dir,'used')));
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
});
