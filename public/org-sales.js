// 団体営業管理。DM→ZOOM(省略可)→サンプル→試用→提案ZOOM(省略可)→有償導入→継続購入。
// 段階は履歴（history）に追記するだけで、スキップ・後戻りも消さずに残す。
export const ORG_STAGES=['DM送信','初回ZOOM予約','初回ZOOM実施','サンプル発送','到着確認','試用確認','活用法提案ZOOM予約','活用法提案ZOOM実施','有償導入','継続購入'];
export const ORG_SIDE_STAGES=['返信待ち','保留','失注','連絡不要'];
export const ORG_ALL_STAGES=[...ORG_STAGES,...ORG_SIDE_STAGES];
export const ORG_PHASES=[['DM','DM送信'],['ZOOM','初回ZOOM予約','初回ZOOM実施'],['サンプル','サンプル発送','到着確認'],['試用','試用確認'],['活用法提案ZOOM','活用法提案ZOOM予約','活用法提案ZOOM実施'],['導入','有償導入','継続購入']];
import {googleCalendarDraft} from './meeting-links.js';
export const ORG_STAFF=['入戸野','竹田','植松'];

export const newOrg=()=>({category:'',size:'',assignee:'',contact:'',stage:'DM送信',
 sampleQty:null,sampleCost:null,shippingCost:null,trialUsers:null,feedback:'',proposal:'',
 initialMeetingContent:'初回ZOOM',proposalMeetingContent:'活用法提案ZOOM',initialZoomAt:'',initialZoomUrl:'',proposalZoomAt:'',proposalZoomUrl:'',initialMeetingSync:null,proposalMeetingSync:null,
 paidQty:null,paidRevenue:null,paidCost:null,lostReason:'',nextAction:'',nextDue:'',notes:'',history:[]});

function fmtN(v){return v===null||v===undefined?'未入力':Number(v).toLocaleString('ja-JP');}
// historyのatはnew Date().toISOString()（UTC）で保存されている。アプリの他の箇所は一貫して日本時間の
// 日付・月で期間を扱っているため、ここでUTCのまま先頭10/7文字を切り出すと、日本時間の深夜〜朝（UTCでは
// 前日）に発生したイベントが1日前の日付・前月の月として扱われ、期間フィルタやコホート集計から
// 取りこぼされる（Codex独立レビュー指摘）。必ず日本時間に変換してから日付・月を取り出す。
const jstDate=at=>new Date(at).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
const jstMonth=at=>jstDate(at).slice(0,7);
function stageDate(history,stage){const h=[...history].reverse().find(x=>x.stage===stage);return h?jstDate(h.at):null;}

// DM送信より先の「前進」段階（初回ZOOM予約〜継続購入）だけが、実際に返信・応答があったことを意味する。
// 返信待ち・保留・失注・連絡不要（ORG_SIDE_STAGES）は返信の有無を確定しない（連絡なしでも失注・連絡不要に
// 移すことがある）ため、これらへの移動を「返信あり」として数えてはいけない（Codex独立レビュー指摘）。
const REPLY_CONFIRMED_STAGES=new Set(ORG_STAGES.slice(1));

const STALLED_DAYS=14;
// 「停滞」= 失注・連絡不要・継続購入（最終段階）以外で、直近の段階変化から14日以上動きがない案件。
function isStalled(o,today){
 if(['失注','連絡不要','継続購入'].includes(o.stage))return false;
 const last=o.history.length?jstDate(o.history[o.history.length-1].at):null;
 if(!last)return false;
 const days=(new Date(today)-new Date(last))/86400000;
 return days>=STALLED_DAYS;
}
const orgSearchHay=o=>[o.name,o.category,o.assignee,o.stage,o.nextAction].join(' ').toLowerCase();
function orgRow(o,esc,today){
 const late=o.nextDue&&o.nextDue<today&&!['失注','継続購入'].includes(o.stage);
 const stalled=isStalled(o,today);
 const stageIndex=ORG_PHASES.findIndex(([, ...stages])=>stages.includes(o.stage));
 const step=stageIndex<0?o.stage:ORG_PHASES[stageIndex][0];
 return `<div class="listrow" data-search="${esc(orgSearchHay(o))}"><div class="grow"><b>${esc(o.name)}</b><small>${esc(o.category||'未入力')} · 担当${esc(o.assignee||'未設定')}${o.nextAction?' · 次: '+esc(o.nextAction)+(o.nextDue?'（'+esc(o.nextDue)+'）':''):''}${late?' · 期限超過':''}${stalled?' · 停滞中（'+STALLED_DAYS+'日以上動きなし）':''}</small><small>営業フェーズ: ${esc(step)}</small></div><span class="badge ${ORG_SIDE_STAGES.includes(o.stage)?'warn':'ok'}">${esc(o.stage)}</span>${stalled?'<span class="badge warn">停滞</span>':''}<button data-editorg="${esc(o.id)}">編集</button></div>`;
}

