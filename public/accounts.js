// 参考アカウント・投稿リスト。1回の観測では増加率を確認済みとしない。規模違いを再生数だけで順位付けしない。
export const PLATFORMS=['Instagram','TikTok','YouTube'];
export const accountFields=[
 ['accountName','アカウント名','text',undefined,undefined,true],
 ['platform','媒体','select',PLATFORMS],
 ['profileUrl','プロフィールURL','text'],
 ['postUrl','投稿URL','text'],
 ['genre','ジャンル','text'],
 ['observedAt','観測日','date',undefined,undefined,true],
 ['followers','フォロワー数','nnumber'],
 ['publicViews','公開再生数・反応','nnumber'],
 ['reaction','反応（任意メモ）','text'],
 ['referencePoint','参考にする点','textarea'],
 ['ownIdea','SICK STYLE向けの独自企画案','textarea'],
];
const n=v=>v===null||v===undefined?'未取得':v.toLocaleString('ja-JP');
function growthFor(name,platform,all){
 const obs=all.filter(x=>x.accountName===name&&x.platform===platform&&x.followers!==null).sort((a,b)=>a.observedAt.localeCompare(b.observedAt));
 if(obs.length<2)return {label:'増加率未確認（観測1回のみ）',pct:null};
 const first=obs[0],last=obs[obs.length-1];
 if(first.followers===0)return {label:'増加率未確認（起点が0）',pct:null};
 const pct=Math.round((last.followers-first.followers)/first.followers*1000)/10;
 return {label:`${first.observedAt}→${last.observedAt}で${pct>=0?'+':''}${pct}%（${n(first.followers)}→${n(last.followers)}）`,pct};
}
function row(x,esc,growth){
 return `<article class="record"><div class="recordtop"><span class="badge">${esc(x.platform)}</span><button data-edit="competitorAccounts:${esc(x.id)}">編集</button></div><h3>${esc(x.accountName)}</h3>
 <p class="note">${esc(x.genre||'ジャンル未入力')} · 観測日 ${esc(x.observedAt)}</p>
 <div class="metricmini"><span>フォロワー<b>${n(x.followers)}</b></span><span>公開再生数・反応<b>${n(x.publicViews)}</b></span></div>
 <p class="note">${esc(growth.label)}</p>
 ${x.referencePoint?`<p>参考にする点: ${esc(x.referencePoint)}</p>`:''}
 ${x.ownIdea?`<p class="note">独自企画案: ${esc(x.ownIdea)}</p>`:''}
 ${x.postUrl?`<p><a href="${/^https:\/\//.test(x.postUrl)?esc(x.postUrl):'#'}" target="_blank" rel="noopener noreferrer">投稿を開く ↗</a></p>`:''}</article>`;
}
export function renderAccounts(accounts,ui,esc){
 const filtered=accounts.filter(x=>ui.platform==='all'||x.platform===ui.platform);
 const sorted=[...filtered].sort((a,b)=>a.accountName.localeCompare(b.accountName,'ja')||b.observedAt.localeCompare(a.observedAt));
 return `<section class="panel"><div class="panelhead"><h2>参考アカウント・投稿 <small>${sorted.length} / ${accounts.length} 件</small></h2><button class="primary" data-new="competitorAccounts">＋ 観測記録を追加</button></div>
 <p class="note">規模が違うアカウントを再生数だけで順位付けしていません（アカウント名順に表示）。増加率は同じアカウントの複数回の観測があるときだけ計算します。規約違反のスクレイピングは行っていません。手入力・URL登録のみです。</p>
 <div class="formfields"><label>媒体<select id="accountplatformfilter"><option value="all" ${ui.platform==='all'?'selected':''}>すべて</option>${PLATFORMS.map(p=>`<option value="${p}" ${ui.platform===p?'selected':''}>${p}</option>`).join('')}</select></label></div>
 ${sorted.length?`<div class="records">${sorted.map(x=>row(x,esc,growthFor(x.accountName,x.platform,accounts))).join('')}</div>`:'<div class="empty"><div aria-hidden="true">＋</div><b>まだ登録されていません。</b><p>本人URLと直近投稿を確認してから登録してください（初期調査候補: REGATEドリブル塾・LISEM・ジャイアントカズキなど）。</p></div>'}</section>`;
}
