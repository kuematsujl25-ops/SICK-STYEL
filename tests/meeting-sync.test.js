import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createStore} from '../lib/store.js';
import {encrypt} from '../lib/security.js';
import {empty,validate} from '../lib/domain.js';
import {newOrg} from '../public/org-sales.js';
import {syncMeeting} from '../lib/meeting-sync.js';

async function seed(store,org){
 await store.put('zoom-private',{userId:'u1',email:'owner@example.com',encrypted:encrypt({refresh:'zoom-refresh'}),issuedAt:Date.now(),connectedAt:new Date().toISOString(),scopes:[]});
 await store.put('googlecalendar-private',{email:'owner@example.com',encrypted:encrypt({refresh:'gcal-refresh'}),issuedAt:Date.now(),connectedAt:new Date().toISOString(),scope:''});
 const data=validate({...empty(),orgSales:[org]});
 const r=await store.put('workspace',data);
 return r[0].revision;
}
function fakeFetch(behavior){
 let zoomMeetingSeq=1000;
 return async(url,options)=>{const u=new URL(url);
  if(u.hostname==='zoom.us'&&u.pathname==='/oauth/token')return Response.json({access_token:'za',refresh_token:'zr'});
  if(u.pathname==='/v2/users/me/meetings'&&options.method==='POST'){
   if(behavior.zoomFails)throw Error('network');
   zoomMeetingSeq++;return Response.json({id:zoomMeetingSeq,join_url:'https://zoom.us/j/'+zoomMeetingSeq,start_url:'https://zoom.us/s/'+zoomMeetingSeq+'?zak=SECRET'});
  }
  if(/^\/v2\/meetings\/\d+$/.test(u.pathname)&&options.method==='PATCH')return behavior.zoomUpdateFails?new Response(JSON.stringify({code:1,message:'fail'}),{status:400}):new Response(null,{status:204});
  if(/^\/v2\/meetings\/\d+$/.test(u.pathname)&&options.method==='DELETE')return behavior.zoomDeleteFails?new Response(JSON.stringify({code:1,message:'fail'}),{status:400}):new Response(null,{status:204});
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'ga'});
  if(u.pathname==='/calendar/v3/calendars/primary/events'&&options.method==='POST'){
   if(behavior.calendarFails)return new Response(JSON.stringify({error:{code:500,message:'fail'}}),{status:500});
   return Response.json({id:'evt-'+(zoomMeetingSeq),htmlLink:'https://calendar.google.com/x'});
  }
  if(/^\/calendar\/v3\/calendars\/primary\/events\/.+$/.test(u.pathname)&&options.method==='PATCH')return behavior.calendarUpdateFails?new Response(null,{status:500}):new Response(null,{status:204});
  if(/^\/calendar\/v3\/calendars\/primary\/events\/.+$/.test(u.pathname)&&options.method==='DELETE')return behavior.calendarDeleteFails?new Response(null,{status:500}):new Response(null,{status:204});
  return new Response(null,{status:404});
 };
}

test('新規作成は1回だけZoom会議を発行し、両方成功して初めてsyncedになる（start_urlは外部に出さない）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 global.fetch=fakeFetch({});
 const r1=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision});
 assert.equal(r1.org.initialMeetingSync.status,'synced');
 assert.ok(r1.org.initialMeetingSync.zoomMeetingId);
 assert.ok(r1.org.initialMeetingSync.calendarEventId);
 assert.equal(r1.org.initialZoomUrl.includes('zoom.us/j/'),true);
 assert.equal(JSON.stringify(r1).includes('zak'),false);
 // 二重会議作成の防止：既にsynced状態でcreateを呼んでも何もしない。
 const r2=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision:r1.revision});
 assert.equal(r2.org.initialMeetingSync.zoomMeetingId,r1.org.initialMeetingSync.zoomMeetingId);
});

