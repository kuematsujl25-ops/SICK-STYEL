import {productSnapshot,analyzeAmazon} from '../public/amazon-analysis.js';
import {orderInsight} from '../public/amazon-insights.js';
// Amazon Selling Partner API（日本: Far East リージョン）連携。
// 公式のLWA認可（Webサイト認可フロー or セルフ認可）のみ使用し、Amazonのパスワードは扱いません。
// リフレッシュトークンはサーバー側でAES-256-GCM暗号化して保存し、ブラウザーへ返しません。
import {runtime} from '../lib/runtime.js';
import {connectionReadiness} from '../public/integration-status.js';
import {mergeDailyHistory} from '../public/amazon-periods.js';
import {encrypt,decrypt,token,hash} from '../lib/security.js';
export const MARKETPLACE_ID='A1VC38T7YXB528'; // Amazon.co.jp
export const ENDPOINT='https://sellingpartnerapi-fe.amazon.com';
export const SELLER_CENTRAL='https://sellercentral.amazon.co.jp';
const LWA='https://api.amazon.com/auth/o2/token';
const TZ='Asia/Tokyo';
export const SALES_DEFINITION='Amazon Sales API（getOrderMetrics）の totalSales。Amazon.co.jp・購入者区分すべて・FBA/自己発送すべての注文日（日本時間）ベースの注文商品売上で、Amazonの集計値です。返品・返金は差し引かれません（返品は別管理）。キャンセル注文の扱いはAmazon公式資料に明記がないため、キャンセル件数は注文API側で別に表示します。手数料・送料・税の控除後の入金額ではありません。';
export const ORDERS_DEFINITION='Orders API（v2026-01-01 searchOrders）で取得した、集計期間内に作成された注文の件数を配送状況別に集計。キャンセルは CANCELLED として別計上し、未発送は UNSHIPPED・PARTIALLY_SHIPPED です。PENDING（支払い確認待ち）は金額未確定のため売上と一致しない場合があります。';
export class AmazonError extends Error{constructor(code,message){super(message||`Amazon SP-API エラー (${code})。権限・認可状態を確認してください。`);this.code=code;}}
const env=()=>runtime();
export function config(){return !!(env().AMAZON_LWA_CLIENT_ID&&env().AMAZON_LWA_CLIENT_SECRET&&env().TOKEN_ENCRYPTION_KEY);}
export function websiteFlowReady(){return !!(config()&&env().AMAZON_APP_ID&&env().APP_ORIGIN);}
const redirectUri=()=>new URL('/api/amazon/callback',env().APP_ORIGIN).href;
async function remote(url,options={}){let r;try{r=await fetch(url,{...options,signal:AbortSignal.timeout(15000)});}catch{throw new AmazonError('network','Amazonへ接続できませんでした。時間をおいて再試行してください。');}
 let b=null;try{b=await r.json();}catch{}
 if(!r.ok){const code=b?.errors?.[0]?.code||b?.error||r.status;const hint=r.status===403?'権限（ロール）不足、または認可が取り消されています。':r.status===429?'Amazonの呼び出し上限です。数分後に再試行してください。':r.status===400&&b?.error==='invalid_grant'?'認可が無効です。再認可してください。':'';throw new AmazonError(code,`Amazon SP-API エラー (${code})。${hint}`);}
 return b;}
