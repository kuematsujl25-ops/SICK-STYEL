import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,mkdirSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.js';
import {emptyTeam,transitionTeam,taskPacket,validateTaskPacket,validateOutput,
  readTeam,writeTeam,TeamError,digest,buildPrompt} from '../lib/ai-team.js';
import {checkSubscription,subscriptionEnv,codexArgs} from '../scripts/ai-staff/cli.js';

const now = '2026-10-18T01:00:00.000Z';
const facts = [{id:'f1',label:'架空の在庫',value:12,unit:'点',source:'fixture',observed_at:now,kind:'observed'},
  {id:'f2',label:'未取得の原価',value:null,unit:'JPY',source:'fixture',observed_at:now,kind:'observed'},
  {id:'h1',label:'仮説',value:'未検証',unit:'text',source:'fixture',observed_at:now,kind:'hypothesis'}];
const input = {role:'profit_inventory',title:'架空の在庫検証',objective:'不足情報を確認する',facts};
export const fixtureOutput = () => ({summary:'原価が未取得のため利益は判断できません。',fact_ids:['f1'],
  missing_data:['原価'],hypotheses:[{claim:'在庫と販売速度の不一致の可能性',test:'実際の期間別販売数を照合する'}],
  recommendations:[{title:'原価を確認する',steps:['元帳を本人が確認する'],kpi:'原価確認率',
    estimated_profit_jpy:null,cost_jpy:null,effort_hours:null,evidence_ids:['f1'],risks:['原価は未取得']}],
  approvals_required:['本人確認'],limitations:['架空のテストデータ。効果は未測定。']});
const enable = state => transitionTeam(state,{action:'toggle',enabled:true},now);
const create = state => transitionTeam(state,{action:'create',job:input},now);
const packetFor = (state,id='fixture-execution') => ({version:1,business_unit:'sickstyle',job_id:state.jobs[0].id,
  input_hash:state.jobs[0].input_hash,provider:'codex',execution_id:id,started_at:now,finished_at:now,output:fixtureOutput()});
const importResult = (state,packet=packetFor(state)) => transitionTeam(state,{action:'import',job_id:state.jobs[0].id,packet},now);

test('既定停止・開始・入力ハッシュ・依頼書改変拒否',()=>{
  assert.equal(emptyTeam().enabled,false);
  assert.throws(()=>create(emptyTeam()),TeamError);
  const state=create(enable(emptyTeam()));const packet=taskPacket(state.jobs[0]);
  assert.equal(validateTaskPacket(packet).job_id,state.jobs[0].id);
  assert.throws(()=>validateTaskPacket({...packet,objective:'改変'}),/ハッシュ/);
  assert.throws(()=>validateTaskPacket({...packet,business_unit:'makusas'}));
  assert.match(buildPrompt(packet),/untrusted_task_data/);
  assert.match(buildPrompt(packet),/未取得は0にせずnull/);
  assert.equal(state.jobs[0].status,'queued');assert.equal(state.jobs[0].output,null);
});

test('結果取込・人間レビュー・知識蓄積・監査チェーン',()=>{
  const queued=create(enable(emptyTeam()));const inReview=importResult(queued);
  assert.equal(inReview.jobs[0].status,'in_review');assert.equal(inReview.knowledge.length,0);
  assert.throws(()=>transitionTeam(inReview,{action:'approve',job_id:inReview.jobs[0].id,note:''},now));
  const done=transitionTeam(inReview,{action:'approve',job_id:inReview.jobs[0].id,note:'架空データの構造を確認'},now);
  assert.equal(done.jobs[0].status,'completed');assert.equal(done.knowledge[0].effect_status,'unmeasured');
  assert.equal(done.knowledge[0].execution.id,'fixture-execution');
  for(let i=0;i<done.audit.length;i++){
    const {hash,...entry}=done.audit[i];assert.equal(hash,digest(entry));
    assert.equal(entry.previous,i?done.audit[i-1].hash:null);
  }
  assert.equal(queued.jobs[0].output,null,'入力状態を変更しない');
});

