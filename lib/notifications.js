import {dueMeetings,meetingTime} from '../public/meeting-agenda.js';
// SICKSTYLE通知の保存・重複防止・端末登録（既存ss_documentsのみ利用）。
import {createHash} from 'node:crypto';
import {encrypt,decrypt} from './security.js';
import {runtime} from './runtime.js';
import {pushRequest,validateSubscription} from './web-push.js';
import {empty,migrate} from './domain.js';
const EVENT='notify-event-v1:',DEVICE='notify-device-v1:';
const sha=s=>createHash('sha256').update(s).digest('hex');
const dayJst=d=>new Date(d).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
const money=n=>'¥'+Math.round(n).toLocaleString('ja-JP');
const numeric=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function scheduledKind(cron){return {'0 0 * * *':'morning','0 11 * * *':'sales','0 13 * * *':'analysis'}[cron]||null;}
export async function listNotifications(store){
 // name = 'notify-event-v1:'+kind+':'+id なので、SQL側で name DESC + LIMIT すると実際の作成時刻ではなく
 // kind（種別）の文字列順でほぼ決まってしまい、蓄積が進むと特定の種別（例: analysis）が丸ごと漏れうる
 // （Codex独立レビュー指摘）。必ず createdAt で並べ替えてから件数を絞る。
 const rows=await store.query('SELECT body FROM ss_documents WHERE name LIKE $1',[EVENT+'%']);
 return rows.map(r=>{try{return JSON.parse(r.body);}catch{return null;}}).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,60);
}
export function reportFor(kind,now,workspace,amazonCache,calendarEvents=[],calendarConnected=false){
 const day=dayJst(now),tasks=(workspace.staffTasks||[]).filter(t=>t.due===day&&!t.deletedAt&&t.status!=='完了');
 const meetings=(workspace.orgSales||[]).filter(o=>!o.deletedAt&&[o.initialZoomAt,o.proposalZoomAt].some(v=>typeof v==='string'&&v.startsWith(day)));
 if(kind==='morning')return {title:'9時 今日の予定｜SICKSTYLE',
  body:'Google予定'+(calendarConnected?calendarEvents.length+'件':'未接続')+'、担当タスク'+tasks.length+'件、団体商談'+meetings.length+'件。詳細はアプリで確認してください。',
  detail:{date:day,googleConnected:calendarConnected,
   calendarEvents:calendarEvents.slice(0,30).map(e=>({title:String(e.summary||'予定').slice(0,100),start:e.start?.dateTime||e.start?.date||null})),
   tasks:tasks.slice(0,30).map(t=>({title:String(t.title).slice(0,100),due:t.due})),
   meetings:meetings.slice(0,30).map(o=>({name:String(o.name).slice(0,100)}))}};
 const a=(amazonCache?.dailyHistory||[]).find(x=>x.date===day&&numeric(x.sales));
 const manual=(workspace.metrics||[]).find(x=>x.date===day&&numeric(x.sales));
 const current=a||manual,source=a?'Amazon Sales API':manual?'手入力・CSV':'未取得';
 if(kind==='sales')return {title:'20時 売上速報｜SICKSTYLE',
  body:current?'本日の売上 '+money(current.sales)+'（'+source+'）。速報値・未確定です。':'本日の売上は未取得です。未取得は0円を意味しません。',
  detail:{date:day,sales:current?.sales??null,source,final:false}};
 const prevDay=dayJst(new Date(new Date(day+'T00:00:00+09:00').getTime()-86400000));
 const prev=(amazonCache?.dailyHistory||[]).find(x=>x.date===prevDay&&numeric(x.sales))||(workspace.metrics||[]).find(x=>x.date===prevDay&&numeric(x.sales));
 const diff=current&&prev?current.sales-prev.sales:null;
 return {title:'22時 売上データ分析｜SICKSTYLE',
  body:diff===null?'今日と前日の実測データが揃わず、比較はできません（未取得≠0円）。':
   '今日の売上'+money(current.sales)+'、前日との差'+(diff>=0?'+':'')+money(diff)+'。変動要因は未検証です。',
  detail:{date:day,today:current?.sales??null,previous:prev?.sales??null,previousDate:prevDay,difference:diff,causesVerified:false}};
}
export async function subscribe(store,sub){
 const parsed=validateSubscription(sub),key=DEVICE+sha(parsed.endpoint);
 const rows=await store.query('SELECT name FROM ss_documents WHERE name LIKE $1',[DEVICE+'%']);
 if(rows.length>=5&&!rows.some(r=>r.name===key))throw Error('通知端末は5台まで登録できます');
 await store.put(key,{encrypted:encrypt(parsed),createdAt:new Date().toISOString()});
 return {ok:true};
}
export async function unsubscribe(store,endpoint){
 if(typeof endpoint!=='string'||!endpoint.startsWith('https://')||endpoint.length>2100)throw Error('通知先が不正です');
 await store.query('DELETE FROM ss_documents WHERE name=$1',[DEVICE+sha(endpoint)]);return {ok:true};
}
export async function status(store){
 const rows=await store.query('SELECT name FROM ss_documents WHERE name LIKE $1',[DEVICE+'%']),env=runtime();
 return {configured:!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT),publicKey:env.VAPID_PUBLIC_KEY||null,devices:rows.length};
}
async function push(store,item,request=fetch){
 if(item.kind==='meeting_reminder')return pushReminder(store,item,request);
 const env=runtime();if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return;
 const rows=await store.query('SELECT name,body FROM ss_documents WHERE name LIKE $1 LIMIT 5',[DEVICE+'%']);
 for(const r of rows){
  try{const sub=decrypt(JSON.parse(r.body).encrypted);
   const req=await pushRequest(sub,env,{title:item.title,body:item.body,tag:item.id,url:'/?notifications=1'});
   const response=await request(req.endpoint,req.init);
   if(response.status===404||response.status===410)await store.query('DELETE FROM ss_documents WHERE name=$1',[r.name]);
   else if(!response.ok)console.error(JSON.stringify({event:'push_rejected',http:response.status}));
  }catch(e){console.error(JSON.stringify({event:'push_failed',type:e.name||'unknown'}));}
 }
}
// Per-device CAS leases prevent concurrent ticks sending twice. Successful devices
// stay settled; transient failures retry on later ticks only while the meeting is due.
async function pushReminder(store,item,request){
 const env=runtime();if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return;
 if(!await meetingReminderActive(store,item.id))return;
 const devices=await store.query('SELECT name,body FROM ss_documents WHERE name LIKE $1 LIMIT 5',[DEVICE+'%']);
 const prefix='meeting-delivery:'+sha(item.id).slice(0,40)+':';
 const receipts=await store.query('SELECT name,body,revision FROM ss_documents WHERE name LIKE $1',[prefix+'%']);
 const known=new Map(receipts.map(r=>[r.name,r]));let complete=true,retryAt=Infinity;
 for(const device of devices){
  const key=prefix+sha(device.name).slice(0,40),previous=known.get(key),saved=previous?JSON.parse(previous.body):null;
  if(saved?.settled)continue;
  if(saved?.retryAfter>Date.now()){complete=false;retryAt=Math.min(retryAt,saved.retryAfter);continue;}
  const pending={settled:false,retryAfter:Date.now()+60000};
  const claimed=previous?await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(pending),key,previous.revision]):await store.query('INSERT INTO ss_documents(name,body,revision) VALUES ($1,$2,0) ON CONFLICT(name) DO NOTHING RETURNING revision',[key,JSON.stringify(pending)]);
  if(!claimed.length){complete=false;retryAt=Math.min(retryAt,pending.retryAfter);continue;}
  let delivered=false,settled=false;
  try{
   const sub=decrypt(JSON.parse(device.body).encrypted);
   const req=await pushRequest(sub,env,{title:item.title,body:item.body,tag:item.id,url:'/?meetings=1',expiresAt:item.detail.startsAt,reminderId:item.id});
   if(!await meetingReminderActive(store,item.id))return;
   if(Date.now()<item.detail.startsAt){const response=await request(req.endpoint,req.init);delivered=response.ok;settled=delivered||(response.status>=400&&response.status<500&&response.status!==429);
    if(response.status===404||response.status===410)await store.query('DELETE FROM ss_documents WHERE name=$1',[device.name]);
   }
  }catch{console.error(JSON.stringify({event:'meeting_push_retry_pending'}));}
  await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3',[JSON.stringify({...pending,delivered,settled}),key,claimed[0].revision]);
  if(!settled){complete=false;retryAt=Math.min(retryAt,pending.retryAfter);}
 }
 {
  const live=await store.doc(item.id);if(!live)return;const data=JSON.parse(live.body);
  data.detail={...data.detail,deliveryComplete:complete,lastAttemptAt:Date.now(),nextAttemptAt:complete?null:Number.isFinite(retryAt)?retryAt:Date.now()+60000};
  await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3',[JSON.stringify(data),item.id,live.revision]);
 }
}
export async function emit(store,kind,id,data,request=fetch,workspaceRevision=null){
 if(!/^(morning|sales|analysis|ai_review|ai_completed|test|meeting_reminder)$/.test(kind)||!/^[a-zA-Z0-9_-]{1,50}$/.test(id))throw Error('通知IDが正しくありません');
 if(typeof data.title!=='string'||typeof data.body!=='string'||data.body.length>600)throw Error('通知本文が不正です');
 const key=EVENT+kind+':'+id,item={id:key,kind,title:data.title.slice(0,100),body:data.body,detail:data.detail||null,createdAt:new Date().toISOString(),readAt:null};
 const result=workspaceRevision===null?await store.query('INSERT INTO ss_documents(name,body,revision) VALUES ($1,$2,0) ON CONFLICT(name) DO NOTHING RETURNING name',[key,JSON.stringify(item)]):await store.query('INSERT INTO ss_documents(name,body,revision) SELECT $1,$2,0 WHERE EXISTS (SELECT 1 FROM ss_documents WHERE name=$3 AND revision=$4) ON CONFLICT(name) DO NOTHING RETURNING name',[key,JSON.stringify(item),'workspace',workspaceRevision]);
 if(!result.length)return {created:false};
 await push(store,item,request);return {created:true};
}
export async function markRead(store,key){
 if(typeof key!=='string'||!key.startsWith(EVENT)||key.length>120||!/^[\w:-]+$/.test(key))throw Error('通知IDが不正です');
 const r=await store.doc(key);if(!r)return {ok:false};
 const data=JSON.parse(r.body);data.readAt=new Date().toISOString();await store.put(key,data);return {ok:true};
}
export async function aiUpdated(store,job,status){
 if(!job?.id||!['in_review','completed'].includes(status))return;
 const kind=status==='in_review'?'ai_review':'ai_completed';
 // ai_reviewは差し戻し（rejected）後の再取込（最大2回）でも同じjob.idに対して複数回発生し得る。
 // job.id単体だけを重複排除キーに使うと、1回目の通知が既にDBへ保存済みのため、2回目（修正済みの
 // 分析結果が届いたこと）の通知がemit()のON CONFLICT DO NOTHINGで無言で捨てられ、管理者に届かない
 // （Codex独立レビュー指摘）。試行回数（job.attempts）を含めることで、同一取込内の重複排除は保ちつつ、
 // 取込ごとに別の通知として届ける。ai_completedは承認後に終端状態になり再発生しないため変更しない。
 const id=kind==='ai_review'?job.id+'-a'+job.attempts:job.id;
 await emit(store,kind,id,{title:status==='in_review'?'AI社員の分析が完了':'AI社員の依頼が完了',
  body:'「'+String(job.title).slice(0,65)+'」'+(status==='in_review'?'の分析結果が届きました。確認待ちです。':'がレビュー承認されました。')});
}
// Authenticated button: at most one test push per minute, no customer or credential content.
export async function testDelivery(store,now=new Date()){
 return emit(store,'test',String(Math.floor(now.getTime()/60000)),{title:'SICKSTYLE テスト通知',body:'通知の受信テストです。機密データは含みません。'});
}
export async function runReport(store,kind,now=new Date(),calendarLoader=async()=>({connected:false,events:[]})){
 if(!['morning','sales','analysis'].includes(kind))return {created:false};
 const day=dayJst(now),doc=await store.doc('workspace'),workspace=migrate(doc?JSON.parse(doc.body):empty());
 const cacheDoc=await store.doc('amazon-cache'),cache=cacheDoc?JSON.parse(cacheDoc.body):null;
 let cal={connected:false,events:[]};
 if(kind==='morning')try{cal=await calendarLoader();}catch(e){console.error(JSON.stringify({event:'morning_calendar_unavailable'}));}
 return emit(store,kind,day,reportFor(kind,now,workspace,cache,cal.events,cal.connected));
}