async function privateData(store){const r=await store.doc('amazon-private');return r?JSON.parse(r.body):null;}
async function refreshToken(store){const p=await privateData(store);if(p?.encrypted)return {source:'oauth',token:decrypt(p.encrypted).refresh,p};if(env().AMAZON_REFRESH_TOKEN)return {source:'self',token:env().AMAZON_REFRESH_TOKEN,p:null};return null;}
async function accessToken(refresh){const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh,client_id:env().AMAZON_LWA_CLIENT_ID,client_secret:env().AMAZON_LWA_CLIENT_SECRET});const b=await remote(LWA,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});if(!b?.access_token)throw new AmazonError('lwa','アクセストークンを取得できませんでした');return b.access_token;}
function sp(path,access,params){const u=new URL(path,ENDPOINT);for(const [k,v]of Object.entries(params))if(v!==undefined)u.searchParams.set(k,v);return remote(u,{headers:{'x-amz-access-token':access,'Accept':'application/json','User-Agent':'SICKSTYLE-Manager/1.0 (Language=JavaScript)'}});}
// --- 認可（Webサイト認可フロー） ---
export async function begin(store,session){
 if(!websiteFlowReady())throw Error('Amazonアプリ設定（AMAZON_APP_ID / LWA認証情報 / APP_ORIGIN）が未設定です');
 const s=token();await store.query('DELETE FROM ss_oauth WHERE expires<$1',[Date.now()]);await store.query('INSERT INTO ss_oauth(state,session,expires) VALUES ($1,$2,$3)',[hash('amazon:'+s),session,Date.now()+600000]);
 const u=new URL('/apps/authorize/consent',SELLER_CENTRAL);u.search=new URLSearchParams({application_id:env().AMAZON_APP_ID,state:s,...(env().AMAZON_APP_DRAFT==='false'?{}:{version:'beta'})});return u.href;
}
// Login URI: Seller Centralで同意後にここへ戻り、ログイン中の管理者であることを確認してAmazonへ戻します。
export async function login(store,session,url){
 const callback=url.searchParams.get('amazon_callback_uri')||'';const amazonState=url.searchParams.get('amazon_state')||'';
 let target;try{target=new URL(callback);}catch{throw Error('Amazonからの戻り先が正しくありません');}
 if(target.protocol!=='https:'||!/^sellercentral(-japan)?\.amazon\.co\.jp$/.test(target.hostname)||!amazonState)throw Error('Amazonからの戻り先が正しくありません');
 const s=token();await store.query('INSERT INTO ss_oauth(state,session,expires) VALUES ($1,$2,$3)',[hash('amazon:'+s),session,Date.now()+600000]);
 target.searchParams.set('amazon_state',amazonState);target.searchParams.set('state',s);target.searchParams.set('redirect_uri',redirectUri());if(env().AMAZON_APP_DRAFT!=='false')target.searchParams.set('version','beta');return target.href;
}
export async function connect(store,session,url){
 const rows=await store.query('DELETE FROM ss_oauth WHERE state=$1 AND session=$2 AND expires>$3 RETURNING state',[hash('amazon:'+(url.searchParams.get('state')||'')),session,Date.now()]);if(!rows.length)throw Error('認可の有効期限が切れたか、stateが一致しません');
 const code=url.searchParams.get('spapi_oauth_code');const seller=url.searchParams.get('selling_partner_id')||'';if(!code)throw Error('認可コードがありません');
 const body=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri(),client_id:env().AMAZON_LWA_CLIENT_ID,client_secret:env().AMAZON_LWA_CLIENT_SECRET});
 const b=await remote(LWA,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});if(!b?.refresh_token)throw Error('リフレッシュトークンを取得できませんでした');
 await store.put('amazon-private',{sellerId:/^[A-Z0-9]{1,40}$/.test(seller)?seller:null,encrypted:encrypt({refresh:b.refresh_token}),connectedAt:new Date().toISOString()});
}
export async function safeStatus(store){const p=await privateData(store);const r=await store.doc('amazon-cache');const cache=r?JSON.parse(r.body):null;const self=!p&&!!env().AMAZON_REFRESH_TOKEN;
 const status={configured:config(),websiteFlow:websiteFlowReady(),connected:!!(config()&&(p||self)),authorization:p?'website':self?'self':null,sellerId:p?.sellerId||null,connectedAt:p?.connectedAt||null,marketplace:'Amazon.co.jp ('+MARKETPLACE_ID+')',salesDefinition:SALES_DEFINITION,ordersDefinition:ORDERS_DEFINITION,cache};return {...status,analysis:analyzeAmazon(cache),readiness:connectionReadiness(status,'amazon')};}