test('Zoom成功・カレンダー失敗は部分成功として記録し、再試行はZoomを再発行しない',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-partial-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 global.fetch=fakeFetch({calendarFails:true});
 const r1=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision});
 assert.equal(r1.org.initialMeetingSync.status,'error');
 assert.ok(r1.org.initialMeetingSync.zoomMeetingId);
 assert.equal(r1.org.initialMeetingSync.calendarEventId,null);
 assert.ok(r1.warnings.length);
 const firstZoomId=r1.org.initialMeetingSync.zoomMeetingId;
 // 再試行：カレンダーだけ復旧させる。Zoomは再発行しない。
 global.fetch=fakeFetch({});
 const r2=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision:r1.revision});
 assert.equal(r2.org.initialMeetingSync.zoomMeetingId,firstZoomId);
 assert.equal(r2.org.initialMeetingSync.status,'synced');
 assert.ok(r2.org.initialMeetingSync.calendarEventId);
});

test('日程変更はZoom・Googleカレンダー双方へ同期し、取消は両方の削除を試みてから状態をクリアする',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-resched-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],proposalZoomAt:'2026-11-03T16:00'};
 const revision=await seed(store,org);
 global.fetch=fakeFetch({});
 const created=await syncMeeting(store,{orgId:'org-1',kind:'proposal',action:'create',revision});
 assert.equal(created.org.proposalMeetingSync.status,'synced');
 // 日程変更の同期
 const updated=await syncMeeting(store,{orgId:'org-1',kind:'proposal',action:'update',revision:created.revision});
 assert.equal(updated.org.proposalMeetingSync.status,'synced');
 assert.equal(updated.warnings.length,0);
 // 取消：両方の削除を試み、ローカルの同期状態をクリアする
 const cancelled=await syncMeeting(store,{orgId:'org-1',kind:'proposal',action:'cancel',revision:updated.revision});
 assert.equal(cancelled.org.proposalMeetingSync,null);
 assert.equal(cancelled.org.proposalZoomUrl,'');
 assert.equal(cancelled.warnings.length,0);
 // 一部でも失敗した場合、未取消の外部IDを保持し、誤った「取消済み」表示を防ぐ。
 const org2={...newOrg(),id:'org-2',name:'FC Two',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const data2=validate({...empty(),orgSales:[org2]});const put2=(await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 RETURNING revision',[JSON.stringify(data2),'workspace']))[0];
 const created2=await syncMeeting(store,{orgId:'org-2',kind:'initial',action:'create',revision:put2.revision});
 global.fetch=fakeFetch({zoomDeleteFails:true,calendarDeleteFails:true});
 const cancelled2=await syncMeeting(store,{orgId:'org-2',kind:'initial',action:'cancel',revision:created2.revision});
 assert.equal(cancelled2.org.initialMeetingSync.status,'error');
 assert.equal(cancelled2.org.initialMeetingSync.cancelPending,true);
 assert.equal(cancelled2.org.initialMeetingSync.zoomMeetingId,created2.org.initialMeetingSync.zoomMeetingId);
 assert.equal(cancelled2.org.initialMeetingSync.calendarEventId,created2.org.initialMeetingSync.calendarEventId);
 assert.equal(cancelled2.warnings.length,2);
 // 復旧時は残っている会議・イベントだけを再取消する。
 global.fetch=fakeFetch({});
 const recovered=await syncMeeting(store,{orgId:'org-2',kind:'initial',action:'cancel',revision:cancelled2.revision});
 assert.equal(recovered.org.initialMeetingSync,null);
 assert.equal(recovered.org.initialZoomUrl,'');
 assert.equal(recovered.warnings.length,0);
});

test('更新バージョン不一致（他端末の同時更新）は競合として拒否する',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-conflict-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 await seed(store,org);
 global.fetch=fakeFetch({});
 await assert.rejects(syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision:999}),/他の端末/);
 await assert.rejects(syncMeeting(store,{orgId:'does-not-exist',kind:'initial',action:'create',revision:0}),/見つかりません/);
 await assert.rejects(syncMeeting(store,{orgId:'org-1',kind:'bogus',action:'create',revision:0}),/種別/);
});

