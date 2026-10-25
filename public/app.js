import {createOverdueMonitor,overdueSummary,renderOverdue} from './overdue.js';
import {reconcileAds} from './ads-reconcile.js';
let adsStatus=null;
import {renderMeetings,renderMeetingEditor,meetingFormChanged,saveMeetingFields} from './meetings.js';
import {hasOutstandingMeetings} from './org-meeting-lifecycle.js';
import {confirmMeetingPlan} from './meeting-confirmation-ui.js';
import {renderTeam,bindTeam} from './ai-team.js';
import {mountNotifications} from './notifications.js';
let team=null;
import {connectionReadiness,selectAmazonSales,syncMessage,amazonOpenOrders} from './integration-status.js';
import {validateFinanceReport,renderFinance} from './finance.js';
let financeReport=null;
import {renderStaffTasks,staffTaskFields} from './staff-tasks.js';
let staffUI={assignee:'all',sort:'due'};
import {renderOrgList,renderOrgKPI,renderOrgEditor,computeOrgKPI,newOrg,ORG_ALL_STAGES,ORG_STAFF} from './org-sales.js';
let orgUI={stage:'all',assignee:'all'},orgTab='list',orgKPIPeriod={start:'',end:''};
import {renderCollectionTasks,allStandardItems,CATEGORIES as COLLECT_CATEGORIES,STATUS as COLLECT_STATUS,STAFF as COLLECT_STAFF} from './collection-tasks.js';
let collectUI={category:'all',status:'all'};
import {renderReels,reelFields,PLATFORMS as REEL_PLATFORMS,FORMATS as REEL_FORMATS} from './reels.js';
let reelUI={platform:'all',format:'all'};
import {renderExperiments,experimentFields,STATUS as EXPERIMENT_STATUS} from './experiments.js';
let experimentUI={status:'all'};
import {renderAccounts,accountFields,PLATFORMS as ACCOUNT_PLATFORMS} from './accounts.js';
let accountUI={platform:'all'};
import {renderPlayers,playerFields,LEAGUES as PLAYER_LEAGUES,TIERS as PLAYER_TIERS} from './players.js';
import {RESEARCHED_PLAYERS,toCandidate} from './player-research.js';
let playerUI={league:'all',tier:'all'};
import {mergeDailyHistory,daysInMonth,monthlyTotals,recentMonths,addMonths,sourceLabel,dailyRowsForMonth,fullMonthRows,monthSalesInfo,todaySalesInfo,priorPeriodSales,adRoas,adAcos} from './amazon-periods.js';
let amzUI={chartMode:'daily',month:''},adUI={platform:'all'};
// SICKSTYLE 管理アプリ（単一管理者）。業務データはサーバーDBに保存し、ブラウザーには保存しません。
const app=document.querySelector('#app');
let state=null,section='overview',configured=false,busy=false,setupAllowed=false,storageKind='',hosted=false,ig=null,amz=null,conversations=[],zoomStatus=null,calendarStatus=null;
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});const month=()=>today().slice(0,7);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=v=>'¥'+Math.round(Number(v||0)).toLocaleString('ja-JP');
const num=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ja-JP'):'未取得';
const fmtTime=v=>v?esc(new Date(v).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})):'未取得';
const LOGO='<img src="/logo-mark.png" alt="" width="506" height="335">';
async function api(url,method='GET',data,signal){const r=await fetch('/api/'+url,{signal,method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,credentials:'same-origin'});let b={};try{b=await r.json();}catch{}if(!r.ok){if(r.status===401){state=null;ig=null;amz=null;auth();}const e=Error(b.error||('通信エラー ('+r.status+')'));e.body=b;throw e;}return b;}
let toastTimer;function toast(s){const t=document.querySelector('#toast');t.textContent=s;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.textContent='',4500);}
const overdue=createOverdueMonitor({fetchData:()=>api('data','GET',undefined,AbortSignal.timeout(15000)),changed:updateOverdue});
let overdueSource=null,overdueOpenRequest=0;
function updateOverdue(){
 const dateLabel=document.querySelector('.pageheading .date');if(dateLabel)dateLabel.textContent=today().replaceAll('-',' / ');
 const snapshot=overdue.snapshot();
 document.querySelectorAll('[data-overdue-summary]').forEach(el=>el.textContent=overdueSummary(snapshot));
 const panel=document.querySelector('#overdue-content');
 if(!panel)return;
 const focus=document.activeElement;
 const attribute=['data-overdue-retry','data-overdue-read','data-overdue-target'].find(a=>focus?.hasAttribute(a));
 const value=attribute?focus.getAttribute(attribute):null;
 panel.innerHTML=renderOverdue(snapshot,esc);
 panel.querySelector('[data-overdue-retry]').onclick=()=>overdue.refresh();
 const read=panel.querySelector('[data-overdue-read]');if(read)read.onclick=()=>overdue.read();
 panel.querySelectorAll('[data-overdue-target]').forEach(b=>b.onclick=async()=>{
  const [key,id]=JSON.parse(b.dataset.overdueTarget);b.disabled=true;
  const source=state,request=++overdueOpenRequest;
  const current=()=>state===source&&section==='overdue'&&document.contains(panel)&&request===overdueOpenRequest;
  try{const latest=await api('data','GET',undefined,AbortSignal.timeout(15000));
   // A response must not reopen business data after logout or replace another screen/editor.
   if(!current())return;
   state=latest;section=key;render();const item=state[key].find(x=>x.id===id&&!x.deletedAt);if(item)editor(key,item);else toast('対象は削除されています');}
  catch(e){if(current()){toast(e.message);b.disabled=false;}}
 });
 if(attribute){const next=[...panel.querySelectorAll('['+attribute+']')].find(el=>el.getAttribute(attribute)===value);if(next&&!next.disabled)next.focus();else panel.querySelector('[data-overdue-retry]')?.focus();}
}
setInterval(()=>{if(state&&!document.hidden)overdue.refresh();},60000);
document.addEventListener('visibilitychange',()=>{if(state&&!document.hidden)overdue.refresh();});
window.addEventListener('focus',()=>{if(state)overdue.refresh();});
async function load(){
 const s=await api('session');configured=s.configured;setupAllowed=s.setupAllowed;storageKind=s.storage;hosted=s.hosted;
 if(!s.authenticated)return auth();
 [state,ig,amz,zoomStatus,calendarStatus]=await Promise.all([api('data'),api('instagram/status'),api('amazon/status'),api('zoom/status'),api('googlecalendar/status')]);
 adsStatus=await api('amazonads/status');conversations=(await api('instagram/conversations')).data;if(section==='team')team=await api('ai-team');site=null;if(section==='site')site=await api('site');render();
 const q=new URLSearchParams(location.search);
 if(q.has('notifications')){section='settings';render();}
 if(q.has('instagram')){section='instagram';render();toast(q.get('instagram')==='connected'?'Instagramの認可が完了しました。「今すぐ同期」で読み取りを検証してください。':'Instagramの認可を完了できませんでした。設定・権限を確認して再接続してください。');}
 if(q.has('amazon')){section='amazon';render();toast(q.get('amazon')==='connected'?'Amazonの認可が完了しました。「今すぐ同期」でデータを取得してください。':'Amazonの認可を完了できませんでした。アプリ設定・リダイレクトURIを確認してください。');}
 if(q.has('zoom')){section='settings';render();const zStage=q.get('zoom_stage'),zCode=q.get('zoom_code');const diag=zStage&&/^[a-z_]{1,30}$/.test(zStage)&&zCode&&/^[a-zA-Z0-9_-]{1,40}$/.test(zCode)?'（'+zStage+' / '+zCode+'）':'';toast(q.get('zoom')==='connected'?'Zoomの認可が完了しました。会議タブからMTGを作成できます。':'Zoomの認可未完了'+diag+'。設定を確認してください。');}
 if(q.has('googlecalendar')){section='settings';render();toast(q.get('googlecalendar')==='connected'?'Googleカレンダーの認可が完了しました。':'Googleカレンダーの認可を完了できませんでした。アプリ設定・リダイレクトURIを確認してください。');}
 if(q.size)history.replaceState(null,'','/');
}
// ---------- 認証 ----------
function setupGuide(){
 const isLocal=['localhost','127.0.0.1'].includes(location.hostname);
 if(isLocal)return `<div class="guide"><b>このPCで管理者を作成する（キー入力は不要）</b><ol><li>Mac の「ターミナル」アプリを開きます。</li><li><code>cd ~/Sites/SICK-STYEL</code> を実行します。</li><li><code>npm run admin:create</code> を実行し、表示に従ってメールアドレスとパスワード（このアプリ専用）を入力します。パスワードは画面に表示されません。</li><li>「管理者を作成しました」と表示されたら、この画面を再読み込みしてログインします。</li></ol></div>`;
 return `<div class="guide"><b>公開版の最初の管理者は、PCのターミナルで作成します</b><ol><li>Cloudflareにログイン済みのMacで「ターミナル」を開きます。</li><li><code>cd ~/Sites/SICK-STYEL</code> を実行します。</li><li><code>npm run admin:create:remote</code> を実行し、メールアドレスとパスワード（このアプリ専用）を入力します。</li><li>完了後、この画面を再読み込みしてログインします。</li></ol><p class="note">Web上の新規登録は、第三者による乗っ取りを防ぐため公開していません。</p></div>`;
}
function auth(){
 overdueSource=null;overdue.clear();
 team=null;
 financeReport=null;
 const setupForm=!configured&&setupAllowed;const showForm=configured||setupForm;
 app.innerHTML=`<main class="auth"><img class="authlogo" src="/logo-mark.png" alt="SICKSTYLE" width="506" height="335"><div class="authname">SICKSTYLE</div><div class="authbox">
 <h1>${configured?'ログイン':'管理者の初期設定'}</h1>
 <p>${configured?'管理者のメールアドレスと、このアプリ用のパスワードを入力してください。':setupForm?'最初の管理者アカウントを作成します。作成後、この登録画面は自動的に閉じます。':'管理者がまだ登録されていません。'}</p>
 ${showForm?`<form id="auth">${setupForm?`<label>初期設定キー<span class="hint">このアプリの最初の登録だけに使う専用キーです。Instagram・Amazon・メールのパスワードではありません。サーバーに設定した値を、本人が保管場所から入力してください。</span><input name="setupToken" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore required></label>`:''}
 <label>メールアドレス<input name="email" type="email" inputmode="email" autocomplete="username" required></label>
 <label>パスワード${setupForm?'<span class="hint">このアプリ専用のものを12文字以上で決めてください。</span>':''}<input name="password" type="password" minlength="12" maxlength="256" autocomplete="${configured?'current-password':'new-password'}" required></label>
 <button class="primary">${configured?'ログイン':'管理者アカウントを作成'}</button><p id="autherror" role="alert"></p></form>`:''}
 ${!configured?(setupForm?`<details><summary>初期設定キーがわからない場合</summary>${setupGuide()}</details>`:setupGuide()):''}
 </div><small>SICKSTYLE 管理アプリ · <a href="/privacy.html">プライバシー</a></small></main>`;
 const f=document.querySelector('#auth');if(f)f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('button');btn.disabled=true;document.querySelector('#autherror').textContent='';try{await api(configured?'login':'setup','POST',Object.fromEntries(new FormData(f)));await load();}catch(err){const t=document.querySelector('#autherror');if(t)t.textContent=err.message;}finally{btn.disabled=false;}};
}
// ---------- 画面 ----------
// 団体営業・集める数字・購入実験・選手候補・利益在庫はメニューから削除（データ・コードは保持、いつでも復元可能）。
// リール分析・参考アカウント・売上SNS実績（SNS側）はInstagram画面へ、売上SNS実績（Amazon側）・利益在庫の広告費のみAmazon画面へ統合。
const nav=[['overview','◈','ダッシュボード'],['goals','◎','目標'],['tasks','☑','タスク'],['staffTasks','▤','担当タスク'],['shipments','▣','発送管理'],['team','♙','AI社員'],['meetings','▦','会議'],['amazon','◆','Amazon連携'],['instagram','◉','Instagram連携'],['site','◇','サイト掲載'],['brand','✳','ブランド'],['settings','⚙','設定・バックアップ']];
const names={...Object.fromEntries(nav.map(([id,,name])=>[id,name])),orgSales:'団体営業・会議',overdue:'期限超過の通知'};
const rate=g=>Math.min(100,Math.max(0,Math.round(Number(g.current||0)/Number(g.target||1)*100)));
function render(){
 if(state!==overdueSource){overdueSource=state;overdue.set(state);}
 const previousNav=document.querySelector('#app aside nav');
 const navScrollTop=previousNav?.scrollTop||0,navScrollLeft=previousNav?.scrollLeft||0;
 const views={overdue:()=>'<div id="overdue-content"></div>',team:()=>renderTeam(team,esc),finance:()=>renderFinance(financeReport,esc),overview,instagram:instagramView,amazon:amazonView,brand,settings,site:siteView,staffTasks:()=>renderStaffTasks(state.staffTasks,staffUI,esc,today()),meetings:()=>renderMeetings(state.orgSales,esc),orgSales:orgSalesView,collectionTasks:()=>renderCollectionTasks(state.collectionTasks,collectUI,esc),
 reelPosts:()=>renderReels(state.reelPosts,reelUI,esc,today()),growthExperiments:()=>renderExperiments(state.growthExperiments,experimentUI,esc),competitorAccounts:()=>renderAccounts(state.competitorAccounts,accountUI,esc),playerCandidates:()=>renderPlayers(state.playerCandidates,playerUI,esc)};
 app.innerHTML=`<aside><div class="brandtop"><a href="#" class="brandmark" data-nav="overview">${LOGO}<span><b>SICKSTYLE</b><small>管理アプリ</small></span></a><span class="mobileonly"><button id="mrefresh" aria-label="最新データに更新">↻</button><button id="mlogout" aria-label="ログアウト">ログアウト</button></span></div><nav aria-label="メニュー">${nav.map(([id,icon,name])=>`<button data-nav="${id}" class="${section===id?'active':''}" ${section===id?'aria-current="page"':''}><span aria-hidden="true">${icon}</span>${name}</button>`).join('')}</nav><div class="sidebottom"><div>管理者<small>${esc(storageKind==='d1'?'クラウド保存（Cloudflare D1）':'このPCに保存（SQLite）')}</small></div><button id="logout">ログアウト</button></div></aside>
 <main><header><div class="breadcrumb">SICKSTYLE<span>/ ${names[section]}</span></div><div class="headeractions"><span class="live">保存先: ${storageKind==='d1'?'クラウド':'このPC'}</span><button id="refresh" aria-label="最新データに更新" title="最新データに更新">↻ 更新</button></div></header>
 <div class="content"><div class="overdue-entry"><button data-nav="overdue" aria-label="期限超過の通知を開く"><span aria-hidden="true">!</span> <span data-overdue-summary></span></button></div><div class="pageheading"><div><h1>${names[section]}</h1></div><span class="date">${today().replaceAll('-',' / ')}</span></div>${(views[section]||(()=>collection(section)))()}</div>
 <footer><span>SICKSTYLE 管理アプリ</span><a href="/privacy.html">プライバシー</a></footer></main><dialog id="editor"></dialog>`;
 bind();updateOverdue();
 const currentNav=document.querySelector('#app aside nav');
 if(currentNav){currentNav.scrollTop=navScrollTop;currentNav.scrollLeft=navScrollLeft;}
}
function sourceTag(api){return `<span class="source ${api?'api':''}">${api?'公式API':'手入力'}</span>`;}
function overview(){
 const t=today();const overdue=state.tasks.filter(x=>!x.done&&x.due<t).length;
 const selectedSales=selectAmazonSales(amz,state.metrics,month());const amzMonth=selectedSales.source==='api';
 const pending=state.shipments.filter(s=>!['発送済み','配達完了'].includes(s.status));const done=state.tasks.filter(x=>x.done).length;
 const latest=[...state.metrics].filter(m=>m.instagramEntered!==false).sort((a,b)=>b.date.localeCompare(a.date))[0];
 const igApi=ig?.connected&&typeof ig.cache?.followers==='number';
 const amzOpen=amazonOpenOrders(amz);
 return `<div class="stats">
 <article><small>今月のAmazon売上</small><strong>${selectedSales.value===null?'未取得':yen(selectedSales.value)}</strong><span>${amzMonth?'売上の最終成功 '+fmtTime(selectedSales.syncedAt)+(selectedSales.stale?'（最新取得は失敗）':''):selectedSales.source==='manual'?'手入力・CSVのみ（API値と合算しません）':'売上の記録は未取得'}</span>${sourceTag(amzMonth)}</article>
 <article><small>タスク完了</small><strong>${done}<em> / ${state.tasks.length}</em></strong><span>${overdue?'期限超過 '+overdue+' 件':'期限超過なし'}</span></article>
 <article><small>発送待ち（アプリ登録分）</small><strong>${pending.length}<em> 件</em></strong><span>${pending.filter(s=>s.due<t).length} 件が期限超過${amzOpen!==null?` · Amazon未発送 ${amzOpen} 件`:amz?.connected?' · Amazon未発送 未取得':''}</span></article>
 <article><small>Instagramフォロワー</small><strong>${igApi?num(ig.cache.followers):latest?Number(latest.followers).toLocaleString('ja-JP'):'—'}</strong><span>${igApi?(typeof ig.cache.delta==='number'?`前回記録比 ${ig.cache.delta>0?'+':''}${ig.cache.delta.toLocaleString('ja-JP')}`:'増減は次回以降の同期で表示'):latest?latest.date+' の記録':'未記録'}</span>${sourceTag(igApi)}</article></div>
 <div class="dashboardgrid"><section class="panel"><div class="panelhead"><h2>目標 <small>GOALS</small></h2><button data-nav="goals">すべて見る</button></div>${state.goals.length?state.goals.slice(0,3).map(g=>`<div class="goal"><div><span class="badge">${esc(g.type==='final'?'最終目標':g.month||'月間目標')}</span><b>${esc(g.title)}</b><strong>${rate(g)}%</strong></div><progress max="100" value="${rate(g)}" aria-label="達成率"></progress><small>${Number(g.current).toLocaleString('ja-JP')} / ${Number(g.target).toLocaleString('ja-JP')} ${esc(g.unit)}</small></div>`).join(''):empty('目標は未登録です。','月間目標・最終目標を登録できます。','goals')}</section>
 <section class="identity">${LOGO}<h2>ブランドの Mission</h2>${state.brand.Mission?`<p class="statement">${esc(state.brand.Mission)}</p>`:'<p class="placeholder">未入力です。「ブランド」画面で、ご自身の言葉で登録できます。</p>'}<button data-nav="brand">ブランド画面へ</button></section>
 <section class="panel"><div class="panelhead"><h2>今日までのタスク <small>TASKS</small></h2><button data-nav="tasks">タスク管理</button></div>${state.tasks.filter(x=>!x.done&&x.due<=t).length?state.tasks.filter(x=>!x.done&&x.due<=t).slice(0,5).map(taskrow).join(''):empty('期限が今日までの未完了タスクはありません。','タスクを登録できます。','tasks')}</section>
 <section class="panel"><div class="panelhead"><h2>発送待ち <small>SHIPPING</small></h2><button data-nav="shipments">発送管理</button></div>${pending.length?pending.slice(0,4).map(s=>`<div class="listrow"><div class="parcel" aria-hidden="true">▣</div><div class="grow"><b>${esc(s.title)}</b><small>期限 ${esc(s.due)} · ${esc(s.status)}</small></div><span class="badge ${s.due<t?'danger':''}">${s.due<t?'期限超過':'発送待ち'}</span></div>`).join(''):empty('発送待ちはありません。','発送する注文を登録できます。','shipments')}</section></div>`;
}
function empty(title,sub,target){return `<div class="empty"><div aria-hidden="true">＋</div><b>${title}</b><p>${sub}</p>${target?`<button class="secondary" data-new="${target}">追加する</button>`:''}</div>`;}
const configs={goals:{title:'目標',fields:[['title','目標名','text'],['type','種類','select',['monthly','final'],['月間目標','最終目標']],['month','対象月','month'],['target','目標値','number'],['current','現在値','number'],['unit','単位（例: 円・件・人）','text']]},tasks:{title:'タスク',fields:[['title','タスク名','text'],['due','期限','date'],['priority','優先度','select',['高','中','低']],['notes','メモ','textarea']]},shipments:{title:'発送',fields:[['title','商品・注文名','text'],['order','注文番号','text'],['recipient','宛先・お客様名','text'],['due','発送期限','date'],['carrier','配送会社','text'],['tracking','追跡番号','text'],['status','発送状況','select',['未発送','準備中','発送済み','配達完了']],['notes','メモ','textarea']]},metrics:{title:'実績',fields:[['date','記録日','date'],['sales','Amazon売上（円）','number'],['orders','Amazon注文件数','number'],['followers','Instagramフォロワー数','number'],['reach','Instagramリーチ数','number'],['engagement','Instagram反応数（いいね・コメント等）','number'],['notes','メモ','textarea']]},staffTasks:{title:'担当タスク',fields:staffTaskFields},collectionTasks:{title:'収集項目',fields:[['title','項目名','text'],['category','カテゴリ','select',COLLECT_CATEGORIES],['purpose','判断に使う目的','text'],['source','出典・どこから集めるか','text'],['frequency','更新頻度','text'],['assignee','担当','select',['',...COLLECT_STAFF],['未設定',...COLLECT_STAFF]],['due','期限（任意）','date'],['period','対象期間','text'],['status','状態','select',COLLECT_STATUS],['value','収集した値・メモ','textarea'],['notes','メモ','textarea']]},
reelPosts:{title:'リール投稿',fields:reelFields},growthExperiments:{title:'購入実験',fields:experimentFields},competitorAccounts:{title:'参考アカウント観測',fields:accountFields},playerCandidates:{title:'選手候補',fields:playerFields},
adMetrics:{title:'広告実績',fields:[['platform','媒体','select',['Amazon','Instagram']],['periodStart','対象期間（開始）','date',undefined,undefined,true],['periodEnd','対象期間（終了）','date',undefined,undefined,true],['attributionWindowDays','アトリビューション期間（日・任意。例: 14）','nnumber'],['adCost','広告費（円・任意）','nnumber'],['attributedSales','広告経由売上（円・任意。未入力ならROAS/ACOSは計算不可）','nnumber'],['source','取得方法','select',['manual','csv'],['手入力','CSV取込']],['campaign','キャンペーン名・メモ','text']]}};
function orgSalesView(){
 return `<div class="actions" role="tablist"><button class="${orgTab==='list'?'primary':'secondary'}" data-orgtab="list">団体一覧</button><button class="${orgTab==='kpi'?'primary':'secondary'}" data-orgtab="kpi">KPI・転換率</button></div>
 ${orgTab==='list'?renderOrgList(state.orgSales,orgUI,esc,today()):renderOrgKPI(state.orgSales,orgKPIPeriod,esc)}`;
}
function taskrow(x){const t=today();return `<div class="listrow"><input aria-label="${esc(x.title)}を完了にする" type="checkbox" data-check="${esc(x.id)}" ${x.done?'checked':''}><div class="grow ${x.done?'done':''}"><b>${esc(x.title)}</b><small class="${!x.done&&x.due<t?'red':''}">${esc(x.due)}${!x.done&&x.due<t?' · 期限超過':''}</small></div><span class="badge ${x.priority==='高'?'danger':''}">${esc(x.priority)}</span><button data-edit="tasks:${esc(x.id)}">編集</button></div>`;}
function collection(key){const c=configs[key];const t=today();let rows=[...state[key]];if(key==='tasks')rows.sort((a,b)=>Number(a.done)-Number(b.done)||a.due.localeCompare(b.due));if(key==='metrics')rows.sort((a,b)=>b.date.localeCompare(a.date));
 return `<section class="panel"><div class="panelhead"><h2>${c.title}一覧 <small>${rows.length} 件</small></h2><div class="actions">${key==='metrics'?'<button class="secondary" id="csvopen">CSVから取り込む</button>':''}<button class="primary" data-new="${key}">＋ ${c.title}を追加</button></div></div>${key==='metrics'?'<details><summary>使い方・詳細</summary><p class="note">同じ日の記録は1件にまとめます。売上・注文は日次の値、フォロワー数は当日時点の値です。Amazon公式APIの値は「Amazon連携」画面に別に表示します。</p></details>':''}
 ${rows.length?`<div class="records">${rows.map(r=>key==='tasks'?taskrow(r):`<article class="record"><div class="recordtop"><span class="badge">${esc(key==='goals'?(r.type==='final'?'最終目標':r.month):key==='shipments'?r.status:r.date)}</span><button data-edit="${key}:${esc(r.id)}">編集</button></div><h3>${esc(r.title||r.date)}</h3>${key==='goals'?`<div class="goalnumber">${rate(r)}<small>%</small></div><progress max="100" value="${rate(r)}" aria-label="達成率"></progress><p>${esc(r.current)} / ${esc(r.target)} ${esc(r.unit)}</p>`:key==='shipments'?`<p class="${r.due<t&&!['発送済み','配達完了'].includes(r.status)?'red':''}">発送期限：${esc(r.due)}</p><p>注文番号：${esc(r.order||'—')}<br>宛先：${esc(r.recipient||'—')}<br>配送会社：${esc(r.carrier||'—')}<br>追跡番号：${esc(r.tracking||'未登録')}</p>`:`<div class="goalnumber">${yen(r.sales)}</div><p>注文 ${esc(r.orders)} 件${r.source==='csv'?' · CSV取込':''}</p>${r.instagramEntered===false?'<p class="note">Instagram指標は未入力</p>':`<div class="metricmini"><span>フォロワー <b>${esc(r.followers)}</b></span><span>リーチ <b>${esc(r.reach)}</b></span><span>反応 <b>${esc(r.engagement)}</b></span></div>`}`}${r.notes?`<p class="note">${esc(r.notes)}</p>`:''}</article>`).join('')}</div>`:empty(`${c.title}はまだありません。`,'登録したデータはサーバーに保存され、他の端末からも見られます。',key)}</section>`;}
