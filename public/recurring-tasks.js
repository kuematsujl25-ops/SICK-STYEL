export function renderRecurringTasks(templates,collection,esc,enabled=true){
 const rows=(templates||[]).filter(t=>t.collection===collection);
 return `<section class="panel"><h2>継続タスク設定</h2>${enabled?'':'<p class="note" role="status">自動生成は有効化待ちです。現在は設定の保存のみできます。</p>'}<p class="note">毎朝8:00（日本時間）にその日分を追加します。完了・未完了の履歴は残ります。登録済みのタスクは変更せず、編集内容は次回の生成から反映します。</p>${rows.length?rows.map(t=>`<div class="listrow"><div class="grow"><b>${esc(t.title)}</b><small>${t.enabled?'継続中':'停止中'} · ${esc(t.assignee||'担当未設定')} · 優先度 ${esc(t.priority)} · 開始 ${esc(t.startDate)}</small></div><button data-edit="recurringTasks:${esc(t.id)}">設定・停止</button></div>`).join(''):'<p>「タスクを追加」で「継続（毎日8時）」を選んで登録できます。</p>'}</section>`;
}
export function recurringTemplate(row,collection){
 return {id:row.id,title:row.title,priority:row.priority,notes:row.notes||'',collection,enabled:true,startDate:row.due,nextDate:row.due,assignee:row.assignee||'',relatedOrg:row.relatedOrg||'',relatedPlayer:row.relatedPlayer||'',relatedPost:row.relatedPost||'',nextAction:row.nextAction||''};
}
