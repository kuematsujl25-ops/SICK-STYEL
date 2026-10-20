import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSessionPluginPlan,SESSION_PLUGIN_IDS} from '../scripts/ai-staff/session-plugin-plan.js';
const fixture=()=>({
  userSettings:{enabledPlugins:Object.fromEntries(SESSION_PLUGIN_IDS.map(id=>[id,true])),
    extraKnownMarketplaces:{'openai-codex':{source:{source:'github',repo:'openai/codex-plugin-cc'}}},
    theme:'dark',inputNeededNotifEnabled:true,agentPushNotifEnabled:true},
  installed:Object.fromEntries(SESSION_PLUGIN_IDS.map(id=>[id,{version:'fixture',tree_sha256:'a'.repeat(64)}])),
  managedState:'confirmed_absent'
});
test('限定案は対象3件のみ、設定原本を変えず、実行許可や既存安全hook保持の誤認を避ける',()=>{
  const input=fixture(),before=structuredClone(input),plan=buildSessionPluginPlan(input);
  assert.deepEqual(input,before);
  assert.deepEqual(plan.override,{enabledPlugins:Object.fromEntries(SESSION_PLUGIN_IDS.map(id=>[id,false]))});
  assert.equal(plan.status,'proposal_only');assert.equal(plan.execution_authorized,false);
  assert.equal(plan.requires_independent_review,true);assert.equal(plan.notifications_require_remote_control_check,true);
  assert.ok(plan.removed_plugin_hooks.includes('codex:Stop'));
  assert.ok(!/disableAllHooks|setting-sources|safe-mode|restricted/.test(JSON.stringify(plan.override)));
});
test('未知設定・安全hook・別plugin・不明managedは無効化せず拒否',()=>{
  for(const mutate of [
    x=>x.userSettings.hooks={PreToolUse:[]},x=>x.userSettings.disableAllHooks=true,
    x=>x.userSettings.unknown=true,x=>x.userSettings.enabledPlugins.other=true,
    x=>x.installed.other={version:'fixture',tree_sha256:'a'.repeat(64)},
    x=>x.managedState='unknown',x=>x.managedState='present',
    x=>x.userSettings.extraKnownMarketplaces['openai-codex'].source.repo='other/repo',
    x=>x.userSettings.extraKnownMarketplaces['openai-codex'].autoUpdate=true
  ]){
    const input=fixture();mutate(input);const before=structuredClone(input);
    assert.throws(()=>buildSessionPluginPlan(input));assert.deepEqual(input,before);
  }
});
test('UI/通知型とplugin hashを厳格に確認し、設定/版/override証拠を分ける',()=>{
  for(const key of ['theme','inputNeededNotifEnabled','agentPushNotifEnabled'])
    for(const value of [null,{},[],0,'unknown']){
      const input=fixture();input.userSettings[key]=value;assert.throws(()=>buildSessionPluginPlan(input));
    }
  const input=fixture(),first=buildSessionPluginPlan(input);
  input.userSettings.theme='light';const second=buildSessionPluginPlan(input);
  assert.notEqual(first.user_settings_sha256,second.user_settings_sha256);
  assert.equal(first.override_sha256,second.override_sha256);
  input.installed[SESSION_PLUGIN_IDS[0]].version='updated';
  assert.notEqual(second.installed_snapshot_sha256,buildSessionPluginPlan(input).installed_snapshot_sha256);
  input.installed[SESSION_PLUGIN_IDS[0]].tree_sha256='invalid';assert.throws(()=>buildSessionPluginPlan(input));
});