function brand(){const labels=['大切にする考え','はじまり','果たしたいこと','目指す姿','行動の指針'];return `<form id="brand" class="panel brandform"><div class="panelhead"><h2>ブランドの原点 <small>IDENTITY</small></h2><button class="primary">保存する</button></div><details><summary>使い方・詳細</summary><p class="note">ご自身の言葉で入力してください。未入力の項目はダッシュボードにも表示されません。</p></details>${['理念','起源','Mission','Vision','Values'].map((k,i)=>`<label><span class="fieldnum">0${i+1}</span><span>${k}<small>${labels[i]}</small></span><textarea name="${k}" rows="3" maxlength="10000">${esc(state.brand[k])}</textarea></label>`).join('')}</form>`;}
function statusBadge(s){if(!s)return '<span class="badge">確認中</span>';const r=s.readiness||connectionReadiness(s,s.apiVersion?'instagram':'amazon');return `<span class="badge ${r.state==='connected'?'ok':'warn'}" title="${esc(r.detail)}">${esc(r.label)}</span>`;}
function zoomCalendarBadge(s){if(!s)return '<span class="badge">確認中</span>';if(!s.configured)return '<span class="badge warn">アプリ設定待ち</span>';return `<span class="badge ${s.connected?'ok':'warn'}">${s.connected?'接続済み':'本人認可待ち'}</span>`;}
function settings(){return `<div class="settingsgrid"><section class="panel"><h2>バックアップ</h2><p>保存済みの業務データをJSONファイルでダウンロードします。パスワード・連携トークンは含まれません。</p><a class="primary" href="/api/backup" download>バックアップをダウンロード</a><hr><h2>バックアップから復元</h2><p>現在の業務データを置き換えます。復元前にバックアップをダウンロードしてください。</p><label class="filelabel">JSONファイルを選択<input type="file" id="restore" accept="application/json,.json"></label></section>
 <section class="panel"><h2>外部サービス連携</h2><p>どちらも認可前から手入力（AmazonはCSVも可）で利用できます。</p><div class="integration"><b>Amazon Selling Partner API</b>${statusBadge(amz)}<p>${amz?.connected?'最終同期: '+fmtTime(amz.cache?.syncedAt):'公式の認可が完了するまでは手入力・CSVの値を使います。'}</p><button data-nav="amazon" class="secondary">Amazon連携を開く</button></div><div class="integration"><b>Instagram API</b>${statusBadge(ig)}<p>${ig?.connected?'最終同期: '+fmtTime(ig.cache?.syncedAt):'公式の認可が完了するまでは手入力の値を使います。'}</p><button data-nav="instagram" class="secondary">Instagram連携を開く</button></div><hr><h2>スマートフォンのホーム画面に追加</h2><p>iPhone: Safariの共有ボタン →「ホーム画面に追加」。Android: Chromeのメニュー →「ホーム画面に追加」。オフラインでは業務データを表示しません。</p></section>
 <section class="panel"><h2>通知センター（PC・iPhone）</h2><div id="notification-panel"><p>通知を読み込み中…</p></div></section>
 <section class="panel"><h2>Zoom × Googleカレンダー連携（団体営業のMTG自動作成）</h2><button class="primary" data-nav="meetings">会議を開く</button><details><summary>使い方・詳細</summary><p>団体営業で内容・日時を保存し、Zoomを作成します。発行されたURL・主催者・ゲストを確認してからカレンダー登録・招待を実行します。ChatGPT側の接続とは別の認可です。</p></details>
 <div class="integration"><b>Zoom</b>${zoomCalendarBadge(zoomStatus)}<p>${zoomStatus?.connected?'接続アカウント: '+esc(zoomStatus.email||'—'):'本人のZoomアカウントで認可してください（ミーティング作成・変更・削除の最小権限のみ）。'}</p>${zoomStatus?.connected?`<p class="note">許可された権限: ${esc((zoomStatus.scopes||[]).join(', ')||'（スコープ情報なし）')}</p>`:''}
 <details class="guide" ${!zoomStatus?.configured?'open':''}><summary><b>Zoomアプリ登録の手順</b></summary><ol>
 <li><a href="https://marketplace.zoom.us/" target="_blank" rel="noopener noreferrer">Zoom App Marketplace ↗</a>で本人のZoomアカウントにログインし、「Develop」→「Build App」からOAuthアプリを作成します（Server-to-Server OAuthではなく、ユーザー認可が必要なタイプを選びます）。</li>
 <li>OAuthのRedirect URL（コールバック）に <code>https://sickstyle-manager.sickstyle-74h4.workers.dev/api/zoom/callback</code> を登録します。</li>
 <li>Scopes（権限）タブで、会議の作成・更新・削除とユーザー情報の読み取りに相当する権限だけを追加します（例: meeting:write:meeting、meeting:update:meeting、meeting:delete:meeting、user:read:user。Zoom側の表示名は変更されることがあるため、該当する最小権限を選んでください）。</li>
 <li>Client ID / Client Secretを確認し、Macのターミナルで <code>npm run integrations:zoom -- --plan</code> を実行して登録内容を確認します。Cloudflareへの反映が別途承認済みの場合に限り、同じコマンドの <code>--apply</code> で非表示入力して登録します。秘密値はチャットやGitに貼らないでください。</li>
 <li>この画面で「Zoomを接続」→ Zoom公式画面で本人認可します。</li></ol></details>
 <div class="actions">${zoomStatus?.configured?`<button class="primary" id="zoomconnect">${zoomStatus.connected?'再認可する':'Zoomを接続'}</button><button class="secondary" id="zoom-storage-check">Zoom保存先を診断</button>`:''}${zoomStatus?.connected?'<button id="zoomdisconnect" class="red">接続を解除</button>':''}</div><p id="zoom-storage-result" class="note" role="status"></p></div>
 <div class="integration"><b>Googleカレンダー</b>${zoomCalendarBadge(calendarStatus)}<p>${calendarStatus?.connected?'カレンダー認可済み（メール情報の取得は要求していません）':'本人のGoogleアカウントで認可してください（予定の作成・変更・削除のみの最小スコープ）。'}</p>
 <details class="guide" ${!calendarStatus?.configured?'open':''}><summary><b>Google Cloud アプリ登録の手順</b></summary><ol>
 <li><a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console ↗</a>でプロジェクトを作成・選択し、「APIとサービス」→「ライブラリ」で Google Calendar API を有効にします。</li>
 <li>「APIとサービス」→「OAuth同意画面」でアプリ名・サポートメールを設定し、スコープに <code>https://www.googleapis.com/auth/calendar.events</code> を追加します。公開ステータスは「テスト中」のままだとリフレッシュトークンが7日で失効するため、本人のみが使う場合も「本番環境」に公開してください（カレンダー予定の編集権限はセンシティブなスコープに分類される可能性があり、外部向け公開にはGoogleの審査が必要な場合があります。公開・認証の画面に出るGoogleの指示に従い、審査や利用制限を回避しないでください）。</li>
 <li>「認証情報」→「OAuth クライアント ID を作成」→ アプリケーションの種類は「ウェブ アプリケーション」→ 承認済みのリダイレクトURIに <code>https://sickstyle-manager.sickstyle-74h4.workers.dev/api/googlecalendar/callback</code> を登録します。</li>
 <li>クライアントID/シークレットを確認し、Macのターミナルで <code>npm run integrations:googlecalendar -- --plan</code> を実行して登録内容を確認します。Cloudflareへの反映が別途承認済みの場合に限り、同じコマンドの <code>--apply</code> で非表示入力して登録します。</li>
 <li>この画面で「Googleカレンダーを接続」→ Google公式画面で本人認可します（オフラインアクセスの同意が必要です）。</li></ol></details>
 <div class="actions">${calendarStatus?.configured?`<button class="primary" id="calconnect">${calendarStatus.connected?'再認可する':'Googleカレンダーを接続'}</button>`:''}${calendarStatus?.connected?'<button id="caldisconnect" class="red">接続を解除</button>':''}</div></div>
 <p class="note">${zoomStatus?.connected&&calendarStatus?.connected?'認可設定あり。会議の操作前にZoomホストと主催カレンダーの所有者を確認します。':'両方の接続が完了するまで、団体営業のMTGは手動URL入力・手動カレンダー登録のままです。未完成の自動連携を完成済みとは表示しません。'}</p></section></div>`;}