export function renderOrgList(orgs,ui,esc,today){
 const active=orgs.filter(x=>!x.deletedAt);
 // 検索欄（#orgsearch）はこれまで入力時のDOM直接操作（行の表示/非表示）だけで絞り込んでおり、ui.qは
 // レンダリングでは使われていなかった。段階・担当の切替や保存など、検索と無関係な操作でrender()が
 // 呼ばれるたびに一覧が再構築され、検索語は入力欄に残ったまま絞り込みだけが失われていた
 // （Codex独立レビュー指摘）。レンダリング自体もui.qで絞り込むことで、どの操作後でも一覧と件数が
 // 検索結果と一致するようにする。
 const q=(ui.q||'').trim().toLowerCase();
 const filtered=active.filter(x=>(ui.stage==='all'||x.stage===ui.stage)&&(ui.assignee==='all'||x.assignee===ui.assignee)&&(!q||orgSearchHay(x).includes(q)));
 const sorted=[...filtered].sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
 const stalledCount=active.filter(o=>isStalled(o,today)).length;
 const lateCount=active.filter(o=>o.nextDue&&o.nextDue<today&&!['失注','継続購入'].includes(o.stage)).length;
 return `<section class="panel"><h2>団体営業の進行フロー</h2><div class="orgpipeline" aria-label="DMから有償導入まで">${ORG_PHASES.map(([name],i)=>`<span class="orgphase">${i+1}. ${name}</span>`).join('<span class="orgarrow" aria-hidden="true">→</span>')}</div><details><summary>使い方・詳細</summary><p class="note">DM → 初回ZOOM → サンプル → 試してもらう → 活用法提案ZOOM → 有償導入。各段階の予約・実施・到着確認の詳細履歴は維持します。ZOOMはオンラインMTG、導入は有償購入のみを指します。</p></details>
 ${stalledCount||lateCount?`<div class="stats"><article><small>停滞案件（${STALLED_DAYS}日以上動きなし）</small><strong>${stalledCount}<em> 件</em></strong></article><article><small>次の行動が期限超過</small><strong>${lateCount}<em> 件</em></strong></article></div>`:''}</section><section class="panel"><div class="panelhead"><h2>団体一覧 <small id="orgcount">${sorted.length} / ${active.length} 件</small></h2><button class="primary" data-neworg>＋ 団体を追加</button></div>
 <div class="formfields"><label>段階<select id="orgstagefilter"><option value="all" ${ui.stage==='all'?'selected':''}>すべて</option>${ORG_ALL_STAGES.map(s=>`<option value="${s}" ${ui.stage===s?'selected':''}>${s}</option>`).join('')}</select></label><label>担当<select id="orgassigneefilter"><option value="all" ${ui.assignee==='all'?'selected':''}>全員</option>${ORG_STAFF.map(s=>`<option value="${s}" ${ui.assignee===s?'selected':''}>${s}</option>`).join('')}</select></label><label>検索<input id="orgsearch" value="${esc(ui.q||'')}" placeholder="団体名・次の行動など"></label></div>
 ${sorted.length?`<div class="records">${sorted.map(o=>orgRow(o,esc,today)).join('')}</div>`:'<div class="empty"><div aria-hidden="true">＋</div><b>団体はまだ登録されていません。</b><p>団体を追加できます。</p></div>'}</section>`;
}

