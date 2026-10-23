import {createHash,randomUUID} from 'node:crypto';
export const noteFields={trialUsers:'試用人数',desiredQty:'希望数',proposedQty:'提案数',confirmedQty:'確定導入数'};
const isText=(x,n)=>typeof x==='string'&&x.length<=n;
export function validateNotes(notes){
 if(notes===undefined)return;
 if(!Array.isArray(notes)||notes.length>100)throw Error('議事録の上限・形式を確認してください');
 for(const n of notes)if(!n||!isText(n.id,100)||!['initial','proposal'].includes(n.kind)||!isText(n.source,2000)||!isText(n.body,20000)||!isText(n.summary,5000)||!isText(n.meetingAt,30)||!isText(n.digest,64)||!Array.isArray(n.facts)||n.facts.length>100||!Array.isArray(n.history)||n.history.length>500||n.facts.some(f=>!Object.hasOwn(noteFields,f.field)||!isText(f.quote,1000)||!(f.value===null||Number.isSafeInteger(f.value)&&f.value>=0)||!['pending','applied','undone'].includes(f.status)))throw Error('議事録の形式が正しくありません');
}
export function extractFacts(body){
 const out=[];
 for(const [index,line] of body.split(/\r?\n/).entries())for(const [field,label] of Object.entries(noteFields)){
  if(!line.includes(label))continue;
  const unit=field==='trialUsers'?'人':'個';
  // Only an entire, explicit field statement is eligible for automatic application.
  // Narrative, negation, ranges, corrections, and ambiguous units stay pending.
  const m=line.trim().match(new RegExp('^'+label+'(?:は|[:：]\\s*)([0-9]{1,8})'+unit+'(?:で確定(?:です)?|と確定しました)[。.]?$'));
  out.push({field,value:m?Number(m[1]):null,quote:line.slice(0,1000),line:index+1,explicit:!!m,status:'pending'});
 }
 for(const f of out)if(out.filter(x=>x.field===f.field).length!==1)f.explicit=false;
 return out;
}
export function importNote(org,input){
 const {kind,source,body,summary='',meetingAt,consentConfirmed}=input;
 if(!['initial','proposal'].includes(kind)||!isText(body,20000)||!body.trim()||!isText(summary,5000)||!isText(source,2000)||!/^https:\/\/app\.notta\.ai\//.test(source)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(meetingAt)||Number.isNaN(Date.parse(meetingAt+':00+09:00'))||consentConfirmed!==true)throw Error('会議日・Notta出典・本文・参加者への告知と同意確認が必要です');
 const digest=createHash('sha256').update(JSON.stringify({kind,source,body,summary,meetingAt})).digest('hex');
 const notes=org.meetingNotes||[],old=notes.find(n=>n.source===source);
 if(old){if(old.digest===digest)return {org,duplicate:true};throw Error('同じ出典に異なる内容があります。既存議事録を保全し、更新内容を確認してください');}
 if(notes.length>=100)throw Error('議事録は対象ごとに100件までです');
 const facts=extractFacts(body);if(facts.length>100)throw Error('抽出候補が多すぎます');
 const now=new Date().toISOString(),next={...org},history=[];
 for(const fact of facts){const previous=next[fact.field]??null;
  if(fact.explicit&&previous===null){next[fact.field]=fact.value;fact.status='applied';history.push({field:fact.field,before:null,after:fact.value,at:now,action:'auto',line:fact.line});}
 }
 const note={id:randomUUID(),kind,source,body,summary,meetingAt,digest,facts,history,consentConfirmed:true,createdAt:now};
 next.meetingNotes=[...notes,note];next.updatedAt=now;return {org:next,duplicate:false};
}
export function resolveFact(org,{noteId,index,action,value}){
 const next=structuredClone(org),note=next.meetingNotes?.find(n=>n.id===noteId),f=note?.facts[index];
 if(!f||!['approve','undo'].includes(action))throw Error('対象の根拠を確認してください');
 if(note.history.length>=500)throw Error('更新履歴の上限です');
 let after;
 if(action==='undo'){
  const h=[...note.history].reverse().find(h=>h.field===f.field&&h.line===f.line);
  if(f.status!=='applied'||!h||next[f.field]!==h.after)throw Error('反映後に値が変わっています。上書きせず確認してください');
  after=h.before;f.status='undone';
 }else{
  if(f.status!=='pending'||!Number.isSafeInteger(value)||value<0||value>99999999)throw Error('確認待ちの数値を指定してください');
  after=value;f.value=value;f.status='applied';
 }
 note.history.push({field:f.field,before:next[f.field]??null,after,at:new Date().toISOString(),action,line:f.line});next[f.field]=after;next.updatedAt=new Date().toISOString();return next;
}
