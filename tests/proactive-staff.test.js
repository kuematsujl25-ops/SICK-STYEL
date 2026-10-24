import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.js';
import {readProactive,configureProactive,runProactive,analyzeWorkspace,DOCUMENT} from '../lib/proactive-staff.js';
import {renderProactive} from '../public/proactive-staff.js';
const now='2026-10-24T09:00:00.000Z';
const permissions={staffTasks:true,orgSales:true,collectionTasks:true};
const workspace={staffTasks:[{id:'t1',title:'試験タスク',due:'2026-10-23',status:'未着手',assignee:'',updatedAt:now}],orgSales:[{id:'o1',name:'試験団体',nextDue:'2026-10-23',stage:'試用確認',updatedAt:now}],collectionTasks:[{id:'c1',title:'試験データ',due:'2026-10-24',status:'未収集',value:'',updatedAt:now}]};
async function fixture(t){const dir=mkdtempSync(join(tmpdir(),'proactive-test-'));const store=await createStore({DATA_DIR:dir});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return store;}
async function enable(store){const current=await readProactive(store);return configureProactive(store,{revision:current.revision,action:'configure',enabled:true,permissions});}
test('three business cases persist, reload, deduplicate and preserve human task edits and original data',async t=>{
 const store=await fixture(t);await store.put('workspace',workspace);await enable(store);
 const result=await runProactive(store,{now});assert.equal(result.state.tasks.length,3);assert.equal(result.state.runs[0].created,3);
 const reloaded=await readProactive(store);assert.deepEqual(reloaded,result);
 assert.equal(reloaded.state.tasks.find(x=>x.rule==='missing').evidence.value,null);
 await configureProactive(store,{revision:reloaded.revision,action:'task',id:reloaded.state.tasks[0].id,status:'完了'});
 assert.match((await runProactive(store,{now})).skipped,/本日/);
 const tomorrow=await runProactive(store,{now:'2026-10-25T09:00:00.000Z'});
 assert.equal(tomorrow.state.tasks.length,3);assert.equal(tomorrow.state.tasks[0].status,'完了');assert.equal(tomorrow.state.runs.at(-1).created,0);
 assert.deepEqual(JSON.parse((await store.doc('workspace')).body),workspace);
});
test('permissions, stale/future timestamps, deleted/completed records and missing data never become zero facts',()=>{
 const w=structuredClone(workspace);w.staffTasks[0].updatedAt='2026-08-01T00:00:00Z';w.orgSales[0].deletedAt=now;
 const r=analyzeWorkspace(w,permissions,now);assert.equal(r.tasks.length,1);assert.equal(r.sources[0].stale,1);
 assert.equal(analyzeWorkspace(workspace,{...permissions,collectionTasks:false},now).tasks.length,2);
 assert.equal(analyzeWorkspace(null,permissions,now).sources[0].count,null);
 const future=structuredClone(workspace);future.staffTasks[0].updatedAt='2027-01-01T00:00:00Z';future.orgSales[0].stage='連絡不要';future.collectionTasks[0].status='収集済み';assert.equal(analyzeWorkspace(future,permissions,now).tasks.length,0);
});
test('concurrent runs commit once, stop prevents execution, stale settings cannot overwrite',async t=>{
 const store=await fixture(t);await store.put('workspace',workspace);await enable(store);
 await Promise.all([runProactive(store,{now}),runProactive(store,{now})]);const current=await readProactive(store);
 assert.equal(current.state.tasks.length,3);assert.equal(current.state.runs.length,1);
 await configureProactive(store,{revision:current.revision,action:'configure',enabled:false,permissions});
 assert.equal((await runProactive(store,{now})).skipped,'停止中');
 await assert.rejects(configureProactive(store,{revision:current.revision,action:'configure',enabled:true,permissions}),/更新/);
});
test('source revision race aborts output, records failure, and retries at most twice per day',async t=>{
 const store=await fixture(t);await store.put('workspace',workspace);await enable(store);
 const racing={...store,doc:async name=>{const r=await store.doc(name);if(name==='workspace')await store.put(name,workspace);return r;}};
 await assert.rejects(runProactive(racing,{now}),/更新/);await assert.rejects(runProactive(racing,{now}),/更新/);
 const r=await runProactive(racing,{now});assert.match(r.skipped,/上限/);assert.equal(r.state.tasks.length,0);assert.equal(r.state.runs.length,2);assert.ok(r.state.runs.every(r=>r.status==='failed'));
});
test('stopping during analysis discards results without overwriting the stop',async t=>{
 const store=await fixture(t);await store.put('workspace',workspace);await enable(store);
 const stopping={...store,doc:async name=>{const r=await store.doc(name);if(name==='workspace'){const c=await readProactive(store);await configureProactive(store,{revision:c.revision,action:'configure',enabled:false,permissions});}return r;}};
 await assert.rejects(runProactive(stopping,{now}),/更新/);const r=await readProactive(store);assert.equal(r.state.enabled,false);assert.equal(r.state.tasks.length,0);
});
test('expired lease is recovered within daily attempt limit',async t=>{
 const store=await fixture(t);await store.put('workspace',workspace);await enable(store);const c=await readProactive(store);
 c.state.lease={id:'old',until:'2026-10-24T08:00:00Z'};c.state.runs=[{id:'old',day:'2026-10-24',status:'running',sources:[]}];await store.put(DOCUMENT,c.state);
 const r=await runProactive(store,{now});assert.equal(r.state.runs[0].status,'expired');assert.equal(r.state.runs[1].status,'completed');
});
test('UI distinguishes rule execution and keeps warnings visible with details closed',async t=>{
 const store=await fixture(t);const html=renderProactive(await readProactive(store),x=>String(x).replaceAll('<','&lt;'));
 assert.match(html,/モデル未実行/);assert.match(html,/未接続/);assert.match(html,/<details><summary>使い方/);assert.doesNotMatch(html,/<details open/);
});

