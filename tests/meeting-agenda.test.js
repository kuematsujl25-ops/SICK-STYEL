import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {meetingAgenda,dueMeetings,renderTodayMeetings,zoomJoinUrl,renderMeetingReminder} from '../public/meeting-agenda.js';
import {runMeetingReminders,meetingReminderActive,listNotifications} from '../lib/notifications.js';
import {createStore} from '../lib/store.js';
const now=new Date('2026-10-29T10:00:00+09:00');
const org=(overrides={})=>({id:'example-org',name:'Example FC',initialZoomAt:'2026-10-29T10:10',initialMeetingDurationMin:45,initialZoomUrl:'https://example.zoom.us/j/12345?pwd=example',...overrides});
const esc=x=>String(x).replaceAll('<','&lt;').replaceAll('"','&quot;');
test('JST day uses overlap and chronological order including previous day and next-day end',()=>{
 const orgs=[org(),org({id:'overnight',initialZoomAt:'2026-10-28T23:45',initialMeetingDurationMin:60}),org({id:'late',initialZoomAt:'2026-10-29T23:45'}),org({id:'tomorrow',initialZoomAt:'2026-10-30T00:00'})];
 const html=renderTodayMeetings(orgs,esc,now);
 assert.ok(html.indexOf('23:45〜翌日 00:45')<html.indexOf('10:10〜10:55'));
 assert.match(html,/前日開始/);assert.doesNotMatch(html,/00:00〜00:45/);
 assert.match(renderTodayMeetings([],esc,now),/今日の会議はありません/);
});
test('due window excludes canceled, deleted, uncertain and started meetings; changed time becomes new identity',()=>{
 assert.equal(dueMeetings([org()],now).length,1);
 for(const change of [{deletedAt:'date'},{initialZoomAt:''},{initialZoomAt:'2026-10-29T10:11'},{initialZoomAt:'2026-10-29T10:00'},{initialMeetingSync:{cancelPending:true}},{initialMeetingSync:{status:'creating'}},{initialMeetingSync:{status:'uncertain'}}])assert.equal(dueMeetings([org(change)],now).length,0);
 assert.notEqual(meetingAgenda([org()])[0].token,meetingAgenda([org({initialZoomAt:'2026-10-29T10:09'})])[0].token);
 assert.match(renderMeetingReminder([org()],esc,now),/あと10分/);
});
test('safe join URL and missing-link UI, no unsafe protocols or credentials',()=>{
 for(const url of ['javascript:alert(1)','http://zoom.us/j/123','https://zoom.us.evil.example/j/123','https://user:pass@zoom.us/j/123','https://zoom.us/s/123','https://zoom.us:444/j/123'])assert.equal(zoomJoinUrl(url),null);
 assert.ok(zoomJoinUrl('https://zoom.us/my/example'));
 assert.match(renderTodayMeetings([org()],esc,now),/rel="noopener noreferrer"/);
 assert.match(renderTodayMeetings([org({initialZoomUrl:''})],esc,now),/参加URLはまだ利用できません/);
 assert.doesNotMatch(renderTodayMeetings([org({initialMeetingSync:{cancelPending:true}})],esc,now),/Zoomに参加/);
});
async function fixture(t){const dir=await mkdtemp(path.join(tmpdir(),'meeting-reminder-'));const store=await createStore({DATA_DIR:dir});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return store;}
test('persisted reminders deduplicate concurrent ticks and survive reload; reschedule and cancellation invalidate delivered records',async t=>{
 const store=await fixture(t);await store.put('workspace',{orgSales:[org()]});
 await Promise.all([runMeetingReminders(store,now),runMeetingReminders(store,now)]);
 let items=await listNotifications(store);assert.equal(items.length,1);
 assert.equal(await meetingReminderActive(store,items[0].id,now),true);
 await runMeetingReminders(store,now);assert.equal((await listNotifications(store)).length,1);
 await store.put('workspace',{orgSales:[org({initialZoomAt:'2026-10-29T10:09'})]});
 assert.equal(await meetingReminderActive(store,items[0].id,now),false);
 await runMeetingReminders(store,now);items=await listNotifications(store);assert.equal(items.length,2);
 await store.put('workspace',{orgSales:[org({initialMeetingSync:{cancelPending:true}})]});
 for(const item of items)assert.equal(await meetingReminderActive(store,item.id,now),false);
});
test('workspace revision guard rejects reminder when schedule changed between read and insert',async t=>{
 const store=await fixture(t);await store.put('workspace',{orgSales:[org()]});
 const wrapped={...store,async transaction(commands){if(commands[0][0].startsWith('INSERT INTO'))await store.put('workspace',{orgSales:[]});return store.transaction(commands);}};
 assert.equal((await runMeetingReminders(wrapped,now)).created,0);
 assert.equal((await listNotifications(store)).length,0);
});
test('burst is bounded and next tick catches remaining meetings; late resume after start emits nothing',async t=>{
 const store=await fixture(t);await store.put('workspace',{orgSales:Array.from({length:13},(_,i)=>org({id:'org-'+i}))});
 for(const [tick,count] of [13,0,0].entries())assert.equal((await runMeetingReminders(store,new Date(now.getTime()+tick*60000))).created,count);
 assert.equal((await listNotifications(store)).length,13);
 assert.equal((await runMeetingReminders(store,new Date(now.getTime()+600000))).created,0);
});
test('service worker displays neutral fallback for stale/unverifiable pushes to preserve Safari subscriptions',async()=>{
 const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
 async function dispatch(msg,active=true,ok=true){const handlers={},shown=[];let pending;
 vm.runInNewContext(source,{self:{addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(...x)=>shown.push(x)}},fetch:async()=>({ok,json:async()=>({active})}),Date,Number,encodeURIComponent,AbortSignal});
 handlers.push({data:{json:()=>msg},waitUntil:p=>pending=p});await pending;return shown;}
 const msg={title:'Meeting',reminderId:'example',expiresAt:Date.now()+600000,url:'/?meetings=1'};
 assert.equal((await dispatch(msg)).length,1);assert.equal((await dispatch(msg))[0][1].data.url,'/?meetings=1');
 for(const shown of [await dispatch(msg,false),await dispatch(msg,true,false),await dispatch({...msg,expiresAt:Date.now()-1})]){assert.equal(shown.length,1);assert.match(shown[0][0],/会議予定のお知らせ/);assert.match(shown[0][1].body,/確認できませんでした/);}
});

