export const STAFF_ASSIGNEES=['入戸野','竹田','植松'];
export const STAFF_TASK_STATUS=['未着手','進行中','確認待ち','完了'];
export const empty=()=>({goals:[],tasks:[],shipments:[],metrics:[],staffTasks:[],brand:{理念:"",起源:"",Mission:"",Vision:"",Values:""},integrations:{amazon:{mode:"manual"},instagram:{mode:"manual"}}});
export function validate(d){
 const bad=()=>{throw Error('データの形式が正しくありません');};
 if(!d||!['goals','tasks','shipments','metrics','staffTasks'].every(k=>Array.isArray(d[k])&&d[k].length<=10000)||!d.brand||typeof d.brand!=='object'||Array.isArray(d.brand))bad();
 const text=(v,max=10000)=>typeof v==='string'&&v.length<=max;
 const date=v=>text(v,10)&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e12;
 const timestamp=v=>text(v,30)&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
 for(const k of ['理念','起源','Mission','Vision','Values'])if(!text(d.brand[k]))bad();
 for(const k of ['goals','tasks','shipments','metrics','staffTasks']){
  const ids=new Set();
  for(const r of d[k]){
   if(!r||typeof r!=='object'||!text(r.id,100)||!r.id||ids.has(r.id))bad();ids.add(r.id);
   if(k!=='metrics'&&(!text(r.title,500)||!r.title.trim()))bad();
   if(r.notes!==undefined&&!text(r.notes))bad();
   if(k==='goals'&&(!['monthly','final'].includes(r.type)||!num(r.current)||!num(r.target)||r.target<=0||!text(r.unit,500)||!text(r.month,7)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)))bad();
   if(k==='tasks'&&(!date(r.due)||!['高','中','低'].includes(r.priority)||typeof r.done!=='boolean'))bad();
   if(k==='shipments'&&(!date(r.due)||!['未発送','準備中','発送済み','配達完了'].includes(r.status)||!['order','recipient','carrier','tracking'].every(x=>text(r[x],500))))bad();
   if(k==='metrics'&&(!date(r.date)||!['sales','orders','followers','reach','engagement'].every(x=>num(r[x]))||!['orders','followers','reach','engagement'].every(x=>Number.isInteger(r[x]))))bad();
   if(k==='staffTasks'&&(!['',...STAFF_ASSIGNEES].includes(r.assignee)||!date(r.due)||!['高','中','低'].includes(r.priority)||!STAFF_TASK_STATUS.includes(r.status)||!['relatedOrg','relatedPlayer','relatedPost','nextAction'].every(x=>text(r[x],500))||!timestamp(r.updatedAt)))bad();
  }
 }
 if(new Set(d.metrics.map(m=>m.date)).size!==d.metrics.length)bad();
 return {goals:d.goals,tasks:d.tasks,shipments:d.shipments,metrics:d.metrics,staffTasks:d.staffTasks,brand:d.brand,integrations:empty().integrations};
}
