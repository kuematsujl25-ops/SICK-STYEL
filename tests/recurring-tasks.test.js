import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.js';
import {empty,validate} from '../lib/domain.js';
import {runRecurringTasks,prepareRecurringWrite,restoreRecurringTasks,recurringTaskStatus,eligibleDate,jstDate} from '../lib/recurring-tasks.js';
import {recurringTemplate} from '../public/recurring-tasks.js';
const now=new Date('2026-10-30T23:00:00Z');
const template=(id='daily',collection='staffTasks')=>recurringTemplate({id,title:'合成テスト',due:'2026-10-31',priority:'高',assignee:'竹田'},collection);
async function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'recurring-test-'));const store=await createStore({DATA_DIR:dir});try{const data=empty();data.recurringTasks=[template(),template('basic','tasks')];await store.put('workspace',data);await fn(store,data);}finally{store.close();rmSync(dir,{recursive:true,force:true});}}
const read=async store=>JSON.parse((await store.doc('workspace')).body);
test('JST midnight is not the 08:00 trigger; month/year/leap boundaries',()=>{
 assert.equal(jstDate(new Date('2026-10-30T15:00:00Z')),'2026-10-31');
 assert.equal(eligibleDate(new Date('2026-10-30T22:59:59Z')),'2026-10-30');
 assert.equal(eligibleDate(now),'2026-10-31');
 assert.equal(eligibleDate(new Date('2026-12-31T23:00:00Z')),'2027-01-01');
 assert.equal(eligibleDate(new Date('2028-02-28T23:00:00Z')),'2028-02-29');
});
test('daily generation preserves completion, overdue work and deleted occurrences; retries are idempotent',()=>fixture(async store=>{
 assert.equal((await runRecurringTasks(store,new Date(+now-1))).created,0);
 assert.equal((await runRecurringTasks(store,now)).created,2);
 let d=await read(store);assert.equal(d.staffTasks[0].assignee,'竹田');assert.equal(d.staffTasks[0].priority,'高');
 d.tasks[0].done=true;d.staffTasks[0].deletedAt=now.toISOString();await store.put('workspace',d);
 assert.equal((await runRecurringTasks(store,now)).created,0);
 assert.equal((await runRecurringTasks(store,new Date(+now+86400000))).created,2);
 d=await read(store);assert.equal(d.tasks[0].done,true);assert.equal(d.tasks[1].done,false);assert.equal(d.staffTasks[0].deletedAt,now.toISOString());assert.equal(d.staffTasks[1].status,'未着手');
}));
test('concurrent crons and concurrent user completion are retried without lost updates',()=>fixture(async store=>{
 await Promise.all([runRecurringTasks(store,now),runRecurringTasks(store,now)]);
 assert.equal((await read(store)).tasks.length,1);
 const original=store.query;let conflict=true;
 store.query=async(sql,args)=>{if(conflict&&sql.startsWith('UPDATE ss_documents')){conflict=false;const d=await read(store);d.tasks[0].done=true;await store.put('workspace',d);}return original(sql,args);};
 await runRecurringTasks(store,new Date(+now+86400000));
 const d=await read(store);assert.equal(d.tasks.length,2);assert.equal(d.tasks[0].done,true);
}));
test('temporary DB failure does not advance cursor; next run catches up',()=>fixture(async store=>{
 const original=store.query;store.query=async()=>{throw Error('temporary');};
 await assert.rejects(runRecurringTasks(store,now),/temporary/);store.query=original;
 assert.equal((await read(store)).recurringTasks[0].nextDate,'2026-10-31');
 assert.equal((await runRecurringTasks(store,new Date(+now+86400000))).created,4);
}));
test('stop/edit/resume keeps history and skips paused dates',()=>fixture(async store=>{
 await runRecurringTasks(store,now);const old=await read(store);const d=structuredClone(old);d.recurringTasks[0].enabled=false;prepareRecurringWrite(old,d,now);await store.put('workspace',d);
 await runRecurringTasks(store,new Date(+now+86400000));assert.equal((await read(store)).staffTasks.length,1);
 const prev=await read(store);const resumed=structuredClone(prev);resumed.recurringTasks[0].enabled=true;resumed.recurringTasks[0].title='編集後';prepareRecurringWrite(prev,resumed,new Date(+now+2*86400000));await store.put('workspace',resumed);
 await runRecurringTasks(store,new Date(+now+2*86400000));const final=await read(store);assert.equal(final.staffTasks.length,2);assert.equal(final.staffTasks[0].title,'合成テスト');assert.equal(final.staffTasks[1].title,'編集後');assert.equal(final.staffTasks[1].due,'2026-11-02');
}));
test('cursor rewind, removal by old client/backup, invalid destination and past starts rejected',()=>{
 const old=empty();old.recurringTasks=[template()];
 const removed=empty();assert.throws(()=>prepareRecurringWrite(old,removed,now));
 const rewind=structuredClone(old);rewind.recurringTasks[0].nextDate='2026-10-30';assert.throws(()=>prepareRecurringWrite(old,rewind,now));
 const invalid=structuredClone(old);invalid.recurringTasks[0].collection='orgSales';assert.throws(()=>validate(invalid));
 const past=structuredClone(old);past.recurringTasks[0].startDate='2026-10-30';assert.throws(()=>prepareRecurringWrite(empty(),past,now));
 assert.deepEqual(validate({...empty(),recurringTasks:undefined}).recurringTasks,[]);
});
test('collection capacity failure preserves entire batch for retry',()=>fixture(async store=>{
 const d=await read(store);d.tasks=Array.from({length:10000},(_,i)=>({id:String(i),title:'合成',due:'2026-10-30',priority:'低',done:false}));await store.put('workspace',d);
 await assert.rejects(runRecurringTasks(store,now));assert.equal((await read(store)).staffTasks.length,0);assert.equal((await read(store)).recurringTasks[0].nextDate,'2026-10-31');
}));