test('予定の更新失敗後の再試行は既存IDをPATCHしカレンダーイベントを重複作成しない',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-retry-update-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'Test FC',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-11-03T14:00'};
 const revision=await seed(store,org);
 global.fetch=fakeFetch({});
 const first=await syncMeeting(store,{orgId:org.id,kind:'initial',action:'create',revision});
 global.fetch=fakeFetch({calendarUpdateFails:true});
 const changed=await syncMeeting(store,{orgId:org.id,kind:'initial',action:'update',revision:first.revision});
 assert.equal(changed.org.initialMeetingSync.status,'error');
 let unexpectedCreates=0;
 const successFetch=fakeFetch({});
 global.fetch=async(u,opts)=>{
  if(String(u).includes('/calendar/v3/calendars/primary/events')&&opts?.method==='POST'){unexpectedCreates++;throw Error('must PATCH existing event');}
  if(String(u).includes('/v2/users/me/meetings')&&opts?.method==='POST'){unexpectedCreates++;throw Error('must not create new Zoom meeting');}
  return successFetch(u,opts);
 };
 const retried=await syncMeeting(store,{orgId:org.id,kind:'initial',action:'create',revision:changed.revision});
 assert.equal(unexpectedCreates,0);
 assert.equal(retried.org.initialMeetingSync.status,'synced');
 assert.equal(retried.org.initialMeetingSync.zoomMeetingId,first.org.initialMeetingSync.zoomMeetingId);
 assert.equal(retried.org.initialMeetingSync.calendarEventId,first.org.initialMeetingSync.calendarEventId);
});

test('Zoomだけ成功しカレンダーが未作成のまま日程変更しても、Zoom側の日時が必ず更新される（Codex指摘の回帰）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-reschedule-gap-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 // Zoomは成功、カレンダーは失敗 → zoomMeetingIdはあるがcalendarEventIdがない状態になる。
 global.fetch=fakeFetch({calendarFails:true});
 const created=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision});
 assert.equal(created.org.initialMeetingSync.status,'error');
 assert.ok(created.org.initialMeetingSync.zoomMeetingId);
 assert.equal(created.org.initialMeetingSync.calendarEventId,null);
 // この状態のまま、ユーザーが日程を変更して保存したとする（通常のorg編集で直接workspaceを更新）。
 const doc=await store.doc('workspace');const data=JSON.parse(doc.body);
 data.orgSales[0].initialZoomAt='2026-10-30T10:00';
 const put=(await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(data),'workspace',doc.revision]))[0];
 // 日程変更の同期（action='update'）。カレンダーも成功するように戻す。
 let zoomPatchBody=null;
 const okFetch=fakeFetch({});
 global.fetch=async(u,o)=>{if(/\/v2\/meetings\/\d+$/.test(new URL(u).pathname)&&o?.method==='PATCH')zoomPatchBody=JSON.parse(o.body);return okFetch(u,o);};
 const updated=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'update',revision:put.revision});
 assert.ok(zoomPatchBody,'calendarEventIdが無い状態でも、更新のたびに必ずZoom側へPATCHが送られる（以前はスキップされていた）');
 assert.equal(zoomPatchBody.start_time,'2026-10-30T01:00:00.000Z','Zoomに送られた開始時刻が新しい日程になっている');
 assert.equal(updated.org.initialMeetingSync.zoomMeetingId,created.org.initialMeetingSync.zoomMeetingId,'Zoom会議IDは変わらない（再作成しない）');
 assert.ok(updated.org.initialMeetingSync.calendarEventId,'欠けていたカレンダー予定もこの時点で作成される');
 assert.equal(updated.org.initialMeetingSync.status,'synced');
});

test('カレンダー予定が未作成の状態から2件が同時に復旧を試みても、Googleカレンダーの予定は1件しか作成されない（Codex指摘の回帰）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-calendar-race-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 global.fetch=fakeFetch({calendarFails:true});
 const created=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision});
 assert.equal(created.org.initialMeetingSync.calendarEventId,null);
 // 同じrevisionに対して、2つのリクエストが同時に「作成（復旧）」を試みる。
 let calendarEventsCreated=0;
 const okFetch=fakeFetch({});
 global.fetch=async(u,o)=>{if(String(u).includes('/calendar/v3/calendars/primary/events')&&o?.method==='POST')calendarEventsCreated++;return okFetch(u,o);};
 const results=await Promise.allSettled([
  syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision:created.revision}),
  syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision:created.revision})
 ]);
 assert.equal(calendarEventsCreated,1,'同時再試行でもGoogleカレンダーの予定作成は1回だけ（孤立イベントを作らない）');
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
});

