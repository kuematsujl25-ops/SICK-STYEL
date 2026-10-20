// Opt-in orchestration. Approval is a private, operator-reviewed, single-use receipt, never model input.
// Unknown policy sources/hooks are a blocker; this module does not disable or rewrite existing policy.
import {readFileSync,writeFileSync,lstatSync,openSync,closeSync,mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {prepareEvidenceRoot,createEvidenceDirectory,saveEvidence,readEvidence} from './run-evidence.js';
import {verifyObservationBundle} from './observation-provenance.js';
import {verifyUsageObservation} from './account-identity.js';
import {collectApplicability,readApplicabilityContext,applicabilityPaths,HEADLESS_NOT_REQUESTED} from './policy-applicability.js';
import {Utf8Capture,bytesHash} from './utf8-capture.js';
import {sessionPluginBinding,verifySessionPluginConsent,SESSION_PLUGIN_PROFILE} from './session-plugin-binding.js';
import {readSessionPluginInventory,verifyPolicyObservation} from './session-plugin-inventory.js';
import {parentAuditRecord,verifyParentAudit} from './delegate-guard.js';
import {validateComparisonBaseline} from './transcript-baseline.js';
import {TeamError} from '../../lib/ai-team.js';
import {checkSubscription} from './cli.js';
import {agentDefinition,delegateEnv,delegatePrompt,analysisPrompt,validateTranscript,DELEGATES,KNOWN_MODELS,LIMITS,isDelegationTool} from './delegate.js';

const fail=()=>{throw new TeamError('委任の承認・設定・ガード証拠を確認できません。モデル再試行・成果物取込は行いません');};
export const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export const ROLE_DELEGATE=Object.freeze({coo:'ss-data-auditor',profit_inventory:'ss-profit-inventory',social:'ss-qa-security'});
export const PROFILE='claude-2.1.296-deny-only-v2';
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
  const paths=[...applicabilityPaths(home),join(home,'.claude/settings.json'),join(home,'.claude/settings.local.json'),
    join(home,'.claude/managed-settings.json'),join(home,'.claude/plugins/installed_plugins.json'),
    '/Library/Application Support/ClaudeCode/managed-settings.json',
    '/Library/Application Support/ClaudeCode/managed-settings.d','/Library/Application Support/ClaudeCode/managed-mcp.json',
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
export function verifyApproval(a,{packet,delegate,model,inventory,source_hash,mode='delegated',now=Date.now(),pluginBinding=null}){
  const when=Date.parse(a?.checked_at);
  if(pluginBinding)verifySessionPluginConsent(a,pluginBinding,now);
  else if(a&&['binding_sha256','plugin_ids','policy_observation_path','session_only_three_plugins'].some(key=>Object.hasOwn(a,key)))fail();
  if(!['baseline','delegated'].includes(mode)||a?.mode!==mode||a?.version!==1||a.profile!==(pluginBinding?SESSION_PLUGIN_PROFILE:PROFILE)||!uuid(a.token)||a.delegate!==delegate||ROLE_DELEGATE[packet.role]!==delegate||
    !DELEGATES.includes(delegate)||!KNOWN_MODELS.includes(model)||a.model!==model||a.packet_sha256!==hash(packet)||
    a.settings_sha256!==hash(inventory)||a.source_sha256!==source_hash||!Number.isFinite(when)||when>now||now-when>600000||
    a.subscription_confirmed!==true||a.extra_usage_disabled!==true||a.no_additional_charge_confirmed!==true||
    a.usage_available!==true||a.effective_policy_reviewed!==true||a.no_other_hooks_or_plugins!==true||
    (pluginBinding?a.no_mdm_policy!==true||a.policy_applicability_reviewed!==true:a.no_remote_or_mdm_policy!==true)||a.quality_review_required!==true)fail();
  return a;
}
export function runtimeArgs({session,delegate,model,definition,settings,mode='delegated'}){
  if(!['baseline','delegated'].includes(mode)||!uuid(session)||!DELEGATES.includes(delegate)||!KNOWN_MODELS.includes(model)||!isAbsolute(settings))fail();
  return ['-p','--model',model,'--session-id',session,'--tools',mode==='baseline'?'':'Agent','--permission-mode','dontAsk',
    '--settings',settings,'--agents',JSON.stringify({[delegate]:definition}),'--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
    '--disable-slash-commands','--no-session-persistence','--effort','low','--max-turns',String(LIMITS.parent_max_turns),
    '--output-format','stream-json','--verbose','--include-hook-events','--forward-subagent-text',
    ...(mode==='delegated'?['--allowedTools',`Agent(${delegate})`]:[]),'--disallowedTools','Bash','Read','Write','Edit','Grep','Glob','WebFetch','WebSearch','SendMessage'];
}
// Only the canonical argument vector is accepted. Unknown flags, wrappers, RC and resume cannot be appended.
// Session freshness is provided by randomUUID() in runDelegated, never supplied by the receipt.
export function verifyHeadlessLaunch(options){
  const expected=runtimeArgs(options);
  if(JSON.stringify(options.args)!==JSON.stringify(expected))fail();
  return {remote_control:HEADLESS_NOT_REQUESTED,launch_kind:'fresh_direct_noninteractive',
    args_sha256:hash(expected),session_id:options.session,network_absence_established:false};
}
export function runtimeSettings(guard,policy,mode='delegated',pluginBinding=null){
  const hook=mode=>({type:'command',command:process.execPath,args:[guard,policy,mode],timeout:8,onFailure:'block'});
  return {...(pluginBinding?pluginBinding.plan.override:{}),hooks:{SessionStart:[{matcher:'startup',hooks:[hook('startup')]}],PreToolUse:[{matcher:'*',hooks:[hook(mode==='baseline'?'deny':'tool')]}]}};
}
export const BUILTIN_PLUGINS=Object.freeze(['cc-plugin-agents-md','cc-plugin-telemetry','cc-plugin-plugin-authoring']);
export function verifyEffectivePlugins(init){
  if(init.claude_code_version!=='2.1.296'||!Array.isArray(init.mcp_servers)||init.mcp_servers.length||
    !Array.isArray(init.plugins)||init.plugins.length!==BUILTIN_PLUGINS.length)fail();
  const names=new Set();
  for(const plugin of init.plugins){
    if(!BUILTIN_PLUGINS.includes(plugin.name)||plugin.source!==`${plugin.name}@builtin`||
      plugin.path!=='builtin'||names.has(plugin.name))fail();
    names.add(plugin.name);
  }
  return {effective_plugins:[...names].sort(),mcp_servers:[],discord_process_absence:'not_established'};
}
// After preflight, deliver the approved prompt immediately. Startup/init are early output audits,
// not a pre-model boundary. Synchronous deny-only PreToolUse hooks enforce tool restrictions.
export function executeGuarded({args,cwd,env,prompt,session,dir,spawnProcess=spawn,model=null,mode='delegated',timeout=LIMITS.timeout_ms,requirePluginInit=false,executable='claude'}){
  return new Promise((resolveResult,reject)=>{
    let pending='',released=false,stopped=false,calls=0,startId=null,startReady=false,initReady=false,parentAudited=false;
    const stdoutCapture=new Utf8Capture(LIMITS.max_transcript_bytes),stderrCapture=new Utf8Capture(100000);
    const child=spawnProcess(executable,args,{cwd,env,detached:true,stdio:['pipe','pipe','pipe']});
    const stop=()=>{stopped=true;try{if(child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL')}catch{child.kill('SIGKILL')}};
    const timer=setTimeout(stop,timeout);
    const ready=()=>startReady&&initReady;
    const startTimer=setTimeout(()=>{if(!ready())stop()},15000);
    child.on('error',()=>{stopped=true;});
    child.stdout.on('data',buf=>{
      try{pending+=stdoutCapture.write(buf);}catch{stop();return}
      let end;
      while(!stopped&&(end=pending.indexOf('\n'))>=0){
        const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line.trim())continue;
        let m;try{m=JSON.parse(line);if(!m||typeof m!=='object'||Array.isArray(m))throw 0}catch{stop();break}
        if(m.session_id!==session){stop();break}
        if(m.type==='system'&&m.subtype==='hook_started'&&m.hook_event==='SessionStart'){
          if(startId!==null){stop();break}startId=m.hook_id;
        }else if(m.type==='system'&&m.subtype==='hook_response'&&m.hook_event==='SessionStart'){
          if(startReady||!startId||m.hook_id!==startId||m.exit_code!==0||m.outcome!=='success'||!['','{}'].includes(m.stdout||'')){stop();break}
          try{const receipt=JSON.parse(privateFile(join(dir,'started.json')));
            if(receipt.session_id!==session||receipt.stage!=='startup')fail();
          }catch{stop();break}
          startReady=true;
        }else if(!ready()&&!(m.type==='system'&&m.subtype==='init')){stop();break}
        if(m.type==='system'&&m.subtype==='init'&&(!Array.isArray(m.tools)||(mode==='baseline'?m.tools.length!==0:m.tools.length!==1||!isDelegationTool(m.tools[0]))||
          (model!==null&&m.model!==model)||m.permissionMode!=='dontAsk'||m.apiKeySource!=='none'||m.mcp_servers?.length))stop();
        if(m.type==='system'&&m.subtype==='init'){
          try{if(requirePluginInit)verifyEffectivePlugins(m);initReady=true}catch{stop()}
        }
        if(m.type==='system'&&String(m.subtype).startsWith('hook_')&&!['SessionStart','PreToolUse'].includes(m.hook_event))stop();
        if(m.type==='system'&&m.subtype==='hook_response'&&(m.exit_code!==0||m.outcome!=='success'||!['','{}'].includes(m.stdout||'')))stop();
        if(m.type==='rate_limit_event'&&(m.rate_limit_info?.status!=='allowed'||m.rate_limit_info?.isUsingOverage!==false))stop();
        for(const c of Array.isArray(m.message?.content)?m.message.content:[])
          if(!c||typeof c!=='object'||c.type==='tool_use'&&(mode==='baseline'||m.parent_tool_use_id||!isDelegationTool(c.name)||++calls>1))stop();
        if(m.type==='result'&&(m.is_error||m.permission_denials?.length))stop();
        if(!stopped&&ready()){
          clearTimeout(startTimer);
          if(mode==='delegated'&&!parentAudited){
            try{writeFileSync(join(dir,'parent-audit.json'),JSON.stringify(parentAuditRecord(join(dir,'policy.json'))),{mode:0o600,flag:'wx'});parentAudited=true}
            catch{stop()}
          }
        }
      }
    });
    child.stderr.on('data',buf=>{try{stderrCapture.write(buf);}catch{stop();return}if(buf.some(b=>![9,10,13,32].includes(b)))stop()});
    child.stdin.on('error',stop);
    child.on('close',(code,signal)=>{clearTimeout(timer);clearTimeout(startTimer);
      const capture={stdout:stdoutCapture.end(),stderr:stderrCapture.end(),exit_code:code,signal,prompt_released:released,stopped,
        prompt_delivery:'after_preflight_before_startup_audit',startup_audited:startReady,init_audited:initReady};
      if(stopped||!released||!ready()||code!==0||signal||pending.trim()||!capture.stdout.utf8_valid||!capture.stderr.utf8_valid){
        const error=new TeamError('委任ガード・CLI記録が未確認または異常です。成果物は保存しません');error.capture=capture;reject(error);
      }else resolveResult(capture);
    });
    // All listeners are installed before stdin closes; no dependence on pre-stdin CLI output.
    if(!stopped){released=true;try{child.stdin.end(prompt)}catch{stop()}}
  });
}
export function verifyGuardEvidence(stdout,dir,session,mode='delegated'){
  const rows=stdout.trim().split('\n').map(l=>JSON.parse(l));
  const calls=rows.flatMap(m=>(m.message?.content||[]).filter?.(c=>c.type==='tool_use')||[]);
  const start=JSON.parse(privateFile(join(dir,'started.json')));
  if(start.session_id!==session||start.stage!=='startup')fail();
  if(mode==='baseline'){
    const hooks=rows.filter(m=>m.type==='system'&&m.subtype==='hook_response');
    if(calls.length||existsSync(join(dir,'used'))||existsSync(join(dir,'tool.json'))||hooks.length!==1||
      hooks[0].hook_event!=='SessionStart'||hooks[0].exit_code!==0||hooks[0].outcome!=='success')fail();
    return {startup:true,no_tools:true,quality_approved:false};
  }
  if(mode!=='delegated'||calls.length!==1)fail();
  verifyParentAudit(join(dir,'policy.json'),session);
  const receipt=JSON.parse(privateFile(join(dir,'tool.json')));
  if(receipt.session_id!==session||receipt.stage!=='tool'||receipt.tool_use_id!==calls[0].id||
    receipt.tool_name!==calls[0].name||receipt.input_sha256!==hash(calls[0].input)||!existsSync(join(dir,'used')))fail();
  const hooks=rows.filter(m=>m.type==='system'&&m.subtype==='hook_response');
  if(hooks.length!==2||hooks.filter(m=>m.hook_event==='SessionStart').length!==1||
    hooks.filter(m=>m.hook_event==='PreToolUse').length!==1||hooks.some(m=>m.exit_code!==0||m.outcome!=='success'))fail();
  return {startup:true,pre_tool_use:true,one_shot:true,input_sha256:receipt.input_sha256,quality_approved:false};
}
export async function runDelegated({root,packet,delegate,model,approvalPath,mode='delegated'}){
  // No model/auth subprocess before the explicit receipt and settings checks.
  if(!DELEGATES.includes(delegate)||!KNOWN_MODELS.includes(model)||ROLE_DELEGATE[packet.role]!==delegate||
    process.platform!=='darwin'||process.env.CLAUDE_CONFIG_DIR)fail();
  const rawApproval=JSON.parse(privateFile(approvalPath));
  const withPlugins=rawApproval.profile===SESSION_PLUGIN_PROFILE;
  const paths=settingsPaths(root);
  let policyText=null,approvalEvidence=null,policyEvidence=null,pluginState=null,pluginBinding=null,usageText=null,usageEvidence=null;
  if(withPlugins){
    policyText=privateFile(rawApproval.policy_observation_path);
    const observation=verifyPolicyObservation(JSON.parse(policyText));
    policyEvidence=privateFile(observation.evidence_ref);
    approvalEvidence=privateFile(rawApproval.approval_evidence_ref);
    if(hash(policyEvidence)!==observation.evidence_sha256||hash(approvalEvidence)!==rawApproval.approval_evidence_sha256)fail();
    usageText=privateFile(rawApproval.usage_observation_path);
    const usage=verifyUsageObservation(JSON.parse(usageText),observation.remote_applicability.identity);
    usageEvidence=privateFile(usage.evidence_ref);
    if(hash(usageEvidence)!==usage.evidence_sha256)fail();
    pluginState=readSessionPluginInventory({paths,home:homedir(),policyObservation:observation});
  }
  const snapshot=()=>withPlugins?readSessionPluginInventory({paths,home:homedir(),policyObservation:JSON.parse(policyText)}).inventory:settingsSnapshot(paths);
  const inventory=pluginState?.inventory??settingsSnapshot(paths);
  if(withPlugins)verifyObservationBundle({policy:JSON.parse(policyText),usage:JSON.parse(usageText),policyEvidence,usageEvidence,userAuthorization:approvalEvidence,inventory,mode,delegate,model,packet});
  const sources=['observation-provenance.js','account-identity.js','policy-applicability.js','session-plugin-plan.js','session-plugin-binding.js','session-plugin-inventory.js','transcript-stats.js','transcript-baseline.js','run-evidence.js','utf8-capture.js','delegate-runtime.js','delegate-guard.js','delegate.js','transcript-async.js','cli.js','quality-policy.js','../../lib/ai-team.js'];
  const definitionText=readFileSync(join(root,'scripts/ai-staff/agents',delegate+'.md'),'utf8');
  const definition=agentDefinition(delegate,definitionText);
  const source_hash=hash(sources.map(p=>hash(readFileSync(join(root,'scripts/ai-staff',p),'utf8'))).concat(hash(definitionText)));
  if(withPlugins)pluginBinding=sessionPluginBinding({...pluginState,cliVersion:'2.1.296 (Claude Code)',mode,packet,model,sourceHash:source_hash,
    policyObservationHash:hash(policyText),usageObservationHash:hash(usageText),userAuthorizationHash:hash(approvalEvidence),identitySha256:pluginState.policyObservation.remote_applicability.identity.identity_sha256,token:rawApproval.token,checkedAt:rawApproval.checked_at});
  const approval=verifyApproval(rawApproval,{packet,delegate,model,inventory,source_hash,mode,pluginBinding});
  const evidenceDir=createEvidenceDirectory(prepareEvidenceRoot());
  // A copy of the same receipt cannot reset the token. Failed and uncertain runs consume it as well.
  const tokens=join(root,'data/delegation-tokens');mkdirSync(tokens,{recursive:true,mode:0o700});
  const tokenDir=lstatSync(tokens);if(!tokenDir.isDirectory()||tokenDir.isSymbolicLink()||(tokenDir.mode&0o077)||
    (process.getuid&&tokenDir.uid!==process.getuid()))fail();
  closeSync(openSync(join(tokens,approval.token),'wx',0o600));
  const env=withPlugins?delegateEnv():delegateEnv(checkSubscription('claude'));
  const executable=withPlugins?readApplicabilityContext({home:homedir(),env}).executable:'claude';
  const version=spawnSync(executable,['--version'],{env,encoding:'utf8',timeout:15000});
  if(version.status!==0||version.stdout.trim()!=='2.1.296 (Claude Code)')fail();
  const auth=spawnSync(executable,['auth','status','--json'],{env,encoding:'utf8',timeout:15000});
  let a;try{a=JSON.parse(auth.stdout)}catch{fail()}
  if(auth.status!==0||a.loggedIn!==true||a.authMethod!=='claude.ai'||a.apiProvider!=='firstParty'||!['pro','max'].includes(a.subscriptionType))fail();
  if(hash(snapshot())!==hash(inventory))fail();
  const dir=mkdtempSync(join(tmpdir(),'ss-delegation-')),session=randomUUID(),prompt=mode==='baseline'?analysisPrompt(packet):delegatePrompt(packet,delegate);
  let capture=null,archived=false,accepted=false,finalInventory=null,liveApplicability=null,launchEvidence=null;
  const startedAt=new Date().toISOString();
  const args=runtimeArgs({session,delegate,model,definition,settings:join(dir,'settings.json'),mode});
  const persist=()=>{
    const files={'packet.json':JSON.stringify(packet),'prompt.txt':prompt,'approval.json':JSON.stringify(approval),
      'inventory.json':JSON.stringify(inventory),'definition.txt':definitionText,'invocation.json':JSON.stringify({args,session,model,delegate,mode}),
      'approval-token.used':readFileSync(join(tokens,approval.token))};
    if(withPlugins){
      files['plugin-state.json']=JSON.stringify(pluginState);
      files['plugin-binding.json']=JSON.stringify(pluginBinding);
      files['policy-observation.json']=policyText;
      files['usage-observation.json']=usageText;
      files['usage-evidence.txt']=usageEvidence;
      files['policy-evidence.txt']=policyEvidence;
      files['consent-evidence.txt']=approvalEvidence;
      if(liveApplicability)files['live-applicability.json']=JSON.stringify(liveApplicability);
      if(launchEvidence)files['launch-applicability.json']=JSON.stringify(launchEvidence);
      if(finalInventory)files['final-inventory.json']=JSON.stringify(finalInventory);
    }
    for(const name of ['policy.json','settings.json','started.json','parent-audit.json','used','tool.json'])
      if(existsSync(join(dir,name)))files[name]=readFileSync(join(dir,name));
    let streams=null;
    if(capture){streams={};for(const name of ['stdout','stderr']){
      const {raw,text,...meta}=capture[name];files[name+'.bytes']=raw;files[name+'.utf8.txt']=text;streams[name]=meta;
    }}
    const evidence=saveEvidence(evidenceDir,files,{session,model,delegate,mode,started_at:startedAt,finished_at:new Date().toISOString(),
      source_sha256:source_hash,cli_version:version.stdout.trim(),limits:{...LIMITS,effort:'low'},audit_status:accepted?'accepted':'rejected',quality_approved:false,
      streams,execution:capture?{exit_code:capture.exit_code,signal:capture.signal,prompt_released:capture.prompt_released,stopped:capture.stopped,
        prompt_delivery:capture.prompt_delivery,startup_audited:capture.startup_audited,init_audited:capture.init_audited}:null});
    archived=true;return evidence;
  };
  try{
    const guard=join(root,'scripts/ai-staff/delegate-guard.js'),policy=join(dir,'policy.json'),settings=join(dir,'settings.json');
    writeFileSync(policy,JSON.stringify({version:1,session_id:session,delegate,packet,expires_at:new Date(Date.now()+600000).toISOString()}),{mode:0o600});
    writeFileSync(settings,JSON.stringify(runtimeSettings(guard,policy,mode,pluginBinding)),{mode:0o600});
    if(withPlugins){
      liveApplicability=collectApplicability({home:homedir(),env,cwd:root});
      if(hash(liveApplicability)!==hash(pluginState.policyObservation.remote_applicability))fail();
      verifyUsageObservation(JSON.parse(usageText),liveApplicability.identity);
      launchEvidence=verifyHeadlessLaunch({args,session,delegate,model,definition,settings,mode});
      // Fresh diagnostics never extend the authorization/observation receipt's expiry.
      verifyApproval(approval,{packet,delegate,model,inventory,source_hash,mode,pluginBinding});
      if(hash(snapshot())!==hash(inventory))fail();
    }
    capture=await executeGuarded({args,cwd:root,env,prompt,session,dir,model,mode,requirePluginInit:withPlugins,
      executable:withPlugins?liveApplicability.executable:'claude'});
    const stdout=capture.stdout.text;
    finalInventory=snapshot();
    if(hash(finalInventory)!==hash(inventory))fail();
    const guardEvidence=verifyGuardEvidence(stdout,dir,session,mode);
    const checked=mode==='baseline'?validateComparisonBaseline(stdout,{model,packet,session_id:session,limits:LIMITS}):validateTranscript(stdout,{delegate,model,packet,session_id:session});
    if(checked.audit?.profile!==(mode==='baseline'?'claude-2.1.296-baseline-v1':'claude-2.1.296-async-v1'))fail();
    accepted=true;const evidence=persist();
    return {stdout,evidence,capture_hashes:{raw_bytes_sha256:capture.stdout.raw_bytes_sha256,decoded_utf8_sha256:capture.stdout.decoded_utf8_sha256},output:checked.output,checked,prompt,definition:definitionText,cli_version:version.stdout.trim(),
      guardEvidence,approval_sha256:hash(approval),quality_approved:false};
  }catch(error){
    capture??=error.capture??null;
    if(!archived){accepted=false;persist();}
    throw new TeamError('委任実行は未確認または失敗です。私有証拠を保管し、取込用成果物は保存しません');
  }finally{if(archived)rmSync(dir,{recursive:true,force:true})}
}

export function replayRunEvidence(dir,manifestHash){
  const {manifest,files}=readEvidence(dir,manifestHash),m=manifest.metadata;
  const decode=b=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
  if(m.audit_status!=='accepted'||!files['approval-token.used']||!m.streams?.stdout?.utf8_valid||m.streams.stdout.truncated||
    !m.streams.stdout.ended||m.execution?.exit_code!==0||m.execution.signal!==null||m.execution.prompt_released!==true||m.execution.stopped!==false)fail();
  const stdout=decode(files['stdout.bytes']);
  if(bytesHash(files['stdout.bytes'])!==m.streams.stdout.raw_bytes_sha256||
    bytesHash(Buffer.from(stdout))!==m.streams.stdout.decoded_utf8_sha256||decode(files['stdout.utf8.txt'])!==stdout)fail();
  const packet=JSON.parse(decode(files['packet.json']));
  const approval=JSON.parse(decode(files['approval.json']));
  let pluginBinding=null;
  if(approval.profile!==SESSION_PLUGIN_PROFILE&&files['plugin-binding.json'])fail();
  if(approval.profile===SESSION_PLUGIN_PROFILE){
    if(m.execution.prompt_delivery!=='after_preflight_before_startup_audit'||m.execution.startup_audited!==true||m.execution.init_audited!==true)fail();
    const now=Date.parse(m.started_at),state=JSON.parse(decode(files['plugin-state.json']));
    const policyText=decode(files['policy-observation.json']);
    const observation=verifyPolicyObservation(JSON.parse(policyText),now);
    const live=JSON.parse(decode(files['live-applicability.json']));
    const usageText=decode(files['usage-observation.json']);
    const usage=verifyUsageObservation(JSON.parse(usageText),observation.remote_applicability.identity,now);
    if(hash(decode(files['usage-evidence.txt']))!==usage.evidence_sha256)fail();
    if(hash(live)!==hash(observation.remote_applicability))fail();
    const invocation=JSON.parse(decode(files['invocation.json']));
    const definition=agentDefinition(m.delegate,decode(files['definition.txt']));
    const launch=verifyHeadlessLaunch({...invocation,definition,settings:invocation.args[invocation.args.indexOf('--settings')+1]});
    if(invocation.session!==m.session||invocation.delegate!==m.delegate||invocation.model!==m.model||invocation.mode!==m.mode||
      hash(launch)!==hash(JSON.parse(decode(files['launch-applicability.json']))))fail();
    if(hash(state.policyObservation)!==hash(observation)||
      hash(decode(files['policy-evidence.txt']))!==observation.evidence_sha256||
      hash(decode(files['consent-evidence.txt']))!==approval.approval_evidence_sha256||
      hash(state.inventory)!==hash(JSON.parse(decode(files['inventory.json'])))||
      hash(state.inventory)!==hash(JSON.parse(decode(files['final-inventory.json']))))fail();
    verifyObservationBundle({policy:observation,usage,policyEvidence:decode(files['policy-evidence.txt']),usageEvidence:decode(files['usage-evidence.txt']),userAuthorization:decode(files['consent-evidence.txt']),inventory:state.inventory,mode:m.mode,delegate:m.delegate,model:m.model,packet});
    pluginBinding=sessionPluginBinding({...state,cliVersion:m.cli_version,mode:m.mode,packet,model:m.model,
      sourceHash:m.source_sha256,policyObservationHash:hash(policyText),usageObservationHash:hash(usageText),userAuthorizationHash:hash(decode(files['consent-evidence.txt'])),identitySha256:observation.remote_applicability.identity.identity_sha256,token:approval.token,checkedAt:approval.checked_at});
    if(hash(pluginBinding)!==hash(JSON.parse(decode(files['plugin-binding.json'])))||
      hash(JSON.parse(decode(files['settings.json'])).enabledPlugins)!==hash(pluginBinding.plan.override.enabledPlugins))fail();
    const rows=stdout.trim().split('\n').map(line=>JSON.parse(line));
    const initIndex=rows.findIndex(row=>row.type==='system'&&row.subtype==='init');
    const startupIndex=rows.findIndex(row=>row.type==='system'&&row.subtype==='hook_response'&&row.hook_event==='SessionStart');
    if(initIndex<0||startupIndex<0||rows.slice(0,Math.max(initIndex,startupIndex)+1).some(row=>
      row.type!=='system'||!['init','hook_started','hook_response'].includes(row.subtype)))fail();
    for(const row of rows.filter(row=>row.type==='system'&&row.subtype==='init'))verifyEffectivePlugins(row);
  }
  verifyApproval(approval,{packet,delegate:m.delegate,model:m.model,inventory:JSON.parse(decode(files['inventory.json'])),
    source_hash:m.source_sha256,mode:m.mode,now:Date.parse(m.started_at),pluginBinding});
  const guardEvidence=verifyGuardEvidence(stdout,dir,m.session,m.mode);
  const checked=m.mode==='baseline'?validateComparisonBaseline(stdout,{packet,model:m.model,session_id:m.session,limits:LIMITS}):validateTranscript(stdout,{packet,delegate:m.delegate,model:m.model,session_id:m.session});
  if(checked.audit?.profile!==(m.mode==='baseline'?'claude-2.1.296-baseline-v1':'claude-2.1.296-async-v1'))fail();
  return {guardEvidence,checked,quality_approved:false};
}
