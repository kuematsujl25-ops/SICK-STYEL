// Opt-in orchestration. Approval is a private, operator-reviewed, single-use receipt, never model input.
// Unknown policy sources/hooks are a blocker; this module does not disable or rewrite existing policy.
import {readFileSync,writeFileSync,lstatSync,openSync,closeSync,mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {TeamError} from '../../lib/ai-team.js';
import {checkSubscription} from './cli.js';
import {agentDefinition,delegateEnv,delegatePrompt,validateTranscript,DELEGATES,KNOWN_MODELS,LIMITS,isDelegationTool} from './delegate.js';

const fail=()=>{throw new TeamError('委任の承認・設定・ガード証拠を確認できません。モデル再試行・成果物取込は行いません');};
export const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export const ROLE_DELEGATE=Object.freeze({coo:'ss-data-auditor',profit_inventory:'ss-profit-inventory',social:'ss-qa-security'});
export const PROFILE='claude-2.1.296-deny-only-v1';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const privateFile=path=>{
  if(!isAbsolute(path)||resolve(path)!==path)fail();
  const s=lstatSync(path),d=lstatSync(dirname(path));
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>262144||(s.mode&0o077)||
    !d.isDirectory()||d.isSymbolicLink()||(d.mode&0o077)||
    (process.getuid&&(s.uid!==process.getuid()||d.uid!==process.getuid())))fail();
  return readFileSync(path,'utf8');
};
// Human verifies /status + doctor and all effective policy sources. Local inventory is an additional
// change detector, not a claim that remote/MDM/plugin policy can be discovered by reading these files.
export function settingsPaths(root,home=homedir()){
  const paths=[join(home,'.claude/settings.json'),join(home,'.claude/settings.local.json'),
    join(home,'.claude/managed-settings.json'),join(home,'.claude/plugins/installed_plugins.json'),
    '/Library/Application Support/ClaudeCode/managed-settings.json',
    '/Library/Managed Preferences/com.anthropic.claudecode.plist',
    join(home,'Library/Preferences/com.anthropic.claudecode.plist')];
  for(let dir=resolve(root);;dir=dirname(dir)){
    paths.push(join(dir,'.claude/settings.json'),join(dir,'.claude/settings.local.json'));
    if(dirname(dir)===dir)break;
  }
  return [...new Set(paths)].sort();
}
export function settingsSnapshot(paths){
  return paths.map(path=>{
    if(!existsSync(path))return {path,sha256:null};
    const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>1_000_000)fail();
    const text=readFileSync(path,'utf8');
    // This initial profile supports no externally executing hooks/plugins/env/auth helpers.
    // Block instead of disabling them. MDM/binary policies require a separately reviewed profile.
    if(!path.endsWith('.json'))fail();
    let value;try{value=JSON.parse(text)}catch{fail()}
    if(!value||typeof value!=='object'||Array.isArray(value))fail();
    if(path.endsWith('installed_plugins.json')){
      if(Object.keys(value.plugins||{}).length)fail();
    }else{
      const supported=new Set(['permissions','model','language','alwaysThinkingEnabled','hooks','env','enabledPlugins','extraKnownMarketplaces']);
      if(Object.keys(value).some(key=>!supported.has(key)))fail();
      for(const key of ['hooks','env','enabledPlugins','extraKnownMarketplaces'])
        if(value[key]!==undefined&&Object.keys(value[key]||{}).length)fail();
      for(const key of ['disableAllHooks','allowManagedHooksOnly','apiKeyHelper','forceLoginMethod','gateway','pluginConfigs'])
        if(value[key]!==undefined)fail();
    }
    return {path,sha256:hash(text)};
  });
}
export function verifyApproval(a,{packet,delegate,model,inventory,source_hash,now=Date.now()}){
  const when=Date.parse(a?.checked_at);
  if(a?.version!==1||a.profile!==PROFILE||!uuid(a.token)||a.delegate!==delegate||ROLE_DELEGATE[packet.role]!==delegate||
    !DELEGATES.includes(delegate)||!KNOWN_MODELS.includes(model)||a.model!==model||a.packet_sha256!==hash(packet)||
    a.settings_sha256!==hash(inventory)||a.source_sha256!==source_hash||!Number.isFinite(when)||when>now||now-when>600000||
    a.subscription_confirmed!==true||a.extra_usage_disabled!==true||a.no_additional_charge_confirmed!==true||
    a.usage_available!==true||a.effective_policy_reviewed!==true||a.no_other_hooks_or_plugins!==true||
    a.no_remote_or_mdm_policy!==true||a.quality_review_required!==true)fail();
  return a;
}
export function runtimeArgs({session,delegate,model,definition,settings}){
  if(!uuid(session)||!DELEGATES.includes(delegate)||!KNOWN_MODELS.includes(model)||!isAbsolute(settings))fail();
  return ['-p','--model',model,'--session-id',session,'--tools','Agent','--permission-mode','dontAsk',
    '--settings',settings,'--agents',JSON.stringify({[delegate]:definition}),'--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
    '--disable-slash-commands','--no-session-persistence','--max-turns',String(LIMITS.parent_max_turns),
    '--output-format','stream-json','--verbose','--include-hook-events','--forward-subagent-text',
    '--allowedTools',`Agent(${delegate})`,'--disallowedTools','Bash','Read','Write','Edit','Grep','Glob','WebFetch','WebSearch','SendMessage'];
}
export function runtimeSettings(guard,policy){
  const hook=mode=>({type:'command',command:process.execPath,args:[guard,policy,mode],timeout:8,onFailure:'block'});
  return {hooks:{SessionStart:[{matcher:'startup',hooks:[hook('startup')]}],PreToolUse:[{matcher:'*',hooks:[hook('tool')]}]}};
}
// No user prompt is delivered until a successful startup hook AND its private marker are observed.
// CLI variants that wait for stdin before SessionStart time out, without receiving the task prompt.
export function executeGuarded({args,cwd,env,prompt,session,dir,spawnProcess=spawn,model=null,timeout=LIMITS.timeout_ms}){
  return new Promise((resolveResult,reject)=>{
    let out='',err='',pending='',released=false,stopped=false,calls=0,startId=null;
    const child=spawnProcess('claude',args,{cwd,env,detached:true,stdio:['pipe','pipe','pipe']});
    const stop=()=>{stopped=true;try{if(child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL')}catch{child.kill('SIGKILL')}};
    const timer=setTimeout(stop,timeout);
    const startTimer=setTimeout(()=>{if(!released)stop()},15000);
    child.on('error',()=>{clearTimeout(timer);clearTimeout(startTimer);reject(new TeamError('委任CLIを起動できません。自動再試行しません'));});
    child.stdout.on('data',buf=>{
      out+=buf;pending+=buf;
      if(Buffer.byteLength(out)>LIMITS.max_transcript_bytes){stop();return}
      let end;
      while(!stopped&&(end=pending.indexOf('\n'))>=0){
        const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line.trim())continue;
        let m;try{m=JSON.parse(line);if(!m||typeof m!=='object'||Array.isArray(m))throw 0}catch{stop();break}
        if(m.session_id!==session){stop();break}
        if(m.type==='system'&&m.subtype==='hook_started'&&m.hook_event==='SessionStart'){
          if(startId!==null){stop();break}startId=m.hook_id;
        }else if(m.type==='system'&&m.subtype==='hook_response'&&m.hook_event==='SessionStart'){
          if(released||!startId||m.hook_id!==startId||m.exit_code!==0||m.outcome!=='success'||!['','{}'].includes(m.stdout||'')){stop();break}
          try{const receipt=JSON.parse(privateFile(join(dir,'started.json')));
            if(receipt.session_id!==session||receipt.stage!=='startup')fail();
          }catch{stop();break}
          released=true;clearTimeout(startTimer);child.stdin.end(prompt);
        }else if(!released){stop();break}
        if(m.type==='system'&&m.subtype==='init'&&(!Array.isArray(m.tools)||m.tools.length!==1||!isDelegationTool(m.tools[0])||
          (model!==null&&m.model!==model)||m.permissionMode!=='dontAsk'||m.apiKeySource!=='none'||m.mcp_servers?.length))stop();
        if(m.type==='system'&&String(m.subtype).startsWith('hook_')&&!['SessionStart','PreToolUse'].includes(m.hook_event))stop();
        if(m.type==='system'&&m.subtype==='hook_response'&&(m.exit_code!==0||m.outcome!=='success'||!['','{}'].includes(m.stdout||'')))stop();
        if(m.type==='rate_limit_event'&&(m.rate_limit_info?.status!=='allowed'||m.rate_limit_info?.isUsingOverage!==false))stop();
        for(const c of Array.isArray(m.message?.content)?m.message.content:[])
          if(!c||typeof c!=='object'||c.type==='tool_use'&&(m.parent_tool_use_id||!isDelegationTool(c.name)||++calls>1))stop();
        if(m.type==='result'&&(m.is_error||m.permission_denials?.length))stop();
      }
    });
    child.stderr.on('data',buf=>{err+=buf;if(err.trim()||Buffer.byteLength(err)>100000)stop()});
    child.stdin.on('error',stop);
    child.on('close',(code,signal)=>{clearTimeout(timer);clearTimeout(startTimer);
      if(stopped||!released||code!==0||signal||pending.trim())reject(new TeamError('委任ガード・CLI記録が未確認または異常です。成果物は保存しません'));
      else resolveResult(out);
    });
  });
}
export function verifyGuardEvidence(stdout,dir,session){
  const rows=stdout.trim().split('\n').map(l=>JSON.parse(l));
  const calls=rows.flatMap(m=>(m.message?.content||[]).filter?.(c=>c.type==='tool_use')||[]);
  if(calls.length!==1)fail();
  const receipt=JSON.parse(privateFile(join(dir,'tool.json')));
  if(receipt.session_id!==session||receipt.stage!=='tool'||receipt.tool_use_id!==calls[0].id||
    receipt.tool_name!==calls[0].name||receipt.input_sha256!==hash(calls[0].input)||!existsSync(join(dir,'used')))fail();
  const hooks=rows.filter(m=>m.type==='system'&&m.subtype==='hook_response');
  if(hooks.length!==2||hooks.filter(m=>m.hook_event==='SessionStart').length!==1||
    hooks.filter(m=>m.hook_event==='PreToolUse').length!==1||hooks.some(m=>m.exit_code!==0||m.outcome!=='success'))fail();
  return {startup:true,pre_tool_use:true,one_shot:true,input_sha256:receipt.input_sha256,quality_approved:false};
}
export async function runDelegated({root,packet,delegate,model,approvalPath}){
  // No model/auth subprocess before the explicit receipt and settings checks.
  if(!DELEGATES.includes(delegate)||!KNOWN_MODELS.includes(model)||ROLE_DELEGATE[packet.role]!==delegate||
    process.platform!=='darwin'||process.env.CLAUDE_CONFIG_DIR)fail();
  const paths=settingsPaths(root),inventory=settingsSnapshot(paths);
  const sources=['delegate-runtime.js','delegate-guard.js','delegate.js','transcript-async.js','cli.js','quality-policy.js','../../lib/ai-team.js'];
  const definitionText=readFileSync(join(root,'scripts/ai-staff/agents',delegate+'.md'),'utf8');
  const definition=agentDefinition(delegate,definitionText);
  const source_hash=hash(sources.map(p=>hash(readFileSync(join(root,'scripts/ai-staff',p),'utf8'))).concat(hash(definitionText)));
  const approval=verifyApproval(JSON.parse(privateFile(approvalPath)),{packet,delegate,model,inventory,source_hash});
  // A copy of the same receipt cannot reset the token. Failed and uncertain runs consume it as well.
  const tokens=join(root,'data/delegation-tokens');mkdirSync(tokens,{recursive:true,mode:0o700});
  const tokenDir=lstatSync(tokens);if(!tokenDir.isDirectory()||tokenDir.isSymbolicLink()||(tokenDir.mode&0o077)||
    (process.getuid&&tokenDir.uid!==process.getuid()))fail();
  closeSync(openSync(join(tokens,approval.token),'wx',0o600));
  const env=delegateEnv(checkSubscription('claude'));
  const version=spawnSync('claude',['--version'],{env,encoding:'utf8',timeout:15000});
  if(version.status!==0||version.stdout.trim()!=='2.1.296 (Claude Code)')fail();
  const auth=spawnSync('claude',['auth','status','--json'],{env,encoding:'utf8',timeout:15000});
  let a;try{a=JSON.parse(auth.stdout)}catch{fail()}
  if(auth.status!==0||a.loggedIn!==true||a.authMethod!=='claude.ai'||a.apiProvider!=='firstParty'||!['pro','max'].includes(a.subscriptionType))fail();
  if(hash(settingsSnapshot(paths))!==hash(inventory))fail();
  const dir=mkdtempSync(join(tmpdir(),'ss-delegation-')),session=randomUUID(),prompt=delegatePrompt(packet,delegate);
  try{
    const guard=join(root,'scripts/ai-staff/delegate-guard.js'),policy=join(dir,'policy.json'),settings=join(dir,'settings.json');
    writeFileSync(policy,JSON.stringify({version:1,session_id:session,delegate,packet,expires_at:new Date(Date.now()+600000).toISOString()}),{mode:0o600});
    writeFileSync(settings,JSON.stringify(runtimeSettings(guard,policy)),{mode:0o600});
    const stdout=await executeGuarded({args:runtimeArgs({session,delegate,model,definition,settings}),cwd:root,env,prompt,session,dir,model});
    if(hash(settingsSnapshot(paths))!==hash(inventory))fail();
    const guardEvidence=verifyGuardEvidence(stdout,dir,session);
    const checked=validateTranscript(stdout,{delegate,model,packet,session_id:session});
    if(checked.audit?.profile!=='claude-2.1.296-async-v1')fail();
    return {stdout,output:checked.output,checked,prompt,definition:definitionText,cli_version:version.stdout.trim(),
      guardEvidence,approval_sha256:hash(approval),quality_approved:false};
  }finally{rmSync(dir,{recursive:true,force:true})}
}
