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
 // 失敗したAPI呼び出しがあっても、ローカル状態は意図通り取消として扱う（警告には残す）
 const org2={...newOrg(),id:'org-2',name:'FC Two',updatedAt:new Date().toISOString(),deletedAt:null,history:[{stage:'DM送信',at:new Date().toISOString(),note:''}],initialZoomAt:'2026-10-28T14:00'};
 const data2=validate({...empty(),orgSales:[org2]});const put2=(await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 RETURNING revision',[JSON.stringify(data2),'workspace']))[0];
 const created2=await syncMeeting(store,{orgId:'org-2',kind:'initial',action:'create',revision:put2.revision});
 global.fetch=fakeFetch({zoomDeleteFails:true,calendarDeleteFails:true});
 const cancelled2=await syncMeeting(store,{orgId:'org-2',kind:'initial',action:'cancel',revision:created2.revision});
 assert.equal(cancelled2.org.initialMeetingSync,null);
 assert.equal(cancelled2.warnings.length,2);
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
