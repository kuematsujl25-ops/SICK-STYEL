import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmod,mkdtemp,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bridgeRequest,loadExplicitAsset,origin,prepareBridgeKey,readBridgeKey} from '../scripts/lib/owner-dot-bridge.js';
const id='12345678-0000-4000-8000-999999999999',asset='1234567890123-'+id,key='a'.repeat(64);
test('private Dot bridge key uses owner-only permissions and refuses symbolic links or unsafe permissions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'owner-bridge-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'private','receiver.token');
 const a=await prepareBridgeKey(path);
 assert.match(a,/^[a-f0-9]{64}$/);assert.equal(await readBridgeKey(path),a);
 assert.equal(await prepareBridgeKey(path),a);
 assert.equal((await stat(path)).mode&0o777,0o600);
 await symlink(path,join(root,'private','link'));
 await assert.rejects(readBridgeKey(join(root,'private','link')));
 await chmod(path,0o644);await assert.rejects(readBridgeKey(path),/権限/);
});
test('Dot receiver pins the HTTPS origin, never follows redirects, and separates review from publication',async()=>{
 const order=[];
 const mock=async (url,req)=>{
  assert.equal(url.origin,origin);assert.equal(url.search,'');assert.equal(req.redirect,'error');
  assert.equal(req.headers.Authorization,'Bearer '+key);
  assert.ok(!req.headers.Cookie&&!req.headers.Origin);
  const path=url.pathname.slice('/api/owner-media/dot/'.length);order.push(path);
  if(path==='queue')return Response.json({requests:[{id,state:'queued',type:'投稿予約',note:'fixture',assetId:asset}]});
  if(path==='files'){
   assert.equal(req.method,'POST');assert.equal(req.headers['Content-Type'],'image/png');
   return Response.json({id:asset},{status:201});
  }
  if(path==='files/'+asset)return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png','Content-Length':'3'}});
  if(path==='receive')return Response.json({id,state:'received'});
  assert.equal(path,'complete');assert.equal(JSON.parse(req.body).result,'確認用。未予約・未投稿。');
  return Response.json({id,state:'complete'});
 };
 assert.equal((await bridgeRequest('queue',null,key,mock)).requests[0].id,id);
 assert.equal((await bridgeRequest('receive',{id},key,mock)).state,'received');
 assert.equal((await bridgeRequest('upload',{name:'fixture.png',bytes:new Uint8Array([1,2,3])},key,mock)).id,asset);
 assert.deepEqual((await bridgeRequest('download',{id:asset},key,mock)).bytes,new Uint8Array([1,2,3]));
 assert.equal((await bridgeRequest('complete',{id,result:'確認用。未予約・未投稿。'},key,mock)).state,'complete');
 await assert.rejects(bridgeRequest('publish',{id},key,mock),/未対応/);
 await assert.rejects(bridgeRequest('download',{id:'../queue'},key,mock),/素材ID/);
 await assert.rejects(bridgeRequest('queue',null,'bad',mock),/キー/);
 assert.deepEqual(order,['queue','receive','files','files/'+asset,'complete']);
});
test('Dot receiver rejects truncated downloads and does not read a symlink as an upload',async t=>{
 const root=await mkdtemp(join(tmpdir(),'owner-asset-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const good=join(root,'fixture.png');await writeFile(good,Buffer.from([1,2,3]));
 const link=join(root,'link.png');await symlink(good,link);
 await assert.rejects(loadExplicitAsset(link));
 assert.equal((await loadExplicitAsset(good)).bytes.length,3);
 await assert.rejects(bridgeRequest('download',{id:asset},key,async()=>new Response(new Uint8Array(2),{headers:{'Content-Type':'image/png','Content-Length':'3'}})),/サイズ/);
});
