export class KpiValidationError extends Error {}
export function validateKpi(records,now=new Date().toISOString()){
 const today=new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
 const bad=()=>{throw new KpiValidationError('KPIの活動日・送信先ID・案件IDを確認してください');};
 const txt=v=>typeof v==='string'&&v.length<=100;
 const num=v=>v===null||typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e12;
 const voids=new Set(records.filter(r=>r.type==='void').map(r=>r.ref)),deals=new Set();
 for(const r of records){
  if(!['dm','reply','appointment','zoom','sent','arrived','second','order','complete','void'].includes(r.type)||typeof r.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date||![r.party,r.deal,r.ref].every(txt)||!['direct','amazon','unknown'].includes(r.channel)||!num(r.amount)||!num(r.qty)||(r.qty!==null&&!Number.isInteger(r.qty))||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt)))bad();
  if(r.date>today)throw new KpiValidationError('KPIの活動日・取消日は日本時間の今日以前を指定してください');
  if(r.type==='void'&&records.some(x=>x.id===r.ref&&r.date<x.date))throw new KpiValidationError('取消日は元の活動日以後を指定してください');
  if(!['complete','void'].includes(r.type)&&!r.party.trim())bad();
  if(r.type==='void'&&!records.some(x=>x.id===r.ref&&x.type!=='void'))bad();
  if(['sent','arrived'].includes(r.type)&&!r.deal.trim())bad();
  if(r.type==='order'){if(!r.deal.trim())bad();if(!voids.has(r.id)){if(deals.has(r.deal))bad();deals.add(r.deal);}}
 }
}
export function retainKpiHistory(current,next){const map=new Map((next.salesKpiRecords||[]).map(r=>[r.id,r]));for(const r of current.salesKpiRecords||[])if(JSON.stringify(map.get(r.id))!==JSON.stringify(r))throw new KpiValidationError('KPI履歴は変更・削除できません。取消記録を追加してください');}
// Restoring unrelated business data must not discard newly added immutable evidence.
export function restoreKpiHistory(current,next){
 const records=new Map((next.salesKpiRecords||[]).map(r=>[r.id,r]));
 for(const r of current.salesKpiRecords||[])records.set(r.id,r);
 return {...next,salesKpiRecords:[...records.values()]};
}