test('カレンダー作成の外部呼び出し中に無関係な別の編集でrevisionが進んでも、古いrevisionへの再試行で永久に固着しない（Codex指摘の回帰）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-stale-reconcile-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 global.fetch=fakeFetch({calendarFails:true});
 const created=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision});
 assert.equal(created.org.initialMeetingSync.calendarEventId,null);
 // カレンダー作成の再試行中、Googleへのリクエストが返ってくる直前に、別の無関係な編集（目標の追加）が
 // ワークスペース全体のrevisionを進めてしまったとする（同一ドキュメント共有による典型的な競合）。
 const okFetch=fakeFetch({});
 global.fetch=async(u,o)=>{
  if(String(u).includes('/calendar/v3/calendars/primary/events')&&o?.method==='POST'){
   const doc=await store.doc('workspace');const data=JSON.parse(doc.body);
   data.goals.push({id:'unrelated-goal',title:'無関係な目標',type:'monthly',month:'2026-10',current:0,target:1,unit:'件'});
   await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3',[JSON.stringify(data),'workspace',doc.revision]);
  }
  return okFetch(u,o);
 };
 const retried=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision:created.revision});
 assert.equal(retried.org.initialMeetingSync.status,'synced','古いrevisionでの再試行が失敗しても、最新revisionへの再試行で保存が完了する');
 assert.ok(retried.org.initialMeetingSync.calendarEventId,'作成済みのカレンダー予定IDが孤立せず記録される');
 const finalDoc=JSON.parse((await store.doc('workspace')).body);
 assert.ok(finalDoc.goals.some(g=>g.id==='unrelated-goal'),'途中で保存された無関係な編集も失われていない');
 assert.notEqual(finalDoc.orgSales[0].initialMeetingSync.status,'creating','statusが作成中のまま固着していない（以後の操作がブロックされない）');
});

test('カレンダー作成の外部呼び出し中に、同じ団体のMTG日時そのものが別編集で変更された場合は、古い日時の成功を「同期済み」として保存しない（Codex指摘の回帰）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-input-changed-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 global.fetch=fakeFetch({calendarFails:true});
 const created=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision});
 assert.equal(created.org.initialMeetingSync.calendarEventId,null);
 // カレンダー作成の再試行中、Googleへのリクエストが返ってくる直前に、別の操作がこの団体自身のMTG日時を
 // 変更したとする（同期対象の入力そのものが途中で変わった、Codexが指摘したケース）。
 const okFetch=fakeFetch({});
 global.fetch=async(u,o)=>{
  if(String(u).includes('/calendar/v3/calendars/primary/events')&&o?.method==='POST'){
   const doc=await store.doc('workspace');const data=JSON.parse(doc.body);
   data.orgSales[0].initialZoomAt='2026-11-05T10:00'; // 日時そのものを変更
   await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3',[JSON.stringify(data),'workspace',doc.revision]);
  }
  return okFetch(u,o);
 };
 // このケースはgoogleカレンダー新規作成の直前に日時が変わるため、既存のcatch(カレンダー登録失敗)経路に
 // guardの拒否理由が合流し、最終的に status:'error'（'synced'ではない）として明示的なエラーメッセージ付きで
 // 保存される。例外を投げっぱなしにするよりも、既存のUI（再試行ボタン・エラー文言表示）にそのまま乗る。
 const retried=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision:created.revision});
 assert.notEqual(retried.org.initialMeetingSync.status,'synced','「同期済み」として誤って記録されていない（古い日時の成功を真実として保存しない）');
 assert.notEqual(retried.org.initialMeetingSync.status,'creating','creating状態のまま固着していない（以後の操作がブロックされない、Codex指摘の回帰：P2）');
 assert.match(retried.org.initialMeetingSync.error,/変更したため、今回の同期結果は保存しませんでした/);
 assert.ok(retried.org.initialMeetingSync.zoomMeetingId,'Zoom会議のIDは保持され、再試行時に重複作成されない');
 assert.ok(retried.org.initialMeetingSync.calendarEventId,'Googleカレンダーの作成自体は成功しているため、そのイベントIDも失われず保持される（Codex指摘の回帰：P2、以前は孤立イベントになっていた）');
 const finalOrg=JSON.parse((await store.doc('workspace')).body).orgSales[0];
 assert.notEqual(finalOrg.initialMeetingSync.status,'synced','「同期済み」として誤って記録されていない');
 assert.equal(finalOrg.initialZoomAt,'2026-11-05T10:00','変更後の日時そのものは失われていない');
});

