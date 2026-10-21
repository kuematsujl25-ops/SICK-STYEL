import {runtime} from '../lib/runtime.js';
import {encrypt,decrypt,token,hash} from '../lib/security.js';
// 本人（管理者）のZoomアカウントをOAuth（Authorization Code）で認可する。サーバー間アプリ（Server-to-Server OAuth）は使わない。
// 必要スコープ（Zoom Marketplaceアプリ作成時に選択）: meeting:write:meeting, meeting:update:meeting, meeting:delete:meeting, user:read:user:me
export const scopes=['meeting:write:meeting','meeting:update:meeting','meeting:delete:meeting','user:read:user:me'];
export function config(){return !!(runtime().ZOOM_CLIENT_ID&&runtime().ZOOM_CLIENT_SECRET&&runtime().APP_ORIGIN&&runtime().TOKEN_ENCRYPTION_KEY);}
const callback=()=>new URL('/api/zoom/callback',runtime().APP_ORIGIN).href;
export class ZoomError extends Error{constructor(code,message){super(message||`Zoom API エラー (${code})。権限・期限を確認してください。`);this.code=code;}}
async function remote(url,options={}){let response;try{response=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});}catch{throw new ZoomError('通信失敗');}
 let b=null;try{b=await response.json();}catch{}
 if(!response.ok){const code=b?.code||response.status;const hint=response.status===401?'認可が失効しています。再接続してください。':response.status===429?'Zoomの呼び出し上限です。しばらくして再試行してください。':'';throw new ZoomError(code,b?.message?`Zoom API エラー (${code}): ${b.message}。${hint}`:undefined);}
 return b;
}
async function privateData(store){const r=await store.doc('zoom-private');return r?JSON.parse(r.body):null;}
export async function begin(store,session){
 if(!config())throw Error('Zoomアプリの環境変数が未設定です');
 const s=token();await store.query('DELETE FROM ss_oauth WHERE expires<$1',[Date.now()]);await store.query('INSERT INTO ss_oauth(state,session,expires) VALUES ($1,$2,$3)',[hash('zoom:'+s),session,Date.now()+600000]);
 const u=new URL('https://zoom.us/oauth/authorize');u.search=new URLSearchParams({response_type:'code',client_id:runtime().ZOOM_CLIENT_ID,redirect_uri:callback(),state:s}).toString();return u.href;
}
export async function connect(store,session,url){
 const rows=await store.query('DELETE FROM ss_oauth WHERE state=$1 AND session=$2 AND expires>$3 RETURNING state',[hash('zoom:'+(url.searchParams.get('state')||'')),session,Date.now()]);
 if(!rows.length)throw Error('認可の有効期限が切れたか、stateが一致しません');
 if(url.searchParams.has('error'))throw Error('Zoomの認可がキャンセルされました');
 const code=url.searchParams.get('code');if(!code)throw Error('認可コードがありません');
 const auth='Basic '+Buffer.from(`${runtime().ZOOM_CLIENT_ID}:${runtime().ZOOM_CLIENT_SECRET}`).toString('base64');
 const form=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:callback()});
 const raw=await remote('https://zoom.us/oauth/token',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/x-www-form-urlencoded'},body:form});
 if(!raw.access_token||!raw.refresh_token)throw Error('Zoomの認可トークンを取得できませんでした');
 const me=await remote('https://api.zoom.us/v2/users/me',{headers:{Authorization:`Bearer ${raw.access_token}`}});
 const data={userId:me.id,email:me.email,encrypted:encrypt({refresh:raw.refresh_token}),issuedAt:Date.now(),connectedAt:new Date().toISOString(),scopes:String(raw.scope||'').split(' ').filter(Boolean)};
 await store.put('zoom-private',data);return data;
}
async function accessToken(store,p){
 const auth='Basic '+Buffer.from(`${runtime().ZOOM_CLIENT_ID}:${runtime().ZOOM_CLIENT_SECRET}`).toString('base64');
 const {refresh}=decrypt(p.encrypted);
 const form=new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh});
 const fresh=await remote('https://zoom.us/oauth/token',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/x-www-form-urlencoded'},body:form});
 if(!fresh.access_token||!fresh.refresh_token)throw Error('Zoomトークンの更新に失敗しました。再接続してください');
 await store.put('zoom-private',{...p,encrypted:encrypt({refresh:fresh.refresh_token}),issuedAt:Date.now()});
 return fresh.access_token;
}
export async function safeStatus(store){const p=await privateData(store);return {configured:config(),connected:!!p,email:p?.email||null,connectedAt:p?.connectedAt||null,scopes:p?.scopes||[]};}
// Zoomのjoin_urlのみを返す。ホスト専用start_urlは呼び出し元へ渡さない（外部共有の禁止）。
export async function createMeeting(store,{topic,startIso,durationMin}){
 const p=await privateData(store);if(!p)throw Error('Zoomを接続してください');
 const access=await accessToken(store,p);
 const r=await remote('https://api.zoom.us/v2/users/me/meetings',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
  body:JSON.stringify({topic,type:2,start_time:startIso,duration:durationMin,timezone:'Asia/Tokyo',settings:{join_before_host:true,waiting_room:true,mute_upon_entry:true,approval_type:2}})});
 return {meetingId:String(r.id),joinUrl:r.join_url};
}
export async function updateMeeting(store,meetingId,{topic,startIso,durationMin}){
 const p=await privateData(store);if(!p)throw Error('Zoomを接続してください');
 const access=await accessToken(store,p);
 await remote(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,{method:'PATCH',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
  body:JSON.stringify({topic,start_time:startIso,duration:durationMin,timezone:'Asia/Tokyo'})});
 return {ok:true};
}
export async function deleteMeeting(store,meetingId){
 const p=await privateData(store);if(!p)throw Error('Zoomを接続してください');
 const access=await accessToken(store,p);
 try{await remote(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,{method:'DELETE',headers:{Authorization:`Bearer ${access}`}});}
 catch(e){if(e instanceof ZoomError&&e.code===3001)return {ok:true,alreadyGone:true};throw e;}
 return {ok:true};
}
export async function disconnect(store){await store.query('DELETE FROM ss_documents WHERE name=$1',['zoom-private']);return {ok:true};}
