// In-app only. Acknowledgements live in this login session, never in business data.
export const jstDay=(now=new Date())=>now.toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
export function overdueItems(data,now=new Date()){
 if(!data||!['tasks','staffTasks','shipments'].every(k=>Array.isArray(data[k])))return null;
 const day=jstDay(now),items=[];
 for(const [key,label,open] of [
  ['tasks','タスク',x=>!x.done],['staffTasks','担当タスク',x=>x.status!=='完了'],
  ['shipments','発送',x=>!['発送済み','配達完了'].includes(x.status)]]){
  for(const x of data[key])if(!x.deletedAt&&open(x)&&/^\d{4}-\d{2}-\d{2}$/.test(x.due)&&x.due<day)
   items.push({key,id:x.id,title:x.title,due:x.due,label,token:JSON.stringify([key,x.id,x.due])});
 }
 return items.sort((a,b)=>a.due.localeCompare(b.due)||a.token.localeCompare(b.token));
}
export function createOverdueMonitor({fetchData,changed,now=()=>new Date()}){
 let data=null,status='loading',generation=0,pending=false;
 const seen=new Set();
 const snapshot=()=>{const items=overdueItems(data,now());return {status,items,unread:items?.filter(x=>!seen.has(x.token)).length??null,seen};};
 const accept=value=>{data=value;status=overdueItems(value,now())===null?'error':'ready';const active=new Set(overdueItems(value,now())?.map(x=>x.token));for(const token of seen)if(!active.has(token))seen.delete(token);};
 return {
  snapshot,
  set(value){generation++;accept(value);changed();},
  clear(){generation++;data=null;status='loading';seen.clear();changed();},
  read(){if(status==='ready')for(const x of snapshot().items)seen.add(x.token);changed();},
  async refresh(){if(pending)return;pending=true;const ticket=generation;changed();try{const value=await fetchData();if(ticket===generation)accept(value);}catch{if(ticket===generation)status='error';}finally{pending=false;changed();}}
 };
}
export function overdueSummary(s){return s.status==='loading'?'期限超過 未取得':s.status==='error'?'期限超過 確認できません':`期限超過 ${s.items.length}件${s.unread?' · 未確認 '+s.unread+'件':''}`;}
export function renderOverdue(s,esc){
 const note='<p class="note">タスク・担当タスク・発送が対象です。期限日の翌日（日本時間）から表示します。確認済みでも、完了または期限変更まで件数に残ります。確認状態は再読み込み・ログアウトでリセットされます。</p>';
 const retry='<button data-overdue-retry>再確認</button>';
 if(s.status!=='ready')return `<section class="panel"><h2>${s.status==='error'?'期限超過を確認できません':'期限超過を取得中'}</h2><p>現在の件数は不明です。通信状態を確認して再確認してください。</p>${retry}${note}</section>`;
 return `<section class="panel"><div class="panelhead"><h2>未解決 ${s.items.length}件 <small>未確認 ${s.unread}件</small></h2>${retry}</div>${note}<div class="actions"><button data-overdue-read ${!s.unread?'disabled':''}>表示中を確認済みにする</button></div>${s.items.length?'<div class="records">'+s.items.map(x=>`<article class="record"><span class="badge danger">${esc(x.label)} · 期限 ${esc(x.due)}</span><h3>${esc(x.title)}</h3><p>${s.seen.has(x.token)?'確認済み・未解決':'未確認・未解決'}</p><button data-overdue-target="${esc(x.token)}">対象を開く</button></article>`).join('')+'</div>':'<p>期限超過はありません。</p>'}</section>`;
}
