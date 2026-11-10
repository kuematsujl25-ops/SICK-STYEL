import test from 'node:test';import assert from 'node:assert/strict';
import {routeRequest} from '../lib/ai-routing.js';
import {emptyTeam,transitionTeam,taskPacket,writeTeam,readTeam,digest} from '../lib/ai-team.js';
import {eligibleJob} from '../scripts/ai-staff/auto-runner.js';
import {createStore} from '../lib/store.js';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const now='2026-10-24T09:00:00Z';
test('local route selects primary/support and holds unknown or equally weighted requests',()=>{
 assert.equal(routeRequest('在庫と欠品','利益を確認').primary,'profit_inventory');
 const multi=routeRequest('Amazon 商品ページ','広告を改善');assert.equal(multi.primary,'ec');assert.deepEqual(multi.collaborators,['marketing']);
 assert.equal(routeRequest('広告','在庫').primary,null);assert.equal(routeRequest('相談','よろしく').primary,null);
});
test('unified requests persist with audit, cannot execute/export/import, and deduplicate',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'intake-')),store=await createStore({DATA_DIR:dir});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const body={revision:0,command:{action:'intake',job:{title:'在庫の確認',objective:'欠品と利益を確認したい'}}};
 const saved=await writeTeam(store,body);const loaded=await readTeam(store);assert.deepEqual(saved,loaded);
 const j=loaded.state.jobs[0];assert.equal(j.status,'awaiting_permission');assert.equal(j.routing.primary,'profit_inventory');assert.equal(loaded.state.audit.length,2);
 assert.equal(eligibleJob({state:{...loaded.state,enabled:true}}),null);assert.throws(()=>taskPacket(j),/未承認/);
 assert.throws(()=>transitionTeam({...loaded.state,enabled:true},{action:'import',job_id:j.id,packet:{}},now),/未承認/);
 await assert.rejects(writeTeam(store,{...body,revision:saved.revision}),/受付済み/);
 await assert.rejects(writeTeam(store,body),/更新/);
});
test('ambiguous intake requires explicit local routing without changing execution permission',()=>{
 let s=transitionTeam(emptyTeam(),{action:'intake',job:{title:'広告と在庫',objective:'改善したい'}},now);const id=s.jobs[0].id;
 assert.equal(s.jobs[0].status,'awaiting_routing');s=transitionTeam(s,{action:'route',job_id:id,primary:'marketing',collaborators:['profit_inventory']},now);
 assert.equal(s.jobs[0].status,'awaiting_permission');assert.equal(s.jobs[0].routing.confirmed,true);assert.equal(s.audit.at(-1).action,'routing_confirmed');
 const initial=s.audit.at(-1);assert.equal(initial.details.previous.primary,null);assert.equal(initial.details.next.primary,'marketing');
 s=transitionTeam(s,{action:'route',job_id:id,primary:'profit_inventory',collaborators:['marketing']},now);
 const entry=s.audit.at(-1);assert.equal(entry.details.previous.primary,'marketing');assert.deepEqual(entry.details.previous.collaborators,['profit_inventory']);assert.equal(entry.details.next.primary,'profit_inventory');assert.deepEqual(initial.details.next.collaborators,['profit_inventory']);
 const {hash,...hashed}=entry;assert.equal(hash,digest(hashed));assert.equal(entry.previous,initial.hash);
 assert.throws(()=>transitionTeam(s,{action:'route',job_id:id,primary:'marketing',collaborators:['marketing']},now));
});
test('intake validation rejects secrets/contact and preserves original jobs on failed writes',()=>{
 const state=emptyTeam();assert.throws(()=>transitionTeam(state,{action:'intake',job:{title:'相談',objective:'test@example.com'}},now));assert.equal(state.jobs.length,0);
});
