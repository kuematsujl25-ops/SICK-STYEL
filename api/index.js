import {runtime} from '../lib/runtime.js';
import {getStore} from '../lib/runtime.js';
import {empty,validate} from '../lib/domain.js';
import {hash,token,equal} from '../lib/security.js';
import {hashPassword,verifyPassword} from '../lib/password.js';
import * as instagram from '../integrations/instagram.js';
import * as amazon from '../integrations/amazon.js';
import {emptySite,validateSite,publicView,DEFAULT_SITE_ORIGINS} from '../lib/site.js';

function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
export async function rawBody(req){if(req._sickstyleRaw)return req._sickstyleRaw;let n=0;const chunks=[];for await(const c of req){const b=Buffer.from(c);n+=b.length;if(n>2_000_000)throw Error('データが大きすぎます');chunks.push(b);}return req._sickstyleRaw=Buffer.concat(chunks);}
async function body(req){return JSON.parse((await rawBody(req)).toString()||'{}');}
const cookie=(value,seconds)=>`session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${(runtime().CLOUDFLARE&&runtime().CF_LOCAL_DEV!=='true')||runtime().VERCEL||runtime().COOKIE_SECURE==='true'?'; Secure':''}`;
const revisionOf=async store=>{const r=await store.doc('workspace');return {...(r?JSON.parse(r.body):empty()),revision:r?.revision||0};};
export default async function handler(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
 try{
 if(!['GET','HEAD'].includes(req.method))await rawBody(req);
 const url=new URL(req.url,'http://localhost');const route=url.pathname;const store=await getStore();
 if(route==='/api/instagram/cron'&&req.method==='GET'){
  if(!runtime().CRON_SECRET||!equal(req.headers.authorization||'','Bearer '+runtime().CRON_SECRET))return json(res,401,{error:'認証が必要です'});
  const result={};for(const [name,mod] of [['instagram',instagram],['amazon',amazon]]){try{if((await mod.safeStatus(store)).connected){await mod.sync(store);result[name]='synced';}else result[name]='skipped';}catch{result[name]='failed';}}return json(res,200,{ok:true,result});
 }
 if(route==='/api/instagram/webhook'){
  if(req.method==='GET'){if(!runtime().META_WEBHOOK_VERIFY_TOKEN||!equal(url.searchParams.get('hub.verify_token')||'',runtime().META_WEBHOOK_VERIFY_TOKEN)||url.searchParams.get('hub.mode')!=='subscribe')return json(res,403,{error:'検証できません'});res.writeHead(200,{'Content-Type':'text/plain'});return res.end(url.searchParams.get('hub.challenge')||'');}
  if(req.method==='POST'){const raw=await rawBody(req);if(!instagram.verifySignature(raw,req.headers['x-hub-signature-256'],runtime().META_WEBHOOK_APP_SECRET))return json(res,403,{error:'署名が一致しません'});await instagram.receiveWebhook(store,JSON.parse(raw.toString()));return json(res,200,{ok:true});}
 }
 // 公開サイト向けの読み取り専用API（認証不要）。公開操作で確定した掲載情報だけを返し、下書き・業務データ・顧客情報は返しません。
 if(route==='/api/public/site'){
  const origins=(runtime().SITE_ORIGINS||DEFAULT_SITE_ORIGINS.join(',')).split(',').map(x=>x.trim()).filter(Boolean);
  const o=req.headers.origin;if(o&&origins.includes(o)){res.setHeader('Access-Control-Allow-Origin',o);res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET');res.writeHead(204);return res.end();}
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'読み取り専用です'});
  const r=await store.doc('site-public');const body=r?r.body:JSON.stringify({version:1,publishedAt:null,products:[],news:[],philosophy:null,links:null});
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=60, s-maxage=300','X-Content-Type-Options':'nosniff'});return res.end(req.method==='HEAD'?undefined:body);
 }
 if(!['GET','HEAD'].includes(req.method)){
  const allowed=runtime().APP_ORIGIN||`http://${req.headers.host}`;
  if(req.headers.origin&&req.headers.origin!==allowed)return json(res,403,{error:'許可されていないアクセスです'});
  if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'許可されていないアクセスです'});
 }
 const configured=!!(await store.query('SELECT id FROM ss_users WHERE id=1'))[0];
 const rawToken=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8)||'';const sessionHash=hash(rawToken);
 const session=(await store.query('SELECT expires FROM ss_sessions WHERE token=$1 AND expires>$2',[sessionHash,Date.now()]))[0];const authorized=!!session;
 if(route==='/api/session'&&req.method==='GET')return json(res,200,{configured,authenticated:authorized,setupAllowed:!configured&&!!runtime().SETUP_TOKEN,storage:store.kind,hosted:!!runtime().CLOUDFLARE&&runtime().CF_LOCAL_DEV!=='true'});
 if(['/api/setup','/api/login'].includes(route)&&req.method==='POST'){
  const b=await body(req);
  // Shared DB counters survive serverless invocations. Avoid retaining raw email/IP.
  const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
  const ip=runtime().CLOUDFLARE?(req.headers['cf-connecting-ip']||'unknown'):runtime().VERCEL?(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'unknown'):req.socket?.remoteAddress||'local';
  for(const k of ['ip:'+hash(String(ip)),'email:'+hash(email)]){
   const now=Date.now();const a=(await store.query('INSERT INTO ss_attempts(key,n,expires) VALUES ($1,1,$2) ON CONFLICT(key) DO UPDATE SET n=CASE WHEN ss_attempts.expires<$3 THEN 1 ELSE ss_attempts.n+1 END,expires=CASE WHEN ss_attempts.expires<$3 THEN excluded.expires ELSE ss_attempts.expires END RETURNING n',[k,now+600000,now]))[0];
   if(a.n>20)return json(res,429,{error:'試行回数の上限です。10分後に再試行してください'});
  }
  if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254||typeof b.password!=='string'||b.password.length<12||b.password.length>256)return json(res,400,{error:'メールアドレスと12〜256文字のパスワードを入力してください'});
  if(route==='/api/setup'){
   if(configured)return json(res,409,{error:'初期設定は完了しています'});
   if(!runtime().SETUP_TOKEN)return json(res,403,{error:'サーバーに初期設定キーが設定されていません'});
   if(!b.setupToken)return json(res,403,{error:'管理者用の初期設定キーを入力してください（ログインパスワードとは別です）'});
   if(!equal(b.setupToken,runtime().SETUP_TOKEN))return json(res,403,{error:'初期設定キーが一致しません。サーバーに設定されたキーを使用してください'});
   if(runtime().ADMIN_EMAIL&&email!==runtime().ADMIN_EMAIL.toLowerCase())return json(res,403,{error:'許可された管理者メールアドレスではありません'});
   const {hash:passwordHash,salt}=await hashPassword(b.password);
   const row=await store.query('INSERT INTO ss_users(id,email,hash,salt) VALUES (1,$1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id',[email,passwordHash,salt]);if(!row.length)return json(res,409,{error:'初期設定は完了しています'});
  }
  const user=(await store.query('SELECT * FROM ss_users WHERE id=1 AND email=$1',[email]))[0];
  if(!(await verifyPassword(b.password,user)))return json(res,401,{error:'ログイン情報が正しくありません'});
  const t=token();await store.transaction([['DELETE FROM ss_sessions WHERE expires<$1',[Date.now()]],['DELETE FROM ss_attempts WHERE key=$1',['email:'+hash(email)]],['INSERT INTO ss_sessions(token,expires) VALUES ($1,$2)',[hash(t),Date.now()+86400000]]]);res.setHeader('Set-Cookie',cookie(t,86400));return json(res,200,{ok:true});
 }
 const redirect=location=>{res.writeHead(303,{Location:location,'Cache-Control':'no-store'});res.end();};
 if(['/api/amazon/login','/api/amazon/callback','/api/instagram/callback'].includes(route)&&req.method==='GET'&&!authorized)return redirect('/?auth=required');
 if(!authorized)return json(res,401,{error:'ログインしてください'});
 if(route==='/api/amazon/status'&&req.method==='GET')return json(res,200,await amazon.safeStatus(store));
 if(route==='/api/amazon/connect'&&req.method==='POST')return json(res,200,{url:await amazon.begin(store,sessionHash)});
 if(route==='/api/amazon/login'&&req.method==='GET'){try{return redirect(await amazon.login(store,sessionHash,url));}catch(e){console.error(JSON.stringify({event:'amazon_login',error:'invalid_request'}));return redirect('/?amazon=error');}}
 if(route==='/api/amazon/callback'&&req.method==='GET'){try{await amazon.connect(store,sessionHash,url);return redirect('/?amazon=connected');}catch(e){console.error(JSON.stringify({event:'amazon_callback',error:e instanceof amazon.AmazonError?String(e.code):'authorization_failed'}));return redirect('/?amazon=error');}}
 if(route==='/api/amazon/sync'&&req.method==='POST'){try{await amazon.sync(store);}catch(e){return json(res,502,{error:e.message,status:await amazon.safeStatus(store)});}return json(res,200,await amazon.safeStatus(store));}
 if(route==='/api/amazon/disconnect'&&req.method==='POST')return json(res,200,await amazon.disconnect(store));
 if(route==='/api/logout'&&req.method==='POST'){await store.query('DELETE FROM ss_sessions WHERE token=$1',[sessionHash]);res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true});}
 if(route==='/api/data'&&req.method==='GET')return json(res,200,await revisionOf(store));
 if(route==='/api/data'&&req.method==='PUT'){
  const b=await body(req);const d=validate(b);if(!Number.isSafeInteger(b.revision)||b.revision<0)return json(res,400,{error:'更新バージョンが必要です'});
  await store.query('INSERT INTO ss_documents(name,body,revision) VALUES ($1,$2,0) ON CONFLICT(name) DO NOTHING',['workspace',JSON.stringify(empty())]);
  const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(d),'workspace',b.revision]);if(!rows.length)return json(res,409,{error:'他の端末で更新されました。再読み込みしてから編集してください'});return json(res,200,{ok:true,revision:rows[0].revision});
 }
 if(route==='/api/backup'&&req.method==='GET'){res.setHeader('Content-Disposition',`attachment; filename="sickstyle-backup-${new Date().toISOString().slice(0,10)}.json"`);const sd=await store.doc('site-draft');return json(res,200,{version:1,exportedAt:new Date().toISOString(),data:await revisionOf(store),site:sd?JSON.parse(sd.body):null});}
 if(route==='/api/restore'&&req.method==='POST'){
  const b=await body(req);if(b.version!==1)throw Error('対応していないバックアップです');const data=validate(b.data);
  if(!Number.isSafeInteger(b.revision))return json(res,400,{error:'現在の更新バージョンが必要です'});
  const result=await store.transaction([
   ['INSERT INTO ss_documents(name,body,revision) VALUES ($1,$2,0) ON CONFLICT(name) DO NOTHING',['workspace',JSON.stringify(empty())]],
   ['INSERT INTO ss_documents(name,body) SELECT $1,body FROM ss_documents WHERE name=$2 AND revision=$3 ON CONFLICT(name) DO UPDATE SET body=excluded.body,revision=ss_documents.revision+1',['before-restore','workspace',b.revision]],
   ['UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(data),'workspace',b.revision]]]);
  if(!result[2].length)return json(res,409,{error:'他の端末で更新されました。再読み込み後に復元してください'});return json(res,200,{ok:true});
 }
 if(route==='/api/site'&&req.method==='GET'){const d=await store.doc('site-draft');const p=await store.doc('site-public');return json(res,200,{draft:d?JSON.parse(d.body):emptySite(),revision:d?.revision||0,published:p?JSON.parse(p.body):null});}
 if(route==='/api/site'&&req.method==='PUT'){
  const b=await body(req);const d=validateSite(b.draft);if(!Number.isSafeInteger(b.revision)||b.revision<0)return json(res,400,{error:'更新バージョンが必要です'});
  await store.query('INSERT INTO ss_documents(name,body,revision) VALUES ($1,$2,0) ON CONFLICT(name) DO NOTHING',['site-draft',JSON.stringify(emptySite())]);
  const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(d),'site-draft',b.revision]);if(!rows.length)return json(res,409,{error:'他の端末で更新されました。再読み込みしてから編集してください'});return json(res,200,{ok:true,revision:rows[0].revision});
 }
 if(route==='/api/site/publish'&&req.method==='POST'){
  const b=await body(req);const d=await store.doc('site-draft');if(!d)return json(res,400,{error:'下書きがありません'});
  if(b.revision!==d.revision)return json(res,409,{error:'下書きが更新されています。再読み込みして内容を確認してから公開してください'});
  const view=publicView(JSON.parse(d.body),new Date().toISOString());
  const prev=await store.doc('site-public');
  await store.transaction([...(prev?[['INSERT INTO ss_documents(name,body) VALUES ($1,$2) ON CONFLICT(name) DO UPDATE SET body=excluded.body,revision=ss_documents.revision+1',['site-public-previous',prev.body]]]:[]),['INSERT INTO ss_documents(name,body) VALUES ($1,$2) ON CONFLICT(name) DO UPDATE SET body=excluded.body,revision=ss_documents.revision+1',['site-public',JSON.stringify(view)]]]);
  return json(res,200,{ok:true,published:view});
 }
 if(route==='/api/site/rollback'&&req.method==='POST'){
  const prev=await store.doc('site-public-previous');if(!prev)return json(res,400,{error:'戻せる公開履歴がありません'});
  const cur=await store.doc('site-public');
  await store.transaction([['INSERT INTO ss_documents(name,body) VALUES ($1,$2) ON CONFLICT(name) DO UPDATE SET body=excluded.body,revision=ss_documents.revision+1',['site-public',prev.body]],...(cur?[['INSERT INTO ss_documents(name,body) VALUES ($1,$2) ON CONFLICT(name) DO UPDATE SET body=excluded.body,revision=ss_documents.revision+1',['site-public-previous',cur.body]]]:[])]);
  return json(res,200,{ok:true,published:JSON.parse(prev.body)});
 }
 if(route==='/api/instagram/status'&&req.method==='GET')return json(res,200,await instagram.safeStatus(store));
 if(route==='/api/instagram/connect'&&req.method==='POST')return json(res,200,{url:await instagram.begin(store,sessionHash)});
 if(route==='/api/instagram/callback'&&req.method==='GET'){
  try{await instagram.connect(store,sessionHash,url);res.writeHead(303,{Location:'/?instagram=connected'});res.end();}catch(e){console.error(JSON.stringify({event:'instagram_callback',error:e instanceof instagram.MetaError?e.code:'authorization_failed'}));res.writeHead(303,{Location:'/?instagram=error'});res.end();}return;
 }
 if(route==='/api/instagram/sync'&&req.method==='POST'){await instagram.sync(store);return json(res,200,await instagram.safeStatus(store));}
 if(route==='/api/instagram/disconnect'&&req.method==='POST')return json(res,200,await instagram.disconnect(store));
 if(route==='/api/instagram/conversations'&&req.method==='GET'){
  const p=await instagram.safeStatus(store);if(!p.dmStartedAt)return json(res,200,{data:[],startedAt:null});const rows=await store.query('SELECT peer,MAX(CASE WHEN incoming=1 THEN ts ELSE 0 END) AS received,MAX(CASE WHEN incoming=0 THEN ts ELSE 0 END) AS replied FROM ss_events GROUP BY peer');return json(res,200,{data:rows.filter(r=>Number(r.received)>Number(r.replied)),startedAt:p.dmStartedAt});
 }
 if(route==='/api/instagram/resolve'&&req.method==='POST'){const b=await body(req);await instagram.resolveConversation(store,String(b.peer||''));return json(res,200,{ok:true});}
 return json(res,404,{error:'見つかりません'});
 }catch(e){const validation=/掲載|下書き|データ|形式|バックアップ|認可|Instagram|Meta|Amazon|同期|トークン|アカウント|キー|コード/.test(e.message);console.error(JSON.stringify({event:'api_error',type:e.name,code:e instanceof instagram.MetaError?e.code:undefined}));return json(res,validation?400:503,{error:validation?e.message:'サービスに接続できません。管理者はデータベース設定を確認してください。'});}
}
