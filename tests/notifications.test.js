import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createStore} from '../lib/store.js';
import {withRuntime} from '../lib/runtime.js';
import {scheduledKind,reportFor,runReport,listNotifications,emit,aiUpdated,subscribe,unsubscribe,status,markRead} from '../lib/notifications.js';
import {validateSubscription,pushRequest,base64url,unbase64url} from '../lib/web-push.js';
import {empty} from '../lib/domain.js';

// 回帰確認: navigator.serviceWorker.ready はSW登録が失敗・保留のままだと永久に解決しないことがある
// （実機テストで確認: サンドボックス環境でSW登録が失敗すると、通知履歴パネルが「読み込み中…」のまま固まった）。
// 通知履歴の表示はプッシュ登録の状態に依存しないため、必ずタイムアウトで打ち切り、履歴表示自体をブロックしない。
test('public/notifications.js never awaits navigator.serviceWorker.ready without a timeout guard (would hang the whole history panel if SW registration stalls)',async()=>{
 const src=await readFile(new URL('../public/notifications.js',import.meta.url),'utf8');
 const bareAwaits=[...src.matchAll(/await\s+(?:navigator\.serviceWorker\.ready|\w+\.pushManager\.getSubscription\(\))/g)];
 for(const m of bareAwaits)assert.match(src.slice(Math.max(0,m.index-40),m.index),/withTimeout\($/,'bare await (no withTimeout wrapper) at: '+m[0]);
 assert.match(src,/withTimeout\s*=\s*\(p,ms\)=>Promise\.race/,'withTimeout helper must exist');
});

const jst='2026-10-23T00:00:00.000Z';
test('cron times map to 09:00/20:00/22:00 JST, existing 09:10 sync is untouched',()=>{
 assert.equal(scheduledKind('0 0 * * *'),'morning');
 assert.equal(scheduledKind('0 11 * * *'),'sales');
 assert.equal(scheduledKind('0 13 * * *'),'analysis');
 assert.equal(scheduledKind('10 0 * * *'),null);
});
test('morning briefing only counts saved real schedule, distinguishes disconnected Calendar',()=>{
 const d=empty();d.staffTasks=[{title:'返答確認',due:'2026-10-23',status:'未着手'},{title:'済',due:'2026-10-23',status:'完了'}];
 d.orgSales=[{name:'FC',initialZoomAt:'2026-10-23T15:00',deletedAt:null}];
 const r=reportFor('morning',jst,d,null,[],false);
 assert.match(r.body,/Google予定未接続/);
 assert.match(r.body,/担当タスク1件/);
 assert.match(r.body,/団体商談1件/);
});
test('取消済みのMTGは朝の通知に表示されない（取消が完全に成功するとlib/meeting-sync.jsが開始予定の日時も消すため、Codex独立レビュー指摘の回帰）',()=>{
 const d=empty();
 // initialMeetingSyncがnull（取消済み）でも、initialZoomAtが消されていなければ今日の予定として誤って
 // 数えてしまう。lib/meeting-sync.jsの取消処理は完全成功時に日時も消すため、ここではその結果（''）を
 // 直接検証する。
 d.orgSales=[{name:'FC',initialZoomAt:'',initialMeetingSync:null,deletedAt:null}];
 const r=reportFor('morning',jst,d,null,[],false);
 assert.match(r.body,/団体商談0件/);
 assert.equal(r.detail.meetings.length,0);
});
test('20h and 22h do not fabricate zero for unknown sales and never infer causes',()=>{
 const d=empty(),api={dailyHistory:[{date:'2026-10-22',sales:3000}]};
 let report=reportFor('sales',jst,d,api);
 assert.match(report.body,/未取得/);
 assert.equal(report.detail.sales,null);
 report=reportFor('analysis',jst,d,api);
 assert.equal(report.detail.difference,null);
 d.metrics=[{date:'2026-10-23',sales:5000}];
 report=reportFor('analysis',jst,d,api);
 assert.equal(report.detail.difference,2000);
 assert.equal(report.detail.causesVerified,false);
 assert.match(report.body,/未検証/);
});
test('daily notifications are idempotent on repeated Cron retries and remain in D1',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sickstyle-notify-'));
 const store=await createStore({DATA_DIR:dir});
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const result=await runReport(store,'sales',new Date(jst));
 assert.equal(result.created,true);
 assert.equal((await runReport(store,'sales',new Date(jst))).created,false);
 let items=await listNotifications(store);
 assert.equal(items.length,1);assert.equal(items[0].kind,'sales');
 assert.equal((await markRead(store,items[0].id)).ok,true);
 items=await listNotifications(store);assert.ok(items[0].readAt);
 const job={id:'0b737edd-52f0-4af3-803e-8d85a439e326',title:'選手候補を探す'};
 await aiUpdated(store,job,'in_review');await aiUpdated(store,job,'in_review');
 await aiUpdated(store,job,'completed');
 items=await listNotifications(store);
 assert.equal(items.length,3);
 assert.equal(items.filter(x=>x.kind==='ai_review').length,1);
 assert.equal(items.filter(x=>x.kind==='ai_completed').length,1);
});
test('listNotifications orders by actual creation time, not by the document name string, so an older kind cannot crowd out a more recent one once history grows large (Codex独立レビュー指摘の回帰)',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sickstyle-notify-order-'));
 const store=await createStore({DATA_DIR:dir});
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 // name = 'notify-event-v1:'+kind+':'+id なので、'sales'は辞書順で'morning'より後ろに来る。
 // 旧実装は SQL の ORDER BY name DESC LIMIT 300 で絞り込んでいたため、'sales'だけで300件を超えると
 // 実際には最新である'morning'の1件がSQL段階で完全に除外されていた。createdAtを明示的にずらして検証する。
 const base=Date.parse('2026-01-01T00:00:00.000Z');
 for(let i=0;i<305;i++)await store.put('notify-event-v1:sales:day-'+String(i).padStart(4,'0'),
  {id:'notify-event-v1:sales:day-'+String(i).padStart(4,'0'),kind:'sales',title:'売上速報',body:'本日の売上 ¥1,000（テスト）',detail:null,createdAt:new Date(base+i).toISOString(),readAt:null});
 await store.put('notify-event-v1:morning:latest-morning',
  {id:'notify-event-v1:morning:latest-morning',kind:'morning',title:'今日の予定',body:'テスト',detail:null,createdAt:new Date(base+1000).toISOString(),readAt:null});
 const items=await listNotifications(store);
 assert.ok(items.some(x=>x.kind==='morning'&&x.id.includes('latest-morning')),'305件のsalesに埋もれず、最新のmorning通知が一覧に含まれる');
 assert.equal(items[0].kind,'morning','一覧の先頭は実際の作成時刻で最新のもの');
});
test('push subscriptions are encrypted in D1 and can be removed per device',async t=>{
 const previous={...process.env};process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'sickstyle-device-'));
 const store=await createStore({DATA_DIR:dir});
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);});
 const sub={endpoint:'https://fcm.googleapis.com/fcm/send/device-id',keys:{p256dh:'B'+ 'A'.repeat(86),auth:'A'.repeat(22)}};
 const accepted=validateSubscription(sub);
 assert.ok(accepted.endpoint.startsWith('https://fcm.googleapis.com/'));
 await subscribe(store,sub);
 const rows=await store.query('SELECT body FROM ss_documents WHERE name LIKE $1',['notify-device-v1:%']);
 assert.equal(rows.length,1);
 assert.equal(rows[0].body.includes(sub.endpoint),false);
 assert.equal((await status(store)).devices,1);
 await unsubscribe(store,sub.endpoint);
 assert.equal((await status(store)).devices,0);
 assert.throws(()=>validateSubscription({...sub,endpoint:'https://evil.invalid/push'}),/未承認/);
});

