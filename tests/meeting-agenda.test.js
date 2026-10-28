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
 const wrapped={...store,async query(sql,args){if(sql.startsWith('INSERT INTO'))await store.put('workspace',{orgSales:[]});return store.query(sql,args);}};
 assert.equal((await runMeetingReminders(wrapped,now)).created,0);
 assert.equal((await listNotifications(store)).length,0);
});
test('burst is bounded and next tick catches remaining meetings; late resume after start emits nothing',async t=>{
 const store=await fixture(t);await store.put('workspace',{orgSales:Array.from({length:5},(_,i)=>org({id:'org-'+i}))});
 assert.equal((await runMeetingReminders(store,now)).created,3);
 assert.equal((await runMeetingReminders(store,new Date(now.getTime()+60000))).created,2);
 assert.equal((await runMeetingReminders(store,new Date(now.getTime()+600000))).created,0);
});
test('service worker suppresses expired/cancelled/unauthenticated reminders and routes current ones to meetings',async()=>{
 const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
 async function dispatch(msg,active=true,ok=true){const handlers={},shown=[];let pending;
 vm.runInNewContext(source,{self:{addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(...x)=>shown.push(x)}},fetch:async()=>({ok,json:async()=>({active})}),Date,Number,encodeURIComponent});
 handlers.push({data:{json:()=>msg},waitUntil:p=>pending=p});await pending;return shown;}
 const msg={title:'Meeting',reminderId:'example',expiresAt:Date.now()+600000,url:'/?meetings=1'};
 assert.equal((await dispatch(msg)).length,1);assert.equal((await dispatch(msg))[0][1].data.url,'/?meetings=1');
 assert.equal((await dispatch(msg,false)).length,0);assert.equal((await dispatch(msg,true,false)).length,0);
 assert.equal((await dispatch({...msg,expiresAt:Date.now()-1})).length,0);
});
