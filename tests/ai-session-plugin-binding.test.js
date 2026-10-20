import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionPluginBinding,verifySessionPluginConsent,SESSION_PLUGIN_PROFILE} from '../scripts/ai-staff/session-plugin-binding.js';
import {SESSION_PLUGIN_IDS} from '../scripts/ai-staff/session-plugin-plan.js';
import {packet,model} from './helpers/async-run.js';
const checkedAt=new Date().toISOString(),token='10000000-0000-4000-8000-000000000001';
const input=()=>({cliVersion:'2.1.296 (Claude Code)',mode:'baseline',packet,model,sourceHash:'b'.repeat(64),policyObservationHash:'a'.repeat(64),userAuthorizationHash:'d'.repeat(64),usageObservationHash:'e'.repeat(64),identitySha256:'f'.repeat(64),
  token,checkedAt,
  inventory:[{path:'/synthetic/settings.json',sha256:'c'.repeat(64)}],planInput:{
    managedState:'confirmed_absent',userSettings:{enabledPlugins:Object.fromEntries(SESSION_PLUGIN_IDS.map(id=>[id,true])),
      extraKnownMarketplaces:{'openai-codex':{source:{source:'github',repo:'openai/codex-plugin-cc'}}},
      theme:'dark',inputNeededNotifEnabled:true,agentPushNotifEnabled:true},
    installed:Object.fromEntries(SESSION_PLUGIN_IDS.map(id=>[id,{version:'fixture',tree_sha256:'a'.repeat(64)}]))}});
const receipt=p=>({identity_sha256:p.binding.identity_sha256,usage_observation_sha256:p.binding.usage_observation_sha256,profile:SESSION_PLUGIN_PROFILE,binding_sha256:p.binding_sha256,plugin_ids:[...SESSION_PLUGIN_IDS],
  session_only_three_plugins:true,codex_plugin_hooks_absent_acknowledged:true,persistent_settings_changes_allowed:false,
  managed_override_allowed:false,other_plugins_disabled_allowed:false,independent_review_confirmed:true,
  remote_control:'headless_not_requested',remote_policy:'not_applicable_to_current_credential',approval_evidence_ref:'synthetic-test-evidence',
  approval_evidence_sha256:'d'.repeat(64),token:p.binding.token,checked_at:p.binding.checked_at});
test('承認はmode/入力/実装/設定/plugin版に結合し、実効確認や実行許可を生成しない',()=>{
  const p=sessionPluginBinding(input()),r=receipt(p);
  assert.deepEqual(verifySessionPluginConsent(r,p),{consent_matches:true,effective_session_verified:false,execution_authorized:false});
  for(const mutate of [x=>x.userAuthorizationHash='c'.repeat(64),x=>x.mode='delegated',x=>x.sourceHash='e'.repeat(64),x=>x.policyObservationHash='e'.repeat(64),x=>x.identitySha256='e'.repeat(64),x=>x.usageObservationHash='f'.repeat(64),
    x=>x.token='10000000-0000-4000-8000-000000000002',x=>x.checkedAt=new Date(Date.parse(checkedAt)-1000).toISOString(),
    x=>x.inventory[0].sha256='f'.repeat(64),x=>x.planInput.userSettings.theme='light',
    x=>x.planInput.installed[SESSION_PLUGIN_IDS[0]].version='changed']){
    const x=input();mutate(x);assert.throws(()=>verifySessionPluginConsent(r,sessionPluginBinding(x)));
  }
  const bad=input();bad.packet={...packet,title:'changed'};assert.throws(()=>sessionPluginBinding(bad));
  const changed=structuredClone(p);changed.plan.override.enabledPlugins[SESSION_PLUGIN_IDS[0]]=true;
  assert.throws(()=>verifySessionPluginConsent(r,changed));
});
test('版違い・不明な設定証拠・承認欠損/期限切れ/範囲拡大は拒否',()=>{
  for(const mutate of [x=>x.cliVersion='new',x=>x.inventory=[],x=>x.inventory.push(x.inventory[0]),
    x=>x.inventory[0].sha256='bad',x=>x.model='unknown']){
    const x=input();mutate(x);assert.throws(()=>sessionPluginBinding(x));
  }
  const p=sessionPluginBinding(input());
  for(const key of Object.keys(receipt(p))){const r=receipt(p);delete r[key];assert.throws(()=>verifySessionPluginConsent(r,p),key);}
  for(const patch of [{persistent_settings_changes_allowed:true},{managed_override_allowed:true},
    {independent_review_confirmed:false},{remote_control:'disconnected'},{remote_policy:'confirmed_absent'},{no_remote_or_mdm_policy:true},
    {plugin_ids:[...SESSION_PLUGIN_IDS,'other']},{checked_at:new Date(Date.now()-610000).toISOString()}])
    assert.throws(()=>verifySessionPluginConsent({...receipt(p),...patch},p));
});
