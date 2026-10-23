import {importNote,resolveFact} from './meeting-notes.js';
import {validate,migrate} from './domain.js';
export async function writeMeetingNote(store,input){
 const row=await store.doc('workspace');if(!row||row.revision!==input.revision)throw Object.assign(Error('最新データを再読み込みしてください'),{conflict:true});
 const data=migrate(JSON.parse(row.body)),org=data.orgSales.find(o=>o.id===input.orgId&&!o.deletedAt);if(!org)throw Error('対象がありません');
 const result=input.action==='import'?importNote(org,input):{org:resolveFact(org,input)};
 if(result.duplicate)return {ok:true,revision:row.revision,duplicate:true};
 const next=validate({...data,orgSales:data.orgSales.map(o=>o.id===org.id?result.org:o)});
 const rows=await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[JSON.stringify(next),'workspace',input.revision]);
 if(!rows.length)throw Object.assign(Error('同時更新があります。再読込してください'),{conflict:true});
 return {ok:true,revision:rows[0].revision};
}
