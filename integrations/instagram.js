import {fetchNoRedirect} from '../lib/fetch-no-redirect.js';
import {InstagramCallbackError,atCallbackStep,exchangeUnified,unifiedGraph,unifiedLogin,unifiedSettings} from './instagram-unified.js';
import {runtime} from '../lib/runtime.js';
import {connectionReadiness} from '../public/integration-status.js';
import {createHmac} from 'node:crypto';
import {encrypt,decrypt,equal,token,hash} from '../lib/security.js';
export const scopes=['instagram_business_basic','instagram_business_manage_insights'];
export const version=()=>runtime().META_API_VERSION||'v26.0';
const mode=()=>runtime().INSTAGRAM_LOGIN_MODE||'legacy';
export function config(){const e=runtime();return mode()==='unified'?!!unifiedSettings(e):mode()==='legacy'&&!!(e.INSTAGRAM_APP_ID&&e.INSTAGRAM_APP_SECRET&&e.APP_ORIGIN&&e.TOKEN_ENCRYPTION_KEY);}
const callback=()=>new URL('/api/instagram/callback',runtime().APP_ORIGIN).href;
export class MetaError extends Error{constructor(code){super(`Meta API エラー (${code})。権限・期限・対象データを確認してください。`);this.code=code;}}
async function remote(url,options={}){let response;try{response=await fetchNoRedirect(url,{cache:'no-store',...options,signal:AbortSignal.timeout(12000)});}catch{throw new MetaError('通信失敗');}let b;try{b=await response.json();}catch{throw new MetaError(response.status);}if(!response.ok||b.error||b.error_type)throw new MetaError(Number.isSafeInteger(b.error?.code)?b.error.code:Number.isSafeInteger(b.code)?b.code:response.status);return b;}
export function graph(id,access,params={},method='GET'){
 const u=new URL(`https://graph.instagram.com/${version()}/${id}`);for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
 return remote(u,{method,headers:{Authorization:`Bearer ${access}`}});
}
export async function begin(store,session){
 if(!config())throw Error('Metaアプリの環境変数が未設定です');
 const selected=mode();const s=selected+'.'+token();await store.query('DELETE FROM ss_oauth WHERE expires<$1',[Date.now()]);await store.query('INSERT INTO ss_oauth(state,session,expires) VALUES ($1,$2,$3)',[hash(s),session,Date.now()+600000]);
 if(selected==='unified')return unifiedLogin(unifiedSettings(runtime()),s);
 const u=new URL('https://www.instagram.com/oauth/authorize');u.search=new URLSearchParams({client_id:runtime().INSTAGRAM_APP_ID,redirect_uri:callback(),response_type:'code',scope:[...scopes,...(runtime().INSTAGRAM_ENABLE_MESSAGING==='true'?['instagram_business_manage_messages']:[])].join(','),state:s,enable_fb_login:'0',force_reauth:'true'});return u.href;
}
export async function connect(store,session,url){
 if(!config())throw Error('Metaアプリの環境変数が未設定です');
 const selected=mode(), state=url.searchParams.get('state')||'';
 if(!state.startsWith(selected+'.'))throw new InstagramCallbackError('state_mode','認可stateの接続方式が一致しません');
 const release=await acquireConnectionLease(store);try{
 const rows=await store.query('DELETE FROM ss_oauth WHERE state=$1 AND session=$2 AND expires>$3 RETURNING state',[hash(state),session,Date.now()]);if(!rows.length)throw new InstagramCallbackError('state_session','認可の有効期限が切れたか、stateが一致しません');
 if(url.searchParams.has('error'))throw new InstagramCallbackError('meta_declined','Instagramの認可がキャンセルされました');
 const code=url.searchParams.get('code');if(!code)throw new InstagramCallbackError('missing_code','認可コードがありません');
 const previous=await privateData(store);
 if(previous&&(previous.provider||'legacy')!==selected)throw new InstagramCallbackError('connection_conflict','接続方式を変更する場合は、先に現在の接続を解除してください');
 if(selected==='unified'){
  const material=await exchangeUnified(unifiedSettings(runtime()),code,remote);
  if(previous&&previous.id!==material.id)throw new InstagramCallbackError('connection_conflict','別のアカウントに切り替える場合は、先に現在の接続を解除してください');
  const {access,...bound}=material;
  return await atCallbackStep('save_connection',async()=>{
   const data={...bound,provider:'unified',scopedId:null,encrypted:encrypt({access}),issuedAt:Date.now(),connectedAt:previous?.connectedAt||new Date().toISOString(),dmStartedAt:null,webhookError:null};
   await store.put('instagram-private',data);return data;
  });
 }
 const form=new FormData();for(const [k,v]of Object.entries({client_id:runtime().INSTAGRAM_APP_ID,client_secret:runtime().INSTAGRAM_APP_SECRET,grant_type:'authorization_code',redirect_uri:callback(),code}))form.set(k,v);
 const raw=await remote('https://api.instagram.com/oauth/access_token',{method:'POST',body:form});const short=raw.data?.[0]||raw;
 if(!short.access_token)throw Error('認可トークンを取得できませんでした');
 const u=new URL('https://graph.instagram.com/access_token');u.search=new URLSearchParams({grant_type:'ig_exchange_token',client_secret:runtime().INSTAGRAM_APP_SECRET,access_token:short.access_token});
 const long=await remote(u);if(!long.access_token||!long.expires_in)throw Error('長期トークンを取得できませんでした');
 const profile=await graph('me',long.access_token,{fields:'id,user_id,username'});const id=String(profile.user_id||profile.id||short.user_id);if(!/^\d+$/.test(id))throw Error('アカウントIDが正しくありません');
 if(runtime().INSTAGRAM_ALLOWED_USER_ID&&id!==runtime().INSTAGRAM_ALLOWED_USER_ID)throw Error('許可されたInstagramアカウントと一致しません');
 if(previous&&previous.id!==id)throw Error('別のアカウントに切り替える場合は、先に現在の接続を解除してください');
 const granted=Array.isArray(short.permissions)?short.permissions:String(short.permissions||'').split(',').filter(Boolean);
 const data={id,scopedId:profile.id?String(profile.id):null,username:profile.username,granted,encrypted:encrypt({access:long.access_token}),issuedAt:Date.now(),expiresAt:Date.now()+long.expires_in*1000,connectedAt:previous?.connectedAt||new Date().toISOString(),dmStartedAt:previous?.dmStartedAt||null,webhookError:null};
 if(runtime().INSTAGRAM_ENABLE_MESSAGING==='true'&&granted.includes('instagram_business_manage_messages')){
  try{await graph(`${id}/subscribed_apps`,long.access_token,{subscribed_fields:'messages'},'POST');data.dmStartedAt=data.dmStartedAt||new Date().toISOString();}catch(e){data.webhookError=e.message;}
 }
 await store.put('instagram-private',data);
 return data;
 }finally{await release();}
}
async function privateData(store){const r=await store.doc('instagram-private');return r?JSON.parse(r.body):null;}
export async function safeStatus(store){const p=await privateData(store);const r=await store.doc('instagram-cache');const cache=r?JSON.parse(r.body):null;
 let dm=null;if(p?.dmStartedAt){const rows=await store.query('SELECT peer,MAX(CASE WHEN incoming=1 THEN ts ELSE 0 END) AS received,MAX(CASE WHEN incoming=0 THEN ts ELSE 0 END) AS replied FROM ss_events GROUP BY peer');dm=rows.filter(r=>Number(r.received)>Number(r.replied)).length;}
 const provider=p?(p.provider||'legacy'):mode();
 const status={configured:config(),provider,connected:!!p,username:p?.username||null,expiresAt:p?.expiresAt||null,granted:p?.granted||[],dmStartedAt:p?.dmStartedAt||null,dmPending:dm,dmDefinition:'集計開始以降に受信Webhookで観測し、送信イベントまたは手動で対応済みにしていない会話数。Instagramの未読件数や受信箱全体ではありません。',webhookError:p?.webhookError||null,cache,apiVersion:provider==='unified'?'v27.0':version()};return {...status,readiness:connectionReadiness(status,'instagram')};
}
export function breakdownValues(response,name){const m=response.data?.find(x=>x.name===name);const rows=m?.total_value?.breakdowns?.[0]?.results;if(!Array.isArray(rows))return null;const out={};for(const r of rows){const k=String(r.dimension_values?.[0]||'');if(typeof r.value==='number')out[k]=r.value;}return out;}
export function metricValue(response,name){const m=response.data?.find(x=>x.name===name);const n=m?.total_value?.value??m?.values?.[0]?.value;return typeof n==='number'&&Number.isFinite(n)?n:null;}
async function acquireConnectionLease(store){
 const lease=await store.query('INSERT INTO ss_attempts(key,n,expires) VALUES ($1,1,$2) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires WHERE ss_attempts.expires<$3 RETURNING key',['instagram-sync',Date.now()+180000,Date.now()]);
 if(!lease.length)throw Error('Instagramの同期・接続処理中です。完了後に再試行してください');
 return ()=>store.query('DELETE FROM ss_attempts WHERE key=$1',['instagram-sync']);
}
// Conversations API（過去履歴）による対応待ちDMの推定。最新メッセージの送信者が相手の会話を「対応待ち」とします。
// 公式の制限: 詳細取得は各会話の最新20件のみ、リクエストフォルダで30日間動きのない会話は返りません。
export const DM_DAYS=30;
export async function pendingConversations(call,access,own,budget,warnings,now=Date.now()){
 try{
  const since=now-DM_DAYS*86400000;
  const list=await call('me/conversations',access,{platform:'instagram',fields:'updated_time,messages.limit(1){from,created_time}',limit:'25'});
  const recent=(list.data||[]).filter(c=>Date.parse(c.updated_time)>=since);let pending=0,checked=0,unknown=0,budgetLimited=false;
  for(const c of recent){
   let last=c.messages?.data?.[0];
   if(!last?.from){if(budget()<2){unknown++;budgetLimited=true;continue;}try{const m=await call(c.id,access,{fields:'messages'});const id=m.messages?.data?.[0]?.id;last=id?await call(id,access,{fields:'from,created_time'}):null;}catch{last=null;}}
   if(!last?.from?.id){unknown++;continue;}checked++;const mine=own.ids.includes(String(last.from.id))||(!!own.username&&last.from.username===own.username);if(!mine)pending++;
  }
  return {pending,checked,unknown,periodDays:DM_DAYS,truncated:!!list.paging?.next,budgetLimited,checkedAt:new Date(now).toISOString()};
 }catch(e){warnings.push('DM（Conversations API）: '+e.message);return null;}
}
// 29 core graph calls (profile, two account insights, media and <=25 reels)
 // plus at most one legacy token refresh. Reserve optional DM detail last.