// No browser timers or new credentials: one persisted event per saved start time.
export async function meetingReminderActive(store,id,now=new Date()){
 if(typeof id!=='string'||!/^notify-event-v1:meeting_reminder:[a-f0-9]{40}$/.test(id))return false;
 const event=await store.doc(id),workspace=await store.doc('workspace');
 if(!event||!workspace)return false;
 const item=JSON.parse(event.body);
 return dueMeetings(JSON.parse(workspace.body).orgSales,now).some(m=>m.token===item.detail?.token);
}
export async function runMeetingReminders(store,now=new Date(),request=fetch){
 const doc=await store.doc('workspace');if(!doc)return {created:0};
 const due=dueMeetings(JSON.parse(doc.body).orgSales,now);if(!due.length)return {created:0};
 const rows=await store.query('SELECT name,body FROM ss_documents WHERE name LIKE $1',[EVENT+'meeting_reminder:%']);
 const existing=new Map(rows.map(r=>[r.name,JSON.parse(r.body)]));let created=0;
 // At most 39 subrequests: 2 initial reads + insert + validation(2) +
 // device/receipt reads(2) + 5 × (claim + validation(2) + send + deletion + save) + completion(2).
 // New reminders take priority over retries so a failing device cannot starve them.
 const keyFor=m=>EVENT+'meeting_reminder:'+sha(m.token).slice(0,40);
 const pending=due.filter(m=>{const prior=existing.get(keyFor(m)),detail=prior?.detail;return (!prior||detail?.deliveryVersion===1)&&!detail?.deliveryComplete&&!(detail?.nextAttemptAt>now.getTime());})
  .sort((a,b)=>Number(existing.has(keyFor(a)))-Number(existing.has(keyFor(b)))||(existing.get(keyFor(a))?.detail?.lastAttemptAt||0)-(existing.get(keyFor(b))?.detail?.lastAttemptAt||0));
 for(const m of pending.slice(0,1)){
  const prior=existing.get(keyFor(m));if(prior){await pushReminder(store,prior,request);continue;}
  const result=await emit(store,'meeting_reminder',sha(m.token).slice(0,40),{
   title:'まもなく会議｜SICKSTYLE',body:meetingTime(m)+'開始予定。アプリで最新の予定と参加リンクを確認してください。',
   detail:{token:m.token,startsAt:m.start,title:m.title,deliveryVersion:1}},request,doc.revision);
  if(result.created)created++;
 }
 return {created};
}
