const labels={staffTasks:'担当タスク',orgSales:'団体・OEM営業',collectionTasks:'収集するデータ'};
export function renderProactive(model,esc,teamState){
 if(!model)return '';
 const s=model.state,last=s.runs.at(-1);
 return `<section class="panel"><div class="panelhead"><h2>自動業務チェック</h2><span class="badge">${s.enabled?'稼働設定ON':'停止中'}</span></div>
 <p>ルール分析 · 外部操作は承認待ち</p><p class="note">モデル依頼：${s.modelQueue?'ON':'停止中'} ／ AI社員モデル運用：${teamState?.enabled?'ON':'停止中'} ／ Macランナーの稼働・利用枠：未確認。実行済みかは依頼と成果物で確認してください。</p>
 <p class="note">${s.enabled?'既存の22時の定期実行で、許可した保存データを確認します。':'開始とデータ別許可を保存するまで自動分析しません。'} 最終実行：${esc(last?.startedAt||'未実行')} ${esc(last?.status||'')}</p>
 <form id="proactive-settings"><label><input type="checkbox" name="enabled" ${s.enabled?'checked':''}>自動チェックを有効にする（OFFで停止）</label><div class="actions">${Object.entries(labels).map(([key,label])=>`<label><input type="checkbox" name="${key}" ${s.permissions[key]?'checked':''}>${label}を分析に利用</label>`).join('')}</div><label><input type="checkbox" name="modelQueue" ${s.modelQueue?'checked':''}>既存AI社員へ分析依頼を自動作成する</label><p class="note">モデル未実行。ONにするとMacランナー起動中に契約枠を使用します。利用枠・課金経路を本人が確認してから有効にしてください。</p><button class="secondary">設定を保存</button></form>
 <button id="proactive-run" class="primary" ${s.enabled?'':'disabled'}>保存データを今すぐ確認</button>
 <p class="note">未接続の売上・広告・在庫は分析対象外。30日を超えた記録・日時不明は除外します。提案は自動送信されません。</p>
 <details><summary>使い方・制限</summary><p>依頼入力なしで期限と状態を照合するルール分析です。Claude / Codexのモデル分析とは別で、追加のモデル呼び出しは行いません。モデル依頼ONの場合は匿名化した集計根拠を既存キューへ最大2件まで保存し、本人のMacランナーが実行・取込します。モデル出力は人間レビュー待ちです。正常終了は1日1回、失敗を含む試行は1日2回まで。同時実行は最大1件（上限2件以内）。担当タスクは下に独立保存し、元の業務データを上書きしません。履歴200回・タスク300件に達すると追加を停止します。</p></details>
 <h3>分析から生まれた担当タスク <small>${s.tasks.length}件</small></h3>
 ${s.tasks.length?s.tasks.slice().reverse().map(t=>`<article class="record"><div class="panelhead"><h3>${esc(t.title)}</h3><span class="badge">${esc(t.assignee)}</span></div><p>${esc(t.analysis)}</p><p>${esc(t.proposal)}</p>${t.modelJobId?`<p><a href="#team-job-${esc(t.modelJobId)}">モデル依頼・成果物を確認</a></p>`:''}<label>対応状態<select data-proactive-task="${esc(t.id)}">${['提案','進行中','完了','見送り'].map(v=>`<option ${v===t.status?'selected':''}>${v}</option>`).join('')}</select></label><details><summary>根拠・作成履歴</summary><p>${esc(labels[t.source])} / 記録ID ${esc(t.sourceId)} · 期限 ${esc(t.evidence.due)} · 記録更新 ${esc(t.evidence.updatedAt)} · 元の状態 ${esc(t.evidence.sourceStatus)}<br>作成 ${esc(t.createdAt)} · 最終編集 ${esc(t.editedAt||'なし')}</p><p class="note">作成時点の根拠です。対応前に元の記録を再確認してください。</p></details></article>`).join(''):'<p>提案はまだありません。未取得・許可なし・古い記録は下の実行履歴で確認できます。</p>'}
 <details><summary>実行履歴・データの鮮度</summary>${s.runs.slice().reverse().map(r=>`<article class="record"><p>${esc(r.startedAt)} · ${esc(r.status)} · 作成 ${esc(r.created??'未確定')}件</p><p>${esc(r.modelStatus||'モデル未実行')}</p>${r.error?`<p role="alert">${esc(r.error)}</p>`:''}${r.sources.map(x=>`<p>${esc(labels[x.source])}: ${esc(x.status)} / 件数 ${x.count===null?'未取得':esc(x.count)} / 除外 ${esc(x.stale??'—')}</p>`).join('')}</article>`).join('')}</details>
 ${last?.status==='failed'?`<p role="alert">直近の分析に失敗しました。${esc(last.error)}。自動再試行は1日2回までです。</p>`:''}
 </section>`;
}
export function bindProactive({model,api,update,toast}){
 if(!model)return;
 let busy=false;
 const send=async data=>{if(busy)return;busy=true;try{const next=await api('ai-proactive','POST',{...data,revision:model.revision});await update(next);if(next.skipped)toast(next.skipped);}catch(e){toast(e.message);try{await update(await api('ai-proactive'));}catch{} }finally{busy=false;}};
 const settings=document.querySelector('#proactive-settings');
 if(settings)settings.onsubmit=e=>{e.preventDefault();const f=new FormData(settings);send({action:'configure',enabled:f.has('enabled'),modelQueue:f.has('modelQueue'),permissions:Object.fromEntries(Object.keys(labels).map(k=>[k,f.has(k)]))});};
 const run=document.querySelector('#proactive-run');if(run)run.onclick=()=>send({action:'run'});
 document.querySelectorAll('[data-proactive-task]').forEach(el=>el.onchange=()=>send({action:'task',id:el.dataset.proactiveTask,status:el.value}));
}
