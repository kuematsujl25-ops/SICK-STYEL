import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../lib/store.js';
import {emptyTeam,createJob,transitionTeam,readTeam,writeTeam,TEAM_DOCUMENT,digest} from '../lib/ai-team.js';
import {encodeTeamState,decodeTeamState,prepareTeamStorage,reviewReserve} from '../lib/ai-team-storage.js';

const now='2026-10-18T01:00:00.000Z';
const size=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const output=(summary='架空の確認結果')=>({summary,fact_ids:[],missing_data:[],hypotheses:[],recommendations:[],approvals_required:[],limitations:['架空データの検証']});
const note='x'+'\0'.repeat(999);
function pendingState(count=1){
  const state=emptyTeam();state.enabled=true;
  for(let i=0;i<count;i++){
    const job=createJob({role:'creative',title:'架空の依頼 '+i,objective:'不足情報を確認',facts:[]},now);
    job.status='in_review';job.attempts=1;job.output=output();
    job.execution={id:randomUUID(),provider:'codex',started_at:now,finished_at:now};job.execution_ids=[job.execution.id];
    state.jobs.push(job);
  }
  return state;
}
// Fill real legacy job fields; no synthetic out-of-schema padding field.
function fillTo(state,target){
  let n=state.jobs.length;
  while(size(state)<target-7000){
    const job=createJob({role:'creative',title:'架空の過去依頼 '+n++,objective:'あ'.repeat(1800),facts:[]},now);
    job.status='completed';job.created_at=new Date(Date.UTC(2025,0,1+n)).toISOString();state.jobs.push(job);
  }
  const job=createJob({role:'creative',title:'架空の余白調整 '+n,objective:'x',facts:[]},now);job.status='completed';job.created_at=new Date(Date.UTC(2025,0,1+n)).toISOString();state.jobs.push(job);
  const room=target-size(state);assert.ok(room>=0&&room<=7000);
  job.objective+='x'.repeat(Math.min(room,1999));
  // Keep each field within its original limits while filling the final bytes.
  let left=target-size(state);
  while(left>0){
    const last=state.jobs.find(j=>j.objective.length<2000);
    if(!last)throw Error('fixture capacity');
    const amount=Math.min(left,2000-last.objective.length);last.objective+='x'.repeat(amount);left-=amount;
  }
  for(const job of state.jobs)job.input_hash=digest({business_unit:job.business_unit,role:job.role,title:job.title,objective:job.objective,facts:job.facts});
  assert.equal(size(state),target);return state;
}
async function withStore(fn){
  const dir=mkdtempSync(join(tmpdir(),'ss-capacity-'));const store=await createStore({DATA_DIR:dir});
  try{await fn(store);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
}

test('旧v1の履歴と成果物はv2で重複排除され、公開v1形式へ完全に戻せる',()=>{
  let state=pendingState();state=transitionTeam(state,{action:'reject',job_id:state.jobs[0].id,note:'架空の差し戻し'},now);
  const stored=encodeTeamState(state);
  assert.equal(stored.version,2);assert.equal(Object.keys(stored.outputs).length,1);
  assert.equal(stored.jobs[0].output_ref,stored.knowledge[0].output_ref);
  assert.equal(Object.hasOwn(stored.jobs[0],'output'),false);
  assert.deepEqual(decodeTeamState(stored),state);
  assert.deepEqual(decodeTeamState(state),state);
  const broken=structuredClone(stored);broken.outputs[stored.jobs[0].output_ref].summary='改変';
  assert.throws(()=>decodeTeamState(broken),/完全性/);
});

test('700KB直前で採用・差し戻しができ、同じ成果物を二重保存しない',async()=>{
  for(const action of ['approve','reject'])await withStore(async store=>{
    const state=pendingState();state.jobs[0].output=output('確認'.repeat(1900));fillTo(state,699500);
    await store.put(TEAM_DOCUMENT,state);
    const result=await writeTeam(store,{revision:0,command:{action,job_id:state.jobs[0].id,note}});
    assert.equal(result.state.jobs[0].status,action==='approve'?'completed':'rejected');
    assert.deepEqual(result.state.knowledge[0].output,state.jobs[0].output);
    const raw=JSON.parse((await store.doc(TEAM_DOCUMENT)).body);
    assert.equal(Object.keys(raw.outputs).length,1);
    assert.deepEqual((await readTeam(store)).state,result.state);
  });
});

test('受理した複数の成果物すべてに最大長レビューと停止の容量を予約する',async()=>withStore(async store=>{
  const state=pendingState(6);for(const job of state.jobs){job.status='queued';job.attempts=0;job.output=null;job.execution=null;job.execution_ids=[];}
  fillTo(state,650000);await store.put(TEAM_DOCUMENT,state);
  let model=await readTeam(store),accepted=[];
  for(const job of state.jobs.slice(0,6)){
    const packet={version:1,business_unit:'sickstyle',job_id:job.id,input_hash:job.input_hash,provider:'codex',
      execution_id:randomUUID(),started_at:new Date().toISOString(),finished_at:new Date().toISOString(),output:output()};
    model=await writeTeam(store,{revision:model.revision,command:{action:'import',job_id:job.id,packet}});accepted.push(job.id);
    const packed=encodeTeamState(model.state);
    assert.ok(size(packed)+reviewReserve(packed).bytes+1000<=750000);
  }
  for(const [i,id]of accepted.entries())model=await writeTeam(store,{revision:model.revision,
    command:{action:i%2?'reject':'approve',job_id:id,note}});
  model=await writeTeam(store,{revision:model.revision,command:{action:'toggle',enabled:false}});
  assert.equal(model.state.knowledge.length,accepted.length);assert.equal(model.state.enabled,false);
  assert.ok(size(encodeTeamState(model.state))<=750000);
}));

test('レビュー予約を圧迫する新規操作は保存前に拒否し、既存レビューは進められる',async()=>withStore(async store=>{
  const state=pendingState(6);
  const queued=createJob({role:'creative',title:'取込待ち',objective:'架空の確認',facts:[]},now);
  state.jobs.push(queued);fillTo(state,699000);await store.put(TEAM_DOCUMENT,state);
  const before=(await store.doc(TEAM_DOCUMENT)).body;
  await assert.rejects(()=>writeTeam(store,{revision:0,command:{action:'create',job:{role:'creative',title:'新規',objective:'確認',facts:[]}}}),/容量/);
  const packet={version:1,business_unit:'sickstyle',job_id:queued.id,input_hash:queued.input_hash,provider:'codex',
    execution_id:randomUUID(),started_at:new Date().toISOString(),finished_at:new Date().toISOString(),output:output()};
  await assert.rejects(()=>writeTeam(store,{revision:0,command:{action:'import',job_id:queued.id,packet}}),/容量/);
  assert.equal((await store.doc(TEAM_DOCUMENT)).body,before);
  const result=await writeTeam(store,{revision:0,command:{action:'approve',job_id:state.jobs[0].id,note}});
  assert.equal(result.state.jobs[0].status,'completed');
}));

test('旧形式の容量・監査上限でも履歴を削除せず全レビューと停止を保存できる',async()=>withStore(async store=>{
  const state=pendingState(8);state.audit=Array.from({length:999},(_,i)=>({id:String(i),hash:'a'.repeat(64)}));
  fillTo(state,749500);await store.put(TEAM_DOCUMENT,state);
  let model=await readTeam(store);
  const audit=structuredClone(state.audit);
  for(const [i,job]of state.jobs.slice(0,8).entries()){
    model=await writeTeam(store,{revision:model.revision,command:{action:i%2?'reject':'approve',job_id:job.id,note}});
    assert.deepEqual(model.state.audit.slice(0,999),audit);
  }
  model=await writeTeam(store,{revision:model.revision,command:{action:'toggle',enabled:false}});
  assert.equal(model.state.knowledge.length,8);assert.equal(model.state.audit.length,1008);
  assert.equal(model.state.enabled,false);
  const record=await store.doc(TEAM_DOCUMENT);assert.equal(JSON.parse(record.body).storage_format,'sickstyle-team-parts-v1');
  assert.deepEqual((await readTeam(store)).state,model.state);
  const parts=await store.query('SELECT name,body FROM ss_documents WHERE name<>$1',[TEAM_DOCUMENT]);
  assert.ok(parts.length>1);assert.ok(parts.every(p=>new TextEncoder().encode(p.body).length<750000));
}));

test('分割保存はUnicodeを保持し、部分欠落・改変は読み込みを停止する',async()=>withStore(async store=>{
  const state=fillTo(pendingState(),749500);state.jobs[0].objective='😀'.repeat(900);
  // Force the legacy review drain into parts without losing its existing fields.
  state.knowledge=Array.from({length:40},(_,i)=>({id:String(i),note:'😀'.repeat(1000)}));
  let storage=prepareTeamStorage(state,{action:'approve'});
  const splitSurrogate=value=>value.parts.some(p=>{const text=JSON.parse(p.body),last=text.charCodeAt(text.length-1);return last>=0xD800&&last<=0xDBFF;});
  if(!splitSurrogate(storage)){state.jobs[0].objective='x'+state.jobs[0].objective;storage=prepareTeamStorage(state,{action:'approve'});}
  assert.ok(splitSurrogate(storage),'UTF-16サロゲートが断片境界を跨ぐ実ケース');
  assert.ok(storage.parts.length>1);
  for(const part of storage.parts)await store.put(part.name,JSON.parse(part.body));
  await store.query('INSERT INTO ss_documents(name,body,revision) VALUES ($1,$2,0)',[TEAM_DOCUMENT,storage.body]);
  assert.deepEqual((await readTeam(store)).state,state);
  const missing={...store,query:async(sql,values)=>(await store.query(sql,values)).filter(row=>row.name!==storage.parts[0].name)};
  await assert.rejects(()=>readTeam(missing),/完全性/);
  await store.query('UPDATE ss_documents SET body=$1 WHERE name=$2',[JSON.stringify('corrupted'),storage.parts[0].name]);
  await assert.rejects(()=>readTeam(store),/完全性/);
}));

test('分割保存の競合は409となり、敗者の断片や履歴を保存しない',async()=>withStore(async store=>{
  const state=fillTo(pendingState(8),749500);await store.put(TEAM_DOCUMENT,state);
  const results=await Promise.allSettled([writeTeam(store,{revision:0,command:{action:'approve',job_id:state.jobs[0].id,note}}),
    writeTeam(store,{revision:0,command:{action:'reject',job_id:state.jobs[1].id,note}})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  const stored=JSON.parse((await store.doc(TEAM_DOCUMENT)).body);
  assert.equal(stored.storage_format,'sickstyle-team-parts-v1');
  const parts=await store.query('SELECT name FROM ss_documents WHERE name<>$1',[TEAM_DOCUMENT]);
  assert.equal(parts.length,new Set(stored.parts).size);
  assert.equal((await readTeam(store)).state.knowledge.length,1);
}));

test('再取込後も初回レビューの成果物を保持し、バックアップを再読込できる',async()=>withStore(async store=>{
  const state=pendingState();await store.put(TEAM_DOCUMENT,state);
  let model=await writeTeam(store,{revision:0,command:{action:'reject',job_id:state.jobs[0].id,note:'初回確認'}});
  const packet={version:1,business_unit:'sickstyle',job_id:state.jobs[0].id,input_hash:state.jobs[0].input_hash,
    provider:'codex',execution_id:randomUUID(),started_at:new Date().toISOString(),finished_at:new Date().toISOString(),output:output('二回目')};
  model=await writeTeam(store,{revision:model.revision,command:{action:'import',job_id:packet.job_id,packet}});
  model=await writeTeam(store,{revision:model.revision,command:{action:'approve',job_id:packet.job_id,note:'再確認'}});
  assert.deepEqual(model.state.knowledge.map(k=>k.output.summary),['架空の確認結果','二回目']);
  assert.equal(Object.keys(JSON.parse((await store.doc(TEAM_DOCUMENT)).body).outputs).length,2);
  const backup=JSON.parse(JSON.stringify(model.state));
  assert.deepEqual(decodeTeamState(encodeTeamState(backup)),model.state);
}));
