import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('Workerd fetch supports direct outbound responses and rejects redirects without replaying credentials',async t=>{
 const seen=[];
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  seen.push({path:url.pathname,method:req.method,authorization:req.headers.authorization??null});
  if(url.pathname==='/redirect'){res.writeHead(307,{Location:'/unexpected'});return res.end('do not follow');}
  const status=url.pathname==='/bad'?400:200;
  res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({ok:status===200}));
 });
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const upstream='http://127.0.0.1:'+server.address().port;
 const helper=readFileSync(new URL('../lib/fetch-no-redirect.js',import.meta.url),'utf8');
 const script=helper+`
 export default {async fetch(req,env){
  const kind=new URL(req.url).pathname;
  try{
   const reply=await fetchNoRedirect(env.UPSTREAM+kind,{method:'POST',body:'test-only',headers:{Authorization:'Bearer synthetic'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(5000)});
   return Response.json({status:reply.status,body:await reply.json()});
  }catch(error){return Response.json({blocked:true,message:error.message});}
 }};
 `;
 const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'workerd-redirect-test',script,modules:true,
  compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],bindings:{UPSTREAM:upstream}}]}));
 t.after(()=>runtime.dispose());
 const invoke=async path=>(await runtime.dispatchFetch('http://localhost'+path)).json();
 assert.deepEqual(await invoke('/direct'),{status:200,body:{ok:true}});
 assert.deepEqual(await invoke('/bad'),{status:400,body:{ok:false}});
 assert.deepEqual(await invoke('/redirect'),{blocked:true,message:'予期しないHTTP転送を拒否しました'});
 assert.deepEqual(seen,['/direct','/bad','/redirect'].map(path=>({path,method:'POST',authorization:'Bearer synthetic'})));
});
