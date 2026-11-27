import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ownerMediaStorage} from '../lib/owner-media-storage.js';
import {hash} from '../lib/security.js';
import {addOwnerRequest,readOwnerRequests} from '../lib/owner-media-requests.js';
import {ownerRequestText} from '../public/owner-media.js';
const token='a'.repeat(64),origin='https://example.com',base=origin+'/api/owner-media/files';
function mockStore(){
 let row;
 return {doc:async()=>row,async query(sql,args){
  if(sql.includes('ss_sessions'))return args[0]===hash(token)?[{expires:Infinity}]:[];
  if(sql.startsWith('INSERT')&&!row){row={body:args[1],revision:0};return [row];}
  if(sql.startsWith('UPDATE')&&row?.revision===args[2]){row={body:args[0],revision:row.revision+1};return [row];}
  return [];
 }};
}
function mockBucket(){
 const rows=new Map();
 return {async put(key,bytes,meta){const o={key,...meta,body:bytes,size:bytes.length,uploaded:new Date()};rows.set(key,o);return o;},
  async head(k){return rows.get(k);},async get(k,opts){const o=rows.get(k),r=opts?.range;return o&&{...o,body:r?o.body.slice(r.offset,r.offset+r.length):o.body};},
  async list(){return {objects:[...rows.values()],truncated:false};}};
}
const request=(path='',opts={})=>new Request(base+path,opts);
const owner={Cookie:'session='+token,Origin:origin};
test('media storage is private, requires same origin for upload, and supports video seeking without public links',async()=>{
 const store=mockStore(),bucket=mockBucket(),run=(path,opts)=>ownerMediaStorage(request(path,opts),{store,bucket,origin});
 const video=new Uint8Array([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]);
 const opts={method:'POST',headers:{...owner,'Content-Type':'video/mp4','X-Sickstyle-Media-Name':encodeURIComponent('リール.mp4')},body:video};
 assert.equal((await run('')).status,401);
 assert.equal((await run('',{...opts,headers:{...opts.headers,Origin:'https://other.example.com'}})).status,403);
 assert.equal((await run('',{...opts,body:'<svg>'})).status,415);
 assert.equal((await run('',{...opts,headers:{...opts.headers,'Content-Length':'999999999'}})).status,413);
 const created=await run('',opts);assert.equal(created.status,201);
 const asset=await created.json();assert.equal(asset.name,'リール.mp4');assert.equal(asset.type,'video/mp4');
 assert.equal((await run('/'+asset.id)).status,401);
 assert.equal((await run('/'+asset.id,{method:'HEAD'})).status,401);
 const get=await run('/'+asset.id,{headers:{...owner,Range:'bytes=4-7'}});
 assert.equal(get.status,206);assert.equal(get.headers.get('content-range'),'bytes 4-7/16');assert.equal(await get.text(),'ftyp');
 assert.equal(get.headers.get('cache-control'),'private, no-store');
 assert.equal((await run('/'+asset.id,{headers:{...owner,Range:'bytes=100-'}})).status,416);
 assert.equal((await run('/nope',{headers:owner})).status,404);
 assert.deepEqual((await (await run('',{headers:owner})).json()).files,[asset]);
 assert.deepEqual(await (await ownerMediaStorage(request('',{headers:owner}),{store,origin})).json(),{available:false,files:[],cursor:null});
});
test('owner requests are idempotent, use future JST dates, and do not enqueue publishing',async()=>{
 const store=mockStore(),id=randomUUID(),assetId='8000000000000-'+randomUUID(),now=Date.parse('2026-11-27T00:00:00Z');
 const value={id,type:'投稿予約',assetId,note:'  文章も確認  ',scheduledJst:'2026-11-27T09:01'};
 await assert.rejects(()=>addOwnerRequest(store,{...value,scheduledJst:'2026-11-27T09:00'},now),/未来/);
 await assert.rejects(()=>addOwnerRequest(store,{...value,scheduledJst:'2026-11-31T09:00'},now),/未来/);
 await assert.rejects(()=>addOwnerRequest(store,{...value,publish:true},now),/形式/);
 const saved=await addOwnerRequest(store,value,now);
 assert.deepEqual(await addOwnerRequest(store,value,now+10),saved);
 assert.equal(saved.note,'文章も確認');
 await assert.rejects(()=>addOwnerRequest(store,{...value,note:'変更'},now),{status:409});
 assert.deepEqual((await readOwnerRequests(store)).requests,[saved]);
 const handoff=ownerRequestText(saved,'素材.mp4');
 assert.match(handoff,/09:01（日本時間）/);assert.match(handoff,/素材.mp4/);assert.match(handoff,/確認してから/);
});
test('optional publication music is saved with the request and copied without authorizing publication',async()=>{
 const store=mockStore(),now=Date.parse('2026-11-27T00:00:00Z');
 const r={id:randomUUID(),type:'投稿予約',note:'fixture',assetId:'8000000000000-'+randomUUID(),scheduledJst:'2026-11-27T10:00',music:{mode:'instagram',track:'  曲 / アーティスト  '}};
 await assert.rejects(addOwnerRequest(store,{...r,music:{mode:'instagram',track:''}},now),/曲名/);
 await assert.rejects(addOwnerRequest(store,{...r,music:{mode:'silent',track:'spoof'}},now),/曲名/);
 await assert.rejects(addOwnerRequest(store,{...r,type:'修正',scheduledJst:null},now),/音楽/);
 const saved=await addOwnerRequest(store,r,now);assert.equal(saved.music.track,'曲 / アーティスト');
 assert.deepEqual(await addOwnerRequest(store,r,now+1),saved);
 assert.equal((await readOwnerRequests(store)).requests[0].music.mode,'instagram');
 assert.match(ownerRequestText(saved),/Instagram内で追加：曲 \/ アーティスト/);
 assert.equal(saved.state,'draft');
 await assert.rejects(addOwnerRequest(store,{...r,music:{mode:'silent',track:''}},now),{status:409});
});
