import {normalizeReplyDraft} from '../../lib/instagram-reply-drafts.js';
import {randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename,dirname,extname,join} from 'node:path';
import {bridgeConfigured,validAssetId,validMediaId} from '../../lib/owner-media-requests.js';

export const worker='sickstyle-manager';
export const origin='https://sickstyle-manager.sickstyle-74h4.workers.dev';
export const bridgeKey='OWNER_DOT_BRIDGE_TOKEN';
export const tokenFile=join(homedir(),'SICKSTYLE-Instagram','.bridge','receiver.token');
const root=origin+'/api/owner-media/dot/';
const max=25*1024*1024;
const types={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.mp4':'video/mp4'};
async function privateDir(path){
 const dir=await lstat(path);
 if(!dir.isDirectory()||dir.uid!==process.getuid()||(dir.mode&0o077)!==0)throw Error('Dot連携キーの保存先を確認してください。');
}
export async function readBridgeKey(path=tokenFile){
 await privateDir(dirname(path));
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await file.stat();
  if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||stat.size!==65)throw Error('Dot連携キーのファイル権限を確認してください。');
  const token=(await file.readFile('utf8')).trim();
  if(!bridgeConfigured(token))throw Error('Dot連携キーの形式を確認してください。');
  return token;
 }finally{await file.close();}
}
export async function prepareBridgeKey(path=tokenFile){
 const parent=dirname(path);
 try{await mkdir(parent,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 await privateDir(parent);
 let file;
 try{file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
 catch(e){if(e.code==='EEXIST')return readBridgeKey(path);throw e;}
 const token=randomBytes(32).toString('hex');
 try{await file.writeFile(token+'\n');}finally{await file.close();}
 return token;
}
export async function bridgeRequest(action,input,token,request=fetch){
 if(!bridgeConfigured(token))throw Error('Dot連携キーの形式を確認してください。');
 const headers={Authorization:'Bearer '+token};
 let path=action,method='GET',body;
 if(action==='receive'||action==='complete'){
  if(!validMediaId(input?.id))throw Error('依頼IDが無効です。');
  if(action==='complete'&&(typeof input.result!=='string'||!input.result.trim()||input.result.length>1800))throw Error('結果の内容を確認してください。');
  method='POST';headers['Content-Type']='application/json';
  body=JSON.stringify(action==='receive'?{id:input.id}:{id:input.id,result:input.result});
 }else if(action==='instagram-reply-drafts'){
  method='POST';headers['Content-Type']='application/json';body=JSON.stringify(normalizeReplyDraft(input));
 }else if(action==='download'){
  if(!validAssetId(input?.id))throw Error('素材IDが無効です。');
  path='files/'+input.id;
 }else if(action==='upload'){
  const name=input?.name,type=typeof name==='string'?types[extname(name).toLowerCase()]:null;
  if(!type||!name.trim()||name.length>120||/[\\/\x00-\x1f\x7f]/.test(name)||!(input.bytes instanceof Uint8Array)||!input.bytes.length||input.bytes.length>max)throw Error('JPG、PNG、WebP、MP4（25 MBまで）を指定してください。');
  path='files';method='POST';body=input.bytes;
  headers['Content-Type']=type;headers['X-Sickstyle-Media-Name']=encodeURIComponent(name);
 }else if(action!=='queue')throw Error('未対応のDot操作です。');
 let res;
 try{res=await request(new URL(path,root),{method,headers,body,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000)});}
 catch{throw Error('Dot連携の通信に失敗しました。');}
 if(!res.ok)throw Error('Dot連携エラー (HTTP '+res.status+')');
 if(action==='download'){
  const size=Number(res.headers.get('content-length')),type=res.headers.get('content-type');
  if(!Object.values(types).includes(type)||!Number.isSafeInteger(size)||size<1||size>max||!res.body)throw Error('素材応答の形式が不正です。');
  const bytes=new Uint8Array(size),reader=res.body.getReader();let n=0;
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   if(n+value.length>size){await reader.cancel();throw Error('素材のサイズが一致しません。');}
   bytes.set(value,n);n+=value.length;
  }
  if(n!==size)throw Error('素材のサイズが一致しません。');
  return {bytes,type};
 }
 const data=await res.json();
 if(action==='instagram-reply-drafts'&&(data?.id!==input.id||typeof data.created!=='boolean'))throw Error('返信案の登録応答が不正です。');
 if(action==='queue'&&(!Array.isArray(data?.requests)||data.requests.length>10||data.requests.some(r=>!validMediaId(r?.id)||!['queued','received'].includes(r.state)||!['制作','修正','投稿予約'].includes(r.type)||typeof r.note!=='string'||r.note.length>900||(r.assetId!==null&&!validAssetId(r.assetId)))))throw Error('依頼一覧の応答が不正です。');
 if(action==='upload'&&!validAssetId(data?.id))throw Error('素材登録の応答が不正です。');
 if((action==='receive'||action==='complete')&&(data?.id!==input.id||data.state!==(action==='receive'?'received':'complete')))throw Error('依頼状況の応答が不正です。');
 return data;
}
export async function loadExplicitAsset(path){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const stat=await file.stat();
  if(!stat.isFile()||stat.size<1||stat.size>max)throw Error('25 MB以下の通常ファイルを指定してください。');
  const bytes=new Uint8Array(stat.size+1);let n=0;
  while(n<bytes.length){const {bytesRead}=await file.read(bytes,n,bytes.length-n,n);if(!bytesRead)break;n+=bytesRead;}
  if(n!==stat.size)throw Error('素材のサイズが変化しました。');
  return {name:basename(path),bytes:bytes.subarray(0,n)};
 }finally{await file.close();}
}
