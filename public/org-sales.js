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
 initialZoomAt:'',initialZoomUrl:'',proposalZoomAt:'',proposalZoomUrl:'',
 paidQty:null,paidRevenue:null,paidCost:null,lostReason:'',nextAction:'',nextDue:'',notes:'',history:[]});

function fmtN(v){return v===null||v===undefined?'未入力':Number(v).toLocaleString('ja-JP');}
function stageDate(history,stage){const h=[...history].reverse().find(x=>x.stage===stage);return h?h.at.slice(0,10):null;}

function orgRow(o,esc,today){
 const late=o.nextDue&&o.nextDue<today&&!['失注','継続購入'].includes(o.stage);
 const stageIndex=ORG_PHASES.findIndex(([, ...stages])=>stages.includes(o.stage));
 const step=stageIndex<0?o.stage:ORG_PHASES[stageIndex][0];
 return `<div class="listrow" data-search="${esc([o.name,o.category,o.assignee,o.stage,o.nextAction].join(' ').toLowerCase())}"><div class="grow"><b>${esc(o.name)}</b><small>${esc(o.category||'未入力')} · 担当${esc(o.assignee||'未設定')}${o.nextAction?' · 次: '+esc(o.nextAction)+(o.nextDue?'（'+esc(o.nextDue)+'）':''):''}${late?' · 期限超過':''}</small><small>営業フェーズ: ${esc(step)}</small></div><span class="badge ${ORG_SIDE_STAGES.includes(o.stage)?'warn':'ok'}">${esc(o.stage)}</span><button data-editorg="${esc(o.id)}">編集</button></div>`;
}

export function renderOrgList(orgs,ui,esc,today){
 const active=orgs.filter(x=>!x.deletedAt);
 const filtered=active.filter(x=>(ui.stage==='all'||x.stage===ui.stage)&&(ui.assignee==='all'||x.assignee===ui.assignee));
 const sorted=[...filtered].sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
 return `<section class="panel"><h2>団体営業の進行フロー</h2><div class="orgpipeline" aria-label="DMから有償導入まで">${ORG_PHASES.map(([name],i)=>`<span class="orgphase">${i+1}. ${name}</span>`).join('<span class="orgarrow" aria-hidden="true">→</span>')}</div><p class="note">DM → 初回ZOOM → サンプル → 試してもらう → 活用法提案ZOOM → 有償導入。各段階の予約・実施・到着確認の詳細履歴は維持します。ZOOMはオンラインMTG、導入は有償購入のみを指します。</p></section><section class="panel"><div class="panelhead"><h2>団体一覧 <small id="orgcount">${sorted.length} / ${active.length} 件</small></h2><button class="primary" data-neworg>＋ 団体を追加</button></div>
 <div class="formfields"><label>段階<select id="orgstagefilter"><option value="all" ${ui.stage==='all'?'selected':''}>すべて</option>${ORG_ALL_STAGES.map(s=>`<option value="${s}" ${ui.stage===s?'selected':''}>${s}</option>`).join('')}</select></label><label>担当<select id="orgassigneefilter"><option value="all" ${ui.assignee==='all'?'selected':''}>全員</option>${ORG_STAFF.map(s=>`<option value="${s}" ${ui.assignee===s?'selected':''}>${s}</option>`).join('')}</select></label><label>検索<input id="orgsearch" value="${esc(ui.q||'')}" placeholder="団体名・次の行動など"></label></div>
 ${sorted.length?`<div class="records">${sorted.map(o=>orgRow(o,esc,today)).join('')}</div>`:'<div class="empty"><div aria-hidden="true">＋</div><b>団体はまだ登録されていません。</b><p>団体を追加できます。</p></div>'}</section>`;
}

// 対象期間（ISO日付文字列）内のhistory発生イベントから集計する。分子・分母・期間を明示する設計。
export function computeOrgKPI(orgs,start,end){
 const active=orgs.filter(x=>!x.deletedAt);
 const within=at=>{const d=at.slice(0,10);return (!start||d>=start)&&(!end||d<=end);};
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
 const repliedOrgs=new Set(active.filter(o=>o.history.some(h=>within(h.at)&&h.stage!=='DM送信')).map(o=>o.id));
 const dmUniqueOrgs=uniq['DM送信'].size;
 return {start:start||'（指定なし）',end:end||'（指定なし）',dmCount,dmUniqueOrgs,
  repliedOrgs:repliedOrgs.size,zoomSchedCount,zoomDoneCount,sampleSentCount,arrivedCount,trialCount,proposalCount,
  paidOrgs:uniq['有償導入'].size,repeatOrgs:uniq['継続購入'].size,paidQty,firstPurchase};
}

function rate(num,den){return den>0?Math.round(num/den*1000)/10:null;}