test('transient push failure retries only affected devices; concurrent ticks preserve successes',async t=>{
 const {withRuntime}=await import('../lib/runtime.js');const {subscribe}=await import('../lib/notifications.js');
 const {base64url,unbase64url}=await import('../lib/web-push.js');
 const {randomBytes}=await import('node:crypto');const store=await fixture(t);
 const signing=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',signing.privateKey);
 const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const keys={p256dh:base64url(new Uint8Array(await crypto.subtle.exportKey('raw',receiver.publicKey))),auth:base64url(crypto.getRandomValues(new Uint8Array(16)))};
 const env={TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),VAPID_PRIVATE_KEY:jwk.d,VAPID_PUBLIC_KEY:base64url(new Uint8Array([4,...unbase64url(jwk.x),...unbase64url(jwk.y)])),VAPID_SUBJECT:'https://example.com'};
 await withRuntime(env,async()=>{
  for(const name of ['success','retry','network','gone'])await subscribe(store,{endpoint:'https://fcm.googleapis.com/fcm/send/'+name,keys});
  const at=new Date(Date.now()+9*60000+9*3600000).toISOString().slice(0,16);
  await store.put('workspace',{orgSales:[org({initialZoomAt:at})]});
  const calls={};const request=async url=>{const name=url.split('/').at(-1);calls[name]=(calls[name]||0)+1;if(name==='network'&&calls[name]===1)throw Error('synthetic timeout');return new Response(null,{status:name==='gone'?410:name==='retry'&&calls[name]===1?503:201});};
  await Promise.all([runMeetingReminders(store,new Date(),request),runMeetingReminders(store,new Date(),request)]);
  assert.deepEqual(calls,{success:1,retry:1,network:1,gone:1});
  await runMeetingReminders(store,new Date(),request);assert.equal(calls.retry,1,'backoff is respected');
  const receipts=await store.query('SELECT name,body FROM ss_documents WHERE name LIKE $1',['meeting-delivery:%']);
  for(const row of receipts){const data=JSON.parse(row.body);if(!data.settled)await store.put(row.name,{...data,retryAfter:0});}
  for(const item of await listNotifications(store))await store.put(item.id,{...item,detail:{...item.detail,nextAttemptAt:0}});
  await Promise.all([runMeetingReminders(store,new Date(),request),runMeetingReminders(store,new Date(),request)]);
  assert.deepEqual(calls,{success:1,retry:2,network:2,gone:1});
  for(const item of await listNotifications(store))await store.put(item.id,{...item,detail:{...item.detail,nextAttemptAt:0}});
  await runMeetingReminders(store,new Date(),request);assert.equal(calls.retry,2);
  assert.equal((await listNotifications(store))[0].detail.deliveryComplete,true);
  const remaining=await store.query('SELECT name FROM ss_documents WHERE name LIKE $1',['notify-device-v1:%']);assert.equal(remaining.length,3,'expired subscription is removed');
  for(const name of ['fourth','fifth'])await subscribe(store,{endpoint:'https://fcm.googleapis.com/fcm/send/'+name,keys});
  await store.put('workspace',{orgSales:Array.from({length:13},(_,i)=>org({id:'batch-'+i,initialZoomAt:at}))});
  let internal=0,external=0,active=0,peak=0;const counted={...store,async doc(...args){internal++;return store.doc(...args);},async query(...args){internal++;return store.query(...args);},async transaction(...args){internal++;return store.transaction(...args);}};
  const send=async(url,init)=>{external++;active++;peak=Math.max(peak,active);assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);await new Promise(resolve=>setImmediate(resolve));active--;return new Response(null,{status:201});};
  for(const [tick,expected] of [6,6,1].entries()){internal=0;external=0;assert.equal((await runMeetingReminders(counted,new Date(),send)).created,tick===0?13:0);assert.equal(external,expected*5);assert.ok(external<=30);assert.ok(internal<=28,'D1 API calls including each batch once: '+internal);}
  assert.ok(peak<=3,'only three push requests in flight');
  assert.equal((await listNotifications(store)).filter(i=>i.detail?.token?.includes('batch-')&&i.detail.deliveryComplete).length,13,'13 simultaneous meetings delivered on all five devices before start');
  await store.put('workspace',{orgSales:[org({id:'cancel-between-devices',initialZoomAt:at})]});
  let sends=0;await runMeetingReminders(store,new Date(),async()=>{sends++;await store.put('workspace',{orgSales:[]});return new Response(null,{status:201});});
  assert.equal(sends,1,'cancellation during the first delivery prevents every subsequent device send');
  await store.put('workspace',{orgSales:[org({id:'retry-a',initialZoomAt:at}),org({id:'retry-b',initialZoomAt:at})]});
  let failures=0;const fail=async()=>{failures++;return new Response(null,{status:503});};
  await runMeetingReminders(store,new Date(),fail);await runMeetingReminders(store,new Date(),fail);
  assert.equal(failures,10,'both new meetings attempted');
  for(const row of await store.query('SELECT name,body FROM ss_documents WHERE name LIKE $1',['meeting-delivery:%'])){const receipt=JSON.parse(row.body);if(!receipt.settled)await store.put(row.name,{...receipt,retryAfter:0});}
  for(const item of await listNotifications(store))if(item.detail?.token?.includes('retry-'))await store.put(item.id,{...item,detail:{...item.detail,nextAttemptAt:0,lastAttemptAt:1}});
  await runMeetingReminders(store,new Date(),fail);await runMeetingReminders(store,new Date(),fail);
  assert.equal(failures,20,'an earlier failing reminder in backoff does not starve the other meeting');
  const legacyOrg=org({id:'legacy',initialZoomAt:at}),legacyMeeting=meetingAgenda([legacyOrg])[0];
  const {createHash}=await import('node:crypto');const legacyId='notify-event-v1:meeting_reminder:'+createHash('sha256').update(legacyMeeting.token).digest('hex').slice(0,40);
  await store.put('workspace',{orgSales:[legacyOrg]});
  await store.put(legacyId,{id:legacyId,kind:'meeting_reminder',title:'Legacy',body:'Legacy notification',createdAt:new Date().toISOString(),detail:{token:legacyMeeting.token,startsAt:legacyMeeting.start}});
  let legacySends=0;await runMeetingReminders(store,new Date(),async()=>{legacySends++;return new Response(null,{status:201});});
  assert.equal(legacySends,0,'legacy events without retry state must not be resent');

 });
});

test('atomic reminder capture retries all evidence after a transient insert failure',async t=>{
 const store=await fixture(t);await store.put('workspace',{orgSales:Array.from({length:6},(_,i)=>org({id:'isolated-'+i}))});let failed=false;
 const wrapped={...store,async transaction(commands){if(!failed&&commands[0][0].startsWith('INSERT INTO')){failed=true;throw Error('synthetic insert failure');}return store.transaction(commands);}};
 await assert.rejects(runMeetingReminders(wrapped,now),/synthetic/);assert.equal((await listNotifications(store)).length,0);
 assert.equal((await runMeetingReminders(store,now)).created,6);assert.equal((await listNotifications(store)).length,6);
});
