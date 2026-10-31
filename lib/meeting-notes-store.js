import {importNote,resolveFact,MeetingNoteError} from './meeting-notes.js';
import {validate,migrate} from './domain.js';
export async function writeMeetingNote(store,input){
 const row=await store.doc('workspace');if(!row||row.revision!==input.revision)throw Object.assign(Error('最新データを再読み込みしてください'),{conflict:true});
 const data=migrate(JSON.parse(row.body)),org=data.orgSales.find(o=>o.id===input.orgId&&!o.deletedAt);if(!org)throw new MeetingNoteError('対象がありません');
 const result=input.action==='import'?importNote(org,input):{org:resolveFact(org,input)};
 if(result.duplicate)return {ok:true,revision:row.revision,duplicate:true};
 const next=validate({...data,orgSales:data.orgSales.map(o=>o.id===org.id?result.org:o)});
 const serialized=JSON.stringify(next);if(new TextEncoder().encode(serialized).length>1_800_000)throw new MeetingNoteError('議事録を含む保存容量の上限です。既存データは保持しました。管理者に確認してください');
 const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[serialized,'workspace',input.revision]);
 if(!rows.length)throw Object.assign(Error('同時更新があります。再読込してください'),{conflict:true});
 return {ok:true,revision:rows[0].revision};
}
