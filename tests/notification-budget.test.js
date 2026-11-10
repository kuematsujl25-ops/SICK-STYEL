import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {createD1Store} from '../lib/d1-store.js';
import {runMinuteJobs} from '../lib/scheduled-minute.js';
import {runMeetingReminders,subscribe,listNotifications} from '../lib/notifications.js';
import {withRuntime} from '../lib/runtime.js';
import {empty} from '../lib/domain.js';
import {newOrg} from '../public/org-sales.js';
import {recurringTemplate} from '../public/recurring-tasks.js';
import {configureProactive} from '../lib/proactive-staff.js';
import {emptyTeam,TEAM_DOCUMENT} from '../lib/ai-team.js';
import {base64url,unbase64url} from '../lib/web-push.js';

// Count actual binding calls: .all()=1, .batch([...])=1 regardless of statements.
// Fail on call 51; count statements separately to catch accidental conflation.
function budgetDb(t){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE ss_documents(name TEXT PRIMARY KEY,body TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0)');t.after(()=>sql.close());
 const stats={calls:0,statements:0,limit:Infinity,conflict:false};
 const execute=s=>{stats.statements++;if(stats.conflict&&s.sql.startsWith('UPDATE ss_documents')&&(s.values[1]==='workspace'||s.values[1]==='ai-proactive-sickstyle-v1'&&s.sql.includes('AND EXISTS')))return {success:true,results:[]};return {success:true,results:sql.prepare(s.sql).all(...s.values)};};
 const call=()=>{if(++stats.calls>stats.limit)throw Error('D1 invocation exceeds 50 calls');};
 const db={prepare:text=>({bind:(...values)=>({sql:text,values,async all(){call();return execute(this);}})}),async batch(statements){call();sql.exec('BEGIN');try{const rows=statements.map(execute);sql.exec('COMMIT');return rows;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {store:createD1Store(db),stats};
}
async function pushEnv(){const signing=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',signing.privateKey);const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);return {env:{TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),VAPID_PRIVATE_KEY:jwk.d,VAPID_PUBLIC_KEY:base64url(new Uint8Array([4,...unbase64url(jwk.x),...unbase64url(jwk.y)])),VAPID_SUBJECT:'https://example.com'},keys:{p256dh:base64url(new Uint8Array(await crypto.subtle.exportKey('raw',receiver.publicKey))),auth:base64url(crypto.getRandomValues(new Uint8Array(16)))}};}
async function seed(store,keys,now){
 const at=new Date(+now+9*60000+9*3600000).toISOString().slice(0,16),day=new Date(+now+9*3600000).toISOString().slice(0,10);
 const workspace=empty();workspace.orgSales=Array.from({length:13},(_,i)=>({...newOrg(),id:'synthetic-'+i,name:'Synthetic meeting',initialZoomAt:at,updatedAt:now.toISOString()}));
 workspace.recurringTasks=[recurringTemplate({id:'repeat',title:'Synthetic daily task',due:day,priority:'中'},'tasks')];
 workspace.staffTasks=[{id:'overdue',title:'Synthetic overdue',due:'2026-10-01',status:'未着手',assignee:'',priority:'中',relatedOrg:'',relatedPlayer:'',relatedPost:'',nextAction:'',notes:'',updatedAt:now.toISOString()}];
 await store.put('workspace',workspace);
 for(let i=0;i<5;i++)await subscribe(store,{endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-'+i,keys});
 await configureProactive(store,{revision:0,action:'configure',enabled:true,permissions:{staffTasks:true,orgSales:false,collectionTasks:false,amazon:true},modelQueue:true});
 const body=JSON.stringify({...emptyTeam(),enabled:true}),partBody=JSON.stringify(body),hash=s=>createHash('sha256').update(s).digest('hex'),part='ai-team-sickstyle-v1:part:'+hash(partBody);
 await store.put(part,body);
 await store.put(TEAM_DOCUMENT,{storage_format:'sickstyle-team-parts-v1',business_unit:'sickstyle',parts:[part],bytes:Buffer.byteLength(body),sha256:hash(body)});
}
for(const outcome of ['success','gone','retry','conflict'])test('shared minute invocation stays below 50 actual D1 calls: '+outcome,async t=>{
 const now=new Date('2026-10-31T23:00:00Z');t.mock.timers.enable({apis:['Date'],now:+now});
 const {store,stats}=budgetDb(t),{env,keys}=await pushEnv();
 await withRuntime(env,async()=>{
  await seed(store,keys,now);Object.assign(stats,{calls:0,statements:0,limit:50,conflict:outcome==='conflict'});
  let sends=0;const send=async()=>{sends++;return new Response(null,{status:outcome==='gone'?410:outcome==='retry'?503:201});};
  const run=runMinuteJobs(store,{RECURRING_TASKS_ENABLED:'true'},now,send);
  if(outcome==='conflict')await assert.rejects(run);else await run;
  assert.equal(sends,30);assert.ok(stats.calls<=45,JSON.stringify(stats));assert.ok(stats.statements>stats.calls,'batch statements must not be counted as invocation calls');
  t.diagnostic(JSON.stringify({outcome,calls:stats.calls,statements:stats.statements,sends}));
  stats.limit=Infinity;stats.conflict=false;
  assert.equal((await listNotifications(store)).length,13,'deferred reminders were captured before their due window ended');
 });
});
test('deferral across meeting start retains every in-app reminder and does not push stale schedules',async t=>{
 const now=new Date('2026-10-31T23:00:00Z');t.mock.timers.enable({apis:['Date'],now:+now});
 const {store,stats}=budgetDb(t),{env,keys}=await pushEnv();
 await withRuntime(env,async()=>{
  await seed(store,keys,now);stats.calls=0;stats.limit=50;
  let sends=0;const send=async()=>{sends++;return new Response(null,{status:201});};
  assert.equal((await runMeetingReminders(store,now,send)).created,13);assert.equal(sends,30);
  t.mock.timers.tick(10*60000);stats.calls=0;
  assert.equal((await runMeetingReminders(store,new Date(),send)).created,0);assert.equal(sends,30);
  stats.limit=Infinity;const items=await listNotifications(store);assert.equal(items.length,13);assert.equal(items.filter(i=>i.detail.deliveryComplete).length,6);assert.equal(items.filter(i=>!i.detail.deliveryComplete).length,7);
 });
});