test('既存カレンダー予定の更新中に同じ団体のMTG日時が別編集で変更された場合、creating状態のまま固着せず、既存のZoom・カレンダーIDも保持したまま再試行できる（Codex独立レビュー指摘の回帰：P2）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-update-guard-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 global.fetch=fakeFetch({});
 const created=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision});
 assert.equal(created.org.initialMeetingSync.status,'synced');
 // 既存のカレンダー予定を更新中、GoogleへのPATCHが返る直前に、別操作がこの団体自身のMTG日時を変更したとする。
 const okFetch=fakeFetch({});
 global.fetch=async(u,o)=>{
  const path=new URL(u).pathname;
  if(/^\/calendar\/v3\/calendars\/primary\/events\/.+$/.test(path)&&o?.method==='PATCH'){
   const doc=await store.doc('workspace');const data=JSON.parse(doc.body);
   data.orgSales[0].initialZoomAt='2026-11-05T10:00';
   await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3',[JSON.stringify(data),'workspace',doc.revision]);
  }
  return okFetch(u,o);
 };
 await assert.rejects(syncMeeting(store,{orgId:'org-1',kind:'initial',action:'update',revision:created.revision}),/変更したため、今回の同期結果は保存しませんでした/);
 const afterConflict=JSON.parse((await store.doc('workspace')).body).orgSales[0];
 assert.notEqual(afterConflict.initialMeetingSync.status,'creating','creating状態のまま固着していない（以前は以後のcreate/update/cancelが全てブロックされていた）');
 assert.equal(afterConflict.initialMeetingSync.status,'error');
 assert.ok(afterConflict.initialMeetingSync.zoomMeetingId,'Zoom会議IDは保持される');
 assert.ok(afterConflict.initialMeetingSync.calendarEventId,'既存のカレンダー予定IDも保持される');
 // 固着していないことを実際に確認：次の取消操作がブロックされずに進む。
 global.fetch=fakeFetch({});
 const latest=await store.doc('workspace');
 const cancelled=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'cancel',revision:latest.revision});
 assert.equal(cancelled.org.initialMeetingSync,null,'固着していれば「会議を作成処理中です」で拒否されるはずの取消が正常に完了する');
});

test('既存カレンダー予定の更新中に団体名（Zoom/カレンダーのトピックに使われる）が別編集で変更された場合、MTG日時自体は同じでも「同期済み」として保存しない（Codex独立レビュー指摘の回帰：P2）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-name-guard-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 global.fetch=fakeFetch({});
 const created=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision});
 assert.equal(created.org.initialMeetingSync.status,'synced');
 // 既存のカレンダー予定を更新中、GoogleへのPATCHが返る直前に、別操作が団体名だけを変更したとする
 // （MTG日時そのものは変わらないため、日時だけを見るガードでは検出できないケース）。
 const okFetch=fakeFetch({});
 global.fetch=async(u,o)=>{
  const path=new URL(u).pathname;
  if(/^\/calendar\/v3\/calendars\/primary\/events\/.+$/.test(path)&&o?.method==='PATCH'){
   const doc=await store.doc('workspace');const data=JSON.parse(doc.body);
   data.orgSales[0].name='FC Renamed';
   await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3',[JSON.stringify(data),'workspace',doc.revision]);
  }
  return okFetch(u,o);
 };
 await assert.rejects(syncMeeting(store,{orgId:'org-1',kind:'initial',action:'update',revision:created.revision}),/変更したため、今回の同期結果は保存しませんでした/);
 const afterConflict=JSON.parse((await store.doc('workspace')).body).orgSales[0];
 assert.notEqual(afterConflict.initialMeetingSync.status,'synced','団体名（Zoom/カレンダーのトピックの元）が変わったのに、古いトピックで送った成功を「同期済み」と誤って記録してはいけない');
 assert.notEqual(afterConflict.initialMeetingSync.status,'creating','creating状態のまま固着していない');
 assert.equal(afterConflict.name,'FC Renamed','変更後の団体名そのものは失われていない');
});