test('first model request retains proactive controls through automatic team enable',async()=>{
 const {bindTeam}=await import('../public/ai-team.js');
 const previousDocument=globalThis.document,previousFormData=globalThis.FormData;
 const form={},updates=[],proactive={state:{enabled:false,permissions:{}},revision:3};
 globalThis.document={querySelector:selector=>selector==='#teamcreate'?form:null,querySelectorAll:()=>[]};
 globalThis.FormData=class{*[Symbol.iterator](){yield* Object.entries({role:'coo',title:'試験',objective:'確認',fact:'',source:'',date:'2026-10-24'});}};
 try{
  bindTeam({model:{state:{enabled:false},revision:0,proactive},api:async(_path,_method,body)=>({state:{enabled:true,jobs:[]},revision:body.command.action==='toggle'?1:2}),setModel:m=>updates.push(m),render:()=>{},toast:()=>{}});
  await form.onsubmit({preventDefault(){}});
  assert.equal(updates.length,2);assert.ok(updates.every(m=>m.proactive===proactive));
 }finally{globalThis.document=previousDocument;globalThis.FormData=previousFormData;}
});

async function enableModelQueue(store){
 const {writeTeam}=await import('../lib/ai-team.js');await writeTeam(store,{revision:0,command:{action:'toggle',enabled:true}});
 const c=await readProactive(store);await configureProactive(store,{revision:c.revision,action:'configure',enabled:true,modelQueue:true,permissions});
}
test('proactive facts become model requests and mock runner imports results without real model calls',async t=>{
 const {readTeam,writeTeam,taskPacket}=await import('../lib/ai-team.js');const {oneCycle}=await import('../scripts/ai-staff/auto-runner.js');
 const store=await fixture(t);await store.put('workspace',workspace);await enableModelQueue(store);await runProactive(store,{now});
 let team=await readTeam(store);assert.equal(team.state.jobs.length,2);assert.ok(team.state.jobs.every(j=>j.proactiveSource));
 assert.ok(!JSON.stringify(team).includes('試験団体')); // Aggregate facts only; no customer titles.
 const response=value=>({ok:true,status:200,text:async()=>JSON.stringify(value)});
 const request=async(url,opts)=>{
  const u=new URL(url);
  if(opts.method==='POST'){return response(await writeTeam(store,JSON.parse(opts.body)));}
  const m=await readTeam(store);
  if(u.pathname.endsWith('/task'))return response(taskPacket(m.state.jobs.find(j=>j.id===u.searchParams.get('job_id'))));
  return response({...m,proactive:await readProactive(store)});
 };
 let calls=0;const seen=new Set();
 const run=async p=>{calls++;const at=new Date().toISOString();return {outputFile:'/tmp/mock-proactive.json',result:{version:1,job_id:p.job_id,input_hash:p.input_hash,business_unit:'sickstyle',provider:'claude',execution_id:'mock-'+p.job_id,started_at:at,finished_at:at,output:{summary:'期限超過の原因確認を提案',fact_ids:['count'],missing_data:['個別の進捗'],hypotheses:[],recommendations:[{title:'進捗確認',steps:['担当者の進捗を確認'],kpi:'未確認件数',estimated_profit_jpy:null,cost_jpy:null,effort_hours:null,evidence_ids:['count'],risks:['原因は未確認']}],approvals_required:['外部への連絡'],limitations:['集計情報のみ。個別事情は未確認']}}};};
 assert.equal((await oneCycle('mock',seen,{request,run})).imported,true);
 team=await readTeam(store);assert.equal(team.state.jobs[0].status,'in_review');assert.equal(team.state.jobs[0].output.fact_ids[0],'count');
 const c=await readProactive(store);await configureProactive(store,{revision:c.revision,action:'configure',enabled:false,modelQueue:true,permissions});
 assert.equal((await oneCycle('mock',seen,{request,run})).processed,false);assert.equal(calls,1);
 await assert.rejects(writeTeam(store,{revision:team.revision,command:{action:'import',job_id:team.state.jobs[1].id,packet:{}}}),/停止中/);
});
test('team edit racing with queue commit preserves team and discards generated requests',async t=>{
 const {readTeam,writeTeam}=await import('../lib/ai-team.js');const store=await fixture(t);await store.put('workspace',workspace);await enableModelQueue(store);
 const racing={...store,transaction:async commands=>{
  if(commands.length===3&&commands[2][1][1]==='ai-team-sickstyle-v1'){
   const team=await readTeam(store);await writeTeam(store,{revision:team.revision,command:{action:'toggle',enabled:false}});
  }
  return store.transaction(commands);
 }};
 await assert.rejects(runProactive(racing,{now}),/更新/);
 assert.equal((await readTeam(store)).state.jobs.length,0);assert.equal((await readTeam(store)).state.enabled,false);assert.equal((await readProactive(store)).state.tasks.length,0);
});
test('queue stays off by default and repeated analysis cannot duplicate linked model jobs',async t=>{
 const {readTeam}=await import('../lib/ai-team.js');const store=await fixture(t);await store.put('workspace',workspace);await enableModelQueue(store);
 await runProactive(store,{now});const first=await readTeam(store);
 await runProactive(store,{now:'2026-10-25T09:00:00.000Z'});assert.deepEqual((await readTeam(store)).state.jobs,first.state.jobs);
});

test('manual proactive run refreshes model jobs and revision before the next team action',async()=>{
 const {bindTeam}=await import('../public/ai-team.js');const previous=globalThis.document;const run={},toggle={},updates=[],calls=[];
 globalThis.document={querySelector:s=>s==='#proactive-run'?run:s==='#teamtoggle'?toggle:null,querySelectorAll:()=>[]};
 try{
 const fresh={state:{enabled:true,jobs:[{id:'generated'}]},revision:8,proactive:{revision:5,state:{}}};
 bindTeam({model:{state:{enabled:true,jobs:[]},revision:7,proactive:{revision:3,state:{}}},api:async(path,method,body)=>{calls.push({path,method,body});return path==='ai-proactive'?fresh.proactive:fresh;},setModel:m=>updates.push(m),render:()=>{},toast:e=>assert.fail(e)});
 await run.onclick();await toggle.onclick();
 assert.equal(updates[0],fresh);assert.equal(calls[1].path,'ai-team');assert.equal(calls[2].body.revision,8);
 }finally{globalThis.document=previous;}
});
