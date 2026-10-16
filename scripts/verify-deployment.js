// 公開URLの動作確認（本人のターミナルで実行）。認証情報は表示・保存しません。
//   npm run verify:deployment -- https://sickstyle-manager.xxxx.workers.dev
// 一時的な目標・タスク・発送を登録→更新→別セッション/再ログインで確認→削除します。既存データは変更しません。
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {ask,secret,requireTerminal} from './lib/prompt.js';
const base=process.argv[2]||process.env.BASE_URL||(existsSync('.deployment.json')?JSON.parse(readFileSync('.deployment.json','utf8')).url:'');
const origin=new URL(base);if(origin.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('HTTPSの公開URLを指定してください');
let email=process.env.VERIFY_EMAIL,password=process.env.VERIFY_PASSWORD;
if(!email||!password){requireTerminal();email=(await ask('管理者メールアドレス: ')).toLowerCase();password=await secret('パスワード（非表示）: ');}
const client=()=>({cookie:''});const a=client(),b=client(),c=client(),anon=client();
async function req(cl,route,method='GET',data){const r=await fetch(new URL('/api/'+route,origin),{method,headers:{Cookie:cl.cookie,Origin:origin.origin,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,redirect:'manual'});const set=r.headers.get('set-cookie');if(set)cl.cookie=set.split(';')[0];let body=null;try{body=await r.json();}catch{}return {status:r.status,data:body,headers:r.headers};}
const ok=m=>console.log('  ✓ '+m);
const id=x=>`verify-${x}-${crypto.randomUUID()}`;const ids={goal:id('goal'),task:id('task'),ship:id('ship')};let wrote=false;
try{
 const page=await fetch(origin);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy')||'',/default-src 'self'/);ok('HTTPSでページ表示・セキュリティヘッダー');
 assert.equal((await req(anon,'data')).status,401);assert.equal((await req(anon,'backup')).status,401);ok('未ログインでは業務データ・バックアップを拒否（401）');
 const s=(await req(anon,'session')).data;assert.equal(s.configured,true,'管理者が未作成です');assert.equal(s.setupAllowed,false);assert.notEqual((await req(anon,'setup','POST',{email:'x@example.com',password:'x'.repeat(16),setupToken:'x'})).status,200);ok('初回登録は閉じている');
 assert.equal((await req(anon,'login','POST',{email,password:password+'-wrong'})).status,401);ok('誤ったパスワードを拒否');
 const t0=Date.now();assert.equal((await req(a,'login','POST',{email,password})).status,200,'ログインできませんでした');ok(`ログイン成功（${Date.now()-t0}ms）`);
 assert.equal((await req(a,'session')).data.storage,'d1');ok('保存先はCloudflare D1');
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
 let d=(await req(a,'data')).data;
 d.goals.push({id:ids.goal,title:'【動作確認】目標',type:'monthly',month:today.slice(0,7),current:1,target:10,unit:'件'});
 d.tasks.push({id:ids.task,title:'【動作確認】タスク',due:today,priority:'低',done:false});
 d.shipments.push({id:ids.ship,title:'【動作確認】発送',order:'TEST',recipient:'TEST',due:today,carrier:'TEST',tracking:'',status:'未発送'});
 let w=await req(a,'data','PUT',d);assert.equal(w.status,200);wrote=true;ok('目標・タスク・発送を登録');
 d=(await req(a,'data')).data;d.goals.find(x=>x.id===ids.goal).current=5;d.tasks.find(x=>x.id===ids.task).done=true;const sh=d.shipments.find(x=>x.id===ids.ship);sh.status='発送済み';sh.tracking='1234-5678';
 w=await req(a,'data','PUT',d);assert.equal(w.status,200);ok('目標・タスク・発送を更新');
 assert.equal((await req(a,'data','PUT',{...d,revision:d.revision})).status,409);ok('古い更新番号の上書きを拒否（409）');
 assert.equal((await req(a,'logout','POST',{})).status,200);for(const r of ['data','backup','instagram/status','amazon/status'])assert.equal((await req(a,r)).status,401);ok('ログアウト後のアクセスを拒否（401）');
 assert.equal((await req(b,'login','POST',{email,password})).status,200);const again=(await req(b,'data')).data;
 assert.equal(again.goals.find(x=>x.id===ids.goal)?.current,5);assert.equal(again.tasks.find(x=>x.id===ids.task)?.done,true);assert.equal(again.shipments.find(x=>x.id===ids.ship)?.tracking,'1234-5678');ok('再ログイン後も更新内容が保存されている（別セッション）');
}finally{
 if(wrote){if(!b.cookie)await req(b,'login','POST',{email,password});const l=(await req(b,'data')).data;if(l){l.goals=l.goals.filter(x=>x.id!==ids.goal);l.tasks=l.tasks.filter(x=>x.id!==ids.task);l.shipments=l.shipments.filter(x=>x.id!==ids.ship);const r=await req(b,'data','PUT',l);console.log(r.status===200?'  ✓ 動作確認用の一時データを削除':'  ! 一時データの削除に失敗。画面から【動作確認】の記録を削除してください');}}
 await req(b,'logout','POST',{});
}
console.log('PASS: 公開URLの動作確認がすべて成功しました');
