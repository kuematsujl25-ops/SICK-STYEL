import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('Zoom/Googleカレンダー連携APIの認証ゲートと未設定時の応答、MTG同期APIの入力検証',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sickstyle-meeting-api-'));let proc;let base;let cookie='';
 async function start(){proc=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir,SETUP_TOKEN:'test-setup-key'},stdio:['ignore','pipe','pipe']});let output='';base=await new Promise((resolve,reject)=>{proc.stdout.on('data',b=>{output+=b;const m=output.match(/http:\/\/127.0.0.1:(\d+)/);if(m)resolve(m[0]);});proc.on('error',reject);proc.on('exit',code=>reject(Error('exit '+code)));});}
 async function stop(){const p=proc;await new Promise(resolve=>{p.once('exit',resolve);p.kill();});}
 t.after(async()=>{if(proc?.exitCode===null)await stop();await rm(dir,{recursive:true,force:true});});
 async function req(route,method='GET',data){const r=await fetch(base+'/api/'+route,{method,headers:{Cookie:cookie,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};}
 await start();
 // 未ログインではZoom/Googleカレンダー連携・MTG同期のいずれも使えない。
 assert.equal((await req('zoom/status')).status,401);
 assert.equal((await req('zoom/connect','POST',{})).status,401);
 assert.equal((await req('googlecalendar/status')).status,401);
 assert.equal((await req('orgsales/meeting','POST',{orgId:'x',kind:'initial',action:'create',revision:0})).status,401);
 const signup=await req('setup','POST',{email:'owner@example.com',password:'Test-password-2026',setupToken:'test-setup-key'});cookie=signup.cookie.split(';')[0];
 // ログイン後：アプリ未設定（Secrets未登録）のため、configured:falseで接続は始まらない。
 const zs=await req('zoom/status');assert.equal(zs.status,200);assert.equal(zs.data.configured,false);assert.equal(zs.data.connected,false);
 const gs=await req('googlecalendar/status');assert.equal(gs.status,200);assert.equal(gs.data.configured,false);
 assert.equal((await req('zoom/connect','POST',{})).status,400);
 assert.equal((await req('googlecalendar/connect','POST',{})).status,400);
 // MTG同期：種別・操作・団体の存在、更新バージョンを検証する。
 assert.equal((await req('orgsales/meeting','POST',{orgId:'nope',kind:'initial',action:'create',revision:0})).status,400);
 assert.equal((await req('orgsales/meeting','POST',{orgId:'x',kind:'bogus',action:'create',revision:0})).status,400);
 assert.equal((await req('orgsales/meeting','POST',{orgId:'x',kind:'initial',action:'nope',revision:0})).status,400);
 assert.equal((await req('orgsales/meeting-status')).status,200);
});