// --- 同期 ---
const jstDate=d=>d.toLocaleDateString('sv-SE',{timeZone:TZ});
function addDays(ymd,n){const d=new Date(ymd+'T00:00:00+09:00');d.setUTCDate(d.getUTCDate()+n);return jstDate(d);}
export function salesInterval(now=new Date(),days=31){const today=jstDate(now);const start=addDays(today,-(days-1));const t=new Date(now.getTime()-5*60000);const hm=t.toLocaleTimeString('sv-SE',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false});return {start,end:today,interval:`${start}T00:00:00+09:00--${jstDate(t)}T${hm}:00+09:00`};}
export function parseMetrics(payload){return (payload||[]).map(x=>{const raw=x.totalSales?.amount;const amount=typeof raw==='number'||typeof raw==='string'&&raw.trim()!==''?Number(raw):NaN;return {date:String(x.interval||'').slice(0,10),sales:x.totalSales?.currencyCode==='JPY'&&Number.isFinite(amount)&&amount>=0?amount:null,currency:x.totalSales?.currencyCode||null,orders:Number.isInteger(x.orderCount)&&x.orderCount>=0?x.orderCount:null,units:Number.isInteger(x.unitCount)&&x.unitCount>=0?x.unitCount:null};}).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(Date.parse(x.date))&&new Date(x.date).toISOString().slice(0,10)===x.date);}
export function monthlyMetrics(daily,month){const rows=daily.filter(d=>d.date.startsWith(month));const sum=k=>rows.length&&rows.every(d=>typeof d[k]==='number'&&Number.isFinite(d[k]))?rows.reduce((n,d)=>n+d[k],0):null;return {monthSales:sum('sales'),monthOrders:sum('orders')};}
export function summarizeOrders(orders){const counts={};const open=[];for(const o of orders){const s=o.fulfillment?.fulfillmentStatus||'UNKNOWN';counts[s]=(counts[s]||0)+1;if(['UNSHIPPED','PARTIALLY_SHIPPED'].includes(s))open.push({orderId:String(o.orderId||'').slice(0,40),createdTime:o.createdTime||null,status:s,fulfilledBy:o.fulfillment?.fulfilledBy||null,items:(o.orderItems||[]).reduce((n,i)=>n+(Number(i.quantityOrdered)||0),0)});}open.sort((a,b)=>String(a.createdTime).localeCompare(String(b.createdTime)));return {counts,total:orders.length,open:open.slice(0,50),details:orders.map(orderInsight)};}
async function lease(store){const l=await store.query('INSERT INTO ss_attempts(key,n,expires) VALUES ($1,1,$2) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires WHERE ss_attempts.expires<$3 RETURNING key',['amazon-sync',Date.now()+180000,Date.now()]);if(!l.length)throw Error('Amazonの同期処理中です。完了後に再試行してください');return ()=>store.query('DELETE FROM ss_attempts WHERE key=$1',['amazon-sync']);}
export async function sync(store,now=new Date()){
 if(!config())throw Error('Amazon連携のアプリ設定が未完了です');
 const release=await lease(store);const old=await store.doc('amazon-cache');const cache=old?JSON.parse(old.body):{};
 try{
  const auth=await refreshToken(store);if(!auth)throw Error('Amazonの認可が未完了です');
  const access=await accessToken(auth.token);const warnings=[];const range=salesInterval(now);let salesError=null,ordersError=null;
  let daily=null;try{const m=await sp('/sales/v1/orderMetrics',access,{marketplaceIds:MARKETPLACE_ID,interval:range.interval,granularity:'Day',granularityTimeZone:TZ});if(!Array.isArray(m?.payload))throw new AmazonError('invalid_response');daily=parseMetrics(m.payload);if(daily.length!==m.payload.length||new Set(daily.map(d=>d.date)).size!==daily.length||daily.some(d=>d.date<range.start||d.date>range.end))throw new AmazonError('invalid_response');if(daily.some(d=>d.sales===null||d.orders===null))warnings.push('Sales APIの一部金額・注文数は未取得またはJPY以外です。合計は未取得として扱います。');}catch(e){daily=null;salesError=e.message;warnings.push('売上（Sales API）: '+e.message);}
  // Orders API: 1分あたりの上限が小さいため最大5ページ（500件）まで。
  let orders=null,products=null,truncated=false;try{const list=[];let next;const createdAfter=new Date(range.start+'T00:00:00+09:00').toISOString();for(let page=0;page<5;page++){const r=await sp('/orders/2026-01-01/orders',access,{marketplaceIds:MARKETPLACE_ID,createdAfter,maxResultsPerPage:'100',includedData:'FULFILLMENT,PACKAGES',paginationToken:next});if(!Array.isArray(r?.orders))throw new AmazonError('invalid_response');list.push(...r.orders);next=r.pagination?.nextToken;if(!next)break;}truncated=!!next;if(list.some(o=>!o||typeof o.fulfillment?.fulfillmentStatus!=='string'||!o.fulfillment.fulfillmentStatus.trim()))throw new AmazonError('fulfillment_missing','注文の配送状況を取得できませんでした。前回の取得結果を保持しています。');orders=summarizeOrders(list);products=productSnapshot(list);}catch(e){ordersError=e.message;warnings.push('注文（Orders API）: '+e.message);}
  if(!daily&&!orders)throw new AmazonError('all',warnings.join(' / '));
  const month=jstDate(now).slice(0,7);
  const stamp=new Date().toISOString(),period={start:range.start,end:range.end,timeZone:TZ};
  const monthly=daily?monthlyMetrics(daily,month):{monthSales:cache.monthSales??null,monthOrders:cache.monthOrders??null};
  const syncVerified=!!(daily&&orders&&daily.length&&daily.every(d=>d.sales!==null&&d.orders!==null));
  const next={...cache,syncedAt:syncVerified?stamp:cache.syncedAt??null,attemptedAt:stamp,error:null,warnings,syncVerified,salesError,ordersError,
   period:daily&&orders?period:cache.period??null,salesPeriod:daily?period:cache.salesPeriod??null,ordersPeriod:orders?period:cache.ordersPeriod??null,
   salesSyncedAt:daily?stamp:cache.salesSyncedAt??null,ordersSyncedAt:orders?stamp:cache.ordersSyncedAt??null,
   // 旧いキャッシュ（dailyHistoryフィールド導入前）はdailyだけに過去のローリングウィンドウが入っている。
   // dailyHistoryが存在しない場合はdailyを種にしてから新しいレスポンスをマージすることで、アップグレード時に
   // それまで取得済みだった日付が消えてしまわないようにする（Codex独立レビュー指摘）。
   daily:daily??cache.daily??null,dailyHistory:daily?mergeDailyHistory(cache.dailyHistory??cache.daily,daily):cache.dailyHistory??null,
   products:products??cache.products??null,...monthly,month:daily?month:cache.month??null,orders:orders??cache.orders??null,ordersTruncated:orders?truncated:cache.ordersTruncated??false};
  await store.put('amazon-cache',next);return next;
 }catch(e){await store.put('amazon-cache',{...cache,syncVerified:false,error:e.message,attemptedAt:new Date().toISOString()});throw e;}finally{await release();}
}
export async function disconnect(store){await store.transaction([['DELETE FROM ss_documents WHERE name IN ($1,$2)',['amazon-private','amazon-cache']]]);return {ok:true,warning:env().AMAZON_REFRESH_TOKEN?'セルフ認可のトークン（AMAZON_REFRESH_TOKEN）はCloudflareのSecretsから削除してください。':'Seller Centralの「アプリとサービス」メニュー内の認可済みアプリの管理画面からも認可を取り消せます。'};}
