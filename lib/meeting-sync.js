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
// 外部APIの呼び出し成功後に行う最終保存専用。CAS競合（他の端末が無関係な箇所を含めワークスペースの
// どこかを編集し、revisionが進んでいた場合）は、同じ古いrevisionへ再試行しても必ずまた失敗する。
// 最新revisionを読み直して1回だけ再試行することで、外部作成済みのリソース（Zoom会議・カレンダー予定）の
// IDを保存し損ね、status:'creating'のまま永久に固着する（以後の同期・取消が全てブロックされる）事態を防ぐ
// （Codex独立レビュー指摘）。
// guardInputが指定されている場合、再試行の直前に「今回の外部呼び出しで実際に使ったMTG入力値」と
// 「最新のワークスペースにある現在の値」を比較する。もし他の端末がこの団体のMTG日時などを編集していたら、
// 古い入力値に対する成功結果（status:'synced'等）をそのまま保存してはいけない——Zoom/カレンダーには
// 古い日時のまま登録されているのに「同期済み」と誤って表示してしまう（Codex独立レビュー指摘）。
// その場合は保存せずに、入力が変わったことを示す専用のエラーで中止する。
async function saveSyncReconciled(store,orgId,revision,mutate,guardInput){
 try{return await updateOrg(store,orgId,revision,mutate);}
 catch(e){
  if(!e.conflict)throw e;
  const {data,revision:liveRevision}=await loadWorkspace(store);
  if(guardInput){
   const liveOrg=data.orgSales.find(o=>o.id===orgId);
   if(!liveOrg||!guardInput(liveOrg))
    throw Object.assign(Error('他の端末がこのMTGの日時・内容を変更したため、今回の同期結果は保存しませんでした。最新の内容で同期をやり直してください。'),{conflict:true,inputChanged:true});
  }
  return await updateOrg(store,orgId,liveRevision,mutate);
 }
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
  // 同じ会議に対する同時操作（例: 日程変更）が、互いの削除/更新の結果を踏まえずに両方とも外部呼び出しを
  // 成功させてしまうと、保存の先着順によって「取消したのに同期済みと表示される」ような不整合が起きる。
  // 削除呼び出しの前にCASで予約し、先に予約した側だけが外部呼び出しへ進めるようにする（Codex独立レビュー指摘）。
  const reserved=await updateOrg(store,orgId,revision,o=>({...o,[f.sync]:{...existing,status:'creating',error:null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
  revision=reserved.revision;
  const warnings=[];
  let zoomId=existing.zoomMeetingId,calendarId=existing.calendarEventId;
  if(zoomId)try{await zoom.deleteMeeting(store,zoomId);zoomId=null;}catch(e){warnings.push('Zoom会議の取消に失敗しました: '+e.message);}
  if(calendarId)try{await googlecalendar.deleteEvent(store,calendarId);calendarId=null;}catch(e){warnings.push('Googleカレンダー予定の取消に失敗しました: '+e.message);}
  // On partial API failure preserve IDs, so the next cancellation can retry only the remaining action.
  const pending=warnings.length>0;
  const result=await saveSyncReconciled(store,orgId,revision,o=>({...o,
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
 // 既にsynced（両方成功済み）でcreateが呼ばれた場合は何もしない：二重会議作成の防止。
 if(action==='create'&&existing?.status==='synced')return {org,revision,warnings:[]};

 // Zoom会議が既に存在する場合（日程変更の同期、またはGoogleカレンダー側だけ欠けている状態からの復旧）。
 if(existing?.zoomMeetingId)
  return syncCalendarAndZoom(store,orgId,revision,existing,f,topic,description,startIso,endIso,org[f.url]||'',{at:org[f.at],name:org.name,url:org[f.url]||''});

 // ここから新規作成（まだZoom会議が存在しない場合のみ）。
 // Reserve a CAS revision before the first external call. Two simultaneous clicks on
 // the same workspace revision must not create two Zoom meetings.
 const reserved=await updateOrg(store,orgId,revision,o=>({...o,[f.sync]:{
  requestId:existing?.requestId||randomUUID(),zoomMeetingId:null,calendarEventId:null,
  status:'creating',error:null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
 revision=reserved.revision;
 let created;
 try{created=await zoom.createMeeting(store,{topic,startIso,durationMin:DURATION_MIN});}
 catch(e){
  await saveSyncReconciled(store,orgId,revision,o=>({...o,[f.sync]:{...o[f.sync],status:'error',error:'Zoom会議の作成に失敗しました: '+e.message,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
  throw e;
 }
 const meetingId=created.meetingId,joinUrl=created.joinUrl;
 // Record the Zoom ID before creating the calendar event. If the DB revision
 // unexpectedly changes, attempt to delete the orphaned Zoom meeting.
 let saved;
 try{saved=await saveSyncReconciled(store,orgId,revision,o=>({...o,[f.url]:joinUrl,[f.sync]:{
  ...o[f.sync],zoomMeetingId:meetingId,calendarEventId:null,status:'zoom_only',error:null,
  updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));}
 catch(e){try{await zoom.deleteMeeting(store,meetingId);}catch{}throw e;}
 return syncCalendarAndZoom(store,orgId,saved.revision,saved.org[f.sync],f,topic,description,startIso,endIso,joinUrl,{at:org[f.at],name:org.name,url:joinUrl});
}
// Zoom会議(zoomMeetingId)は既に存在する前提で、常にZoomへ現在のtopic/日時を反映し（PATCHは何度呼んでも安全）、
// カレンダー予定は存在すれば更新、存在しなければ作成する。Googleカレンダーの新規作成はCASで予約してから
// 外部呼び出しを行い、同時に再試行された2件が両方ともイベントを作成して片方が孤立するのを防ぐ
// （Codex独立レビュー指摘: 日程変更時にcalendarEventId欠落でZoom更新がスキップされ誤ってsyncedと記録される問題、
// および予約なしでのカレンダー作成が同時実行で重複・孤立イベントを生む問題への対応）。
async function syncCalendarAndZoom(store,orgId,revision,existing,f,topic,description,startIso,endIso,locationUrl,expected){
 // 日時だけでなく、topicに使う団体名・locationに使うURLも外部呼び出し時点の値と比較する。
 // 日時が同じでも団体名やURLが同時編集されていれば、Zoom/カレンダーには古い内容のまま登録されているため
 // 「同期済み」と誤って記録してはいけない（Codex独立レビュー指摘）。
 const guardInput=expected?(liveOrg=>liveOrg[f.at]===expected.at&&liveOrg.name===expected.name&&(liveOrg[f.url]||'')===expected.url):undefined;
 // 同じZoom会議・カレンダー予定に対する同時操作（例: 日程変更と取消）が、互いの外部呼び出しの結果を
 // 踏まえずに両方とも成功してしまうと、保存の先着順によって「取消済みなのに同期済みと表示される」
 // ような不整合が起きる。外部呼び出しの前にCASで予約し、先に予約した側だけが進めるようにする
 // （Codex独立レビュー指摘: 従来は新規作成（Zoom作成・カレンダー新規作成）しか予約しておらず、
 // 既存の会議に対する更新は無防備だった）。
 const reserved=await updateOrg(store,orgId,revision,o=>({...o,[f.sync]:{...existing,status:'creating',error:null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
 revision=reserved.revision;
 const warnings=[];let status='synced';
 try{await zoom.updateMeeting(store,existing.zoomMeetingId,{topic,startIso,durationMin:DURATION_MIN});}
 catch(e){warnings.push('Zoom会議の更新に失敗しました: '+e.message);status='error';}
 if(existing.calendarEventId){
  try{await googlecalendar.updateEvent(store,existing.calendarEventId,{summary:topic,description,location:locationUrl,startIso,endIso});}
  catch(e){warnings.push('Googleカレンダー予定の更新に失敗しました: '+e.message);status='error';}
  try{
   const result=await saveSyncReconciled(store,orgId,revision,o=>({...o,[f.sync]:{...existing,status,error:warnings.join(' / ')||null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}),guardInput);
   return {...result,warnings};
  }catch(e){
   // guardInputの不一致（他端末が同時にMTG日時を変更）等でこの保存が失敗した場合でも、既存のZoom/カレンダーの
   // IDは保持したまま「creating」の固着ロックだけは解除する。解除に失敗しても元の例外は呼び出し元へ伝える
   // （Codex独立レビュー指摘：ロック解除なしでは以後のcreate/update/cancelが全てブロックされる）。
   try{await saveSyncReconciled(store,orgId,revision,o=>({...o,[f.sync]:{...existing,status:'error',error:e.message,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));}catch{}
   throw e;
  }
 }
 let event;
 try{
  event=await googlecalendar.createEvent(store,{summary:topic,description,location:locationUrl,startIso,endIso,attendees:[]});
  const result=await saveSyncReconciled(store,orgId,revision,o=>({...o,[f.sync]:{...existing,calendarEventId:event.eventId,status:warnings.length?'error':'synced',error:warnings.join(' / ')||null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}),guardInput);
  return {...result,warnings};
 }catch(e){
  // eventが作成済み（カレンダー登録自体は成功）なのに保存だけ失敗した場合（他端末によるguardInput不一致を含む）は、
  // 新規作成されたcalendarEventIdを失うと再試行で重複作成・孤立イベントになる（Codex独立レビュー指摘）。
  // そのIDを保持したまま「creating」ロックを解除する。
  const allWarnings=event
   ?[...warnings,'他の端末がこのMTGの日時・内容を変更したため、作成済みのカレンダー予定を同期済みとして保存できませんでした: '+e.message]
   :[...warnings,'Googleカレンダーへの登録に失敗しました（Zoom会議は作成済みです）: '+e.message];
  const result=await saveSyncReconciled(store,orgId,revision,o=>({...o,[f.sync]:{...existing,calendarEventId:event?event.eventId:existing.calendarEventId,status:'error',error:allWarnings.join(' / '),updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
  return {...result,warnings:allWarnings,partial:true};
 }
}
