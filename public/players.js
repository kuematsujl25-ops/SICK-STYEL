// 提供ドリブラー候補リスト。提供済みと候補を区別し、候補をホームページの実績として公開しない（この機能内の話）。
// 契約費・連絡可否・競合スポンサーは未確認のまま。異なるリーグ・年度・集計会社の統計をそのまま総合順位にしない。
import {RESEARCHED_PLAYERS} from './player-research.js';
export const LEAGUES=['Jリーグ','海外'];
export const TIERS=['候補','提供済み','憧れ枠','相談可能性枠'];
export const PRIORITY=['高','中','低'];
export const SAMPLE_STATUS=['未提供','提供準備中','提供済み'];
export const HOMEPAGE_STATUS=['非掲載','掲載候補','公開済み'];
export const playerFields=[
 ['name','選手・候補者名','text',undefined,undefined,true],
 ['league','リーグ区分','select',LEAGUES],
 ['tier','区分','select',TIERS],
 ['priority','候補の優先度','select',PRIORITY],
 ['sampleStatus','サンプル提供状況','select',SAMPLE_STATUS],
 ['homepageStatus','ホームページ掲載（提供済みのみ選択可）','select',HOMEPAGE_STATUS],
 ['affiliation','所属','text'],
 ['position','ポジション','text'],
 ['profileUrl','公式プロフィールURL','text'],
 ['videoUrl','公開動画URL','text'],
 ['photoUrl','写真URL（権利確認済みのみ）','text'],
 ['photoCredit','写真の権利者・出典','text'],
 ['photoSourceUrl','写真の権利表記URL（ライセンス）','text'],
 ['dribbleAttempts','ドリブル試行数','nnumber'],
 ['successRate','成功率（0〜1、例: 0.65）','nnumber'],
 ['successfulPer90','成功ドリブル/90分（異なる定義・出典）','nnumber'],
 ['feintCount','フェイント数（映像から個別集計した場合）','nnumber'],
 ['playTimeMin','出場時間（分）','nnumber'],
 ['period','集計期間','text'],
 ['source','データ出典','text'],
 ['sourceUrl','出典URL','text'],
 ['brandFitReason','ブランド適合の理由（仮説として記載）','textarea'],
 ['confirmItems','確認事項（契約費・連絡可否・競合スポンサー等）','textarea'],
 ['negotiationStatus','連絡状況（交渉状況）','text'],
];
const n=v=>v===null||v===undefined?'未取得':v.toLocaleString('ja-JP');
const pct=v=>v===null||v===undefined?'未取得':Math.round(v*1000)/10+'%';
const safeUrl=v=>typeof v==='string'&&/^https:\/\/[^\s"<>]+$/i.test(v)?v:'';
function row(x,esc){
 return `<article class="record"><div class="recordtop"><span class="badge ${x.tier==='提供済み'?'ok':''}">${esc(x.tier)}</span>${x.priority?`<span class="badge ${x.priority==='高'?'danger':''}">優先度 ${esc(x.priority)}</span>`:''}<button data-edit="playerCandidates:${esc(x.id)}">編集</button></div><h3>${esc(x.name)}</h3>
 <div class="playerprofile">${safeUrl(x.photoUrl)?`<img class="playerphoto" loading="lazy" src="${esc(x.photoUrl)}" alt="${esc(x.name)}の許諾済み写真" referrerpolicy="no-referrer">`:'<div class="playerphoto playerplaceholder" aria-hidden="true">⚽</div>'}<div>
 <p class="note">${esc(x.affiliation||'所属未入力')} · ${esc(x.position||'ポジション未入力')}${x.period?' · 集計期間 '+esc(x.period):''}</p>
 ${safeUrl(x.profileUrl)?`<a href="${esc(x.profileUrl)}" target="_blank" rel="noopener noreferrer">公式プロフィール・写真 ↗</a>`:''}</div></div>
 <div class="metricmini"><span>ドリブル試行<b>${n(x.dribbleAttempts)}</b></span><span>成功率<b>${pct(x.successRate)}</b></span><span>成功/90分<b>${n(x.successfulPer90)}</b></span><span>フェイント回数<b>${n(x.feintCount)}</b></span><span>出場時間<b>${x.playTimeMin===null?'未取得':x.playTimeMin+'分'}</b></span></div>
 <p class="note">連絡状況: ${esc(x.negotiationStatus||'未接触')} · サンプル提供: ${esc(x.sampleStatus||'未提供')}${x.homepageStatus&&x.homepageStatus!=='非掲載'?' · ホームページ: '+esc(x.homepageStatus):''} · データ更新: ${x.updatedAt?esc(new Date(x.updatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})):'未記録（旧データ）'}</p>
 <p class="note">出典: ${esc(x.source||'未入力')}${safeUrl(x.sourceUrl)?` <a href="${esc(x.sourceUrl)}" target="_blank" rel="noopener noreferrer">出典を開く ↗</a>`:''}${x.photoCredit?' · 写真: '+esc(x.photoCredit):''}${safeUrl(x.photoSourceUrl)?` <a href="${esc(x.photoSourceUrl)}" target="_blank" rel="noopener noreferrer">写真の出典・利用条件 ↗</a>`:''}${x.dribbleAttempts!==null||x.successRate!==null?'（他選手との単純な総合順位化はしていません。リーグ・年度・集計方法が異なります）':''}</p>
 ${x.brandFitReason?`<p>ブランド適合の理由（仮説）: ${esc(x.brandFitReason)}</p>`:''}
 ${x.confirmItems?`<p class="note">確認事項: ${esc(x.confirmItems)}</p>`:''}
 ${x.homepageStatus==='公開済み'?'<p class="note">ホームページへ掲載済みとして記録されています。実際の公開はサイト掲載画面で確定操作が必要です。</p>':x.homepageStatus==='掲載候補'?'<p class="note">ホームページ掲載候補として選択されています（まだ公開されていません）。サイト掲載画面から公開してください。</p>':''}</article>`;
}
export function renderPlayers(players,ui,esc){
 const filtered=players.filter(x=>(ui.league==='all'||x.league===ui.league)&&(ui.tier==='all'||x.tier===ui.tier));
 const sorted=[...filtered].sort((a,b)=>a.league.localeCompare(b.league,'ja')||TIERS.indexOf(a.tier)-TIERS.indexOf(b.tier)||a.name.localeCompare(b.name,'ja'));
 return `<section class="panel"><div class="panelhead"><h2>提供ドリブラー候補 <small>${sorted.length} / ${players.length} 件</small></h2><button class="primary" data-new="playerCandidates">＋ 候補を追加</button></div>
 <p class="note">「候補」と「提供済み」を区別しています。候補者の契約費・連絡可否・競合スポンサーは未確認のまま記録し、選手への連絡は行っていません。異なるリーグ・年度・集計会社の統計はそのまま総合順位化していません。フェイント数は共通データがある前提にせず、ない場合は未取得です。</p>
 <div class="formfields"><label>リーグ<select id="playerleaguefilter"><option value="all" ${ui.league==='all'?'selected':''}>すべて</option>${LEAGUES.map(l=>`<option value="${l}" ${ui.league===l?'selected':''}>${l}</option>`).join('')}</select></label><label>区分<select id="playertierfilter"><option value="all" ${ui.tier==='all'?'selected':''}>すべて</option>${TIERS.map(t=>`<option value="${t}" ${ui.tier===t?'selected':''}>${t}</option>`).join('')}</select></label></div>
 ${sorted.length?`<div class="records">${sorted.map(x=>row(x,esc)).join('')}</div>`:'<div class="empty"><div aria-hidden="true">＋</div><b>登録済み候補はまだありません。</b><p>下の調査候補から追加できます。調査候補は提供実績ではありません。</p></div>'}</section>
 <section class="panel"><div class="panelhead"><h2>調査候補（Jリーグ・海外） <small>${RESEARCHED_PLAYERS.filter(x=>ui.league==='all'||x.league===ui.league).length} 件</small></h2></div><p class="note">2026年10月時点のデータ出典に基づく調査リスト。選手本人への提供・契約・交渉を示すものではありません。2026特別シーズンのJリーグはドリブル総数、海外は2025-26の成功ドリブル/90分であり、定義が異なるので直接比較しません。成功率・フェイント数が不明な項目は「未取得」。一部の研究用写真はCC BY 4.0で出典と著作者を表示します。その他は権利を確認したURLを登録後に表示します。掲載写真はSICKSTYLEとの提供・契約関係を意味しません。</p>
 <div class="records">${RESEARCHED_PLAYERS.filter(x=>ui.league==='all'||x.league===ui.league).map(x=>`<article class="record">
 <div class="recordtop"><span class="badge">${x.league==='Jリーグ'?'Jリーグ':'海外'}・${esc(x.tier)}</span><button data-addresearch="${esc(x.key)}" ${players.some(p=>p.name===x.name&&p.period===x.period)?'disabled':''}>${players.some(p=>p.name===x.name&&p.period===x.period)?'登録済み':'候補に登録'}</button></div>
 <div class="playerprofile">${safeUrl(x.photoUrl)?`<img class="playerphoto" loading="lazy" referrerpolicy="no-referrer" src="${esc(x.photoUrl)}" alt="${esc(x.name)}の写真">`:'<div class="playerphoto playerplaceholder" aria-hidden="true">⚽</div>'}<div><h3>${esc(x.name)}</h3><p class="note">${esc(x.affiliation)} · ${esc(x.period)}</p></div></div>
 <div class="metricmini"><span>ドリブル試行数<b>${n(x.dribbleAttempts)}</b></span><span>成功ドリブル/90<b>${n(x.successfulPer90)}</b></span><span>成功率<b>未取得</b></span><span>フェイント数<b>未取得</b></span></div>
 ${safeUrl(x.photoSourceUrl)?`<p class="note">写真: ${esc(x.photoCredit)} · <a href="${esc(x.photoSourceUrl)}" target="_blank" rel="noopener noreferrer">写真の作者・ライセンスを確認 ↗</a>（SICKSTYLEの協賛を意味しません）</p>`:''}<p>${esc(x.brandFitReason)}</p>${safeUrl(x.profileUrl)?`<p><a href="${esc(x.profileUrl)}" target="_blank" rel="noopener noreferrer">公式選手プロフィール・写真を見る ↗</a></p>`:''}<p class="note">出典: <a href="${esc(x.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(x.source)} ↗</a></p>
 </article>`).join('')}</div></section>`;
}
