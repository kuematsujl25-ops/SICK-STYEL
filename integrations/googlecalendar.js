import {runtime} from '../lib/runtime.js';
import {encrypt,decrypt,token,hash} from '../lib/security.js';
// 本人（管理者）のGoogleカレンダーをOAuth（Authorization Code, offline access）で認可する。
// 予定操作と、承認済みの主カレンダーID照合用メタデータ読み取り。
export const identityScope='https://www.googleapis.com/auth/calendar.calendars.readonly';
export const scopes=['https://www.googleapis.com/auth/calendar.events',identityScope];
export function config(){return !!(runtime().GOOGLE_CLIENT_ID&&runtime().GOOGLE_CLIENT_SECRET&&runtime().APP_ORIGIN&&runtime().TOKEN_ENCRYPTION_KEY);}
const callback=()=>new URL('/api/googlecalendar/callback',runtime().APP_ORIGIN).href;
// stage: 失敗した処理段階（token_exchange/token_refresh/create_event/update_event/delete_event/list_events）。
// lib/meeting-sync.jsが「予定の作成リクエスト自体が送られた後の失敗（曖昧・uncertain）」と「それより前の
// 段階（トークン更新等、作成リクエスト未送信で確実に未作成）」を区別するために使う（Codex独立レビュー指摘）。
export class GoogleCalendarError extends Error{constructor(code,message,stage,httpStatus=null){super(message||`Googleカレンダー API エラー (${code})。権限・期限を確認してください。`);this.code=code;this.stage=stage||null;this.httpStatus=httpStatus;}}
async function remote(stage,url,options={}){let response;try{response=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});}catch{throw new GoogleCalendarError('通信失敗',undefined,stage);}
 if(response.status===204)return {};
 let b=null;try{b=await response.json();}catch{}
 if(!response.ok){const code=b?.error?.code||response.status;const hint=response.status===401?'認可が失効しています。再接続してください。':response.status===403?'権限不足、または認可が取り消されています。':response.status===429?'Googleの呼び出し上限です。しばらくして再試行してください。':'';throw new GoogleCalendarError(code,b?.error?.message?`Googleカレンダー API エラー (${code}): ${b.error.message}。${hint}`:undefined,stage,response.status);}
 return b;
}
async function privateData(store){const r=await store.doc('googlecalendar-private');return r?JSON.parse(r.body):null;}
export async function begin(store,session){
 if(!config())throw Error('Google Calendarアプリの環境変数が未設定です');
 const s=token();await store.query('DELETE FROM ss_oauth WHERE expires<$1',[Date.now()]);await store.query('INSERT INTO ss_oauth(state,session,expires) VALUES ($1,$2,$3)',[hash('googlecalendar:'+s),session,Date.now()+600000]);
 const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.search=new URLSearchParams({client_id:runtime().GOOGLE_CLIENT_ID,redirect_uri:callback(),response_type:'code',scope:scopes.join(' '),access_type:'offline',prompt:'consent',state:s}).toString();return u.href;
}
export async function connect(store,session,url){
 const rows=await store.query('DELETE FROM ss_oauth WHERE state=$1 AND session=$2 AND expires>$3 RETURNING state',[hash('googlecalendar:'+(url.searchParams.get('state')||'')),session,Date.now()]);
 if(!rows.length)throw Error('認可の有効期限が切れたか、stateが一致しません');
 if(url.searchParams.has('error'))throw Error('Googleカレンダーの認可がキャンセルされました');
 const code=url.searchParams.get('code');if(!code)throw Error('認可コードがありません');
 const form=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:callback(),client_id:runtime().GOOGLE_CLIENT_ID,client_secret:runtime().GOOGLE_CLIENT_SECRET});
 const raw=await remote('token_exchange','https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
 if(!raw.access_token||!raw.refresh_token)throw Error('Googleの認可トークン（オフラインアクセス）を取得できませんでした。再認可時はGoogleアカウントの権限を一度解除してから実行してください');
// calendar.events only grants calendar event access, NOT profile/email access.
 // Do not call /oauth2/v3/userinfo: it requires an additional userinfo/OIDC scope and
 // causes OAuth to fail despite valid Calendar consent. We intentionally do not request
 // extra personal-data scopes just for a cosmetic account label.
 const data={email:null,encrypted:encrypt({refresh:raw.refresh_token}),issuedAt:Date.now(),connectedAt:new Date().toISOString(),scope:String(raw.scope||'')};
 await store.put('googlecalendar-private',data);return data;
}
async function accessToken(store,p){
 const form=new URLSearchParams({grant_type:'refresh_token',refresh_token:decrypt(p.encrypted).refresh,client_id:runtime().GOOGLE_CLIENT_ID,client_secret:runtime().GOOGLE_CLIENT_SECRET});
 const fresh=await remote('token_refresh','https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
 if(!fresh.access_token)throw Error('Googleトークンの更新に失敗しました。再接続してください');
 return fresh.access_token;
}
export async function safeStatus(store){const p=await privateData(store);return {configured:config(),connected:!!p,identityReady:!!p&&(p.scope||'').split(/\s+/).some(s=>[identityScope,'https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar'].includes(s)),email:p?.email||null,connectedAt:p?.connectedAt||null};}
export async function createEvent(store,{summary,description,location,startIso,endIso,attendees,calendarId='primary'}){
 const p=await privateData(store);if(!p)throw Error('Googleカレンダーを接続してください');
 const access=await accessToken(store,p);
 const r=await remote('create_event','https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events?sendUpdates=all',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
  body:JSON.stringify({summary,description,location,start:{dateTime:startIso,timeZone:'Asia/Tokyo'},end:{dateTime:endIso,timeZone:'Asia/Tokyo'},attendees:(attendees||[]).map(email=>({email}))})});
 // remote()はHTTP応答自体は成功（2xx）でも、本文の読み取りが途中で失敗した場合はnullを返す。Googleは予定を
 // 作成済みの可能性が高いのに、ここでTypeErrorとして投げてしまうと、呼び出し元（lib/meeting-sync.js）は
 // 通常のGoogleCalendarErrorとの区別ができず、確定失敗として再試行してしまい、作成済みの予定が孤立したまま
 // 重複作成される恐れがある（Codex独立レビュー指摘）。専用のコードで区別する。
 if(!r||typeof r.id!=='string')
  throw new GoogleCalendarError('response_body_unreadable','Googleからの応答本文を読み取れませんでした。予定が作成されている可能性があります','create_event');
 return {eventId:r.id,htmlLink:r.htmlLink||null};
}
export async function updateEvent(store,eventId,{summary,description,location,startIso,endIso,attendees,calendarId='primary'}){
 const p=await privateData(store);if(!p)throw Error('Googleカレンダーを接続してください');
 const access=await accessToken(store,p);
 await remote('update_event',`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,{method:'PATCH',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
  body:JSON.stringify({summary,description,location,start:{dateTime:startIso,timeZone:'Asia/Tokyo'},end:{dateTime:endIso,timeZone:'Asia/Tokyo'},...(attendees?{attendees:attendees.map(email=>({email}))}:{})})});
 return {ok:true};
}
export async function deleteEvent(store,eventId,calendarId='primary'){
 const p=await privateData(store);if(!p)throw Error('Googleカレンダーを接続してください');
 const access=await accessToken(store,p);
 try{await remote('delete_event',`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,{method:'DELETE',headers:{Authorization:`Bearer ${access}`}});}
 catch(e){if(e instanceof GoogleCalendarError&&(e.code===410||e.code===404))return {ok:true,alreadyGone:true};throw e;}
 return {ok:true};
}
// 毎朝の予定通知用。calendar.events権限で本人のprimaryカレンダーのみ読み取り。
export async function listToday(store,day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('対象日が不正です');
 const p=await privateData(store);if(!p)return {connected:false,events:[]};
 const access=await accessToken(store,p);
 const timeMin=new Date(day+'T00:00:00+09:00').toISOString();
 const next=new Date(Date.parse(timeMin)+86400000).toISOString();
 const u=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
 u.search=new URLSearchParams({timeMin,timeMax:next,singleEvents:'true',orderBy:'startTime',maxResults:'2500'});
 const events=[],seen=new Set();
 for(let page=0;page<5;page++){
  const r=await remote('list_events',u.href,{headers:{Authorization:'Bearer '+access}});
  if(r.items!==undefined&&!Array.isArray(r.items))throw new GoogleCalendarError('invalid_response',null,'list_events');
  events.push(...(r.items||[]));
  if(!r.nextPageToken)return {connected:true,events};
  if(typeof r.nextPageToken!=='string'||seen.has(r.nextPageToken))break;
  seen.add(r.nextPageToken);u.searchParams.set('pageToken',r.nextPageToken);
 }
 throw new GoogleCalendarError('incomplete','Googleカレンダーの予定を全件取得できませんでした。','list_events');
}
export async function disconnect(store){await store.query('DELETE FROM ss_documents WHERE name=$1',['googlecalendar-private']);return {ok:true};}

