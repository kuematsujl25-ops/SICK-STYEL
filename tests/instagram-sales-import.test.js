import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateImport,configureSalesOwner,importSalesEvents,readSalesLedger,voidSalesEvent,mapSalesPeer} from '../lib/instagram-sales-import.js';
import {salesKpiProjection} from '../lib/instagram-sales-kpi.js';
const now='2026-10-31T00:00:00Z';
const event=(type='reply',date='2026-10-20',peer='example_peer')=>({peer,type,date,direction:type==='reply'?'inbound':'outbound',confirmed:true,historyStartConfirmed:type==='new_dm',firstOutboundConfirmed:type==='new_dm',inviteConfirmed:type==='zoom_invite'});
const batch=(events=[event()])=>({owner:'example_owner',source:'browser_observation',capturedAt:now,rangeStart:'2026-09-01',rangeEnd:'2026-10-31',events});
class Store {
 constructor(){this.rows=new Map([['workspace',{body:JSON.stringify({salesKpiRecords:[]}),revision:4}]]);this.races=0;}
 async doc(name){return structuredClone(this.rows.get(name));}
 async query(sql,args){if(sql.startsWith('INSERT')){if(!this.rows.has(args[0]))this.rows.set(args[0],{body:args[1],revision:0});return [];}
 const [body,name,rev]=args,row=this.rows.get(name);if(this.races){this.races--;row.revision++;return [];}
 if(row.revision!==rev)return [];this.rows.set(name,{body,revision:rev+1});return [{revision:rev+1}];}
}
async function setup(){const s=new Store();await configureSalesOwner(s,{owner:'example_owner',confirmed:true});return s;}
const reject=(f,code)=>assert.rejects(f,e=>e.code===code);
test('minimal allowlist rejects private fields, unknown dates, wrong direction and unproven facts',()=>{
 for(const change of [{body:'synthetic private text'},{address:'synthetic address'},{attachment:'synthetic.png'},{date:null},{peer:'not a handle'},{confirmed:false}])assert.throws(()=>validateImport(batch([{...event(),...change}]),'example_owner',now));
 assert.throws(()=>validateImport({...batch(),token:'synthetic'},'example_owner',now));
 assert.throws(()=>validateImport(batch([{...event('new_dm'),historyStartConfirmed:false}]),'example_owner',now),/first_dm_unproven/);
 assert.throws(()=>validateImport(batch([{...event('zoom_invite'),inviteConfirmed:false}]),'example_owner',now),/invitation_unproven/);
 assert.throws(()=>validateImport(batch([{...event(),direction:'outbound'}]),'example_owner',now),/unconfirmed_direction/);
 assert.throws(()=>validateImport(batch(Array.from({length:101},()=>event())),'example_owner',now),/invalid_batch/);
 assert.throws(()=>validateImport(batch([event('reply','2026-11-01')]),'example_owner',now));
});
test('owner is pinned; concurrent imports and later captures are idempotent without workspace writes',async()=>{
 const s=await setup(),before=await s.doc('workspace');
 await reject(()=>configureSalesOwner(s,{owner:'other_owner',confirmed:true}),'owner_already_configured');
 await reject(()=>importSalesEvents(s,{...batch(),owner:'other_owner'},'example_owner',now),'owner_mismatch');
 const results=await Promise.all([importSalesEvents(s,batch(),'example_owner',now),importSalesEvents(s,batch(),'example_owner',now)]);
 assert.equal(results.reduce((n,r)=>n+r.added,0),1);assert.equal((await readSalesLedger(s,'example_owner')).events.length,1);
 assert.equal((await importSalesEvents(s,{...batch(),capturedAt:'2026-10-31T01:00:00Z'},'example_owner','2026-10-31T02:00:00Z')).replayed,1);
 assert.deepEqual(await s.doc('workspace'),before);
});
test('CAS retry exhaustion and batch conflict never partially append',async()=>{
 const s=await setup();s.races=5;await reject(()=>importSalesEvents(s,batch(),'example_owner',now),'concurrent_change_retry');
 assert.equal((await readSalesLedger(s,'example_owner')).events.length,0);
 await reject(()=>importSalesEvents(s,batch([event('new_dm'),event('new_dm','2026-10-21')]),'example_owner',now),'first_dm_date_conflict');
 assert.equal((await readSalesLedger(s,'example_owner')).events.length,0);
});
test('void is revision guarded, replay cannot resurrect, corrected first date is append-only',async()=>{
 const s=await setup();await importSalesEvents(s,batch([event('new_dm')]),'example_owner',now);
 let l=await readSalesLedger(s,'example_owner');const v={owner:l.owner,key:l.events[0].key,revision:0,reason:'incorrect_date'};
 await reject(()=>voidSalesEvent(s,v,l.owner,now),'stale_revision');
 await voidSalesEvent(s,{...v,revision:l.revision},l.owner,now);
 assert.equal((await importSalesEvents(s,batch([event('new_dm')]),l.owner,now)).suppressed,1);
 await importSalesEvents(s,batch([event('new_dm','2026-10-19')]),l.owner,now);
 l=await readSalesLedger(s,l.owner);assert.equal(l.events.length,2);assert.equal(l.voids.length,1);
 assert.equal(salesKpiProjection(l,[],'2026-10',{},now).imported.monthly.new_dm,1);
});
test('month activity differs from first DM cohort and Zoom invitation never becomes appointment',async()=>{
 const s=await setup();await importSalesEvents(s,batch([event('new_dm','2026-09-01'),event(),event('reply','2026-10-21'),event('zoom_invite')]),'example_owner',now);
 const p=salesKpiProjection(await readSalesLedger(s,'example_owner'),[],'2026-10',{},now);
 assert.deepEqual(p.imported.monthly,{new_dm:0,reply:1,zoom_invite:1});assert.deepEqual(p.imported.cohort,{new_dm:0,reply:0,zoom_invite:0});assert.equal(p.legacyFirstOccurrenceCounts.appointment,0);assert.equal(p.combined,null);
});
test('explicit identity mapping deduplicates manual records and preserves cancellations',async()=>{
 const s=await setup();const manual=[{id:'m1',party:'party1',type:'reply',date:'2026-10-20'}];
 s.rows.set('workspace',{body:JSON.stringify({salesKpiRecords:manual}),revision:4});
 await importSalesEvents(s,batch(),'example_owner',now);let l=await readSalesLedger(s,'example_owner');
 await mapSalesPeer(s,{owner:l.owner,peer:'example_peer',party:'party1',confirmed:true,revision:l.revision},l.owner);
 l=await readSalesLedger(s,l.owner);assert.equal(salesKpiProjection(l,manual,'2026-10',l.mappings,now).combined.monthly.reply,1);
 const cancelled=[...manual,{id:'v1',type:'void',ref:'m1',date:'2026-10-21'}];
 assert.equal(salesKpiProjection(l,cancelled,'2026-10',l.mappings,now).linkageReason,'manual_correction_conflict');
 assert.deepEqual(JSON.parse((await s.doc('workspace')).body).salesKpiRecords,manual);
});

test('changed provenance and additional confirmations replay without blocking unrelated new facts',async()=>{
 const s=await setup();await importSalesEvents(s,{...batch(),source:'manual'},'example_owner',now);
 const r=await importSalesEvents(s,batch([{...event(),historyStartConfirmed:true,firstOutboundConfirmed:true},event('reply','2026-10-21','example_second')]),'example_owner',now);
 assert.equal(r.replayed,1);assert.equal(r.added,1);
 const l=await readSalesLedger(s,'example_owner');assert.equal(l.events[0].source,'manual');assert.equal(l.events.length,2);
});
