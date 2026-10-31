// Derived read model only: no mutation of legacy salesKpiRecords or imported evidence.
import {computeKpi} from '../public/monthly-kpi.js';
import {InstagramImportError} from './instagram-sales-import.js';
const bad=code=>{throw new InstagramImportError(400,code);};
function aggregate(facts,month){
 const parties=[...new Set(facts.map(e=>e.party))];
 const groups=parties.map(p=>facts.filter(e=>e.party===p).sort((a,b)=>a.date.localeCompare(b.date)));
 const firstDm=g=>g.find(e=>e.type==='dm');
 const counts={new_dm:groups.filter(g=>firstDm(g)?.date.startsWith(month)).length,reply:groups.filter(g=>g.some(e=>e.type==='reply'&&e.date.startsWith(month))).length,zoom_invite:groups.filter(g=>g.some(e=>e.type==='zoom_invite'&&e.date.startsWith(month))).length};
 const cohort=groups.filter(g=>firstDm(g)?.date.startsWith(month));
 return {monthly:counts,cohort:{new_dm:cohort.length,reply:cohort.filter(g=>g.some(e=>e.type==='reply'&&e.date>=firstDm(g).date)).length,zoom_invite:cohort.filter(g=>g.some(e=>e.type==='zoom_invite'&&e.date>=firstDm(g).date)).length},coverage:'partial'};
}
export function salesKpiProjection(ledger,manual,month,partyMap={},now=new Date().toISOString()){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))bad('invalid_month');
 if(!partyMap||typeof partyMap!=='object'||Array.isArray(partyMap)||Object.entries(partyMap).some(([k,v])=>!/^[a-z0-9._]{1,30}$/.test(k)||typeof v!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(v))||new Set(Object.values(partyMap)).size!==Object.values(partyMap).length)bad('identity_mapping_not_one_to_one');
 const today=new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
 const voided=new Set(ledger.voids.map(v=>v.key));
 const imported=ledger.events.filter(e=>!voided.has(e.key)&&e.date<=today).map(e=>({party:e.peer,type:e.type==='new_dm'?'dm':e.type,date:e.date}));
 const old=computeKpi(manual,month,now);
 const manualVoids=new Set(manual.filter(e=>e.type==='void'&&e.date<=today).map(e=>e.ref));
 const cancelled=manual.filter(e=>manualVoids.has(e.id));
 const result={imported:aggregate(imported,month),legacyFirstOccurrenceCounts:old.counts,combined:null,linkageReason:null};
 if(imported.some(e=>!Object.hasOwn(partyMap,e.party))){result.linkageReason='identity_mapping_required';return result;}
 const mapped=imported.map(e=>({...e,party:partyMap[e.party]}));
 // Do not silently reintroduce a manually cancelled fact or overwrite its corrected date.
 if(mapped.some(e=>cancelled.some(m=>m.party===e.party&&m.type===e.type&&m.date===e.date))){result.linkageReason='manual_correction_conflict';return result;}
 if(mapped.some(e=>e.type==='dm'&&old.facts.some(m=>m.party===e.party&&m.type==='dm'&&m.date!==e.date))){result.linkageReason='first_dm_date_conflict';return result;}
 result.combined=aggregate([...old.facts,...mapped],month);return result;
}
