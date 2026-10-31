import {usesZoom,nottaMeetingPlan} from '../public/meeting-policy.js';
import {meetingDuration} from './meeting-duration.js';
import {randomUUID} from 'node:crypto';
import {empty,validate,migrate} from './domain.js';
import * as zoom from '../integrations/zoom.js';
import * as googlecalendar from '../integrations/googlecalendar.js';
// 団体営業のMTG（初回ZOOM・活用法提案ZOOM）をZoom会議の自動発行とGoogleカレンダー予定の自動登録で同期する。
// 同一団体+種別で二重に会議を発行しない（既存のzoomMeetingIdがあれば再利用し、カレンダー側だけ再試行する）。
export const KINDS=['initial','proposal'];
const fieldOf=kind=>kind==='initial'?{at:'initialZoomAt',url:'initialZoomUrl',sync:'initialMeetingSync',label:'初回ZOOM'}:{at:'proposalZoomAt',url:'proposalZoomUrl',sync:'proposalMeetingSync',label:'活用法提案ZOOM'};
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
async function saveSyncReconciled(store,orgId,revision,mutate,guardInput,operation){
 const originalMutate=mutate;
 mutate=o=>{
  if(operation&&o[operation.field]?.operationId!==operation.id)throw Object.assign(Error('会議の復旧または別操作が行われました。古い処理結果は保存しません'),{conflict:true,operationChanged:true});
  return originalMutate(o);
 };
 try{return await updateOrg(store,orgId,revision,mutate);}
 catch(e){
  if(!e.conflict||e.operationChanged)throw e;
  const {data,revision:liveRevision}=await loadWorkspace(store);
  if(guardInput){
   const liveOrg=data.orgSales.find(o=>o.id===orgId);
   if(!liveOrg||!guardInput(liveOrg))
    throw Object.assign(Error('他の端末がこのMTGの日時・内容を変更したため、今回の同期結果は保存しませんでした。最新の内容で同期をやり直してください。'),{conflict:true,inputChanged:true});
  }
  return await updateOrg(store,orgId,liveRevision,mutate);
 }
}

async function assertOperation(store,orgId,field,id){
 const {data}=await loadWorkspace(store);
 if(data.orgSales.find(o=>o.id===orgId)?.[field]?.operationId!==id)throw Object.assign(Error('会議の復旧または別操作が行われました。古い処理を続けません'),{conflict:true,operationChanged:true});
}

export async function status(store){return {zoom:await zoom.safeStatus(store),googleCalendar:await googlecalendar.safeStatus(store)};}

