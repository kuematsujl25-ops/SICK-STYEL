import test from 'node:test';
import assert from 'node:assert/strict';
import {overdueItems,createOverdueMonitor,overdueSummary,renderOverdue} from '../public/overdue.js';
const fixture=()=>({tasks:[{id:'t',title:'Task',due:'2026-10-25',done:false}],staffTasks:[],shipments:[]});
test('JST midnight; completed, deleted and undated records excluded',()=>{
 const d=fixture();assert.equal(overdueItems(d,new Date('2026-10-25T14:59:59Z')).length,0);
 assert.equal(overdueItems(d,new Date('2026-10-25T15:00:00Z')).length,1);
 d.tasks.push({id:'done',due:'2026-10-24',done:true},{id:'blank',due:''},{id:'deleted',due:'2026-10-24',deletedAt:'x'});
 d.staffTasks.push({id:'a',due:'2026-10-24',status:'進行中'},{id:'b',due:'2026-10-24',status:'完了'});
 d.shipments.push({id:'s',due:'2026-10-24',status:'準備中'},{id:'s2',due:'2026-10-24',status:'発送済み'},{id:'s3',due:'2026-10-24',status:'配達完了'});
 assert.deepEqual(overdueItems(d,new Date('2026-10-25T15:00:00Z')).map(x=>x.id).sort(),['a','s','t']);
 assert.equal(overdueItems(null),null);assert.equal(overdueItems({tasks:[]}),null);
});
test('read does not resolve; deadline change, completion, reopening and logout',()=>{
 const m=createOverdueMonitor({fetchData:async()=>fixture(),changed:()=>{},now:()=>new Date('2026-10-26')});
 assert.match(overdueSummary(m.snapshot()),/未取得/);m.set(fixture());m.read();assert.equal(m.snapshot().unread,0);assert.equal(m.snapshot().items.length,1);
 const d=fixture();d.tasks[0].due='2026-10-24';m.set(d);assert.equal(m.snapshot().unread,1);
 m.read();d.tasks[0].done=true;m.set(d);assert.equal(m.snapshot().items.length,0);d.tasks[0].done=false;m.set(d);assert.equal(m.snapshot().unread,1);
 d.tasks[0].due='2026-10-28';m.set(d);assert.equal(m.snapshot().items.length,0);m.clear();assert.match(overdueSummary(m.snapshot()),/未取得/);
});
test('refresh detects date rollover, error is unknown and retry recovers',async()=>{
 let now=new Date('2026-10-25T14:59:59Z'),fail=false;
 const m=createOverdueMonitor({fetchData:async()=>{if(fail)throw Error('offline');return fixture();},changed:()=>{},now:()=>now});
 await m.refresh();assert.equal(m.snapshot().items.length,0);now=new Date('2026-10-25T15:00:00Z');await m.refresh();assert.equal(m.snapshot().items.length,1);
 fail=true;await m.refresh();assert.match(overdueSummary(m.snapshot()),/確認できません/);assert.doesNotMatch(renderOverdue(m.snapshot(),String),/期限超過はありません/);
 fail=false;await m.refresh();assert.equal(m.snapshot().status,'ready');
});
test('late responses cannot overwrite saved changes or resurrect a logged out session',async()=>{
 let resolve;const m=createOverdueMonitor({fetchData:()=>new Promise(r=>resolve=r),changed:()=>{},now:()=>new Date('2026-10-26')});
 const request=m.refresh();const done=fixture();done.tasks[0].done=true;m.set(done);resolve(fixture());await request;assert.equal(m.snapshot().items.length,0);
 const next=m.refresh();m.clear();resolve(fixture());await next;assert.equal(m.snapshot().items,null);
});
