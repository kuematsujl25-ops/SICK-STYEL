import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createHmac,randomUUID} from 'node:crypto';
import {loadLocalEnv} from '../lib/local-env.js';

test('SETUP_TOKENの安全なローカル読込・シェル優先・本番では読込しない',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'ss-env-'));try{writeFileSync(path.join(dir,'.env.bootstrap'),JSON.stringify({SETUP_TOKEN:'bootstrap-test-secret'}));writeFileSync(path.join(dir,'.env.local'),'OTHER=ok\nTOKEN_ENCRYPTION_KEY="[SENSITIVE]"\n');const env={};assert.equal(loadLocalEnv(dir,env).setupReady,true);assert.equal(env.SETUP_TOKEN,'bootstrap-test-secret');assert.equal(env.TOKEN_ENCRYPTION_KEY,undefined);const shell={SETUP_TOKEN:'shell-secret'};loadLocalEnv(dir,shell);assert.equal(shell.SETUP_TOKEN,'shell-secret');const production={NODE_ENV:'production'};loadLocalEnv(dir,production);assert.equal(production.SETUP_TOKEN,undefined);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Workers実行環境 + D1: 認証・保存・独立セッション共有・競合・Webhook・停止',async t=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"sickstyle-manager",modules:true,scriptPath:'.wrangler/build/index.js',compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'sickstyle-test'},assets:{directory:'public',binding:'ASSETS',routerConfig:{has_user_worker:true},run_worker_first:['/api/*']},bindings:{SETUP_TOKEN:'qa-setup-only',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),META_WEBHOOK_VERIFY_TOKEN:'qa-verify-only',META_WEBHOOK_APP_SECRET:'qa-app-secret',CF_LOCAL_DEV:'true',COOKIE_SECURE:'false',MAINTENANCE_MODE:'false'}}]}));
 t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');await db.exec(readFileSync('migrations/0001_initial.sql','utf8').replaceAll('\n',' '));
 const a={cookie:''},b={cookie:''};
 async function req(c,route,method='GET',data,headers={}){const r=await mf.dispatchFetch('http://localhost/api/'+route,{method,headers:{Cookie:c.cookie,Origin:'http://localhost',...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});const set=r.headers.get('set-cookie');if(set)c.cookie=set.split(';')[0];const text=await r.text();try{return {status:r.status,data:JSON.parse(text)};}catch{throw Error('Worker応答: '+text.slice(0,1600));}}
 assert.equal((await req(a,'data')).status,401);assert.equal((await req(a,'session')).data.storage,'d1');
 const credentials={email:'qa@example.com',password:'qa-safe-password-2026',setupToken:'qa-setup-only'};
 assert.equal((await req(a,'setup','POST',{...credentials,setupToken:'wrong'})).status,403);assert.equal((await req(a,'setup','POST',credentials)).status,200);assert.equal((await req(b,'setup','POST',credentials)).status,409);assert.equal((await req(b,'login','POST',credentials)).status,200);
 // Exercise notification encryption and persistence in Workers, not only Node.
 const subscription={endpoint:'https://web.push.apple.com/test-device',keys:{p256dh:'B'+'A'.repeat(86),auth:'A'.repeat(22)}};
 const registered=await req(a,'notifications/subscribe','POST',{subscription});
 assert.equal(registered.status,200,JSON.stringify(registered.data));
 assert.equal((await req(b,'notifications/status')).data.devices,1);
 const deviceRow=await db.prepare("SELECT body FROM ss_documents WHERE name LIKE 'notify-device-v1:%'").first();
 assert.equal(deviceRow.body.includes(subscription.endpoint),false);
 const diagnostics=await req(a,'zoom/storage-diagnostics','POST',{});
 assert.equal(diagnostics.status,200);
 assert.equal(diagnostics.data.ok,true,JSON.stringify(diagnostics.data));
 assert.equal((await req(a,'notifications/unsubscribe','POST',{endpoint:subscription.endpoint})).status,200);
 const snapshot=(await req(a,'data')).data;snapshot.tasks.push({id:'shared-task',title:'D1端末共有テスト',due:'2026-10-16',priority:'中',done:false});const saved=await req(a,'data','PUT',snapshot);assert.equal(saved.status,200);assert.equal((await req(b,'data')).data.tasks[0].title,'D1端末共有テスト');assert.equal((await req(b,'data','PUT',snapshot)).status,409);assert.equal((await req(a,'data','PUT',{...snapshot,revision:saved.data.revision},{Origin:'https://bad.example'})).status,403);
 const backup=(await req(a,'backup')).data;const before=(await req(a,'data')).data;before.tasks[0].done=true;const edit=await req(a,'data','PUT',before);assert.equal((await req(a,'restore','POST',{...backup,revision:edit.data.revision})).status,200);assert.equal((await req(b,'data')).data.tasks[0].done,false);
 const ig=(await req(a,'instagram/status')).data;assert.equal(ig.connected,false);assert.equal(ig.cache,null);assert.equal(ig.dmPending,null);const amzStatus=(await req(a,'amazon/status')).data;assert.equal(amzStatus.connected,false);assert.equal(amzStatus.configured,false);assert.equal((await req(a,'session')).data.setupAllowed,false);
 assert.equal((await mf.dispatchFetch('http://localhost/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=qa-verify-only&hub.challenge=challenge')).status,200);
 assert.equal((await req(a,'instagram/webhook','POST',{})).status,403);const raw=JSON.stringify({object:'instagram',entry:[]});const signature='sha256='+createHmac('sha256','qa-app-secret').update(raw).digest('hex');assert.equal((await mf.dispatchFetch('http://localhost/api/instagram/webhook',{method:'POST',headers:{'X-Hub-Signature-256':signature},body:raw})).status,200);

 // AI staff use the same authenticated D1 store without changing existing workspace data.
 assert.equal((await req({cookie:''},'ai-team')).status,401);
 let team=(await req(a,'ai-team')).data;assert.equal(team.state.enabled,false);
 assert.equal((await req(a,'ai-team/task?job_id=missing')).status,409);
 const change=async command=>{const r=await req(a,'ai-team','POST',{revision:team.revision,command});assert.equal(r.status,200);team=r.data;};
 await change({action:'toggle',enabled:true});
 const oldRevision=team.revision;
 await change({action:'create',job:{role:'creative',title:'架空のデザイン確認',objective:'不足している素材を確認',facts:[]}});
 assert.equal((await req(b,'ai-team','POST',{revision:oldRevision,command:{action:'toggle',enabled:false}})).status,409);
 assert.equal((await req(a,'ai-team','POST',{revision:team.revision,command:{action:'toggle',enabled:false}},{Origin:'https://bad.example'})).status,403);
 const task=(await req(a,'ai-team/task?job_id='+team.state.jobs[0].id)).data;
 const output={summary:'未取得のブランド素材を確認する必要があります',fact_ids:[],missing_data:['ブランド素材'],hypotheses:[],recommendations:[],approvals_required:['本人確認'],limitations:['架空の検証。デザイン生成・投稿は未実行。']};
 const packet={version:1,business_unit:'sickstyle',job_id:task.job_id,input_hash:task.input_hash,provider:'codex',execution_id:'worker-fixture',started_at:new Date().toISOString(),finished_at:new Date().toISOString(),output};
 await change({action:'import',job_id:task.job_id,packet});assert.equal(team.state.jobs[0].status,'in_review');
 await change({action:'approve',job_id:task.job_id,note:'架空のテスト成果物を確認'});
 assert.equal((await req(b,'ai-team')).data.state.jobs[0].status,'completed');
 assert.equal((await req(a,'ai-team/export')).data.state.knowledge[0].effect_status,'unmeasured');
 assert.equal((await req(a,'ai-team/task?job_id='+task.job_id)).status,409);
 assert.equal((await req(b,'data')).data.tasks[0].done,false);
 // Exercise the existing D1 table's bounded part writes and transparent API reads.
 const large=structuredClone(team.state);
 for(let i=0;i<50;i++){
  const j=structuredClone(large.jobs[0]);j.id=randomUUID();j.title='架空の容量確認 '+i;
  j.output={...j.output,summary:'確認'.repeat(1500)+i};j.decision={...j.decision,note:'検'.repeat(1000)};
  large.jobs.push(j);large.knowledge.push({...structuredClone(large.knowledge[0]),id:randomUUID(),job_id:j.id,output:j.output,decision:j.decision});
 }
 await db.prepare('UPDATE ss_documents SET body=?,revision=revision+1 WHERE name=?').bind(JSON.stringify(large),'ai-team-sickstyle-v1').run();
 team=(await req(a,'ai-team')).data;
 await change({action:'toggle',enabled:false});
 const stored=JSON.parse((await db.prepare('SELECT body FROM ss_documents WHERE name=?').bind('ai-team-sickstyle-v1').first()).body);
 assert.equal(stored.storage_format,'sickstyle-team-parts-v1');
 assert.ok(stored.parts.length>1);
 const exported=(await req(a,'ai-team/export')).data;assert.equal(exported.state.knowledge.length,51);
 assert.deepEqual(exported.state.knowledge.at(-1).output,large.knowledge.at(-1).output);
 assert.equal((await req(b,'ai-team')).data.state.enabled,false);
 assert.equal((await req(a,'logout','POST',{})).status,200);for(const route of ['data','backup','instagram/status','amazon/status','ai-team','ai-team/export','ai-team/task?job_id=missing'])assert.equal((await req(a,route)).status,401);assert.equal((await req(b,'data')).status,200);
 const response=await mf.dispatchFetch('http://localhost/');assert.equal(response.status,200);assert.match(await response.text(),/SICKSTYLE/);assert.equal((await mf.dispatchFetch('http://localhost/manifest.webmanifest')).status,200);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ss_users').first()).n,1);
 // Separate worker, same source, configured stop switch: never falls back to unprotected data.
 const stopped=new Miniflare(convertV4MiniflareOptions({workers:[{name:"sickstyle-manager",modules:true,scriptPath:'.wrangler/build/index.js',compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],bindings:{MAINTENANCE_MODE:'true'}}]}));try{assert.equal((await stopped.dispatchFetch('http://localhost/api/data')).status,503);}finally{await stopped.dispose();}
});
