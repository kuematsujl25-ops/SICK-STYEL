// Pure proposal generator. The guarded launcher separately verifies live inventory and consent.
import {createHash} from 'node:crypto';
import {TeamError} from '../../lib/ai-team.js';
export const SESSION_PLUGIN_IDS=Object.freeze([
  'frontend-design@claude-plugins-official','codex@openai-codex','discord@claude-plugins-official'
]);
const fail=()=>{throw new TeamError('セッション限定プラグイン案の前提条件を確認してください');};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const exactKeys=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
// Separate UI/notification semantics from plugin execution. Notifications are not classified as harmless.
export function buildSessionPluginPlan({userSettings,installed,managedState}){
  if(managedState!=='confirmed_absent')fail();
  const keys=['enabledPlugins','extraKnownMarketplaces','theme','inputNeededNotifEnabled','agentPushNotifEnabled'];
  if(!exactKeys(userSettings,keys)||!exactKeys(userSettings.enabledPlugins,SESSION_PLUGIN_IDS)||
    !SESSION_PLUGIN_IDS.every(id=>userSettings.enabledPlugins[id]===true)||
    !['dark','light','dark-daltonized','light-daltonized','dark-ansi','light-ansi'].includes(userSettings.theme)||
    typeof userSettings.inputNeededNotifEnabled!=='boolean'||typeof userSettings.agentPushNotifEnabled!=='boolean')fail();
  const marketplaces=userSettings.extraKnownMarketplaces;
  if(!exactKeys(marketplaces,['openai-codex'])||!exactKeys(marketplaces['openai-codex'],['source'])||
    !exactKeys(marketplaces['openai-codex'].source,['source','repo'])||
    marketplaces['openai-codex'].source.source!=='github'||marketplaces['openai-codex'].source.repo!=='openai/codex-plugin-cc')fail();
  if(!exactKeys(installed,SESSION_PLUGIN_IDS))fail();
  for(const id of SESSION_PLUGIN_IDS){
    const entry=installed[id];
    if(!exactKeys(entry,['version','tree_sha256'])||typeof entry.version!=='string'||!entry.version||
      !/^[a-f0-9]{64}$/.test(entry.tree_sha256))fail();
  }
  const override={enabledPlugins:Object.fromEntries(SESSION_PLUGIN_IDS.map(id=>[id,false]))};
  return {
    version:1,status:'proposal_only',execution_authorized:false,requires_independent_review:true,
    override,user_settings_sha256:hash(userSettings),installed_snapshot_sha256:hash(installed),
    override_sha256:hash(override),managed_state:managedState,
    preserved_settings:keys.filter(k=>k!=='enabledPlugins'),
    notifications_require_remote_control_check:userSettings.inputNeededNotifEnabled||userSettings.agentPushNotifEnabled,
    removed_plugin_hooks:['codex:SessionStart','codex:Stop','codex:SessionEnd'],
    required_runtime_evidence:['effective plugin set','no Discord process or MCP connection',
      'user/managed policy unchanged','all guard startup evidence before stdin','child restrictions inherited']
  };
}