export async function sync(store,{maxRequests=45}={}){
 if(!Number.isSafeInteger(maxRequests)||maxRequests<30||maxRequests>45)throw Error('Instagramの通信枠が不正です');
 const release=await acquireConnectionLease(store);let used=0;let provider='legacy';
 const consume=()=>{if(used>=maxRequests)throw Error('Instagramの通信枠に達しました');used++;};
 const call=(id,access,params={})=>{consume();return provider==='unified'?unifiedGraph(id,access,params,remote):graph(id,access,params);};
 let cache={};
 try{
  let p=await privateData(store);if(!p)throw Error('Instagramを接続してください');
  const old=await store.doc('instagram-cache');cache=old?JSON.parse(old.body):{};
  provider=p.provider||'legacy';
  if(provider==='unified'){
   const expected=mode()==='unified'?unifiedSettings(runtime()):null;
   if(!expected||p.configId!==expected.configId||p.businessId!==expected.businessId||p.username?.toLowerCase()!==expected.username)throw Error('統合ログイン設定が変更されました。再接続してください');
  }
  if(p.expiresAt<=Date.now())throw Error('Instagramの認可期限が切れました。再接続してください');
  let {access}=decrypt(p.encrypted);
  if(provider==='legacy'&&p.expiresAt-Date.now()<7*86400000&&Date.now()-p.issuedAt>86400000){const u=new URL('https://graph.instagram.com/refresh_access_token');u.search=new URLSearchParams({grant_type:'ig_refresh_token',access_token:access});consume();const fresh=await remote(u);if(!fresh.access_token||!fresh.expires_in)throw Error('トークン更新に失敗しました');access=fresh.access_token;p={...p,encrypted:encrypt({access}),issuedAt:Date.now(),expiresAt:Date.now()+fresh.expires_in*1000};await store.put('instagram-private',p);}
  const warnings=[];let followers=null;
  try{const profile=await call(p.id,access,{fields:provider==='unified'?'id,username,followers_count':'user_id,username,followers_count'});followers=typeof profile.followers_count==='number'?profile.followers_count:null;}catch(e){warnings.push('フォロワー数: '+e.message);}
  // アカウント全体の指標（直近30日・total_value）。100フォロワー未満では follows_and_unfollows は返りません。
  const until=Math.floor(Date.now()/1000),since=until-30*86400;const account={since:new Date(since*1000).toISOString(),until:new Date(until*1000).toISOString(),follows:null,unfollows:null,reach:null,views:null,accounts_engaged:null,total_interactions:null};
  try{const r=await call(`${p.id}/insights`,access,{metric:'follows_and_unfollows',period:'day',metric_type:'total_value',breakdown:'follow_type',since:String(since),until:String(until)});const fb=breakdownValues(r,'follows_and_unfollows');if(fb){account.follows=fb.FOLLOWER??null;account.unfollows=fb.NON_FOLLOWER??null;}}catch(e){warnings.push('フォロー/フォロー解除（30日）: '+e.message);}
  try{const r=await call(`${p.id}/insights`,access,{metric:'reach,views,accounts_engaged,total_interactions',period:'day',metric_type:'total_value',since:String(since),until:String(until)});for(const n of ['reach','views','accounts_engaged','total_interactions'])account[n]=metricValue(r,n);}catch(e){warnings.push('アカウント指標（30日）: '+e.message);}
  const media=await call(`${p.id}/media`,access,{fields:'id,caption,media_product_type,timestamp,permalink',limit:'25'});
  if(!Array.isArray(media?.data))throw new MetaError('invalid_response');
  const reels=[]; // Limit the visible scope honestly to the latest 25 media, avoiding unbounded sync work.
  const source=media.data.slice(0,25).filter(x=>x.media_product_type==='REELS');
  for(let offset=0;offset<source.length;offset+=5){const group=await Promise.all(source.slice(offset,offset+5).map(async m=>{
   const values={};let response;
   try{response=await call(`${m.id}/insights`,access,{metric:'views,reach,total_interactions,likes,comments,saved,shares'});for(const n of ['views','reach','total_interactions','likes','comments','saved','shares'])values[n]=metricValue(response,n);}
   catch(e){for(const n of ['views','reach','total_interactions','likes','comments','saved','shares'])values[n]=null;warnings.push(`リール ${m.id}: ${e.message}`);}
   return {id:m.id,caption:m.caption||'リール',timestamp:m.timestamp,permalink:m.permalink,values};
  }));reels.push(...group);}
  const dm=provider==='legacy'&&p.granted?.includes('instagram_business_manage_messages')?await pendingConversations(call,access,{ids:[p.id,p.scopedId].filter(Boolean).map(String),username:p.username},()=>maxRequests-used,warnings):null;
  const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});const history=(cache.history||[]).filter(x=>x.date!==day);const previous=history.at(-1);if(followers!==null)history.push({date:day,followers});
  const stamp=new Date().toISOString();const insightsVerified=['reach','views','accounts_engaged','total_interactions','follows','unfollows'].some(k=>Number.isFinite(account[k]))||reels.some(r=>Object.values(r.values).some(Number.isFinite));
  const syncVerified=Number.isFinite(followers)&&insightsVerified;
  const next={syncedAt:syncVerified?stamp:cache.syncedAt??null,attemptedAt:stamp,syncVerified,profileSyncedAt:Number.isFinite(followers)?stamp:null,insightsSyncedAt:insightsVerified?stamp:null,error:null,warnings,followers,delta:followers!==null&&previous?followers-previous.followers:null,deltaSince:previous?.date||null,history:history.slice(-730),reels,dm,account,scope:'最新25件のメディアに含まれるリール（Instagramのオーガニック実績・累計）',hasMore:!!media.paging?.next};await store.put('instagram-cache',next);return next;
 }catch(e){if(await privateData(store))await store.put('instagram-cache',{...cache,syncVerified:false,error:e.message,attemptedAt:new Date().toISOString()});throw e;}finally{await release();}
}
export async function disconnect(store){const release=await acquireConnectionLease(store);try{const p=await privateData(store);let revokeError=null;if(p?.provider==='unified'){revokeError='管理アプリの接続は解除しました。Meta Business Suiteのビジネス連携からも、このアプリのアクセスを取り消してください。';}else if(p){try{await graph(`${p.id}/permissions`,decrypt(p.encrypted).access,{},'DELETE');}catch{revokeError='ローカル接続は解除しました。Meta側の認可取消に失敗したため、Instagramの「アプリとウェブサイト」からも削除してください。';}}
 await store.transaction([['DELETE FROM ss_documents WHERE name IN ($1,$2)',['instagram-private','instagram-cache']],['DELETE FROM ss_events'],['DELETE FROM ss_oauth']]);return {ok:true,warning:revokeError};}finally{await release();}}
