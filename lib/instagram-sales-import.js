// Minimal append-only Instagram evidence; transport authorization lives in the API handler.
import {createHash} from 'node:crypto';
export class InstagramImportError extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
const fail=(status,code)=>{throw new InstagramImportError(status,code);};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&Object.keys(o).every(k=>keys.includes(k));
const id=v=>typeof v==='string'&&/^[a-z0-9._]{1,30}$/.test(v);
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const stamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().replace('.000Z','Z')===v.replace('.000Z','Z');
const jst=v=>new Date(v).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
export function validateImport(input,owner,now=new Date().toISOString()){
 if(!exact(input,['owner','source','capturedAt','rangeStart','rangeEnd','events'])||!id(input.owner)||input.owner!==owner)fail(400,'invalid_owner_or_shape');
 if(!day(input.rangeStart)||!day(input.rangeEnd)||input.rangeStart>input.rangeEnd||input.rangeEnd>jst(input.capturedAt)||!['browser_observation','manual'].includes(input.source)||!stamp(input.capturedAt)||Date.parse(input.capturedAt)>Date.parse(now)||!Array.isArray(input.events)||!input.events.length||input.events.length>100)fail(400,'invalid_batch');
 const events=input.events.map(e=>{
  if(!exact(e,['peer','type','date','direction','confirmed','historyStartConfirmed','firstOutboundConfirmed','inviteConfirmed'])||!id(e.peer)||e.peer===owner||!['new_dm','reply','zoom_invite'].includes(e.type)||!day(e.date)||e.date<input.rangeStart||e.date>input.rangeEnd||e.date>jst(input.capturedAt)||e.confirmed!==true||!['historyStartConfirmed','firstOutboundConfirmed','inviteConfirmed'].every(k=>typeof e[k]==='boolean'))fail(400,'invalid_event');
  if(e.direction!==(e.type==='reply'?'inbound':'outbound'))fail(400,'unconfirmed_direction');
  if(e.type==='new_dm'&&(!e.historyStartConfirmed||!e.firstOutboundConfirmed))fail(400,'first_dm_unproven');
  if(e.type==='zoom_invite'&&!e.inviteConfirmed)fail(400,'invitation_unproven');
  const key=createHash('sha256').update(JSON.stringify([owner,e.peer,e.type,e.date])).digest('hex');
  return {key,owner,peer:e.peer,type:e.type,date:e.date,direction:e.direction,confirmed:true,historyStartConfirmed:e.historyStartConfirmed,firstOutboundConfirmed:e.firstOutboundConfirmed,inviteConfirmed:e.inviteConfirmed,source:input.source,identityKind:'handle',capturedAt:input.capturedAt,rangeStart:input.rangeStart,rangeEnd:input.rangeEnd,datePrecision:'day',timeZone:'Asia/Tokyo',coverage:'partial'};
 });
 return events;
}
const DOC='instagram-sales-evidence-v1';
const empty=owner=>({version:1,owner,events:[],voids:[],mappings:{}});
async function read(store,owner){
 const row=await store.doc(DOC);if(!row)fail(409,'owner_not_configured');
 const ledger=JSON.parse(row.body);
 if(ledger.version!==1||ledger.owner!==owner||!Array.isArray(ledger.events)||!Array.isArray(ledger.voids))fail(409,'ledger_owner_or_version_conflict');
 return {ledger,revision:row.revision,exists:true};
}
export async function readSalesLedger(store,owner){const {ledger,revision}=await read(store,owner);return {...ledger,revision};}
export async function importSalesEvents(store,input,owner,now=new Date().toISOString()){
 if(input?.owner!==owner)fail(403,'owner_mismatch');
 const incoming=validateImport(input,owner,now);
 for(let attempt=0;attempt<5;attempt++){
  const current=await read(store,owner),next=structuredClone(current.ledger),voided=new Set(next.voids.map(v=>v.key));let added=0,replayed=0,suppressed=0;
  for(const event of incoming){
   const prior=next.events.find(e=>e.key===event.key);
   if(prior){if(voided.has(prior.key))suppressed++;else replayed++;continue;}
   if(event.type==='new_dm'&&next.events.some(e=>!voided.has(e.key)&&e.peer===event.peer&&e.type==='new_dm'&&e.date!==event.date))fail(409,'first_dm_date_conflict');
   next.events.push(event);added++;
  }
  if(next.events.length>2000)fail(413,'ledger_capacity');
  if(!added)return {added,replayed,suppressed,revision:current.revision};
  
  const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(next),DOC,current.revision]);
  if(rows.length)return {added,replayed,suppressed,revision:rows[0].revision};
 }
 fail(409,'concurrent_change_retry');
}
export async function voidSalesEvent(store,input,owner,now=new Date().toISOString()){
 if(!exact(input,['owner','key','revision','reason'])||input.owner!==owner||typeof input.key!=='string'||!/^[a-f0-9]{64}$/.test(input.key)||!Number.isSafeInteger(input.revision)||input.revision<0||!['incorrect_date','incorrect_identity','incorrect_direction','not_invitation','duplicate'].includes(input.reason))fail(400,'invalid_void');
 const {ledger,revision}=await read(store,owner);
 const existing=ledger.voids.find(v=>v.key===input.key);
 if(existing){if(existing.reason!==input.reason)fail(409,'void_reason_conflict');return {revision,alreadyVoided:true};}
 if(revision!==input.revision)fail(409,'stale_revision');
 if(!ledger.events.some(e=>e.key===input.key))fail(404,'event_not_found');
 ledger.voids.push({key:input.key,reason:input.reason,createdAt:now});
 const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(ledger),DOC,revision]);
 if(!rows.length)fail(409,'concurrent_change_retry');
 return {revision:rows[0].revision,alreadyVoided:false};
}

