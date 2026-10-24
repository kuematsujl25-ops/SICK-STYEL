import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {signIn,api,eligibleJob,oneCycle} from '../scripts/ai-staff/auto-runner.js';

const endpoint='https://sickstyle-manager.sickstyle-74h4.workers.dev';
const cookie='session='+'a'.repeat(64);
const headers={'get':key=>key==='set-cookie'?cookie+'; Secure; HttpOnly; Path=/':null};
const result=(value,status=200)=>({ok:status>=200&&status<300,status,headers,text:async()=>JSON.stringify(value)});

test('Mac runner signs in to pinned production origin without storing credentials',async()=>{
 let seen;
 const c=await signIn({email:'admin@example.com',password:'secret-local-only',request:async(url,options)=>{
  seen={url,options};return {ok:true,headers,status:200};
 }});
 assert.equal(c,cookie);
 assert.equal(seen.url,endpoint+'/api/login');
 assert.equal(seen.options.headers.Origin,endpoint);
 assert.equal(JSON.parse(seen.options.body).email,'admin@example.com');
 await assert.rejects(()=>signIn({origin:'https://untrusted.example',email:'x',password:'s'}),/本番以外/);
});

test('runner sees queued tasks only if manual operation enabled',()=>{
 const job={id:'id-1',status:'queued',attempts:0};
 assert.equal(eligibleJob({state:{enabled:false,jobs:[job]}}),null);
 assert.equal(eligibleJob({state:{enabled:true,jobs:[job]}},new Set(['id-1'])),null);
 assert.equal(eligibleJob({state:{enabled:true,jobs:[job]}},new Set()).id,'id-1');
});

test('installed runner command and browser text make online requirement explicit',()=>{
 const p=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(p.scripts['ai:runner'],'node scripts/ai-staff/auto-runner.js');
 const ui=readFileSync(new URL('../public/ai-team.js',import.meta.url),'utf8');
 assert.match(ui,/npm run ai:runner/);
 assert.match(ui,/ランナー停止中/);
});