export function renderOrgKPI(orgs,period,esc){
 const k=computeOrgKPI(orgs,period.start,period.end);
 const funnel=[['DM送信（通数）',k.dmCount,null],['DM送信先ユニーク団体',k.dmUniqueOrgs,null],
  ['返信あり団体（DM以外の段階に進んだ団体）',k.repliedOrgs,k.dmUniqueOrgs],
  ['初回ZOOM予約',k.zoomSchedCount,k.dmUniqueOrgs],['初回ZOOM実施',k.zoomDoneCount,k.zoomSchedCount],
  ['サンプル発送',k.sampleSentCount,k.dmUniqueOrgs],['到着確認',k.arrivedCount,k.sampleSentCount],['試用確認',k.trialCount,k.arrivedCount],
  ['活用法提案ZOOM実施',k.proposalCount,k.trialCount],['有償導入団体',k.paidOrgs,k.dmUniqueOrgs],['継続購入団体',k.repeatOrgs,k.paidOrgs]];
 const active=orgs.filter(x=>!x.deletedAt);
 const cohorts={};
 for(const o of active){const first=o.history[0]?.at?.slice(0,7);if(!first)continue;(cohorts[first]??=[]).push(o);}
 const cohortRows=Object.entries(cohorts).sort((a,b)=>b[0].localeCompare(a[0])).map(([month,list])=>{
  const paid=list.filter(o=>o.history.some(h=>h.stage==='有償導入')).length;
  return `<tr><td>${esc(month)}</td><td>${list.length}</td><td>${paid}</td><td>${rate(paid,list.length)===null?'—':rate(paid,list.length)+'%'}</td></tr>`;
 }).join('');
 return `<section class="panel"><h2>集計期間</h2><div class="formfields"><label>開始日<input type="date" id="orgkpistart" value="${esc(period.start)}"></label><label>終了日<input type="date" id="orgkpiend" value="${esc(period.end)}"></label></div><p class="note">対象期間: ${esc(k.start)} 〜 ${esc(k.end)}（各段階に進んだ日付で集計。サンプル提供は売上・有償導入に数えていません）</p></section>
 <section class="panel"><h2>ファネルの分子・分母</h2><div class="tablewrap"><table class="data"><thead><tr><th>段階</th><th>件数</th><th>転換率（直前段階比）</th></tr></thead><tbody>${funnel.map(([label,n,den])=>`<tr><td>${esc(label)}</td><td>${n}</td><td>${den===null?'—':den>0?n+' / '+den+' 件（'+rate(n,den)+'%）':'母数0件'}</td></tr>`).join('')}</tbody></table></div></section>
 <section class="panel"><h2>導入実績</h2><div class="stats"><article><small>有償導入 購入個数</small><strong>${fmtN(k.paidQty)}</strong></article><article><small>初回購入額</small><strong>¥${fmtN(k.firstPurchase)}</strong></article><article><small>継続購入団体</small><strong>${k.repeatOrgs}<em> 件</em></strong></article></div></section>
 <section class="panel"><h2>開始月別の追跡</h2><p class="note">各団体の最初の履歴（通常はDM送信）が記録された月で分類します。</p>${cohortRows?`<div class="tablewrap"><table class="data"><thead><tr><th>開始月</th><th>団体数</th><th>有償導入</th><th>転換率</th></tr></thead><tbody>${cohortRows}</tbody></table></div>`:'<p>まだ集計できる団体がありません。</p>'}</section>`;
}

export function renderOrgEditor(org,esc,today){
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
 <div class="orgmeeting"><h3>Googleカレンダー・ZOOM商談</h3><p class="note">現在は予定をアプリに保存し、Googleカレンダーの予定作成画面に事前入力する方式です。Zoom会議の自動発行・予定の自動保存はまだ接続していません。既存のZOOM招待URLがあれば入力できます。</p>
 <label>初回ZOOM開始予定（日本時間）<input name="initialZoomAt" type="datetime-local" value="${esc(o.initialZoomAt||'')}"></label>
 <label>初回ZOOM参加URL（任意・発行済みのみ）<input name="initialZoomUrl" type="url" maxlength="2000" placeholder="https://..." value="${esc(o.initialZoomUrl||'')}"></label>
 ${googleCalendarDraft(o,'intro')?`<a class="secondary" href="${esc(googleCalendarDraft(o,'intro'))}" target="_blank" rel="noopener noreferrer">初回ZOOMの予定をGoogleカレンダーへ追加（手動で保存） ↗</a>`:''}
 <label>活用法提案ZOOM開始予定（日本時間）<input name="proposalZoomAt" type="datetime-local" value="${esc(o.proposalZoomAt||'')}"></label>
 <label>活用法提案ZOOM参加URL（任意・発行済みのみ）<input name="proposalZoomUrl" type="url" maxlength="2000" placeholder="https://..." value="${esc(o.proposalZoomUrl||'')}"></label>
 ${googleCalendarDraft(o,'proposal')?`<a class="secondary" href="${esc(googleCalendarDraft(o,'proposal'))}" target="_blank" rel="noopener noreferrer">提案ZOOMの予定をGoogleカレンダーへ追加（手動で保存） ↗</a>`:''}
 <p class="note">日程を入力・保存後に再度編集を開くと、Googleカレンダーへ追加するリンクが表示されます。参加者への招待や送信は手動で確認してください。</p></div>
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
