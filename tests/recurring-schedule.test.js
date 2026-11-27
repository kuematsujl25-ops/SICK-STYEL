import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// Evaluate the real scheduled handler with integration boundaries replaced by
// controlled jobs. Cloudflare HTTP imports cannot be loaded by Node directly.
const source=readFileSync('workers/index.js','utf8').replace(/^import .*;\n/gm,'').replace('export default {','globalThis.worker = {');
function scheduledHarness(reminders,recurring,proactive=async()=>{},retryReports=async()=>{},overrides={}){
 const context={Date,Promise,console,fetch:()=>{},createServer:()=>({}),httpServerHandler:()=>({}),handler:()=>{},createD1Store:()=>({}),withRuntime:(_,fn)=>fn(),runProactive:proactive,runMeetingReminders:reminders,retryScheduledReports:retryReports,runRecurringTasks:recurring,...overrides};runInNewContext(readFileSync('lib/scheduled-minute.js','utf8').replace(/^import .*;\n/gm,'').replace('export async function','async function')+'\n'+source,context);return context.worker;
}
test('quarter-hour recurring failure waits for existing reminder delivery before rejecting',async()=>{
 let finishReminder;const reminder=new Promise(resolve=>{finishReminder=resolve;});let called=false,settled=false,protectedWork;
 const worker=scheduledHarness(()=>reminder,async()=>{called=true;throw Error('capacity');});
 await worker.scheduled({cron:'* * * * *',scheduledTime:Date.parse('2026-10-30T23:00:00Z')},{DB:{},RECURRING_TASKS_ENABLED:'true'},{waitUntil:p=>{protectedWork=p;p.then(()=>{settled=true;},()=>{settled=true;});}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(called,true);assert.equal(settled,false);
 finishReminder();await assert.rejects(protectedWork,/capacity/);
});
test('08:00 handler and 15-minute recovery honor activation and maintenance; normal minutes only send reminders',async()=>{
 let reminders=0,recurring=0;const worker=scheduledHarness(async()=>{reminders++;},async()=>{recurring++;});
 async function run(cron,time,overrides={}){let work;await worker.scheduled({cron,scheduledTime:Date.parse(time)},{DB:{},RECURRING_TASKS_ENABLED:'true',...overrides},{waitUntil:p=>{work=p;}});await work;}
 await run('* * * * *','2026-10-30T23:00:00Z');assert.equal(recurring,1);assert.equal(reminders,1);
 await run('* * * * *','2026-10-30T23:01:00Z');assert.equal(recurring,1);assert.equal(reminders,2);
 await run('* * * * *','2026-10-30T23:15:00Z');assert.equal(recurring,2);assert.equal(reminders,3);
 await run('* * * * *','2026-10-30T23:00:00Z',{RECURRING_TASKS_ENABLED:'false'});assert.equal(recurring,2);
 await run('* * * * *','2026-10-30T23:15:00Z',{MAINTENANCE_MODE:'true'});assert.equal(recurring,2);assert.equal(reminders,4);
});

test('morning proactive checks share existing cron without changing recurring or reminders',async()=>{
 let checks=0,reminders=0;const worker=scheduledHarness(async()=>{reminders++;},async()=>{},async()=>{checks++;});
 for(const time of ['2026-10-30T23:00:00Z','2026-10-30T23:15:00Z','2026-10-30T23:30:00Z','2026-10-31T00:00:00Z']){let work;await worker.scheduled({cron:'* * * * *',scheduledTime:Date.parse(time)},{DB:{}},{waitUntil:p=>work=p});await work;}
 assert.equal(checks,2);assert.equal(reminders,4);
});


test('existing minute cron invokes report retry independently of meeting reminders',async()=>{
 let checked;
 const worker=scheduledHarness(async()=>{throw Error('reminder failed');},async()=>{},async()=>{},async(_store,at)=>{checked=at.toISOString();});
 let work;
 await worker.scheduled({cron:'* * * * *',scheduledTime:Date.parse('2026-11-27T11:02:00Z')},{DB:{}},{waitUntil:p=>work=p});
 await assert.rejects(work,/reminder failed/);
 assert.equal(checked,'2026-11-27T11:02:00.000Z');
});


test('daily report stays first and passes a bounded Graph budget to Instagram in the shared invocation',async()=>{
 const order=[];
 const worker=scheduledHarness(async()=>{},async()=>{},undefined,undefined,{
  scheduledKind:()=> 'morning',
  runReport:async()=>{order.push('report');},
  instagram:{safeStatus:async()=>({connected:true}),sync:async(_store,options)=>{order.push('instagram');assert.equal(options.maxRequests,35);}}
 });
 let work;await worker.scheduled({cron:'0 0 * * *',scheduledTime:Date.parse('2026-11-27T00:00:00Z')},{DB:{}},{waitUntil:p=>work=p});
 await work;assert.deepEqual(order,['report','instagram']);
});