// action: 'create'（新規作成・冪等な再試行）/ 'update'（日程変更の同期）/ 'cancel'（取消の同期）
export async function syncMeeting(store,{orgId,kind,action,revision,meetingOptions=null,externalResultsChecked=false}){
 if(!KINDS.includes(kind))throw Error('MTG種別はinitialまたはproposalのみです');
 if(!['prepare','create','update','cancel','recover'].includes(action))throw Error('会議操作が不正です');
 if(!Number.isSafeInteger(revision)||revision<0)throw Error('更新バージョンが必要です');
 const f=fieldOf(kind);
 const {data,revision:liveRevision}=await loadWorkspace(store);
 if(liveRevision!==revision)throw Object.assign(Error('他の端末で更新されました。再読み込みしてから再試行してください'),{conflict:true});
 const org=data.orgSales.find(o=>o.id===orgId);if(!org)throw Error('対象の団体が見つかりません');
 if(action!=='cancel'&&!usesZoom(org,kind))throw Error('この会議種別ではZoomを作成・更新しません');
 const existing=org[f.sync]||null;
 if(action==='recover'){
  if(!existing||existing.status!=='creating')throw Error('復旧対象は処理中の会議だけです');
  if(!Number.isFinite(Date.parse(existing.updatedAt))||Date.now()-Date.parse(existing.updatedAt)<15*60000)throw Error('処理開始から15分以内は復旧できません');
  if(externalResultsChecked!==true)throw Error('元の操作が停止していることを確認してください');
  const evidence=await inspectRecovery(store,existing);
  const message='中断状態を要確認へ変更しました。'+evidence+'。ID未保存・削除済み・権限不足は未作成と断定できません。Zoomとカレンダーを手動確認し、結果不明の会議・予定を解決するまで再作成しないでください。';
  const result=await updateOrg(store,orgId,revision,o=>({...o,[f.sync]:{...existing,operationId:randomUUID(),status:'uncertain',error:message,updatedAt:new Date().toISOString()}}));
  return {...result,warnings:[message]};
 }
 if(action==='cancel'&&existing?.status==='uncertain'&&externalResultsChecked!==true)throw Error('結果不明のZoom・カレンダーを手動で確認してから取消してください');
 let operationId;
 const save=(targetStore,targetId,targetRevision,mutate,guardInput)=>saveSyncReconciled(targetStore,targetId,targetRevision,mutate,guardInput,{field:f.sync,id:operationId});
 if(existing?.status==='creating')throw Error('会議を作成処理中です。完了まで再操作しないでください。処理が停止した場合は管理者がZoom側の作成状況を確認してください');
 if(existing?.cancelPending&&action!=='cancel')throw Error('前回のMTG取消が未完了です。取消を再試行してください');
 // uncertain（前回の作成がタイムアウト等で結果不明）のまま'create'/'update'を認めると、Zoom/Googleが
 // 実際には作成済みの可能性があるリソースに対してもう一度作成を試み、重複作成になりうる。
 // public/org-sales.jsは既にこの状態で「再試行する」ボタンを表示しないが、それはUI側の抑制でしか
 // なく、APIを直接呼べば回避できてしまう（Codex独立レビュー指摘）。サーバー側でも同じ制約を課し、
 // 管理者が確認した上で「MTGを取消」を選ぶまでcreate/updateを拒否する。
 if(existing?.status==='uncertain'&&action!=='cancel')throw Error('前回の作成結果が不明です（Zoom/Googleへの通信がタイムアウト、またはサーバーエラーとなり、実際に作成されたか確認できていません）。Zoom・Googleカレンダーを確認のうえ、「MTGを取消」でこの記録をクリアしてから操作してください');

 if(action==='cancel'){
  if(!existing||existing.status==='none')return {org,revision,warnings:[]};
  // 同じ会議に対する同時操作（例: 日程変更）が、互いの削除/更新の結果を踏まえずに両方とも外部呼び出しを
  // 成功させてしまうと、保存の先着順によって「取消したのに同期済みと表示される」ような不整合が起きる。
  // 削除呼び出しの前にCASで予約し、先に予約した側だけが外部呼び出しへ進めるようにする（Codex独立レビュー指摘）。
  const reserved=await updateOrg(store,orgId,revision,o=>({...o,[f.sync]:{...existing,operationId:randomUUID(),status:'creating',error:null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
  operationId=reserved.org[f.sync].operationId;
  revision=reserved.revision;
  const warnings=[];
  let zoomId=existing.zoomMeetingId,calendarId=existing.calendarEventId;
  if(zoomId)try{await assertOperation(store,orgId,f.sync,operationId);await zoom.deleteMeeting(store,zoomId);zoomId=null;}catch(e){if(e.operationChanged)throw e;warnings.push('Zoom会議の取消に失敗しました: '+e.message);}
  if(calendarId)try{await assertOperation(store,orgId,f.sync,operationId);await googlecalendar.deleteEvent(store,calendarId,existing.calendarId||'primary');calendarId=null;}catch(e){if(e.operationChanged)throw e;warnings.push('Googleカレンダー予定の取消に失敗しました: '+e.message);}
  // On partial API failure preserve IDs, so the next cancellation can retry only the remaining action.
  const pending=warnings.length>0;
  // 取消が完全に成功した場合（pendingでない場合）は開始予定の日時も消す。日時を残したままだと、
  // (1) lib/notifications.jsの朝9時通知が「取消済みのMTGを今日の予定」として表示してしまい、
  // (2) 団体営業エディタの入力欄に取消済みの古い日時が残ったまま「MTGを作成」ボタンを押すと、
  // 同じ（既に過ぎた）日時で会議を再作成してしまう（Codex独立レビュー指摘）。取消が未完了
  // （pending）の間は、再試行に日時は使わないため消さずに残す。
  const mutate=o=>({...o,
   [f.url]:zoomId?o[f.url]:'',
   [f.at]:pending?o[f.at]:'',
   [f.sync]:pending?{...existing,operationId,zoomMeetingId:zoomId,calendarEventId:calendarId,
     cancelPending:true,status:'error',error:warnings.join(' / '),updatedAt:new Date().toISOString()}:null,
   updatedAt:new Date().toISOString()});
  let result;
  try{result=await save(store,orgId,revision,mutate);}
  catch(e){
   // この保存自体が失敗すると、予約時に書き込んだstatus:'creating'がそのまま残り、Zoom/カレンダーは
   // 削除済み（または削除試行済み）にもかかわらず、以後のcreate/update/cancelが永久にブロックされて
   // 固着する（Codex独立レビュー指摘）。同じ保存内容（取消済みのID・警告を正しく反映したmutate）で
   // もう一度保存を試みる。失敗しても無害（best-effort）：元の例外は呼び出し元へそのまま伝える。
   try{await save(store,orgId,revision,mutate);}catch{}
   throw e;
  }
  return {...result,warnings,partial:pending};
 }

 if(!org[f.at])throw Error(f.label+'の開始予定（日時）を先に保存してください');
 const durationMin=meetingDuration(org,kind);
 const startIso=toUtcIso(org[f.at]);const endIso=addMinutes(startIso,durationMin);
 const {summary:topic,description,nottaRouting}=nottaMeetingPlan(org,kind);

 if(action==='update'&&(!existing||!existing.zoomMeetingId))throw Error('まだMTGが作成されていません。先に作成してください');
 // 既にsynced（両方成功済み）でcreateが呼ばれた場合は何もしない：二重会議作成の防止。
 if(action==='create'&&existing?.status==='synced')return {org,revision,warnings:[]};

 // Zoom会議が既に存在する場合（日程変更の同期、またはGoogleカレンダー側だけ欠けている状態からの復旧）。
 if(action==='prepare'&&existing?.zoomMeetingId)return {org,revision,warnings:[]};
 if(existing?.zoomMeetingId)
  return syncCalendarAndZoom(store,orgId,revision,existing,f,topic,description,startIso,endIso,org[f.url]||'',{at:org[f.at],name:org.name,url:org[f.url]||'',content:org[kind+'MeetingContent'],contentField:kind+'MeetingContent',kind,durationMin},meetingOptions);

 // ここから新規作成（まだZoom会議が存在しない場合のみ）。
 // Reserve a CAS revision before the first external call. Two simultaneous clicks on
 // the same workspace revision must not create two Zoom meetings.
 const reserved=await updateOrg(store,orgId,revision,o=>({...o,[f.sync]:{
  ...(nottaRouting?{nottaRouting}:{}),...(meetingOptions?{calendarId:meetingOptions.calendarId,zoomHostId:meetingOptions.zoomHostId,attendees:meetingOptions.attendees}:{}),requestId:existing?.requestId||randomUUID(),zoomMeetingId:null,calendarEventId:null,
  operationId:randomUUID(),status:'creating',error:null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
 operationId=reserved.org[f.sync].operationId;
 revision=reserved.revision;
 let created;
 try{created=await zoom.createMeeting(store,{topic,startIso,durationMin});}
 catch(e){
  // e.code==='network_error'は、integrations/zoom.jsのremote()がfetch自体の失敗（通信断・12秒タイムアウト）を
  // まとめて表す識別子で、「リクエストがZoomへ届く前に失敗した」のか「Zoomは会議を作成したが応答が
  // 届かなかった」のかを区別できない。後者だった場合、これをいつもの「失敗・再試行可能」として扱うと、
  // 再試行でZoom側に重複した会議が作成され、元の（追跡できない）会議は取消もできなくなる（Codex独立
  // レビュー指摘）。確定した失敗（Zoomからエラー応答が返り、作成されていないことが確実な場合）とは別の
  // 「不明」状態として記録し、管理者がZoom管理画面で確認してから対処できるようにする（通常の再試行ボタンは
  // 表示しない：public/org-sales.jsのSYNC_LABEL/ボタン表示ロジック）。
  // network_error: fetch自体の失敗（通信断・タイムアウト）。response_body_unreadable: HTTP応答は成功した
  // のに本文の読み取りだけ失敗した場合（integrations/zoom.jsのcreateMeeting()参照）。どちらも「Zoomが
  // 実際に会議を作成したかどうか不明」という同じ意味であり、確定失敗と区別する（Codex独立レビュー指摘）。
  // ただし、この2つのコードはトークン更新（token_refresh）など会議作成リクエストより前の段階でも
  // 発生する。その場合はZoomへ会議作成リクエスト自体が送られていないため曖昧さは無く、確定失敗として
  // 扱わないと、不要に「要確認」状態に固着し、日時入力まで消える取消を強制してしまう（Codex独立
  // レビュー指摘）。会議作成リクエスト自体の段階（create_meeting）での失敗だけをuncertainとする。
  const uncertain=(e.code==='network_error'||e.code==='response_body_unreadable'||(e.httpStatus>=500&&e.httpStatus<=599))&&e.stage==='create_meeting';
  const mutate=o=>({...o,[f.sync]:{...o[f.sync],status:uncertain?'uncertain':'error',
   error:uncertain
    ?'Zoomへの通信がタイムアウト、またはサーバーエラーとなり、会議が実際に作成されたか不明です。Zoom管理画面（marketplace/会議一覧）で同名の会議が作成されていないか確認してください。作成されていなければ「MTGを取消」でこの記録をクリアしてから作成し直してください。作成されていた場合は、その会議をZoom側で直接使うか手動で削除してください。'
    :'Zoom会議の作成に失敗しました: '+e.message,
   updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()});
  try{await save(store,orgId,revision,mutate);}
  catch{
   // この保存自体が失敗すると、予約時のstatus:'creating'がそのまま残り、以後のcreate/update/cancelが
   // 永久にブロックされて固着する（Codex独立レビュー指摘と同じパターン）。もう一度だけ同じ内容で
   // 保存を試みる（失敗しても無害・best-effort）：元の例外(e)を優先して呼び出し元へ伝える。
   try{await save(store,orgId,revision,mutate);}catch{}
  }
  throw e;
 }
 const meetingId=created.meetingId,joinUrl=created.joinUrl;
 // Record the Zoom ID before creating the calendar event. If the DB revision
 // unexpectedly changes, attempt to delete the orphaned Zoom meeting.
 let saved;
 try{saved=await save(store,orgId,revision,o=>({...o,[f.url]:joinUrl,[f.sync]:{
  ...o[f.sync],zoomMeetingId:meetingId,calendarEventId:null,status:'zoom_only',error:null,
  updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));}
 catch(e){
  if(e.operationChanged)throw e;
  // 代償削除（zoom.deleteMeeting）自体が失敗した場合（Zoom側のタイムアウト等）、Zoom会議はまだ実在する。
  // これを無条件にzoomMeetingId:nullとして保存すると、会議IDを完全に失い、以後の「再試行する」が
  // 新しい会議を重複作成してしまう。削除が確認できた場合だけnullにし、確認できない場合はIDを保持した
  // まま（status:'zoom_only'と同じ形）次の操作が既存の会議を使って安全に再開できるようにする
  // （Codex独立レビュー指摘）。
  let deleted=false;
  try{await zoom.deleteMeeting(store,meetingId);deleted=true;}catch{}
  const mutate=deleted
   ?(o=>({...o,[f.sync]:{...o[f.sync],zoomMeetingId:null,calendarEventId:null,status:'error',error:e.message,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}))
   :(o=>({...o,[f.url]:joinUrl,[f.sync]:{...o[f.sync],zoomMeetingId:meetingId,calendarEventId:null,status:'zoom_only',
      error:'MTGの保存に失敗し、Zoom会議の削除（後始末）も失敗しました。Zoom側に会議が残っています。「再試行する」でカレンダー登録を続けるか、「MTGを取消」で削除を再試行してください: '+e.message,
      updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
  // この保存自体が失敗すると、予約時に書き込んだstatus:'creating'がそのまま残り、以後のcreate/update/cancel
  // が永久にブロックされて固着する（同じパターンの再発）。もう一度だけ同じ内容で保存を試みる
  // （失敗しても無害・best-effort）：元の例外は呼び出し元へ伝える。
  try{await save(store,orgId,revision,mutate);}
  catch{try{await save(store,orgId,revision,mutate);}catch{}}
  throw e;
 }
 if(saved.org[f.at]!==org[f.at]||saved.org.name!==org.name||saved.org[kind+'MeetingContent']!==org[kind+'MeetingContent']||meetingDuration(saved.org,kind)!==durationMin)throw Object.assign(Error('他の端末がMTGの日時・内容を変更しました。作成済み会議を保持しているため、最新の内容で再試行してください。'),{conflict:true,inputChanged:true});
 if(action==='prepare')return {...saved,warnings:[]};
 return syncCalendarAndZoom(store,orgId,saved.revision,saved.org[f.sync],f,topic,description,startIso,endIso,joinUrl,{at:org[f.at],name:org.name,url:joinUrl,content:org[kind+'MeetingContent'],contentField:kind+'MeetingContent',kind,durationMin},meetingOptions);
}
// Zoom会議(zoomMeetingId)は既に存在する前提で、常にZoomへ現在のtopic/日時を反映し（PATCHは何度呼んでも安全）、
// カレンダー予定は存在すれば更新、存在しなければ作成する。Googleカレンダーの新規作成はCASで予約してから
// 外部呼び出しを行い、同時に再試行された2件が両方ともイベントを作成して片方が孤立するのを防ぐ
// （Codex独立レビュー指摘: 日程変更時にcalendarEventId欠落でZoom更新がスキップされ誤ってsyncedと記録される問題、
// および予約なしでのカレンダー作成が同時実行で重複・孤立イベントを生む問題への対応）。
async function syncCalendarAndZoom(store,orgId,revision,existing,f,topic,description,startIso,endIso,locationUrl,expected,meetingOptions){
 let operationId;
 const save=(targetStore,targetId,targetRevision,mutate,guardInput)=>saveSyncReconciled(targetStore,targetId,targetRevision,mutate,guardInput,{field:f.sync,id:operationId});
 // 日時だけでなく、topicに使う団体名・locationに使うURLも外部呼び出し時点の値と比較する。
 // 日時が同じでも団体名やURLが同時編集されていれば、Zoom/カレンダーには古い内容のまま登録されているため
 // 「同期済み」と誤って記録してはいけない（Codex独立レビュー指摘）。
 const guardInput=expected?(liveOrg=>liveOrg[f.at]===expected.at&&liveOrg.name===expected.name&&(liveOrg[f.url]||'')===expected.url&&liveOrg[expected.contentField]===expected.content&&meetingDuration(liveOrg,expected.kind)===expected.durationMin):undefined;
 // 同じZoom会議・カレンダー予定に対する同時操作（例: 日程変更と取消）が、互いの外部呼び出しの結果を
 // 踏まえずに両方とも成功してしまうと、保存の先着順によって「取消済みなのに同期済みと表示される」
 // ような不整合が起きる。外部呼び出しの前にCASで予約し、先に予約した側だけが進めるようにする
 // （Codex独立レビュー指摘: 従来は新規作成（Zoom作成・カレンダー新規作成）しか予約しておらず、
 // 既存の会議に対する更新は無防備だった）。
 const reserved=await updateOrg(store,orgId,revision,o=>({...o,[f.sync]:{...existing,operationId:randomUUID(),status:'creating',error:null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));
 operationId=reserved.org[f.sync].operationId;existing={...existing,operationId};
 revision=reserved.revision;
 const warnings=[];let status='synced';
 await assertOperation(store,orgId,f.sync,operationId);
 try{await zoom.updateMeeting(store,existing.zoomMeetingId,{topic,startIso,durationMin:expected.durationMin});}
 catch(e){warnings.push('Zoom会議の更新に失敗しました: '+e.message);status='error';}
 await assertOperation(store,orgId,f.sync,operationId);
 if(existing.calendarEventId){
  try{await googlecalendar.updateEvent(store,existing.calendarEventId,{summary:topic,description,location:locationUrl,startIso,endIso,attendees:meetingOptions?.attendees,calendarId:existing.calendarId||'primary'});}
  catch(e){warnings.push('Googleカレンダー予定の更新に失敗しました: '+e.message);status='error';}
  try{
   const result=await save(store,orgId,revision,o=>({...o,[f.sync]:{...existing,status,error:warnings.join(' / ')||null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}),guardInput);
   return {...result,warnings};
  }catch(e){
   // guardInputの不一致（他端末が同時にMTG日時を変更）等でこの保存が失敗した場合でも、既存のZoom/カレンダーの
   // IDは保持したまま「creating」の固着ロックだけは解除する。解除に失敗しても元の例外は呼び出し元へ伝える
   // （Codex独立レビュー指摘：ロック解除なしでは以後のcreate/update/cancelが全てブロックされる）。
   try{await save(store,orgId,revision,o=>({...o,[f.sync]:{...existing,status:'error',error:e.message,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}));}catch{}
   throw e;
  }
 }
 let event;
 try{
  event=await googlecalendar.createEvent(store,{summary:topic,description,location:locationUrl,startIso,endIso,attendees:meetingOptions?.attendees||[],calendarId:existing.calendarId||'primary'});
  const result=await save(store,orgId,revision,o=>({...o,[f.sync]:{...existing,calendarEventId:event.eventId,status:warnings.length?'error':'synced',error:warnings.join(' / ')||null,updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()}),guardInput);
  return {...result,warnings};
 }catch(e){
  // eventが作成済み（カレンダー登録自体は成功）なのに保存だけ失敗した場合（他端末によるguardInput不一致を含む）は、
  // 新規作成されたcalendarEventIdを失うと再試行で重複作成・孤立イベントになる（Codex独立レビュー指摘）。
  // そのIDを保持したまま「creating」ロックを解除する。
  // eventが未作成（createEvent自体が例外を投げた）場合、integrations/googlecalendar.jsのremote()は通信断・
  // 12秒タイムアウトを全てcode:'通信失敗'としてまとめてしまい、「Googleへ届く前に失敗した」のか「Googleは
  // 予定を作成したが応答が届かなかった」のかを区別できない。これを確定失敗（'error'）として通常の再試行
  // ボタンの対象にすると、実際には作成済みの予定が孤立し、再試行で重複作成される恐れがある（Codex独立
  // レビュー指摘）。確定失敗とは別の'uncertain'状態として記録し、管理者に確認を促す。
  // 通信失敗: fetch自体の失敗。response_body_unreadable: HTTP応答は成功したのに本文の読み取りだけ失敗した
  // 場合（integrations/googlecalendar.jsのcreateEvent()参照）。どちらも「Googleが実際に予定を作成したか
  // どうか不明」という同じ意味であり、確定失敗と区別する（Codex独立レビュー指摘）。
  // ただし、この2つのコードはトークン更新（token_refresh）など予定作成リクエストより前の段階でも
  // 発生する。その場合はGoogleへ予定作成リクエスト自体が送られていないため曖昧さは無く、確定失敗として
  // 扱わないと不要に「要確認」状態へ固着してしまう（Zoom側と同じ指摘の再発：Codex独立レビュー指摘）。
  // 予定作成リクエスト自体の段階（create_event）での失敗だけをuncertainとする。
  const uncertain=!event&&(e.code==='通信失敗'||e.code==='response_body_unreadable'||(e.httpStatus>=500&&e.httpStatus<=599))&&e.stage==='create_event';
  const allWarnings=event
   ?[...warnings,'他の端末がこのMTGの日時・内容を変更したため、作成済みのカレンダー予定を同期済みとして保存できませんでした: '+e.message]
   :uncertain
   ?[...warnings,'Googleカレンダーへの通信がタイムアウト、またはサーバーエラーとなり、予定が実際に作成されたか不明です（Zoom会議は作成済みです）。Googleカレンダーで同名の予定が作成されていないか確認してください。作成されていなければ「MTGを取消」でこの記録をクリアしてから作成し直してください。作成されていた場合は、その予定を直接使うか手動で削除してください。']
   :[...warnings,'Googleカレンダーへの登録に失敗しました（Zoom会議は作成済みです）: '+e.message];
  const mutate=o=>({...o,[f.sync]:{...existing,calendarEventId:event?event.eventId:existing.calendarEventId,status:uncertain?'uncertain':'error',error:allWarnings.join(' / '),updatedAt:new Date().toISOString()},updatedAt:new Date().toISOString()});
  try{
   const result=await save(store,orgId,revision,mutate);
   return {...result,warnings:allWarnings,partial:true};
  }catch{
   // この保存自体が失敗すると、status:'creating'が残り固着する上、eventが作成済みならそのIDも失われる
   // （同じパターンの再発）。もう一度だけ同じ内容で保存を試みる。これも失敗した場合はその例外が
   // そのまま呼び出し元へ伝わる（DB側が本当に書き込めない状況であり、これ以上のリトライは無意味）。
   const result=await save(store,orgId,revision,mutate);
   return {...result,warnings:allWarnings,partial:true};
  }
 }
}

export async function inspectRecovery(store,sync){
 const inspect=async(fn,id)=>{if(!id)return 'ID未保存・結果不明';try{await fn();return '保存済みIDの存在・所有者を確認';}catch{return '存在・所有者を確認できず要確認';}};
 const z=await inspect(()=>zoom.inspectMeeting(store,sync.zoomMeetingId,sync.zoomHostId),sync.zoomMeetingId);
 const c=await inspect(()=>googlecalendar.inspectEvent(store,sync.calendarEventId,sync.calendarId),sync.calendarEventId);
 return 'Zoom: '+z+' / Calendar: '+c;
}