test('Zoom会議の作成自体は成功しても、その直後のID保存が失敗した場合、代償削除（Zoom会議の削除）はしつつcreating状態のまま固着させず再試行できる（Codex独立レビュー指摘の回帰：P2）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-save-after-create-fail-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 let zoomDeleted=0,failRemaining=0;
 const realQuery=store.query.bind(store);
 store.query=(text,values)=>{
  if(failRemaining>0&&typeof text==='string'&&text.startsWith('UPDATE ss_documents')&&values?.[1]==='workspace'){failRemaining--;return [];}
  return realQuery(text,values);
 };
 const okFetch=fakeFetch({});
 global.fetch=async(u,o)=>{
  const p=new URL(u).pathname;
  const res=await okFetch(u,o);
  // Zoom会議の作成自体が成功した直後から、ワークスペースへの保存を2回（saveSyncReconciledの初回+1回の
  // 再試行）だけ失敗させる（CAS競合が繰り返し起きた想定）。その後の「creating状態を解除する」保存は
  // 成功させることで、代償削除後にロックだけが固着しないことを確認する。
  if(p==='/v2/users/me/meetings'&&o?.method==='POST')failRemaining=2;
  if(/^\/v2\/meetings\/\d+$/.test(p)&&o?.method==='DELETE')zoomDeleted++;
  return res;
 };
 await assert.rejects(syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision}),/他の端末/);
 assert.equal(zoomDeleted,1,'保存失敗後、作成済みのZoom会議は代償削除される（孤立させない）');
 assert.equal(failRemaining,0,'想定した2回の保存失敗が実際に発生した');
 const afterFailure=JSON.parse((await store.doc('workspace')).body).orgSales[0];
 assert.notEqual(afterFailure.initialMeetingSync.status,'creating','creating状態のまま固着していない（以前は以後のcreate/update/cancelが全てブロックされていた）');
 assert.equal(afterFailure.initialMeetingSync.status,'error');
 assert.equal(afterFailure.initialMeetingSync.zoomMeetingId,null,'代償削除済みのZoom会議IDを孤立したまま保持しない');
 // 固着していないことを実際に確認：次の作成リトライがブロックされずに進む。
 global.fetch=fakeFetch({});
 const latest=await store.doc('workspace');
 const retried=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision:latest.revision});
 assert.equal(retried.org.initialMeetingSync.status,'synced','固着していれば「会議を作成処理中です」で拒否されるはずの再作成が正常に完了する');
});

test('取消処理で両方の外部削除が成功しても、最後の保存自体が失敗した場合、creating状態のまま固着させず再試行できる（Codex独立レビュー指摘の回帰：P2）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-cancel-save-fail-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 global.fetch=fakeFetch({});
 const created=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision});
 assert.equal(created.org.initialMeetingSync.status,'synced');
 let failRemaining=0;
 const realQuery=store.query.bind(store);
 store.query=(text,values)=>{
  if(failRemaining>0&&typeof text==='string'&&text.startsWith('UPDATE ss_documents')&&values?.[1]==='workspace'){failRemaining--;return [];}
  return realQuery(text,values);
 };
 const okFetch=fakeFetch({});
 global.fetch=async(u,o)=>{
  const p=new URL(u).pathname;
  const res=await okFetch(u,o);
  // Zoom会議の削除が成功した直後から、最後の保存を2回（saveSyncReconciledの初回+1回の再試行）だけ
  // 失敗させる（両方の外部削除は成功しているのに、最後の保存だけがCAS競合の繰り返し等で失敗した想定）。
  if(/^\/v2\/meetings\/\d+$/.test(p)&&o?.method==='DELETE')failRemaining=2;
  return res;
 };
 await assert.rejects(syncMeeting(store,{orgId:'org-1',kind:'initial',action:'cancel',revision:created.revision}),/他の端末/);
 assert.equal(failRemaining,0,'想定した2回の保存失敗が実際に発生した');
 const afterFailure=JSON.parse((await store.doc('workspace')).body).orgSales[0];
 assert.notEqual(afterFailure.initialMeetingSync?.status,'creating','creating状態のまま固着していない（以前は以後のcreate/update/cancelが全てブロックされていた）');
 assert.equal(afterFailure.initialMeetingSync,null,'両方の外部削除は成功済みのため、再試行の保存で正しく取消済み（null）として記録される');
 assert.equal(afterFailure.initialZoomUrl,'');
 // 固着していないことを実際に確認：次の操作（再作成）がブロックされずに進む。
 global.fetch=fakeFetch({});
 const latest=await store.doc('workspace');
 const recreated=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision:latest.revision});
 assert.equal(recreated.org.initialMeetingSync.status,'synced','固着していれば「会議を作成処理中です」で拒否されるはずの再作成が正常に完了する');
});