export async function verifyOrganizer(store,expected){
 const p=await privateData(store);if(!p)throw Error('Googleカレンダーを接続してください');
 const granted=String(p.scope||'').split(' ');
 if(!granted.some(s=>[identityScope,'https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar'].includes(s)))throw Error('主催カレンダー確認には calendar.calendars.readonly の追加承認・再認可が必要です（未実施）');
 const access=await accessToken(store,p);
 const calendar=await remote('identity','https://www.googleapis.com/calendar/v3/calendars/primary',{headers:{Authorization:'Bearer '+access}});
 if(typeof calendar?.id!=='string'||calendar.id.toLowerCase()!==expected.toLowerCase())throw Error('接続中の主カレンダーが指定した主催者と一致しません');
 return {calendarId:calendar.id};
}

export async function inspectEvent(store,eventId,calendarId){
 if(!calendarId||calendarId==='primary')throw Error('主催カレンダーの記録がありません');
 await verifyOrganizer(store,calendarId);
 const p=await privateData(store),access=await accessToken(store,p);
 const r=await remote('get_event',`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,{headers:{Authorization:`Bearer ${access}`}});
 if(!r||r.id!==eventId||r.status==='cancelled'||r.organizer?.email?.toLowerCase()!==calendarId.toLowerCase())throw Error('カレンダー予定の照合ができません');
 return 'exists';
}
