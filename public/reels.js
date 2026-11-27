// リール・ショート動画分析。まず手入力・CSVで実用化（CSV取込は今回未実装）。
// 未取得はnullのまま表示し、0と区別する。平均視聴時間だけから完視聴率・維持率曲線は作らない。
export const PLATFORMS=['Instagram','TikTok','YouTube'];
export const FORMATS=['解説','実演','選手紹介','その他'];
export const reelFields=[
 ['title','投稿メモ・ラベル','text'],
 ['platform','媒体','select',PLATFORMS],
 ['url','投稿URL','text'],
 ['postedAt','投稿日','date',undefined,undefined,true],
 ['durationSec','動画尺（秒）','nnumber'],
 ['theme','テーマ','text'],
 ['hook','冒頭の訴求','text'],
 ['format','形式','select',FORMATS],
 ['cta','CTA','text'],
 ['product','紹介商品','text'],
 ['campaignId','キャンペーンID','text'],
 ['views','再生数','nnumber'],['reach','リーチ','nnumber'],
 ['avgWatchSec','平均視聴時間（秒）','nnumber'],['retentionPct','維持率（%、取得できる場合のみ）','nnumber'],
 ['saves','保存','nnumber'],['shares','シェア','nnumber'],['comments','コメント','nnumber'],
 ['followersGained','フォロー獲得','nnumber'],['profileVisits','プロフィール訪問','nnumber'],['linkClicks','リンククリック','nnumber'],
 ['notes','メモ','textarea'],
];
const n=v=>v===null||v===undefined?'未取得':v.toLocaleString('ja-JP');
const rate=(num,den)=>den===null||den===undefined||den===0||num===null||num===undefined?'未取得':Math.round(num/den*1000)/10+'%（'+n(num)+' / '+n(den)+'）';
function bucket(sec){if(sec===null||sec===undefined)return '尺不明';if(sec<=15)return '〜15秒';if(sec<=30)return '16〜30秒';if(sec<=60)return '31〜60秒';return '61秒〜';}
function row(x,esc,today){
 const days=Math.floor((Date.parse(today)-Date.parse(x.postedAt))/86400000);
 return `<article class="record"><div class="recordtop"><span class="badge">${esc(x.platform)}</span><button data-edit="reelPosts:${esc(x.id)}">編集</button></div><h3>${esc(x.title)}</h3>
 <p class="note">${esc(x.postedAt)}（公開後${days>=0?days+'日':'未来日付'}） · ${esc(x.format)} · ${esc(bucket(x.durationSec))}${x.theme?' · '+esc(x.theme):''}</p>
 <div class="metricmini"><span>再生<b>${n(x.views)}</b></span><span>リーチ<b>${n(x.reach)}</b></span><span>平均視聴<b>${x.avgWatchSec===null?'未取得':x.avgWatchSec+'秒'}</b></span><span>維持率<b>${x.retentionPct===null?'未取得':x.retentionPct+'%'}</b></span></div>
 <div class="metricmini"><span>保存率<b>${rate(x.saves,x.views)}</b></span><span>シェア率<b>${rate(x.shares,x.views)}</b></span><span>コメント率<b>${rate(x.comments,x.views)}</b></span></div>
 <div class="metricmini"><span>フォロー獲得<b>${n(x.followersGained)}</b></span><span>プロフィール訪問<b>${n(x.profileVisits)}</b></span><span>リンククリック<b>${n(x.linkClicks)}</b></span></div>
 ${x.url?`<p><a href="${/^https:\/\//.test(x.url)?esc(x.url):'#'}" target="_blank" rel="noopener noreferrer">投稿を開く ↗</a></p>`:''}
 ${x.notes?`<p class="note">${esc(x.notes)}</p>`:''}</article>`;
}
export function renderReels(posts,ui,esc,today){
 const filtered=posts.filter(x=>(ui.platform==='all'||x.platform===ui.platform)&&(ui.format==='all'||x.format===ui.format));
 const sorted=[...filtered].sort((a,b)=>b.postedAt.localeCompare(a.postedAt));
 return `<section class="panel"><div class="panelhead"><h2>リール・ショート動画 <small>${sorted.length} / ${posts.length} 件</small></h2><button class="primary" data-new="reelPosts">＋ 投稿を追加</button></div>
 <p class="note">未取得の指標は「未取得」と表示し、0とは区別します。平均視聴時間だけから完視聴率・維持率曲線は算出していません。比較は公開後日数・動画尺・テーマをそろえて行ってください。</p>
 <div class="formfields"><label>媒体<select id="reelplatformfilter"><option value="all" ${ui.platform==='all'?'selected':''}>すべて</option>${PLATFORMS.map(p=>`<option value="${p}" ${ui.platform===p?'selected':''}>${p}</option>`).join('')}</select></label><label>形式<select id="reelformatfilter"><option value="all" ${ui.format==='all'?'selected':''}>すべて</option>${FORMATS.map(f=>`<option value="${f}" ${ui.format===f?'selected':''}>${f}</option>`).join('')}</select></label></div>
 ${sorted.length?`<div class="records">${sorted.map(x=>row(x,esc,today)).join('')}</div>`:'<div class="empty"><div aria-hidden="true">＋</div><b>投稿はまだ登録されていません。</b><p>投稿を追加できます（CSV取込は未実装です）。</p></div>'}</section>`;
}