// ---------- Instagram ----------
function safeLink(value){try{const u=new URL(value);return u.protocol==='https:'&&['www.instagram.com','instagram.com'].includes(u.hostname)?esc(u.href):'#';}catch{return '#';}}
function instagramView(){const c=ig?.cache;const expired=ig?.expiresAt&&ig.expiresAt<Date.now();const dm=c?.dm;
 return `<section class="panel"><div class="panelhead"><h2>接続状態</h2>${expired?'<span class="badge warn">認可期限切れ</span>':statusBadge(ig)}</div><p>Meta公式のInstagramログイン（ビジネス／クリエイターアカウント）で接続します。Instagramのパスワードをこのアプリに入力・保存することはありません。</p>

 <details class="guide" ${!ig?.configured?'open':''}><summary><b>Instagram連携の手順（5ステップ）</b></summary><ol>
 <li>接続するInstagramを「ビジネス」または「クリエイター」のプロアカウントにします。個人アカウントではInsightsを取得できません。</li>
 <li><a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer">Meta for Developers ↗</a>で既存アプリを確認し、Instagram Login（Instagramでメッセージとコンテンツを管理）を設定します。対象アカウントのテスター招待があれば本人が承認します。端末の安全制限があればMeta公式の解除を待ってください。</li>
 <li>「Instagram Business Login settings」のOAuth redirect URIに <code>https://sickstyle-manager.sickstyle-74h4.workers.dev/api/instagram/callback</code> を登録します。プライバシー <a href="/privacy.html" target="_blank" rel="noopener noreferrer">/privacy.html</a> とデータ削除 <a href="/data-deletion.html" target="_blank" rel="noopener noreferrer">/data-deletion.html</a> もMeta側に登録します。</li>
 <li>Instagram App ID / App Secretを確認し、Macのターミナルで <code>npm run integrations:instagram -- --plan</code> を実行します。Cloudflareへの反映が別途承認済みの場合に限り、同じコマンドの <code>--apply</code> で非表示入力して登録します。既存の <code>TOKEN_ENCRYPTION_KEY</code> は上書きしません。秘密値はチャットやGitに貼らないでください。</li>
 <li>管理画面を更新 →「Instagramを接続」→ Meta公式画面で本人認可 →「今すぐ同期」。最終成功時刻とフォロワー・リール指標を確認します。「認可済み」だけでは同期完了ではありません。</li>
 </ol><p class="note">必要な権限: instagram_business_basic / instagram_business_manage_insights。DM取得には別途 instagram_business_manage_messages が必要です。<a href="https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login" target="_blank" rel="noopener noreferrer">Meta公式資料 ↗</a></p></details>
 <div class="actions">${ig?.configured?`<button class="primary" id="igconnect">${ig.connected?'再認可する':'Instagramを接続'}</button>`:''}${ig?.connected?'<button class="secondary" id="igsync">今すぐ同期</button><button id="igdisconnect" class="red">接続を解除</button>':''}</div>
 <dl class="facts"><dt>アカウント</dt><dd>${esc(ig?.username?'@'+ig.username:'未接続')}</dd><dt>最終同期（成功）</dt><dd>${fmtTime(c?.syncedAt)}</dd><dt>最終試行</dt><dd>${fmtTime(c?.attemptedAt)}</dd><dt>認可の有効期限</dt><dd>${fmtTime(ig?.expiresAt)}</dd><dt>許可された権限</dt><dd>${esc((ig?.granted||[]).join(', ')||'—')}</dd></dl>
 ${c?.error?`<p class="errorbox" role="alert">取得失敗：${esc(c.error)}<br>表示中の数値は最後に成功した同期時点のものです。</p>`:''}${c?.warnings?.length?`<details open><summary>一部の指標を取得できませんでした（${c.warnings.length}件）</summary><p>${c.warnings.map(esc).join('<br>')}</p></details>`:''}</section>
 <div class="stats igstats"><article><small>フォロワー数</small><strong>${num(c?.followers)}</strong><span>最終同期時点</span>${sourceTag(true)}</article><article><small>フォロワー増減</small><strong>${typeof c?.delta==='number'?(c.delta>0?'+':'')+c.delta.toLocaleString('ja-JP'):'未取得'}</strong><span>${c?.deltaSince?esc(c.deltaSince)+' の記録との差':'2日目以降の同期で表示'}</span></article><article><small>対応待ちDM（推定）</small><strong>${dm?num(dm.pending):'未取得'}</strong><span>${dm?`直近${dm.periodDays}日に更新された会話 ${dm.checked}件中`:'メッセージ権限の認可が必要'}</span></article></div>
 <section class="panel"><h2>アカウント全体（直近30日）</h2>${c?.account?`<p class="note">${fmtTime(c.account.since)} 〜 ${fmtTime(c.account.until)}（Instagram公式の集計・最大48時間の遅れあり）</p><div class="metricmini"><span>新規フォロー<b>${num(c.account.follows)}</b></span><span>フォロー解除<b>${num(c.account.unfollows)}</b></span><span>リーチ<b>${num(c.account.reach)}</b></span><span>閲覧数<b>${num(c.account.views)}</b></span><span>反応したアカウント<b>${num(c.account.accounts_engaged)}</b></span><span>反応合計<b>${num(c.account.total_interactions)}</b></span></div>`:'<p class="note">同期後に表示します。</p>'}</section>
 <section class="panel"><h2>取得できない情報・過去データの制約</h2><p>・フォロワー数の過去推移はAPIで遡れません。このアプリが同期した日ごとの記録から増減を計算します（初回同期以前は不明）。<br>・新規フォロー/フォロー解除はフォロワー100人未満のアカウントでは返りません。<br>・指標データの保存期間は最大2年、数値は最大48時間遅れます。広告（有料）の実績・ストーリーズの過去分は対象外です。<br>・リールは最新25件の投稿に含まれる分のみ。<br>・DMは本文を保存せず、各会話の最新20件より前のメッセージは取得できません。未読数は取得できません。<br>・Instagramのパスワード、他人のアカウントのデータは扱いません。</p></section>
 <section class="panel"><h2>対応待ちDMの集計定義</h2><p><b>集計方法：</b>Conversations APIで、直近30日に更新された会話（最大25件）を取得し、最新メッセージの送信者が相手（自分以外）の会話を「対応待ち」と数えます。未読数やInstagramの受信箱表示とは一致しません。</p><p><b>制限（Meta公式）：</b>メッセージ詳細は各会話の最新20件のみ。リクエストフォルダで30日以上動きのない会話は取得されません。<code>instagram_business_manage_messages</code> 権限の本人認可が必要です。</p>${dm?`<p>確認日時：${fmtTime(dm.checkedAt)}${dm.unknown?` · 判定不能 ${dm.unknown}件`:''}${dm.truncated?' · 25件を超える会話は対象外':''}</p>`:''}
 <p><b>Webhook観測（任意）：</b>${ig?.dmStartedAt?`${fmtTime(ig.dmStartedAt)} 以降の受信を観測、対応待ち ${num(ig.dmPending)} 件。受信漏れや停止期間は補完されません。`:'未設定（Webhookなしでも上の推定値は利用できます）'}</p>${ig?.webhookError?`<p class="red">Webhook設定エラー：${esc(ig.webhookError)}</p>`:''}${conversations.map(x=>`<div class="listrow"><div class="grow"><b>会話 ${esc(x.peer)}</b><small>最終受信 ${fmtTime(Number(x.received))}</small></div><button data-resolve="${esc(x.peer)}">対応済みにする</button></div>`).join('')}</section>
 <section class="panel"><div class="panelhead"><h2>リール別の実績</h2><span class="badge">${c?.reels?.length||0} 件</span></div><p>${esc(c?.scope||'接続して同期すると、最新25件の投稿に含まれるリールを表示します')}。再生数は Instagram の views です。数値は最大48時間遅れることがあります。「未取得」は権限不足・取得失敗・API未提供を示し、0とは区別しています。</p>
 ${c?.reels?.length?`<div class="records">${c.reels.map(r=>`<article class="record"><h3>${esc((r.caption||'').slice(0,120))}</h3><p class="note">${fmtTime(r.timestamp)}</p><div class="metricmini">${[['views','再生'],['reach','リーチ'],['total_interactions','反応合計'],['likes','いいね'],['comments','コメント'],['saved','保存'],['shares','シェア']].map(([k,label])=>`<span>${label}<b>${num(r.values[k])}</b></span>`).join('')}</div><p><a href="${safeLink(r.permalink)}" target="_blank" rel="noopener noreferrer">Instagramで開く ↗</a></p></article>`).join('')}</div>`:empty('リールのデータはまだありません。','接続後に同期してください。')}</section>
 <h2 class="sectiondivider">リール分析（自己記録・テーマ別のレート分析）</h2>${renderReels(state.reelPosts,reelUI,esc,today())}
 <h2 class="sectiondivider">参考アカウント</h2>${renderAccounts(state.competitorAccounts,accountUI,esc)}
 <h2 class="sectiondivider">SNS・売上の日次記録（手入力・CSV取込）</h2>${renderSnsMetrics(state.metrics,esc)}`;}
let metricsPage=0;
function renderSnsMetrics(metrics,esc){
 // instagramEntered===falseの行（CSV取込等でAmazon売上だけが登録された記録）も編集・削除できる一覧に含める。
 // 以前は除外していたため、CSV取込した売上記録を直す・消す手段がどの画面にも無くなっていた
 // （Codex独立レビュー指摘：この一覧がmetrics唯一の編集入口であるため）。
 const rows=[...metrics].sort((a,b)=>b.date.localeCompare(a.date));
 const SHOWN=90,pages=Math.max(1,Math.ceil(rows.length/SHOWN));
 metricsPage=Math.max(0,Math.min(metricsPage,pages-1));
 return `<section class="panel"><div class="panelhead"><h2>日次記録（SNS・売上の手入力/CSV取込） <small>${rows.length} 件</small></h2><button class="primary" data-new="metrics">＋ 記録を追加</button></div>
 <p class="note">Amazon売上・注文件数のグラフはAmazon連携画面に表示します。日付ごとに1件の記録です。CSV取込等でInstagram指標が未入力の記録もここから編集・削除できます。</p>
 ${rows.length?`<div class="records">${rows.slice(metricsPage*SHOWN,(metricsPage+1)*SHOWN).map(r=>`<article class="record"><div class="recordtop"><span class="badge">${esc(r.date)}</span><button data-edit="metrics:${esc(r.id)}">編集</button></div><p class="note">売上 ${yen(r.sales)} ・ 注文 ${esc(r.orders)} 件${r.source==='csv'?' · CSV取込':''}</p>${r.instagramEntered===false?'<p class="note">Instagram指標は未入力</p>':`<div class="metricmini"><span>フォロワー<b>${esc(r.followers)}</b></span><span>リーチ<b>${esc(r.reach)}</b></span><span>反応<b>${esc(r.engagement)}</b></span></div>`}${r.notes?`<p class="note">${esc(r.notes)}</p>`:''}</article>`).join('')}</div>${rows.length>SHOWN?`<div class="actions" aria-label="日次記録のページ送り"><button data-metricspage="${metricsPage-1}" ${metricsPage===0?'disabled':''}>前へ</button><span role="status">${metricsPage+1} / ${pages} ページ</span><button data-metricspage="${metricsPage+1}" ${metricsPage===pages-1?'disabled':''}>次へ</button></div>`:''}`:empty('日次記録はまだありません。','日次の売上・Instagram指標を記録できます。','metrics')}</section>`;}
