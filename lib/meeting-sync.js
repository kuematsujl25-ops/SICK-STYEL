import {randomUUID} from 'node:crypto';
import {empty,validate,migrate} from './domain.js';
import * as zoom from '../integrations/zoom.js';
import * as googlecalendar from '../integrations/googlecalendar.js';
// 団体営業のMTG（初回ZOOM・活用法提案ZOOM）をZoom会議の自動発行とGoogleカレンダー予定の自動登録で同期する。
// 同一団体+種別で二重に会議を発行しない（既存のzoomMeetingIdがあれば再利用し、カレンダー側だけ再試行する）。
export const KINDS=['initial','proposal'];
const fieldOf=kind=>kind==='initial'?{at:'initialZoomAt',url:'initialZoomUrl',sync:'initialMeetingSync',label:'初回ZOOM'}:{at:'proposalZoomAt',url:'proposalZoomUrl',sync:'proposalMeetingSync',label:'活用法提案ZOOM'};
const DURATION_MIN=45;
const toUtcIso=at=>{const d=new Date(at+':00+09:00');if(Number.isNaN(d.getTime()))throw Error('MTG日時が正しくありません');return d.toISOString();};
const addMinutes=(iso,min)=>new Date(new Date(iso).getTime()+min*60000).toISOString();

async function loadWorkspace(store){const r=await store.doc('workspace');return {data:migrate(r?JSON.parse(r.body):empty()),revision:r?.revision||0};}
// 指定revisionと一致する場合だけ1団体を更新する（楽観ロック）。他端末の同時更新と競合すれば例外を投げる。
async function updateOrg(store,orgId,expectedRevision,mutate){
 const {data,revision}=await loadWorkspace(store);
 if(revision!==expectedRevision)throw Object.assign(Error('他の端末で更新されました。再読み込みしてから再試行してください'),{conflict:true});
 const idx=data.orgSales.findIndex(o=>o.id===orgId);if(idx<0)throw Error('対象の団体が見つかりません');
 const nextOrg=mutate(data.orgSales[idx]);
 const nextData=validate({...data,orgSales:data.orgSales.map((o,i)=>i===idx?nextOrg:o)});
 const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(nextData),'workspace',expectedRevision]);
 if(!rows.length)throw Object.assign(Error('他の端末で更新されました。再読み込みしてから再試行してください'),{conflict:true});
 return {org:nextOrg,revision:rows[0].revision};
}

export async function status(store){return {zoom:await zoom.safeStatus(store),googleCalendar:await googlecalendar.safeStatus(store)};}

