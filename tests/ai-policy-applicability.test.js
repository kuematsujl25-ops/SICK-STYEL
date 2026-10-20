import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {applicability,authIdentity} from './helpers/policy-applicability.js';
import {parseApplicabilityDiagnostics,verifyApplicability,readApplicabilityContext,collectApplicability,DOCTOR_REMOTE_LINE} from '../scripts/ai-staff/policy-applicability.js';
import {runtimeArgs,verifyHeadlessLaunch} from '../scripts/ai-staff/delegate-runtime.js';
import {session,delegate,model} from './helpers/async-run.js';
const ok=stdout=>({status:0,signal:null,stdout,stderr:''});
const diagnostics=()=>({context:{executable:applicability().executable,executable_sha256:'a'.repeat(64)},
 version:ok('2.1.296 (Claude Code)\n'),auth:ok(JSON.stringify({...applicability().credential,...authIdentity()})),doctor:ok(DOCTOR_REMOTE_LINE+'\n')});
test('remote適用外はPro保存OAuth・診断成功・cache/profile/override不在の組合せのみ',()=>{
 assert.deepEqual(parseApplicabilityDiagnostics(diagnostics()),applicability());
 for(const patch of [{remote_policy:'confirmed_absent'},{remote_cache:'present'},{anthropic_profiles:'present'},
  {credential_overrides:'present'},{doctor_exit_code:1},{cli_version:'2.1.300 (Claude Code)'},
  {credential:{...applicability().credential,subscriptionType:'team'}},{credential:{...applicability().credential,authMethod:'api_key'}},
  {credential:{...applicability().credential,apiProvider:'gateway'}}])assert.throws(()=>verifyApplicability({...applicability(),...patch}));
 for(const line of ['Managed settings (remote): failed, cached policy applies','Managed settings (remote): none',
  'Managed settings (remote): loaded','Managed settings (remote): fetching',DOCTOR_REMOTE_LINE+'\n'+DOCTOR_REMOTE_LINE]){
  const d=diagnostics();d.doctor=ok(line);assert.throws(()=>parseApplicabilityDiagnostics(d));
 }
 for(const key of ['version','auth','doctor'])for(const patch of [{status:1},{signal:'SIGTERM'},{error:{code:'ETIMEDOUT'}},{stderr:'unknown warning'}]){
  const d=diagnostics();Object.assign(d[key],patch);assert.throws(()=>parseApplicabilityDiagnostics(d));
 }
});
test('実行contextは固定実体、cache/profileの存在・symlink・別HOME/credential/host指定で停止',()=>{
 const home=realpathSync(mkdtempSync(join(tmpdir(),'ss-applicability-'))),env={HOME:home};
 const exe=join(home,'.local/share/claude/versions/2.1.296');
 try{
  mkdirSync(join(home,'.local/bin'),{recursive:true});mkdirSync(join(home,'.local/share/claude/versions'),{recursive:true});
  writeFileSync(exe,'synthetic executable',{mode:0o700});symlinkSync(exe,join(home,'.local/bin/claude'));
  assert.equal(readApplicabilityContext({home,env}).executable,exe);
  for(const key of ['ANTHROPIC_API_KEY','ANTHROPIC_PROFILE','CLAUDE_CODE_OAUTH_TOKEN','XDG_CONFIG_HOME','CLAUDE_CONFIG_DIR','CLAUDECODE','CLAUDE_SESSION_ID'])
   assert.throws(()=>readApplicabilityContext({home,env:{...env,[key]:'synthetic'}}),key);
  for(const rel of ['.claude/remote-settings.json','.config/anthropic']){
   mkdirSync(join(home,rel.split('/')[0]),{recursive:true});writeFileSync(join(home,rel),'{}');
   assert.throws(()=>readApplicabilityContext({home,env}));rmSync(join(home,rel));
   symlinkSync('/synthetic/missing',join(home,rel));assert.throws(()=>readApplicabilityContext({home,env}));rmSync(join(home,rel));
  }
  rmSync(join(home,'.local/bin/claude'));symlinkSync('/synthetic/wrapper',join(home,'.local/bin/claude'));
  assert.throws(()=>readApplicabilityContext({home,env}));
 }finally{rmSync(home,{recursive:true,force:true})}
});
test('再診断は固定実体のread-onlyコマンドだけ、認証/実体の途中変化で停止',()=>{
 const d=diagnostics(),calls=[];let authCount=0;
 const run=(exe,args)=>{calls.push([exe,args]);if(args[0]==='--version')return d.version;if(args[0]==='doctor')return d.doctor;authCount++;return d.auth};
 const options={home:'/synthetic',env:{HOME:'/synthetic'},cwd:'/synthetic/repo',run,readContext:()=>d.context};
 assert.deepEqual(collectApplicability(options),applicability());assert.equal(authCount,2);
 assert.deepEqual(calls.map(x=>x[1]),[['--version'],['auth','status','--json'],['doctor'],['auth','status','--json']]);
 assert.ok(calls.every(x=>x[0]===d.context.executable));
 let reads=0;assert.throws(()=>collectApplicability({...options,readContext:()=>({...d.context,executable_sha256:++reads===1?'a'.repeat(64):'b'.repeat(64)})}));
 let auths=0;assert.throws(()=>collectApplicability({...options,run:(exe,args)=>args[0]==='auth'&&++auths===2?
  ok(JSON.stringify({...applicability().credential,authMethod:'api_key'})):run(exe,args)}));
});
test('fresh非対話起動は固定引数一致のみ、RC/resume/cloud/hosting/未知引数を拒否',()=>{
 for(const mode of ['baseline','delegated']){
  const options={session,delegate,model,definition:{tools:[]},settings:'/synthetic/settings.json',mode};
  const args=runtimeArgs(options),result=verifyHeadlessLaunch({...options,args});
  assert.equal(result.remote_control,'headless_not_requested');assert.equal(result.network_absence_established,false);
  for(const flag of ['--remote-control','--rc','--resume','--continue','--teleport','--remote','--background','--unknown',
   'attach','remote-control','self-hosted-runner','daemon'])assert.throws(()=>verifyHeadlessLaunch({...options,args:[...args,flag]}),flag);
  assert.throws(()=>verifyHeadlessLaunch({...options,args:args.slice(1)}));
  assert.throws(()=>verifyHeadlessLaunch({...options,args:['wrapper',...args]}));
 }
});