function bindInstagram(){const connect=document.querySelector('#igconnect');if(connect)connect.onclick=async()=>{connect.disabled=true;try{location.assign((await api('instagram/connect','POST',{})).url);}catch(e){toast(e.message);connect.disabled=false;}};
 const sync=document.querySelector('#igsync');if(sync)sync.onclick=async()=>{sync.disabled=true;sync.textContent='同期しています…';try{ig=await api('instagram/sync','POST',{});conversations=(await api('instagram/conversations')).data;render();toast(syncMessage(ig));}catch(e){try{ig=await api('instagram/status');render();}catch{}toast(e.message);}};
 const dis=document.querySelector('#igdisconnect');if(dis)dis.onclick=async()=>{if(!confirm('Instagram接続を解除し、取得データとDM観測履歴を削除しますか？手入力データは残ります。'))return;try{const r=await api('instagram/disconnect','POST',{});ig=await api('instagram/status');conversations=[];render();toast(r.warning||'接続を解除しました');}catch(e){toast(e.message);}};
 document.querySelectorAll('[data-resolve]').forEach(b=>b.onclick=async()=>{try{await api('instagram/resolve','POST',{peer:b.dataset.resolve});ig=await api('instagram/status');conversations=(await api('instagram/conversations')).data;render();}catch(e){toast(e.message);}});}
// ---------- Amazon ----------
const statusJa={PENDING:'保留（支払い確認待ち）',UNSHIPPED:'未発送',PARTIALLY_SHIPPED:'一部発送済み',SHIPPED:'発送済み',CANCELLED:'キャンセル',UNFULFILLABLE:'出荷不能',PENDING_AVAILABILITY:'予約注文（入荷待ち）',INVOICE_UNCONFIRMED:'請求書未確認'};
// ---------- Amazon: 期間・出典処理（JST、欠損を0で埋めない） ----------
// 純粋関数（amazonView rendering用）はpublic/amazon-periods.jsに集約し、node:testで直接ユニットテストする。
function barDiv(dateOrMonth,value,max,extraClass){
 if(value===null)return `<div class="bar missing ${extraClass||''}" title="${esc(dateOrMonth)}: 未取得"></div>`;
 const pct=Math.max(2,Math.round(value/max*100));const step=Math.max(0,Math.min(20,Math.round(pct/5)));
 return `<div class="bar h${step} ${extraClass||''}" title="${esc(dateOrMonth)}: ${yen(value)}"></div>`;
}
function amazonView(){const c=amz?.cache;const o=c?.orders;const t=today();const targetMonth=amzUI.month||month();const isCurrent=targetMonth===month();
 return `<section class="panel"><h2>自社発送・配送先</h2><p>準備中（実データ機能は無効）</p><p>管理者の個別ID・MFA、Amazonの住所閲覧/発送通知ロール、暗号化・削除・監査の確認後に有効化を判断します。現在は配送先取得・Amazonへの発送通知はできません。</p></section><section class="panel"><div class="panelhead"><h2>接続状態</h2>${statusBadge(amz)}</div><p>Amazon公式の Selling Partner API（SP-API）で接続します。対象は ${esc(amz?.marketplace||'Amazon.co.jp (A1VC38T7YXB528)')} です。Amazonのパスワードはこのアプリに入力・保存しません。</p>

 <details class="guide" ${!amz?.connected?'open':''}><summary><b>Amazon SP-API連携の手順（5ステップ）</b></summary><ol>
 <li><a href="https://sellercentral.amazon.co.jp/" target="_blank" rel="noopener noreferrer">Amazon Seller Central ↗</a>に既存の大口出品アカウントのプライマリユーザーでログインします。新たな有料アップグレードは行いません。</li>
 <li>「アプリとサービス」→「アプリの開発」→ <a href="https://solutionproviderportal.amazon.com/home" target="_blank" rel="noopener noreferrer">Solution Provider Portal ↗</a>で、既存の開発者登録がなければ自社専用の「非公開開発者」として登録します。Sales/Ordersに必要な読み取りロールの承認を確認します。</li>
 <li>「Develop Apps」から自社用アプリを作成または再利用し、LWAクライアントID・シークレットを確認します。アプリを自分のAmazon.co.jp出品アカウントに「Self authorize」し、リフレッシュトークンを発行します。公開アプリ・Webサイト認可は不要です。</li>
 <li>Macのターミナルで <code>npm run integrations:amazon -- --plan</code> と <code>npm run integrations:amazon-refresh -- --plan</code> を確認します。Cloudflare Secrets変更が別途承認済みの場合のみ、それぞれ <code>--apply</code> で非表示入力して登録してください。認証情報はチャット・Gitに貼らないでください。</li>
 <li>管理画面を更新 →「Amazon連携」→「今すぐ同期」。売上（Sales API）と注文・発送状況（Orders API）の両方で最終成功時刻とデータを確認します。片方だけ成功しても連携完了とは扱いません。</li>
 </ol><p class="note">審査中・認可前は、この画面の下部から手入力/CSV取込が可能です。追加料金や支払い登録が表示された場合は停止して条件を確認してください。<a href="https://developer-docs.amazon.com/sp-api/docs/register-as-a-private-developer" target="_blank" rel="noopener noreferrer">Amazon公式資料 ↗</a></p></details>
 <div class="actions">${amz?.websiteFlow?`<button class="primary" id="amzconnect">${amz.connected?'再認可する':'Amazonを認可する'}</button>`:''}${amz?.connected?'<button class="secondary" id="amzsync">今すぐ同期</button><button id="amzdisconnect" class="red">接続を解除</button>':''}</div>
 <dl class="facts"><dt>認可方式</dt><dd>${amz?.authorization==='website'?'Webサイト認可（Seller Centralで同意）':amz?.authorization==='self'?'セルフ認可（Seller Centralで発行）':'未認可'}</dd><dt>セラーID</dt><dd>${esc(amz?.sellerId||'—')}</dd><dt>最終同期（成功）</dt><dd>${fmtTime(c?.syncedAt)}</dd><dt>最終試行</dt><dd>${fmtTime(c?.attemptedAt)}</dd><dt>売上の最終取得成功</dt><dd>${fmtTime(c?.salesSyncedAt)}</dd><dt>注文の最終取得成功</dt><dd>${fmtTime(c?.ordersSyncedAt)}</dd><dt>直近同期の取得範囲（API窓）</dt><dd>${c?.salesPeriod?`${esc(c.salesPeriod.start)} 〜 ${esc(c.salesPeriod.end)}（Sales APIは常に直近31日のみ。蓄積した履歴は別途保持）`:'未取得'}</dd></dl>
 ${c?.error?`<p class="errorbox" role="alert">取得失敗：${esc(c.error)}<br>表示中の数値は最後に成功した同期時点のものです。</p>`:''}${c?.warnings?.length?`<details open><summary>一部のデータを取得できませんでした（${c.warnings.length}件）</summary><p>${c.warnings.map(esc).join('<br>')}</p></details>`:''}</section>
 <section class="panel"><div class="panelhead"><h2>月の売上</h2><label>対象月<input type="month" id="amzmonth" value="${esc(targetMonth)}" max="${esc(month())}"></label></div>
 ${(()=>{const info=monthSalesInfo(c,state.metrics,targetMonth,t);const todayInfo=isCurrent?todaySalesInfo(c,state.metrics,t):null;const prior=priorPeriodSales(c,state.metrics,targetMonth,isCurrent?Number(t.slice(8,10)):daysInMonth(targetMonth));
  return `<div class="stats igstats">
  <article><small>${esc(targetMonth)}の売上${info.incomplete?'（進行中・未完了月）':''}</small><strong>${info.value===null?'未取得':yen(info.value)}</strong><span>${sourceLabel(info.source)}${info.daysCovered?` · ${info.daysCovered}/${info.daysExpected}日分`:''}</span>${info.source==='api'?sourceTag(true):''}</article>
  ${todayInfo?`<article><small>今日の売上（${esc(t)}）</small><strong>${todayInfo.value===null?'未取得':yen(todayInfo.value)}</strong><span>${sourceLabel(todayInfo.source)}</span></article>`:''}
  <article><small>前月同期間（${esc(prior.month)}・${prior.daysExpected}日分）</small><strong>${prior.value===null?'未取得':yen(prior.value)}</strong><span>${info.value!==null&&prior.value!==null?(info.value-prior.value>=0?'+':'')+yen(info.value-prior.value)+' の差':'両方のデータが揃うと比較できます'}</span></article>
  </div>
  <p class="note">売上の定義: ${esc(amz?.salesDefinition||'Amazon Sales APIの注文日（日本時間）ベース。返品・返金・手数料は控除前。')}「未取得」は0円ではなく、API・手入力のいずれにも記録がないことを示します。「一部のみ取得（未確定）」は月内の一部の日しか記録がない状態で、欠けている日を0円とみなさず、月の合計には採用していません（日別の棒グラフで欠けている日を確認できます）。「Sales API＋手入力（混在）」は日ごとにAPI優先・欠けている日だけ手入力で埋めて月を揃えた合計です。</p>`;})()}
 </section>
 <section class="panel"><div class="panelhead"><h2>売上の棒グラフ</h2><div class="actions" role="tablist"><button class="${amzUI.chartMode==='daily'?'primary':'secondary'}" data-amzchart="daily">日別（${esc(targetMonth)}）</button><button class="${amzUI.chartMode==='monthly'?'primary':'secondary'}" data-amzchart="monthly">月別（直近12か月）</button></div></div>
 ${amzUI.chartMode==='daily'?(()=>{const rows=fullMonthRows(c,state.metrics,targetMonth,t);const max=Math.max(1,...rows.map(r=>r.value||0));
   return `<div class="barchart" role="img" aria-label="日別売上の棒グラフ">${rows.map(r=>barDiv(r.date,r.value,max,r.date===t?'today':'')).join('')}</div><p class="note">棒の高さは対象月内の最大売上日を100%とした相対表示（5%刻み）です。点線の棒は「未取得」（0円ではありません）。</p>`;})()
  :(()=>{const months=recentMonths(t,12);const rows=months.map(m=>{const info=monthSalesInfo(c,state.metrics,m,t);return {month:m,...info};});const max=Math.max(1,...rows.map(r=>r.value||0));
   return `<div class="barchart" role="img" aria-label="月別売上の棒グラフ（直近12か月）">${rows.map(r=>barDiv(r.month,r.value,max,r.month===month()?'today':'')).join('')}</div><p class="note">右端が今月（進行中・未完了月）です。データが揃っていない過去月は「未取得」（点線）で、0円として扱っていません。</p>`;})()}
 </section>
 <section class="panel"><h2>注文・発送状況</h2><p>${esc(amz?.ordersDefinition||'')}</p>${o?`<div class="tablewrap"><table class="data"><thead><tr><th>状況</th><th>件数</th></tr></thead><tbody>${Object.entries(o.counts).map(([k,v])=>`<tr><td>${esc(statusJa[k]||k)}</td><td>${v}</td></tr>`).join('')}</tbody></table></div>${o.open.length?`<h3>未発送の注文（古い順）</h3>${o.open.map(x=>`<div class="listrow"><div class="grow"><b>${esc(x.orderId)}</b><small>${fmtTime(x.createdTime)} · ${esc(statusJa[x.status]||x.status)} · ${x.fulfilledBy==='AMAZON'?'FBA':'自己発送'} · ${x.items}点</small></div></div>`).join('')}`:''}`:'<p class="note">未取得（Orders API未同期）</p>'}</section>
 ${renderRoas()}
 ${renderFactorNotes(c,targetMonth)}
 <section class="panel"><h2>認可前・認可待ち・欠損期間の入力方法</h2><p>日次の売上・注文件数を手入力するか、CSV（日付・売上・注文件数の列）を取り込めます。同じ日付の記録は上書き登録（重複追加はされません）。Seller Centralの「レポート」→「ビジネスレポート」の日付別レポート（売上とトラフィック）をCSVでダウンロードし、取り込み時に列を選択してください。</p><div class="actions"><button class="secondary" id="csvopen">CSVから取り込む</button><button class="primary" data-new="metrics">＋ 売上を手入力</button></div></section>`;}