// action: 'create'（新規作成・冪等な再試行）/ 'update'（日程変更の同期）/ 'cancel'（取消の同期）
export async function syncMeeting(store,{orgId,kind,action,revision}){
 if(!KINDS.includes(kind))throw Error('MTG種別はinitialまたはproposalのみです');
 if(!['create','update','cancel'].includes(action))throw Error('操作はcreate/update/cancelのみです');
 if(!Number.isSafeInteger(revision)||revision<0)throw Error('更新バージョンが必要です');
 const f=fieldOf(kind);
 const {data,revision:liveRevision}=await loadWorkspace(store);
 if(liveRevision!==revision)throw Object.assign(Error('他の端末で更新されました。再読み込みしてから再試行してください'),{conflict:true});
 const org=data.orgSales.find(o=>o.id===orgId);if(!org)throw Error('対象の団体が見つかりません');
 const existing=org[f.sync]||null;
 if(existing?.status==='creating')throw Error('会議を作成処理中です。完了まで再操作しないでください。処理が停止した場合は管理者がZoom側の作成状況を確認してください');
 if(existing?.cancelPending&&action!=='cancel')throw Error('前回のMTG取消が未完了です。取消を再試行してください');

 if(action==='cancel'){
  if(!existing||existing.status==='none')return {org,revision,warnings:[]};
  const warnings=[];
  let zoomId=existing.zoomMeetingId,calendarId=existing.calendarEventId;
  if(zoomId)try{await zoom.deleteMeeting(store,zoomId);zoomId=null;}catch(e){warnings.push('Zoom会議の取消に失敗しました: '+e.message);}
  if(calendarId)try{await googlecalendar.deleteEvent(store,calendarId);calendarId=null;}catch(e){warnings.push('Googleカレンダー予定の取消に失敗しました: '+e.message);}
  // On partial API failure preserve IDs, so the next cancellation can retry only the remaining action.
  const pending=warnings.length>0;
  const result=await updateOrg(store,orgId,revision,o=>({...o,
   [f.url]:zoomId?o[f.url]:'',
   [f.sync]:pending?{...existing,zoomMeetingId:zoomId,calendarEventId:calendarId,
     cancelPending:true,status:'error',error:warnings.join(' / '),updatedAt:new Date().toISOString()}:null,
   updatedAt:new Date().toISOString()}));
  return {...result,warnings,partial:pending};
 }

 if(!org[f.at])throw Error(f.label+'の開始予定（日時）を先に保存してください');
 const startIso=toUtcIso(org[f.at]);const endIso=addMinutes(startIso,DURATION_MIN);
 const topic=`SICKSTYLE｜${f.label}｜${org.name}`;
 const description='SICKSTYLE 団体営業商談。本アプリの団体営業画面から自動作成されました。';

 if(action==='update'&&(!existing||!existing.zoomMeetingId))throw Error('まだMTGが作成されていません。先に作成してください');
 // A failed update can leave both external IDs intact. Retry must PATCH, never create a duplicate calendar event.
 if((action==='update'||(action==='create'&&existing?.calendarEventId))&&existing.zoomMeetingId&&existing.calendarEventId){
  const warnings=[];let status='synced';
  try{await zoom.updateMeeting(store,existing.zoomMeetingId,{topic,startIso,durationMin:DURATION_MIN});}catch(e){warnings.push('Zoom会議の更新に失敗しました: '+e.message);status='error';}
  try{await googlecalendar.updateEvent(store,existing.calendarEventId,{summary:topic,description,location:org[f.url]||'',startIso,endIso});}catch(e){warnings.push('Googleカレンダー予定の更新に失敗しました: '+e.message);status='error';}
  const result=await updateOrg(store,orgId,revision,o=>({...o,[f.sync]:{...existing,status,error:warnings.join(' / ')||null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
  return {...result,warnings};
 }

 // 既にsynced（両方成功済み）なら何もしない：二重会議作成の防止。
 if(existing?.status==='synced')return {org,revision,warnings:[]};

 let meetingId=existing?.zoomMeetingId||null,joinUrl=org[f.url]||null;
 if(!meetingId){
  // Reserve a CAS revision before the first external call. Two simultaneous clicks on
  // the same workspace revision must not create two Zoom meetings.
  const reserved=await updateOrg(store,orgId,revision,o=>({...o,[f.sync]:{
   requestId:existing?.requestId||randomUUID(),zoomMeetingId:null,calendarEventId:null,
   status:'creating',error:null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
  revision=reserved.revision;
  let created;
  try{created=await zoom.createMeeting(store,{topic,startIso,durationMin:DURATION_MIN});}
  catch(e){
   await updateOrg(store,orgId,revision,o=>({...o,[f.sync]:{...o[f.sync],status:'error',error:'Zoom会議の作成に失敗しました: '+e.message,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
   throw e;
  }
  meetingId=created.meetingId;joinUrl=created.joinUrl;
  // Record the Zoom ID before creating the calendar event. If the DB revision
  // unexpectedly changes, attempt to delete the orphaned Zoom meeting.
  let saved;
  try{saved=await updateOrg(store,orgId,revision,o=>({...o,[f.url]:joinUrl,[f.sync]:{
   ...o[f.sync],zoomMeetingId:meetingId,calendarEventId:null,status:'zoom_only',error:null,
   updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));}
  catch(e){try{await zoom.deleteMeeting(store,meetingId);}catch{}throw e;}
  revision=saved.revision;
 }
 try{
  const event=await googlecalendar.createEvent(store,{summary:topic,description,location:joinUrl||'',startIso,endIso,attendees:[]});
  const result=await updateOrg(store,orgId,revision,o=>({...o,[f.sync]:{...o[f.sync],calendarEventId:event.eventId,status:'synced',error:null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
  return {...result,warnings:[]};
 }catch(e){
  const result=await updateOrg(store,orgId,revision,o=>({...o,[f.sync]:{...o[f.sync],status:'error',error:e.message,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
  return {...result,warnings:['Googleカレンダーへの登録に失敗しました（Zoom会議は作成済みです）: '+e.message],partial:true};
 }
}
