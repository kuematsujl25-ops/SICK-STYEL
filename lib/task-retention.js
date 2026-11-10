import {migrate,validate} from './domain.js';
export const RETENTION_MS=7*24*60*60*1000;
const complete=(key,row)=>key==='tasks'?row.done:row.status==='完了';
// Completion time is server-owned. Legacy completions have only an observation
// timestamp: do not pretend their due date or last edit was their completion.
export function prepareTaskRetention(previous,next,now=new Date()){
 const stamp=now.toISOString();
 for(const key of ['tasks','staffTasks']){
  const old=new Map((previous[key]||[]).map(row=>[row.id,row]));
  for(const row of next[key]){
   const prior=old.get(row.id);old.delete(row.id);
   if(complete(key,row)){
    const newlyCompleted=!prior||!complete(key,prior);
    const restored=prior?.deletedAt&&!row.deletedAt;
    row.completedAt=newlyCompleted?stamp:(prior.completedAt||null);
    row.completedRetentionAt=newlyCompleted||restored?stamp:(prior.completedRetentionAt||stamp);
   }else{
    for(const field of ['completedAt','completedRetentionAt']){
     if(prior?.[field])row[field]=null;else delete row[field];
    }
   }
  }
  // A stale client or an imported backup must not silently erase the recycle bin.
  for(const prior of old.values())if(prior.deletedAt)next[key].push(structuredClone(prior));
 }
 return next;
}
export async function runTaskRetention(store,now=new Date()){
 for(let attempt=0;attempt<4;attempt++){
  const doc=await store.doc('workspace');if(!doc)return {archived:0};
  const data=migrate(JSON.parse(doc.body));let changed=false,archived=0;
  for(const key of ['tasks','staffTasks'])for(const row of data[key]){
   if(row.deletedAt||!complete(key,row))continue;
   if(!row.completedRetentionAt){row.completedRetentionAt=now.toISOString();changed=true;}
   if(+now-Date.parse(row.completedRetentionAt)>=RETENTION_MS){
    row.deletedAt=now.toISOString();row.autoArchived=true;changed=true;archived++;
   }
  }
  if(!changed)return {archived:0};validate(data);
  const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(data),'workspace',doc.revision]);
  if(rows.length)return {archived};
 }
 throw Error('完了タスク整理が競合しました。次回再試行します');
}
