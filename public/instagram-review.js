const PATH='instagram/metricool-review';
const LIMIT=61_000;
const TYPE={reel:'リール',carousel:'カルーセル',image:'画像',story:'ストーリー',unknown:'形式未取得'};
const jst=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const time=(value)=>{const date=new Date(value);return Number.isFinite(+date)?jst.format(date)+' JST':'未取得';};
const count=(value)=>typeof value==='number'?value.toLocaleString('ja-JP'):'未取得';
const safeLink=(value)=>{try{const u=new URL(value);return u.origin==='https://app.metricool.com'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const fresh=(value,now)=>now-Date.parse(value)<=86_400_000;
export function reviewContent(data,esc,now=Date.now()){
 const s=data?.snapshot;
 if(!s)return '<p class="note">まだ取り込まれていません。「0件」ではなく未取得です。</p>';
 const blocks=(label,rows)=>rows.length?`<h4>${label}</h4><ul>${rows.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'';
 const stamp=(v)=>`<p class="note">取得：${esc(time(v))}${fresh(v,now)?'':' · 24時間以上前。最新の状態はMetricoolで確認してください。'}</p>`;
 const a=s.analysis,p=s.planner;
 return `<p><b>@${esc(s.account)}</b> · 取得時点の記録</p><div class="records"><article class="record">
 <h3>投稿分析</h3>${a?`${stamp(a.observedAt)}<p class="note">${esc(a.from)}〜${esc(a.to)}（日本時間）</p>
 <div class="metricmini">${[['リール数',a.reelCount],['再生数の中央値',a.medianViews],['リーチの中央値',a.medianReach],['保存の合計',a.saves],['シェアの合計',a.shares]].map(([label,v])=>`<span>${label}<b>${count(v)}</b></span>`).join('')}</div>
 ${blocks('傾向',a.findings)}${blocks('次に試すこと',a.recommendations)}`:'<p class="note">分析は未取得です。</p>'}</article><article class="record">
 <h3>投稿予約</h3>${p?`${stamp(p.observedAt)}<p class="note">確認範囲：${esc(time(p.from))} 〜 ${esc(time(p.to))}</p>${p.posts.length?p.posts.map(r=>{const link=safeLink(r.url);return `<div class="listrow"><div class="grow"><b>${esc(time(r.at))} · ${esc(TYPE[r.type]??'形式未取得')}</b><p>${esc(r.caption)}</p><small>${Date.parse(r.at)<=now?'予定時刻経過・結果未確認':'取得時点で予約済み'}</small>${link?` · <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Metricoolで確認 ↗</a>`:''}</div></div>`;}).join(''):'<p>取得時点で、この期間に予約はありません。</p>'}`:'<p class="note">予約は未取得です。</p>'}</article></div>`;
}
export function renderInstagramReview(){
 return `<section class="panel" id="ig-metricool-review"><div class="panelhead"><h2>投稿分析・予約確認</h2><span class="badge">Metricool / Claude Code</span></div>
 <p>Claude Codeの分析とMetricoolの予約一覧を保存して、スマホ・PCから確認できます。この画面では投稿・予約の作成や変更は行いません。</p>
 <div data-review-content aria-live="polite"><p>読み込み中…</p></div>
 <form data-review-import><label>Claude Codeが書き出した確認用JSON<input name="report" type="file" accept=".json,application/json" required></label><div class="actions"><button type="submit" class="primary" disabled>取り込む</button><button type="button" data-review-refresh>表示を更新</button></div></form>
 <p data-review-status role="status"></p>
 <details><summary>取り込み方</summary><p>Claude Codeで <code>/sickstyle-instagram export</code> を実行し、作成された <code>metricool-review.json</code> を上から選びます。ここではファイルを読み込んだ時点の情報を表示し、Metricoolに直接同期しません。</p></details></section>`;
}
export function bindInstagramReview({panel,api,esc}){
 if(!panel)return;
 const form=panel.querySelector('[data-review-import]'),btn=form.querySelector('button[type="submit"]'),status=panel.querySelector('[data-review-status]'),content=panel.querySelector('[data-review-content]'),refresh=panel.querySelector('[data-review-refresh]');
 let data=null,active=false;
 async function load(file){
  if(active)return;active=true;btn.disabled=refresh.disabled=true;status.textContent=file?'取り込み中…':'読み込み中…';
  try{
   if(file){
    if(file.size>LIMIT)throw Error('ファイルは61KB以内にしてください。');
    let snapshot;try{snapshot=JSON.parse((await file.text()).replace(/^\uFEFF/,''));}catch{throw Error('JSONファイルを確認してください。');}
    if(!confirm('分析・予約一覧を管理アプリに保存しますか？ Metricoolには書き込みません。')){status.textContent='取り込みを中止しました。';return;}
    if(!panel.isConnected)return;
    data=await api(PATH,'PUT',{snapshot,revision:data.revision});form.reset();
   }else data=await api(PATH);
   if(!panel.isConnected)return;
   content.innerHTML=reviewContent(data,esc);status.textContent=file?'取り込みました。':'';
  }catch(err){if(panel.isConnected){if(!data)content.textContent='読み込めませんでした。表示を更新してください。';status.textContent=err.message;}}
  finally{if(panel.isConnected){active=false;refresh.disabled=false;btn.disabled=!data;}}
 }
 form.onsubmit=e=>{e.preventDefault();const file=form.elements.report.files?.[0];if(file&&data)load(file);};
 refresh.onclick=()=>load();load();
}