export function verifySignature(raw,signature,secret){if(!secret||!/^sha256=[a-f0-9]{64}$/.test(signature||''))return false;return equal(signature,'sha256='+createHmac('sha256',secret).update(raw).digest('hex'));}
export async function receiveWebhook(store,payload){const p=await privateData(store);if(!p?.dmStartedAt||payload.object!=='instagram')return;
 const commands=[];
 for(const entry of payload.entry||[]){if(String(entry.id)!==p.id)continue;for(const e of entry.messaging||[]){const m=e.message;if(!m?.mid||m.is_deleted||m.is_self)continue;const ts=Number(e.timestamp);if(!Number.isFinite(ts)||ts<Date.parse(p.dmStartedAt)||ts>Date.now()+300000)continue;const incoming=String(e.recipient?.id)===p.id&&!m.is_echo;const outgoing=String(e.sender?.id)===p.id||m.is_echo;const peer=incoming?String(e.sender?.id||''):String(e.recipient?.id||'');if(!peer||peer===p.id||(!incoming&&!outgoing))continue;commands.push(['INSERT INTO ss_events(mid,peer,ts,incoming) VALUES ($1,$2,$3,$4) ON CONFLICT(mid) DO NOTHING',[String(m.mid),peer,ts,incoming?1:0]]);}}
 if(commands.length)await store.transaction(commands);
}
export async function resolveConversation(store,peer){if(!/^\d{1,100}$/.test(peer))throw Error('会話IDが正しくありません');await store.query('INSERT INTO ss_events(mid,peer,ts,incoming) VALUES ($1,$2,$3,0)',[token(),peer,Date.now()]);}