test('別依頼・別ハッシュ・未来・期限切れ・実行ID再利用を拒否',()=>{
  const state=create(enable(emptyTeam()));const packet=packetFor(state);
  for(const change of [{job_id:'other'},{input_hash:'bad'},{business_unit:'makusas'},
    {provider:'paid-api'},{finished_at:'2027-01-01T00:00:00Z'},
    {started_at:'2026-01-01T00:00:00Z',finished_at:'2026-01-02T00:00:00Z'}])
    assert.throws(()=>importResult(state,{...packet,...change}));
  let reviewed=importResult(state);
  reviewed=transitionTeam(reviewed,{action:'reject',job_id:state.jobs[0].id,note:'確認情報を補う'},now);
  assert.throws(()=>importResult(reviewed,packet),/実行結果/);
  const second=importResult(reviewed,packetFor(state,'second'));
  const rejected=transitionTeam(second,{action:'reject',job_id:state.jobs[0].id,note:'追加検証が必要'},now);
  assert.throws(()=>importResult(rejected,packetFor(state,'third')),/上限/);
  assert.equal(rejected.knowledge.length,2);assert.equal(rejected.knowledge[0].execution.id,'fixture-execution');
});

test('未取得と仮説は根拠にできず、予測利益・余分な実行指示を拒否',()=>{
  for(const id of ['f2','h1','invented']) assert.throws(()=>validateOutput({...fixtureOutput(),fact_ids:[id]},facts),/未確認/);
  const output=fixtureOutput();output.recommendations[0].estimated_profit_jpy=100000;
  assert.throws(()=>validateOutput(output,facts));
  assert.throws(()=>validateOutput({...fixtureOutput(),post_to_instagram:true},facts));
  assert.throws(()=>validateOutput({...fixtureOutput(),limitations:[]},facts));
});

test('個人情報・秘密値・過剰な入力・不正な担当を拒否',()=>{
  for(const patch of [{objective:'test@example.com'},{title:'Bearer '+'a'.repeat(35)},
    {role:'makusas'},{facts:Array(31).fill(facts[0])},{facts:[facts[0],facts[0]]},
    {facts:[{...facts[0],value:Infinity}]}])
    assert.throws(()=>transitionTeam(enable(emptyTeam()),{action:'create',job:{...input,...patch}},now));
  assert.throws(()=>validateOutput({...fixtureOutput(),summary:'owner@example.com'},facts));
});

test('重複依頼・日本時間の日次上限・監査上限でも停止可能',()=>{
  const state=create(enable(emptyTeam()));assert.throws(()=>create(state),/未完了/);
  const many=enable(emptyTeam());many.jobs=Array.from({length:20},(_,i)=>({...state.jobs[0],id:String(i),created_at:'2026-10-17T15:01:00Z'}));
  assert.throws(()=>create(many),/上限/);
  const full=enable(emptyTeam());full.audit=Array.from({length:999},(_,i)=>({hash:String(i)}));
  assert.throws(()=>create(full),/監査上限/);
  const stopped=transitionTeam(full,{action:'toggle',enabled:false},now);
  assert.equal(stopped.enabled,false);assert.equal(stopped.audit.length,1000);
  assert.equal(transitionTeam(stopped,{action:'toggle',enabled:false},now).enabled,false);
  assert.throws(()=>create(stopped),/停止中/);
});

test('停止中は取込を拒否し、既存成果物の人間レビューとバックアップは保持',()=>{
  const state=importResult(create(enable(emptyTeam())));
  const stopped=transitionTeam(state,{action:'toggle',enabled:false},now);
  assert.throws(()=>importResult(stopped),/停止中/);
  assert.equal(transitionTeam(stopped,{action:'reject',job_id:state.jobs[0].id,note:'停止して確認'},now).jobs[0].status,'rejected');
});

