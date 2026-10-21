import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,packet,model,delegate,session,output} from './helpers/async-run.js';
import {validateComparisonBaseline} from '../scripts/ai-staff/transcript-baseline.js';
import {validateAsyncTranscript} from '../scripts/ai-staff/transcript-async.js';
import {LIMITS} from '../scripts/ai-staff/delegate.js';
const zeros=()=>({spawned:0,completed:0,failed:0,max_depth:0,spawned_by_subagents:0,started_in_background:0,
  requested:{background:0,foreground:0,unset:0},by_type:{},
  killed:{parent:0,user:0,system:0},refused:{depth_limit:0,concurrency_limit:0,budget:0}});
const baseline=()=>{
  const f=fixture(),r=f.at(-1);
  delete r.origin;delete r.result_index;r.subagent_stats=zeros();
  f[2].tools=[];
  return [f[0],f[1],f[2],f[4],f[14],r];
};
const options={packet,model,delegate,session_id:session,limits:LIMITS};
const check=(rows,base)=>base?validateComparisonBaseline(rows.map(JSON.stringify).join('\n'),options):validateAsyncTranscript(rows,options);
const usageTargets=rows=>rows.flatMap(r=>r.type==='assistant'?[r.message]:r.type==='result'?[r]:[]);
const reported=rows=>{for(const t of usageTargets(rows))t.usage={server_tool_use:{web_search_requests:0,web_fetch_requests:0}};return rows;};

test('共通統計: baseline/委譲とも明示ゼロを照合し、欠損をゼロと断定しない',()=>{
  for(const base of [true,false]){
    const rows=reported(base?baseline():fixture()),valid=check(rows,base);
    assert.deepEqual(valid.output,output);assert.equal(valid.audit.server_tool_calls,0);
    assert.equal(valid.audit.server_tool_usage_complete,true);assert.equal(valid.audit.tool_counts_scope,'observed_transcript');
    for(const target of usageTargets(rows)){
      const saved=target.usage;delete target.usage;
      const missing=check(rows,base);assert.equal(missing.audit.server_tool_calls,null);assert.equal(missing.audit.server_tool_usage_complete,false);
      target.usage=saved;
    }
  }
  const rows=baseline();delete rows.at(-1).subagent_stats;
  assert.equal(check(rows,true).result.subagent_stats_present,false);
  const delegated=fixture();delete delegated.at(-1).subagent_stats;
  assert.throws(()=>check(delegated,false));
});

test('共通統計: 全assistant/全resultのサーバーツール非ゼロ・未知型・欠落キーを拒否',()=>{
  const invalid=[null,[],0,'0',{web_search_requests:1,web_fetch_requests:0},{web_search_requests:0,web_fetch_requests:1},
    {web_search_requests:'0',web_fetch_requests:0},{web_search_requests:false,web_fetch_requests:0},
    {web_search_requests:-1,web_fetch_requests:0},{web_search_requests:0},{},
    {web_search_requests:0,web_fetch_requests:0,unknown:0}];
  for(const base of [true,false])for(const value of invalid){
    const rows=reported(base?baseline():fixture());
    for(const target of usageTargets(rows)){
      const saved=target.usage;target.usage={server_tool_use:value};
      assert.throws(()=>check(rows,base));target.usage=saved;
    }
  }
  for(const base of [true,false])for(const value of [null,[],false,0,'unknown']){
    const rows=base?baseline():fixture();
    for(const target of usageTargets(rows)){target.usage=value;assert.throws(()=>check(rows,base));delete target.usage;}
  }
});

test('共通統計: 子実行統計の全フィールドとネストを検証し、未知・非ゼロ・矛盾を拒否',()=>{
  for(const base of [true,false]){
    const rows=base?baseline():fixture();
    for(const result of rows.filter(r=>r.type==='result')){
      const original=structuredClone(result.subagent_stats);
      const paths=Object.entries(original).flatMap(([k,v])=>typeof v==='object'?Object.keys(v).map(n=>[k,n]):[[k]]);
      for(const path of paths)for(const value of [99,'0',null,false]){
        result.subagent_stats=structuredClone(original);let obj=result.subagent_stats;
        for(const key of path.slice(0,-1))obj=obj[key];
        obj[path.at(-1)]=value;assert.throws(()=>check(rows,base),path.join('.'));
      }
      for(const value of [null,[],0,'unknown',{...original,unknown:0},{...original,by_type:{unknown:0}},
        {...original,requested:{...original.requested,unknown:0}},{...original,killed:{}},{...original,refused:null}]){
        result.subagent_stats=value;assert.throws(()=>check(rows,base));
      }
      result.subagent_stats=structuredClone(original);delete result.subagent_stats.completed;
      assert.throws(()=>check(rows,base));result.subagent_stats=original;
    }
  }
  for(const extra of [{completed:1},{spawned_by_subagents:1},{spawned:0,completed:1,spawned_by_subagents:1}]){
    const rows=baseline();Object.assign(rows.at(-1).subagent_stats,extra);assert.throws(()=>check(rows,true));
  }
});
