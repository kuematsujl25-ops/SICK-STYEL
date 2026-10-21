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

test('runner fetches task, runs injected Claude implementation once and saves for human review',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const job={id,status:'queued',attempts:0,input_hash:'hash'};
 const record={revision:4,state:{enabled:true,jobs:[job]}};
 // oneCycle validates canonical task, so use a valid envelope derived from createJob.
 const {createJob,taskPacket}=await import('../lib/ai-team.js');
 const created=createJob({role:'market',title:'検証用の調査',objective:'入力データの不足項目を整理',facts:[]},new Date().toISOString());
 const pending={...created,status:'queued'};
 const state={revision:4,state:{enabled:true,jobs:[pending]}};
 const task=taskPacket(pending);
 const artifact={version:1,job_id:task.job_id,input_hash:task.input_hash,business_unit:'sickstyle',
  provider:'claude',execution_id:'01234567-89ab-4def-8abc-0123456789ab',
  started_at:new Date().toISOString(),finished_at:new Date().toISOString(),
  output:{summary:'未取得情報を特定',fact_ids:[],missing_data:['試行数'],hypotheses:[],
   recommendations:[],approvals_required:[],limitations:['調査用の入力に統計値なし']}};
 let n=0,imported=null,runCount=0;
 const request=async(url,opt)=>{
  const path=new URL(url).pathname;
  assert.equal(opt.headers.Cookie,cookie);
  if(path==='/api/ai-team'&&opt.method==='POST'){imported=JSON.parse(opt.body);return result({state:{},revision:5});}
  if(path==='/api/ai-team'){n++;return result(state);}
  if(path==='/api/ai-team/task')return result(task);
  throw Error('Unexpected route '+path);
 };
 const seen=new Set();
 const processed=await oneCycle(cookie,seen,{request,run:async(p)=>{
  runCount++;assert.equal(p.job_id,task.job_id);
  return {result:artifact,outputFile:'/tmp/fixture.json'};
 }});
 assert.equal(processed.imported,true);
 assert.equal(runCount,1);
 assert.equal(n,2);
 assert.equal(imported.revision,4);
 assert.equal(imported.command.action,'import');
 assert.equal(imported.command.job_id,task.job_id);
 const twice=await oneCycle(cookie,seen,{request,run:async()=>{throw Error('unexpected duplicate execution');}});
 assert.equal(twice.processed,false);
});

test('do not import if job was already changed during inference',async()=>{
 const {createJob,taskPacket}=await import('../lib/ai-team.js');
 const j=createJob({role:'market',title:'検証用',objective:'状況を整理',facts:[]},new Date().toISOString());
 const task=taskPacket(j);
 let n=0,imports=0;
 const request=async(url,opt)=>{
  const path=new URL(url).pathname;
  if(path==='/api/ai-team'&&opt.method==='POST'){imports++;return result({});}
  if(path==='/api/ai-team'){n++;return result({revision:n, state:{enabled:true,jobs:[n===1?j:{...j,status:'completed'}]}});}
  if(path==='/api/ai-team/task')return result(task);
  throw Error('unknown path');
 };
 const outcome=await oneCycle(cookie,new Set(),{request,run:async()=>({result:{},outputFile:'/tmp/local.json'})});
 assert.equal(outcome.imported,false);
 assert.equal(imports,0);
});

test('installed runner command and browser text make online requirement explicit',()=>{
 const p=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(p.scripts['ai:runner'],'node scripts/ai-staff/auto-runner.js');
 const ui=readFileSync(new URL('../public/ai-team.js',import.meta.url),'utf8');
 assert.match(ui,/npm run ai:runner/);
 assert.match(ui,/ランナー停止中/);
});