test('SQLite CAS競合・永続化・他事業/既存業務ドキュメント分離',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ai-team-test-'));const store=await createStore({DATA_DIR:dir});
  try{
    await store.put('workspace',{fixture:'unchanged'});
    assert.equal((await readTeam(store)).state.enabled,false);
    assert.equal(await store.doc('ai-team-sickstyle-v1'),undefined,'GETは文書を作らない');
    const first=await writeTeam(store,{revision:0,command:{action:'toggle',enabled:true}});
    const responses=await Promise.allSettled([writeTeam(store,{revision:first.revision,command:{action:'create',job:input}}),
      writeTeam(store,{revision:first.revision,command:{action:'create',job:{...input,title:'別の依頼'}}})]);
    assert.equal(responses.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(responses.find(r=>r.status==='rejected').reason.status,409);
    assert.equal((await readTeam(store)).state.jobs.length,1);
    assert.deepEqual(JSON.parse((await store.doc('workspace')).body),{fixture:'unchanged'});
    await assert.rejects(()=>writeTeam(store,null));
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('CLIはAPI認証を除外し、subscriptionログイン・対応オプションがなければ停止',()=>{
  assert.deepEqual(subscriptionEnv({PATH:'x',OPENAI_API_KEY:'fake',ANTHROPIC_AUTH_TOKEN:'fake',CLAUDE_CODE_USE_VERTEX:'1',AWS_PROFILE:'fake'}),{PATH:'x'});
  const denied=()=>({status:0,stdout:'Logged in using an API key',stderr:''});
  assert.throws(()=>checkSubscription('codex',denied),/ChatGPT契約/);
  assert.throws(()=>checkSubscription('claude',denied),/更新/);
  const codex=codexArgs({output:'/tmp/output',schema:'/tmp/schema'});
  assert.ok(codex.includes('read-only'));assert.ok(codex.includes('forced_login_method="chatgpt"'));
  assert.ok(codex.includes('--ignore-user-config'));assert.ok(codex.includes('shell_tool'));
  assert.ok(!codex.some(a=>/bypass|full-access|worktree/.test(a)));
});

test('CLI接続部の代替プロセステスト: 明示実行・構造検証・秘密ファイル保存・課金ゲート',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ss-cli-stub-'));let artifact;
  try{
    const bin=join(dir,'bin');mkdirSync(bin);
    const fixture=taskPacket(create(enable(emptyTeam())).jobs[0]);
    const filename=join(dir,'task.json');writeFileSync(filename,JSON.stringify(fixture));
    const stub=`#!${process.execPath}\n`+
      `import {writeFileSync} from 'node:fs';const a=process.argv.slice(2);`+
      `if(a[0]==='login')console.log('Logged in using ChatGPT');`+
      `else if(a.includes('--help'))console.log('--ignore-user-config');`+
      `else{if(process.env.OPENAI_API_KEY)process.exit(99);`+
      `writeFileSync(a[a.indexOf('--output-last-message')+1],${JSON.stringify(JSON.stringify(fixtureOutput()))});}`;
    writeFileSync(join(bin,'codex'),stub,{mode:0o700});
    const env={...process.env,PATH:bin+':'+process.env.PATH,OPENAI_API_KEY:'fixture-api-key-not-used'};
    const run=args=>spawnSync(process.execPath,['scripts/ai-staff/run-task.js',filename,...args],{encoding:'utf8',env});
    assert.equal(run([]).status,0);
    assert.equal(run(['--run','--plan']).status,1,'曖昧な実行指定は拒否');
    const r=run(['--run']);assert.equal(r.status,0,r.stderr);
    artifact=r.stdout.trim().split('\n').at(-1);
    const packet=JSON.parse(readFileSync(artifact));
    assert.equal(packet.input_hash,fixture.input_hash);assert.equal(packet.provider,'codex');
    assert.equal(packet.output.recommendations[0].estimated_profit_jpy,null);
    assert.equal(statSync(artifact).mode&0o777,0o600);
    const claudeArgs='--tools --json-schema --strict-mcp-config --no-session-persistence';
    const claudeStub=(authMethod,subscriptionType)=> (_bin,args)=>({status:0,stderr:'',
      stdout:args[0]==='auth'?JSON.stringify({loggedIn:true,authMethod,subscriptionType}):claudeArgs});
    assert.throws(()=>checkSubscription('claude',claudeStub('api_key',null)),/本人ログイン/);
    assert.ok(checkSubscription('claude',claudeStub('claude.ai','max')));
    const deploy=spawnSync(process.execPath,['scripts/deploy-existing.js','--plan','--apply'],{encoding:'utf8'});
    assert.equal(deploy.status,1);assert.match(deploy.stderr,/引数/);
  }finally{if(artifact)rmSync(artifact,{force:true});rmSync(dir,{recursive:true,force:true});}
});