// 対象期間（ISO日付文字列）内のhistory発生イベントから集計する。分子・分母・期間を明示する設計。
export function computeOrgKPI(orgs,start,end){
 const active=orgs.filter(x=>!x.deletedAt);
 const within=at=>{const d=jstDate(at);return (!start||d>=start)&&(!end||d<=end);};
 const uniq={};for(const s of ORG_ALL_STAGES)uniq[s]=new Set();
 let dmCount=0,zoomSchedCount=0,zoomDoneCount=0,sampleSentCount=0,arrivedCount=0,trialCount=0,proposalCount=0;
 for(const o of active)for(const h of o.history){
  if(!within(h.at))continue;
  uniq[h.stage]?.add(o.id);
  if(h.stage==='DM送信')dmCount++;
  if(h.stage==='初回ZOOM予約')zoomSchedCount++;
  if(h.stage==='初回ZOOM実施')zoomDoneCount++;
  if(h.stage==='サンプル発送')sampleSentCount++;
  if(h.stage==='到着確認')arrivedCount++;
  if(h.stage==='試用確認')trialCount++;
  if(h.stage==='活用法提案ZOOM実施')proposalCount++;
 }
 const paidQty=active.filter(o=>uniq['有償導入'].has(o.id)).reduce((n,o)=>n+(o.paidQty||0),0);
 const firstPurchase=active.filter(o=>uniq['有償導入'].has(o.id)).reduce((n,o)=>n+(o.paidRevenue||0),0);
 const repliedOrgs=new Set(active.filter(o=>o.history.some(h=>within(h.at)&&REPLY_CONFIRMED_STAGES.has(h.stage))).map(o=>o.id));
 const dmUniqueOrgs=uniq['DM送信'].size;
 return {start:start||'（指定なし）',end:end||'（指定なし）',dmCount,dmUniqueOrgs,
  repliedOrgs:repliedOrgs.size,zoomSchedCount,zoomDoneCount,sampleSentCount,arrivedCount,trialCount,proposalCount,
  paidOrgs:uniq['有償導入'].size,repeatOrgs:uniq['継続購入'].size,paidQty,firstPurchase};
}

function rate(num,den){return den>0?Math.round(num/den*1000)/10:null;}

export function renderOrgKPI(orgs,period,esc){
 const k=computeOrgKPI(orgs,period.start,period.end);
 const funnel=[['DM送信（通数）',k.dmCount,null],['DM送信先ユニーク団体',k.dmUniqueOrgs,null],
  ['返信あり団体（返信待ち・保留等ではなく実際に前進した団体）',k.repliedOrgs,k.dmUniqueOrgs],
  ['初回ZOOM予約',k.zoomSchedCount,k.dmUniqueOrgs],['初回ZOOM実施',k.zoomDoneCount,k.zoomSchedCount],
  ['サンプル発送',k.sampleSentCount,k.dmUniqueOrgs],['到着確認',k.arrivedCount,k.sampleSentCount],['試用確認',k.trialCount,k.arrivedCount],
  ['活用法提案ZOOM実施',k.proposalCount,k.trialCount],['有償導入団体',k.paidOrgs,k.dmUniqueOrgs],['継続購入団体',k.repeatOrgs,k.paidOrgs]];
 const active=orgs.filter(x=>!x.deletedAt);
 const cohorts={};
 for(const o of active){if(!o.history[0])continue;const month=jstMonth(o.history[0].at);(cohorts[month]??=[]).push(o);}
 const cohortRows=Object.entries(cohorts).sort((a,b)=>b[0].localeCompare(a[0])).map(([month,list])=>{
  const paid=list.filter(o=>o.history.some(h=>h.stage==='有償導入')).length;
  return `<tr><td>${esc(month)}</td><td>${list.length}</td><td>${paid}</td><td>${rate(paid,list.length)===null?'—':rate(paid,list.length)+'%'}</td></tr>`;
 }).join('');
 return `<section class="panel"><h2>集計期間</h2><div class="formfields"><label>開始日<input type="date" id="orgkpistart" value="${esc(period.start)}"></label><label>終了日<input type="date" id="orgkpiend" value="${esc(period.end)}"></label></div><p class="note">対象期間: ${esc(k.start)} 〜 ${esc(k.end)}（各段階に進んだ日付で集計。サンプル提供は売上・有償導入に数えていません）</p></section>
 <section class="panel"><h2>ファネルの分子・分母</h2><div class="tablewrap"><table class="data"><thead><tr><th>段階</th><th>件数</th><th>転換率（直前段階比）</th></tr></thead><tbody>${funnel.map(([label,n,den])=>`<tr><td>${esc(label)}</td><td>${n}</td><td>${den===null?'—':den>0?n+' / '+den+' 件（'+rate(n,den)+'%）':'母数0件'}</td></tr>`).join('')}</tbody></table></div></section>
 <section class="panel"><h2>導入実績</h2><div class="stats"><article><small>有償導入 購入個数</small><strong>${fmtN(k.paidQty)}</strong></article><article><small>初回購入額</small><strong>¥${fmtN(k.firstPurchase)}</strong></article><article><small>継続購入団体</small><strong>${k.repeatOrgs}<em> 件</em></strong></article></div></section>
 <section class="panel"><h2>開始月別の追跡</h2><p class="note">各団体の最初の履歴（通常はDM送信）が記録された月で分類します。</p>${cohortRows?`<div class="tablewrap"><table class="data"><thead><tr><th>開始月</th><th>団体数</th><th>有償導入</th><th>転換率</th></tr></thead><tbody>${cohortRows}</tbody></table></div>`:'<p>まだ集計できる団体がありません。</p>'}</section>`;
}

