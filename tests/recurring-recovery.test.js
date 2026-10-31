import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync,mkdirSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {empty} from '../lib/domain.js';
import {createD1Store} from '../lib/d1-store.js';
import {recurringTemplate} from '../public/recurring-tasks.js';
import {runRecurringTasks} from '../lib/recurring-tasks.js';

// Rehearse the documented old-version-in-maintenance recovery using its actual
// Worker bundle and the same persistent local D1. No remote deployment or data.
test('legacy rollback under maintenance and forward recovery preserve recurring data',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'recurring-recovery-'));let mf;let phase='build legacy';
 try{
  const legacy=join(dir,'legacy');mkdirSync(legacy);const archive=join(dir,'legacy.tar');
  execFileSync('git',['archive','8528bf2ea5b272d126956fdf63dfdf9f9c475d99','-o',archive]);execFileSync('tar',['-xf',archive,'-C',legacy]);symlinkSync(realpathSync('node_modules'),join(legacy,'node_modules'));
  execFileSync(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'deploy','--dry-run','--outdir',join(dir,'old-build')],{cwd:legacy,env:{...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'},stdio:'pipe'});
  const options=(script,maintenance)=>convertV4MiniflareOptions({resourcePersistencePath:join(dir,'d1'),workers:[{name:'recovery-test',modules:true,modulesRoot:dirname(script),scriptPath:script,compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'recovery-synthetic'},assets:{directory:resolve('public'),binding:'ASSETS',routerConfig:{has_user_worker:true},run_worker_first:['/api/*']},bindings:{MAINTENANCE_MODE:maintenance,RECURRING_TASKS_ENABLED:'false'}}]});
  phase='start current';mf=new Miniflare(options(resolve('.wrangler/build/index.js'),'false'));let db=await mf.getD1Database('DB');await db.exec(readFileSync('migrations/0001_initial.sql','utf8').replaceAll('\n',' '));
  let store=createD1Store(db);const data=empty();data.recurringTasks=[recurringTemplate({id:'daily',title:'復旧試験',due:'2026-10-31',priority:'中'},'tasks')];await store.put('workspace',data);await runRecurringTasks(store,new Date('2026-10-31T08:00:00+09:00'));const snapshot=await store.doc('workspace');
  // Snapshot is the byte-for-byte evidence. Old code must never accept writes.
  phase='start legacy';await mf.dispose();mf=new Miniflare(options(join(dir,'old-build/index.js'),'true'));db=await mf.getD1Database('DB');store=createD1Store(db);
  for(const method of ['GET','PUT']){const response=await mf.dispatchFetch('http://localhost/api/data',{method,headers:{'Content-Type':'application/json'},...(method==='PUT'?{body:JSON.stringify(empty())}:{})});assert.equal(response.status,503);}
  assert.deepEqual(await store.doc('workspace'),snapshot);
  phase='recover current';await mf.dispose();mf=new Miniflare(options(resolve('.wrangler/build/index.js'),'false'));db=await mf.getD1Database('DB');store=createD1Store(db);assert.deepEqual(await store.doc('workspace'),snapshot);
  assert.equal((await runRecurringTasks(store,new Date('2026-10-31T08:00:00+09:00'))).created,0);
  assert.equal((await runRecurringTasks(store,new Date('2026-11-01T08:00:00+09:00'))).created,1);
  assert.equal(JSON.parse((await store.doc('workspace')).body).tasks.length,2);
 }catch(e){e.message=phase+': '+e.message;throw e;}finally{await mf?.dispose();rmSync(dir,{recursive:true,force:true});}
});
