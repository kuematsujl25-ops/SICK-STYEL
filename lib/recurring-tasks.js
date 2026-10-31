import {migrate,validate} from './domain.js';
export const jstDate = now => new Date(+now+9*3600000).toISOString().slice(0,10);
export const nextDate = date => new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
// The latest date whose 08:00 JST has passed (also allows next-morning recovery).
export const eligibleDate = now => new Date(+now+3600000).toISOString().slice(0,10);

// Cursor is owned by the scheduler. Older clients/backups must not rewind it or
// silently remove templates. Stopping is explicit and preserves daily history.
export function prepareRecurringWrite(previous,next,now=new Date()){
 const old=new Map((previous.recurringTasks||[]).map(t=>[t.id,t]));
 for(const t of next.recurringTasks){
  const p=old.get(t.id);
  if(p){
   if(t.nextDate!==p.nextDate||t.collection!==p.collection)throw Error('継続設定が更新されています。再読み込みしてください');
   if(t.startDate!==p.startDate)throw Error('開始日は変更できません。停止して新しい継続タスクを追加してください');
   if(!p.enabled&&t.enabled)t.nextDate=t.nextDate<jstDate(now)?jstDate(now):t.nextDate;
   old.delete(t.id);
  }else{
   if(t.startDate<jstDate(now))throw Error('継続タスクの開始日は今日以降にしてください');
   t.nextDate=t.startDate;
  }
 }
 if(old.size)throw Error('継続設定は削除できません。停止に切り替えてください');
 return next;
}

export async function runRecurringTasks(store,now=new Date()){
 const through=eligibleDate(now);
 for(let attempt=0;attempt<4;attempt++){
  const doc=await store.doc('workspace');
  if(!doc)return {created:0};
  const d=migrate(JSON.parse(doc.body));let created=0;
  for(const t of d.recurringTasks){
   if(!t.enabled)continue;
   // Bound recovery work; further scheduled invocations continue the backlog.
   for(let n=0;t.nextDate<=through&&n<31;n++){
    const date=t.nextDate;
    if(!d[t.collection].some(x=>x.recurringId===t.id&&x.occurrenceDate===date)){
     const {title,priority,notes='',assignee='',relatedOrg='',relatedPlayer='',relatedPost='',nextAction=''}=t;
     const row={id:crypto.randomUUID(),title,priority,notes,due:date,recurringId:t.id,occurrenceDate:date};
     if(t.collection==='tasks')row.done=false;
     else Object.assign(row,{assignee,relatedOrg,relatedPlayer,relatedPost,nextAction,status:'未着手',updatedAt:now.toISOString()});
     d[t.collection].push(row);created++;
    }
    t.nextDate=nextDate(date);
   }
  }
  if(JSON.stringify(d)===JSON.stringify(migrate(JSON.parse(doc.body))))return {created:0};
  validate(d);
  // One compare-and-swap commits occurrences AND cursors. A concurrent cron,
  // edit or completion wins without losing the other writer's changes.
  const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(d),'workspace',doc.revision]);
  if(rows.length)return {created};
 }
 throw Error('継続タスク生成が競合しました。次回再試行します');
}