import {emptyTeam,transitionTeam,createJob,taskPacket} from '../lib/ai-team.js';
function fixture(){
 const state=emptyTeam();state.enabled=true;state.jobs=[createJob({role:'market',title:'検証用',objective:'不足を整理',facts:[]},new Date().toISOString())];
 const f={model:{state,revision:0},offline:false};
 f.request=async(url,opt)=>{
  if(f.offline)throw Error('network down');
  if(new URL(url).pathname.endsWith('/task'))return result(taskPacket(f.model.state.jobs[0]));
  if(opt.method==='POST'){
   const body=JSON.parse(opt.body);if(body.revision!==f.model.revision)return result({},409);
   try{f.model={state:transitionTeam(f.model.state,body.command),revision:f.model.revision+1};}catch{return result({},409);}
  }
  return result(f.model);
 };return f;
}
function artifact(p){const at=new Date().toISOString();return {version:1,job_id:p.job_id,input_hash:p.input_hash,business_unit:'sickstyle',provider:'claude',execution_id:'fixture-run',started_at:at,finished_at:at,output:{summary:'不足を確認',fact_ids:[],missing_data:[],hypotheses:[],recommendations:[],approvals_required:[],limitations:['模擬試験']}};}
test('claimed runner persists heartbeat and imports once into review',async()=>{
 const f=fixture(),seen=new Set();let calls=0;
 const out=await oneCycle(cookie,seen,{request:f.request,run:async p=>{calls++;assert.equal(f.model.state.jobs[0].status,'running');return {result:artifact(p),outputFile:'/tmp/fixture.json'};}});
 assert.equal(out.imported,true);assert.equal(f.model.state.jobs[0].status,'in_review');assert.equal(f.model.state.jobs[0].run_attempts,1);
 assert.equal((await oneCycle(cookie,seen,{request:f.request})).processed,false);assert.equal(calls,1);
});
test('failed runner requires explicit retry and persists cap across process restarts',async()=>{
 const f=fixture(),run=async()=>{throw Error('sensitive provider details must not persist');};
 await oneCycle(cookie,new Set(),{request:f.request,run});assert.equal(f.model.state.jobs[0].status,'failed');assert.equal(f.model.state.jobs[0].run.failure_reason,'model_failed');
 assert.equal((await oneCycle(cookie,new Set(),{request:f.request,run})).processed,false);
 f.model.state=transitionTeam(f.model.state,{action:'retry',job_id:f.model.state.jobs[0].id});
 await oneCycle(cookie,new Set(),{request:f.request,run});assert.equal(f.model.state.jobs[0].run_attempts,2);
 assert.throws(()=>transitionTeam(f.model.state,{action:'retry',job_id:f.model.state.jobs[0].id}));
});
test('stop during model run aborts child through heartbeat and cannot import',async()=>{
 const f=fixture();
 const out=await oneCycle(cookie,new Set(),{request:f.request,heartbeatMs:5,run:async(p,{signal})=>{
  f.model.state=transitionTeam(f.model.state,{action:'toggle',enabled:false});f.model.revision++;
  await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));throw Error('cancelled');
 }});
 assert.equal(out.imported,false);assert.equal(f.model.state.jobs[0].status,'stopped');assert.equal(f.model.state.jobs[0].run.failure_reason,'stopped');
});
test('network loss leaves an expiring lease and never automatically repeats inference',async()=>{
 const f=fixture();
 await oneCycle(cookie,new Set(),{request:f.request,heartbeatMs:5,run:async(p,{signal})=>{
  f.offline=true;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));throw Error('network');
 }});
 assert.equal(f.model.state.jobs[0].status,'running');f.offline=false;
 assert.equal((await oneCycle(cookie,new Set(),{request:f.request,run:()=>assert.fail()})).processed,false);
});
test('concurrent runners only one can claim the same request',async()=>{
 const f=fixture();let calls=0;const run=async p=>{calls++;return {result:artifact(p),outputFile:'/tmp/fixture.json'};};
 await Promise.allSettled([oneCycle(cookie,new Set(),{request:f.request,run}),oneCycle(cookie,new Set(),{request:f.request,run})]);assert.equal(calls,1);
});
test('two live claims maximum; expired claim needs explicit retry and cannot heartbeat/import',()=>{
 const f=fixture();const now='2026-10-24T09:00:00Z';let s=f.model.state;
 s.jobs.push({...s.jobs[0],id:'22222222-2222-4222-8222-222222222222'},{...s.jobs[0],id:'33333333-3333-4333-8333-333333333333'});
 const claim='44444444-4444-4444-8444-444444444444';
 for(const j of s.jobs.slice(0,2))s=transitionTeam(s,{action:'claim',job_id:j.id,claim_id:claim},now);
 assert.throws(()=>transitionTeam(s,{action:'claim',job_id:s.jobs[2].id,claim_id:claim},now));
 const late='2026-10-24T09:11:00Z';assert.throws(()=>transitionTeam(s,{action:'heartbeat',job_id:s.jobs[0].id,claim_id:claim},late));
 assert.throws(()=>transitionTeam(s,{action:'import',job_id:s.jobs[0].id,claim_id:claim,packet:{}},late));
 s=transitionTeam(s,{action:'retry',job_id:s.jobs[0].id},late);assert.equal(s.jobs[0].status,'queued');
});
test('production runner allowlist rejects free text and other source kinds',async()=>{
 const {validateStaffAggregate}=await import('../scripts/ai-staff/auto-runner.js');
 const f=fixture();assert.equal(eligibleJob(f.model,new Set(),true),null);
 assert.throws(()=>validateStaffAggregate(taskPacket(f.model.state.jobs[0])));
});
test('analysis child shutdown installs and removes process cleanup handlers',async()=>{
 const {spawnAnalysis}=await import('../scripts/ai-staff/auto-runner.js');
 const before=process.listenerCount('SIGINT'),controller=new AbortController();
 const pending=spawnAnalysis(process.execPath,['-e','setInterval(()=>{},1000)'],{},controller.signal);
 assert.equal(process.listenerCount('SIGINT'),before+1);controller.abort();
 assert.notEqual((await pending).status,0);assert.equal(process.listenerCount('SIGINT'),before);
});
test('heartbeat revision conflict rechecks claim and retries without duplicate model invocation',async()=>{
 const f=fixture();let raced=false,calls=0;
 const request=async(url,opt)=>{if(opt.method==='POST'&&JSON.parse(opt.body).command.action==='heartbeat'&&!raced){raced=true;f.model.revision++;return result({},409);}return f.request(url,opt);};
 const outcome=await oneCycle(cookie,new Set(),{request,run:async p=>{calls++;return {result:artifact(p),outputFile:'/tmp/mock.json'};}});
 assert.equal(outcome.imported,true);assert.equal(calls,1);assert.equal(f.model.state.jobs[0].run_attempts,1);
});
