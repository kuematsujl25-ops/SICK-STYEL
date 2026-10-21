// 入戸野向け「集める数字」チェックリスト。外部への依頼送信はしない。アプリ内で状態を更新するだけ。
export const CATEGORIES=['商品・利益','購入者','営業','SNS'];
export const STATUS=['未収集','確認中','収集済み'];
export const STAFF=['入戸野','竹田','植松'];

const S=(title,purpose,source,frequency='月次')=>({title,purpose,source,frequency});
export const STANDARD_ITEMS={
 '商品・利益':[
  S('SKU別販売個数','売れ筋・在庫判断','自社EC・Amazon注文データ'),
  S('実売価格','値引き実態の把握','注文データ'),
  S('値引き額','粗利への影響確認','注文データ'),
  S('返品・返金','利益の二重計上防止','注文・返金データ'),
  S('仕入原価','粗利計算','仕入先請求書'),
  S('物流費','販売関連費用の控除','配送業者請求'),
  S('販売・決済手数料','貢献利益の計算','Amazon/BASE手数料明細'),
  S('広告費','貢献利益の計算','広告管理画面'),
  S('サンプル原価・送料','営業コストの把握','サンプル発送記録'),
  S('在庫','欠品・発注判断','在庫管理'),
  S('入荷予定','欠品時期の予測','仕入先への確認'),
  S('調達リードタイム','発注タイミングの判断','仕入先実績'),
 ],
 '購入者':[
  S('新規／リピート区分','顧客構成の把握','注文データ'),
  S('購入商品・数量','商品別需要の把握','注文データ'),
  S('客単価','販促効果の測定','注文データ'),
  S('流入元','集客チャネルの評価','注文データ・UTM'),
  S('購入理由','訴求の有効性確認','任意アンケート'),
  S('使用目的','商品開発・訴求の参考','任意アンケート'),
  S('競技・プレーレベル','ターゲットの把握','任意アンケート'),
  S('年齢帯（取得できた場合のみ）','ターゲットの把握','任意アンケート'),
 ],
 '営業':[
  S('各段階の団体数と日付','営業パイプライン管理','団体営業管理機能'),
  S('試用反応','サンプル効果の測定','団体営業管理機能'),
  S('導入・失注理由','営業改善の材料','団体営業管理機能'),
  S('初回購入','転換率の計算','団体営業管理機能'),
  S('再購入','継続率の計算','団体営業管理機能'),
 ],
 'SNS':[
  S('媒体別フォロワー推移','成長率の計算','各SNS公式インサイト'),
  S('投稿別の公開数字','コンテンツ評価','各SNS公式インサイト'),
  S('取得可能な自社インサイト','コンテンツ改善','各SNS公式インサイト'),
  S('プロフィール訪問','興味喚起度の確認','Instagramインサイト'),
  S('クリック','購入導線の評価','リンクトラッキング'),
  S('計測できた購入','投稿の購買貢献度','UTM・注文データ'),
 ],
};
export const allStandardItems=()=>CATEGORIES.flatMap(c=>STANDARD_ITEMS[c].map(i=>({category:c,...i})));

function row(x,esc){
 return `<div class="listrow" data-search="${esc([x.category,x.title,x.purpose,x.source,x.assignee].join(' ').toLowerCase())}"><div class="grow"><b>[${esc(x.category)}] ${esc(x.title)}</b><small>判断用途: ${esc(x.purpose||'未入力')} · 出典: ${esc(x.source||'未入力')} · 更新頻度: ${esc(x.frequency||'未入力')} · 担当${esc(x.assignee||'未設定')}${x.due?' · 期限'+esc(x.due):''}${x.period?' · 対象期間'+esc(x.period):''}${x.value?' · 値: '+esc(x.value.slice(0,40)):''}</small></div><span class="badge ${x.status==='収集済み'?'ok':x.status==='確認中'?'warn':''}">${esc(x.status)}</span><button data-edit="collectionTasks:${esc(x.id)}">編集</button></div>`;
}
export function renderCollectionTasks(items,ui,esc){
 const active=items.filter(x=>!x.deletedAt);
 const counts=Object.fromEntries(STATUS.map(s=>[s,active.filter(x=>x.status===s).length]));
 const filtered=active.filter(x=>(ui.category==='all'||x.category===ui.category)&&(ui.status==='all'||x.status===ui.status));
 const sorted=[...filtered].sort((a,b)=>CATEGORIES.indexOf(a.category)-CATEGORIES.indexOf(b.category)||(a.purpose||'').localeCompare(b.purpose||''));
 return `<div class="stats">${STATUS.map(s=>`<article><small>${esc(s)}</small><strong>${counts[s]}<em> 件</em></strong></article>`).join('')}</div>
 <section class="panel"><div class="panelhead"><h2>集める数字 <small id="collectcount">${sorted.length} / ${active.length} 件</small></h2><div class="actions"><button class="secondary" id="collectaddstandard">標準項目を追加</button><button class="primary" data-new="collectionTasks">＋ 項目を追加</button></div></div>
 <div class="formfields"><label>カテゴリ<select id="collectcategoryfilter"><option value="all" ${ui.category==='all'?'selected':''}>すべて</option>${CATEGORIES.map(c=>`<option value="${c}" ${ui.category===c?'selected':''}>${c}</option>`).join('')}</select></label><label>状態<select id="collectstatusfilter"><option value="all" ${ui.status==='all'?'selected':''}>すべて</option>${STATUS.map(s=>`<option value="${s}" ${ui.status===s?'selected':''}>${s}</option>`).join('')}</select></label></div>
 ${sorted.length?`<div class="records">${sorted.map(x=>row(x,esc)).join('')}</div>`:'<div class="empty"><div aria-hidden="true">＋</div><b>まだ項目がありません。</b><p>「標準項目を追加」で、A〜Dの代表的な収集項目をまとめて登録できます。</p></div>'}</section>`;
}
