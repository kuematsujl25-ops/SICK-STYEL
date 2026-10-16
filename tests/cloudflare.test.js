import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createHmac} from 'node:crypto';
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
 const snapshot=(await req(a,'data')).data;snapshot.tasks.push({id:'shared-task',title:'D1端末共有テスト',due:'2026-10-16',priority:'中',done:false});const saved=await req(a,'data','PUT',snapshot);assert.equal(saved.status,200);assert.equal((await req(b,'data')).data.tasks[0].title,'D1端末共有テスト');assert.equal((await req(b,'data','PUT',snapshot)).status,409);assert.equal((await req(a,'data','PUT',{...snapshot,revision:saved.data.revision},{Origin:'https://bad.example'})).status,403);
 const backup=(await req(a,'backup')).data;const before=(await req(a,'data')).data;before.tasks[0].done=true;const edit=await req(a,'data','PUT',before);assert.equal((await req(a,'restore','POST',{...backup,revision:edit.data.revision})).status,200);assert.equal((await req(b,'data')).data.tasks[0].done,false);
 const ig=(await req(a,'instagram/status')).data;assert.equal(ig.connected,false);assert.equal(ig.cache,null);assert.equal(ig.dmPending,null);
 assert.equal((await mf.dispatchFetch('http://localhost/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=qa-verify-only&hub.challenge=challenge')).status,200);
 assert.equal((await req(a,'instagram/webhook','POST',{})).status,403);const raw=JSON.stringify({object:'instagram',entry:[]});const signature='sha256='+createHmac('sha256','qa-app-secret').update(raw).digest('hex');assert.equal((await mf.dispatchFetch('http://localhost/api/instagram/webhook',{method:'POST',headers:{'X-Hub-Signature-256':signature},body:raw})).status,200);
 assert.equal((await req(a,'logout','POST',{})).status,200);for(const route of ['data','backup','instagram/status'])assert.equal((await req(a,route)).status,401);assert.equal((await req(b,'data')).status,200);
 const response=await mf.dispatchFetch('http://localhost/');assert.equal(response.status,200);assert.match(await response.text(),/SICKSTYLE/);assert.equal((await mf.dispatchFetch('http://localhost/manifest.webmanifest')).status,200);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ss_users').first()).n,1);
 // Separate worker, same source, configured stop switch: never falls back to unprotected data.
 const stopped=new Miniflare(convertV4MiniflareOptions({workers:[{name:"sickstyle-manager",modules:true,scriptPath:'.wrangler/build/index.js',compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],bindings:{MAINTENANCE_MODE:'true'}}]}));try{assert.equal((await stopped.dispatchFetch('http://localhost/api/data')).status,503);}finally{await stopped.dispose();}
});
