import {runtime} from '../lib/runtime.js';
import {encrypt,decrypt,token,hash} from '../lib/security.js';
// 本人（管理者）のZoomアカウントをOAuth（Authorization Code）で認可する。サーバー間アプリ（Server-to-Server OAuth）は使わない。
// 必要スコープ（Zoom Marketplaceアプリ作成時に選択）: meeting:write:meeting, meeting:update:meeting, meeting:delete:meeting, user:read:user
export const scopes=['meeting:write:meeting','meeting:update:meeting','meeting:delete:meeting','user:read:user'];
export function config(){return !!(runtime().ZOOM_CLIENT_ID&&runtime().ZOOM_CLIENT_SECRET&&runtime().APP_ORIGIN&&runtime().TOKEN_ENCRYPTION_KEY);}
const callback=()=>new URL('/api/zoom/callback',runtime().APP_ORIGIN).href;
// code: Zoom自身のエラーコード/HTTPステータス、またはローカル検証で判定した安全な識別子（秘密値は含まない）。
// stage: 失敗した処理段階（state_validation/callback_params/token_exchange/profile/scope_check/storage/create_meeting等）。
// どちらもログ・画面表示用で、Client Secret・認可コード・アクセストークン・Cookieは一切含めない。
export class ZoomError extends Error{constructor(code,message,stage){super(message||`Zoom API エラー (${code})。権限・期限を確認してください。`);this.code=code;this.stage=stage||null;}}
async function remote(stage,url,options={}){let response;try{response=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});}catch{throw new ZoomError('network_error','Zoom APIへの通信に失敗しました（ネットワークまたはタイムアウト）',stage);}
 let b=null;try{b=await response.json();}catch{}
 if(!response.ok){const sourceCode=b?.code;const code=typeof sourceCode==='number'&&Number.isSafeInteger(sourceCode)?sourceCode:typeof sourceCode==='string'&&/^[a-zA-Z0-9_-]{1,40}$/.test(sourceCode)?sourceCode:response.status;const hint=response.status===401?'認可が失効しています。再接続してください。':response.status===429?'Zoomの呼び出し上限です。しばらくして再試行してください。':'';throw new ZoomError(code,`Zoom API エラー (${code}、HTTP ${response.status})。${hint}`,stage);}
 return b;
}
async function privateData(store){const r=await store.doc('zoom-private');return r?{...JSON.parse(r.body),revision:r.revision}:null;}
export async function begin(store,session){
 if(!config())throw Error('Zoomアプリの環境変数が未設定です');
 const s=token();await store.query('DELETE FROM ss_oauth WHERE expires<$1',[Date.now()]);await store.query('INSERT INTO ss_oauth(state,session,expires) VALUES ($1,$2,$3)',[hash('zoom:'+s),session,Date.now()+600000]);
 const u=new URL('https://zoom.us/oauth/authorize');u.search=new URLSearchParams({response_type:'code',client_id:runtime().ZOOM_CLIENT_ID,redirect_uri:callback(),state:s}).toString();return u.href;
}
export async function connect(store,session,url){
 const rows=await store.query('DELETE FROM ss_oauth WHERE state=$1 AND session=$2 AND expires>$3 RETURNING state',[hash('zoom:'+(url.searchParams.get('state')||'')),session,Date.now()]);
 if(!rows.length)throw new ZoomError('state_mismatch','認可の有効期限が切れたか、stateが一致しません（10分以内に認可を完了してください。同じ認可画面を複数回開いた場合もこのエラーになります）','state_validation');
 if(url.searchParams.has('error'))throw new ZoomError('user_denied','Zoomの認可が完了しませんでした。Zoom側で許可するか、対象のZoomアカウントで認可してください','callback_params');
 const code=url.searchParams.get('code');if(!code)throw new ZoomError('missing_code','認可コードがありません','callback_params');
 const auth='Basic '+Buffer.from(`${runtime().ZOOM_CLIENT_ID}:${runtime().ZOOM_CLIENT_SECRET}`).toString('base64');
 const form=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:callback()});
 const raw=await remote('token_exchange','https://zoom.us/oauth/token',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/x-www-form-urlencoded'},body:form});
 if(!raw.access_token||!raw.refresh_token)throw new ZoomError('token_response_incomplete','Zoomの認可トークンを取得できませんでした（応答にaccess_tokenまたはrefresh_tokenが含まれていません）','token_exchange');
 const granted=String(raw.scope||'').split(' ').filter(Boolean);
 const missing=scopes.filter(s=>!granted.includes(s));
 // Zoom Marketplaceの「Scopes」タブで必要な権限が選択されていないと、トークン交換自体は成功してもAPI呼び出しが失敗し続ける。
 // ここで必要スコープの過不足を照合し、/users/me呼び出し前に具体的な不足スコープ名を示して失敗させる（後段で原因不明の401になるのを防ぐ）。
 if(missing.length)throw new ZoomError('scope_missing','Zoomから許可された権限に次が含まれていません: '+missing.join('、')+'。Zoom MarketplaceアプリのScopesタブで必要な権限（'+scopes.join('、')+'）を選び直し、一度「接続を解除」してから再接続してください（Zoom側の表示名が変更されている場合は同等の最小権限を選んでください）。','scope_check');
 const me=await remote('profile','https://api.zoom.us/v2/users/me',{headers:{Authorization:`Bearer ${raw.access_token}`}});
 if(!me?.id||!me?.email)throw new ZoomError('profile_incomplete','Zoomのユーザー情報（id/email）を取得できませんでした','profile');
 try{
  const data={userId:me.id,email:me.email,encrypted:encrypt({refresh:raw.refresh_token}),issuedAt:Date.now(),connectedAt:new Date().toISOString(),scopes:granted};
  await store.put('zoom-private',data);return data;
 }catch(err){throw new ZoomError('storage_failed','認可情報の保存に失敗しました（暗号化鍵またはデータベース接続を確認してください）','storage');}
}
async function accessToken(store,p){
 const auth='Basic '+Buffer.from(`${runtime().ZOOM_CLIENT_ID}:${runtime().ZOOM_CLIENT_SECRET}`).toString('base64');
 const {refresh}=decrypt(p.encrypted);
 const form=new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh});
 const fresh=await remote('token_refresh','https://zoom.us/oauth/token',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/x-www-form-urlencoded'},body:form});
 if(!fresh.access_token||!fresh.refresh_token)throw new ZoomError('token_response_incomplete','Zoomトークンの更新に失敗しました。再接続してください','token_refresh');
 // Zoomはrefresh_tokenをローテーションする（1回使うと無効になる）。2つの会議同期が同時に動くと、両方とも
 // 同じ古いrefresh_tokenを読んで交換してしまい、後から保存した側だけが有効なトークンを残し、先に保存した
 // 側（または交換自体に失敗した側）の接続が次回から壊れる恐れがある（Codex独立レビュー指摘）。読み取り時の
 // revisionと一致する場合だけ保存するCASにし、既に他の同時呼び出しが保存済みなら自分では上書きしない
 // （自分がこの呼び出しで得たaccess_tokenは、保存の成否に関わらずこの1回の呼び出しには引き続き使える）。
 const {revision,...rest}=p;
 const next={...rest,encrypted:encrypt({refresh:fresh.refresh_token}),issuedAt:Date.now()};
 if(Number.isSafeInteger(revision)){
  const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(next),'zoom-private',revision]);
  if(!rows.length)console.error(JSON.stringify({event:'zoom_token_refresh_race',note:'concurrent refresh already saved; not overwriting'}));
 }else{
  await store.put('zoom-private',next);
 }
 return fresh.access_token;
}
export async function safeStatus(store){const p=await privateData(store);return {configured:config(),connected:!!p,email:p?.email||null,connectedAt:p?.connectedAt||null,scopes:p?.scopes||[]};}
// Zoomのjoin_urlのみを返す。ホスト専用start_urlは呼び出し元へ渡さない（外部共有の禁止）。
export async function createMeeting(store,{topic,startIso,durationMin}){
 const p=await privateData(store);if(!p)throw Error('Zoomを接続してください');
 const access=await accessToken(store,p);
 const r=await remote('create_meeting','https://api.zoom.us/v2/users/me/meetings',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
  body:JSON.stringify({topic,type:2,start_time:startIso,duration:durationMin,timezone:'Asia/Tokyo',settings:{join_before_host:true,waiting_room:true,mute_upon_entry:true,approval_type:2}})});
 return {meetingId:String(r.id),joinUrl:r.join_url};
}
export async function updateMeeting(store,meetingId,{topic,startIso,durationMin}){
 const p=await privateData(store);if(!p)throw Error('Zoomを接続してください');
 const access=await accessToken(store,p);
 await remote('update_meeting',`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,{method:'PATCH',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
  body:JSON.stringify({topic,start_time:startIso,duration:durationMin,timezone:'Asia/Tokyo'})});
 return {ok:true};
}
export async function deleteMeeting(store,meetingId){
 const p=await privateData(store);if(!p)throw Error('Zoomを接続してください');
 const access=await accessToken(store,p);
 try{await remote('delete_meeting',`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,{method:'DELETE',headers:{Authorization:`Bearer ${access}`}});}
 catch(e){if(e instanceof ZoomError&&e.code===3001)return {ok:true,alreadyGone:true};throw e;}
 return {ok:true};
}
export async function disconnect(store){await store.query('DELETE FROM ss_documents WHERE name=$1',['zoom-private']);return {ok:true};}
