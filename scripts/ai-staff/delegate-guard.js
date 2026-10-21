// Phase T: deny-only PreToolUse command hook for one pre-fixed delegation (offline/local, no network or model).
// Used by approved probes and the explicit opt-in delegate-runtime.js route.
// Usage: node delegate-guard.js /abs/private-run-dir/policy.json  (hook stdin = PreToolUse event JSON)
// It never returns "allow" or updatedInput: the single valid Agent request gets "{}" + exit 0 (defer to the
// existing permission rules); everything else exits 2 with a short reason that contains no input or secret text.
// The hook must be configured with onFailure: block so a crash/timeout of this guard also blocks the tool call.
import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
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

// Parse valid JSON without silently accepting duplicate (including escaped) object keys.
export function strictJson(text){
  const value=JSON.parse(text);let i=0;
  const space=()=>{while(/\s/.test(text[i]||'')&&i<text.length)i++};
  const string=()=>{const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue}if(text[i++]==='"')break}return JSON.parse(text.slice(start,i))};
  const scan=(depth=0)=>{
    if(depth>128)throw new Error('JSON depth');space();
    if(text[i]==='"'){string();return}
    if(text[i]==='{'){
      i++;space();const keys=new Set();if(text[i]==='}'){i++;return}
      while(true){space();const key=string();if(keys.has(key))throw new Error('JSON duplicate key');keys.add(key);space();i++;scan(depth+1);space();if(text[i++]==='}')return}
    }
    if(text[i]==='['){i++;space();if(text[i]===']'){i++;return}while(true){scan(depth+1);space();if(text[i++]===']')return}}
    const start=i;while(i<text.length&&!/[\s,}\]]/.test(text[i]))i++;
    const scalar=JSON.parse(text.slice(start,i));if(typeof scalar==='number'&&!Number.isFinite(scalar))throw new Error('JSON number');
  };
  scan();return value;
}
// Semantic digest: only object key order is normalized. Prompt strings are never parsed/re-written.
export function canonicalInputHash(value){
  const encode=v=>{
    if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
    if(typeof v==='number'&&Number.isFinite(v))return Object.is(v,-0)?'-0':JSON.stringify(v);
    if(Array.isArray(v))return '['+v.map(encode).join(',')+']';
    if(plain(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+encode(v[k])).join(',')+'}';
    throw new Error('JSON value');
  };
  return createHash('sha256').update(encode(value)).digest('hex');
}
// Agent input is exactly three strings, so six raw serializations cover key-order differences only.
export function verifyInputHashes(input,receipt,{allowLegacy=false}={}){
  if(!sameKeys(input,AGENT_INPUT_KEYS)||Object.values(input).some(v=>typeof v!=='string'))deny('Agent入力の項目');
  const permutation=a=>a.length?a.flatMap((k,i)=>permutation(a.filter((_,j)=>j!==i)).map(t=>[k,...t])):[[]];
  const rawMatches=permutation(AGENT_INPUT_KEYS).filter(keys=>createHash('sha256').update(JSON.stringify(Object.fromEntries(keys.map(k=>[k,input[k]])))).digest('hex')===receipt.input_sha256);
  const semantic=canonicalInputHash(input),legacy=!Object.hasOwn(receipt,'input_canonical_sha256');
  if(!rawMatches.length||(legacy?!allowLegacy:receipt.input_canonical_sha256!==semantic))deny('Agent入力hash');
  return {input_sha256:receipt.input_sha256,input_canonical_sha256:semantic,legacy_key_order_evidence:legacy?rawMatches[0]:null};
}

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
  try{sent=strictJson(input.prompt);}catch{deny('依頼データ不一致');}
  // Raw text must be plain minified JSON (no padding, duplicate keys or alternative number forms), and its
  // canonical form must equal the fixed packet exactly (all keys, value types and array order).
  if(input.prompt!==JSON.stringify(sent)||canonicalJson(sent)!==policy.expected_prompt)deny('依頼データ不一致');
  return true;
}

const ownerOk=st=>typeof process.getuid!=='function'||st.uid===process.getuid();
// Reads only the policy path given as the argument (never paths from the hook input).
function readPrivateJson(policyPath){
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
  try{parsed=strictJson(text);}catch{deny('policy形式');}
  return {dir,value:parsed};
}

export function readPolicyFile(policyPath,now=Date.now()){
  const {dir,value}=readPrivateJson(policyPath);
  return {dir,policy:checkPolicy(value,now)};
}
// Written only by the parent after both early audits; the tool hook never creates this receipt.
export function parentAuditRecord(policyPath){
  const {value}=readPrivateJson(policyPath);
  return {version:1,stage:'startup_init_audited',session_id:value.session_id,
    policy_sha256:createHash('sha256').update(canonicalJson(value)).digest('hex')};
}
export function verifyParentAudit(policyPath,session){
  const expected=parentAuditRecord(policyPath);
  const {value}=readPrivateJson(join(dirname(policyPath),'parent-audit.json'));
  if(expected.session_id!==session||canonicalJson(value)!==canonicalJson(expected))deny('親startup/init監査証拠');
  return true;
}

// One-shot marker: created exclusively before deferring. Empty file; no input, prompt or output is recorded.
export function claimOnce(dir){
  let fd;
  try{fd=openSync(join(dir,USED_FILE),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch{deny('委任は使用済みです');}
  closeSync(fd);
}

export function decide(argv,stdinText,now=Date.now()){
  if(!Array.isArray(argv)||![1,2].includes(argv.length)||argv.length===2&&!['startup','tool','deny'].includes(argv[1]))deny('引数');
  const {dir,policy}=readPolicyFile(argv[0],now);
  if(typeof stdinText!=='string'||Buffer.byteLength(stdinText)>GUARD_LIMITS.max_stdin_bytes)deny('入力サイズ');
  let event;
  try{event=strictJson(stdinText);}catch{deny('入力形式');}
  if(argv[1]==='startup'){
    if(event.hook_event_name!=='SessionStart'||event.session_id!==policy.session_id||event.source!=='startup'||
      Object.hasOwn(event,'agent_id')||Object.hasOwn(event,'agent_type'))deny('startup不一致');
    writeFileSync(join(dir,'started.json'),JSON.stringify({stage:'startup',session_id:policy.session_id}),{mode:0o600,flag:'wx'});
    return {};
  }
  if(argv[1]==='deny')deny('親単独のツール禁止');
  checkEvent(event,policy);
  if(argv[1]==='tool'&&(!existsSync(join(dir,'started.json'))||typeof event.tool_use_id!=='string'||!event.tool_use_id))deny('startup証拠/ツールID');
  if(argv[1]==='tool')verifyParentAudit(argv[0],policy.session_id);
  claimOnce(dir);
  if(argv[1]==='tool')writeFileSync(join(dir,'tool.json'),JSON.stringify({stage:'tool',session_id:policy.session_id,
    tool_use_id:event.tool_use_id,tool_name:event.tool_name,
    input_sha256:createHash('sha256').update(JSON.stringify(event.tool_input)).digest('hex'),
    input_canonical_sha256:canonicalInputHash(event.tool_input)}),{mode:0o600,flag:'wx'});
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
