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
 await store.put('zoom-private',{scopes:['meeting:read:meeting'],userId:'host-id',email:'zoom@example.com',encrypted:encrypt({refresh:'test'})});
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
  if(method==='GET'&&u.pathname==='/v2/meetings/123')return Response.json({id:123,host_id:'host-id',start_url:'PRIVATE-START-URL'});
  if(method==='GET'&&u.pathname.endsWith('/events/event123'))return Response.json({id:'event123',organizer:{email:policy.organizer}});
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
 assert.equal(plan.summary,'[SSM-NOTTA-7C4F2A] Example Club｜商品説明');assert.equal(plan.zoomHost,'zoom@example.com');assert.equal(plan.calendarId,policy.organizer);assert.equal(plan.zoomUrl,null);
 let result=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 assert.equal(result.org.initialMeetingSync.status,'zoom_only');assert.equal(result.org.initialMeetingSync.nottaRouting,'calendar-title-v1');
 assert.equal(calls.filter(c=>c.path.endsWith('/events')&&c.method==='POST').length,0);
 await assert.rejects(confirmMeeting(store,{...input,confirmation:plan.confirmation},policy),/再読み込み/);
 input={...input,action:'create',revision:result.revision};plan=await previewMeeting(store,input,policy);
 assert.equal(plan.zoomUrl,'https://zoom.us/j/123');
 result=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 assert.equal(result.org.initialMeetingSync.status,'synced');
 const event=calls.find(c=>c.path.endsWith('/events')&&c.method==='POST');
 assert.match(JSON.parse(event.body).summary,/^\[SSM-NOTTA-7C4F2A\]/);assert.match(JSON.parse(event.body).description,/同意を確認/);
 assert.match(event.path,/organizer@example.com/);assert.equal(event.query,'?sendUpdates=all');
 assert.deepEqual(JSON.parse(event.body).attendees,policy.guests.map(email=>({email})));
 for(const action of ['update','cancel']){
  input={...input,action,revision:result.revision};plan=await previewMeeting(store,input,policy);
  result=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
  if(action==='update')assert.equal(result.org.initialMeetingSync.nottaRouting,'calendar-title-v1');
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

test('削除済み団体を記録保持で復元した後、元の会議IDを確認して取消できる',async t=>{
 const {store,calls,revision}=await setup(t);
 let input={orgId:'example',kind:'initial',action:'prepare',revision};
 const plan=await previewMeeting(store,input,policy);
 const created=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 const data=JSON.parse((await store.doc('workspace')).body);
 data.orgSales[0].deletedAt='2026-10-23T00:00:00Z';
 const [deleted]=await store.put('workspace',data);input={...input,action:'cancel',revision:deleted.revision};
 await assert.rejects(previewMeeting(store,input,policy),/対象の団体/);
 const before=calls.length;const restored=structuredClone(data);restored.orgSales[0].deletedAt=null;
 const {assertMeetingRecordsRetained}=await import('../public/org-meeting-lifecycle.js');
 assertMeetingRecordsRetained(data,restored);
 const [row]=await store.put('workspace',restored);assert.equal(calls.length,before);
 input={...input,revision:row.revision};const approval=await previewMeeting(store,input,policy);
 const result=await confirmMeeting(store,{...input,confirmation:approval.confirmation},policy);
 assert.equal(result.org.initialMeetingSync,null);
 assert.equal(calls.filter(c=>c.method==='DELETE'&&c.path==='/v2/meetings/'+created.org.initialMeetingSync.zoomMeetingId).length,1);
});


test('片側だけ残る取消は対象サービスだけ認可確認し、切断済み側へ接続しない',async t=>{
 const {store,calls,revision}=await setup(t);
 let input={orgId:'example',kind:'initial',action:'prepare',revision};
 let plan=await previewMeeting(store,input,policy);
 const created=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 await store.query('DELETE FROM ss_documents WHERE name=$1',['googlecalendar-private']);
 const start=calls.length;input={...input,action:'cancel',revision:created.revision};
 plan=await previewMeeting(store,input,policy);
 const canceled=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 assert.equal(canceled.org.initialMeetingSync,null);
 assert.equal(calls.slice(start).some(c=>c.path.startsWith('/calendar/')),false);
 // Partial cancellation: Zoom is already removed, only the calendar event remains.
 const data=JSON.parse((await store.doc('workspace')).body);
 data.orgSales[0].initialMeetingSync={...created.org.initialMeetingSync,zoomMeetingId:null,calendarEventId:'remaining',calendarId:policy.organizer,cancelPending:true,status:'error'};
 const [row]=await store.put('workspace',data);
 await store.query('DELETE FROM ss_documents WHERE name=$1',['zoom-private']);
 await store.put('googlecalendar-private',{scope:identityScope,encrypted:encrypt({refresh:'test'})});
 const secondStart=calls.length;input={...input,revision:row.revision};plan=await previewMeeting(store,input,policy);
 const done=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 assert.equal(done.org.initialMeetingSync,null);
 assert.equal(calls.slice(secondStart).some(c=>c.path.startsWith('/v2/')),false);
 assert.equal(calls.slice(secondStart).filter(c=>c.method==='DELETE'&&c.path.endsWith('/events/remaining')).length,1);
});

test('指定所要時間を保存・再読込し、確認画面とZoom/Calendar作成・更新で一致させる',async t=>{
 const {store,calls}=await setup(t);
 const data=JSON.parse((await store.doc('workspace')).body);
 data.orgSales[0].initialMeetingDurationMin=75;
 const [row]=await store.put('workspace',validate(data));
 let input={orgId:'example',kind:'initial',action:'prepare',revision:row.revision};
 let plan=await previewMeeting(store,input,policy);assert.equal(plan.duration,75);
 let result=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 assert.equal(JSON.parse(calls.find(c=>c.path==='/v2/users/me/meetings').body).duration,75);
 input={...input,action:'create',revision:result.revision};plan=await previewMeeting(store,input,policy);
 result=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 const event=JSON.parse(calls.find(c=>c.path.endsWith('/events')&&c.method==='POST').body);
 assert.equal(Date.parse(event.end.dateTime)-Date.parse(event.start.dateTime),75*60000);
 assert.equal(event.location,'https://zoom.us/j/123');
 const changed=JSON.parse((await store.doc('workspace')).body);changed.orgSales[0].initialMeetingDurationMin=30;
 const [updated]=await store.put('workspace',validate(changed));
 input={...input,action:'update',revision:updated.revision};plan=await previewMeeting(store,input,policy);assert.equal(plan.duration,30);
 result=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 const patches=calls.filter(c=>c.method==='PATCH');
 assert.equal(JSON.parse(patches.filter(c=>c.path.startsWith('/v2/')).at(-1).body).duration,30);
 const change=JSON.parse(patches.filter(c=>c.path.includes('/events/')).at(-1).body);
 assert.equal(Date.parse(change.end.dateTime)-Date.parse(change.start.dateTime),30*60000);
 assert.equal(result.org.initialMeetingSync.status,'synced');
});

test('所要時間の既定値・境界値と不正値を検証し既存履歴を保持する',async t=>{
 const {store,revision}=await setup(t);
 const data=JSON.parse((await store.doc('workspace')).body);
 assert.equal((await previewMeeting(store,{orgId:'example',kind:'initial',action:'prepare',revision},policy)).duration,45);
 for(const kind of ['initial','proposal']){
  for(const value of [1,1440]){const d=structuredClone(data);d.orgSales[0][kind+'MeetingDurationMin']=value;assert.deepEqual(validate(d),d);}
  for(const value of [0,-1,1441,1.5,'30',null,NaN,Infinity]){const d=structuredClone(data);d.orgSales[0][kind+'MeetingDurationMin']=value;assert.throws(()=>validate(d),/形式/);}
 }
});

test('同期中の所要時間変更は成功扱いせず、既存IDと最新入力を保持して復旧する',async t=>{
 const {store,calls,revision}=await setup(t);
 let input={orgId:'example',kind:'initial',action:'prepare',revision};
 let plan=await previewMeeting(store,input,policy);let result=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 const mock=global.fetch;let changed=false;
 global.fetch=async(url,opts={})=>{
  if(opts.method==='PATCH'&&!changed){changed=true;const d=JSON.parse((await store.doc('workspace')).body);d.orgSales[0].initialMeetingDurationMin=60;await store.put('workspace',validate(d));}
  return mock(url,opts);
 };
 input={...input,action:'create',revision:result.revision};plan=await previewMeeting(store,input,policy);
 result=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 assert.equal(result.partial,true);assert.match(result.warnings.join(' / '),/変更/);
 const saved=JSON.parse((await store.doc('workspace')).body).orgSales[0];
 assert.equal(saved.initialMeetingDurationMin,60);assert.equal(saved.initialMeetingSync.status,'error');assert.ok(saved.initialMeetingSync.calendarEventId);assert.ok(saved.initialMeetingSync.zoomMeetingId);
 const row=await store.doc('workspace');input={...input,revision:row.revision};plan=await previewMeeting(store,input,policy);
 result=await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 assert.equal(result.org.initialMeetingSync.status,'synced');
 assert.equal(calls.filter(c=>c.path.endsWith('/events')&&c.method==='POST').length,1);
 assert.equal(calls.filter(c=>c.path==='/v2/users/me/meetings'&&c.method==='POST').length,1);
});

test('既存会議の更新はNottaタグへ自動移行しない',async t=>{
 const {store,calls,revision}=await setup(t);
 let input={orgId:'example',kind:'initial',action:'prepare',revision};
 let plan=await previewMeeting(store,input,policy);await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 const data=JSON.parse((await store.doc('workspace')).body);delete data.orgSales[0].initialMeetingSync.nottaRouting;
 const [row]=await store.put('workspace',data);input={...input,action:'update',revision:row.revision};
 plan=await previewMeeting(store,input,policy);assert.equal(plan.nottaRouting,null);assert.equal(plan.summary,'Example Club｜商品説明');
 await confirmMeeting(store,{...input,confirmation:plan.confirmation},policy);
 const event=calls.find(c=>c.path.endsWith('/events')&&c.method==='POST');
 assert.equal(JSON.parse(event.body).summary,'Example Club｜商品説明');assert.doesNotMatch(JSON.parse(event.body).description,/Notta/);
});

async function abandoned(store,fields={}){
 const data=JSON.parse((await store.doc('workspace')).body);
 data.orgSales[0].initialZoomUrl='https://zoom.us/j/123';
 data.orgSales[0].initialMeetingSync={requestId:'old-request',zoomMeetingId:'123',calendarEventId:'event123',zoomHostId:'host-id',calendarId:policy.organizer,status:'creating',error:null,updatedAt:new Date(Date.now()-3600000).toISOString(),...fields};
 return (await store.put('workspace',data))[0].revision;
}
test('中断復旧は既存IDを読取照合して保持し、外部会議を変更せず要確認にする',async t=>{
 const {store,calls}=await setup(t),revision=await abandoned(store);
 const input={orgId:'example',kind:'initial',action:'recover',revision};
 const plan=await previewMeeting(store,input,policy);assert.match(plan.recoveryEvidence,/Zoom: 保存済みID.*Calendar: 保存済みID/);assert.equal(plan.requiresExternalCheck,true);
 await assert.rejects(confirmMeeting(store,{...input,confirmation:plan.confirmation},policy),/外部結果/);
 const result=await confirmMeeting(store,{...input,confirmation:plan.confirmation,externalResultsChecked:true},policy);
 assert.equal(result.org.initialMeetingSync.status,'uncertain');assert.equal(result.org.initialMeetingSync.zoomMeetingId,'123');assert.equal(result.org.initialMeetingSync.calendarEventId,'event123');assert.equal(result.org.initialZoomUrl,'https://zoom.us/j/123');
 assert.ok(calls.filter(c=>c.path.includes('/meetings/')||c.path.includes('/events/')).every(c=>c.method==='GET'));
 assert.doesNotMatch(JSON.stringify(plan)+JSON.stringify(result),/PRIVATE-START-URL/);
 const {syncMeeting}=await import('../lib/meeting-sync.js');
 await assert.rejects(syncMeeting(store,{...input,action:'create',revision:result.revision}),/結果が不明/);
 await assert.rejects(syncMeeting(store,{...input,action:'cancel',revision:result.revision}),/手動で確認/);
 const cancel={...input,action:'cancel',revision:result.revision},cancelPlan=await previewMeeting(store,cancel,policy);
 await assert.rejects(confirmMeeting(store,{...cancel,confirmation:cancelPlan.confirmation},policy),/外部結果/);
 const cancelled=await confirmMeeting(store,{...cancel,confirmation:cancelPlan.confirmation,externalResultsChecked:true},policy);
 assert.equal(cancelled.org.initialMeetingSync,null);
});
test('ID未保存・404・権限不足・所有者不一致は未作成と判断せず要確認で停止',async t=>{
 const {store}=await setup(t),original=global.fetch;
 for(const scenario of ['missing','404','403','wrong-host']){
  const revision=await abandoned(store,scenario==='missing'?{zoomMeetingId:null,calendarEventId:null}:{});
  global.fetch=async (url,options)=>{
   if(String(url).includes('/v2/meetings/')||String(url).includes('/events/'))return scenario==='wrong-host'?Response.json({id:123,host_id:'another-host'}):Response.json({error:{code:Number(scenario)}},{status:Number(scenario)});
   return original(url,options);
  };
  const input={orgId:'example',kind:'initial',action:'recover',revision},plan=await previewMeeting(store,input,policy);
  assert.match(plan.recoveryEvidence,/結果不明|要確認/);
  const result=await confirmMeeting(store,{...input,confirmation:plan.confirmation,externalResultsChecked:true},policy);
  assert.equal(result.org.initialMeetingSync.status,'uncertain');
 }
});
test('新しい予約の復旧と同時更新後の古い確認は拒否する',async t=>{
 const {store,calls}=await setup(t);let revision=await abandoned(store,{updatedAt:new Date().toISOString()});
 let input={orgId:'example',kind:'initial',action:'recover',revision};
 await assert.rejects(previewMeeting(store,input,policy),/15分/);assert.equal(calls.length,0);
 revision=await abandoned(store);input={...input,revision};const plan=await previewMeeting(store,input,policy);
 await abandoned(store);
 await assert.rejects(confirmMeeting(store,{...input,confirmation:plan.confirmation,externalResultsChecked:true},policy),/再読み込み/);
});
test('遅れて返った作成結果は復旧後の状態を上書きせず代償削除もしない',async t=>{
 const {store,calls,revision}=await setup(t),original=global.fetch;
 const {syncMeeting}=await import('../lib/meeting-sync.js');
 global.fetch=async (url,options={})=>{
  if(new URL(url).pathname==='/v2/users/me/meetings'){
   const data=JSON.parse((await store.doc('workspace')).body);
   data.orgSales[0].initialMeetingSync.updatedAt=new Date(Date.now()-3600000).toISOString();
   const [r]=await store.put('workspace',data);
   await syncMeeting(store,{orgId:'example',kind:'initial',action:'recover',revision:r.revision,externalResultsChecked:true});
  }
  return original(url,options);
 };
 const input={orgId:'example',kind:'initial',action:'prepare',revision},plan=await previewMeeting(store,input,policy);
 await assert.rejects(confirmMeeting(store,{...input,confirmation:plan.confirmation},policy),/古い処理結果/);
 const current=JSON.parse((await store.doc('workspace')).body).orgSales[0];assert.equal(current.initialMeetingSync.status,'uncertain');assert.equal(current.initialMeetingSync.zoomMeetingId,null);
 assert.equal(calls.filter(c=>c.method==='DELETE').length,0);assert.equal(calls.filter(c=>c.path.endsWith('/events')&&c.method==='POST').length,0);
});

test('復旧後に古い更新処理が戻っても次のCalendar書込を開始しない',async t=>{
 const {store,calls}=await setup(t),original=global.fetch;
 const revision=await abandoned(store,{status:'synced',operationId:'previous'}),{syncMeeting}=await import('../lib/meeting-sync.js');
 global.fetch=async(url,options={})=>{
  if(new URL(url).pathname==='/v2/meetings/123'&&options.method==='PATCH'){
   const data=JSON.parse((await store.doc('workspace')).body);data.orgSales[0].initialMeetingSync.updatedAt=new Date(Date.now()-3600000).toISOString();
   const [r]=await store.put('workspace',data);
   await syncMeeting(store,{orgId:'example',kind:'initial',action:'recover',revision:r.revision,externalResultsChecked:true});
  }
  return original(url,options);
 };
 const input={orgId:'example',kind:'initial',action:'update',revision},plan=await previewMeeting(store,input,policy);
 await assert.rejects(confirmMeeting(store,{...input,confirmation:plan.confirmation},policy),/古い処理を続けません/);
 assert.equal(calls.filter(c=>c.path.includes('/events/')&&c.method==='PATCH').length,0);
 assert.equal(JSON.parse((await store.doc('workspace')).body).orgSales[0].initialMeetingSync.status,'uncertain');
});
test('復旧保存に失敗しても元のIDとロックは残り、読取復旧を再試行できる',async t=>{
 const {store}=await setup(t),revision=await abandoned(store),query=store.query;
 const input={orgId:'example',kind:'initial',action:'recover',revision},plan=await previewMeeting(store,input,policy);
 store.query=async(sql,args)=>{if(sql.startsWith('UPDATE ss_documents')&&args[1]==='workspace')throw Error('dummy storage failure');return query(sql,args);};
 await assert.rejects(confirmMeeting(store,{...input,confirmation:plan.confirmation,externalResultsChecked:true},policy),/storage failure/);
 assert.equal(JSON.parse((await store.doc('workspace')).body).orgSales[0].initialMeetingSync.status,'creating');
 store.query=query;const result=await confirmMeeting(store,{...input,confirmation:plan.confirmation,externalResultsChecked:true},policy);
 assert.equal(result.org.initialMeetingSync.status,'uncertain');assert.equal(result.org.initialMeetingSync.zoomMeetingId,'123');
});
