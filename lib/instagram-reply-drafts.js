import {OwnerMediaError} from './owner-media-requests.js';

const DOC='instagram-reply-drafts-v1';
export const REPLY_DRAFT_LIMIT=40;
const ID=/^[0-9a-f]{64}$/;
const CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const field=(v,max)=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!CONTROL.test(v);
export function normalizeReplyDraft(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['id','peer','text','note'].includes(k))||
  typeof input.id!=='string'||!ID.test(input.id)||!field(input.peer,100)||/[\r\n\t]/.test(input.peer)||
  !field(input.text,1400)||(input.note!==undefined&&!field(input.note,200)))throw new OwnerMediaError('返信案の内容を確認してください。');
 return {id:input.id,peer:input.peer.trim(),text:input.text.trim(),...(input.note===undefined?{}:{note:input.note.trim()})};
}
async function read(store){
 const row=await store.doc(DOC);
 return {drafts:row?JSON.parse(row.body):[],revision:row?.revision??null};
}
export async function readReplyDrafts(store){return {drafts:(await read(store)).drafts};}
export async function saveReplyDraft(store,input,now=Date.now()){
 const normalized=normalizeReplyDraft(input);
 for(let i=0;i<5;i++){
  const {drafts,revision}=await read(store);
  if(drafts.some(d=>d.id===normalized.id))return {id:normalized.id,created:false};
  const body=JSON.stringify([{...normalized,createdAt:new Date(now).toISOString()},...drafts].slice(0,REPLY_DRAFT_LIMIT));
  const written=revision===null
   ?await store.query('INSERT INTO ss_documents(name,body,revision) VALUES ($1,$2,0) ON CONFLICT(name) DO NOTHING RETURNING revision',[DOC,body])
   :await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[body,DOC,revision]);
  if(written.length)return {id:normalized.id,created:true};
 }
 throw new OwnerMediaError('更新が重なりました。もう一度実行してください。',409);
}