const SYNC_LABEL={creating:'Zoom作成処理中・重複作成防止',zoom_only:'Zoom作成済み・カレンダー未登録',synced:'連携済み（Zoom・カレンダーとも登録）',error:'一部失敗（再試行できます）',uncertain:'作成結果が不明（要確認）'};
// kind: 'initial'/'proposal' はlib/meeting-sync.jsのKINDSと一致させる（MTG同期APIへそのまま送るため）。
// meeting-links.jsのgoogleCalendarDraft()だけは既存の'intro'/'proposal'表記を使うので、ここで変換する。
function meetingBlock(o,kind,label,autoSync,esc){
 const draftKind=kind==='initial'?'intro':'proposal';
 const sync=kind==='initial'?o.initialMeetingSync:o.proposalMeetingSync;
 const atName=kind==='initial'?'initialZoomAt':'proposalZoomAt',urlName=kind==='initial'?'initialZoomUrl':'proposalZoomUrl';
 const atVal=o[atName]||'',urlVal=o[urlName]||'';
 const ready=autoSync?.zoomConnected&&autoSync?.calendarConnected&&!!o.id;
 const draftUrl=o.id?googleCalendarDraft(o,draftKind):null;
 return `<label>${label}の内容<input name="${kind}MeetingContent" maxlength="200" value="${esc(o[kind+'MeetingContent']||label)}"></label><label>${label}開始予定（日本時間）<input name="${atName}" type="datetime-local" value="${esc(atVal)}"></label>
 <label>${label}参加URL${ready?'（自動連携で設定されます）':'（任意・発行済みのみ）'}<input name="${urlName}" type="url" maxlength="2000" placeholder="https://..." value="${esc(urlVal)}" ${ready?'readonly':''}></label>
 ${(ready||sync)?`<div class="meetingsync"><span class="badge ${sync?.status==='synced'?'ok':sync?.status==='error'?'warn':sync?'warn':''}">${sync?SYNC_LABEL[sync.status]:'未作成'}</span>
 ${sync?.error?`<p class="note red">${esc(sync.error)}</p>`:''}
 <div class="actions">${ready&&(!sync||(['error','zoom_only'].includes(sync.status)&&!sync.cancelPending))?`<button type="button" class="secondary" data-mtgsync="${kind}:${sync?.zoomMeetingId?'create':'prepare'}">${sync?.zoomMeetingId?'URLを確認してカレンダー登録・招待':'確認してZoomを作成'}</button>`:''}
 ${ready&&sync?.status==='synced'?`<button type="button" class="secondary" data-mtgsync="${kind}:update">日程を同期し直す</button>`:''}
 ${sync&&sync.status!=='creating'?`<button type="button" class="red" data-mtgsync="${kind}:cancel">${sync.cancelPending?'取消を再試行':'MTGを取消'}</button>`:''}</div></div>`
 :draftUrl?`<a class="secondary" href="${esc(draftUrl)}" target="_blank" rel="noopener noreferrer">${label}の予定をGoogleカレンダーへ追加（手動で保存） ↗</a>`:''}`;
}
export function renderOrgEditor(org,esc,today,autoSync){
 const o=org||{...newOrg(),id:null,name:'',updatedAt:''};
 const hist=[...(o.history||[])].reverse();
 return `<form id="orgform"><div class="panelhead"><h2>団体を${org?.id?'編集':'追加'}</h2><button type="button" id="close" aria-label="閉じる">✕</button></div>
 <div class="formfields">
 <label>団体名<input name="name" required maxlength="200" value="${esc(o.name)}"></label>
 <label>競技・カテゴリ<input name="category" maxlength="200" value="${esc(o.category)}"></label>
 <label>規模<input name="size" maxlength="200" value="${esc(o.size)}"></label>
 <label>担当<select name="assignee"><option value="" ${!o.assignee?'selected':''}>未設定</option>${ORG_STAFF.map(s=>`<option value="${s}" ${o.assignee===s?'selected':''}>${s}</option>`).join('')}</select></label>
 <label>連絡先<input name="contact" maxlength="500" value="${esc(o.contact)}"></label>
 <label>現在の段階<select name="stage">${ORG_ALL_STAGES.map(s=>`<option value="${s}" ${o.stage===s?'selected':''}>${s}</option>`).join('')}</select></label>
 <label>段階変更のメモ（履歴に残ります）<input name="stageNote" maxlength="500" placeholder="例: 電話で合意"></label>
 <div class="orgmeeting"><h3>Googleカレンダー・ZOOM商談</h3><details><summary>使い方・詳細</summary><p class="note">${autoSync?.zoomConnected&&autoSync?.calendarConnected?'Zoom・Googleカレンダーとも接続済みです。日時・内容を保存後、Zoom作成→URL確認→カレンダー登録・招待の順に進めます。':'Zoom・Googleカレンダーの接続が完了するまでは、予定をアプリに保存し、Googleカレンダーの予定作成画面に事前入力する手動方式です。「設定・バックアップ」画面で接続できます。'}</p></details>
 ${meetingBlock(o,'initial','初回ZOOM',autoSync,esc)}
 ${meetingBlock(o,'proposal','活用法提案ZOOM',autoSync,esc)}
 <p class="note">${!o.id?'MTGの自動作成・更新・取消は団体を保存した後に利用できます。':'Zoom発行後にURLとゲストを確認し、カレンダー登録時に招待を送信します。更新・取消もゲストへ通知します。'}</p></div>
 <label>サンプル数量<input name="sampleQty" type="number" min="0" step="1" value="${o.sampleQty??''}"></label>
 <label>サンプル原価（円）<input name="sampleCost" type="number" min="0" step="1" value="${o.sampleCost??''}"></label>
 <label>送料（円）<input name="shippingCost" type="number" min="0" step="1" value="${o.shippingCost??''}"></label>
 <label>試用人数<input name="trialUsers" type="number" min="0" step="1" value="${o.trialUsers??''}"></label>
 <label>感想<textarea name="feedback" maxlength="2000">${esc(o.feedback)}</textarea></label>
 <label>提案内容<textarea name="proposal" maxlength="2000">${esc(o.proposal)}</textarea></label>
 <label>導入数量<input name="paidQty" type="number" min="0" step="1" value="${o.paidQty??''}"></label>
 <label>導入売上（円）<input name="paidRevenue" type="number" min="0" step="1" value="${o.paidRevenue??''}"></label>
 <label>導入費用（円）<input name="paidCost" type="number" min="0" step="1" value="${o.paidCost??''}"></label>
 <label>失注理由<textarea name="lostReason" maxlength="2000">${esc(o.lostReason)}</textarea></label>
 <label>次の行動<input name="nextAction" maxlength="500" value="${esc(o.nextAction)}"></label>
 <label>次の行動の期限<input name="nextDue" type="date" value="${esc(o.nextDue)}"></label>
 <label>メモ<textarea name="notes">${esc(o.notes)}</textarea></label>
 </div>
 ${o.nextAction?`<div class="actions"><button type="button" class="secondary" id="orgtotask">この次の行動を担当タスクに追加</button></div>`:''}
 <div id="editerror" role="alert"></div>
 <h3>段階の履歴</h3>
 ${hist.length?`<div class="records">${hist.map(h=>`<div class="listrow"><div class="grow"><b>${esc(h.stage)}</b><small>${esc(new Date(h.at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))}${h.note?' · '+esc(h.note):''}</small></div></div>`).join('')}</div>`:'<p class="note">まだ段階の履歴はありません（保存すると最初の履歴が記録されます）。</p>'}
 <div class="dialogactions">${org?.id?'<button type="button" id="delete" class="red">削除</button>':''}<button type="button" id="cancel">キャンセル</button><button class="primary" id="save">保存する</button></div></form>`;
}
