// Read-only inventory. Local absence never establishes remote policy or Remote Control state.
import {readFileSync,lstatSync,readdirSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {TeamError} from '../../lib/ai-team.js';
import {SESSION_PLUGIN_IDS,buildSessionPluginPlan} from './session-plugin-plan.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=()=>{throw new TeamError('プラグイン実体・ポリシー証拠が不明または変更されています');};
function stat(path){
  try{return lstatSync(path)}catch(e){if(e.code==='ENOENT')return null;throw e}
}
function file(path){
  const s=stat(path);
  if(!s?.isFile()||s.isSymbolicLink()||realpathSync(path)!==path||s.nlink!==1||s.size>16_000_000)fail();
  return readFileSync(path);
}
export function pluginTreeHash(root){
  if(!isAbsolute(root)||resolve(root)!==root||realpathSync(root)!==root)fail();
  const manifest=[];let bytes=0,count=0;
  function walk(dir){
    const s=stat(dir);if(!s?.isDirectory()||s.isSymbolicLink())fail();
    for(const name of readdirSync(dir).sort()){
      // CLI liveness marker is mutable and contains no executable plugin configuration.
      if(name==='.in_use')continue;
      if(++count>50000)fail();
      const path=join(dir,name),entry=stat(path);
      if(entry?.isSymbolicLink())fail();
      if(entry?.isDirectory()){manifest.push([relative(root,path)+'/']);walk(path)}
      else{
        const content=file(path);bytes+=content.length;if(bytes>256_000_000)fail();
        manifest.push([relative(root,path),sha(content)]);
      }
    }
  }
  walk(root);return sha(JSON.stringify(manifest));
}
export function verifyPolicyObservation(proof,now=Date.now()){
  if(proof?.version!==1||proof.managed_policy!=='confirmed_absent'||
    proof.remote_policy!=='confirmed_absent'||proof.remote_control!=='disconnected'||
    proof.reviewed_by!=='human'||typeof proof.evidence_ref!=='string'||!proof.evidence_ref.trim()||
    !/^[a-f0-9]{64}$/.test(proof.evidence_sha256||'')||
    !Number.isFinite(now)||!Number.isFinite(Date.parse(proof.checked_at))||
    Date.parse(proof.checked_at)>now||now-Date.parse(proof.checked_at)>600000)fail();
  return proof;
}
export function readSessionPluginInventory({paths,home,policyObservation,now=Date.now()}){
  verifyPolicyObservation(policyObservation,now);
  const user=join(home,'.claude/settings.json'),registry=join(home,'.claude/plugins/installed_plugins.json');
  if(!paths.includes(user)||!paths.includes(registry))fail();
  const texts=new Map();
  const inventory=[...new Set(paths)].sort().map(path=>{
    if(!isAbsolute(path)||resolve(path)!==path)fail();
    if(!stat(path))return {path,sha256:null};
    // Additional local/project/managed settings require a new reviewed profile, even if empty.
    if(path!==user&&path!==registry)fail();
    const content=file(path);texts.set(path,content);
    return {path,sha256:sha(content)};
  });
  let settings,registered;
  try{settings=JSON.parse(texts.get(user));registered=JSON.parse(texts.get(registry))}catch{fail()}
  if(registered?.version!==2||Object.keys(registered).sort().join(',')!=='plugins,version'||
    !registered.plugins||Object.keys(registered.plugins).sort().join(',')!==[...SESSION_PLUGIN_IDS].sort().join(','))fail();
  const installed={};
  for(const id of SESSION_PLUGIN_IDS){
    const entries=registered.plugins[id];
    if(!Array.isArray(entries)||entries.length!==1)fail();
    const entry=entries[0],cache=join(home,'.claude/plugins/cache')+'/';
    if(entry.scope!=='user'||typeof entry.installPath!=='string'||!entry.installPath.startsWith(cache)||
      resolve(entry.installPath)!==entry.installPath||typeof entry.version!=='string'||!entry.version)fail();
    installed[id]={version:entry.version,tree_sha256:pluginTreeHash(entry.installPath)};
    inventory.push({path:entry.installPath,sha256:installed[id].tree_sha256});
  }
  const planInput={userSettings:settings,installed,managedState:policyObservation.managed_policy};
  buildSessionPluginPlan(planInput);
  return {inventory,planInput,policyObservation};
}
