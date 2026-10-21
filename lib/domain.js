export const STAFF_ASSIGNEES=['入戸野','竹田','植松'];
export const STAFF_TASK_STATUS=['未着手','進行中','確認待ち','完了'];
export const ORG_STAGES=['DM送信','初回ZOOM予約','初回ZOOM実施','サンプル発送','到着確認','試用確認','活用法提案ZOOM予約','活用法提案ZOOM実施','有償導入','継続購入'];
export const ORG_SIDE_STAGES=['返信待ち','保留','失注','連絡不要'];
export const ORG_ALL_STAGES=[...ORG_STAGES,...ORG_SIDE_STAGES];
export const COLLECTION_CATEGORIES=['商品・利益','購入者','営業','SNS'];
export const COLLECTION_STATUS=['未収集','確認中','収集済み'];
export const empty=()=>({goals:[],tasks:[],shipments:[],metrics:[],staffTasks:[],orgSales:[],collectionTasks:[],brand:{理念:"",起源:"",Mission:"",Vision:"",Values:""},integrations:{amazon:{mode:"manual"},instagram:{mode:"manual"}}});
// 旧データ（新項目が存在しない保存済み文書・バックアップ）をempty()の既定値で補完する。検証はしない。
// 欠落（undefined）しているキーだけを[]で補う。存在するが不正な型の値はvalidate()に委ねて拒否する。
export const migrate=d=>{
 const base=d&&typeof d==='object'&&!Array.isArray(d)?d:{};
 const fill=k=>base[k]===undefined?[]:base[k];
 return {...empty(),...base,staffTasks:fill('staffTasks'),orgSales:fill('orgSales'),collectionTasks:fill('collectionTasks')};
};
export function validate(input){
 const bad=()=>{throw Error('データの形式が正しくありません');};
 const d=migrate(input);
 if(!['goals','tasks','shipments','metrics','staffTasks','orgSales','collectionTasks'].every(k=>Array.isArray(d[k])&&d[k].length<=10000)||!d.brand||typeof d.brand!=='object'||Array.isArray(d.brand))bad();
 const text=(v,max=10000)=>typeof v==='string'&&v.length<=max;
 const date=v=>text(v,10)&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e12;
 const nnum=v=>v===null||num(v);
 const timestamp=v=>text(v,30)&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
 const ntimestamp=v=>v===null||timestamp(v);
 for(const k of ['理念','起源','Mission','Vision','Values'])if(!text(d.brand[k]))bad();
 for(const k of ['goals','tasks','shipments','metrics','staffTasks','orgSales','collectionTasks']){
  const ids=new Set();
  for(const r of d[k]){
   if(!r||typeof r!=='object'||!text(r.id,100)||!r.id||ids.has(r.id))bad();ids.add(r.id);
   if(!['orgSales'].includes(k)&&k!=='metrics'&&(!text(r.title,500)||!r.title.trim()))bad();
   if(r.notes!==undefined&&!text(r.notes))bad();
   if(k==='goals'&&(!['monthly','final'].includes(r.type)||!num(r.current)||!num(r.target)||r.target<=0||!text(r.unit,500)||!text(r.month,7)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)))bad();
   if(k==='tasks'&&(!date(r.due)||!['高','中','低'].includes(r.priority)||typeof r.done!=='boolean'))bad();
   if(k==='shipments'&&(!date(r.due)||!['未発送','準備中','発送済み','配達完了'].includes(r.status)||!['order','recipient','carrier','tracking'].every(x=>text(r[x],500))))bad();
   if(k==='metrics'&&(!date(r.date)||!['sales','orders','followers','reach','engagement'].every(x=>num(r[x]))||!['orders','followers','reach','engagement'].every(x=>Number.isInteger(r[x]))))bad();
   if(k==='staffTasks'&&(!['',...STAFF_ASSIGNEES].includes(r.assignee)||!date(r.due)||!['高','中','低'].includes(r.priority)||!STAFF_TASK_STATUS.includes(r.status)||!['relatedOrg','relatedPlayer','relatedPost','nextAction'].every(x=>text(r[x],500))||!timestamp(r.updatedAt)||!ntimestamp(r.deletedAt===undefined?null:r.deletedAt)))bad();
   if(k==='orgSales'&&(!text(r.name,200)||!r.name.trim()||!ORG_ALL_STAGES.includes(r.stage)||!['',...STAFF_ASSIGNEES].includes(r.assignee)||!text(r.category,200)||!text(r.size,200)||!text(r.contact,500)||!nnum(r.sampleQty)||!nnum(r.sampleCost)||!nnum(r.shippingCost)||!nnum(r.trialUsers)||!text(r.feedback,2000)||!text(r.proposal,2000)||!nnum(r.paidQty)||!nnum(r.paidRevenue)||!nnum(r.paidCost)||!text(r.lostReason,2000)||!text(r.nextAction,500)||!(r.nextDue===''||date(r.nextDue))||!timestamp(r.updatedAt)||!ntimestamp(r.deletedAt===undefined?null:r.deletedAt)||!Array.isArray(r.history)||r.history.length>500||!r.history.every(h=>h&&typeof h==='object'&&ORG_ALL_STAGES.includes(h.stage)&&timestamp(h.at)&&text(h.note,500))))bad();
   if(k==='collectionTasks'&&(!COLLECTION_CATEGORIES.includes(r.category)||!['',...STAFF_ASSIGNEES].includes(r.assignee)||!(r.due===''||date(r.due))||!text(r.period,200)||!text(r.source,500)||!text(r.frequency,200)||!text(r.purpose,1000)||!COLLECTION_STATUS.includes(r.status)||!text(r.value,2000)||!timestamp(r.updatedAt)))bad();
  }
 }
 if(new Set(d.metrics.map(m=>m.date)).size!==d.metrics.length)bad();
 return {goals:d.goals,tasks:d.tasks,shipments:d.shipments,metrics:d.metrics,staffTasks:d.staffTasks,orgSales:d.orgSales,collectionTasks:d.collectionTasks,brand:d.brand,integrations:empty().integrations};
}