test('Zoom会議の作成自体が失敗し、そのエラー記録の保存も失敗した場合、creating状態のまま固着させず再試行できる（round16・17と同じ固着パターンの自己点検での発見）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-create-fail-save-fail-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 let failRemaining=0;
 const realQuery=store.query.bind(store);
 store.query=(text,values)=>{
  if(failRemaining>0&&typeof text==='string'&&text.startsWith('UPDATE ss_documents')&&values?.[1]==='workspace'){failRemaining--;return [];}
  return realQuery(text,values);
 };
 const okFetch=fakeFetch({zoomFails:true});
 global.fetch=async(u,o)=>{
  const p=new URL(u).pathname;
  const res=await okFetch(u,o);
  // Zoomのトークン取得（会議作成の直前）が終わった時点から、エラー記録の保存を2回だけ失敗させる。
  if(p==='/oauth/token')failRemaining=2;
  return res;
 };
 await assert.rejects(syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision}),/Zoom API/,'Zoom作成失敗の元エラーが伝わる（保存失敗の例外で上書きされない）');
 assert.equal(failRemaining,0,'想定した2回の保存失敗が実際に発生した');
 const afterFailure=JSON.parse((await store.doc('workspace')).body).orgSales[0];
 assert.notEqual(afterFailure.initialMeetingSync?.status,'creating','creating状態のまま固着していない（以前は以後のcreate/update/cancelが全てブロックされていた）');
 assert.equal(afterFailure.initialMeetingSync.status,'error');
 // 固着していないことを実際に確認：次の作成リトライがブロックされずに進む。
 global.fetch=fakeFetch({});
 const latest=await store.doc('workspace');
 const retried=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision:latest.revision});
 assert.equal(retried.org.initialMeetingSync.status,'synced','固着していれば「会議を作成処理中です」で拒否されるはずの再作成が正常に完了する');
});

test('カレンダー予定の新規作成自体は成功しても、その保存が2回続けて失敗した場合、creating状態のまま固着させず最終的に保存できる（round16・17と同じ固着パターンの自己点検での発見）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-calendar-create-save-fail-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 let failRemaining=0;
 const realQuery=store.query.bind(store);
 store.query=(text,values)=>{
  if(failRemaining>0&&typeof text==='string'&&text.startsWith('UPDATE ss_documents')&&values?.[1]==='workspace'){failRemaining--;return [];}
  return realQuery(text,values);
 };
 const okFetch=fakeFetch({});
 global.fetch=async(u,o)=>{
  const p=new URL(u).pathname;
  const res=await okFetch(u,o);
  // カレンダー予定の新規作成が成功した直後から、保存を4回（最初の保存系列2回＋1回目のフォールバック
  // 保存系列2回）だけ失敗させ、2回目のフォールバック保存で初めて成功させる。
  if(p==='/calendar/v3/calendars/primary/events'&&o?.method==='POST')failRemaining=4;
  return res;
 };
 const result=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision});
 assert.equal(failRemaining,0,'想定した4回の保存失敗が実際に発生した');
 // カレンダー作成自体は成功しているが、保存系列の失敗を検知したcatch経路を通るため、既存の挙動と同じく
 // status:'error'として記録される（ここでの検証ポイントは、それでもcalendarEventIdが孤立せず保存され、
 // creating状態のまま固着しないこと）。
 assert.equal(result.org.initialMeetingSync.status,'error');
 assert.ok(result.org.initialMeetingSync.calendarEventId,'作成済みのカレンダー予定IDが孤立せず、最終的なフォールバック保存で記録される');
 const finalOrg=JSON.parse((await store.doc('workspace')).body).orgSales[0];
 assert.notEqual(finalOrg.initialMeetingSync.status,'creating','creating状態のまま固着していない（以前は以後のcreate/update/cancelが全てブロックされていた）');
 // 固着していないことを実際に確認：次の操作（再試行）がブロックされずに進む。
 global.fetch=fakeFetch({});
 const latest=await store.doc('workspace');
 const retried=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision:latest.revision});
 assert.equal(retried.org.initialMeetingSync.status,'synced','固着していれば「会議を作成処理中です」で拒否されるはずの再試行が正常に完了する');
});

