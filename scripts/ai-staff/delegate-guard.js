// Phase T: deny-only PreToolUse command hook for one pre-fixed delegation (offline/local, no network or model).
// Used by approved session-only CLI probes; general delegate.js execution remains stopped.
// Usage: node delegate-guard.js /abs/private-run-dir/policy.json  (hook stdin = PreToolUse event JSON)
// It never returns "allow" or updatedInput: the single valid Agent request gets "{}" + exit 0 (defer to the
// existing permission rules); everything else exits 2 with a short reason that contains no input or secret text.
// The hook must be configured with onFailure: block so a crash/timeout of this guard also blocks the tool call.
import {closeSync,constants,fstatSync,lstatSync,openSync,readSync} from 'node:fs';
import {dirname,isAbsolute,join,normalize} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateTaskPacket} from '../../lib/ai-team.js';
import {DELEGATES,isDelegationTool} from './delegate.js';

export const GUARD_LIMITS=Object.freeze({max_stdin_bytes:256*1024,stdin_timeout_ms:5000,max_policy_bytes:256*1024,
  max_policy_ttl_ms:30*60*1000,max_description:200});
export const USED_FILE='used';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AGENT_INPUT_KEYS=['description','prompt','subagent_type'];
const POLICY_KEYS=['delegate','expires_at','packet','session_id','version'];

export class GuardDenied extends Error{}
const deny=reason=>{throw new GuardDenied(reason)};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const sameKeys=(o,keys)=>plain(o)&&Object.keys(o).sort().join()===keys.join();
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const canonicalJson=v=>JSON.stringify(canonical(v));

// Pure: validate parsed policy content against the current time.
export function checkPolicy(policy,now=Date.now()){
  if(!sameKeys(policy,POLICY_KEYS)||policy.version!==1)deny('policy形式');
  if(typeof policy.session_id!=='string'||!UUID.test(policy.session_id))deny('policy session');
  if(!DELEGATES.includes(policy.delegate))deny('policy委任先');
  const exp=typeof policy.expires_at==='string'&&/^\d{4}-\d\d-\d\dT/.test(policy.expires_at)?Date.parse(policy.expires_at):NaN;
  if(!Number.isFinite(exp)||!Number.isFinite(now)||exp<=now||exp-now>GUARD_LIMITS.max_policy_ttl_ms)deny('policy期限');
  let packet;
  try{packet=validateTaskPacket(policy.packet);}catch{deny('policy依頼データ');}
  return Object.freeze({session_id:policy.session_id,delegate:policy.delegate,expected_prompt:canonicalJson(packet)});
}

// Pure: decide whether an event may be deferred to the normal permission flow. Throws GuardDenied otherwise.
export function checkEvent(event,policy){
  if(!plain(event))deny('入力形式');
  if(event.hook_event_name!=='PreToolUse')deny('対象外のイベント');
  if(event.session_id!==policy.session_id)deny('セッション不一致');
  // Only the top-level session may delegate; any subagent context (agent_id/agent_type present) is denied.
  if(Object.hasOwn(event,'agent_id')||Object.hasOwn(event,'agent_type'))deny('子からの呼び出し');
  if(!isDelegationTool(event.tool_name))deny('許可外のツール');
  const input=event.tool_input;
  if(!sameKeys(input,AGENT_INPUT_KEYS))deny('Agent入力の項目');
  if(input.subagent_type!==policy.delegate)deny('委任先不一致');
  if(typeof input.description!=='string'||!input.description.trim()||input.description.length>GUARD_LIMITS.max_description)deny('説明');
  if(typeof input.prompt!=='string')deny('依頼データ不一致');
  let sent;
  try{sent=JSON.parse(input.prompt);}catch{deny('依頼データ不一致');}
  // Raw text must be plain minified JSON (no padding, duplicate keys or alternative number forms), and its
  // canonical form must equal the fixed packet exactly (all keys, value types and array order).
  if(input.prompt!==JSON.stringify(sent)||canonicalJson(sent)!==policy.expected_prompt)deny('依頼データ不一致');
  return true;
}

const ownerOk=st=>typeof process.getuid!=='function'||st.uid===process.getuid();
// Reads only the policy path given as the argument (never paths from the hook input).
export function readPolicyFile(policyPath,now=Date.now()){
  if(typeof policyPath!=='string'||!isAbsolute(policyPath)||normalize(policyPath)!==policyPath)deny('policyパス');
  const dir=dirname(policyPath);
  let dst,st,fd;
  try{dst=lstatSync(dir);st=lstatSync(policyPath);}catch{deny('policy読込');}
  if(!dst.isDirectory()||dst.isSymbolicLink()||!ownerOk(dst)||(dst.mode&0o077))deny('policyディレクトリ権限');
  if(!st.isFile()||st.isSymbolicLink()||!ownerOk(st)||(st.mode&0o077)||st.nlink!==1||st.size>GUARD_LIMITS.max_policy_bytes)deny('policyファイル権限');
  let text;
  try{
    fd=openSync(policyPath,constants.O_RDONLY|constants.O_NOFOLLOW);
    const f=fstatSync(fd);
    if(f.ino!==st.ino||f.dev!==st.dev||f.size>GUARD_LIMITS.max_policy_bytes)throw 0;
    const buf=Buffer.alloc(f.size);let off=0;
    while(off<buf.length){const n=readSync(fd,buf,off,buf.length-off,off);if(!n)break;off+=n;}
    if(off!==buf.length)throw 0;
    text=buf.toString('utf8');
  }catch{deny('policy読込');}
  finally{if(fd!==undefined)closeSync(fd);}
  let parsed;
  try{parsed=JSON.parse(text);}catch{deny('policy形式');}
  return {dir,policy:checkPolicy(parsed,now)};
}

// One-shot marker: created exclusively before deferring. Empty file; no input, prompt or output is recorded.
export function claimOnce(dir){
  let fd;
  try{fd=openSync(join(dir,USED_FILE),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch{deny('委任は使用済みです');}
  closeSync(fd);
}

export function decide(argv,stdinText,now=Date.now()){
  if(!Array.isArray(argv)||argv.length!==1)deny('引数');
  const {dir,policy}=readPolicyFile(argv[0],now);
  if(typeof stdinText!=='string'||Buffer.byteLength(stdinText)>GUARD_LIMITS.max_stdin_bytes)deny('入力サイズ');
  let event;
  try{event=JSON.parse(stdinText);}catch{deny('入力形式');}
  checkEvent(event,policy);
  claimOnce(dir);
  return {};
}

function readStdin(){
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0;
    const timer=setTimeout(()=>{process.stdin.destroy();reject(new GuardDenied('入力タイムアウト'));},GUARD_LIMITS.stdin_timeout_ms);
    process.stdin.on('data',c=>{size+=c.length;if(size>GUARD_LIMITS.max_stdin_bytes){clearTimeout(timer);process.stdin.destroy();reject(new GuardDenied('入力サイズ'));}else chunks.push(c);});
    process.stdin.on('end',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks).toString('utf8'));});
    process.stdin.on('error',()=>{clearTimeout(timer);reject(new GuardDenied('入力読込'));});
  });
}

export async function main(argv=process.argv.slice(2)){
  try{
    const out=decide(argv,await readStdin());
    process.stdout.write(JSON.stringify(out));
    process.exitCode=0;
  }catch(e){
    // Only fixed reason strings are printed; unexpected errors never echo their message.
    process.stderr.write('委任ガード: '+(e instanceof GuardDenied?e.message:'検証失敗')+'\n');
    process.exitCode=2;
  }
  setImmediate(()=>process.exit());
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main();
