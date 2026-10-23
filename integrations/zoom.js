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
 let encrypted;
 try{encrypted=encrypt({refresh:raw.refresh_token});}
 catch(e){console.error(JSON.stringify({event:'zoom_storage_failure',stage:'encryption',type:e?.name||'unknown'}));throw new ZoomError('encryption_failed','保存用の暗号化処理で失敗しました。暗号化鍵の形式とWorker実行環境を確認してください。','encryption');}
 const data={userId:me.id,email:me.email,encrypted,issuedAt:Date.now(),connectedAt:new Date().toISOString(),scopes:granted};
 try{await store.put('zoom-private',data);}
 catch(e){console.error(JSON.stringify({event:'zoom_storage_failure',stage:'database_write',type:e?.name||'unknown'}));throw new ZoomError('database_write_failed','Zoom認可情報をD1へ保存できませんでした。D1接続とDB書き込み権限を確認してください。','database_write');}
 return data;
}
// Zoomはrefresh_tokenをローテーションする（1回使うと無効になる）。保存だけをCAS（revision一致）にしても、
// 「交換そのもの」は排他制御されない：2つの会議同期が同時に同じ古いrefresh_tokenを読んで両方とも
// 交換してしまうと、Zoom側のローテーション仕様次第では、先にDBへ保存できた側のトークンを、後から行われた
// もう一方の交換が無効化してしまう恐れがある（Codex独立レビュー指摘：DB書き込み順を守るだけでは不十分）。
// そこでリース（refreshing）をCASで取得してから交換する。他の呼び出しが既にリース保持中なら、自分では
// 交換せず少し待って再試行する（長すぎるリースは異常終了とみなし20秒で放棄）。
async function acquireRefreshLease(store){
 for(let attempt=0;attempt<4;attempt++){
  const current=await privateData(store);
  if(!current)throw Error('Zoomを接続してください');
  const {revision,refreshing,...rest}=current;
  if(refreshing&&Date.now()-refreshing<20000){await new Promise(r=>setTimeout(r,250));continue;}
  const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',
   [JSON.stringify({...rest,refreshing:Date.now()}),'zoom-private',revision]);
  if(rows.length)return {...rest,revision:rows[0].revision};
 }
 throw new ZoomError('token_refresh_busy','Zoom接続の更新が他の処理と混み合っています。少し待って再試行してください','token_refresh');
}
// 交換前・交換失敗時のリース解放専用。保存されているトークン自体は変わっていないので、
// 解放に失敗しても実害はなく、20秒のリース期限切れで自然に回収される（ベストエフォートでよい）。
async function releaseLeaseOnly(store,leased){
 // store.query()はバックエンド（ローカルSQLiteは同期・本番Postgresは非同期）によって返り値の形が異なるため、
 // 必ずawaitしてからtry/catchで囲む（.catch()を直接チェーンしない）。
 try{await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3',
  [JSON.stringify({...leased,revision:undefined,refreshing:null}),'zoom-private',leased.revision]);}
 catch{/* リース解放のみの失敗は無害 */}
}
async function accessToken(store){
 const auth='Basic '+Buffer.from(`${runtime().ZOOM_CLIENT_ID}:${runtime().ZOOM_CLIENT_SECRET}`).toString('base64');
 const leased=await acquireRefreshLease(store);
 const {refresh}=decrypt(leased.encrypted);
 const form=new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh});
 let fresh;
 try{fresh=await remote('token_refresh','https://zoom.us/oauth/token',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/x-www-form-urlencoded'},body:form});}
 catch(e){await releaseLeaseOnly(store,leased);throw e;}
 if(!fresh.access_token||!fresh.refresh_token){await releaseLeaseOnly(store,leased);throw new ZoomError('token_response_incomplete','Zoomトークンの更新に失敗しました。再接続してください','token_refresh');}
 // ここから先、Zoomは既にrefresh_tokenをローテーション済み（古いトークンはもう無効）。新しいトークンの
 // 保存に失敗すると、次回の更新がDB上の古い（無効な）トークンで試みられ、接続が完全に壊れる。これは
 // 「リース解放の失敗」として握りつぶしてはいけない（Codex独立レビュー指摘：以前は握りつぶしてaccess_token
 // だけ返しており、20秒待っても失われた新トークンが戻ってくるわけではなかった）。保存を1回だけ再試行し、
 // それでも失敗すれば、呼び出し元にこの処理自体を失敗させ、再接続が必要なことを明示する。
 const newCredential=JSON.stringify({...leased,revision:undefined,refreshing:null,encrypted:encrypt({refresh:fresh.refresh_token}),issuedAt:Date.now()});
 let saved=false;
 for(let attempt=0;attempt<2&&!saved;attempt++){
  if(attempt>0)await new Promise(r=>setTimeout(r,300));
  try{
   const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[newCredential,'zoom-private',leased.revision]);
   saved=rows.length>0;
  }catch{}
 }
 if(!saved){
  console.error(JSON.stringify({event:'zoom_token_persist_failed',note:'rotated refresh_token could not be saved; connection requires reconnect'}));
  throw new ZoomError('token_persist_failed','Zoomの新しい認可情報を保存できませんでした。接続が壊れている可能性があるため、設定画面から「接続を解除」→再接続してください','token_refresh');
 }
 return fresh.access_token;
}
// 管理者が明示的に実行する非破壊診断。認証コード/Zoomトークンは不要。
export async function storageDiagnostics(store){
 let ciphertext;
 try{ciphertext=encrypt({refresh:'local-diagnostic-only'});const v=decrypt(ciphertext);if(v.refresh!=='local-diagnostic-only')throw Error('cipher round-trip failed');}
 catch(e){console.error(JSON.stringify({event:'zoom_diagnostic',stage:'encryption',type:e?.name||'unknown'}));return {ok:false,stage:'encryption',code:'encryption_failed'};}
 // 一意の検証キーをトランザクション内で挿入→削除。業務データも既存トークンも変更しない。
 const key='zoom-storage-check:'+token();
 try{
  const result=await store.transaction([
   ['INSERT INTO ss_documents(name,body) VALUES ($1,$2) RETURNING name',[key,JSON.stringify({encrypted:ciphertext})]],
   ['DELETE FROM ss_documents WHERE name=$1 RETURNING name',[key]]
  ]);
  if(result?.[0]?.[0]?.name!==key||result?.[1]?.[0]?.name!==key)throw Error('transaction verification failed');
 }catch(e){console.error(JSON.stringify({event:'zoom_diagnostic',stage:'database_write',type:e?.name||'unknown'}));return {ok:false,stage:'database_write',code:'database_write_failed'};}
 return {ok:true,stage:'ready',code:'ready'};
}
export async function safeStatus(store){const p=await privateData(store);return {configured:config(),connected:!!p,email:p?.email||null,connectedAt:p?.connectedAt||null,scopes:p?.scopes||[]};}
// Zoomのjoin_urlのみを返す。ホスト専用start_urlは呼び出し元へ渡さない（外部共有の禁止）。
export async function createMeeting(store,{topic,startIso,durationMin}){
 const p=await privateData(store);if(!p)throw Error('Zoomを接続してください');
 const access=await accessToken(store);
 const r=await remote('create_meeting','https://api.zoom.us/v2/users/me/meetings',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
  body:JSON.stringify({topic,type:2,start_time:startIso,duration:durationMin,timezone:'Asia/Tokyo',settings:{join_before_host:true,waiting_room:true,mute_upon_entry:true,approval_type:2}})});
 // remote()はHTTP応答自体は成功（2xx）でも、本文の読み取り（response.json()）が途中で失敗した場合はnullを
 // 返す。Zoomは会議を作成済みの可能性が高いのに、ここでTypeErrorとして投げてしまうと、呼び出し元
 // （lib/meeting-sync.js）は通常のZoomErrorとの区別ができず、確定失敗として再試行してしまい、作成済みの
 // 会議が孤立したまま重複作成される恐れがある（Codex独立レビュー指摘）。専用のエラーコードで区別する。
 if(!r||typeof r.id!=='number'&&typeof r.id!=='string')
  throw new ZoomError('response_body_unreadable','Zoomからの応答本文を読み取れませんでした。会議が作成されている可能性があります','create_meeting');
 return {meetingId:String(r.id),joinUrl:r.join_url};
}
export async function updateMeeting(store,meetingId,{topic,startIso,durationMin}){
 const p=await privateData(store);if(!p)throw Error('Zoomを接続してください');
 const access=await accessToken(store);
 await remote('update_meeting',`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,{method:'PATCH',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
  body:JSON.stringify({topic,start_time:startIso,duration:durationMin,timezone:'Asia/Tokyo'})});
 return {ok:true};
}
export async function deleteMeeting(store,meetingId){
 const p=await privateData(store);if(!p)throw Error('Zoomを接続してください');
 const access=await accessToken(store);
 try{await remote('delete_meeting',`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,{method:'DELETE',headers:{Authorization:`Bearer ${access}`}});}
 catch(e){if(e instanceof ZoomError&&e.code===3001)return {ok:true,alreadyGone:true};throw e;}
 return {ok:true};
}
export async function disconnect(store){await store.query('DELETE FROM ss_documents WHERE name=$1',['zoom-private']);return {ok:true};}
