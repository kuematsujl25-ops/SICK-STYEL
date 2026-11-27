import {hash,equal} from './security.js';
const DOC='owner-media-requests-v1';
const TYPES=new Set(['制作','修正','投稿予約']);
const MUSIC_MODES=new Set(['instagram','embedded','silent']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const validMediaId=v=>typeof v==='string'&&UUID.test(v);
export const validAssetId=v=>typeof v==='string'&&/^\d{13}-/.test(v)&&validMediaId(v.slice(14));
export class OwnerMediaError extends Error{
 constructor(message,status=400){super(message);this.status=status;}
}
function fail(message,status){throw new OwnerMediaError(message,status);}
function strictObject(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))fail('依頼の形式が正しくありません。');}
export async function ownerSession(store,cookies,now=Date.now()){
 const session=(cookies||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);
 if(!session||!/^[0-9a-f]{64}$/.test(session))return false;
 return !!(await store.query('SELECT expires FROM ss_sessions WHERE token=$1 AND expires>$2',[hash(session),now]))[0];
}
export async function readOwnerRequests(store){
 const doc=await store.doc(DOC);
 return {requests:doc?JSON.parse(doc.body).map(r=>({...r,state:r.state||'draft'})):[],revision:doc?.revision??null};
}
function validDate(v,now){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v))return false;
 const t=Date.parse(v+':00+09:00');
 return Number.isFinite(t)&&new Date(t+9*3600_000).toISOString().slice(0,16)===v&&t>now;
}
export async function addOwnerRequest(store,input,now=Date.now()){
 strictObject(input,['id','type','note','assetId','scheduledJst','music']);
 if(!validMediaId(input.id)||!TYPES.has(input.type)||typeof input.note!=='string'||input.note.length>900||!input.note.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.note))fail('依頼種別と指示内容（900文字以内）を確認してください。');
 if(input.assetId!==null&&!validAssetId(input.assetId))fail('素材を選び直してください。');
 if(input.type==='投稿予約'){
  if(!input.assetId||!validDate(input.scheduledJst,now))fail('予約依頼には素材と未来の日時（日本時間）が必要です。');
 }else if(input.scheduledJst!==null)fail('日時は投稿予約依頼でのみ指定できます。');
 let music=null;
 if(input.music!=null){
  if(input.type!=='投稿予約')fail('音楽は投稿予約依頼でのみ指定できます。');
  strictObject(input.music,['mode','track']);
  const {mode,track}=input.music;
  if(!MUSIC_MODES.has(mode)||typeof track!=='string'||track.length>160||/[\x00-\x1f\x7f]/.test(track)||(mode==='instagram'&&!track.trim())||(mode!=='instagram'&&track.trim()))fail('音楽の種類と曲名を確認してください。');
  music={mode,track:track.trim()};
 }
 const data={id:input.id,type:input.type,note:input.note.trim(),assetId:input.assetId,scheduledJst:input.scheduledJst,createdAt:new Date(now).toISOString(),state:'draft',...(music?{music}:{})};
 for(let i=0;i<3;i++){
  const current=await readOwnerRequests(store);
  const existing=current.requests.find(r=>r.id===data.id);
  if(existing){
   if(['type','note','assetId','scheduledJst'].some(k=>existing[k]!==data[k])||(existing.music?.mode??null)!==(data.music?.mode??null)||(existing.music?.track??null)!==(data.music?.track??null))fail('別の依頼IDとして送信し直してください。',409);
   return existing;
  }
  if(current.requests.length>=100)fail('依頼の保存上限です。履歴を整理してください。',409);
  if(await write(store,current.revision,[data,...current.requests]))return data;
 }
 fail('別端末から更新がありました。もう一度送信してください。',409);
}

async function write(store,revision,requests){
 const body=JSON.stringify(requests);
 const rows=revision===null
  ?await store.query('INSERT INTO ss_documents(name,body,revision) VALUES ($1,$2,0) ON CONFLICT(name) DO NOTHING RETURNING revision',[DOC,body])
  :await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[body,DOC,revision]);
 return rows.length>0;
}
export const bridgeConfigured=secret=>typeof secret==='string'&&/^[0-9a-f]{64}$/.test(secret);
export const bridgeAuthorized=(secret,auth)=>bridgeConfigured(secret)&&equal(auth||'','Bearer '+secret);
export async function updateOwnerRequest(store,input,operation,now=Date.now()){
 strictObject(input,operation==='complete'?['id','result']:['id']);
 if(!validMediaId(input.id))fail('依頼IDが無効です。');
 if(operation==='complete'&&(typeof input.result!=='string'||!input.result.trim()||input.result.length>1800||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.result)))fail('結果の形式が正しくありません。');
 const to={send:'queued',receive:'received',complete:'complete'}[operation];
 const from={send:'draft',receive:'queued',complete:'received'}[operation];
 for(let i=0;i<3;i++){
  const current=await readOwnerRequests(store);
  const found=current.requests.find(r=>r.id===input.id);
  if(!found)fail('依頼が見つかりません。',404);
  if(found.state===to){
   if(operation==='complete'&&found.result!==input.result.trim())fail('別の結果が登録済みです。',409);
   return found;
  }
  if(operation==='send'&&found.type==='投稿予約'&&!validDate(found.scheduledJst,now))fail('希望日時が過ぎています。新しい日時で依頼を保存してください。');
  if(found.state!==from)fail('依頼の状態が変わりました。再読み込みしてください。',409);
  const at=new Date(now).toISOString();
  const next={...found,state:to,...(operation==='send'?{queuedAt:at}:operation==='receive'?{receivedAt:at}:{completedAt:at,result:input.result.trim()})};
  if(await write(store,current.revision,current.requests.map(r=>r.id===input.id?next:r)))return next;
 }
 fail('別端末から更新がありました。もう一度実行してください。',409);
}