function renderRoas(){
 const reconciled=reconcileAds(state.adMetrics,adsStatus?.rows||[]);const rows=[...reconciled.rows].sort((a,b)=>b.periodEnd.localeCompare(a.periodEnd));
 return `<section class="panel"><div class="panelhead"><h2>広告費用対効果</h2><button class="primary" data-new="adMetrics">＋ 広告実績を追加</button></div>
 <p class="note">ROAS = 広告経由売上 ÷ 広告費。ACOS = 広告費 ÷ 広告経由売上 × 100（%）。<b>総売上を広告費で割った値はROASとして表示していません。</b>広告費のみ入力され広告経由売上が未入力の場合、ROAS/ACOSは「計算不可」です。Amazon広告・Instagram広告は別々に記録し合算しません。Sponsored Productsの日次自動同期はSP-APIとは別の認可が必要です。その他の広告種別は自動集計対象外です。</p>
 <p role="status">Amazon Ads：${adsStatus?.connected?'プロフィール確認済み':'未接続・専用認可待ち'} / 最終成功：${esc(adsStatus?.lastSuccess||'未取得')} / 日本時間・JPY</p>${adsStatus?.error?`<p role="alert">${esc(adsStatus.error)}</p>`:''}${reconciled.conflicts?`<p role="alert">${reconciled.conflicts}件の自動取得行は手入力/CSVの期間と重複するため集計から除外しています。履歴は保全しています。</p>`:''}<button id="ads-sync" ${adsStatus?.configured?'':'disabled'}>広告データを同期・進捗確認</button><p>直近31日を再取得し遅延更新を反映します。売上帰属は出品者7日・ベンダー14日。未取得は0円にしません。</p>
 <div class="formfields"><label>媒体<select id="adplatformfilter"><option value="all" ${adUI.platform==='all'?'selected':''}>すべて</option>${['Amazon','Instagram'].map(p=>`<option value="${p}" ${adUI.platform===p?'selected':''}>${p}</option>`).join('')}</select></label>
 <label class="secondary filelabel">CSVから取り込む<input id="adcsvfile" class="sr-only" type="file" accept=".csv,text/csv"></label><button type="button" class="secondary" id="adcsvtemplate">ひな形をダウンロード</button></div>
 ${rows.filter(r=>adUI.platform==='all'||r.platform===adUI.platform).length?`<div class="records">${rows.filter(r=>adUI.platform==='all'||r.platform===adUI.platform).map(r=>{const roas=adRoas(r),acos=adAcos(r);
  return `<article class="record"><div class="recordtop"><span class="badge">${esc(r.platform)}</span>${r.source==='api'?'<span>API取得・編集不可</span>':`<button data-edit="adMetrics:${esc(r.id)}">編集</button>`}</div><h3>${esc(r.periodStart)} 〜 ${esc(r.periodEnd)}</h3><p class="note">通貨: JPY${r.attributionWindowDays!==null?` · アトリビューション期間: ${r.attributionWindowDays}日`:' · アトリビューション期間: 未設定'} · 取得方法: ${r.source==='api'?'Amazon Ads API (SP)':r.source==='csv'?'CSV取込':'手入力'}</p>
  <div class="metricmini"><span>広告費<b>${r.adCost===null?'未取得':yen(r.adCost)}</b></span><span>広告経由売上<b>${r.attributedSales===null?'未取得':yen(r.attributedSales)}</b></span><span>ROAS<b>${roas===null?'計算不可':roas+'倍'}</b></span><span>ACOS<b>${acos===null?'計算不可':acos+'%'}</b></span></div>
  ${r.campaign?`<p class="note">${esc(r.campaign)}</p>`:''}</article>`;}).join('')}</div>`:'<div class="empty"><div aria-hidden="true">＋</div><b>広告実績はまだ登録されていません。</b><p>手入力またはCSVで広告費・広告経由売上を登録できます。</p></div>'}</section>`;}
function renderFactorNotes(c,targetMonth){
 const t=today();
 const igDelta=typeof ig?.cache?.delta==='number'?ig.cache.delta:null;
 const igDeltaSince=ig?.cache?.deltaSince||null;
 const monthAds=state.adMetrics.filter(a=>a.periodStart<=targetMonth+'-31'&&a.periodEnd>=targetMonth+'-01');
 const dailyRows=dailyRowsForMonth(c,state.metrics,targetMonth);
 const reels=state.reelPosts.filter(r=>r.postedAt.startsWith(targetMonth));
 const measuredExperiments=state.growthExperiments.filter(e=>(e.periodStart||'').startsWith(targetMonth)||(e.periodEnd||'').startsWith(targetMonth));
 const measuredTotal=measuredExperiments.reduce((n,e)=>n+(e.measuredPurchases||0),0);
 const hasMeasured=measuredExperiments.some(e=>e.measuredPurchases!==null);
 return `<section class="panel"><h2>売上に関わりうる要因の整理（${esc(targetMonth)}）</h2>
 <p class="note">以下は同じ期間に観測された数値を並べて仮説を示すだけで、相関係数の計算や因果関係の断定はしていません。<b>追跡リンク・購入計測（購入実験の「実測購入数」）で確認できた分だけを実測として扱い</b>、それ以外は根拠付きの仮説です。</p>
 <div class="metricmini"><span>Instagramフォロワー増減<b>${igDelta===null?'未取得':(igDelta>0?'+':'')+igDelta.toLocaleString('ja-JP')}</b></span><span>対象広告件数（${esc(targetMonth)}と重なる期間）<b>${monthAds.length}件</b></span><span>当月のリール投稿数<b>${reels.length}件</b></span><span>追跡計測できた購入数（実測）<b>${hasMeasured?num(measuredTotal):'未取得'}</b></span></div>
 <p class="note">Instagramのフォロワー増減は「前日比」ではなく、前回同期記録（${igDeltaSince?esc(igDeltaSince):'未取得'}）との差です。同期間隔が1日とは限りません。</p>
 ${reels.length?`<h3>当月のリール投稿（公開日時順）</h3><div class="tablewrap"><table class="data"><thead><tr><th>公開日</th><th>テーマ</th><th>再生数</th><th>保存率</th><th>同日の売上</th></tr></thead><tbody>${reels.sort((a,b)=>a.postedAt.localeCompare(b.postedAt)).map(r=>{const day=dailyRows.find(d=>d.date===r.postedAt);return `<tr><td>${esc(r.postedAt)}</td><td>${esc(r.theme)}</td><td>${r.views===null?'未取得':num(r.views)}</td><td>${r.saves===null||r.views===null||!r.views?'未取得':Math.round(r.saves/r.views*1000)/10+'%'}</td><td>${day&&day.value!==null?yen(day.value):'未取得'}</td></tr>`;}).join('')}</tbody></table></div><p class="note">投稿日の売上と前後の売上を比べる場合も、値引き・在庫切れ・曜日・他の広告など他の要因を先に確認してください。</p>`:'<p class="note">当月のリール投稿記録はありません。</p>'}
 <h3>他の要因の確認事項（自動判定はしていません・手動で確認してください）</h3>
 <ul class="note"><li>値引き・セールを実施していないか（「購入実験」「団体営業」等で記録）</li><li>在庫切れで販売機会を逃していないか（在庫・発送管理で確認）</li><li>曜日・連休などの季節性</li><li>他の広告・他社キャンペーンとの重複時期</li></ul>
 ${!hasMeasured&&!monthAds.length&&!reels.length?'<p class="note">データ不足のため、この期間の要因分析はできません。広告実績・リール投稿・購入実験のいずれかを記録してください。</p>':''}</section>`;}
function bindAmazon(){const c=document.querySelector('#amzconnect');if(c)c.onclick=async()=>{c.disabled=true;try{location.assign((await api('amazon/connect','POST',{})).url);}catch(e){toast(e.message);c.disabled=false;}};
 const s=document.querySelector('#amzsync');if(s)s.onclick=async()=>{s.disabled=true;s.textContent='同期しています…';try{amz=await api('amazon/sync','POST',{});render();toast(syncMessage(amz));}catch(e){if(e.body?.status)amz=e.body.status;render();toast(e.message);}};
 const d=document.querySelector('#amzdisconnect');if(d)d.onclick=async()=>{if(!confirm('Amazon接続を解除し、保存した認可トークンと取得データを削除しますか？手入力データは残ります。'))return;try{const r=await api('amazon/disconnect','POST',{});amz=await api('amazon/status');render();toast(r.warning||'接続を解除しました');}catch(e){toast(e.message);}};
 const m=document.querySelector('#amzmonth');if(m)m.onchange=()=>{if(m.value)amzUI={...amzUI,month:m.value};render();};
 document.querySelectorAll('[data-amzchart]').forEach(b=>b.onclick=()=>{amzUI={...amzUI,chartMode:b.dataset.amzchart};render();});
 const apf=document.querySelector('#adplatformfilter');if(apf)apf.onchange=()=>{adUI={...adUI,platform:apf.value};render();};
 const act=document.querySelector('#adcsvtemplate');if(act)act.onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿媒体,開始日,終了日,広告費,広告経由売上,アトリビューション日数,メモ\nAmazon,'+today()+','+today()+',0,,14,\n'],{type:'text/csv'}));a.download='sickstyle-admetrics-template.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
 const acf=document.querySelector('#adcsvfile');if(acf)acf.onchange=()=>adCsvImport(acf);}
function adCsvImport(input){const f=input.files[0];if(!f)return;(async()=>{try{if(f.size>2_000_000)throw Error('ファイルが大きすぎます（2MBまで）');const rows=parseCSV(await f.text());if(rows.length<2)throw Error('データ行がありません');const h=rows[0].map(x=>x.trim());
  const idx=words=>h.findIndex(x=>words.some(w=>x.includes(w)));
  const ci={platform:idx(['媒体','platform']),start:idx(['開始','start']),end:idx(['終了','end']),cost:idx(['広告費','cost']),sales:idx(['広告経由売上','attributed','経由売上']),window:idx(['アトリビューション','window']),campaign:idx(['メモ','キャンペーン','campaign'])};
  if(ci.platform<0||ci.start<0||ci.end<0)throw Error('媒体・開始日・終了日の列が見つかりません。ひな形を確認してください。');
  // キーに媒体・期間に加えてキャンペーン名も含める。同じ媒体・同じ期間でもキャンペーンが異なれば別広告実績として
  // 扱わないと、CSVの後の行が前の行の広告費・広告経由売上を無言で上書きしてしまう（Codex独立レビュー指摘）。
  const next=structuredClone(state);const byKey=new Map(next.adMetrics.map(x=>[x.platform+'|'+x.periodStart+'|'+x.periodEnd+'|'+(x.campaign||''),x]));let added=0,updated=0;const bad=[];
  rows.slice(1).forEach((r,i)=>{
   const platformRaw=(r[ci.platform]||'').trim();const platform=/instagram/i.test(platformRaw)||platformRaw.includes('インスタ')?'Instagram':/amazon/i.test(platformRaw)||platformRaw.includes('アマゾン')?'Amazon':null;
   const start=toDate(r[ci.start]);const end=ci.end>=0?toDate(r[ci.end]):start;
   // セルが空欄なら「未取得（null）」として許容するが、空欄でないのにtoNumber()が解析できなかった場合
   // （誤入力・負数・桁超過など）は、nullとして既存の広告費・広告経由売上を無言で上書きしてしまわないよう、
   // 行ごと除外する（Codex独立レビュー指摘）。
   const numericCell=idx=>{if(idx<0||r[idx]==='')return {value:null,invalid:false};const v=toNumber(r[idx]);return {value:v,invalid:v===null};};
   const costCell=numericCell(ci.cost),salesCell=numericCell(ci.sales);
   const cost=costCell.value,sales=salesCell.value;
   const win=ci.window>=0&&String(r[ci.window]||'').trim()!==''?Number(r[ci.window]):null;
   if(!platform||!start||!end||end<start||costCell.invalid||salesCell.invalid||(win!==null&&(!Number.isInteger(win)||win<0||win>365))){bad.push(i+2);return;}
   const campaign=ci.campaign>=0?String(r[ci.campaign]||'').slice(0,200):'';const key=platform+'|'+start+'|'+end+'|'+campaign;const cur=byKey.get(key);
   if(cur){cur.adCost=cost;cur.attributedSales=sales;cur.attributionWindowDays=win;cur.campaign=campaign;cur.source='csv';cur.updatedAt=new Date().toISOString();updated++;}
   else{const row={id:crypto.randomUUID(),platform,periodStart:start,periodEnd:end,attributionWindowDays:win,adCost:cost,attributedSales:sales,source:'csv',campaign,updatedAt:new Date().toISOString()};next.adMetrics.push(row);byKey.set(key,row);added++;}
  });
  if(!added&&!updated)throw Error('取り込める行がありませんでした（媒体・日付・数値の形式を確認してください）');
  if(bad.length&&!confirm(`${bad.length}行（例: ${bad.slice(0,5).join(', ')}行目）は形式が正しくないため除外します。残り ${added+updated} 行を取り込みますか？`)){input.value='';return;}
  await persist(next);toast(`広告実績を取り込みました（追加 ${added} 件・更新 ${updated} 件）`);
 }catch(e){toast(e.message);}finally{input.value='';}})();}
function bindZoomCalendar(){
 const zdiag=document.querySelector('#zoom-storage-check');if(zdiag)zdiag.onclick=async()=>{
  zdiag.disabled=true;const target=document.querySelector('#zoom-storage-result');
  try{const d=await api('zoom/storage-diagnostics','POST',{});
   const msg=d.ok?'暗号化・D1書き込みの検証成功。Zoom本人認可を試してください。':d.stage==='encryption'?'暗号化に失敗（encryption_failed）。CloudflareのTOKEN_ENCRYPTION_KEYを管理者が確認してください。':'D1保存に失敗（database_write_failed）。WorkersのD1バインディングを管理者が確認してください。';
   if(target)target.textContent=msg;toast(msg);
  }catch(e){if(target)target.textContent='診断を実行できませんでした：'+e.message;toast(e.message);}
  finally{zdiag.disabled=false;}
 };

 const zc=document.querySelector('#zoomconnect');if(zc)zc.onclick=async()=>{zc.disabled=true;try{location.assign((await api('zoom/connect','POST',{})).url);}catch(e){toast(e.message);zc.disabled=false;}};
 const zd=document.querySelector('#zoomdisconnect');if(zd)zd.onclick=async()=>{if(!confirm('Zoom接続を解除しますか？既存のMTGの同期状態には影響しません。'))return;try{await api('zoom/disconnect','POST',{});zoomStatus=await api('zoom/status');render();toast('Zoomの接続を解除しました');}catch(e){toast(e.message);}};
 const cc=document.querySelector('#calconnect');if(cc)cc.onclick=async()=>{cc.disabled=true;try{location.assign((await api('googlecalendar/connect','POST',{})).url);}catch(e){toast(e.message);cc.disabled=false;}};
 const cd=document.querySelector('#caldisconnect');if(cd)cd.onclick=async()=>{if(!confirm('Googleカレンダー接続を解除しますか？既存のMTGの同期状態には影響しません。'))return;try{await api('googlecalendar/disconnect','POST',{});calendarStatus=await api('googlecalendar/status');render();toast('Googleカレンダーの接続を解除しました');}catch(e){toast(e.message);}};
}
// ---------- CSV取込 ----------
export function parseCSV(text){const rows=[];let row=[],cell='',q=false;text=text.replace(/^﻿/,'');for(let i=0;i<text.length;i++){const ch=text[i];if(q){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=ch;}else if(ch==='"')q=true;else if(ch===','){row.push(cell);cell='';}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=ch;}if(cell!==''||row.length){row.push(cell);rows.push(row);}return rows.filter(r=>r.some(x=>x.trim()!==''));}
export function toDate(v){const m=String(v).trim().match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?/);if(!m)return null;const d=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;return !Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d?d:null;}
export function toNumber(v){const s=String(v??'').replace(/[￥¥,\s円]/g,'').replace(/^JPY/i,'');if(s===''||s==='-')return 0;const n=Number(s);return Number.isFinite(n)&&n>=0&&n<=1e12?n:null;}
function guess(headers,words){const i=headers.findIndex(h=>words.some(w=>h.includes(w)));return i<0?'':String(i);}
function csvDialog(){const d=document.querySelector('#editor');d.innerHTML=`<form id="csvform"><div class="panelhead"><h2>CSVから売上・注文を取り込む</h2><button type="button" id="close" aria-label="閉じる">✕</button></div><p class="note">1行目に見出しがあるCSV（UTF-8）を選んでください。同じ日付の記録がある場合は売上・注文件数だけを上書きし、Instagram指標は変更しません。</p><label class="filelabel">CSVファイル<input type="file" id="csvfile" accept=".csv,text/csv" required></label><div id="csvmap"></div><div id="editerror" role="alert"></div><div class="dialogactions"><button type="button" id="csvtemplate" class="secondary">ひな形をダウンロード</button><button type="button" id="cancel">キャンセル</button><button class="primary" id="csvsave" disabled>取り込む</button></div></form>`;d.showModal();
 let rows=null;document.querySelector('#close').onclick=document.querySelector('#cancel').onclick=()=>d.close();
 document.querySelector('#csvtemplate').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿日付,売上,注文件数\n'+today()+',0,0\n'],{type:'text/csv'}));a.download='sickstyle-amazon-template.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
 document.querySelector('#csvfile').onchange=async e=>{const f=e.target.files[0];const err=document.querySelector('#editerror');err.textContent='';if(!f)return;if(f.size>2_000_000){err.textContent='ファイルが大きすぎます（2MBまで）';return;}rows=parseCSV(await f.text());if(rows.length<2){err.textContent='データ行がありません';return;}const h=rows[0].map(x=>x.trim());const opts=sel=>`<option value="">（使わない）</option>${h.map((x,i)=>`<option value="${i}" ${String(i)===sel?'selected':''}>${esc(x)}</option>`).join('')}`;
  document.querySelector('#csvmap').innerHTML=`<div class="formfields"><label>日付の列<select name="date" required>${opts(guess(h,['日付','date','Date']))}</select></label><label>売上の列<select name="sales">${opts(guess(h,['売上','sales','Sales','金額']))}</select></label><label>注文件数の列<select name="orders">${opts(guess(h,['注文件数','注文数','注文品目','orders','Orders']))}</select></label></div><p class="note">${rows.length-1} 行を読み込みました。列の対応を確認してください。</p>`;document.querySelector('#csvsave').disabled=false;};
 document.querySelector('#csvform').onsubmit=async e=>{e.preventDefault();const err=document.querySelector('#editerror');const b=document.querySelector('#csvsave');b.disabled=true;try{const m=Object.fromEntries(new FormData(e.target));if(!m.date)throw Error('日付の列を選んでください');if(!m.sales&&!m.orders)throw Error('売上か注文件数の列を選んでください');
  const next=structuredClone(state);const byDate=new Map(next.metrics.map(x=>[x.date,x]));let added=0,updated=0;const bad=[];
  rows.slice(1).forEach((r,i)=>{const date=toDate(r[m.date]);const sales=m.sales?toNumber(r[m.sales]):undefined;const orders=m.orders?toNumber(r[m.orders]):undefined;if(!date||sales===null||orders===null||(orders!==undefined&&!Number.isInteger(orders))){bad.push(i+2);return;}
   const cur=byDate.get(date);if(cur){if(sales!==undefined)cur.sales=sales;if(orders!==undefined)cur.orders=orders;cur.source='csv';updated++;}else{const row={id:crypto.randomUUID(),date,sales:sales??0,orders:orders??0,followers:0,reach:0,engagement:0,source:'csv',instagramEntered:false};next.metrics.push(row);byDate.set(date,row);added++;}});
  if(!added&&!updated)throw Error('取り込める行がありませんでした（日付・数値の形式を確認してください）');
  if(bad.length&&!confirm(`${bad.length}行（例: ${bad.slice(0,5).join(', ')}行目）は形式が正しくないため除外します。残り ${added+updated} 行を取り込みますか？`)){b.disabled=false;return;}
  await persist(next);d.close();toast(`取り込みました（追加 ${added} 件・更新 ${updated} 件）`);}catch(x){err.textContent=x.message;b.disabled=false;}};}
