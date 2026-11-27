import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import {createDemoService,FulfillmentError} from './service.js';
const root=fileURLToPath(new URL('.',import.meta.url));
export function createDemoServer({journalDir,port=0}={}){
 const secret=randomBytes(32).toString('hex');const actor={id:'synthetic-admin',role:'admin',mfa:true};
 const service=createDemoService({databasePath:journalDir?join(journalDir,'synthetic-outbox.sqlite'):':memory:'});
 let origin,sessionToken;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   if(req.headers.host!==new URL(origin).host)return json(403,{error:'LOOPBACK_HOST_REQUIRED'});
   const url=new URL(req.url,origin);
   if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==origin))return json(403,{error:'SAME_ORIGIN_REQUIRED'});
   if(['GET','HEAD'].includes(req.method)&&['/','/app.js','/style.css'].includes(url.pathname)){
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');return res.end(req.method==='HEAD'?undefined:readFileSync(join(root,file)));
   }
   if(req.method==='POST'&&req.headers.origin!==origin)return json(403,{error:'SAME_ORIGIN_REQUIRED'});
   let b={};if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16000)return json(413,{error:'TOO_LARGE'});}b=JSON.parse(raw||'{}');}
   if(url.pathname==='/api/login'&&req.method==='POST'){
    const candidate=Buffer.from(typeof b.token==='string'?b.token:'');const expected=Buffer.from(secret);
    if(candidate.length!==expected.length||!timingSafeEqual(candidate,expected))return json(401,{error:'LOCAL_TOKEN_REQUIRED'});
    sessionToken=randomBytes(32).toString('hex');res.setHeader('Set-Cookie',`demo_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`);return json(200,{ok:true});
   }
   const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('demo_session='))?.slice(13);
   if(!sessionToken||cookie!==sessionToken)return json(401,{error:'LOCAL_TOKEN_REQUIRED'});
   if(url.pathname==='/api/logout'&&req.method==='POST'){sessionToken=undefined;res.setHeader('Set-Cookie','demo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(200,{ok:true});}
   if(url.pathname==='/api/orders'&&req.method==='GET')return json(200,service.listing(actor));
   const match=url.pathname.match(/^\/api\/orders\/(DEMO-ORDER-\d+)\/(address|preview)$/);
   if(match&&match[2]==='address'&&req.method==='GET')return json(200,service.address(actor,match[1]));
   if(match&&match[2]==='preview'&&req.method==='POST')return json(200,service.preview(actor,match[1],b));
   const p=url.pathname.match(/^\/api\/packages\/([a-z0-9-]+)(?:\/(confirm|reconcile))?$/);
   if(p&&req.method==='GET'&&!p[2])return json(200,service.detail(actor,p[1]));
   if(p&&req.method==='POST'&&p[2]==='confirm')return json(200,service.confirm(actor,p[1],b.ack,{scenario:b.scenario}));
   if(p&&req.method==='POST'&&p[2]==='reconcile')return json(200,service.reconcile(actor,p[1]));
   return json(404,{error:'NOT_FOUND'});
  }catch(e){return json(e instanceof FulfillmentError?e.status:400,{error:e instanceof FulfillmentError?e.code:'REQUEST_FAILED'});}
 });
 return {service,secret,server,start:()=>new Promise(resolve=>server.listen(port,'127.0.0.1',()=>{origin=`http://127.0.0.1:${server.address().port}`;resolve(origin);})),stop:()=>new Promise(resolve=>server.close(()=>{service.close();resolve();}))};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const app=createDemoServer({journalDir:join(root,'../../.local-amazon-demo')});const origin=await app.start();
 // Ephemeral synthetic-only login capability, never an Amazon credential.
 console.log(`Synthetic demo: ${origin}\nLocal demo token: ${app.secret}\nNo Amazon traffic. Stop with Ctrl-C.`);
}
