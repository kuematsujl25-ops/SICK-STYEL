// Evidence attribution is separate from permission. No function here grants authorization.
import {createHash} from 'node:crypto';
import {TeamError} from '../../lib/ai-team.js';
import {SESSION_PLUGIN_IDS} from './session-plugin-plan.js';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const fail=()=>{throw new TeamError('ユーザー許可の原文参照・範囲またはツール観測証拠が一致しません');};
const methods={policy:['pinned_cli_diagnostics','endpoint_enrollment','settings_inventory'],usage:['official_account_ui','official_usage_ui']};
export const provenance=kind=>({kind:'verified_tool_observation',observer:'assistant',methods:[...methods[kind]]});
export function verifyProvenance(proof,kind){
  if(Object.hasOwn(proof,'reviewed_by')||JSON.stringify(proof.observation)!==JSON.stringify(provenance(kind)))fail();
}
export function authorizationScope({mode,delegate,model,packet}){
  return {repository:'kuematsujl25-ops/SICK-STYEL',mode,delegate,model,packet_sha256:hash(packet),
    plugin_ids:[...SESSION_PLUGIN_IDS],session_only:true,codex_plugin_hooks_absent_acknowledged:true,
    persistent_settings_changes_allowed:false,managed_override_allowed:false,additional_charges_allowed:false,
    production_changes_allowed:false,quality_approval_allowed:false};
}
export function verifyObservationBundle({policy,usage,policyEvidence,usageEvidence,userAuthorization,inventory,mode,delegate,model,packet}){
  verifyProvenance(policy,'policy');verifyProvenance(usage,'usage');
  let p,u,a;try{p=JSON.parse(policyEvidence);u=JSON.parse(usageEvidence);a=JSON.parse(userAuthorization)}catch{fail()}
  const identity=policy.remote_applicability.identity.identity_sha256;
  for(const [e,proof,kind] of [[p,policy,'policy'],[u,usage,'usage']]){
    if(hash(kind==='policy'?policyEvidence:usageEvidence)!==proof.evidence_sha256||e.version!==1||
      e.observer!=='assistant'||e.kind!==kind||e.checked_at!==proof.checked_at||e.identity_sha256!==identity)fail();
  }
  if(hash(p.cli)!==hash(policy.remote_applicability)||p.endpoint?.dep_enrolled!==false||p.endpoint?.mdm_enrolled!==false||
    p.endpoint?.inventory_sha256!==hash(inventory))fail();
  if(!['https://claude.ai/settings/account','https://claude.ai/new#settings/account','https://claude.ai/new'].includes(u.account?.url)||!['https://claude.ai/settings/usage','https://claude.ai/new#settings/usage'].includes(u.usage?.url)||
    u.account.account_sha256!==usage.browser_account_sha256||u.usage.subscription_type!=='pro'||u.usage.extra_usage_enabled!==false)fail();
  for(const percent of [u.usage.session_used_percent,u.usage.weekly_used_percent])
    if(typeof percent!=='number'||!Number.isFinite(percent)||percent<0||percent>=100)fail();
  // The original human authorization remains the authority. Tool observers cannot replace its source.
  if(a.version!==1||a.authority!=='user'||a.identity_sha256!==identity||!Array.isArray(a.source_references)||!a.source_references.length||
    hash(a.scope)!==hash(authorizationScope({mode,delegate,model,packet})))fail();
  for(const ref of a.source_references){
    if(ref?.author!=='user'||typeof ref.thread_id!=='string'||!ref.thread_id.trim()||
      typeof ref.message_ref!=='string'||!ref.message_ref.trim()||typeof ref.quote!=='string'||!ref.quote.trim())fail();
  }
  return {user_authorization_sha256:hash(userAuthorization),observation_verified:true,quality_approved:false};
}