test('Web Push payload is signed, encrypted and decryptable with the subscriber ECDH key',async()=>{
 const serverKeys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',serverKeys.privateKey);
 const pub=new Uint8Array([4,...unbase64url(jwk.x),...unbase64url(jwk.y)]);
 const browserKeys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const browserPub=new Uint8Array(await crypto.subtle.exportKey('raw',browserKeys.publicKey));
 const auth=crypto.getRandomValues(new Uint8Array(16));
 const env={VAPID_PUBLIC_KEY:base64url(pub),VAPID_PRIVATE_KEY:jwk.d,VAPID_SUBJECT:'https://sickstyle-manager.sickstyle-74h4.workers.dev'};
 const sub={endpoint:'https://fcm.googleapis.com/fcm/send/abcdef',keys:{p256dh:base64url(browserPub),auth:base64url(auth)}};
 const req=await pushRequest(sub,env,{title:'配信テスト',body:'保存データのみ',url:'/'});
 assert.equal(req.endpoint,sub.endpoint);
 assert.match(req.init.headers.Authorization,/^vapid t=/);
 assert.equal(req.init.headers['Content-Encoding'],'aes128gcm');
 assert.equal(req.init.headers['TTL'],'3600');
 assert.ok(req.init.body instanceof Uint8Array);
 const bytes=req.init.body,salt=bytes.slice(0,16),serverPublic=bytes.slice(21,86);
 assert.equal(bytes[20],65);
 const serverECDH=await crypto.subtle.importKey('raw',serverPublic,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const secret=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:serverECDH},browserKeys.privateKey,256));
 const join=(...parts)=>{const a=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){a.set(p,i);i+=p.length;}return a;};
 const utf8=s=>new TextEncoder().encode(s);
 const hkdf=async(input,salt,info,len)=>{
  const key=await crypto.subtle.importKey('raw',input,'HKDF',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,len*8));
 };
 const ikm=await hkdf(secret,auth,join(utf8('WebPush: info'),new Uint8Array([0]),browserPub,serverPublic),32);
 const cek=await hkdf(ikm,salt,join(utf8('Content-Encoding: aes128gcm'),new Uint8Array([0])),16);
 const nonce=await hkdf(ikm,salt,join(utf8('Content-Encoding: nonce'),new Uint8Array([0])),12);
 const key=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['decrypt']);
 const clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},key,bytes.slice(86)));
 assert.equal(clear.at(-1),2);
 assert.equal(JSON.parse(new TextDecoder().decode(clear.slice(0,-1))).title,'配信テスト');
});
