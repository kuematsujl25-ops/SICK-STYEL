// Offline binding for review. This module neither launches a process nor changes settings.
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {KNOWN_MODELS} from './delegate.js';
import {TeamError} from '../../lib/ai-team.js';
import {validateTaskPacket} from '../../lib/ai-team.js';
import {buildSessionPluginPlan,SESSION_PLUGIN_IDS} from './session-plugin-plan.js';
export const SESSION_PLUGIN_PROFILE='claude-2.1.296-session-three-plugins-v3';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=()=>{throw new TeamError('セッション限定設定の承認・実装・入力の対応を確認できません');};
export function sessionPluginBinding({planInput,cliVersion,mode,packet,model,sourceHash,inventory,policyObservationHash,usageObservationHash,identitySha256,token,checkedAt}){
  validateTaskPacket(packet);
  if(cliVersion!=='2.1.296 (Claude Code)'||!['baseline','delegated'].includes(mode)||
    !KNOWN_MODELS.includes(model)||!digest(sourceHash)||!digest(policyObservationHash)||!digest(usageObservationHash)||!digest(identitySha256)||
    typeof token!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(token)||
    !Number.isFinite(Date.parse(checkedAt))||
    !Array.isArray(inventory)||inventory.length===0)fail();
  const paths=new Set();
  for(const entry of inventory){
    if(!entry||Object.keys(entry).sort().join(',')!=='path,sha256'||typeof entry.path!=='string'||
      !entry.path.startsWith('/')||resolve(entry.path)!==entry.path||paths.has(entry.path)||(entry.sha256!==null&&!digest(entry.sha256)))fail();
    paths.add(entry.path);
  }
  const plan=buildSessionPluginPlan(planInput);
  const binding={profile:SESSION_PLUGIN_PROFILE,cli_version:cliVersion,mode,model,token,checked_at:checkedAt,
    packet_sha256:sha(packet),source_sha256:sourceHash,inventory_sha256:sha(inventory),policy_observation_sha256:policyObservationHash,
    usage_observation_sha256:usageObservationHash,identity_sha256:identitySha256,
    user_settings_sha256:plan.user_settings_sha256,installed_snapshot_sha256:plan.installed_snapshot_sha256,
    override_sha256:plan.override_sha256};
  return {plan,binding,binding_sha256:sha(binding),execution_authorized:false};
}
export function verifySessionPluginConsent(receipt,prepared,now=Date.now()){
  if(receipt?.profile!==SESSION_PLUGIN_PROFILE||receipt.binding_sha256!==prepared.binding_sha256||
    receipt.identity_sha256!==prepared.binding.identity_sha256||receipt.usage_observation_sha256!==prepared.binding.usage_observation_sha256||
    receipt.token!==prepared.binding.token||receipt.checked_at!==prepared.binding.checked_at||
    prepared.binding_sha256!==sha(prepared.binding)||prepared.execution_authorized!==false||
    prepared.binding.override_sha256!==sha(prepared.plan?.override)||
    JSON.stringify(prepared.plan?.override)!==JSON.stringify({enabledPlugins:Object.fromEntries(SESSION_PLUGIN_IDS.map(id=>[id,false]))})||
    receipt.session_only_three_plugins!==true||receipt.codex_plugin_hooks_absent_acknowledged!==true||
    receipt.persistent_settings_changes_allowed!==false||receipt.managed_override_allowed!==false||
    receipt.other_plugins_disabled_allowed!==false||receipt.independent_review_confirmed!==true||
    receipt.remote_control!=='headless_not_requested'||receipt.remote_policy!=='not_applicable_to_current_credential'||
    Object.hasOwn(receipt,'remote_control_disconnected_confirmed')||Object.hasOwn(receipt,'no_remote_or_mdm_policy')||
    !Array.isArray(receipt.plugin_ids)||JSON.stringify(receipt.plugin_ids)!==JSON.stringify(SESSION_PLUGIN_IDS)||
    typeof receipt.approval_evidence_ref!=='string'||!receipt.approval_evidence_ref.trim()||
    !digest(receipt.approval_evidence_sha256)||
    !Number.isFinite(now)||!Number.isFinite(Date.parse(receipt.checked_at))||
    Date.parse(receipt.checked_at)>now||now-Date.parse(receipt.checked_at)>600000)fail();
  // A matching receipt is a prerequisite, not proof that a real session loaded this configuration.
  return {consent_matches:true,effective_session_verified:false,execution_authorized:false};
}
