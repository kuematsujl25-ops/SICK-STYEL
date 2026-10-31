import {runRecurringTasks} from './recurring-tasks.js';
import {runProactive} from './proactive-staff.js';
import {runMeetingReminders} from './notifications.js';
// All three jobs share one scheduled invocation and its D1 budget. Batches count
// once: reminder <=28 + recurring <=8 (four CAS attempts) + proactive <=9
// (split team storage and failure recording) =45, leaving five calls of margin.
export async function runMinuteJobs(store,env,scheduledAt,request=fetch){
 // Finish the workspace CAS first so our own task generation cannot invalidate
 // the reminder snapshot and defer all notifications until the next minute.
 const recurring=env.RECURRING_TASKS_ENABLED==='true'&&scheduledAt.getUTCMinutes()%15===0;
 const prior=await Promise.allSettled([recurring?runRecurringTasks(store,scheduledAt):Promise.resolve()]);
 const results=await Promise.allSettled([
  runMeetingReminders(store,new Date(),request),
  scheduledAt.getUTCHours()===23&&[0,15].includes(scheduledAt.getUTCMinutes())?runProactive(store,{now:scheduledAt.toISOString(),trigger:'morning'}):Promise.resolve()
 ]);
 const failure=[...prior,...results].find(r=>r.status==='rejected');if(failure)throw failure.reason;
 return [...prior,...results];
}
