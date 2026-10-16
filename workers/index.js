import {createServer} from 'node:http';
import {httpServerHandler} from 'cloudflare:node';
import handler from '../api/index.js';
import {withRuntime} from '../lib/runtime.js';
import {createD1Store} from '../lib/d1-store.js';
import * as instagram from '../integrations/instagram.js';
import * as amazon from '../integrations/amazon.js';
const api=httpServerHandler(createServer(handler));
const security={
 'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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
   const store=createD1Store(env.DB);// 1回の実行あたりの外部リクエスト上限（Free: 50）を超えないよう、サービスごとに別のCronで実行します。
   const targets=event.cron==='10 0 * * *'?[['amazon',amazon]]:[['instagram',instagram]];
   for(const [name,mod] of targets){try{if((await mod.safeStatus(store)).connected)await mod.sync(store);}catch{console.error(JSON.stringify({event:'scheduled_sync_failed',service:name}));}}
  }));
 }
};
