import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createIntegrations } from '../integrations/index.js';

test('管理者登録・認証・業務データ保存・復元・永続化', async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sickstyle-test-'));let proc;let base;let cookie='';
 async function start(){proc=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir,SETUP_TOKEN:'test-setup-key'},stdio:['ignore','pipe','pipe']});let output='';base=await new Promise((resolve,reject)=>{proc.stdout.on('data',b=>{output+=b;const m=output.match(/http:\/\/127.0.0.1:(\d+)/);if(m)resolve(m[0]);});proc.on('error',reject);proc.on('exit',code=>reject(Error('exit '+code)));});}
 async function stop(){const p=proc;await new Promise(resolve=>{p.once('exit',resolve);p.kill();});}
 t.after(async()=>{if(proc?.exitCode===null)await stop();await rm(dir,{recursive:true,force:true});});
 async function req(route,method='GET',data,headers={}){const r=await fetch(base+'/api/'+route,{method,headers:{Cookie:cookie,...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};}
 await start();assert.equal((await req('session')).data.configured,false);assert.equal((await req('data')).status,401);
 assert.equal((await req('setup','POST',{email:'a@example.com',password:'short'})).status,400);
 assert.equal((await req('setup','POST',{email:'bad@example.com',password:'bad-password-12345'})).status,403);
 const creds={email:'owner@example.com',password:'Test-password-2026',setupToken:'test-setup-key'};const signup=await req('setup','POST',creds);assert.equal(signup.status,200);assert.match(signup.cookie,/HttpOnly/);cookie=signup.cookie.split(';')[0];
 assert.equal((await req('setup','POST',creds)).status,409);
 const primaryCookie=cookie;const secondLogin=await req('login','POST',creds);const secondCookie=secondLogin.cookie.split(';')[0];cookie=primaryCookie;
 const d=(await req('data')).data;
 d.goals.push({id:'g1',title:'売上目標',type:'monthly',month:'2026-10',current:10000,target:50000,unit:'円'});
 d.tasks.push({id:'t1',title:'新作を撮影',due:'2026-10-16',priority:'高',done:false,notes:'自然光'});
 d.shipments.push({id:'s1',title:'Tシャツ',order:'001',recipient:'テスト',due:'2026-10-17',carrier:'ヤマト',tracking:'123456',status:'未発送'});
 d.metrics.push({id:'m1',date:'2026-10-16',sales:10000,orders:2,followers:100,reach:500,engagement:20});d.brand.Mission='スタイルを届ける';
 assert.equal((await req('data','PUT',d)).status,200);d.revision=1;assert.deepEqual((await req('data')).data,d);cookie=secondCookie;assert.equal((await req('data')).data.tasks[0].title,'新作を撮影');cookie=primaryCookie;
 assert.equal((await req('data','PUT',d,{Origin:'https://evil.example'})).status,403);
 const invalid=structuredClone(d);invalid.metrics[0].sales=-1;assert.equal((await req('data','PUT',invalid)).status,400);
 const malformed=structuredClone(d);malformed.tasks[0].due='2026-02-31';assert.equal((await req('data','PUT',malformed)).status,400);
 const duplicate=structuredClone(d);duplicate.metrics.push({...duplicate.metrics[0],id:'m2'});assert.equal((await req('data','PUT',duplicate)).status,400);
 const backup=(await req('backup')).data;assert.equal(backup.version,1);assert.equal(backup.data.brand.Mission,'スタイルを届ける');assert.equal(JSON.stringify(backup).includes('Test-password'),false);
 const stale=structuredClone(d);stale.revision=0;assert.equal((await req('data','PUT',stale)).status,409);
 d.tasks[0].done=true;assert.equal((await req('data','PUT',d)).status,200);assert.equal((await req('restore','POST',{version:0,data:d,revision:2})).status,400);assert.equal((await req('restore','POST',{...backup,revision:2})).status,200);assert.equal((await req('data')).data.tasks[0].done,false);
 await stop();await start();assert.equal((await req('data')).data.shipments[0].tracking,'123456');
 assert.equal((await req('logout','POST',{})).status,200);assert.equal((await req('data')).status,401);assert.equal((await req('backup')).status,401);assert.equal((await req('instagram/status')).status,401);cookie=secondCookie;assert.equal((await req('data')).status,200);cookie='';
 assert.equal((await req('login','POST',{...creds,password:'wrong-password-123'})).status,401);const login=await req('login','POST',creds);assert.equal(login.status,200);cookie=login.cookie.split(';')[0];assert.equal((await req('session')).data.authenticated,true);
 const html=await fetch(base);assert.equal(html.status,200);assert.match(await html.text(),/lang="ja"/);assert.match(html.headers.get('content-security-policy'),/default-src 'self'/);
 assert.equal((await fetch(base+'/server.js')).status,404);assert.equal((await fetch(base+'/manifest.webmanifest')).status,200);assert.equal((await fetch(base+'/icon-192.png')).status,200);assert.equal((await req('instagram/cron')).status,401);assert.equal((await req('instagram/webhook','POST',{})).status,403);
});
test('未設定の公式APIは外部通信を行わない',async()=>{const c=createIntegrations();assert.equal(c.amazon.mode,'manual');await assert.rejects(c.amazon.fetchMetrics(),/手入力/);assert.throws(()=>createIntegrations({amazon:{}}),/adapter/);});
