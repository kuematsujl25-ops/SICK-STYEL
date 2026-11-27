import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.js';
import {empty,validate} from '../lib/domain.js';
import {prepareTaskRetention,runTaskRetention,RETENTION_MS} from '../lib/task-retention.js';
const now=new Date('2026-11-10T10:00:00Z');
const task=()=>({id:'test',title:'Synthetic',due:'2026-11-01',priority:'中',done:false});
const staff=()=>({id:'staff',title:'Synthetic',due:'2026-11-01',priority:'中',status:'完了',assignee:'',relatedOrg:'',relatedPlayer:'',relatedPost:'',nextAction:'',updatedAt:now.toISOString()});
async function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'retention-'));const store=await createStore({DATA_DIR:dir});try{await fn(store);}finally{store.close();rmSync(dir,{recursive:true,force:true});}}
const read=async store=>JSON.parse((await store.doc('workspace')).body);
test('server stamps completion; editing preserves age, reopening resets it; restore grants seven days',()=>{
 const old=empty();old.tasks=[task()];let next=structuredClone(old);next.tasks[0].done=true;next.tasks[0].completedAt='2000-01-01T00:00:00Z';prepareTaskRetention(old,next,now);assert.equal(next.tasks[0].completedAt,now.toISOString());
 let edited=structuredClone(next);edited.tasks[0].title='Changed';prepareTaskRetention(next,edited,new Date(+now+1000));assert.equal(edited.tasks[0].completedRetentionAt,now.toISOString());
 let reopened=structuredClone(edited);reopened.tasks[0].done=false;prepareTaskRetention(edited,reopened,now);assert.equal(reopened.tasks[0].completedAt,null);
 edited.tasks[0].deletedAt=now.toISOString();let restored=structuredClone(edited);restored.tasks[0].deletedAt=null;prepareTaskRetention(edited,restored,new Date(+now+RETENTION_MS));assert.equal(restored.tasks[0].completedRetentionAt,new Date(+now+RETENTION_MS).toISOString());
});
test('legacy completion is observed, not backdated; exactly seven days archives reversibly and idempotently',()=>fixture(async store=>{
 const d=empty();d.tasks=[{...task(),done:true}, {...task(),id:'open'}];d.staffTasks=[staff()];await store.put('workspace',d);
 assert.equal((await runTaskRetention(store,now)).archived,0);let x=await read(store);assert.equal(x.tasks[0].completedAt,undefined);assert.equal(x.tasks[0].completedRetentionAt,now.toISOString());
 assert.equal((await runTaskRetention(store,new Date(+now+RETENTION_MS-1))).archived,0);
 assert.equal((await runTaskRetention(store,new Date(+now+RETENTION_MS))).archived,2);x=await read(store);assert.equal(x.tasks.length,2);assert.ok(x.tasks[0].deletedAt);assert.equal(x.tasks[1].deletedAt,undefined);assert.equal(x.staffTasks.length,1);
 assert.equal((await runTaskRetention(store,new Date(+now+RETENTION_MS))).archived,0);
}));
test('CAS rechecks concurrent reopening and keeps user edit',()=>fixture(async store=>{
 const d=empty();d.tasks=[{...task(),done:true,completedRetentionAt:now.toISOString()}];await store.put('workspace',d);const original=store.query;let conflict=true;
 store.query=async(sql,args)=>{if(conflict&&sql.startsWith('UPDATE ss_documents')){conflict=false;const x=await read(store);x.tasks[0].done=false;x.tasks[0].title='User edit';await store.put('workspace',x);}return original(sql,args);};
 assert.equal((await runTaskRetention(store,new Date(+now+RETENTION_MS))).archived,0);const x=await read(store);assert.equal(x.tasks[0].title,'User edit');assert.equal(x.tasks[0].deletedAt,undefined);
}));
test('recycle bin survives stale clients/imports and malformed timestamps fail',()=>{
 const old=empty();old.tasks=[{...task(),done:true,deletedAt:now.toISOString()}];const next=empty();prepareTaskRetention(old,next,now);assert.equal(next.tasks.length,1);validate(next);next.tasks[0].completedRetentionAt='not a date';assert.throws(()=>validate(next));
});
