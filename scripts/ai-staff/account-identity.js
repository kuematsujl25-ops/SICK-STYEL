// Identity binding only: never retain OAuth tokens, raw email, or display names.
import {verifyProvenance} from './observation-provenance.js';
import {createHash} from 'node:crypto';
import {TeamError} from '../../lib/ai-team.js';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=()=>{throw new TeamError('利用枠確認・承認・CLIの本人または組織が一致しません');};
export function accountHash(email){
  if(typeof email!=='string')fail();
  const normalized=email.trim().normalize('NFC').toLowerCase();
  if(normalized.length>254||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(normalized))fail();
  return sha(['claude-account-email-v1',normalized]);
}
export function identityFromAuth(auth){
  if(typeof auth?.orgId!=='string')fail();
  const org=auth.orgId.trim().toLowerCase();
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(org))fail();
  const account_sha256=accountHash(auth.email),org_sha256=sha(['claude-org-id-v1',org]);
  return {account_sha256,org_sha256,identity_sha256:sha(['claude-identity-v1',account_sha256,org_sha256])};
}
export function verifyIdentity(value){
  if(!value||Object.keys(value).sort().join(',')!=='account_sha256,identity_sha256,org_sha256'||
    !digest(value.account_sha256)||!digest(value.org_sha256)||
    value.identity_sha256!==sha(['claude-identity-v1',value.account_sha256,value.org_sha256]))fail();
  return value;
}
export function verifyUsageObservation(proof,identity,now=Date.now()){
  verifyIdentity(identity);verifyProvenance(proof,'usage');
  if(proof?.version!==2||proof.source!=='claude.ai_account_and_usage_ui'||
    proof.browser_account_sha256!==identity.account_sha256||proof.cli_identity_sha256!==identity.identity_sha256||
    proof.subscription_type!=='pro'||proof.extra_usage_enabled!==false||proof.usage_available!==true||
    typeof proof.evidence_ref!=='string'||!proof.evidence_ref.trim()||!digest(proof.evidence_sha256)||
    !Number.isFinite(now)||!Number.isFinite(Date.parse(proof.checked_at))||
    Date.parse(proof.checked_at)>now||now-Date.parse(proof.checked_at)>600000)fail();
  return proof;
}
