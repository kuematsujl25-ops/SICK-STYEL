// Local-only observation ledger. No Instagram API, credentials, or business-data writes.
export const TYPES = {new_dm:'新規DM',reply:'返信あり',zoom_invite:'Zoom案内'};
const account = s => typeof s === 'string' && /^@?[a-zA-Z0-9._]{1,30}$/.test(s);
const normalize = s => s.replace(/^@/,'').toLowerCase();
const date = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
const timestamp = s => typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s));
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k=>keys.includes(k));
const fail = () => {throw Error('形式・日付・確認範囲を確認してください。本文や追加フィールドは取り込めません。');};
export function validateBatch(raw, now = new Date().toISOString()) {
 if (!exact(raw,['version','owner','source','capturedAt','rangeStart','rangeEnd','coverage','events']) || raw.version!==1 || !account(raw.owner) || !['browser_observation','manual'].includes(raw.source) || !timestamp(raw.capturedAt) || Date.parse(raw.capturedAt)>Date.parse(now) || !date(raw.rangeStart) || !date(raw.rangeEnd) || raw.rangeStart>raw.rangeEnd || raw.coverage!=='partial' || !Array.isArray(raw.events) || raw.events.length>100) fail();
 const capturedDay = new Date(raw.capturedAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
 if(raw.rangeEnd>capturedDay)fail();
 const events=raw.events.map(e=>{
  if(!exact(e,['account','type','date','direction','historyStartSeen','firstOutboundConfirmed','evidence','verified','reason','party']) || !account(e.account) || !Object.hasOwn(TYPES,e.type) || !(e.date===null||date(e.date)) || (e.date && (e.date<raw.rangeStart||e.date>raw.rangeEnd)) || !['inbound','outbound','unknown'].includes(e.direction) || !['history_start','received_message','explicit_zoom_invitation','ambiguous_zoom','unknown'].includes(e.evidence) || !['','history_incomplete','date_unknown','direction_unknown','ambiguous_invitation','identity_unconfirmed'].includes(e.reason) || !['historyStartSeen','firstOutboundConfirmed','verified'].every(k=>typeof e[k]==='boolean') || typeof e.party!=='string' || !/^[a-zA-Z0-9_.:-]{0,100}$/.test(e.party))fail();
  if(normalize(e.account)===normalize(raw.owner))fail();
  return {...e,account:normalize(e.account)};
 });
 return {...raw,owner:normalize(raw.owner),events};
}
function reasons(e){
 const r=[];
 if(!e.verified)r.push('本人未確認');
 if(!e.date)r.push('日付未確認');
 if(e.reason)r.push(e.reason);
 if(e.type==='new_dm' && (!e.historyStartSeen||!e.firstOutboundConfirmed||e.evidence!=='history_start'))r.push('初回送信の根拠不足');
 if(e.type==='reply' && e.evidence!=='received_message')r.push('返信根拠不足');
 if(e.type==='zoom_invite' && e.evidence!=='explicit_zoom_invitation')r.push('Zoom案内が曖昧');
 if(e.direction!==(e.type==='reply'?'inbound':'outbound'))r.push('送受信方向が不一致・未確認');
 return r;
}
export function previewBatch(raw, expectedOwner, now){
 const batch=validateBatch(raw,now);
 if(!account(expectedOwner)||batch.owner!==normalize(expectedOwner))throw Error('対象アカウントが一致しません。切替・取込を停止しました。');
 return {batch,rows:batch.events.map(e=>({...e,reasons:reasons(e),key:JSON.stringify([batch.owner,e.account,e.type,e.date])}))};
}
// Append-only: identical observations are no-ops; corrections require a separate future review flow.
export function stagePreview(ledger, preview){
 if(ledger.some(e=>e.owner!==preview.batch.owner))throw Error("別の所有者の台帳には追加できません。再読込して別々に確認してください。");
 const next=ledger.slice();
 for(const row of preview.rows){
  if(row.reasons.length)continue;
  const event={...row,source:preview.batch.source,owner:preview.batch.owner,capturedAt:preview.batch.capturedAt,rangeStart:preview.batch.rangeStart,rangeEnd:preview.batch.rangeEnd,coverage:'partial'};
  const prior=next.find(x=>x.key===event.key);
  if(prior){if(prior.party!==event.party)throw Error('同じ活動の営業先対応が異なります。既存記録を保持しました。');continue;}
  if(event.type==='new_dm'&&next.some(x=>x.owner===event.owner&&x.account===event.account&&x.type==='new_dm'&&x.date!==event.date))throw Error('初回DM日が競合しています。既存記録を保持しました。');
  next.push(event);
 }
 return next;
}
export function summarize(ledger,month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('対象月を確認してください');
 const unique=rows=>new Set(rows.map(e=>JSON.stringify([e.owner,e.account]))).size;
 const monthly=Object.fromEntries(Object.keys(TYPES).map(t=>[t,unique(ledger.filter(e=>e.type===t&&e.date.startsWith(month)))]));
 const cohort=new Set(ledger.filter(e=>e.type==='new_dm'&&e.date.startsWith(month)).map(e=>JSON.stringify([e.owner,e.account])));
 const follow=ledger.filter(e=>cohort.has(JSON.stringify([e.owner,e.account]))&&e.date>=ledger.find(x=>x.type==='new_dm'&&x.owner===e.owner&&x.account===e.account).date);
 return {monthly,cohort:{size:cohort.size,reply:unique(follow.filter(e=>e.type==='reply')),zoom_invite:unique(follow.filter(e=>e.type==='zoom_invite'))},coverage:'partial'};
}

// Preserve observation provenance while respecting the API's per-request limit.
export function persistenceBatches(ledger){
 if(!ledger.length||ledger.some(e=>e.owner!==ledger[0].owner))throw Error('保存対象を確認してください');
 const groups=new Map();
 for(const e of ledger){const key=JSON.stringify([e.source,e.capturedAt,e.rangeStart,e.rangeEnd]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
 const batches=[];
 for(const group of groups.values())for(let offset=0;offset<group.length;offset+=100){
  batches.push({owner:group[0].owner,source:group[0].source,capturedAt:new Date(group[0].capturedAt).toISOString(),rangeStart:group[0].rangeStart,rangeEnd:group[0].rangeEnd,events:group.slice(offset,offset+100).map(e=>({peer:e.account,type:e.type,date:e.date,direction:e.direction,confirmed:true,historyStartConfirmed:e.historyStartSeen,firstOutboundConfirmed:e.firstOutboundConfirmed,inviteConfirmed:e.evidence==='explicit_zoom_invitation'}))});
 }
 return batches;
}
