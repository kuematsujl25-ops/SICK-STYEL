// Amazon Ads is independent from SP-API. No campaign/advertising writes are implemented.
import {runtime} from '../lib/runtime.js';
import {randomUUID} from 'node:crypto';
const NAME='amazonads-reports',host='https://advertising-api-fe.amazon.com';
const configured=()=>['CLIENT_ID','CLIENT_SECRET','REFRESH_TOKEN','PROFILE_ID'].every(k=>!!runtime()['AMAZON_ADS_'+k]);
const read=async store=>{const r=await store.doc(NAME);return {revision:r?.revision||0,state:r?JSON.parse(r.body):{rows:[],job:null,lastSuccess:null,error:null}};};
async function cas(store,revision,state){if(new TextEncoder().encode(JSON.stringify(state)).length>1_500_000)throw Error('広告保存容量の上限です。既存データを保持します');const r=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(state),NAME,revision]);if(!r.length)throw Error('広告同期中です。後で状態を確認してください');return r[0].revision;}
export async function status(store){const {state}=await read(store);return {configured:configured(),connected:configured()&&state.profileVerified===runtime().AMAZON_ADS_PROFILE_ID,lastSuccess:state.lastSuccess,error:state.error,job:state.job?{status:state.job.status,start:state.job.start,end:state.job.end}:null,rows:state.rows,scope:'Sponsored Products / 日本・JPY・Asia/Tokyo',automatic:runtime().AMAZON_ADS_SYNC_ENABLED==='true'};}
const day=d=>new Date(d).toISOString().slice(0,10);
export function reportingWindow(now=new Date()){const end=new Date(now.toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})+'T00:00:00Z');end.setUTCDate(end.getUTCDate()-1);return {start:day(end.getTime()-30*86400000),end:day(end)};}
export function normalizeReport(rows,{profileId,windowDays,start,end}){
 if(!Array.isArray(rows)||rows.length>50000)throw Error('広告レポート形式を確認してください');const ids=new Set();
 return rows.map(r=>{const date=r.date,campaignId=String(r.campaignId||'');if(!/^\d{4}-\d\d-\d\d$/.test(date)||!Number.isFinite(Date.parse(date))||day(date)!==date||date<start||date>end||!campaignId)throw Error('広告レポートの日付・キャンペーンが不正です');
  const number=v=>v===null||v===undefined?null:typeof v==='number'&&Number.isFinite(v)&&v>=0?v:(()=>{throw Error('広告金額の形式が不正です');})();
  const id=profileId+'|SP|'+date+'|'+campaignId;if(ids.has(id))throw Error('広告レポートに重複行があります');ids.add(id);
  return {id,platform:'Amazon',source:'api',profileId,adProduct:'SP',currency:'JPY',timeZone:'Asia/Tokyo',periodStart:date,periodEnd:date,attributionWindowDays:windowDays,adCost:number(r.cost),attributedSales:number(r['sales'+windowDays+'d']),campaign:String(r.campaignName||campaignId).slice(0,200)};
 });
}
export async function sync(store,{fetcher=fetch,now=new Date()}={}){
 if(!configured())throw Error('Amazon Ads専用の認可・プロフィール設定が未完了です。SP-API認証は流用しません');
 await store.query('INSERT INTO ss_documents(name,body,revision) VALUES ($1,$2,0) ON CONFLICT(name) DO NOTHING',[NAME,JSON.stringify({rows:[],job:null,lastSuccess:null,error:null})]);
 let {state,revision}=await read(store);if(state.retryAt&&Date.parse(state.retryAt)>now.getTime())throw Error('広告APIの再試行待ちです。しばらくしてから確認してください');if(state.profileVerified&&state.profileVerified!==runtime().AMAZON_ADS_PROFILE_ID)throw Error('広告プロフィールが変わりました。既存データの移行確認が必要です');if(state.job?.status==='requesting'||state.job?.status==='uncertain')throw Error('前回のレポート要求の結果確認が必要です。再要求しません');
 const api=async(url,opts={},allowDuplicate=false)=>{const r=await fetcher(url,{...opts,redirect:'error',signal:AbortSignal.timeout(15000)});if(allowDuplicate&&r.status===425)return r;if(!r.ok)throw Object.assign(Error('Amazon Ads応答 '+r.status),{httpStatus:r.status});return r;};
 try{
  const tokens=await (await api('https://api.amazon.com/auth/o2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:runtime().AMAZON_ADS_CLIENT_ID,client_secret:runtime().AMAZON_ADS_CLIENT_SECRET,refresh_token:runtime().AMAZON_ADS_REFRESH_TOKEN})})).json();
  if(!tokens.access_token)throw Error('Amazon Ads認証応答が不正です');
  const headers={Authorization:'Bearer '+tokens.access_token,'Amazon-Advertising-API-ClientId':runtime().AMAZON_ADS_CLIENT_ID,'Amazon-Advertising-API-Scope':runtime().AMAZON_ADS_PROFILE_ID};
  const profiles=await (await api(host+'/v2/profiles',{headers})).json();const p=profiles.find(p=>String(p.profileId)===runtime().AMAZON_ADS_PROFILE_ID);
  if(!p||p.countryCode!=='JP'||p.currencyCode!=='JPY'||p.timezone!=='Asia/Tokyo'||!['seller','vendor'].includes(p.accountInfo?.type))throw Error('日本・JPY・Asia/Tokyoの広告プロフィールを確認してください');
  state.profileVerified=String(p.profileId);
  if(!state.job){const w=reportingWindow(now);state.job={...w,status:'requesting',windowDays:p.accountInfo.type==='seller'?7:14,profileId:String(p.profileId),requestId:randomUUID()};revision=await cas(store,revision,state);
   try{const response=await api(host+'/reporting/reports',{method:'POST',headers:{...headers,'Content-Type':'application/vnd.createasyncreportrequest.v3+json'},body:JSON.stringify({name:'SICKSTYLE daily SP',startDate:w.start,endDate:w.end,configuration:{adProduct:'SPONSORED_PRODUCTS',groupBy:['campaign'],columns:['date','campaignId','campaignName','cost','sales'+state.job.windowDays+'d'],reportTypeId:'spCampaigns',timeUnit:'DAILY',format:'GZIP_JSON'}})},true);const b=await response.json();const id=b.reportId||(response.status===425&&typeof b.detail==='string'?b.detail.match(/duplicate of\s*:?\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i)?.[1]:null);if(typeof id!=='string'||!id||id.length>200)throw Error('レポートID未取得');state.job.id=id;state.job.status='pending';state.error=null;await cas(store,revision,state);return status(store);}
   catch(e){if([400,401,403,422,429].includes(e.httpStatus)){state.job=null;state.retryAt=new Date(now.getTime()+60000).toISOString();state.error='レポート要求が拒否されました（HTTP '+e.httpStatus+'）。設定・利用制限を確認し、1分以上空けて再試行してください';}else{state.job.status='uncertain';state.error='レポート要求の結果が不明です。自動再要求を停止しました';}await cas(store,revision,state);throw Error(state.error);}
  }
  if(state.job.profileId!==String(p.profileId))throw Error('広告プロフィールが変わりました。既存ジョブを確認してください');
  const report=await (await api(host+'/reporting/reports/'+encodeURIComponent(state.job.id),{headers})).json();
  if(report.status==='FAILED'){state.failedReports=[...(state.failedReports||[]),{id:state.job.id,at:now.toISOString()}].slice(-10);state.job=null;state.retryAt=new Date(now.getTime()+60000).toISOString();throw Error('広告レポート生成失敗。既存データは維持します。1分以上空けて再試行してください');}
  if(report.status!=='COMPLETED')return status(store);
  const u=new URL(report.url);if(u.protocol!=='https:'||!/(^|\.)s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com$/.test(u.hostname)||u.username||u.password)throw Error('広告レポート配信先を確認してください');
  const download=await api(u.href);const reader=download.body.getReader();let size=0,chunks=[];for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>5_000_000){await reader.cancel();throw Error('広告レポート上限超過');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const {gunzipSync}=await import('node:zlib');const rows=JSON.parse(gunzipSync(bytes,{maxOutputLength:10_000_000}).toString());
  const normalized=normalizeReport(rows,{...state.job,profileId:String(p.profileId)}),job=state.job;
  state.history=[...(state.history||[]),{at:new Date().toISOString(),reportId:job.id,start:job.start,end:job.end,previous:state.rows.filter(r=>r.periodStart>=job.start&&r.periodStart<=job.end)}].slice(-30);
  state.rows=[...state.rows.filter(r=>r.periodStart<job.start||r.periodStart>job.end),...normalized];state.lastSuccess=new Date().toISOString();state.error=null;state.job=null;await cas(store,revision,state);return status(store);
 }catch(e){state.error=String(e.message).slice(0,300);try{await cas(store,revision,state);}catch{}throw Error(state.error);}
}
