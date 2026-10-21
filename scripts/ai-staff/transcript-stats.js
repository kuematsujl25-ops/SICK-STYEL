import {TeamError} from '../../lib/ai-team.js';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(value,expected)=>object(value)&&Object.keys(value).length===Object.keys(expected).length&&
  Object.entries(expected).every(([key,want])=>Object.hasOwn(value,key)&&(object(want)?exact(value[key],want):value[key]===want));
const fail=()=>{throw new TeamError('実行統計が未確認または許可範囲外です。成果物は保存しません');};
// Absence is unknown, never evidence of zero server-side calls.
export function checkServerToolUsage(usage){
  if(usage===undefined)return false;
  if(!object(usage))fail();
  if(!Object.hasOwn(usage,'server_tool_use'))return false;
  if(!exact(usage.server_tool_use,{web_search_requests:0,web_fetch_requests:0}))fail();
  return true;
}
export function checkSubagentStats(stats,{delegate,baseline=false}={}){
  if(stats===undefined&&baseline)return false;
  const n=baseline?0:1;
  if(!exact(stats,{spawned:n,completed:n,failed:0,max_depth:n,spawned_by_subagents:0,started_in_background:n,
    requested:{background:0,foreground:0,unset:n},by_type:baseline?{}:{[delegate]:1},
    killed:{parent:0,user:0,system:0},refused:{depth_limit:0,concurrency_limit:0,budget:0}}))fail();
  return true;
}
