import * as amazonAds from '../integrations/amazon-ads.js';
import {createServer} from 'node:http';
import {httpServerHandler} from 'cloudflare:node';
import handler from '../api/index.js';
import {withRuntime} from '../lib/runtime.js';
import {createD1Store} from '../lib/d1-store.js';
import * as instagram from '../integrations/instagram.js';
import * as amazon from '../integrations/amazon.js';
import * as googlecalendar from '../integrations/googlecalendar.js';
import {scheduledKind,runReport} from '../lib/notifications.js';
const api=httpServerHandler(createServer(handler));
const security={
 'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
 // img-srcにhttps:を許可：選手候補のphotoUrl（public/players.js）は権限確認済みの外部URL（Wikimedia等）を
 // 管理者が手入力する前提のフィールドで、ホストを限定すると想定外の正規URLまで表示できなくなる
 // （Codex独立レビュー指摘：img-src 'self' data:のみだと外部写真が一切表示されなかった）。このフィールドは
 // 管理者（認証済み）のみが入力し、画像タグにはreferrerpolicy="no-referrer"を設定済みのため、クロスサイト
 // 追跡・リファラ漏洩のリスクは抑えている。
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function secured(response){const r=new Response(response.body,response);for(const [k,v]of Object.entries(security))r.headers.set(k,v);return r;}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/'))return secured(await env.ASSETS.fetch(request));
  if(env.MAINTENANCE_MODE==='true')return secured(Response.json({error:'無料枠保護のため停止中です。管理者が状態を確認しています。'},{status:503,headers:{'Cache-Control':'no-store'}}));
  if(!env.DB)return secured(Response.json({error:'永続データベースが未設定です'},{status:503}));
  return withRuntime({...env,CLOUDFLARE:true,APP_ORIGIN:env.APP_ORIGIN||url.origin,STORE:createD1Store(env.DB)},async()=>secured(await api.fetch(request,env,ctx)));
 },
 async scheduled(event,env,ctx){
  if(env.MAINTENANCE_MODE==='true'||!env.DB)return;
  ctx.waitUntil(withRuntime({...env,CLOUDFLARE:true,STORE:createD1Store(env.DB)},async()=>{
   const store=createD1Store(env.DB);
   // Cron Triggers are UTC. 09:00 / 20:00 / 22:00 Asia/Tokyo = 00:00 / 11:00 / 13:00 UTC.
   const kind=scheduledKind(event.cron);
   if(event.cron==='10 0 * * *'||['sales','analysis'].includes(kind)) {
    try{if((await amazon.safeStatus(store)).connected)await amazon.sync(store);}
    catch{console.error(JSON.stringify({event:'scheduled_sync_failed',service:'amazon'}));}
   }
   const sendReport=async()=>{
    try{await runReport(store,kind,new Date(),async()=>googlecalendar.listToday(store,new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})));}
    catch(e){console.error(JSON.stringify({event:'scheduled_notification_failed',kind,type:e.name||'unknown'}));}
   };
   // 09:00 JST（'0 0 * * *'）はInstagram同期と「今日の予定」通知で同じ呼び出しを共有している。
   // Instagram同期は内部で多くのサブリクエストを使うことがあり、Workers Freeプランの1呼び出しあたり
   // 50件の上限に、通知配信（Googleカレンダー取得＋登録端末へのPush送信）分を合わせると達しうる
   // （Codex独立レビュー指摘）。通知は一度送信記録されると再送されないため、ユーザー向けの通知配信を
   // 先に完了させ、バックグラウンドのInstagram同期（失敗しても次回の同期で取り戻せる）を後に回す。
   if(kind==='morning')await sendReport();
   if(event.cron==='0 0 * * *'){
    try{if((await instagram.safeStatus(store)).connected)await instagram.sync(store);}
    catch{console.error(JSON.stringify({event:'scheduled_sync_failed',service:'instagram'}));}
   }
   if(kind&&kind!=='morning')await sendReport();
   if(env.AMAZON_ADS_SYNC_ENABLED==='true'&&['10 0 * * *','0 11 * * *','0 13 * * *'].includes(event.cron)){try{await amazonAds.sync(store);}catch{console.error(JSON.stringify({event:'scheduled_sync_failed',service:'amazonads'}));}}

  }));
 }
};
