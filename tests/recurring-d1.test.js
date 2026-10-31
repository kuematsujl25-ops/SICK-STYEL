import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createD1Store} from '../lib/d1-store.js';
import {runRecurringTasks,jstDate} from '../lib/recurring-tasks.js';
import {recurringTemplate} from '../public/recurring-tasks.js';

test('Workers API + D1: recurring configuration, generation, stale writes, backup and stop',async t=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'recurring-test',modules:true,scriptPath:'.wrangler/build/index.js',compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'synthetic'},bindings:{SETUP_TOKEN:'synthetic',COOKIE_SECURE:'false',RECURRING_TASKS_ENABLED:'true'}}]}));t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');await db.exec(readFileSync('migrations/0001_initial.sql','utf8').replaceAll('\n',' '));let cookie='';
 const req=async(route,method='GET',data)=>{const response=await mf.dispatchFetch('http://localhost/api/'+route,{method,headers:{Cookie:cookie,Origin:'http://localhost',...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,data:await response.json()};};
 assert.equal((await req('setup','POST',{email:'qa@example.com',password:'synthetic-password-2026',setupToken:'synthetic'})).status,200);
 const original=(await req('data')).data;assert.equal(original.recurringTasksEnabled,true);
 const day=jstDate(new Date());original.recurringTasks.push(recurringTemplate({id:'daily',title:'D1合成タスク',due:day,priority:'中'},'tasks'));
 assert.equal((await req('data','PUT',original)).status,200);
 const oldBackup=(await req('backup')).data;
 const stale=(await req('data')).data;
 const store=createD1Store(db);assert.equal((await runRecurringTasks(store,new Date(day+'T08:00:00+09:00'))).created,1);
 assert.notEqual((await req('data','PUT',stale)).status,200);
 let current=(await req('data')).data;assert.equal(current.tasks.length,1);current.tasks[0].done=true;current.recurringTasks[0].enabled=false;
 assert.equal((await req('data','PUT',current)).status,200);
 await runRecurringTasks(store,new Date(Date.parse(day+'T08:00:00+09:00')+86400000));current=(await req('data')).data;assert.equal(current.tasks.length,1);assert.equal(current.tasks[0].done,true);
 // A backup made before generation is now a valid restore: live completion,
 // template stop state and advanced cursor must survive.
 assert.equal((await req('restore','POST',{...oldBackup,revision:current.revision})).status,200);
 current=(await req('data')).data;assert.equal(current.tasks.length,1);assert.equal(current.tasks[0].done,true);assert.equal(current.recurringTasks[0].enabled,false);
 const legacyBackup=structuredClone(oldBackup);delete legacyBackup.data.recurringTasks;legacyBackup.data.tasks=[];
 assert.equal((await req('restore','POST',{...legacyBackup,revision:current.revision})).status,200);current=(await req('data')).data;assert.equal(current.tasks.length,1);assert.equal(current.recurringTasks.length,1);
 const backup=(await req('backup')).data;assert.equal((await req('restore','POST',{...backup,revision:current.revision})).status,200);
 current=(await req('data')).data;delete current.recurringTasks;assert.notEqual((await req('data','PUT',current)).status,200);
});
