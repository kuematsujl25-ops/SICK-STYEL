// Local rule analysis only. No provider calls, external actions, or workspace writes.
import {createHash,randomUUID} from 'node:crypto';
import {readTeam,transitionTeam,TEAM_DOCUMENT} from './ai-team.js';
import {prepareTeamStorage} from './ai-team-storage.js';
import {TeamError} from './ai-team-errors.js';
export const DOCUMENT='ai-proactive-sickstyle-v1';
export const SOURCES=['staffTasks','orgSales','collectionTasks'];
const DAY=86400000;
const day=now=>new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const initial=()=>({version:1,enabled:false,modelQueue:false,permissions:Object.fromEntries(SOURCES.map(k=>[k,false])),tasks:[],runs:[],lease:null});
const fail=(m,s=400)=>{throw new TeamError(m,s);};
export async function readProactive(store){const r=await store.doc(DOCUMENT);return {state:r?JSON.parse(r.body):initial(),revision:r?.revision??0};}
async function save(store,state,revision,sourceRevision,modelCommit){
 if(Buffer.byteLength(JSON.stringify(state))>750000)fail('自動分析の保存容量上限です。停止して履歴を確認してください');
 let guard=sourceRevision===undefined?'':sourceRevision===null?" AND NOT EXISTS (SELECT 1 FROM ss_documents WHERE name='workspace')":" AND EXISTS (SELECT 1 FROM ss_documents WHERE name='workspace' AND revision=$4)";
 const values=[JSON.stringify(state),DOCUMENT,revision,...(sourceRevision===undefined||sourceRevision===null?[]:[sourceRevision])];
 if(modelCommit){values.push(modelCommit.revision);guard+=` AND EXISTS (SELECT 1 FROM ss_documents WHERE name='${TEAM_DOCUMENT}' AND revision=$${values.length})`;}
 const commands=[
 ['INSERT INTO ss_documents(name,body,revision) VALUES ($1,$2,0) ON CONFLICT(name) DO NOTHING',[DOCUMENT,JSON.stringify(initial())]],
 ['UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3'+guard+' RETURNING revision',values]
 ];
 if(modelCommit)commands.push(['UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 AND EXISTS (SELECT 1 FROM ss_documents WHERE name=$4 AND revision=$5 AND body=$6) RETURNING revision',[modelCommit.body,TEAM_DOCUMENT,modelCommit.revision,DOCUMENT,revision+1,JSON.stringify(state)]]);
 const rows=await store.transaction(commands);
 if(!rows[1].length)fail('データが更新されました。再読み込みしてください',409);
 return {state,revision:rows[1][0].revision};
}
export async function configureProactive(store,input){
 const current=await readProactive(store);
 if(input.revision!==current.revision)fail('データが更新されました。再読み込みしてください',409);
 const state=structuredClone(current.state);
 if(input.action==='configure'){
  if(typeof input.enabled!=='boolean'||!input.permissions||Object.keys(input.permissions).length!==SOURCES.length||!SOURCES.every(k=>typeof input.permissions[k]==='boolean'))fail('停止状態とデータ別の許可が必要です');
  if(input.modelQueue!==undefined&&typeof input.modelQueue!=='boolean')fail('モデル依頼の設定を確認してください');
  state.enabled=input.enabled;state.permissions=input.permissions;state.modelQueue=input.modelQueue??state.modelQueue??false;
  // A settings change invalidates an in-flight analysis at its CAS commit.
 }else if(input.action==='task'){
  const task=state.tasks.find(t=>t.id===input.id);
  if(!task||!['提案','進行中','完了','見送り'].includes(input.status))fail('タスクの状態を確認してください');
  task.status=input.status;task.editedAt=new Date().toISOString();
 }else fail('未対応の操作です');
 return save(store,state,current.revision);
}
export function analyzeWorkspace(workspace,permissions,now){
 const tasks=[],sources=[];
 const today=day(now);
 for(const source of SOURCES){
  if(!permissions[source]){sources.push({source,status:'許可なし',count:null});continue;}
  if(!Array.isArray(workspace?.[source])){sources.push({source,status:'未取得',count:null});continue;}
  const rows=workspace[source].filter(r=>!r.deletedAt);
  let stale=0;
  for(const r of rows){
   const age=Date.parse(now)-Date.parse(r.updatedAt);
   if(!Number.isFinite(age)||age<0||age>30*DAY){stale++;continue;}
   let rule,due,analysis,proposal;
   if(source==='staffTasks'&&r.status!=='完了'&&r.due&&r.due<today){
    rule='overdue';due=r.due;analysis='担当タスクが期限を過ぎています。完了状況は未確認です。';proposal='進捗を確認し、必要なら担当者が期限を見直す';
   }else if(source==='orgSales'&&!['失注','連絡不要','保留'].includes(r.stage)&&r.nextDue&&r.nextDue<today){
    rule='followup';due=r.nextDue;analysis='団体・OEMの次回対応予定日を過ぎています。連絡の実施状況は未確認です。';proposal='履歴を確認し、次の対応案を準備する（送信は承認待ち）';
   }else if(source==='collectionTasks'&&r.status!=='収集済み'&&r.due&&r.due<=today){
    rule='missing';due=r.due;analysis='収集期限を迎えたデータが未収集です。欠損は0として分析しません。';proposal='取得元と必要な権限を確認し、収集方法を決める';
   }else continue;
   if(typeof r.id!=='string'||!/^\d{4}-\d\d-\d\d$/.test(due))continue;
   const id=hash([source,rule,r.id,due]);
   tasks.push({id,source,sourceId:r.id,title:String(r.title||r.name||'対象記録').slice(0,500),assignee:String(r.assignee||'未割当'),rule,analysis,proposal,status:'提案',createdAt:now,editedAt:null,
    evidence:{due,updatedAt:r.updatedAt,sourceStatus:r.status||r.stage,value:source==='collectionTasks'?null:due},inputHash:hash([source,r.id,due,r.updatedAt,r.status||r.stage])});
  }
  sources.push({source,status:stale?'古い/日時不明の記録を除外':'確認済み',count:rows.length,stale});
 }
 return {tasks,sources};
}
export async function runProactive(store,{now=new Date().toISOString(),trigger='manual'}={}){
 const current=await readProactive(store),s=current.state;
 if(!s.enabled)return {...current,skipped:'停止中'};
 const today=day(now),runs=s.runs.filter(r=>r.day===today);
 if(s.lease&&Date.parse(s.lease.until)>Date.parse(now))return {...current,skipped:'実行中（同時実行は1件）'};
 if(runs.some(r=>r.status==='completed')||runs.length>=2)return {...current,skipped:'本日実行済み、または再試行上限2回'};
 if(s.runs.length>=200||s.tasks.length>=300)return {...current,skipped:'保存上限。停止して履歴を確認してください'};
 const run={id:randomUUID(),day:today,startedAt:now,trigger,status:'running',mode:'rules',sources:[]};
 const acquired=structuredClone(s);
 for(const old of acquired.runs)if(old.status==='running')old.status='expired';
 acquired.runs.push(run);acquired.lease={id:run.id,until:new Date(Date.parse(now)+5*60000).toISOString()};
 let locked;
 try{locked=await save(store,acquired,current.revision);}catch(e){if(e.status===409)return {...await readProactive(store),skipped:'他の実行が先に開始しました'};throw e;}
 const baseline=structuredClone(locked.state);
 try{
  const doc=await store.doc('workspace');
  const result=analyzeWorkspace(doc?JSON.parse(doc.body):null,locked.state.permissions,now);
  const existing=new Set(locked.state.tasks.map(t=>t.id));
  const additions=result.tasks.filter(t=>!existing.has(t.id));
  if(locked.state.tasks.length+additions.length>300)fail('タスク保存上限です');
  locked.state.tasks.push(...additions); // Never overwrite human edits or existing task states.
  const entry=locked.state.runs.at(-1);
  Object.assign(entry,{status:'completed',finishedAt:now,sources:result.sources,sourceRevision:doc?.revision??null,created:additions.length});
  const modelCommit=await queueModelRequests(store,locked.state,result.tasks,now);
  locked.state.lease=null;
  return await save(store,locked.state,locked.revision,doc?.revision??null,modelCommit);
 }catch(e){
  // A concurrent stop/edit must win. Never replace newer state or retry unboundedly.
  const latest=await readProactive(store);
  if(latest.revision===locked.revision){
   const failed=structuredClone(baseline);failed.lease=null;
   Object.assign(failed.runs.at(-1),{status:'failed',error:e.status===409?'入力が更新されたため保存中止':'読み取り・分析・保存に失敗しました',finishedAt:now});
   try{await save(store,failed,latest.revision);}catch{};
  }
  throw e;
 }
}