test('同じ更新番号の2重送信で外部Zoom会議は1件しか作成しない',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-concurrent-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'Test FC',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-11-03T14:00'};
 const revision=await seed(store,org);
 const fetchMock=fakeFetch({});let meetingCreated=0;
 global.fetch=async(u,o)=>{if(String(u).includes('/v2/users/me/meetings')&&o?.method==='POST')meetingCreated++;return fetchMock(u,o);};
 const results=await Promise.allSettled([
  syncMeeting(store,{orgId:org.id,kind:'initial',action:'create',revision}),
  syncMeeting(store,{orgId:org.id,kind:'initial',action:'create',revision})
 ]);
 assert.equal(meetingCreated,1);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
});

test('既存会議への同時「日程変更」と「取消」は、片方だけが外部呼び出しへ進み、同期済み表示のまま削除済みIDを指す不整合にならない（Codex指摘の回帰）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-meeting-update-cancel-race-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 const org={...newOrg(),id:'org-1',name:'FC Example',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const revision=await seed(store,org);
 global.fetch=fakeFetch({});
 const created=await syncMeeting(store,{orgId:'org-1',kind:'initial',action:'create',revision});
 assert.equal(created.org.initialMeetingSync.status,'synced');
 let zoomPatched=0,zoomDeleted=0,calendarPatched=0,calendarDeleted=0;
 const okFetch=fakeFetch({});
 global.fetch=async(u,o)=>{
  const path=new URL(u).pathname;
  if(/^\/v2\/meetings\/\d+$/.test(path)&&o?.method==='PATCH')zoomPatched++;
  if(/^\/v2\/meetings\/\d+$/.test(path)&&o?.method==='DELETE')zoomDeleted++;
  if(/^\/calendar\/v3\/calendars\/primary\/events\/.+$/.test(path)&&o?.method==='PATCH')calendarPatched++;
  if(/^\/calendar\/v3\/calendars\/primary\/events\/.+$/.test(path)&&o?.method==='DELETE')calendarDeleted++;
  return okFetch(u,o);
 };
 // 同じrevisionに対して、同時に「日程変更」と「取消」を投げる。
 const results=await Promise.allSettled([
  syncMeeting(store,{orgId:'org-1',kind:'initial',action:'update',revision:created.revision}),
  syncMeeting(store,{orgId:'org-1',kind:'initial',action:'cancel',revision:created.revision})
 ]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1,'予約のCAS競合により、片方だけが成功する');
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
 // 先に予約を取れた側だけが実際に外部呼び出しを行う：更新のPATCHと取消のDELETEが両方とも発生することはない。
 assert.equal(zoomPatched>0&&zoomDeleted>0,false,'Zoom側でPATCHとDELETEの両方が実行されることはない');
 assert.equal(calendarPatched>0&&calendarDeleted>0,false,'カレンダー側でPATCHとDELETEの両方が実行されることはない');
 const finalOrg=JSON.parse((await store.doc('workspace')).body).orgSales[0];
 const sync=finalOrg.initialMeetingSync;
 // 最終状態は自己矛盾しない：同期済み（会議が実在）か、完全に取消済み（null）のどちらかのみ。
 if(sync===null){assert.equal(finalOrg.initialZoomUrl,'');}
 else{assert.equal(sync.status,'synced');assert.ok(sync.zoomMeetingId);assert.ok(sync.calendarEventId);}
});