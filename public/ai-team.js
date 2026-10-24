import {renderProactive,bindProactive} from './proactive-staff.js';
import {parseTeamCSV} from './ai-csv.js';
const names={coo:'事業統括',market:'市場・顧客分析',marketing:'マーケティング',social:'SNS分析',creative:'クリエイティブ',ec:'EC最適化',profit_inventory:'利益・在庫',wholesale:'卸売・チーム営業',growth:'グロース検証'};
const states={awaiting_routing:'振り分け確認待ち',awaiting_permission:'送信承認待ち',queued:'実行待ち',running:'実行中',failed:'失敗',stopped:'停止',in_review:'人間レビュー待ち',completed:'成果物を採用',rejected:'差し戻し'};
export function renderTeam(model,esc){
 if(!model)return '<section class="panel"><p>AI社員を読み込んでいます。</p></section>';
 const {state,catalog}=model;
 return `${renderProactive(model.proactive,esc,state)}<section class="panel"><div class="panelhead"><h2>AI社員チーム</h2><button id="teamtoggle" class="${state.enabled?'secondary':'primary'}">${state.enabled?'手動運用を停止':'手動運用を開始'}</button></div><details><summary>モデル分析の使い方</summary><p>依頼の保存後、Mac上のAIランナーを起動していればClaude Codeが自動で分析し、成果物を管理アプリに取り込みます。ランナー停止中は「実行待ち」のまま残ります。</p><p class="note">現在：${state.enabled?'手動運用中':'停止中'} · 外部投稿・価格変更・発注・APIの自動実行は行いません。</p><p class="note">初回はMacのターミナルで <code>npm run ai:runner</code> を起動し、この管理アプリの本人ログイン情報を入力してください。ランナーはMac起動中のみ動作し、Claude Codeの既存契約を使います。タスクの投稿・DM送信・外部設定変更は行いません。</p><a href="/api/ai-team/export" download>依頼・成果物・レビュー履歴をバックアップ</a></details><p class="note">モデル分析はMacランナー起動中のみ。未実行の依頼を分析済みとして扱いません。</p></section>
 <section class="panel"><h2>依頼する</h2><form id="teamintake"><label>依頼名<input name="title" maxlength="120" required></label><label>依頼したい内容<textarea name="objective" maxlength="2000" required></textarea></label><p class="note">アプリ内のルールで主担当と協力担当を選びます。曖昧な場合は確認待ちになります。自由入力はClaudeへ送信しません。秘密値・連絡先は入力しないでください。</p><button class="primary">受け付けて振り分ける</button></form><details><summary>部署と使い方</summary>${catalog.map(r=>`<p><strong>${esc(names[r.id]||r.id)}</strong> · ${esc(r.mission)}</p>`).join('')}<p>自発的な分析依頼も下の一覧にまとまります。協力担当は相談先の表示で、別々のモデル呼び出しは行いません。</p></details></section>
 <section class="panel"><div class="panelhead"><h2>統一受付・依頼と成果物 <small>${state.jobs.length}件</small></h2><label class="secondary filelabel">成果物JSONを取り込む<input id="teamresult" type="file" accept="application/json,.json" class="sr-only" ${state.enabled?'':'disabled'}></label></div>
 <p class="note">本人登録JSON。生成元・内容の真正性はサーバー未検証です。</p>
 ${!state.jobs.length?'<p>依頼はまだありません。上の統一窓口から追加してください。</p>':state.jobs.slice().reverse().map(j=>`<article class="record" id="team-job-${esc(j.id)}"><div class="panelhead"><h3>${esc(j.title)}</h3><span class="badge">${esc(j.status==='running'&&Date.now()-Date.parse(j.run?.heartbeat_at)>90000?'通信途絶・状態未確認':states[j.status])}</span></div>${renderRouting(j,esc,catalog)}${renderRun(j,esc,state.enabled)}<p>${esc(j.intake&&!j.routing?.primary?'未分類':names[j.role])} · ${esc(new Date(j.created_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))} · 取込 ${j.attempts}/2回</p><p>${esc(j.objective)}</p><details><summary>入力した根拠を確認（${j.facts.length}件）</summary>${j.facts.length?j.facts.map(f=>`<p>${esc(f.label)}: ${f.value===null?'未取得':esc(f.value)} ${esc(f.unit)}<br>取得元: ${esc(f.source)}<br>${esc(new Date(f.observed_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))} · ${f.kind==='observed'?'本人確認済みの入力':'未検証の仮説'}</p>`).join(''):'<p>根拠の入力なし</p>'}</details>${['queued','rejected'].includes(j.status)&&j.attempts<2?`<button class="secondary" data-team-copy="${esc(j.id)}">Claude Codeへの依頼文をコピー</button><button class="secondary" data-team-export="${esc(j.id)}" ${state.enabled?'':'disabled'}>CLI実行用の依頼をダウンロード</button>`:''}${j.output?`<details><summary>成果物と根拠を確認</summary><pre class="teamoutput">${esc(JSON.stringify(j.output,null,2))}</pre><p class="note">構造検証は内容の正確性を保証しません。元データ・計算・代替仮説を確認してください。</p></details>`:''}${j.status==='in_review'?`<label>レビュー理由<textarea data-team-note="${esc(j.id)}" maxlength="1000"></textarea></label><div class="actions"><button class="primary" data-team-approve="${esc(j.id)}">成果物を採用</button><button class="secondary" data-team-reject="${esc(j.id)}">差し戻す</button></div><p class="note">採用は成果物の承認です。投稿・送信・価格変更の実行許可にはなりません。</p>`:''}${j.decision?`<p class="note">本人レビュー：${esc(j.decision.note)} · 効果は未測定</p>`:''}</article>`).join('')}</section>
 ${renderKnowledge(state,esc)}`;
}
export function renderRouting(j,esc,catalog){
 const r=j.routing,primary=r?.primary||(j.intake?null:j.role),support=r?.collaborators||[];
 return `<p>受付：${j.proactiveSource?'自動業務チェック':j.intake?'統一窓口':'既存依頼'} ／ 主担当：${esc(primary?names[primary]:'未分類')} ／ 協力：${esc(support.map(x=>names[x]).join('・')||'なし')}</p><p class="note">${j.intake?'受付済み → '+(primary?'振り分け済み → 外部送信の承認待ち':'振り分け確認待ち'):'実行待ち → 実行中 → 人間レビュー待ち → 採用／差し戻し'}</p>${j.intake?`<p class="note">自由入力の外部送信は未承認です。部署確定だけでは実行しません。</p><details><summary>振り分けの根拠・担当を確認</summary><p>${esc(r.reason)} · ルール版 ${r.version}</p><form data-intake-route="${esc(j.id)}"><label>主担当<select name="primary" required><option value="">選択してください</option>${catalog.map(x=>`<option value="${esc(x.id)}" ${primary===x.id?'selected':''}>${esc(names[x.id])}</option>`).join('')}</select></label><label>協力担当<select name="collaborators" multiple size="4">${catalog.map(x=>`<option value="${esc(x.id)}" ${support.includes(x.id)?'selected':''}>${esc(names[x.id])}</option>`).join('')}</select></label><button class="secondary">担当を確定（送信なし）</button></form></details>`:''}`;
}
export function renderRun(j,esc,enabled){
 if(!j.run)return j.intake?'':'<p class="note">ランナー稼働情報：未取得</p>';
 const reasons={model_failed:'モデル処理失敗',connection_lost:'通信断',stopped:'停止',import_failed:'成果物取込失敗'};
 const stale=Date.now()-Date.parse(j.run.heartbeat_at)>90000;
 return `<p>ランナー報告：${esc(j.run.heartbeat_at)} ／ 実行試行 ${j.run_attempts||0}/2回${j.status==='running'&&stale?' ／ 通信途絶・現在の稼働は未確認':''}${j.run.failure_reason?' ／ '+esc(reasons[j.run.failure_reason]||'不明'):''}</p>${enabled&&['running','failed','stopped','rejected'].includes(j.status)&&(j.run_attempts||0)<2&&Date.parse(j.run.lease_until)<=Date.now()?`<button class="secondary" data-team-retry="${esc(j.id)}">再実行を予約</button><p class="note">再実行は契約の利用枠を使います。前回の成果物を確認してから予約してください。</p>`:''}`;
}
// Read-only review history (adopted and rejected). No actions are offered here.
export function renderKnowledge(state,esc){
 const items=(state.knowledge||[]).slice(-50).reverse();
 const title=id=>state.jobs.find(j=>j.id===id)?.title||'削除済みの依頼';
 return `<section class="panel teamhistory"><h2>レビュー履歴 <small>${(state.knowledge||[]).length}件</small></h2><p class="note">採用・差し戻しの記録です。閲覧専用で、効果は未測定です。本人登録JSON。生成元・内容の真正性はサーバー未検証です。</p>${!items.length?'<p>レビュー履歴はまだありません。</p>':items.map(k=>`<article class="record"><div class="panelhead"><h3>${esc(title(k.job_id))}</h3><span class="badge">${k.decision?.action==='approve'?'採用':'差し戻し'}</span></div><p>${esc(new Date(k.recorded_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))} · 登録provider ${esc(k.execution?.provider||'')} · 登録実行ID ${esc(k.execution?.id||'')} · 入力 ${esc(String(k.input_hash||'').slice(0,12))}</p><p class="note">理由：${esc(k.decision?.note||'')}</p><details><summary>当時の成果物</summary><pre class="teamoutput">${esc(JSON.stringify(k.output,null,2))}</pre></details></article>`).join('')}</section>`;
}
export function bindTeam({model,api,setModel,render,toast}){
 if(!model)return;
 bindProactive({model:model.proactive,api,update:async()=>{model=await api('ai-team');setModel(model);render();},toast});
 const send=async command=>{const updated=await api('ai-team','POST',{revision:model.revision,command});setModel({...updated,proactive:model.proactive});render();return updated;};
 const intake=document.querySelector('#teamintake');let intakeBusy=false;
 if(intake)intake.onsubmit=async e=>{e.preventDefault();if(intakeBusy)return;intakeBusy=true;try{const f=Object.fromEntries(new FormData(intake));await send({action:'intake',job:{title:f.title,objective:f.objective}});}catch(e){toast(e.message);}finally{intakeBusy=false;}};
 document.querySelectorAll('[data-intake-route]').forEach(form=>{let busy=false;form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;try{const f=new FormData(form);await send({action:'route',job_id:form.dataset.intakeRoute,primary:f.get('primary'),collaborators:f.getAll('collaborators')});}catch(e){toast(e.message);}finally{busy=false;}};});
 document.querySelectorAll('[data-team-retry]').forEach(b=>b.onclick=async()=>{try{await send({action:'retry',job_id:b.dataset.teamRetry});}catch(e){toast(e.message);}});
 const toggle=document.querySelector('#teamtoggle');if(toggle)toggle.onclick=async()=>{try{await send({action:'toggle',enabled:!model.state.enabled});}catch(e){toast(e.message);}};
 document.querySelectorAll('[data-team-role]').forEach(b=>b.onclick=()=>{document.querySelector('#teamcreate select').value=b.dataset.teamRole;document.querySelector('#teamcreate').scrollIntoView({behavior:'smooth'});});
 const create=document.querySelector('#teamcreate');if(create)create.onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(create));if(f.fact.trim()&&!f.source.trim()){toast('数値や事実を入力する場合は取得元・確認方法も入力してください。');return;}const facts=f.fact.trim()?[{id:'f1',label:'本人が確認したデータ',value:f.fact,unit:'text',source:f.source,observed_at:f.date+'T00:00:00+09:00',kind:'observed'}]:[];try{if(f.evidence_csv?.size){if(f.evidence_csv.size>100000)throw Error('CSVは100KB以内にしてください');facts.push(...parseTeamCSV(await f.evidence_csv.text()));}let revision=model.revision;
 if(!model.state.enabled){
   const started=await api('ai-team','POST',{revision,command:{action:'toggle',enabled:true}});
   // setModel()はアプリ全体のstateを更新するが、この関数の外側（bindTeamの引数）で束縛された
   // modelはそれだけでは更新されない。直後のcreate呼び出しが失敗すると（例: objectiveにメール
   // アドレスが含まれる等のバリデーション）、render()が呼ばれず再描画・再bindもされないため、
   // トグルボタンや次回の依頼保存など、このbindTeam呼び出し内の全ての処理が古いrevisionを
   // 使い続け、修正して再送してもrevision不一致で失敗し続ける（Codex独立レビュー指摘）。
   // ここでmodel自体を更新することで、以後のすべての参照箇所（send()・toggleボタン等）が
   // 最新のrevision・stateを見るようにする。
   started.proactive=model.proactive;model=started;setModel(started);revision=started.revision;
 }
 const updated=await api('ai-team','POST',{revision,command:{action:'create',job:{role:f.role,title:f.title,objective:f.objective,facts}}});
 setModel({...updated,proactive:model.proactive});render();
 toast('依頼を保存しました。MacのAIランナーが起動中なら自動的に分析されます。停止中は実行待ちです。');}catch(e){toast(e.message);}};

 document.querySelectorAll('[data-team-copy]').forEach(b=>b.onclick=async()=>{
  const job=model.state.jobs.find(x=>x.id===b.dataset.teamCopy);
  if(!job)return;
  const role=names[job.role]||job.role;
  const facts=job.facts.map(f=>f.label+': '+(f.value===null?'未取得':String(f.value))+'（出典: '+f.source+'）').join('\n')||'記載なし';
  const prompt=['SICKSTYLEのAI社員「'+role+'」として、以下の依頼を分析してください。',
   '依頼名: '+job.title,'目的: '+job.objective,'確認済み・入力された根拠:',facts,
   '事実・仮説・未取得を区別し、優先アクション・検証KPI・リスクと必要な確認事項を示してください。',
   '未確認の数値を捏造しないでください。外部投稿・送信・発注・設定変更は行わないでください。',
   'これは手動でClaude Codeに渡す依頼文です。分析結果は管理アプリに自動反映されません。'].join('\n');
  try{await navigator.clipboard.writeText(prompt);toast('Claude Codeへの依頼文をコピーしました。Claude Codeに貼り付けてください。');}
  catch{toast('コピーできません。クリップボードの権限を確認してください。');}
 });
 document.querySelectorAll('[data-team-export]').forEach(b=>b.onclick=async()=>{try{const p=await api('ai-team/task?job_id='+encodeURIComponent(b.dataset.teamExport));const url=URL.createObjectURL(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='sickstyle-task-'+p.job_id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){toast(e.message);}});
 const file=document.querySelector('#teamresult');if(file)file.onchange=async()=>{const f=file.files[0];if(!f)return;try{if(f.size>150000)throw Error('成果物は150KB以内にしてください');const packet=JSON.parse(await f.text());await send({action:'import',job_id:packet.job_id,packet});toast('成果物を保存しました。人間レビュー待ちです。');}catch(e){toast(e.message);file.value='';}};
 for(const [selector,action]of [['[data-team-approve]','approve'],['[data-team-reject]','reject']])document.querySelectorAll(selector).forEach(b=>b.onclick=async()=>{const id=b.dataset[action==='approve'?'teamApprove':'teamReject'];const note=document.querySelector(`[data-team-note="${id}"]`).value;try{await send({action,job_id:id,note});}catch(e){toast(e.message);}});
}
