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
