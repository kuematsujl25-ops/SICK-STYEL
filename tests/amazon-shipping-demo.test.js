import {test} from 'node:test';
import http from 'node:http';
import {fork} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {syntheticEvidence} from '../local/amazon-fulfillment/reconciliation.js';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDemoService} from '../local/amazon-fulfillment/service.js';
import {createDemoServer} from '../local/amazon-fulfillment/server.js';
import {fulfillmentReadiness} from '../lib/amazon-fulfillment-gate.js';
import handler from '../api/index.js';
import {withRuntime} from '../lib/runtime.js';
const admin={id:'test-admin',role:'admin',mfa:true};
const now=()=>Date.parse('2026-10-25T12:00:00Z');
const input=(n=1,tracking='DEMO-123456')=>({carrierCode:'DEMO-YAMATO',trackingNumber:tracking,shipDate:'2026-10-25T10:00:00Z',items:[{orderItemId:'DEMO-ITEM-1',quantity:n}]});
const ack='CONFIRM_SYNTHETIC_SHIPMENT';
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('PII and shipment production gate cannot be enabled by environment flags',()=>{
 process.env.AMAZON_FULFILLMENT_ENABLED='true';assert.equal(fulfillmentReadiness().enabled,false);delete process.env.AMAZON_FULFILLMENT_ENABLED;
});
test('admin server authorization, MFA and individual identity required for every demo operation',()=>{
 const s=createDemoService({now}),p=s.preview(admin,'DEMO-ORDER-1',input());
 for(const user of [null,{}, {id:'staff',role:'staff',mfa:true},{id:'x',role:'admin',mfa:false},{role:'admin',mfa:true}])for(const fn of [()=>s.listing(user),()=>s.address(user,'DEMO-ORDER-1'),()=>s.preview(user,'DEMO-ORDER-1',input()),()=>s.confirm(user,p.id,ack),()=>s.detail(user,p.id),()=>s.reconcile(user,p.id)])rejects(fn,'ADMIN_MFA_REQUIRED');
 rejects(()=>s.confirm({...admin,id:'other'},p.id,ack),'OTHER_ADMIN_DRAFT');
});
test('listing and journal/audit never include address; returned objects cannot mutate state',()=>{
 const s=createDemoService({now});const address=s.address(admin,'DEMO-ORDER-1');address.name='modified';assert.notEqual(s.address(admin,'DEMO-ORDER-1').name,'modified');
 const p=s.preview(admin,'DEMO-ORDER-1',input());p.payload.packageDetail.orderItems[0].quantity=100;assert.equal(s.detail(admin,p.id).payload.packageDetail.orderItems[0].quantity,1);
 const data=JSON.stringify([s.listing(admin),s.snapshot()]);assert.doesNotMatch(data,/合成データ 配送テスト様|addressLine|postalCode|buyerEmail|架空県/);
 assert.doesNotMatch(JSON.stringify(s.snapshot().audit),/trackingNumber|DEMO-123456|payload/);
});
test('ineligible orders including COD fail closed',()=>{const s=createDemoService({now});for(const id of ['3','4','5','6','7','8','9']){rejects(()=>s.preview(admin,'DEMO-ORDER-'+id,input()),'ORDER_NOT_ELIGIBLE');rejects(()=>s.address(admin,'DEMO-ORDER-'+id),'ORDER_NOT_ELIGIBLE');}rejects(()=>s.address(admin,'REAL-ORDER'),'NOT_FOUND');});
test('strict shipment fields reject over-quantity, duplicates, bad ID/date and real tracking',()=>{
 const s=createDemoService({now});for(const items of [[],[{orderItemId:'DEMO-ITEM-1',quantity:4}],[{orderItemId:'DEMO-ITEM-1',quantity:0}],[{orderItemId:'DEMO-ITEM-1',quantity:1.5}],[{orderItemId:'DEMO-ITEM-1',quantity:'1'}],[{orderItemId:'OTHER',quantity:1}],[...input().items,...input().items]])assert.throws(()=>s.preview(admin,'DEMO-ORDER-1',{...input(),items}));
 for(const shipDate of ['2027-01-01T00:00:00Z','2026-09-01T00:00:00Z','invalid','2026-10-25'])rejects(()=>s.preview(admin,'DEMO-ORDER-1',{...input(),shipDate}),'INVALID_SHIP_DATE');
 for(const trackingNumber of ['123456789','<script>','DEMO-1'])rejects(()=>s.preview(admin,'DEMO-ORDER-1',{...input(),trackingNumber}),'SYNTHETIC_CARRIER_TRACKING_REQUIRED');
});
test('partial shipment and multiple packages reserve exact quantities, server assigns immutable IDs',()=>{
 const s=createDemoService({now});const p=s.preview(admin,'DEMO-ORDER-1',{...input(1),packageReferenceId:'99',address:'discard',admin:true});assert.equal(p.payload.packageDetail.packageReferenceId,'1');assert.equal(p.payload.address,undefined);
 rejects(()=>s.confirm(admin,p.id,'yes'),'EXPLICIT_CONFIRMATION_REQUIRED');
 assert.equal(s.confirm(admin,p.id,ack).state,'ACCEPTED');assert.equal(s.listing(admin)[0].status,'UNSHIPPED');
 const p2=s.preview(admin,'DEMO-ORDER-1',input(2,'DEMO-654321'));assert.equal(p2.payload.packageDetail.packageReferenceId,'2');s.confirm(admin,p2.id,ack);assert.equal(s.listing(admin)[0].items[0].remaining,0);
 rejects(()=>s.preview(admin,'DEMO-ORDER-1',input()),'INVALID_QUANTITY');
 const partial=s.preview(admin,'DEMO-ORDER-2',input(2));assert.equal(partial.payload.packageDetail.orderItems[0].quantity,2);
});
test('double click, reload, competing preview, and stale quantities never dispatch twice',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'outbox-reload-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'demo.sqlite');
 const s=createDemoService({now,databasePath:path}),p=s.preview(admin,'DEMO-ORDER-1',input(3)),p2=s.preview(admin,'DEMO-ORDER-1',input(1,'DEMO-654321'));
 s.confirm(admin,p.id,ack);s.confirm(admin,p.id,ack,{scenario:'timeout'});assert.equal(s.detail(admin,p.id).state,'ACCEPTED');rejects(()=>s.confirm(admin,p2.id,ack),'STALE_QUANTITY');s.close();
 const restarted=createDemoService({now,databasePath:path});restarted.confirm(admin,p.id,ack);assert.equal(restarted.snapshot().audit.filter(a=>a.event==='DISPATCH_RESERVED').length,1);restarted.close();
});
test('unknown outcome persists, cannot be replaced by a new package or silently retried',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'outbox-unknown-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'demo.sqlite');
 const s=createDemoService({now,databasePath:path}),p=s.preview(admin,'DEMO-ORDER-1',input());s.confirm(admin,p.id,ack,{scenario:'timeout'});s.close();
 const restarted=createDemoService({now,databasePath:path});assert.equal(restarted.confirm(admin,p.id,ack).state,'UNKNOWN');assert.equal(restarted.reconcile(admin,p.id).state,'UNKNOWN');rejects(()=>restarted.preview(admin,'DEMO-ORDER-1',input(1,'DEMO-654321')),'RECONCILIATION_REQUIRED');assert.equal(restarted.listing(admin)[0].items[0].remaining,2);restarted.close();
});
test('durable queue survives restart; in-flight lease recovers UNKNOWN without reclaim',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'outbox-crash-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'demo.sqlite');let clock=now();
 let s=createDemoService({now:()=>clock,databasePath:path});const p=s.preview(admin,'DEMO-ORDER-1',input());s.enqueue(admin,p.id,ack);s.close();
 s=createDemoService({now:()=>clock,databasePath:path});assert.equal(s.detail(admin,p.id).state,'QUEUED');const attempt=s.claim(admin,p.id);assert.ok(attempt.attemptId);s.close();
 s=createDemoService({now:()=>clock,databasePath:path});assert.equal(s.detail(admin,p.id).state,'SUBMITTING');assert.equal(s.claim(admin,p.id),null);clock+=60001;assert.equal(s.detail(admin,p.id).state,'UNKNOWN');assert.equal(s.complete(admin,p.id,attempt.attemptId,'accepted').state,'UNKNOWN');assert.equal(s.claim(admin,p.id),null);s.close();
});
test('preview expires and rejected submission is terminal; accepted differs from verified',()=>{
 let clock=now();const s=createDemoService({now:()=>clock}),p=s.preview(admin,'DEMO-ORDER-1',input());clock+=300001;rejects(()=>s.confirm(admin,p.id,ack),'PREVIEW_EXPIRED');
 const p2=s.preview(admin,'DEMO-ORDER-1',input(1,'DEMO-654321'));assert.equal(s.confirm(admin,p2.id,ack,{scenario:'rejected'}).state,'REJECTED');assert.equal(s.confirm(admin,p2.id,ack).state,'REJECTED');
 const p3=s.preview(admin,'DEMO-ORDER-1',input(1,'DEMO-999999'));s.confirm(admin,p3.id,ack);assert.equal(s.reconcile(admin,p3.id).state,'VERIFIED');assert.equal(s.listing(admin)[0].status,'PARTIALLY_SHIPPED');s.close();
});
test('production HTTP routes reject unauthenticated and all shared-session users without outbound requests',async()=>{
 let outbound=0;const previous=globalThis.fetch;globalThis.fetch=async()=>{outbound++;throw Error('forbidden');};
 try{for(const loggedIn of [false,true])for(const method of ['GET','POST'])for(const route of ['','/orders','/orders/123/address','/packages/123/confirm']){
  const req={url:'/api/amazon/fulfillment'+route,method,headers:{cookie:'session=synthetic',host:'localhost',origin:'http://localhost','x-role':'admin'},async *[Symbol.asyncIterator](){yield Buffer.from('{"role":"admin","mfa":true}');}};
  let status,body;const headers={};const res={setHeader:(k,v)=>headers[k]=v,writeHead:(s,h)=>{status=s;Object.assign(headers,h);},end:b=>body=JSON.parse(b)};
  await withRuntime({STORE:{query:async q=>q.includes('ss_users')?[{id:1}]:loggedIn?[{expires:Date.now()+10000}]:[]}},()=>handler(req,res));assert.equal(status,loggedIn?403:401);assert.equal(headers['Cache-Control'],'no-store');if(loggedIn)assert.equal(body.enabled,false);
 }assert.equal(outbound,0);}finally{globalThis.fetch=previous;}
});
test('loopback HTTP demo requires session, rejects forged roles/cross-origin, preserves reload journal',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'amazon-synthetic-'));const app=createDemoServer({journalDir:dir});const origin=await app.start();t.after(async()=>{await app.stop();await rm(dir,{recursive:true,force:true});});
 const request=async(path,data,headers={})=>fetch(origin+'/api'+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json',Origin:origin}:{}),...headers},body:data?JSON.stringify(data):undefined});
 assert.equal((await request('/orders',undefined,{'x-role':'admin'})).status,401);
 assert.equal((await request('/login',{token:app.secret},{Origin:'https://example.com'})).status,403);
 assert.equal(await new Promise((resolve,reject)=>{const r=http.get(origin+'/api/orders',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);}),403);
 const login=await request('/login',{token:app.secret}),Cookie=login.headers.get('set-cookie').split(';')[0];
 const list=await request('/orders',undefined,{Cookie});assert.equal(list.status,200);assert.equal(list.headers.get('cache-control'),'no-store');assert.doesNotMatch(await list.text(),/postalCode|架空県/);
 const p=await(await request('/orders/DEMO-ORDER-1/preview',input(),{Cookie})).json();assert.ok(p.id);
 const response=await request('/packages/'+p.id+'/confirm',{ack,scenario:'timeout'},{Cookie});assert.equal((await response.json()).state,'UNKNOWN');
 const reloaded=createDemoServer({journalDir:dir});assert.equal(reloaded.service.snapshot().packages[0].state,'UNKNOWN');reloaded.service.close();
 const logout=await request('/logout',{}, {Cookie});assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await request('/orders',undefined,{Cookie})).status,401);
});
async function child(path,time){
 const proc=fork(new URL('./fixtures/amazon-outbox-child.js',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc'],env:{PATH:process.env.PATH}});
 const next=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{proc.kill();reject(Error('child timeout'));},10000);proc.once('message',m=>{clearTimeout(timer);resolve(m);});proc.once('error',e=>{clearTimeout(timer);reject(e);});});
 const ready=next();proc.send({action:'init',path,now:time});await ready;
 const exited=new Promise(resolve=>proc.once('exit',(code,signal)=>resolve({code,signal})));
 return {proc,exited,run:message=>{const result=next();proc.send(message);return result;}};
}
test('two independent processes confirm same package once and preserve one fixed reference',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'outbox-race-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'demo.sqlite'),s=createDemoService({databasePath:path,now});t.after(()=>s.close());const p=s.preview(admin,'DEMO-ORDER-1',input());
 const a=await child(path,now()),b=await child(path,now());const results=await Promise.all([a.run({action:'confirm',id:p.id}),b.run({action:'confirm',id:p.id})]);assert.ok(results.every(r=>r.ok));assert.equal(s.snapshot().outbox[0].attempts,1);assert.equal(s.snapshot().audit.filter(a=>a.event==='DISPATCH_RESERVED').length,1);assert.equal(s.snapshot().packages[0].reference,'1');assert.equal(s.listing(admin)[0].items[0].remaining,2);
});
test('parallel packages cannot over-reserve; concurrent duplicate tracking is rejected atomically',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'outbox-quantity-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'demo.sqlite'),s=createDemoService({databasePath:path,now});t.after(()=>s.close());
 const p=s.preview(admin,'DEMO-ORDER-1',input(2)),p2=s.preview(admin,'DEMO-ORDER-1',input(2,'DEMO-654321'));
 const a=await child(path,now()),b=await child(path,now());const results=await Promise.all([a.run({action:'confirm',id:p.id}),b.run({action:'confirm',id:p2.id})]);assert.equal(results.filter(r=>r.ok).length,1);assert.ok(results.some(r=>['STALE_QUANTITY','RECONCILIATION_REQUIRED'].includes(r.code)));assert.equal(s.listing(admin)[0].items[0].remaining,1);
 const c=await child(path,now()),d=await child(path,now());const previews=await Promise.all([c.run({action:'preview',input:input(1,'DEMO-999999')}),d.run({action:'preview',input:input(1,'DEMO-999999')})]);assert.equal(previews.filter(r=>r.ok).length,1);assert.ok(previews.some(r=>r.code==='TRACKING_ALREADY_USED'));
});
test('claim committed in another process remains reserved after that process exits',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'outbox-exit-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'demo.sqlite');let clock=now();const s=createDemoService({databasePath:path,now:()=>clock});t.after(()=>s.close());const p=s.preview(admin,'DEMO-ORDER-1',input());s.enqueue(admin,p.id,ack);
 const c=await child(path,clock);assert.equal((await c.run({action:'claim-and-crash',id:p.id})).ok,true);assert.equal((await c.exited).signal,'SIGKILL');clock+=60001;assert.equal(s.detail(admin,p.id).state,'UNKNOWN');assert.equal(s.snapshot().outbox[0].attempts,1);assert.equal(s.claim(admin,p.id),null);
});
test('reconciliation requires fresh complete seller/order/marketplace scoped exact package evidence',()=>{
 const s=createDemoService({now}),p=s.preview(admin,'DEMO-ORDER-1',input());s.confirm(admin,p.id,ack,{scenario:'timeout'});const valid=syntheticEvidence(p,now());
 const variants=[{...valid,sellerId:'OTHER'},{...valid,marketplaceId:'OTHER'},{...valid,orderId:'DEMO-ORDER-2'},{...valid,source:'amazon-live'},{...valid,complete:false},{...valid,includedData:['PACKAGES']},{...valid,capturedAt:new Date(now()-1).toISOString()},{...valid,capturedAt:new Date(now()+1).toISOString()},{...valid,packages:[]},{...valid,packages:[...valid.packages,...valid.packages]}];
 for(const field of ['carrierCode','trackingNumber','shipDate']){const changed=structuredClone(valid);changed.packages[0][field]='wrong';variants.push(changed);}
 const qty=structuredClone(valid);qty.packages[0].orderItems[0].quantity=2;variants.push(qty);
 for(const v of variants)assert.equal(s.reconcile(admin,p.id,v).state,'UNKNOWN');
 assert.equal(s.reconcile(admin,p.id,{...valid,buyer:{name:'PII MUST NOT PERSIST'}}).state,'VERIFIED');assert.equal(s.listing(admin)[0].status,'PARTIALLY_SHIPPED');assert.doesNotMatch(JSON.stringify(s.snapshot()),/PII MUST NOT PERSIST|buyer/);s.close();
});
test('unexpected external package blocks order, and evidence without a match never releases quantity',()=>{
 const s=createDemoService({now}),p=s.preview(admin,'DEMO-ORDER-1',input());s.confirm(admin,p.id,ack,{scenario:'timeout'});const evidence=syntheticEvidence(p,now());evidence.packages.push({...evidence.packages[0],packageReferenceId:'999',trackingNumber:'DEMO-999999'});assert.equal(s.reconcile(admin,p.id,evidence).state,'UNKNOWN');assert.equal(s.listing(admin)[0].eligible,false);assert.equal(s.listing(admin)[0].items[0].remaining,2);rejects(()=>s.preview(admin,'DEMO-ORDER-1',input(1,'DEMO-654321')),'ORDER_NOT_ELIGIBLE');s.close();
});
test('retention deletes payload physically, keeps minimal anti-replay tombstone, and audit excludes PII',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'outbox-purge-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'demo.sqlite');let clock=now();let s=createDemoService({databasePath:path,now:()=>clock});const p=s.preview(admin,'DEMO-ORDER-1',input());s.confirm(admin,p.id,ack,{scenario:'timeout'});s.address(admin,'DEMO-ORDER-2');clock+=30*86400000+1;
 assert.equal(s.maintenance(admin).removed,1);assert.equal(s.detail(admin,p.id).payload,null);assert.equal(s.detail(admin,p.id).state,'PURGED');assert.equal(s.listing(admin)[0].eligible,false);assert.equal(s.snapshot().outbox[0].attempts,1);rejects(()=>s.preview(admin,'DEMO-ORDER-1',input()),'ORDER_NOT_ELIGIBLE');assert.doesNotMatch(JSON.stringify(s.snapshot().audit),/test-admin|tracking|DEMO-123456|架空|name|postalCode/);s.close();
 assert.equal(readFileSync(path).includes(Buffer.from('DEMO-123456')),false);s=createDemoService({databasePath:path,now:()=>clock});assert.equal(s.listing(admin)[0].eligible,false);s.close();
});
test('revocation purges queued payload, denies all later operations, survives reopening and retains audit',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'outbox-revoke-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'demo.sqlite');let s=createDemoService({databasePath:path,now}),p=s.preview(admin,'DEMO-ORDER-1',input());s.enqueue(admin,p.id,ack);s.revoke(admin);
 for(const fn of [()=>s.listing(admin),()=>s.address(admin,'DEMO-ORDER-1'),()=>s.detail(admin,p.id),()=>s.confirm(admin,p.id,ack),()=>s.claim(admin,p.id),()=>s.reconcile(admin,p.id)])rejects(fn,'ACCESS_REVOKED');assert.equal(s.snapshot().packages[0].payload,null);assert.equal(s.snapshot().outbox[0].attempts,0);assert.ok(s.snapshot().audit.some(a=>a.event==='ACCESS_REVOKED_AND_PURGED'));s.close();s=createDemoService({databasePath:path,now});rejects(()=>s.listing(admin),'ACCESS_REVOKED');s.close();
});
test('invalid principals cannot enqueue, claim, complete, audit, revoke or run maintenance',()=>{
 const s=createDemoService({now}),p=s.preview(admin,'DEMO-ORDER-1',input());for(const actor of [null,{id:'staff',role:'staff',mfa:true},{id:'admin',role:'admin',mfa:false}])for(const fn of [()=>s.enqueue(actor,p.id,ack),()=>s.claim(actor,p.id),()=>s.complete(actor,p.id,'fake','accepted'),()=>s.revoke(actor),()=>s.audit(actor),()=>s.maintenance(actor)])rejects(fn,'ADMIN_MFA_REQUIRED');assert.equal(s.snapshot().packages[0].state,'PREVIEW');s.close();
});
test('failed outbox transaction rolls back quantity reservation and never claims a dispatch',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'outbox-rollback-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'demo.sqlite'),s=createDemoService({databasePath:path,now});t.after(()=>s.close());const p=s.preview(admin,'DEMO-ORDER-1',input());const db=new DatabaseSync(path);
 db.exec("CREATE TRIGGER fail_enqueue BEFORE INSERT ON demo_outbox BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END");assert.throws(()=>s.confirm(admin,p.id,ack));assert.equal(s.detail(admin,p.id).state,'PREVIEW');assert.equal(s.snapshot().outbox.length,0);assert.equal(s.listing(admin)[0].items[0].remaining,3);assert.equal(s.snapshot().audit.some(a=>a.event==='DISPATCH_RESERVED'),false);
 db.exec('DROP TRIGGER fail_enqueue');assert.equal(s.confirm(admin,p.id,ack).state,'ACCEPTED');db.close();
});
test('failed response persistence leaves durable in-flight reservation and recovers as unknown',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'outbox-response-loss-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'demo.sqlite');let clock=now();const s=createDemoService({databasePath:path,now:()=>clock});t.after(()=>s.close());const p=s.preview(admin,'DEMO-ORDER-1',input());s.enqueue(admin,p.id,ack);const attempt=s.claim(admin,p.id),db=new DatabaseSync(path);
 db.exec("CREATE TRIGGER fail_response BEFORE UPDATE ON demo_outbox WHEN NEW.state='ACCEPTED' BEGIN SELECT RAISE(ABORT,'synthetic response write failure'); END");assert.throws(()=>s.complete(admin,p.id,attempt.attemptId,'accepted'));assert.equal(s.detail(admin,p.id).state,'SUBMITTING');clock+=60001;assert.equal(s.detail(admin,p.id).state,'UNKNOWN');assert.equal(s.claim(admin,p.id),null);db.close();
});
test('expired audit is removed after conservative 400-day retention; payload stays purged',()=>{
 let clock=now();const s=createDemoService({now:()=>clock}),p=s.preview(admin,'DEMO-ORDER-1',input());s.confirm(admin,p.id,ack);clock+=30*86400000;s.maintenance(admin);clock+=401*86400000;s.maintenance(admin);assert.equal(s.snapshot().audit.length,0);assert.equal(s.snapshot().packages[0].payload,null);assert.equal(s.listing(admin)[0].eligible,false);s.close();
});
test('fresh complete contradictory order evidence blocks new shipments even without target match',()=>{
 for(const mode of ['target-absent','same-reference-mismatch','cancelled','shipped']){
  const s=createDemoService({now}),p=s.preview(admin,'DEMO-ORDER-1',input());s.confirm(admin,p.id,ack);const v=syntheticEvidence(p,now());
  if(mode==='target-absent')v.packages=[{...v.packages[0],packageReferenceId:'999',orderItems:[{orderItemId:'DEMO-ITEM-1',quantity:3}]}];
  if(mode==='same-reference-mismatch')v.packages[0].orderItems[0].quantity=3;
  if(mode==='cancelled')v.fulfillmentStatus='CANCELLED';if(mode==='shipped')v.fulfillmentStatus='SHIPPED';
  assert.equal(s.reconcile(admin,p.id,v).state,'ACCEPTED');assert.equal(s.listing(admin)[0].eligible,false);rejects(()=>s.preview(admin,'DEMO-ORDER-1',input(2,'DEMO-654321')),'ORDER_NOT_ELIGIBLE');s.close();
 }
});
test('pinned WAL reader reports persistent erasure pending and retries after reader releases',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'outbox-wal-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'demo.sqlite');let clock=now();const s=createDemoService({databasePath:path,now:()=>clock});t.after(()=>s.close());const p=s.preview(admin,'DEMO-ORDER-1',input());s.confirm(admin,p.id,ack);const reader=new DatabaseSync(path);reader.exec('BEGIN');reader.prepare('SELECT payload FROM demo_packages').all();clock+=30*86400000+1;
 const first=s.maintenance(admin);assert.equal(first.removed,1);assert.equal(first.erasurePending,true);assert.equal(readFileSync(path+'-wal').includes(Buffer.from('DEMO-123456')),true);
 const other=createDemoService({databasePath:path,now:()=>clock});assert.equal(other.maintenance(admin).erasurePending,true);reader.exec('ROLLBACK');reader.close();
 const second=other.maintenance(admin);assert.equal(second.removed,0);assert.equal(second.erasurePending,false);assert.equal(readFileSync(path).includes(Buffer.from('DEMO-123456')),false);assert.equal(readFileSync(path+'-wal').includes(Buffer.from('DEMO-123456')),false);other.close();
});
