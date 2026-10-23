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
 assert.equal((await req('setup','POST',creds)).status,409);assert.equal((await req('session')).data.setupAllowed,false);
 const primaryCookie=cookie;const secondLogin=await req('login','POST',creds);const secondCookie=secondLogin.cookie.split(';')[0];cookie=primaryCookie;
 const d=(await req('data')).data;
 d.goals.push({id:'g1',title:'売上目標',type:'monthly',month:'2026-10',current:10000,target:50000,unit:'円'});
 d.tasks.push({id:'t1',title:'新作を撮影',due:'2026-10-16',priority:'高',done:false,notes:'自然光'});
 d.shipments.push({id:'s1',title:'Tシャツ',order:'001',recipient:'テスト',due:'2026-10-17',carrier:'ヤマト',tracking:'123456',status:'未発送'});
 d.metrics.push({id:'m1',date:'2026-10-16',sales:10000,orders:2,followers:100,reach:500,engagement:20});
 d.staffTasks.push({id:'st1',title:'サンプル発送の確認',assignee:'竹田',due:'2026-10-18',priority:'高',status:'進行中',relatedOrg:'テスト団体',relatedPlayer:'',relatedPost:'',nextAction:'発送業者に確認',notes:'',updatedAt:'2026-10-16T00:00:00.000Z',deletedAt:null});
 d.orgSales.push({id:'o1',name:'テストFCサッカー部',category:'サッカー',size:'20名',assignee:'竹田',contact:'coach@example.com',stage:'サンプル発送',sampleQty:3,sampleCost:1500,shippingCost:500,trialUsers:null,feedback:'',proposal:'',paidQty:null,paidRevenue:null,paidCost:null,lostReason:'',nextAction:'到着確認の連絡',nextDue:'2026-10-20',notes:'',updatedAt:'2026-10-16T00:00:00.000Z',deletedAt:null,history:[{stage:'DM送信',at:'2026-10-14T00:00:00.000Z',note:''},{stage:'サンプル発送',at:'2026-10-16T00:00:00.000Z',note:'3着発送'}]});
 d.collectionTasks.push({id:'ct1',title:'SKU別販売個数',category:'商品・利益',purpose:'売れ筋判断',source:'注文データ',frequency:'月次',assignee:'入戸野',due:'',period:'2026年10月',status:'未収集',value:'',notes:'',updatedAt:'2026-10-16T00:00:00.000Z'});
 d.reelPosts.push({id:'rp1',title:'ドリブル解説リール',platform:'Instagram',url:'https://instagram.com/p/x',postedAt:'2026-10-10',durationSec:20,theme:'ドリブル',hook:'',format:'解説',cta:'',product:'',campaignId:'',observedAt:'2026-10-16T00:00:00.000Z',views:1000,reach:800,avgWatchSec:null,retentionPct:null,saves:30,shares:5,comments:2,followersGained:1,profileVisits:10,linkClicks:0,notes:''});
 d.growthExperiments.push({id:'ge1',title:'解説→購入実験',hypothesis:'共感から購入',relatedPosts:'rp1',targetProduct:'ボール',cta:'',trackingLink:'',periodStart:'2026-10-01',periodEnd:'2026-10-16',metricsWatched:'クリック数',measuredPurchases:null,unmeasuredNote:'流入不明あり',result:'',nextAction:'',status:'仮説検証中',updatedAt:'2026-10-16T00:00:00.000Z'});
 d.competitorAccounts.push({id:'ca1',accountName:'REGATEドリブル塾',platform:'YouTube',profileUrl:'',postUrl:'',genre:'ドリブル',observedAt:'2026-10-16',followers:10000,publicViews:null,reaction:'',referencePoint:'',ownIdea:''});
 d.playerCandidates.push({id:'pc1',name:'俵積田晃太',league:'Jリーグ',tier:'候補',affiliation:'鹿島',position:'FW',profileUrl:'',videoUrl:'',dribbleAttempts:null,successRate:null,playTimeMin:null,period:'',source:'',brandFitReason:'',confirmItems:'未確認',negotiationStatus:'未接触'});
 d.brand.Mission='スタイルを届ける';
 assert.equal((await req('data','PUT',d)).status,200);d.revision=1;assert.deepEqual((await req('data')).data,d);cookie=secondCookie;assert.equal((await req('data')).data.tasks[0].title,'新作を撮影');cookie=primaryCookie;
 const badAssignee=structuredClone(d);badAssignee.staffTasks[0].assignee='権限外担当';assert.equal((await req('data','PUT',badAssignee)).status,400);
 const badStage=structuredClone(d);badStage.orgSales[0].stage='謎の段階';assert.equal((await req('data','PUT',badStage)).status,400);
 const badCategory=structuredClone(d);badCategory.collectionTasks[0].category='謎';assert.equal((await req('data','PUT',badCategory)).status,400);
 const badPlatform=structuredClone(d);badPlatform.reelPosts[0].platform='X';assert.equal((await req('data','PUT',badPlatform)).status,400);
 const badRetention=structuredClone(d);badRetention.reelPosts[0].retentionPct=101;assert.equal((await req('data','PUT',badRetention)).status,400);
 const badTier=structuredClone(d);badTier.playerCandidates[0].tier='謎';assert.equal((await req('data','PUT',badTier)).status,400);
 const badAccount=structuredClone(d);badAccount.competitorAccounts[0].accountName='';assert.equal((await req('data','PUT',badAccount)).status,400);
 assert.equal((await req('data','PUT',d,{Origin:'https://evil.example'})).status,403);
 const invalid=structuredClone(d);invalid.metrics[0].sales=-1;assert.equal((await req('data','PUT',invalid)).status,400);
 const malformed=structuredClone(d);malformed.tasks[0].due='2026-02-31';assert.equal((await req('data','PUT',malformed)).status,400);
 const duplicate=structuredClone(d);duplicate.metrics.push({...duplicate.metrics[0],id:'m2'});assert.equal((await req('data','PUT',duplicate)).status,400);
 const backup=(await req('backup')).data;assert.equal(backup.version,1);assert.equal(backup.data.brand.Mission,'スタイルを届ける');assert.equal(JSON.stringify(backup).includes('Test-password'),false);
 assert.equal(backup.data.staffTasks.length,1);assert.equal(backup.data.orgSales.length,1);assert.equal(backup.data.collectionTasks.length,1);
 assert.equal(backup.data.reelPosts.length,1);assert.equal(backup.data.growthExperiments.length,1);assert.equal(backup.data.competitorAccounts.length,1);assert.equal(backup.data.playerCandidates.length,1);
 const stale=structuredClone(d);stale.revision=0;assert.equal((await req('data','PUT',stale)).status,409);
 d.tasks[0].done=true;assert.equal((await req('data','PUT',d)).status,200);assert.equal((await req('restore','POST',{version:0,data:d,revision:2})).status,400);assert.equal((await req('restore','POST',{...backup,revision:2})).status,200);
 const restored=(await req('data')).data;assert.equal(restored.tasks[0].done,false);assert.equal(restored.staffTasks.length,1);assert.equal(restored.orgSales[0].name,'テストFCサッカー部');assert.equal(restored.collectionTasks[0].title,'SKU別販売個数');
 assert.equal(restored.reelPosts[0].title,'ドリブル解説リール');assert.equal(restored.growthExperiments[0].title,'解説→購入実験');assert.equal(restored.competitorAccounts[0].accountName,'REGATEドリブル塾');assert.equal(restored.playerCandidates[0].name,'俵積田晃太');
 // 論理削除（ゴミ箱）→復元が、保存・再読込を経て維持されることを確認する。
 const withDeleted=structuredClone(restored);withDeleted.staffTasks[0].deletedAt='2026-10-19T00:00:00.000Z';const delSave=await req('data','PUT',withDeleted);assert.equal(delSave.status,200);withDeleted.revision=delSave.data.revision;
 assert.equal((await req('data')).data.staffTasks[0].deletedAt,'2026-10-19T00:00:00.000Z');
 withDeleted.staffTasks[0].deletedAt=null;const unSave=await req('data','PUT',withDeleted);assert.equal(unSave.status,200);
 assert.equal((await req('data')).data.staffTasks[0].deletedAt,null);
 // 旧データ互換性: staffTasks/orgSales/collectionTasksを含まない（本機能追加前の）文書もPUTで受理され、GETで空配列が補われる。
 const latest=(await req('data')).data;const oldShaped={goals:latest.goals,tasks:latest.tasks,shipments:latest.shipments,metrics:latest.metrics,brand:latest.brand,integrations:latest.integrations,revision:latest.revision};
 const oldPut=await req('data','PUT',oldShaped);assert.equal(oldPut.status,200);
 const afterOld=(await req('data')).data;for(const k of ['staffTasks','orgSales','collectionTasks','reelPosts','growthExperiments','competitorAccounts','playerCandidates'])assert.deepEqual(afterOld[k],[],k);assert.equal(afterOld.tasks.length,1);
 await stop();await start();assert.equal((await req('data')).data.shipments[0].tracking,'123456');assert.deepEqual((await req('data')).data.staffTasks,[]);
 for(const p of ['/staff-tasks.js','/org-sales.js','/collection-tasks.js','/reels.js','/experiments.js','/accounts.js','/players.js','/player-research.js','/meeting-links.js','/amazon-periods.js','/notifications.js']){const r=await fetch(base+p);assert.equal(r.status,200,'GET '+p);assert.match(r.headers.get('content-type'),/javascript/,'Content-Type '+p);}
 assert.equal((await req('logout','POST',{})).status,200);assert.equal((await req('data')).status,401);assert.equal((await req('backup')).status,401);assert.equal((await req('instagram/status')).status,401);assert.equal((await req('amazon/status')).status,401);cookie=secondCookie;assert.equal((await req('data')).status,200);cookie='';
 assert.equal((await req('login','POST',{...creds,password:'wrong-password-123'})).status,401);const login=await req('login','POST',creds);assert.equal(login.status,200);cookie=login.cookie.split(';')[0];assert.equal((await req('session')).data.authenticated,true);
 const html=await fetch(base);assert.equal(html.status,200);assert.match(await html.text(),/lang="ja"/);assert.match(html.headers.get('content-security-policy'),/default-src 'self'/);
 assert.equal((await fetch(base+'/server.js')).status,404);assert.equal((await fetch(base+'/manifest.webmanifest')).status,200);assert.equal((await fetch(base+'/icon-192.png')).status,200);assert.equal((await req('instagram/cron')).status,401);assert.equal((await req('instagram/webhook','POST',{})).status,403);
});
test('未設定の公式APIは外部通信を行わない',async()=>{const c=createIntegrations();assert.equal(c.amazon.mode,'manual');await assert.rejects(c.amazon.fetchMetrics(),/手入力/);assert.throws(()=>createIntegrations({amazon:{}}),/adapter/);});
