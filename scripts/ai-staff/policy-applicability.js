// Read-only diagnostics for the pinned standalone CLI. Never starts a model session.
import {lstatSync,realpathSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {TeamError} from '../../lib/ai-team.js';
export const REMOTE_NOT_APPLICABLE='not_applicable_to_current_credential';
export const HEADLESS_NOT_REQUESTED='headless_not_requested';
export const DOCTOR_REMOTE_LINE='Managed settings (remote): not fetched — requires an Enterprise or Team subscription';
const fail=()=>{throw new TeamError('認証方式・remote policy適用条件・新規非対話起動を確認できません');};
const hash=v=>createHash('sha256').update(v).digest('hex');
export const applicabilityPaths=home=>[join(home,'.claude/remote-settings.json'),join(home,'.config/anthropic')];
export function verifyApplicability(value){
  const c=value?.credential;
  if(value?.version!==1||value.remote_policy!==REMOTE_NOT_APPLICABLE||
    value.doctor_exit_code!==0||value.doctor_remote_line!==DOCTOR_REMOTE_LINE||
    c?.loggedIn!==true||c.authMethod!=='claude.ai'||c.apiProvider!=='firstParty'||c.subscriptionType!=='pro'||
    Object.keys(c).sort().join(',')!=='apiProvider,authMethod,loggedIn,subscriptionType'||
    value.cli_version!=='2.1.296 (Claude Code)'||value.remote_cache!=='absent'||value.anthropic_profiles!=='absent'||
    value.credential_overrides!=='absent'||!/^\/.*\/\.local\/share\/claude\/versions\/2\.1\.296$/.test(value.executable||'')||
    !/^[a-f0-9]{64}$/.test(value.executable_sha256||''))fail();
  return value;
}
export function readApplicabilityContext({home,env}){
  if(env.HOME!==home||env.CLAUDE_CONFIG_DIR||env.XDG_CONFIG_HOME||env.APPDATA||env.USERPROFILE||
    env.CLAUDECODE||env.CLAUDE_AGENT_SDK||env.CLAUDE_SESSION_ID||
    Object.keys(env).some(k=>/^(ANTHROPIC|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_API_KEY)/i.test(k)))fail();
  for(const path of applicabilityPaths(home)){
    try{lstatSync(path);fail()}catch(e){if(e.code!=='ENOENT')throw e}
  }
  const executable=join(home,'.local/share/claude/versions/2.1.296');
  if(realpathSync(join(home,'.local/bin/claude'))!==executable||realpathSync(executable)!==executable)fail();
  const s=lstatSync(executable);
  if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o022)||(process.getuid&&s.uid!==process.getuid()))fail();
  return {executable,executable_sha256:hash(readFileSync(executable))};
}
export function parseApplicabilityDiagnostics({context,version,auth,doctor}){
  const clean=text=>String(text??'').replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');
  for(const r of [version,auth,doctor])if(r.status!==0||r.signal||r.error||clean(r.stderr).trim())fail();
  let a;try{a=JSON.parse(auth.stdout)}catch{fail()}
  const lines=clean(doctor.stdout).split(/\r?\n/).map(x=>x.trim());
  if(lines.filter(x=>x.startsWith('Managed settings (remote):')).length!==1||
    !lines.includes(DOCTOR_REMOTE_LINE)||lines.some(x=>/\bcach(?:e|ed)\b.*\b(appl|load|us)/i.test(x)))fail();
  return verifyApplicability({version:1,...context,cli_version:clean(version.stdout).trim(),
    credential:{loggedIn:a.loggedIn,authMethod:a.authMethod,apiProvider:a.apiProvider,subscriptionType:a.subscriptionType},
    doctor_exit_code:doctor.status,doctor_remote_line:DOCTOR_REMOTE_LINE,
    remote_policy:REMOTE_NOT_APPLICABLE,remote_cache:'absent',anthropic_profiles:'absent',credential_overrides:'absent'});
}
export function collectApplicability({home,env,cwd,run=spawnSync,readContext=readApplicabilityContext}){
  const context=readContext({home,env});
  const call=args=>run(context.executable,args,{cwd,env,encoding:'utf8',timeout:45000,maxBuffer:1000000});
  const version=call(['--version']),auth=call(['auth','status','--json']),doctor=call(['doctor']);
  const result=parseApplicabilityDiagnostics({context,version,auth,doctor});
  const after=parseApplicabilityDiagnostics({context,version,auth:call(['auth','status','--json']),doctor});
  if(JSON.stringify(result)!==JSON.stringify(after)||
    JSON.stringify(context)!==JSON.stringify(readContext({home,env})))fail();
  return result;
}