test('old backup without templates preserves current generated histories and cursors',()=>fixture(async store=>{
 await runRecurringTasks(store,now);const live=await read(store);live.tasks[0].done=true;
 const backup=empty();delete backup.recurringTasks;backup.tasks.push({id:'old',title:'単発バックアップ',due:'2026-10-01',priority:'低',done:true});
 const restored=restoreRecurringTasks(live,backup,now);assert.deepEqual(restored.recurringTasks,live.recurringTasks);assert.equal(restored.tasks.length,2);assert.equal(restored.tasks.find(t=>t.recurringId).done,true);
 await store.put('workspace',restored);assert.equal((await runRecurringTasks(store,now)).created,0);
}));
test('backup from before cursor advance restores safely without undoing completion or duplicating dates',()=>fixture(async store=>{
 await runRecurringTasks(store,now);const backup=await read(store);
 await runRecurringTasks(store,new Date(+now+86400000));const live=await read(store);live.tasks[0].done=true;live.recurringTasks[0].title='現在の設定';live.recurringTasks[0].enabled=false;
 const restored=restoreRecurringTasks(live,backup,new Date(+now+86400000));assert.deepEqual(restored.recurringTasks,live.recurringTasks);assert.equal(restored.tasks.length,2);assert.equal(restored.tasks[0].done,true);assert.equal(restored.staffTasks.length,2);
 await store.put('workspace',restored);assert.equal((await runRecurringTasks(store,new Date(+now+86400000))).created,0);
}));
test('empty environment imports past-start templates paused, preserves history and resumes only in future',()=>fixture(async store=>{
 await runRecurringTasks(store,now);const backup=await read(store);const later=new Date(+now+10*86400000);
 const restored=restoreRecurringTasks(empty(),backup,later);assert.equal(restored.tasks.length,1);assert.equal(restored.recurringTasks[0].enabled,false);assert.equal(restored.recurringTasks[0].startDate,'2026-10-31');assert.equal(restored.recurringTasks[0].nextDate,'2026-11-11');
 await store.put('workspace',restored);assert.equal((await runRecurringTasks(store,later)).created,0);
 const resumed=structuredClone(restored);resumed.recurringTasks.forEach(t=>{t.enabled=true;});prepareRecurringWrite(restored,resumed,later);await store.put('workspace',resumed);assert.equal((await runRecurringTasks(store,later)).created,0);assert.equal((await runRecurringTasks(store,new Date(+later+86400000))).created,2);
 assert.throws(()=>prepareRecurringWrite(empty(),backup,later),'ordinary saves still reject past starts');
}));
test('restore advances cursors past imported occurrences and rejects capacity overflow without truncating',()=>{
 const backup=empty();backup.recurringTasks=[template('daily','tasks')];backup.tasks=[{id:'historical',title:'合成',priority:'低',done:true,due:'2026-11-10',recurringId:'daily',occurrenceDate:'2026-11-10'}];
 const restored=restoreRecurringTasks(empty(),backup,now);assert.equal(restored.recurringTasks[0].nextDate,'2026-11-11');
 const live=empty();live.tasks=Array.from({length:10000},(_,i)=>({id:'live'+i,title:'合成',priority:'低',done:true,due:'2026-10-01',recurringId:'template'+i,occurrenceDate:'2026-10-01'}));
 assert.throws(()=>restoreRecurringTasks(live,backup,now));assert.equal(live.tasks.length,10000);assert.equal(backup.tasks.length,1);
 const collision=structuredClone(backup);collision.tasks[0].id='live0';assert.throws(()=>restoreRecurringTasks(live,collision,now),/競合/);
});
test('server health detects capacity and overdue generation without depending on error-log writes',()=>{
 const d=empty();d.recurringTasks=[template()];assert.equal(recurringTaskStatus(d,new Date(+now+14*60000)),'ok');assert.equal(recurringTaskStatus(d,new Date(+now+15*60000)),'delayed');
 d.tasks=Array(10000).fill({});assert.equal(recurringTaskStatus(d,now),'capacity');d.recurringTasks[0].enabled=false;assert.equal(recurringTaskStatus(d,now),'ok');
});
