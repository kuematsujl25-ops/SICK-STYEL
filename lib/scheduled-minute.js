import {runTaskRetention} from './task-retention.js';
import {runRecurringTasks} from './recurring-tasks.js';
import {runProactive} from './proactive-staff.js';
import {retryScheduledReports,runMeetingReminders} from './notifications.js';
// The minute jobs share one scheduled invocation and its D1 budget. Batches count
// once: reminder <=28 + recurring <=8 (four CAS attempts) + proactive <=9
// (split team storage and failure recording) =45, leaving five calls of margin.
// Report retries never coincide with those heavier jobs; they use <=5 D1 calls
// (including the cleanup batch) plus <=5 sequential push requests.
export async function runMinuteJobs(store,env,scheduledAt,request=fetch){
 // Finish the workspace CAS first so our own task generation cannot invalidate
 // the reminder snapshot and defer all notifications until the next minute.
 const recurring=env.RECURRING_TASKS_ENABLED==='true'&&scheduledAt.getUTCMinutes()%15===0;
 // Minute 7 never coincides with recurring generation or proactive work.
 const prior=await Promise.allSettled([scheduledAt.getUTCMinutes()===7?runTaskRetention(store,scheduledAt):recurring?runRecurringTasks(store,scheduledAt):Promise.resolve()]);
 const results=await Promise.allSettled([
  runMeetingReminders(store,new Date(),request),
  retryScheduledReports(store,scheduledAt,request),
  scheduledAt.getUTCHours()===23&&[0,15].includes(scheduledAt.getUTCMinutes())?runProactive(store,{now:scheduledAt.toISOString(),trigger:'morning'}):Promise.resolve()
 ]);
 const failure=[...prior,...results].find(r=>r.status==='rejected');if(failure)throw failure.reason;
 return [...prior,...results];
}
