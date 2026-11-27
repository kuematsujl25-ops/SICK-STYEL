import {createHash} from 'node:crypto';
import {TeamError} from './ai-team-errors.js';

export const TEAM_SOFT_LIMIT=700000;
export const TEAM_REVIEW_LIMIT=750000;
const LEGACY_DRAIN_LIMIT=4000000;
const STOP_RESERVE=1000;
const PART_CHARS=64000;
const FORMAT='sickstyle-team-parts-v1';
const PREFIX='ai-team-sickstyle-v1:part:';
const bytes=value=>new TextEncoder().encode(value).length;
const jsonBytes=value=>bytes(JSON.stringify(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const corrupt=()=>{throw new TeamError('AI社員データの保存形式・完全性を確認できません',503);};
const validState=state=>object(state)&&state.business_unit==='sickstyle'&&
  Array.isArray(state.jobs)&&Array.isArray(state.knowledge)&&Array.isArray(state.audit);

// Keep the public v1 document contract. Only its physical JSON representation changes.
export function encodeTeamState(state) {
  if(!validState(state)||state.version!==1||Object.hasOwn(state,'outputs'))corrupt();
  const stored=structuredClone(state),outputs={};
  for(const entry of [...stored.jobs,...stored.knowledge]) {
    if(Object.hasOwn(entry,'output_ref'))corrupt();
    if(entry.output==null)continue;
    const body=JSON.stringify(entry.output),ref=sha(body);
    if(Object.hasOwn(outputs,ref)&&JSON.stringify(outputs[ref])!==body)corrupt();
    outputs[ref]=entry.output;entry.output_ref=ref;delete entry.output;
  }
  stored.version=2;stored.outputs=outputs;
  return stored;
}

export function decodeTeamState(stored) {
  if(!validState(stored))corrupt();
  if(stored.version===1)return structuredClone(stored);
  if(stored.version!==2||!object(stored.outputs))corrupt();
  const state=structuredClone(stored),used=new Set();
  for(const [ref,output] of Object.entries(state.outputs))
    if(!/^[a-f0-9]{64}$/.test(ref)||sha(JSON.stringify(output))!==ref)corrupt();
  for(const entry of [...state.jobs,...state.knowledge]) {
    if(!Object.hasOwn(entry,'output_ref'))continue;
    const ref=entry.output_ref;
    if(typeof ref!=='string'||!Object.hasOwn(state.outputs,ref)||Object.hasOwn(entry,'output'))corrupt();
    entry.output=state.outputs[ref];delete entry.output_ref;used.add(ref);
  }
  if(used.size!==Object.keys(state.outputs).length)corrupt();
  delete state.outputs;state.version=1;
  return state;
}

// JSON escapes one UTF-16 unit to at most six bytes. Reserve both stored copies of
// the longest allowed review note plus actual legacy execution metadata and audit.
export function reviewReserve(stored) {
  const now='+999999-12-31T23:59:59.999Z',id='0'.repeat(36),hash='0'.repeat(64);
  const decision={actor:'authenticated_admin',action:'approve',at:now,note:'x'+'\0'.repeat(999)};
  let amount=0,count=0;
  for(const job of stored.jobs.filter(j=>j.status==='in_review')) {
    if(!job.output_ref||!Object.hasOwn(stored.outputs,job.output_ref)||!job.execution)corrupt();
    const knowledge={id,business_unit:'sickstyle',job_id:job.id,source:'human_review',recorded_at:now,
      verification:'human_reviewed_draft',effect_status:'unmeasured',input_hash:job.input_hash,
      execution:job.execution,output_ref:job.output_ref,decision};
    const audit={id,at:now,action:'human_approve',job_id:job.id,previous:hash,hash};
    amount+=jsonBytes(decision)+jsonBytes(knowledge)+jsonBytes(audit)+16;count++;
  }
  return {bytes:amount,count};
}

export function prepareTeamStorage(state,command) {
  const stored=encodeTeamState(state),body=JSON.stringify(stored),size=bytes(body);
  const reserve=reviewReserve(stored);
  const drain=['approve','reject'].includes(command.action)||command.action==='toggle'&&command.enabled===false;
  if(drain) {
    // Old v1 imports did not reserve review capacity. Let that finite backlog drain
    // through bounded parts in the existing table instead of blocking its review.
    if(size>LEGACY_DRAIN_LIMIT)throw new TeamError('AI社員の旧データの容量が想定範囲外です。バックアップして確認してください');
  } else if(size>TEAM_SOFT_LIMIT||size+reserve.bytes+STOP_RESERVE>TEAM_REVIEW_LIMIT||
      stored.audit.length+reserve.count+1>1000) {
    throw new TeamError('AI社員のレビュー・停止用の容量を確保できません。新規依頼・取込を止め、既存のレビューとバックアップを行ってください');
  }
  if(size<=TEAM_REVIEW_LIMIT)return {body,parts:[],bytes:size,reservedReviewBytes:reserve.bytes};
  const parts=[],names=[];
  for(let i=0;i<body.length;i+=PART_CHARS) {
    // JSON encoding preserves even a surrogate pair split across two parts.
    const part=JSON.stringify(body.slice(i,i+PART_CHARS)),name=PREFIX+sha(part);
    parts.push({name,body:part});names.push(name);
  }
  return {body:JSON.stringify({storage_format:FORMAT,business_unit:'sickstyle',
    bytes:size,sha256:sha(body),parts:names}),parts:[...new Map(parts.map(p=>[p.name,p])).values()],
    bytes:size,reservedReviewBytes:reserve.bytes};
}

export async function loadTeamState(store,record) {
  try {
    let stored=JSON.parse(record.body);
    if(stored.storage_format===FORMAT) {
      if(stored.business_unit!=='sickstyle'||!Array.isArray(stored.parts)||!stored.parts.length||
          stored.parts.length>100||!Number.isSafeInteger(stored.bytes)||stored.bytes>LEGACY_DRAIN_LIMIT||
          !stored.parts.every(p=>typeof p==='string'&&p.startsWith(PREFIX)&&/^[a-f0-9]{64}$/.test(p.slice(PREFIX.length))))corrupt();
      const names=[...new Set(stored.parts)];
      const rows=await store.query('SELECT name,body FROM ss_documents WHERE name IN ('+names.map((_,i)=>'$'+(i+1)).join(',')+')',names);
      const values=new Map(rows.map(row=>[row.name,row.body]));
      const body=stored.parts.map(name=>{
        const raw=values.get(name);if(typeof raw!=='string'||PREFIX+sha(raw)!==name)corrupt();
        const part=JSON.parse(raw);if(typeof part!=='string')corrupt();return part;
      }).join('');
      if(bytes(body)!==stored.bytes||sha(body)!==stored.sha256)corrupt();
      stored=JSON.parse(body);
    }
    return decodeTeamState(stored);
  } catch(error) {
    if(error instanceof TeamError)throw error;
    corrupt();
  }
}