// ---------- 共通 ----------
async function persist(next){if(busy)return;busy=true;try{const saved=await api('data','PUT',next);state={...next,revision:saved.revision};render();toast('保存しました');}finally{busy=false;}}
async function logout(){try{await api('logout','POST',{});}catch(e){toast(e.message);return;}state=null;ig=null;amz=null;configured=true;auth();}
async function refresh(){if(confirm('保存していない入力内容は破棄されます。最新データを読み込みますか？'))try{await load();toast('最新データを読み込みました');}catch(e){toast(e.message);}}
function bindMetricsPages(){document.querySelectorAll('[data-metricspage]').forEach(b=>b.onclick=()=>{metricsPage=Number(b.dataset.metricspage);render();});}
function bind(){bindMetricsPages();if(section==='team')bindTeam({model:team,api,setModel:v=>team=v,render,toast});bindFinance();bindInstagram();bindAmazon();bindZoomCalendar();bindSite();if(section==='settings')mountNotifications();
 for(const id of ['#refresh','#mrefresh'])document.querySelector(id).onclick=refresh;for(const id of ['#logout','#mlogout'])document.querySelector(id).onclick=logout;
 document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=async e=>{e.preventDefault();section=b.dataset.nav;if(section==='team')try{team=await api('ai-team');}catch(x){toast(x.message);}if(section==='site'&&!site)try{site=await api('site');}catch(x){toast(x.message);}render();window.scrollTo(0,0);});
 document.querySelectorAll('[data-new]').forEach(b=>b.onclick=()=>editor(b.dataset.new));
 document.querySelectorAll('[data-addresearch]').forEach(b=>b.onclick=async()=>{
   const p=RESEARCHED_PLAYERS.find(x=>x.key===b.dataset.addresearch);
   if(!p||state.playerCandidates.some(x=>x.name===p.name&&x.period===p.period)){toast('候補はすでに登録されています');return;}
   try{await persist({...state,playerCandidates:[...state.playerCandidates,{...toCandidate(p),id:crypto.randomUUID(),updatedAt:new Date().toISOString()}]});}
   catch(e){toast(e.message);}
 });
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const [key,id]=b.dataset.edit.split(':');editor(key,state[key].find(r=>r.id===id));});
 document.querySelectorAll('[data-check]').forEach(b=>b.onchange=async()=>{const n=structuredClone(state);n.tasks.find(x=>x.id===b.dataset.check).done=b.checked;try{await persist(n);}catch(e){toast(e.message);render();}});
 const csv=document.querySelector('#csvopen');if(csv)csv.onclick=csvDialog;
 document.querySelectorAll('[data-stafftab]').forEach(b=>b.onclick=()=>{staffUI={...staffUI,assignee:b.dataset.stafftab};render();});
 const staffSort=document.querySelector('#stafftasksort');if(staffSort)staffSort.onchange=()=>{staffUI={...staffUI,sort:staffSort.value};render();};
 const staffQ=document.querySelector('#stafftaskq');if(staffQ){const search=e=>{if(e.isComposing)return;const start=staffQ.selectionStart,end=staffQ.selectionEnd;staffUI={...staffUI,q:staffQ.value};render();const next=document.querySelector('#stafftaskq');next?.focus();next?.setSelectionRange(start,end);};staffQ.oninput=search;staffQ.oncompositionend=search;}
 document.querySelectorAll('[data-staffstatus]').forEach(b=>b.onchange=async()=>{const n=structuredClone(state);const rec=n.staffTasks.find(x=>x.id===b.dataset.staffstatus);rec.status=b.value;rec.updatedAt=new Date().toISOString();try{await persist(n);}catch(e){toast(e.message);render();}});
 document.querySelectorAll('[data-restore-stafftask]').forEach(b=>b.onclick=async()=>{const n=structuredClone(state);const rec=n.staffTasks.find(x=>x.id===b.dataset.restoreStafftask);rec.deletedAt=null;rec.updatedAt=new Date().toISOString();try{await persist(n);toast('復元しました');}catch(e){toast(e.message);render();}});
 document.querySelectorAll('[data-orgtab]').forEach(b=>b.onclick=()=>{orgTab=b.dataset.orgtab;render();});
 const osf=document.querySelector('#orgstagefilter');if(osf)osf.onchange=()=>{orgUI={...orgUI,stage:osf.value};render();};
 const oaf=document.querySelector('#orgassigneefilter');if(oaf)oaf.onchange=()=>{orgUI={...orgUI,assignee:oaf.value};render();};
 const oks=document.querySelector('#orgkpistart');if(oks)oks.onchange=()=>{orgKPIPeriod={...orgKPIPeriod,start:oks.value};render();};
 const oke=document.querySelector('#orgkpiend');if(oke)oke.onchange=()=>{orgKPIPeriod={...orgKPIPeriod,end:oke.value};render();};
 const newOrgBtn=document.querySelector('[data-neworg]');if(newOrgBtn)newOrgBtn.onclick=()=>orgEditor(null);
 const orgQ=document.querySelector('#orgsearch');if(orgQ){const search=e=>{if(e.isComposing)return;const start=orgQ.selectionStart,end=orgQ.selectionEnd;orgUI={...orgUI,q:orgQ.value};render();const next=document.querySelector('#orgsearch');next?.focus();next?.setSelectionRange(start,end);};orgQ.oninput=search;orgQ.oncompositionend=search;}
 document.querySelectorAll('[data-restoreorg]').forEach(b=>b.onclick=async()=>{if(!confirm('削除済み団体を一覧へ戻します。会議は作成・取消せず、元の連携記録を保持します。復元しますか？'))return;b.disabled=true;try{await persist({...state,orgSales:state.orgSales.map(x=>x.id===b.dataset.restoreorg?{...x,deletedAt:null}:x)});toast('団体を復元しました。編集画面で会議の状態と取消を確認してください');}catch(e){toast(e.message);b.disabled=false;}});
 const adsSync=document.querySelector('#ads-sync');if(adsSync)adsSync.onclick=async()=>{adsSync.disabled=true;try{adsStatus=await api('amazonads/sync','POST',{});render();}catch(e){toast(e.message);adsStatus=await api('amazonads/status');render();}};
 const meetingSelect=document.querySelector('#meetingselect');if(meetingSelect)meetingSelect.onsubmit=e=>{e.preventDefault();const values=new FormData(meetingSelect),id=values.get('orgId'),kind=values.get('kind');if(['initial','proposal'].includes(kind))meetingEditor(state.orgSales.find(o=>o.id===id),kind);};
 document.querySelectorAll('[data-meetingorg]').forEach(b=>b.onclick=()=>meetingEditor(state.orgSales.find(o=>o.id===b.dataset.meetingorg),b.dataset.meetingkind));
 document.querySelectorAll('[data-editorg]').forEach(b=>b.onclick=()=>orgEditor(state.orgSales.find(x=>x.id===b.dataset.editorg)));
 const ccf=document.querySelector('#collectcategoryfilter');if(ccf)ccf.onchange=()=>{collectUI={...collectUI,category:ccf.value};render();};
 const csf=document.querySelector('#collectstatusfilter');if(csf)csf.onchange=()=>{collectUI={...collectUI,status:csf.value};render();};
 const cq=document.querySelector('#collectaddstandard');if(cq)cq.onclick=async()=>{
  const existing=new Set(state.collectionTasks.map(x=>x.category+'|'+x.title));
  const toAdd=allStandardItems().filter(x=>!existing.has(x.category+'|'+x.title));
  if(!toAdd.length){toast('標準項目はすべて追加済みです');return;}
  const now=new Date().toISOString();
  const n={...state,collectionTasks:[...state.collectionTasks,...toAdd.map(x=>({id:crypto.randomUUID(),title:x.title,category:x.category,purpose:x.purpose,source:x.source,frequency:x.frequency,assignee:'入戸野',due:'',period:'',status:'未収集',value:'',notes:'',updatedAt:now}))]};
  try{await persist(n);toast(toAdd.length+'件の標準項目を追加しました');}catch(e){toast(e.message);}};
 const rpf=document.querySelector('#reelplatformfilter');if(rpf)rpf.onchange=()=>{reelUI={...reelUI,platform:rpf.value};render();};
 const rff=document.querySelector('#reelformatfilter');if(rff)rff.onchange=()=>{reelUI={...reelUI,format:rff.value};render();};
 const esf=document.querySelector('#experimentstatusfilter');if(esf)esf.onchange=()=>{experimentUI={...experimentUI,status:esf.value};render();};
 const apf=document.querySelector('#accountplatformfilter');if(apf)apf.onchange=()=>{accountUI={...accountUI,platform:apf.value};render();};
 const plf=document.querySelector('#playerleaguefilter');if(plf)plf.onchange=()=>{playerUI={...playerUI,league:plf.value};render();};
 const ptf=document.querySelector('#playertierfilter');if(ptf)ptf.onchange=()=>{playerUI={...playerUI,tier:ptf.value};render();};
 const f=document.querySelector('#brand');if(f)f.onsubmit=async e=>{e.preventDefault();try{await persist({...state,brand:Object.fromEntries(new FormData(f))});}catch(x){toast(x.message);}};
 const r=document.querySelector('#restore');if(r)r.onchange=async()=>{if(!r.files[0])return;if(!confirm('現在の業務データをバックアップの内容に置き換えます。復元しますか？')){r.value='';return;}try{await api('restore','POST',{...JSON.parse(await r.files[0].text()),revision:state.revision});state=await api('data');render();toast('復元しました');}catch(e){toast(e.message);r.value='';}};}
function editor(key,record){const c=configs[key];const r=record||{due:key==='collectionTasks'?'':today(),date:today(),month:month(),current:0,target:100,...(key==='metrics'?{sales:0,orders:0,followers:0,reach:0,engagement:0}:{}),...(key==='adMetrics'?{platform:'Amazon',periodStart:today(),periodEnd:today(),attributionWindowDays:null,adCost:null,attributedSales:null,source:'manual',campaign:''}:{}),priority:'中',status:key==='staffTasks'?'未着手':key==='collectionTasks'?'未収集':'未発送',type:'monthly',assignee:'',category:COLLECT_CATEGORIES[0]};const d=document.querySelector('#editor');
 d.innerHTML=`<form id="editform"><div class="panelhead"><h2>${c.title}${record?'を編集':'を追加'}</h2><button type="button" id="close" aria-label="閉じる">✕</button></div><div class="formfields">${c.fields.map(([name,label,type,options,labels,required])=>`<label>${label}${type==='textarea'?`<textarea name="${name}" maxlength="10000">${esc(r[name])}</textarea>`:type==='select'?`<select name="${name}">${options.map((v,i)=>`<option value="${v}" ${r[name]===v?'selected':''}>${labels?.[i]||v}</option>`).join('')}</select>`:`<input name="${name}" type="${type==='nnumber'?'number':type}" value="${esc(r[name])}" ${required===true||(required===undefined&&(['title','date','target'].includes(name)||(name==='due'&&key!=='collectionTasks')))?'required':''} ${(type==='number'||type==='nnumber')?`inputmode="decimal" min="${name==='target'?0.01:0}" max="1000000000000" step="${['target','current','sales'].includes(name)?'0.01':type==='nnumber'?'any':'1'}"`:'maxlength="500"'}>`}</label>`).join('')}</div><div id="editerror" role="alert"></div><div class="dialogactions">${record?'<button type="button" id="delete" class="red">削除</button>':''}<button type="button" id="cancel">キャンセル</button><button class="primary" id="save">保存する</button></div></form>`;d.showModal();
 document.querySelector('#close').onclick=document.querySelector('#cancel').onclick=()=>d.close();
 document.querySelector('#editform').onsubmit=async e=>{e.preventDefault();const b=document.querySelector('#save');b.disabled=true;try{const vals=Object.fromEntries(new FormData(e.target));for(const [n,,type]of c.fields){if(type==='number')vals[n]=Number(vals[n]||0);if(type==='nnumber')vals[n]=vals[n]===''?null:Number(vals[n]);}if(key==='metrics'&&state.metrics.some(m=>m.date===vals.date&&m.id!==record?.id))throw Error('この日付の実績は登録済みです。既存の記録を編集してください。');if(key==='adMetrics'&&vals.periodEnd<vals.periodStart)throw Error('対象期間の終了日は開始日以降にしてください。');const next=structuredClone(state);const row={...record,...vals,id:record?.id||crypto.randomUUID()};if(key==='metrics')row.instagramEntered=true;if(key==='tasks')row.done=record?.done||false;if(['staffTasks','collectionTasks','growthExperiments','playerCandidates','adMetrics'].includes(key))row.updatedAt=new Date().toISOString();if(key==='reelPosts')row.observedAt=new Date().toISOString();next[key]=record?next[key].map(x=>x.id===record.id?row:x):[...next[key],row];await persist(next);}catch(err){const t=document.querySelector('#editerror');if(t)t.textContent=err.message;else toast(err.message);b.disabled=false;}};
 const del=document.querySelector('#delete');if(del)del.onclick=async()=>{if(!confirm('この記録を削除しますか？'+(key==='staffTasks'?'（ゴミ箱から復元できます）':'')))return;try{if(key==='staffTasks'){await persist({...state,staffTasks:state.staffTasks.map(x=>x.id===record.id?{...x,deletedAt:new Date().toISOString()}:x)});}else{await persist({...state,[key]:state[key].filter(x=>x.id!==record.id)});}}catch(e){toast(e.message);}};}
