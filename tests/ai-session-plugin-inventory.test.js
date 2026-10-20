import {applicability} from './helpers/policy-applicability.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pluginTreeHash,readSessionPluginInventory,verifyPolicyObservation} from '../scripts/ai-staff/session-plugin-inventory.js';
import {SESSION_PLUGIN_IDS} from '../scripts/ai-staff/session-plugin-plan.js';
const proof=()=>({version:2,managed_policy:'confirmed_absent',remote_policy:'not_applicable_to_current_credential',remote_control:'headless_not_requested',remote_applicability:applicability(),
  reviewed_by:'human',evidence_ref:'/synthetic/private-evidence',evidence_sha256:'a'.repeat(64),checked_at:new Date().toISOString()});
test('実体hashは追加・削除・依存ファイル変更を検出、内部直接リンクも固定',()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'ss-tree-')));
  try{
    writeFileSync(join(root,'plugin.js'),'fixture');const first=pluginTreeHash(root);
    mkdirSync(join(root,'node_modules'));writeFileSync(join(root,'node_modules','dependency.js'),'one');
    const second=pluginTreeHash(root);assert.notEqual(first,second);
    writeFileSync(join(root,'node_modules','dependency.js'),'two');assert.notEqual(second,pluginTreeHash(root));
    rmSync(join(root,'node_modules'),{recursive:true});assert.equal(first,pluginTreeHash(root));
    symlinkSync('plugin.js',join(root,'link'));const linked=pluginTreeHash(root);assert.notEqual(first,linked);
    writeFileSync(join(root,'plugin.js'),'changed');assert.notEqual(linked,pluginTreeHash(root));
  }finally{rmSync(root,{recursive:true,force:true})}
});
test('ローカル設定の不在からmanaged/remote/Remote Controlを推定しない',()=>{
  const p=proof();assert.equal(verifyPolicyObservation(p),p);
  for(const key of Object.keys(p)){const copy={...p};delete copy[key];assert.throws(()=>verifyPolicyObservation(copy));}
  for(const patch of [{managed_policy:'unknown'},{remote_policy:'unknown'},{remote_control:'unknown'},
    {reviewed_by:'model'},{checked_at:new Date(Date.now()-610000).toISOString()}])
    assert.throws(()=>verifyPolicyObservation({...p,...patch}));
});
test('実registryと設定を読み取り、別scope・追加設定・安全hook・実体変更は拒否またはhash差',()=>{
  const home=realpathSync(mkdtempSync(join(tmpdir(),'ss-inventory-')));
  const user=join(home,'.claude/settings.json'),registry=join(home,'.claude/plugins/installed_plugins.json');
  const paths=[user,registry,join(home,'.claude/settings.local.json')],plugins={};
  try{
    for(const id of SESSION_PLUGIN_IDS){
      const installPath=join(home,'.claude/plugins/cache',id);
      mkdirSync(installPath,{recursive:true});writeFileSync(join(installPath,'entry.js'),'fixture');
      plugins[id]=[{scope:'user',installPath,version:'fixture'}];
    }
    const settings={enabledPlugins:Object.fromEntries(SESSION_PLUGIN_IDS.map(id=>[id,true])),
      extraKnownMarketplaces:{'openai-codex':{source:{source:'github',repo:'openai/codex-plugin-cc'}}},
      theme:'dark',inputNeededNotifEnabled:true,agentPushNotifEnabled:true};
    writeFileSync(user,JSON.stringify(settings));writeFileSync(registry,JSON.stringify({version:2,plugins}));
    const read=()=>readSessionPluginInventory({paths,home,policyObservation:proof()});
    const before=read();writeFileSync(join(plugins[SESSION_PLUGIN_IDS[0]][0].installPath,'entry.js'),'changed');
    assert.notDeepEqual(before.inventory,read().inventory);
    writeFileSync(paths[2],'{}');assert.throws(read);rmSync(paths[2]);
    writeFileSync(user,JSON.stringify({...settings,hooks:{PreToolUse:[]}}));assert.throws(read);
    writeFileSync(user,JSON.stringify(settings));
    plugins[SESSION_PLUGIN_IDS[0]][0].scope='project';writeFileSync(registry,JSON.stringify({version:2,plugins}));assert.throws(read);
  }finally{rmSync(home,{recursive:true,force:true})}
});

 test('.in_useのroot/nestedファイルとdir内容もhash対象、同名symlinkは拒否',()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'ss-marker-'))),marker=join(root,'.in_use');
  try{
    writeFileSync(join(root,'entry.js'),'fixture');const first=pluginTreeHash(root);
    writeFileSync(marker,'1',{mode:0o600});const regular=pluginTreeHash(root);assert.notEqual(first,regular);
    writeFileSync(marker,'2');assert.notEqual(regular,pluginTreeHash(root));rmSync(marker);
    mkdirSync(marker);writeFileSync(join(marker,'hook.js'),'hidden');const directory=pluginTreeHash(root);
    writeFileSync(join(marker,'hook.js'),'changed');assert.notEqual(directory,pluginTreeHash(root));rmSync(marker,{recursive:true});
    symlinkSync('entry.js',marker);assert.throws(()=>pluginTreeHash(root));rmSync(marker);
    mkdirSync(join(root,'nested'));writeFileSync(join(root,'nested','.in_use'),'hidden');const nested=pluginTreeHash(root);
    writeFileSync(join(root,'nested','.in_use'),'changed');assert.notEqual(nested,pluginTreeHash(root));
    rmSync(join(root,'nested','.in_use'));symlinkSync('../entry.js',join(root,'nested','.in_use'));assert.throws(()=>pluginTreeHash(root));
  }finally{rmSync(root,{recursive:true,force:true})}
 });
 test('依存linkの文字列/内容変更を固定し、外部・循環・dangling・連鎖・dirを拒否',()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'ss-links-'))),link=join(root,'link');
  try{
    writeFileSync(join(root,'target'),'fixture');symlinkSync('target',link);const first=pluginTreeHash(root);
    rmSync(link);symlinkSync('./target',link);assert.notEqual(first,pluginTreeHash(root));rmSync(link);
    mkdirSync(join(root,'dir'));symlinkSync('target',join(root,'chain'));
    for(const target of ['/etc/hosts','link','missing','chain','dir']){
      symlinkSync(target,link);assert.throws(()=>pluginTreeHash(root),target);rmSync(link);
    }
  }finally{rmSync(root,{recursive:true,force:true})}
 });
