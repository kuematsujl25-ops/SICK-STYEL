import {randomUUID,createHash} from 'node:crypto';
import {fixtures} from './fixtures.js';
import {openDemoStore} from './store.js';
import {assessEvidence,evidenceScope,syntheticEvidence} from './reconciliation.js';
export class FulfillmentError extends Error {constructor(code,status=409){super(code);this.code=code;this.status=status;}}
const fail=(code,status)=>{throw new FulfillmentError(code,status);};
const digest=x=>createHash('sha256').update(x).digest('hex');
const admin=p=>{if(typeof p?.id!=='string'||!p.id||p.role!=='admin'||p.mfa!==true)fail('ADMIN_MFA_REQUIRED',403);return digest(p.id);};
const eligible=o=>o.channel==='MFN'&&['UNSHIPPED','PARTIALLY_SHIPPED'].includes(o.status)&&o.shipPlus===false&&o.buyShipping===false&&o.cod===false;
const reserved=new Set(['QUEUED','SUBMITTING','UNKNOWN','ACCEPTED','VERIFIED']);
const RETENTION=30*86400000,AUDIT_RETENTION=400*86400000,LEASE=60000;
// All operations are synchronous DB transactions. All dispatch results remain synthetic.
export function createDemoService({databasePath=':memory:',now=()=>Date.now()}={}){
 const store=openDemoStore(databasePath),db=store.db,orders=fixtures();
 const q=(sql,...args)=>db.prepare(sql).all(...args),one=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 store.tx(()=>{for(const o of orders)run('INSERT OR IGNORE INTO demo_orders(id) VALUES(?)',o.id);});
 const audit=(actor,event,id=null)=>run('INSERT INTO demo_audit(actor_hash,event,package_id,at) VALUES(?,?,?,?)',actor,event,id,now());
 const active=()=>{if(one("SELECT value FROM demo_meta WHERE key='revoked'").value==='true')fail('ACCESS_REVOKED',403);};
 const row=id=>one('SELECT * FROM demo_packages WHERE id=?',id)||fail('NOT_FOUND',404);
 const out=p=>({id:p.id,actor:p.actor,orderId:p.order_id,state:p.state,expiresAt:p.expires_at,createdAt:p.created_at,reference:String(p.reference),payload:p.payload?JSON.parse(p.payload):null});
 function find(id,actor){const hash=admin(actor);const p=row(id);if(p.actor!==hash)fail('OTHER_ADMIN_DRAFT',403);return p;}
 function order(id){const o=orders.find(x=>x.id===id)||fail('NOT_FOUND',404),saved=one('SELECT * FROM demo_orders WHERE id=?',id);return {...o,status:saved.observed_status||o.status,blocked:!!saved.blocked};}
 function available(o){return o.items.map(i=>({...i,remaining:i.quantity-(o.previousShipped?.[i.id]||0)-q('SELECT p.state,i.quantity FROM demo_items i JOIN demo_packages p ON p.id=i.package_id WHERE p.order_id=? AND i.item_id=?',o.id,i.id).filter(p=>reserved.has(p.state)).reduce((n,p)=>n+p.quantity,0)}));}
 function recoverInternal(){
  const stale=q("SELECT package_id FROM demo_outbox WHERE state='IN_FLIGHT' AND lease_until<=?",now());
  for(const p of stale){run("UPDATE demo_outbox SET state='UNKNOWN' WHERE package_id=?",p.package_id);run("UPDATE demo_packages SET state='UNKNOWN',updated_at=? WHERE id=?",now(),p.package_id);audit('system','LEASE_EXPIRED_UNKNOWN',p.package_id);}
  run("UPDATE demo_packages SET state='EXPIRED',updated_at=? WHERE state='PREVIEW' AND expires_at<=?",now(),now());
 }
 const erasurePending=()=>!!one("SELECT (SELECT value FROM demo_meta WHERE key='erasure_generation') != (SELECT value FROM demo_meta WHERE key='erasure_completed') AS pending").pending;
 const markErasure=()=>run("UPDATE demo_meta SET value=CAST(value AS INTEGER)+1 WHERE key='erasure_generation'");
 function retryErasure(){
  const generation=one("SELECT value FROM demo_meta WHERE key='erasure_generation'").value;
  if(erasurePending()&&store.compact())store.tx(()=>{
   // Do not acknowledge a concurrent purge that happened after our checkpoint began.
   if(one("SELECT value FROM demo_meta WHERE key='erasure_generation'").value===generation)run("UPDATE demo_meta SET value=? WHERE key='erasure_completed'",generation);
  });return erasurePending();
 }
 function maintenance(){
  const result=store.tx(()=>{
   recoverInternal();let removed=0;
   for(const p of q("SELECT id,order_id FROM demo_packages WHERE payload IS NOT NULL AND created_at<=?",now()-RETENTION)){
    // Keep a minimal tombstone and block the order: erasure must not permit a duplicate/new-ID send.
    run("UPDATE demo_packages SET payload=NULL,state='PURGED',updated_at=? WHERE id=?",now(),p.id);
    run("UPDATE demo_outbox SET state='PURGED',lease_until=NULL WHERE package_id=?",p.id);
    run('DELETE FROM demo_items WHERE package_id=?',p.id);run('UPDATE demo_orders SET blocked=1 WHERE id=?',p.order_id);audit('system','PAYLOAD_PURGED',p.id);removed++;
   }
   const removedAudit=run('DELETE FROM demo_audit WHERE at<?',now()-AUDIT_RETENTION).changes;
   if(removed||removedAudit)markErasure();return {removed,removedAudit};
  });return {...result,erasurePending:retryErasure()};
 }
 function auth(actor){admin(actor);maintenance();active();}
 function listing(actor){auth(actor);return store.tx(()=>{active();return orders.map(base=>{const o=order(base.id);return {id:o.id,status:o.status,eligible:eligible(o)&&!o.blocked,items:available(o),packages:q('SELECT * FROM demo_packages WHERE order_id=? ORDER BY reference',o.id).map(p=>({id:p.id,reference:String(p.reference),state:p.state}))};});});}
 function preview(actor,id,input){
  auth(actor);return store.tx(()=>{
   active();const o=order(id);if(!eligible(o)||o.blocked)fail('ORDER_NOT_ELIGIBLE');
   if(one("SELECT id FROM demo_packages WHERE order_id=? AND state IN ('QUEUED','SUBMITTING','UNKNOWN')",id))fail('RECONCILIATION_REQUIRED');
   if(!input||!['DEMO-YAMATO','DEMO-SAGAWA','DEMO-JP'].includes(input.carrierCode)||typeof input.trackingNumber!=='string'||!/^DEMO-[0-9]{6,20}$/.test(input.trackingNumber))fail('SYNTHETIC_CARRIER_TRACKING_REQUIRED',400);
   if(typeof input.shipDate!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?(?:Z|[+-]\d\d:\d\d)$/.test(input.shipDate)||!Number.isFinite(Date.parse(input.shipDate))||Date.parse(input.shipDate)>now()||Date.parse(input.shipDate)<Date.parse(o.createdAt))fail('INVALID_SHIP_DATE',400);
   if(!Array.isArray(input.items)||!input.items.length||input.items.length>o.items.length)fail('INVALID_ITEMS',400);
   const remaining=available(o),seen=new Set();
   const items=input.items.map(i=>{const match=remaining.find(x=>x.id===i?.orderItemId);if(!match||seen.has(i.orderItemId)||!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>match.remaining)fail('INVALID_QUANTITY',400);seen.add(i.orderItemId);return {orderItemId:i.orderItemId,quantity:i.quantity};});
   const trackingHash=digest(input.trackingNumber);
   if(one('SELECT id FROM demo_packages WHERE order_id=? AND tracking_hash=?',id,trackingHash))fail('TRACKING_ALREADY_USED');
   const reference=one('SELECT next_ref FROM demo_orders WHERE id=?',id).next_ref;
   const payload={marketplaceId:o.marketplaceId,packageDetail:{packageReferenceId:String(reference),carrierCode:input.carrierCode,trackingNumber:input.trackingNumber,shipDate:new Date(input.shipDate).toISOString(),orderItems:items}};
   const json=JSON.stringify(payload),uuid=randomUUID(),actorHash=admin(actor);
   run('UPDATE demo_orders SET next_ref=next_ref+1 WHERE id=?',id);
   run('INSERT INTO demo_packages(id,order_id,actor,reference,tracking_hash,state,created_at,updated_at,expires_at,payload,digest) VALUES(?,?,?,?,?,?,?,?,?,?,?)',uuid,id,actorHash,reference,trackingHash,'PREVIEW',now(),now(),now()+300000,json,digest(json));
   for(const i of items)run('INSERT INTO demo_items VALUES(?,?,?)',uuid,i.orderItemId,i.quantity);
   audit(actorHash,'PREVIEW_CREATED',uuid);return out(row(uuid));
  });
 }
 function enqueue(actor,id,ack){
  auth(actor);return store.tx(()=>{
   active();const p=find(id,actor);if(ack!=='CONFIRM_SYNTHETIC_SHIPMENT')fail('EXPLICIT_CONFIRMATION_REQUIRED',400);
   if(p.state==='EXPIRED')fail('PREVIEW_EXPIRED');if(p.state!=='PREVIEW')return out(p);
   const o=order(p.order_id);if(!eligible(o)||o.blocked)fail('ORDER_NOT_ELIGIBLE');
   if(one("SELECT id FROM demo_packages WHERE order_id=? AND state IN ('QUEUED','SUBMITTING','UNKNOWN')",o.id))fail('RECONCILIATION_REQUIRED');
   const remaining=available(o);for(const i of q('SELECT item_id,quantity FROM demo_items WHERE package_id=?',id))if(i.quantity>remaining.find(x=>x.id===i.item_id).remaining)fail('STALE_QUANTITY');
   run("UPDATE demo_packages SET state='QUEUED',updated_at=? WHERE id=?",now(),id);
   run("INSERT INTO demo_outbox(package_id,state,confirmed_at) VALUES(?,'QUEUED',?)",id,now());audit(admin(actor),'DISPATCH_QUEUED',id);return out(row(id));
  });
 }
 // Claim commits before any simulated external side effect. No second claim, even after a crash.
 function claim(actor,id){auth(actor);return store.tx(()=>{
  active();const p=find(id,actor),box=one('SELECT * FROM demo_outbox WHERE package_id=?',id);
  if(!box||box.state!=='QUEUED'||box.attempts!==0)return null;
  const o=order(p.order_id);if(!eligible(o)||o.blocked)fail('ORDER_NOT_ELIGIBLE');
  if(!p.payload||digest(p.payload)!==p.digest)fail('PAYLOAD_INTEGRITY');
  const attemptId=randomUUID();run("UPDATE demo_outbox SET state='IN_FLIGHT',attempts=1,lease_until=?,attempt_id=? WHERE package_id=?",now()+LEASE,attemptId,id);
  run("UPDATE demo_packages SET state='SUBMITTING',updated_at=? WHERE id=?",now(),id);audit(admin(actor),'DISPATCH_RESERVED',id);
  return {attemptId,package:out(row(id))};
 });}
 function complete(actor,id,attemptId,scenario){admin(actor);if(!['accepted','timeout','rejected'].includes(scenario))fail('INVALID_SCENARIO',400);
  maintenance();return store.tx(()=>{
   active();const p=find(id,actor),box=one('SELECT * FROM demo_outbox WHERE package_id=?',id);
   if(!box||box.attempt_id!==attemptId)fail('INVALID_ATTEMPT');
   // Late response after recovery/revocation/erasure is not allowed to overwrite the conservative state.
   if(box.state!=='IN_FLIGHT')return out(p);
   const state=scenario==='accepted'?'ACCEPTED':scenario==='timeout'?'UNKNOWN':'REJECTED';
   run('UPDATE demo_outbox SET state=?,lease_until=NULL WHERE package_id=?',state,id);run('UPDATE demo_packages SET state=?,updated_at=? WHERE id=?',state,now(),id);audit(admin(actor),'SIMULATED_'+state,id);return out(row(id));
  });
 }
 function dispatch(actor,id,{scenario='accepted'}={}){
  admin(actor);if(!['accepted','timeout','rejected'].includes(scenario))fail('INVALID_SCENARIO',400);
  const attempt=claim(actor,id);return attempt?complete(actor,id,attempt.attemptId,scenario):detail(actor,id);
 }
 function confirm(actor,id,ack,options={}){admin(actor);if(options.scenario&&!['accepted','timeout','rejected'].includes(options.scenario))fail('INVALID_SCENARIO',400);enqueue(actor,id,ack);return dispatch(actor,id,options);}
 function detail(actor,id){auth(actor);return store.tx(()=>{active();return out(find(id,actor));});}
 function reconcile(actor,id,evidence){
  auth(actor);return store.tx(()=>{
   active();const p=find(id,actor);if(!['ACCEPTED','UNKNOWN'].includes(p.state))fail('NOT_RECONCILABLE');
   const model=out(p),box=one('SELECT * FROM demo_outbox WHERE package_id=?',id);
   // Default mock observes only locally ACCEPTED/VERIFIED packages. UNKNOWN never becomes a fabricated success.
   const local=q("SELECT * FROM demo_packages WHERE order_id=? AND state IN ('ACCEPTED','VERIFIED') AND payload IS NOT NULL",p.order_id);
   const source=evidence??(p.state==='ACCEPTED'?syntheticEvidence(model,now(),local.map(x=>JSON.parse(x.payload).packageDetail)):null);
   const scope=evidenceScope(model,source,{now:now(),confirmedAt:box.confirmed_at});
   const previous=one('SELECT observed_at FROM demo_orders WHERE id=?',p.order_id).observed_at;
   if(!scope||(previous!==null&&scope.at<previous)){audit(admin(actor),'RECONCILIATION_UNRESOLVED',id);return model;}
   const assessment=assessEvidence(model,source,{now:now(),confirmedAt:box.confirmed_at});
   // Inspect order-wide contradictions even when our target package is absent or mismatched.
   const known=q("SELECT * FROM demo_packages WHERE order_id=? AND state IN ('SUBMITTING','UNKNOWN','ACCEPTED','VERIFIED') AND payload IS NOT NULL",p.order_id);
   const unexpected=source.packages.some(x=>!known.some(k=>String(k.reference)===x.packageReferenceId&&assessEvidence(out(k),source,{now:now(),confirmedAt:0}).result==='MATCH'));
   const forbiddenStatus=!['UNSHIPPED','PARTIALLY_SHIPPED'].includes(scope.status);
   if(assessment.result!=='MATCH'||unexpected||forbiddenStatus){
    run('UPDATE demo_orders SET blocked=1,observed_status=?,observed_at=? WHERE id=?',scope.status,scope.at,p.order_id);audit(admin(actor),'PACKAGE_OR_ORDER_CONFLICT',id);return model;
   }
   run("UPDATE demo_packages SET state='VERIFIED',updated_at=? WHERE id=?",now(),id);run("UPDATE demo_outbox SET state='VERIFIED' WHERE package_id=?",id);
   run('UPDATE demo_orders SET observed_status=?,observed_at=? WHERE id=?',assessment.status,assessment.at,p.order_id);audit(admin(actor),'SYNTHETIC_PACKAGE_VERIFIED',id);return out(row(id));
  });
 }
 function revoke(actor){admin(actor);store.tx(()=>{
  run("UPDATE demo_meta SET value='true' WHERE key='revoked'");
  run("UPDATE demo_packages SET payload=NULL,state='PURGED',updated_at=?",now());run("UPDATE demo_outbox SET state='PURGED',lease_until=NULL");run('DELETE FROM demo_items');run('UPDATE demo_orders SET blocked=1');audit(admin(actor),'ACCESS_REVOKED_AND_PURGED');markErasure();
 });return {revoked:true,erasurePending:retryErasure()};}
 return {listing,preview,enqueue,claim,complete,dispatch,confirm,reconcile,detail,revoke,
  maintenance(actor){admin(actor);return maintenance();},
  address(actor,id){auth(actor);return store.tx(()=>{active();const o=order(id);if(!eligible(o)||o.blocked)fail('ORDER_NOT_ELIGIBLE');audit(admin(actor),'ADDRESS_VIEWED');return structuredClone(o.address);});},
  audit(actor){auth(actor);return store.tx(()=>{active();return q('SELECT actor_hash,event,package_id,at FROM demo_audit ORDER BY id');});},
  snapshot(){return {version:2,packages:q('SELECT * FROM demo_packages').map(out),outbox:q('SELECT * FROM demo_outbox'),audit:q('SELECT actor_hash,event,package_id,at FROM demo_audit ORDER BY id')};},
  close(){store.close();}
 };
}
