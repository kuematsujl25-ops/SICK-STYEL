// 提供ドリブラー候補リスト。提供済みと候補を区別し、候補をホームページの実績として公開しない（この機能内の話）。
// 契約費・連絡可否・競合スポンサーは未確認のまま。異なるリーグ・年度・集計会社の統計をそのまま総合順位にしない。
export const LEAGUES=['Jリーグ','海外'];
export const TIERS=['候補','提供済み','憧れ枠','相談可能性枠'];
export const playerFields=[
 ['name','選手・候補者名','text',undefined,undefined,true],
 ['league','リーグ区分','select',LEAGUES],
 ['tier','区分','select',TIERS],
 ['affiliation','所属','text'],
 ['position','ポジション','text'],
 ['profileUrl','公式プロフィールURL','text'],
 ['videoUrl','公開動画URL','text'],
 ['dribbleAttempts','ドリブル試行数','nnumber'],
 ['successRate','成功率（0〜1、例: 0.65）','nnumber'],
 ['playTimeMin','出場時間（分）','nnumber'],
 ['period','集計期間','text'],
 ['source','データ出典','text'],
 ['brandFitReason','ブランド適合の理由（仮説として記載）','textarea'],
 ['confirmItems','確認事項（契約費・連絡可否・競合スポンサー等）','textarea'],
 ['negotiationStatus','交渉状況','text'],
];
const n=v=>v===null||v===undefined?'未取得':v.toLocaleString('ja-JP');
const pct=v=>v===null||v===undefined?'未取得':Math.round(v*1000)/10+'%';
function row(x,esc){
 return `<article class="record"><div class="recordtop"><span class="badge ${x.tier==='提供済み'?'ok':''}">${esc(x.tier)}</span><button data-edit="playerCandidates:${esc(x.id)}">編集</button></div><h3>${esc(x.name)}</h3>
 <p class="note">${esc(x.affiliation||'所属未入力')} · ${esc(x.position||'ポジション未入力')}${x.period?' · 集計期間 '+esc(x.period):''}</p>
 <div class="metricmini"><span>ドリブル試行<b>${n(x.dribbleAttempts)}</b></span><span>成功率<b>${pct(x.successRate)}</b></span><span>出場時間<b>${x.playTimeMin===null?'未取得':x.playTimeMin+'分'}</b></span></div>
 <p class="note">出典: ${esc(x.source||'未入力')}${x.dribbleAttempts!==null||x.successRate!==null?'（他選手との単純な総合順位化はしていません。リーグ・年度・集計方法が異なります）':''}</p>
 ${x.brandFitReason?`<p>ブランド適合の理由（仮説）: ${esc(x.brandFitReason)}</p>`:''}
 ${x.confirmItems?`<p class="note">確認事項: ${esc(x.confirmItems)}</p>`:''}
 ${x.negotiationStatus?`<p class="note">交渉状況: ${esc(x.negotiationStatus)}</p>`:''}</article>`;
}
export function renderPlayers(players,ui,esc){
 const filtered=players.filter(x=>(ui.league==='all'||x.league===ui.league)&&(ui.tier==='all'||x.tier===ui.tier));
 const sorted=[...filtered].sort((a,b)=>a.league.localeCompare(b.league,'ja')||TIERS.indexOf(a.tier)-TIERS.indexOf(b.tier)||a.name.localeCompare(b.name,'ja'));
 return `<section class="panel"><div class="panelhead"><h2>提供ドリブラー候補 <small>${sorted.length} / ${players.length} 件</small></h2><button class="primary" data-new="playerCandidates">＋ 候補を追加</button></div>
 <p class="note">「候補」と「提供済み」を区別しています。候補者の契約費・連絡可否・競合スポンサーは未確認のまま記録し、選手への連絡は行っていません。異なるリーグ・年度・集計会社の統計はそのまま総合順位化していません。フェイント数は共通データがある前提にせず、ない場合は未取得です。</p>
 <div class="formfields"><label>リーグ<select id="playerleaguefilter"><option value="all" ${ui.league==='all'?'selected':''}>すべて</option>${LEAGUES.map(l=>`<option value="${l}" ${ui.league===l?'selected':''}>${l}</option>`).join('')}</select></label><label>区分<select id="playertierfilter"><option value="all" ${ui.tier==='all'?'selected':''}>すべて</option>${TIERS.map(t=>`<option value="${t}" ${ui.tier===t?'selected':''}>${t}</option>`).join('')}</select></label></div>
 ${sorted.length?`<div class="records">${sorted.map(x=>row(x,esc)).join('')}</div>`:'<div class="empty"><div aria-hidden="true">＋</div><b>まだ候補が登録されていません。</b><p>初期調査候補（国内）: 俵積田晃太・伊藤達哉・相馬勇紀・金子拓郎など。海外ベンチマーク: ジェレミー・ドク・モハメド・クドゥスなど。これらに限定せず、相談の現実性を検討する枠も分けて登録してください。</p></div>'}</section>`;
}