// ---------- 団体営業（専用エディタ。段階変更は履歴に追記する） ----------
// MTG連携APIはフォームの入力値を見ず、保存済みのorgId+revisionだけを使ってZoom/カレンダーへ同期する。
// フォームを編集中（まだ「保存する」していない）のままMTG連携ボタンを押すと、古い（保存済みの）日時・名称を
// そのまま同期してしまい、しかも同期後にstateを再取得してエディタを再描画するため未保存の入力が無言で
// 失われる（Codex独立レビュー指摘）。未保存の変更がある場合は先に保存するよう案内し、同期を実行しない。
function meetingEditor(record,kind='initial',noteDraft=null){
 if(!record||record.deletedAt)return;
 const d=document.querySelector('#editor');
 d.innerHTML=renderMeetingEditor(record,kind,esc,{zoomConnected:!!zoomStatus?.connected,calendarConnected:!!calendarStatus?.connected,calendarIdentityReady:calendarStatus?.identityReady});d.showModal();if(noteDraft)for(const [id,value] of Object.entries(noteDraft)){const el=d.querySelector('#'+id);if(el){if(el.type==='checkbox')el.checked=value;else el.value=value;}}
 const captureNoteDraft=()=>Object.fromEntries(['note-source','note-at','note-summary','note-body','note-consent'].map(id=>{const el=d.querySelector('#'+id);return [id,el.type==='checkbox'?el.checked:el.value];}));
 const noteAction=async(input,btn)=>{if(btn.disabled)return;if(meetingFormChanged(record,kind,Object.fromEntries(new FormData(d.querySelector('#meetingform'))))){d.querySelector('#editerror').textContent='未保存の会議変更があります。議事録を保存・反映する前に内容・日時を保存してください';return;}btn.disabled=true;const draft=captureNoteDraft();try{await api('meeting-notes','POST',{...input,orgId:record.id,kind,revision:state.revision});state=await api('data');render();meetingEditor(state.orgSales.find(o=>o.id===record.id),kind,input.action==='import'?null:draft);}catch(e){d.querySelector('#editerror').textContent=e.message;btn.disabled=false;}};
 const noteImport=d.querySelector('#note-import');noteImport.onclick=()=>noteAction({action:'import',source:d.querySelector('#note-source').value,meetingAt:d.querySelector('#note-at').value,body:d.querySelector('#note-body').value,summary:d.querySelector('#note-summary').value,consentConfirmed:d.querySelector('#note-consent').checked},noteImport);
 d.querySelectorAll('[data-note-undo],[data-note-approve]').forEach(b=>b.onclick=()=>{const action=b.dataset.noteUndo?'undo':'approve',[noteId,index]=(b.dataset.noteUndo||b.dataset.noteApprove).split(':');const raw=action==='approve'?d.querySelector('#fact-'+noteId+'-'+index).value:null;if(action==='approve'&&raw===''){d.querySelector('#editerror').textContent='確認した数値を入力してください';return;}if(confirm(action==='undo'?'反映前の値へ戻しますか？後から変更された値は上書きしません。':'根拠と現在の値を確認しましたか？この項目を指定値で更新します。'))noteAction({action,noteId,index:Number(index),value:raw===null?undefined:Number(raw)},b);});
 d.querySelectorAll('[data-mtgsync]').forEach(btn=>btn.onclick=async()=>{
  if(btn.disabled)return;
  const [kind,action]=btn.dataset.mtgsync.split(':');

  if(meetingFormChanged(record,kind,Object.fromEntries(new FormData(d.querySelector('#meetingform'))))){toast('未保存の変更があります。先に「内容・日時を保存」で保存してからMTG連携を実行してください');return;}
  btn.disabled=true;const draft=captureNoteDraft();
  try{
   const request={orgId:record.id,kind,action,revision:state.revision};
   const plan=await api('orgsales/meeting-preview','POST',request);
   if(!d.open){btn.disabled=false;return;}
   if(!await confirmMeetingPlan({...plan,action})){btn.disabled=false;return;}
   if(!d.open)return;
   const r=await api('orgsales/meeting','POST',{...request,confirmation:plan.confirmation});
   // サーバー側は、Zoom/カレンダーの外部呼び出し中に他端末が無関係な箇所を編集していても、その編集を
   // 保持したまま最新revisionへ自動的に追従して保存を完了させることがある（saveSyncReconciled）。
   // ここで該当団体だけをstateへ上書きしてrevisionだけ進めると、他端末の編集内容はローカルのstateに
   // 反映されないまま「最新revisionを持つ古いスナップショット」になり、次のpersist()が競合を検知できず
   // 他端末の変更を無言で上書きしてしまう（Codex独立レビュー指摘）。ワークスペース全体を再取得する。
   state=await api('data');
   toast(r.warnings?.length?r.warnings.join(' / '):'MTGを更新しました');
   render();meetingEditor(state.orgSales.find(x=>x.id===record.id),kind,draft);
  }catch(e){
   const message=e.message;toast(message);
   try{state=await api('data');render();const current=state.orgSales.find(x=>x.id===record.id);if(current&&!current.deletedAt)meetingEditor(current,kind,draft);else d.close();const error=document.querySelector('#editerror');if(error)error.textContent=message;}
   catch{d.close();toast('最新の状態を取得できません。更新してから再度操作してください');}
  }
 });
 document.querySelector('#close').onclick=document.querySelector('#cancel').onclick=()=>d.close();
 d.querySelector('#meetingform').onsubmit=async e=>{
  e.preventDefault();const button=d.querySelector('#save');if(button.disabled||busy)return;button.disabled=true;
  try{const draft=captureNoteDraft();const row=saveMeetingFields(record,kind,Object.fromEntries(new FormData(e.target)));
   await persist({...state,orgSales:state.orgSales.map(o=>o.id===record.id?row:o)});
   meetingEditor(state.orgSales.find(o=>o.id===record.id),kind,draft);
  }catch(error){d.querySelector('#editerror').textContent=error.message;button.disabled=false;}
 };
}
function orgEditor(record){const d=document.querySelector('#editor');
 d.innerHTML=renderOrgEditor(record,esc,today());d.showModal();
 document.querySelector('#close').onclick=document.querySelector('#cancel').onclick=()=>d.close();
 document.querySelector('#orgform').onsubmit=async e=>{e.preventDefault();const b=document.querySelector('#save');b.disabled=true;try{
  const vals=Object.fromEntries(new FormData(e.target));
  const numFields=['sampleQty','sampleCost','shippingCost','trialUsers','desiredQty','proposedQty','confirmedQty','paidQty','paidRevenue','paidCost'];
  for(const n of numFields)vals[n]=vals[n]===''?null:Number(vals[n]);
  const now=new Date().toISOString();
  const base=record||{...newOrg(),id:crypto.randomUUID()};
  const stageChanged=!record||record.stage!==vals.stage;
  const history=stageChanged?[...base.history,{stage:vals.stage,at:now,note:vals.stageNote||''}]:base.history;
  const row={...base,name:vals.name,partyType:vals.partyType||base.partyType||'organization',category:vals.category,size:vals.size,assignee:vals.assignee,contact:vals.contact,
   stage:vals.stage,sampleQty:vals.sampleQty,sampleCost:vals.sampleCost,shippingCost:vals.shippingCost,trialUsers:vals.trialUsers,desiredQty:vals.desiredQty,proposedQty:vals.proposedQty,confirmedQty:vals.confirmedQty,
   feedback:vals.feedback,proposal:vals.proposal,paidQty:vals.paidQty,paidRevenue:vals.paidRevenue,paidCost:vals.paidCost,
   lostReason:vals.lostReason,nextAction:vals.nextAction,nextDue:vals.nextDue,notes:vals.notes,updatedAt:now,history,deletedAt:base.deletedAt??null};
  const next={...state,orgSales:record?state.orgSales.map(x=>x.id===record.id?row:x):[...state.orgSales,row]};
  await persist(next);
 }catch(err){const t=document.querySelector('#editerror');if(t)t.textContent=err.message;else toast(err.message);b.disabled=false;}};
 const del=document.querySelector('#delete');if(del)del.onclick=async()=>{if(hasOutstandingMeetings(record)){toast('会議が残っています。先にMTGを取消し、完了を確認してください。処理中・結果不明の場合は管理者へ確認してください');return;}if(!confirm('この団体を削除しますか？'))return;try{await persist({...state,orgSales:state.orgSales.map(x=>x.id===record.id?{...x,deletedAt:new Date().toISOString()}:x)});}catch(e){toast(e.message);}};
 const toTask=document.querySelector('#orgtotask');if(toTask)toTask.onclick=async()=>{try{
  const task={id:crypto.randomUUID(),title:'['+record.name+'] '+record.nextAction,assignee:record.assignee||'',due:record.nextDue||today(),priority:'中',status:'未着手',relatedOrg:record.name,relatedPlayer:'',relatedPost:'',nextAction:record.nextAction,notes:'',updatedAt:new Date().toISOString()};
  await persist({...state,staffTasks:[...state.staffTasks,task]});toast('担当タスクに追加しました');
 }catch(e){toast(e.message);}};}
load().catch(e=>{app.innerHTML=`<main class="auth"><div class="authbox"><h1>読み込めませんでした</h1><p>${esc(e.message)}</p><a class="secondary" href="/">再読み込み</a></div></main>`;});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
// ---------- サイト掲載（公開サイトと共有する情報） ----------
let site=null,siteTab='products';
const PUBLIC_API=()=>location.origin+'/api/public/site';
const statusLabel={available:'販売中',soldout:'SOLD OUT',hidden:'表示しない'};
function previewOf(d){return {products:d.products.filter(p=>p.published).sort((a,b)=>a.sortOrder-b.sortOrder).map(({published,sortOrder,...p})=>p),news:d.news.filter(n=>n.published).sort((a,b)=>b.date.localeCompare(a.date)).map(({published,...n})=>n),players:(d.players||[]).filter(p=>p.published).sort((a,b)=>a.sortOrder-b.sortOrder).map(({published,sortOrder,...p})=>p),philosophy:d.philosophy,links:d.links};}
function siteDiff(){const next=previewOf(site.draft),cur=site.published||{products:[],news:[],players:[],philosophy:null,links:null};const out=[];
 for(const [key,label,name] of [['products','商品','name'],['news','お知らせ','title'],['players','選手掲載','name']]){const a=new Map((cur[key]||[]).map(x=>[x.id,x])),b=new Map(next[key].map(x=>[x.id,x]));
  for(const [id,x] of b){const old=a.get(id);if(!old)out.push(`＋ ${label}を掲載: ${x[name]}`);else{const f=Object.keys(x).filter(k=>JSON.stringify(x[k])!==JSON.stringify(old[k]));if(f.length)out.push(`✎ ${label}を変更: ${x[name]}（${f.join('、')}）`);}}
  for(const [id,x] of a)if(!b.has(id))out.push(`− ${label}を掲載終了: ${x[name]}`);}
 if(JSON.stringify(next.philosophy)!==JSON.stringify(cur.philosophy))out.push('✎ ブランド理念を変更');
 if(JSON.stringify(next.links)!==JSON.stringify(cur.links))out.push('✎ 購入先リンクを変更');return out;}
