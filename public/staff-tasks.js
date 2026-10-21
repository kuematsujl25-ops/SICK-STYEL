// 担当者別タスク管理。表示の切替（担当フィルター）だけで、既存ログイン・権限は変えない。
// 削除はdeletedAtを立てるだけの論理削除。「ゴミ箱」から復元できる。
export const STAFF=['入戸野','竹田','植松'];
export const STAFF_STATUS=['未着手','進行中','確認待ち','完了'];
export const staffTaskFields=[['title','件名','text'],
 ['assignee','担当','select',['',...STAFF],['未設定',...STAFF]],
 ['due','期限','date'],['priority','優先度','select',['高','中','低']],
 ['status','状態','select',STAFF_STATUS],
 ['relatedOrg','関連する団体','text'],['relatedPlayer','関連する選手','text'],['relatedPost','関連する投稿','text'],
 ['nextAction','次の行動','text'],['notes','メモ','textarea']];

function row(x,today,esc){
 const late=x.status!=='完了'&&x.due<today;
 const hay=[x.title,x.assignee||'未設定',x.relatedOrg,x.relatedPlayer,x.relatedPost,x.nextAction,x.notes].join(' ').toLowerCase();
 return `<div class="listrow" data-search="${esc(hay)}"><div class="grow ${x.status==='完了'?'done':''}"><b>${esc(x.title)}</b><small class="${late?'red':''}">${esc(x.assignee||'未設定')} · ${esc(x.due)}${late?' · 期限超過':''}${x.relatedOrg?' · '+esc(x.relatedOrg):''}${x.relatedPlayer?' · '+esc(x.relatedPlayer):''}${x.relatedPost?' · '+esc(x.relatedPost):''}</small></div><span class="badge ${x.priority==='高'?'danger':''}">${esc(x.priority)}</span><select data-staffstatus="${esc(x.id)}" aria-label="${esc(x.title)}の状態">${STAFF_STATUS.map(s=>`<option value="${s}" ${x.status===s?'selected':''}>${s}</option>`).join('')}</select><button data-edit="staffTasks:${esc(x.id)}">編集</button></div>`;
}
function trashRow(x,esc){
 return `<div class="listrow"><div class="grow"><b>${esc(x.title)}</b><small>${esc(x.assignee||'未設定')} · 削除日時 ${esc(new Date(x.deletedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))}</small></div><button data-restore-stafftask="${esc(x.id)}">復元する</button></div>`;
}
export function renderStaffTasks(tasks,ui,esc,today){
 const active=tasks.filter(x=>!x.deletedAt);
 const trashed=tasks.filter(x=>x.deletedAt);
 const open=active.filter(x=>x.status!=='完了');
 const overdue=open.filter(x=>x.due<today).length;
 const dueToday=open.filter(x=>x.due===today).length;
 const unassigned=open.filter(x=>!x.assignee).length;
 const filtered=active.filter(x=>ui.assignee==='all'||(ui.assignee==='unassigned'?!x.assignee:x.assignee===ui.assignee));
 const sorted=[...filtered].sort((a,b)=>
  ui.sort==='priority'?['高','中','低'].indexOf(a.priority)-['高','中','低'].indexOf(b.priority):
  ui.sort==='updated'?(b.updatedAt||'').localeCompare(a.updatedAt||''):
  a.due.localeCompare(b.due));
 const tabs=[['all','全員'],...STAFF.map(s=>[s,s]),['unassigned','担当未設定']];
 return `<div class="stats">
 <article><small>期限超過</small><strong>${overdue}<em> 件</em></strong></article>
 <article><small>今日やること</small><strong>${dueToday}<em> 件</em></strong></article>
 <article><small>担当未設定</small><strong>${unassigned}<em> 件</em></strong></article></div>
 <section class="panel"><div class="panelhead"><h2>担当者別タスク <small id="stafftaskcount">${sorted.length} / ${active.length} 件</small></h2><button class="primary" data-new="staffTasks">＋ タスクを追加</button></div>
 <div class="actions" role="tablist">${tabs.map(([k,l])=>`<button class="${ui.assignee===k?'primary':'secondary'}" data-stafftab="${k}">${esc(l)}</button>`).join('')}</div>
 <div class="formfields"><label>検索<input id="stafftaskq" value="${esc(ui.q||'')}" placeholder="件名・関連先・メモ"></label><label>並べ替え<select id="stafftasksort"><option value="due" ${ui.sort==='due'?'selected':''}>期限順</option><option value="priority" ${ui.sort==='priority'?'selected':''}>優先度順</option><option value="updated" ${ui.sort==='updated'?'selected':''}>更新順</option></select></label></div>
 ${sorted.length?`<div class="records">${sorted.map(x=>row(x,today,esc)).join('')}</div>`:'<div class="empty"><div aria-hidden="true">＋</div><b>該当するタスクはありません。</b><p>タスクを追加できます。</p></div>'}</section>
 ${trashed.length?`<section class="panel"><details><summary>ゴミ箱（${trashed.length}件・復元できます）</summary><div class="records">${trashed.map(x=>trashRow(x,esc)).join('')}</div></details></section>`:''}`;
}
