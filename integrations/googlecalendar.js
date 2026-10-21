import {runtime} from '../lib/runtime.js';
import {encrypt,decrypt,token,hash} from '../lib/security.js';
// 本人（管理者）のGoogleカレンダーをOAuth（Authorization Code, offline access）で認可する。
// 最小スコープ: カレンダーの予定（イベント）作成・変更・削除のみ。カレンダー本体の設定・他カレンダー一覧は要求しない。
export const scopes=['https://www.googleapis.com/auth/calendar.events'];
export function config(){return !!(runtime().GOOGLE_CLIENT_ID&&runtime().GOOGLE_CLIENT_SECRET&&runtime().APP_ORIGIN&&runtime().TOKEN_ENCRYPTION_KEY);}
const callback=()=>new URL('/api/googlecalendar/callback',runtime().APP_ORIGIN).href;
export class GoogleCalendarError extends Error{constructor(code,message){super(message||`Googleカレンダー API エラー (${code})。権限・期限を確認してください。`);this.code=code;}}
async function remote(url,options={}){let response;try{response=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});}catch{throw new GoogleCalendarError('通信失敗');}
 if(response.status===204)return {};
 let b=null;try{b=await response.json();}catch{}
 if(!response.ok){const code=b?.error?.code||response.status;const hint=response.status===401?'認可が失効しています。再接続してください。':response.status===403?'権限不足、または認可が取り消されています。':response.status===429?'Googleの呼び出し上限です。しばらくして再試行してください。':'';throw new GoogleCalendarError(code,b?.error?.message?`Googleカレンダー API エラー (${code}): ${b.error.message}。${hint}`:undefined);}
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
 const raw=await remote('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
 if(!raw.access_token||!raw.refresh_token)throw Error('Googleの認可トークン（オフラインアクセス）を取得できませんでした。再認可時はGoogleアカウントの権限を一度解除してから実行してください');
 const info=await remote('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:`Bearer ${raw.access_token}`}});
 const data={email:info.email||null,encrypted:encrypt({refresh:raw.refresh_token}),issuedAt:Date.now(),connectedAt:new Date().toISOString(),scope:String(raw.scope||'')};
 await store.put('googlecalendar-private',data);return data;
}
async function accessToken(store,p){
 const form=new URLSearchParams({grant_type:'refresh_token',refresh_token:decrypt(p.encrypted).refresh,client_id:runtime().GOOGLE_CLIENT_ID,client_secret:runtime().GOOGLE_CLIENT_SECRET});
 const fresh=await remote('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
 if(!fresh.access_token)throw Error('Googleトークンの更新に失敗しました。再接続してください');
 return fresh.access_token;
}
export async function safeStatus(store){const p=await privateData(store);return {configured:config(),connected:!!p,email:p?.email||null,connectedAt:p?.connectedAt||null};}
export async function createEvent(store,{summary,description,location,startIso,endIso,attendees}){
 const p=await privateData(store);if(!p)throw Error('Googleカレンダーを接続してください');
 const access=await accessToken(store,p);
 const r=await remote('https://www.googleapis.com/calendar/v3/calendars/primary/events',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
  body:JSON.stringify({summary,description,location,start:{dateTime:startIso,timeZone:'Asia/Tokyo'},end:{dateTime:endIso,timeZone:'Asia/Tokyo'},attendees:(attendees||[]).map(email=>({email}))})});
 return {eventId:r.id,htmlLink:r.htmlLink||null};
}
export async function updateEvent(store,eventId,{summary,description,location,startIso,endIso}){
 const p=await privateData(store);if(!p)throw Error('Googleカレンダーを接続してください');
 const access=await accessToken(store,p);
 await remote(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,{method:'PATCH',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
  body:JSON.stringify({summary,description,location,start:{dateTime:startIso,timeZone:'Asia/Tokyo'},end:{dateTime:endIso,timeZone:'Asia/Tokyo'}})});
 return {ok:true};
}
export async function deleteEvent(store,eventId){
 const p=await privateData(store);if(!p)throw Error('Googleカレンダーを接続してください');
 const access=await accessToken(store,p);
 try{await remote(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,{method:'DELETE',headers:{Authorization:`Bearer ${access}`}});}
 catch(e){if(e instanceof GoogleCalendarError&&(e.code===410||e.code===404))return {ok:true,alreadyGone:true};throw e;}
 return {ok:true};
}
export async function disconnect(store){await store.query('DELETE FROM ss_documents WHERE name=$1',['googlecalendar-private']);return {ok:true};}
