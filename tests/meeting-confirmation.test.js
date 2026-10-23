import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createStore} from '../lib/store.js';
import {encrypt} from '../lib/security.js';
import {empty,validate} from '../lib/domain.js';
import {newOrg} from '../public/org-sales.js';
import {previewMeeting,confirmMeeting} from '../lib/meeting-confirmation.js';
import {identityScope} from '../integrations/googlecalendar.js';
const policy={organizer:'organizer@example.com',guests:['guest1@example.com','guest2@example.com']};
async function setup(t){
 const env={...process.env},oldFetch=global.fetch;
 Object.assign(process.env,{TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),ZOOM_CLIENT_ID:'test',ZOOM_CLIENT_SECRET:'test',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test'});
 const dir=await mkdtemp(tmpdir()+'/meeting-confirm-');const store=await createStore({DATA_DIR:dir});
 t.after(async()=>{global.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 await store.put('zoom-private',{userId:'host-id',email:'zoom@example.com',encrypted:encrypt({refresh:'test'})});
 await store.put('googlecalendar-private',{scope:identityScope,encrypted:encrypt({refresh:'test'})});
 const org={...newOrg(),id:'example',name:'Example Club',initialZoomAt:'2026-12-01T10:00',initialMeetingContent:'商品説明',updatedAt:new Date().toISOString()};
 const [row]=await store.put('workspace',validate({...empty(),orgSales:[org]}));
 const calls=[];let wrong=false,failCalendar=false;
 global.fetch=async (url,options={})=>{
  const u=new URL(url),method=options.method||'GET';calls.push({path:decodeURIComponent(u.pathname),method,query:u.search,body:options.body});
  if(u.hostname==='zoom.us'||u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'test',refresh_token:'test'});
  if(u.pathname==='/v2/users/me')return Response.json({id:'host-id',email:'zoom@example.com'});
  if(u.pathname==='/calendar/v3/calendars/primary')return Response.json({id:wrong?'wrong@example.com':policy.organizer});
  if(u.pathname==='/v2/users/me/meetings')return Response.json({id:123,join_url:'https://zoom.us/j/123'});
  if(method==='PATCH'||method==='DELETE')return new Response(null,{status:204});
  if(u.pathname.endsWith('/events'))return failCalendar?Response.json({error:{code:403}},{status:403}):Response.json({id:'event123'});
  throw Error('Unexpected mock request');
 };
 return {store,calls,revision:row.revision,setWrong:v=>wrong=v,setFail:v=>failCalendar=v};
}
test('確認→Zoomのみ作成→URL確認→ゲスト招待・更新・取消、再送で重複しない',async t=>{
 const {store,calls,revision}=await setup(t);
 let input={orgId:'example',kind:'initial',action:'prepare',revision};
 let plan=await previewMeeting(store,input,policy);
 assert.equal(plan.summary,'Example Club｜商品説明');assert.equal(plan.zoomHost,'zoom@example.com');assert.equal(plan.calendarId,policy.organizer);assert.equal(plan.zoomUrl,null);
 let result=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 assert.equal(result.org.initialMeetingSync.status,'zoom_only');
 assert.equal(calls.filter(c=>c.path.endsWith('/events')&&c.method==='POST').length,0);
 await assert.rejects(confirmMeeting(store,{...input,confirmation:plan.confirmation},policy),/再読み込み/);
 input={...input,action:'create',revision:result.revision};plan=await previewMeeting(store,input,policy);
 assert.equal(plan.zoomUrl,'https://zoom.us/j/123');
 result=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 assert.equal(result.org.initialMeetingSync.status,'synced');
 const event=calls.find(c=>c.path.endsWith('/events')&&c.method==='POST');
 assert.match(event.path,/organizer@example.com/);assert.equal(event.query,'?sendUpdates=all');
 assert.deepEqual(JSON.parse(event.body).attendees,policy.guests.map(email=>({email})));
 for(const action of ['update','cancel']){
  input={...input,action,revision:result.revision};plan=await previewMeeting(store,input,policy);
  result=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 }
 assert.equal(result.org.initialMeetingSync,null);
 assert.equal(calls.filter(c=>c.path==='/v2/users/me/meetings'&&c.method==='POST').length,1);
 assert.ok(calls.filter(c=>c.path.includes('/events/')&&['PATCH','DELETE'].includes(c.method)).every(c=>c.query==='?sendUpdates=all'));
});
test('所有者不一致・権限不足・確認改ざんは作成前に停止',async t=>{
 const {store,calls,revision,setWrong}=await setup(t);
 const input={orgId:'example',kind:'initial',action:'prepare',revision};
 setWrong(true);await assert.rejects(previewMeeting(store,input,policy),/一致/);
 setWrong(false);await assert.rejects(confirmMeeting(store,{...input,confirmation:'tampered'},policy),/確認画面/);
 await store.put('googlecalendar-private',{scope:'https://www.googleapis.com/auth/calendar.events',encrypted:encrypt({refresh:'test'})});
 await assert.rejects(previewMeeting(store,input,policy),/追加承認/);
 assert.equal(calls.filter(c=>c.method==='POST'&&c.path.includes('meetings')).length,0);
});
test('Calendar失敗後もZoom IDを保持し、再確認してCalendarだけ復旧',async t=>{
 const {store,calls,revision,setFail}=await setup(t);
 let input={orgId:'example',kind:'initial',action:'prepare',revision};
 let plan=await previewMeeting(store,input,policy),r=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 setFail(true);input={...input,action:'create',revision:r.revision};plan=await previewMeeting(store,input,policy);r=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 assert.equal(r.org.initialMeetingSync.status,'error');assert.equal(r.org.initialMeetingSync.zoomMeetingId,'123');
 setFail(false);input={...input,revision:r.revision};plan=await previewMeeting(store,input,policy);r=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 assert.equal(r.org.initialMeetingSync.status,'synced');assert.equal(calls.filter(c=>c.path==='/v2/users/me/meetings'&&c.method==='POST').length,1);
});