// Queue only aggregate facts, not customer titles/contact/notes. The user's local runner
// is still the only model executor; this worker neither starts it nor invokes a provider.
async function queueModelRequests(store,state,activeTasks,now){
 const entry=state.runs.at(-1);entry.modelJobs=[];
 if(!state.modelQueue){entry.modelStatus='モデル依頼はOFF';return;}
 const team=await readTeam(store);
 if(!team.state.enabled){entry.modelStatus='AI社員のモデル運用が停止中';return;}
 let next=team.state;
 let slots=Math.max(0,2-next.jobs.filter(j=>['queued','in_review'].includes(j.status)).length);
 const active=new Set(activeTasks.map(t=>t.id));
 for(const source of SOURCES){
  const tasks=state.tasks.filter(t=>t.source===source&&active.has(t.id)&&!t.modelJobId&&t.status==='提案');
  if(!tasks.length||!slots)continue;
  const facts=[{id:'count',label:'期限と状態に該当する記録数',value:tasks.length,unit:'件',source:'SICK STYLE 保存済み '+source,observed_at:now,kind:'observed'},
   {id:'evidence',label:'対象根拠の識別ハッシュ',value:hash(tasks.map(t=>[t.id,t.inputHash]).sort()),unit:'識別子',source:'保存データの期限・更新日時・状態',observed_at:now,kind:'observed'}];
  next=transitionTeam(next,{action:'create',job:{role:source==='orgSales'?'wholesale':'coo',title:'自動業務分析：'+({staffTasks:'期限超過タスク',orgSales:'営業の次回対応',collectionTasks:'不足データ'})[source],objective:'根拠の件数と未確認事項から、確認の優先順位・改善案・必要な追加データを提示してください。個別の事実や原因は未取得です。外部操作は実行しないでください。',facts}},now);
  const job=next.jobs.at(-1);job.proactiveSource=source;
  for(const t of tasks)t.modelJobId=job.id;
  entry.modelJobs.push(job.id);slots--;
 }
 entry.modelStatus=entry.modelJobs.length?'既存キューへ依頼保存。Macランナーの稼働は未確認':'キュー上限または新規対象なし';
 if(!entry.modelJobs.length)return;
 const storage=prepareTeamStorage(next,{action:'create'});
 if(storage.parts.length)fail('モデル依頼の保存容量を確認してください');
 return {body:storage.body,revision:team.revision};
}