function siteView(){if(!site)return '<section class="panel"><p>読み込み中…</p></section>';const d=site.draft;const diff=siteDiff();
 const tabs=[['products','商品'],['news','お知らせ'],['players','選手掲載'],['philosophy','ブランド理念・リンク'],['publish',`公開${diff.length?`（未公開の変更 ${diff.length}）`:''}`]];
 return `<section class="panel"><div class="panelhead"><h2>公開サイトと共有する情報</h2><span class="badge ${diff.length?'warn':'ok'}">${diff.length?'未公開の変更あり':'公開中の内容と同じ'}</span></div><p>ここで編集した内容は下書きとして保存され、「公開」タブで差分を確認して公開したときだけ公開用API（<code>/api/public/site</code>）に反映されます。注文・顧客情報や業務データは公開APIに含まれません。</p><p class="note">公開サイト側がこのAPIを読み込むようになるまで、サイトの表示は変わりません。</p><div class="actions" role="tablist">${tabs.map(([k,l])=>`<button class="${siteTab===k?'primary':'secondary'}" data-sitetab="${k}">${l}</button>`).join('')}</div></section>
 ${siteTab==='products'?`<section class="panel"><div class="panelhead"><h2>商品 <small>${d.products.length} 件</small></h2><button class="primary" id="addproduct">＋ 商品を追加</button></div>${d.products.length?`<div class="records">${[...d.products].sort((a,b)=>a.sortOrder-b.sortOrder).map(p=>`<article class="record"><div class="recordtop"><span class="badge ${p.published?'ok':''}">${p.published?'掲載':'非掲載'}</span><button data-editproduct="${esc(p.id)}">編集</button></div><h3>${esc(p.name)}</h3><div class="goalnumber">${yen(p.price)}</div><p class="note">${esc(p.badge?'【'+p.badge+'】':'')}${esc(p.description.slice(0,80))}</p><p>Amazon：${statusLabel[p.amazonStatus]} / 自社EC：${statusLabel[p.storeStatus]}<br>表示順：${p.sortOrder}</p></article>`).join('')}</div>`:empty('商品はまだ登録されていません。','サイトに掲載する商品を追加できます。')}</section>`:''}
 ${siteTab==='news'?`<section class="panel"><div class="panelhead"><h2>お知らせ <small>${d.news.length} 件</small></h2><button class="primary" id="addnews">＋ お知らせを追加</button></div>${d.news.length?[...d.news].sort((a,b)=>b.date.localeCompare(a.date)).map(n=>`<div class="listrow"><div class="grow"><b>${esc(n.title)}</b><small>${esc(n.date)} · ${n.published?'掲載':'非掲載'}</small></div><button data-editnews="${esc(n.id)}">編集</button></div>`).join(''):empty('お知らせはまだありません。','新商品や入荷情報などを掲載できます。')}</section>`:''}
 ${siteTab==='players'?(()=>{const dp=d.players||[];const provided=state.playerCandidates.filter(x=>x.tier==='提供済み'&&!x.deletedAt);const added=new Set(dp.map(p=>p.name+'|'+p.league));const pickable=provided.filter(x=>!added.has(x.name+'|'+x.league));
  return `<section class="panel"><div class="panelhead"><h2>選手掲載 <small>${dp.length} 件</small></h2></div><p class="note">「提供済み」の候補だけがここに追加できます。追加しただけでは公開されません。「掲載する」にチェックして「公開」タブで反映してください。</p>
  ${dp.length?`<div class="records">${[...dp].sort((a,b)=>a.sortOrder-b.sortOrder).map(p=>`<article class="record"><div class="recordtop"><span class="badge ${p.published?'ok':''}">${p.published?'掲載':'非掲載'}</span><button data-editplayer="${esc(p.id)}">編集</button></div><h3>${esc(p.name)}</h3><p class="note">${esc(p.league)} · ${esc(p.affiliation||'所属未入力')} · 表示順 ${p.sortOrder}</p></article>`).join('')}</div>`:empty('サイト掲載の選手はまだありません。','下の「提供済み」候補から追加できます。')}
  <h3>「提供済み」候補から追加</h3>${pickable.length?`<div class="records">${pickable.map(x=>`<div class="listrow"><div class="grow"><b>${esc(x.name)}</b><small>${esc(x.league)} · ${esc(x.affiliation||'所属未入力')}</small></div><button data-addsiteplayer="${esc(x.id)}">サイト掲載に追加</button></div>`).join('')}</div>`:'<p class="note">追加できる「提供済み」候補がありません（選手候補画面で区分を「提供済み」に変更してください）。</p>'}</section>`;})():''}
 ${siteTab==='philosophy'?`<form id="philform" class="panel brandform"><div class="panelhead"><h2>ブランド理念</h2><div class="actions"><button type="button" class="secondary" id="frombrand">「ブランド」画面から取り込む</button><button class="primary">下書き保存</button></div></div><p class="note">サイトの Philosophy に表示する文章です。ご自身の言葉で入力してください。</p>${[['origin','立ち上げた想い（起源）'],['mission','Mission（見出し）'],['missionNote','Mission（説明）'],['vision','Vision（見出し）'],['visionNote','Vision（説明）']].map(([k,l])=>`<label><span></span><span>${l}</span><textarea name="${k}" rows="3" maxlength="5000">${esc(d.philosophy[k])}</textarea></label>`).join('')}<label><span></span><span>Values<small>1行に「見出し｜説明」</small></span><textarea name="values" rows="4">${esc(d.philosophy.values.map(v=>v.title+(v.body?'｜'+v.body:'')).join('\n'))}</textarea></label><h3>購入先リンク（https のみ）</h3>${[['amazon','Amazon'],['store','自社EC'],['wholesale','卸・法人のお問い合わせ']].map(([k,l])=>`<label><span></span><span>${l}</span><input name="link_${k}" type="url" value="${esc(d.links[k])}" placeholder="https://"></label>`).join('')}</form>`:''}
 ${siteTab==='publish'?`<section class="panel"><h2>公開前の差分</h2>${diff.length?`<ul>${diff.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><div class="actions"><button class="primary" id="publishsite">この内容で公開する</button></div>`:'<p>公開中の内容と下書きに差はありません。</p>'}<dl class="facts"><dt>最終公開</dt><dd>${site.published?fmtTime(site.published.publishedAt):'まだ公開していません'}</dd><dt>公開API</dt><dd><a href="/api/public/site" target="_blank" rel="noopener">${esc(PUBLIC_API())}</a></dd></dl>${site.published?'<button class="secondary" id="rollbacksite">1つ前の公開内容に戻す</button>':''}</section>`:''}`;}
async function saveSite(draft){const r=await api('site','PUT',{draft,revision:site.revision});site={...site,draft,revision:r.revision};render();toast('下書きを保存しました（まだ公開されていません）');}
function siteEditor(kind,item){const d=document.querySelector('#editor');const isP=kind==='product';const isPlayer=kind==='player';
 const r=item||(isP?{name:'',price:0,description:'',badge:'',image:'',amazonUrl:site.draft.links.amazon,storeUrl:site.draft.links.store,amazonStatus:'available',storeStatus:'available',sortOrder:site.draft.products.length+1,published:false}:isPlayer?{name:'',league:'Jリーグ',affiliation:'',position:'',note:'',photo:'',photoCredit:'',photoSourceUrl:'',profileUrl:'',sortOrder:(site.draft.players||[]).length+1,published:false}:{date:today(),title:'',body:'',url:'',published:false});
 const sel=(n,v)=>`<select name="${n}">${Object.entries(statusLabel).map(([k,l])=>`<option value="${k}" ${v===k?'selected':''}>${l}</option>`).join('')}</select>`;
 d.innerHTML=`<form id="siteform"><div class="panelhead"><h2>${isP?'商品':isPlayer?'選手掲載':'お知らせ'}${item?'を編集':'を追加'}</h2><button type="button" id="close" aria-label="閉じる">✕</button></div><div class="formfields">${isP?`<label>商品名<input name="name" required maxlength="120" value="${esc(r.name)}"></label><label>価格（円・税込）<input name="price" type="number" min="0" step="1" required value="${esc(r.price)}"></label><label>バッジ（例: 一番人気）<input name="badge" maxlength="30" value="${esc(r.badge)}"></label><label>表示順<input name="sortOrder" type="number" min="0" max="9999" step="1" value="${esc(r.sortOrder)}"></label><label>説明<textarea name="description" maxlength="2000">${esc(r.description)}</textarea></label><label>画像（https のURL、またはサイト内のパス 例: /products/black.jpg）<input name="image" maxlength="2000" value="${esc(r.image)}"></label><label>AmazonのURL<input name="amazonUrl" type="url" value="${esc(r.amazonUrl)}"></label><label>Amazonの状態${sel('amazonStatus',r.amazonStatus)}</label><label>自社ECのURL<input name="storeUrl" type="url" value="${esc(r.storeUrl)}"></label><label>自社ECの状態${sel('storeStatus',r.storeStatus)}</label>`:isPlayer?`<label>選手名<input name="name" required maxlength="200" value="${esc(r.name)}"></label><label>リーグ区分<select name="league"><option value="Jリーグ" ${r.league==='Jリーグ'?'selected':''}>Jリーグ</option><option value="海外" ${r.league==='海外'?'selected':''}>海外</option></select></label><label>所属<input name="affiliation" maxlength="200" value="${esc(r.affiliation)}"></label><label>ポジション<input name="position" maxlength="200" value="${esc(r.position)}"></label><label>表示順<input name="sortOrder" type="number" min="0" max="9999" step="1" value="${esc(r.sortOrder)}"></label><label>紹介文<textarea name="note" maxlength="2000">${esc(r.note)}</textarea></label><label>写真URL（https・権利確認済みのみ）<input name="photo" type="url" maxlength="2000" value="${esc(r.photo)}"></label><label>写真の権利者・出典（写真を使う場合は必須）<input name="photoCredit" maxlength="500" value="${esc(r.photoCredit)}"></label><label>写真のライセンス確認URL（写真を使う場合は必須）<input name="photoSourceUrl" type="url" maxlength="2000" value="${esc(r.photoSourceUrl)}"></label><label>公式プロフィールURL<input name="profileUrl" type="url" maxlength="2000" value="${esc(r.profileUrl)}"></label>`:`<label>日付<input name="date" type="date" required value="${esc(r.date)}"></label><label>タイトル<input name="title" required maxlength="200" value="${esc(r.title)}"></label><label>本文<textarea name="body" maxlength="5000">${esc(r.body)}</textarea></label><label>リンク（任意・https）<input name="url" type="url" value="${esc(r.url)}"></label>`}<label><span><input type="checkbox" name="published" ${r.published?'checked':''} class="inlinecheck"> サイトに掲載する</span></label></div><div id="editerror" role="alert"></div><div class="dialogactions">${item?'<button type="button" id="delete" class="red">削除</button>':''}<button type="button" id="cancel">キャンセル</button><button class="primary" id="save">下書き保存</button></div></form>`;d.showModal();
 document.querySelector('#close').onclick=document.querySelector('#cancel').onclick=()=>d.close();
 const key=isP?'products':isPlayer?'players':'news';
 document.querySelector('#siteform').onsubmit=async e=>{e.preventDefault();const b=document.querySelector('#save');b.disabled=true;try{const v=Object.fromEntries(new FormData(e.target));const row={...r,...v,id:item?.id||crypto.randomUUID(),published:!!v.published};if(isP||isPlayer){row.sortOrder=Number(v.sortOrder||0);if(isP){row.price=Number(v.price);if(!Number.isInteger(row.price))throw Error('価格は整数（円）で入力してください');}}if(isPlayer&&row.photo&&(!row.photoCredit?.trim()||!row.photoSourceUrl))throw Error('写真を掲載する場合は、写真の権利者・出典とライセンス確認URLの両方が必須です');const next=structuredClone(site.draft);next[key]=item?(next[key]||[]).map(x=>x.id===item.id?row:x):[...(next[key]||[]),row];await saveSite(next);d.close();}catch(x){document.querySelector('#editerror').textContent=x.message;b.disabled=false;}};
 const del=document.querySelector('#delete');if(del)del.onclick=async()=>{if(!confirm('下書きから削除しますか？（公開中のサイトには、次に公開するまで残ります）'))return;try{const next=structuredClone(site.draft);next[key]=(next[key]||[]).filter(x=>x.id!==item.id);await saveSite(next);d.close();}catch(x){toast(x.message);}};}
function bindSite(){if(section!=='site'||!site)return;
 document.querySelectorAll('[data-sitetab]').forEach(b=>b.onclick=()=>{siteTab=b.dataset.sitetab;render();});
 const ap=document.querySelector('#addproduct');if(ap)ap.onclick=()=>siteEditor('product');const an=document.querySelector('#addnews');if(an)an.onclick=()=>siteEditor('news');
 document.querySelectorAll('[data-editproduct]').forEach(b=>b.onclick=()=>siteEditor('product',site.draft.products.find(p=>p.id===b.dataset.editproduct)));
 document.querySelectorAll('[data-editnews]').forEach(b=>b.onclick=()=>siteEditor('news',site.draft.news.find(n=>n.id===b.dataset.editnews)));
 document.querySelectorAll('[data-editplayer]').forEach(b=>b.onclick=()=>siteEditor('player',(site.draft.players||[]).find(p=>p.id===b.dataset.editplayer)));
 document.querySelectorAll('[data-addsiteplayer]').forEach(b=>b.onclick=async()=>{const c=state.playerCandidates.find(x=>x.id===b.dataset.addsiteplayer);if(!c||c.tier!=='提供済み')return;
  const hasAttributedPhoto=/^https:\/\//.test(c.photoUrl||'')&&c.photoCredit?.trim()&&/^https:\/\//.test(c.photoSourceUrl||'');
  const row={id:crypto.randomUUID(),name:c.name,league:c.league,affiliation:c.affiliation||'',position:c.position||'',note:c.brandFitReason||'',photo:hasAttributedPhoto?c.photoUrl:'',photoCredit:hasAttributedPhoto?c.photoCredit:'',photoSourceUrl:hasAttributedPhoto?c.photoSourceUrl:'',profileUrl:c.profileUrl||'',sortOrder:(site.draft.players||[]).length+1,published:false};
  try{await saveSite({...site.draft,players:[...(site.draft.players||[]),row]});toast('サイト掲載の下書きに追加しました（まだ非公開です）');}catch(x){toast(x.message);}});
 const pf=document.querySelector('#philform');if(pf){pf.onsubmit=async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(pf));const next=structuredClone(site.draft);next.philosophy={origin:v.origin,mission:v.mission,missionNote:v.missionNote,vision:v.vision,visionNote:v.visionNote,values:v.values.split('\n').map(x=>x.trim()).filter(Boolean).map(x=>{const [t,...rest]=x.split('｜');return {title:t.trim(),body:rest.join('｜').trim()};})};next.links={amazon:v.link_amazon,store:v.link_store,wholesale:v.link_wholesale};try{await saveSite(next);}catch(x){toast(x.message);}};
  document.querySelector('#frombrand').onclick=()=>{const b=state.brand;pf.origin.value=b.起源||pf.origin.value;pf.mission.value=b.Mission||pf.mission.value;pf.vision.value=b.Vision||pf.vision.value;if(b.Values)pf.values.value=b.Values;toast('「ブランド」画面の内容を入れました。確認して「下書き保存」を押してください');};}
 const pub=document.querySelector('#publishsite');if(pub)pub.onclick=async()=>{if(!confirm('表示中の差分を公開用APIに反映します。よろしいですか？'))return;pub.disabled=true;try{await api('site/publish','POST',{revision:site.revision});site=await api('site');render();toast('公開しました');}catch(x){toast(x.message);pub.disabled=false;}};
 const rb=document.querySelector('#rollbacksite');if(rb)rb.onclick=async()=>{if(!confirm('公開APIの内容を1つ前の公開に戻します（下書きは変わりません）。よろしいですか？'))return;try{await api('site/rollback','POST',{});site=await api('site');render();toast('1つ前の公開内容に戻しました');}catch(x){toast(x.message);}};}

function bindFinance(){
 const file=document.querySelector('#financefile');if(file)file.onchange=async()=>{const f=file.files[0];if(!f)return;try{if(f.size>5*1024*1024)throw Error('5MB以下のJSONを選択してください。');const report=validateFinanceReport(JSON.parse(await f.text()));if(!state||section!=='finance')return;financeReport=report;render();toast('利益レポートを読み込みました');}catch(e){toast(e.message);file.value='';}};
 const clear=document.querySelector('#financeclear');if(clear)clear.onclick=()=>{financeReport=null;render();};
 const filter=document.querySelector('#financefilter');if(filter)filter.onchange=()=>{let count=0;document.querySelectorAll('[data-profit-status]').forEach(row=>{row.hidden=filter.value==='candidate'?row.dataset.profitStatus!=='candidate':filter.value==='attention'?row.dataset.profitStatus==='candidate':false;if(!row.hidden)count++;});document.querySelector('#financecount').textContent=count+' 商品';};
}