export async function salesStatus(store){
 const row=await store.doc(DOC);if(!row)return {configured:false,owner:null};
 const d=JSON.parse(row.body);return {configured:true,owner:d.owner,revision:row.revision};
}
export async function configureSalesOwner(store,input){
 if(!exact(input,['owner','confirmed'])||!id(input.owner)||input.confirmed!==true)fail(400,'invalid_owner_confirmation');
 await store.query('INSERT INTO ss_documents(name,body,revision) VALUES ($1,$2,0) ON CONFLICT(name) DO NOTHING',[DOC,JSON.stringify(empty(input.owner))]);
 const status=await salesStatus(store);if(status.owner!==input.owner)fail(409,'owner_already_configured');return status;
}
export async function mapSalesPeer(store,input,owner){
 if(!exact(input,['owner','peer','party','confirmed','revision'])||input.owner!==owner||!id(input.peer)||typeof input.party!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(input.party)||input.confirmed!==true||!Number.isSafeInteger(input.revision))fail(400,'invalid_mapping');
 const {ledger,revision}=await read(store,owner);
 if(Object.hasOwn(ledger.mappings,input.peer)&&ledger.mappings[input.peer]===input.party)return {revision};
 if(revision!==input.revision)fail(409,'stale_revision');
 if(Object.hasOwn(ledger.mappings,input.peer)||Object.values(ledger.mappings).includes(input.party))fail(409,'mapping_conflict');
 if(!ledger.events.some(e=>e.peer===input.peer))fail(404,'peer_not_found');
 const workspace=await store.doc('workspace');const records=workspace?JSON.parse(workspace.body).salesKpiRecords||[]:[];
 if(!records.some(e=>e.party===input.party))fail(400,'manual_party_not_found');
 ledger.mappings={...ledger.mappings,[input.peer]:input.party};
 const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(ledger),DOC,revision]);
 if(!rows.length)fail(409,'concurrent_change_retry');return {revision:rows[0].revision};
}
