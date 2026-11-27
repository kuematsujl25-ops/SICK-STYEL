// リール→フォロー→購入の実験管理。購入数÷フォロワー数を実測の転換率と表示しない。
// Amazon等で注文との関連付けができない場合は未計測のまま残す（流入不明を捏造しない）。
export const STATUS=['仮説検証中','検証済み','保留'];
export const experimentFields=[
 ['title','実験名','text'],
 ['hypothesis','仮説','textarea'],
 ['relatedPosts','関連投稿','text'],
 ['targetProduct','対象商品','text'],
 ['cta','CTA','text'],
 ['trackingLink','計測リンク（UTM等）','text'],
 ['periodStart','観測開始日','date'],
 ['periodEnd','観測終了日','date'],
 ['metricsWatched','判断に使う数字','text'],
 ['measuredPurchases','計測できた購入件数（注文と紐付け可能な分のみ）','nnumber'],
 ['unmeasuredNote','流入不明・未計測の扱い','textarea'],
 ['result','結果','textarea'],
 ['nextAction','次の判断','text'],
 ['status','状態','select',STATUS],
];
function row(x,esc){
 return `<article class="record"><div class="recordtop"><span class="badge ${x.status==='検証済み'?'ok':x.status==='保留'?'warn':''}">${esc(x.status)}</span><button data-edit="growthExperiments:${esc(x.id)}">編集</button></div><h3>${esc(x.title)}</h3>
 <p class="note">${esc(x.periodStart||'開始日未設定')} 〜 ${esc(x.periodEnd||'終了日未設定')}${x.targetProduct?' · 対象: '+esc(x.targetProduct):''}</p>
 <p>仮説: ${esc(x.hypothesis)}</p>
 ${x.relatedPosts?`<p class="note">関連投稿: ${esc(x.relatedPosts)}</p>`:''}
 <div class="metricmini"><span>計測できた購入<b>${x.measuredPurchases===null?'未計測':x.measuredPurchases+'件'}</b></span></div>
 ${x.unmeasuredNote?`<p class="note">流入不明の扱い: ${esc(x.unmeasuredNote)}</p>`:''}
 ${x.result?`<p>結果: ${esc(x.result)}</p>`:''}
 ${x.nextAction?`<p class="note">次の判断: ${esc(x.nextAction)}</p>`:''}</article>`;
}
export function renderExperiments(items,ui,esc){
 const filtered=items.filter(x=>ui.status==='all'||x.status===ui.status);
 const sorted=[...filtered].sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
 return `<section class="panel"><div class="panelhead"><h2>購入につなげる実験 <small>${sorted.length} / ${items.length} 件</small></h2><button class="primary" data-new="growthExperiments">＋ 実験を追加</button></div>
 <p class="note">購入数をフォロワー数で割った値は実測の転換率として表示しません。注文データと紐付けできない流入は「未計測」のまま残します。少数の結果や単純な前後比較だけで効果を断定しないでください。</p>
 <div class="formfields"><label>状態<select id="experimentstatusfilter"><option value="all" ${ui.status==='all'?'selected':''}>すべて</option>${STATUS.map(s=>`<option value="${s}" ${ui.status===s?'selected':''}>${s}</option>`).join('')}</select></label></div>
 ${sorted.length?`<div class="records">${sorted.map(x=>row(x,esc)).join('')}</div>`:'<div class="empty"><div aria-hidden="true">＋</div><b>実験はまだ登録されていません。</b></div>'}</section>`;
}
