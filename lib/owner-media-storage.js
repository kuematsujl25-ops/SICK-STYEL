import {OwnerMediaError,ownerSession,validAssetId,bridgeAuthorized,readOwnerRequests} from './owner-media-requests.js';
const ROOT='owner-news/';
const MAX=25*1024*1024;
const FORMATS={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4'};
const HEADERS={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json=(o,status=200)=>Response.json(o,{status,headers:HEADERS});
const fail=(error,status)=>json({error},status);
function identify(bytes){
 const b=new Uint8Array(bytes);
 const at=(i,s)=>[...s].every((x,k)=>b[i+k]===x.charCodeAt(0));
 if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
 if([137,80,78,71,13,10,26,10].every((x,i)=>b[i]===x))return 'image/png';
 if(at(0,'RIFF')&&at(8,'WEBP'))return 'image/webp';
 if(at(4,'ftyp')&&b.length>=16)return 'video/mp4';
 return null;
}
function item(o){
 const id=o.key.slice(ROOT.length);
 return {id,name:o.customMetadata?.name||'素材',type:o.httpMetadata?.contentType||'application/octet-stream',bytes:o.size,createdAt:o.uploaded.toISOString()};
}
async function bytesLimited(req){
 const len=Number(req.headers.get('content-length')||0);
 if(len>MAX)throw new OwnerMediaError('ファイルは25 MBまでです。',413);
 const reader=req.body?.getReader();if(!reader)throw new OwnerMediaError('ファイルを選んでください。');
 const chunks=[];let n=0;
 while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>MAX){await reader.cancel();throw new OwnerMediaError('ファイルは25 MBまでです。',413);}chunks.push(value);}
 // A single backing buffer avoids duplicating the collected chunks during validation and upload.
 const out=new Uint8Array(n);let offset=0;
 for(const c of chunks){out.set(c,offset);offset+=c.length;}
 return out;
}
const range=(raw,size)=>{
 if(!raw)return null;
 const m=/^bytes=(\d*)-(\d*)$/.exec(raw);if(!m||(!m[1]&&!m[2]))return false;
 const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
 const end=m[1]&&m[2]?Math.min(size-1,Number(m[2])):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return false;
 return {offset:start,length:end-start+1};
};
export async function ownerMediaStorage(req,{store,bucket,origin,bridgeToken}){
 const url=new URL(req.url);
 const machine=url.pathname.startsWith('/api/owner-media/dot/files');
 const prefix=machine?'/api/owner-media/dot/files':'/api/owner-media/files';
 const id=url.pathname.slice(prefix.length).replace(/^\//,'');
 if(machine){
  if(!bridgeAuthorized(bridgeToken,req.headers.get('authorization')))return fail('認証が必要です。',401);
  if(req.headers.has('origin')||req.headers.has('cookie'))return fail('機械連携専用です。',403);
  if(req.method==='GET'||req.method==='HEAD'){
   if(!validAssetId(id)||!(await readOwnerRequests(store)).requests.some(r=>['queued','received'].includes(r.state)&&r.assetId===id))return fail('素材が見つかりません。',404);
  }else if(req.method!=='POST'||id)return fail('この操作には対応していません。',405);
 }else{
  if(!await ownerSession(store,req.headers.get('cookie')))return fail('ログインしてください。',401);
  if(!['GET','HEAD'].includes(req.method)&&(req.headers.get('origin')!==origin||req.headers.get('sec-fetch-site')==='cross-site'))return fail('許可されていないアクセスです。',403);
 }
 if(!id&&req.method==='GET'){
  if(!bucket)return json({available:false,files:[],cursor:null});
  const cursor=url.searchParams.get('cursor');
  if(cursor&&cursor.length>2048)return fail('素材一覧を開き直してください。',400);
  const page=await bucket.list({prefix:ROOT,limit:24,...(cursor?{cursor}:{}),include:['customMetadata','httpMetadata']});
  return json({available:true,files:page.objects.map(item).filter(o=>validAssetId(o.id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),cursor:page.truncated?page.cursor:null});
 }
 if(!bucket)return fail('非公開の素材保存先が未接続です。',503);
 if(id&&!validAssetId(id))return fail('素材が見つかりません。',404);
 if(!id&&req.method==='POST'){
  let name;try{name=decodeURIComponent(req.headers.get('x-sickstyle-media-name')||'');}catch{return fail('ファイル名を確認してください。',400);}
  name=name.replace(/[\\/\x00-\x1f\x7f]/g,'_').trim();
  if(!name||name.length>120)return fail('ファイル名は120文字以内にしてください。',400);
  const type=req.headers.get('content-type');if(!Object.hasOwn(FORMATS,type))return fail('JPG、PNG、WebP、MP4のみ登録できます。',415);
  let bytes;try{bytes=await bytesLimited(req);}catch(e){if(e instanceof OwnerMediaError)return fail(e.message,e.status);throw e;}
  if(type!==identify(bytes))return fail('ファイル内容と形式が一致しません。',415);
  const key=ROOT+String(9_999_999_999_999-Date.now()).padStart(13,'0')+'-'+crypto.randomUUID();
  return json(item(await bucket.put(key,bytes,{httpMetadata:{contentType:type},customMetadata:{name}})),201);
 }
 if(id&&['GET','HEAD'].includes(req.method)){
  const key=ROOT+id;
  const meta=await bucket.head(key);if(!meta)return fail('素材が見つかりません。',404);
  const requested=range(req.headers.get('range'),meta.size);
  if(requested===false)return new Response(null,{status:416,headers:{...HEADERS,'Content-Range':'bytes */'+meta.size}});
  const object=req.method==='GET'?await bucket.get(key,requested?{range:requested}:undefined):meta;
  if(!object)return fail('素材が見つかりません。',404);
  const type=meta.httpMetadata?.contentType;
  if(!Object.hasOwn(FORMATS,type))return fail('この素材形式は表示できません。',415);
  const headers={...HEADERS,'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':String(requested?.length??meta.size),'Content-Disposition':'inline; filename="sickstyle.'+FORMATS[type]+'"'};
  if(requested)headers['Content-Range']='bytes '+requested.offset+'-'+(requested.offset+requested.length-1)+'/'+meta.size;
  return new Response(req.method==='HEAD'?null:object.body,{status:requested?206:200,headers});
 }
 return fail('この操作には対応していません。',405);
}
