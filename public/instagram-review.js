const PATH='instagram/metricool-review';
const LIMIT=61_000;
const TYPE={reel:'リール',carousel:'カルーセル',image:'画像',story:'ストーリー',unknown:'形式未取得'};
const jst=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const time=(value)=>{if(!value)return '未取得';const date=new Date(value);return Number.isFinite(+date)?jst.format(date)+' JST':'未取得';};
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
const reelMetrics=[['views','再生','median'],['reach','リーチ','median'],['saved','保存','sum'],['shares','シェア','sum']];
const known=v=>Number.isSafeInteger(v)&&v>=0;
export function summarizeNativeReels(cache){
 const reels=(Array.isArray(cache?.reels)?cache.reels:[]).slice(0,25);
 const metrics=reelMetrics.map(([key,label,mode])=>{
  const values=reels.map(r=>r?.values?.[key]).filter(known).sort((a,b)=>a-b);
  const n=values.length;
  const value=n===0?null:mode==='sum'?values.reduce((x,y)=>x+y,0):n%2?values[n>>1]:(values[(n>>1)-1]+values[n>>1])/2;
  return {key,label:label+(mode==='median'?'の中央値':'の合計'),value,known:n};
 });
 const top=reels.filter(r=>known(r?.values?.views)&&r.values.views>0)
  .sort((a,b)=>b.values.views-a.values.views||String(b.timestamp||'').localeCompare(String(a.timestamp||''))).slice(0,3);
 return {total:reels.length,metrics,top};
}
function nativeLink(value){
 try{const u=new URL(value);return u.protocol==='https:'&&['instagram.com','www.instagram.com'].includes(u.hostname)&&!u.username&&!u.password&&/^\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)?u.origin+u.pathname:null;}catch{return null;}
}
export function nativeReviewContent(status,esc,now=Date.now()){
 if(!status?.connected)return '<p class="note">Instagramを接続すると、JSONの取り込みなしで分析が表示されます。</p>';
 const c=status.cache;
 const verifiedAt=c?.syncedAt, expired=typeof status.expiresAt==='number'&&status.expiresAt<=now;
 const stamp=Number.isFinite(Date.parse(verifiedAt))?time(verifiedAt):'未取得';
 const notice=expired?'認可期限切れ。更新には再認可が必要です。':c?.error?'前回の同期に失敗しました。取得済みの数値は最新ではありません。':!c?.syncVerified?'同期はまだ確認できていません。取得できた項目だけを表示します。':!fresh(verifiedAt,now)?'最終成功から24時間以上経過しています。':'';
 const {total,metrics,top}=summarizeNativeReels(c);
 const attempted=Number.isFinite(Date.parse(c?.attemptedAt));
 return `<p class="note">最終同期（成功）：${esc(stamp)}${attempted?` ／ 最終試行：${esc(time(c.attemptedAt))}`:''}</p>
 ${notice?`<p class="note" role="status">${esc(notice)}</p>`:''}
 ${total?`<p class="note">最新25投稿に含まれるリール ${total}本。数値は取得時点の累計です。投稿からの経過日数はそろえていません。${c?.hasMore?' 過去の投稿は集計外です。':''}</p>
 <div class="metricmini">${metrics.map(m=>`<span>${m.label}<b>${count(m.value)}</b><small>取得 ${m.known}/${total}本</small></span>`).join('')}</div>
 ${top.length?`<h4>再生数上位</h4><div class="ig-auto-ranked">${top.map((r,i)=>{
  const link=nativeLink(r.permalink);
  return `<div class="listrow"><div class="grow"><b>${i+1}. ${count(r.values.views)} 再生</b><p>${esc((typeof r.caption==='string'&&r.caption.trim()?r.caption:'キャプションなし').slice(0,105))}</p><small>${esc(time(r.timestamp))} 公開${link?` · <a href="${esc(link)}" rel="noopener noreferrer" target="_blank">リールを見る ↗</a>`:''}</small></div></div>`;
 }).join('')}</div>`:''}`:`<p class="note">${attempted&&Array.isArray(c?.reels)&&!c?.error?'取得した投稿にリールは含まれていません。':'リール実績は未取得です。'}</p>`}`;
}
export function renderInstagramReview(status,esc){
 const expired=typeof status?.expiresAt==='number'&&status.expiresAt<=Date.now();
 return `<section class="panel" id="ig-metricool-review"><div class="panelhead"><h2>投稿分析・予約確認</h2><span class="badge">読み取り専用</span></div>
 <h3>Instagramの自動分析</h3>
 <p class="note">毎朝9:00 JSTの自動同期で更新します。ファイルの取り込みは不要です。</p>
 ${nativeReviewContent(status,esc)}
 ${status?.connected&&!expired?'<div class="actions"><button type="button" class="secondary" data-review-sync>今すぐ分析を更新</button></div>':''}
 <details class="ig-review-import"><summary>Metricoolの予約・保存済み分析</summary>
 <p class="note">この欄だけはClaude Codeの確認用JSONを取り込んだ時点の記録です。Metricoolの予約作成・変更は行いません。</p>
 <div data-review-content aria-live="polite"><p>読み込み中…</p></div>
 <form data-review-import><label>確認用JSON<input name="report" type="file" accept=".json,application/json" required></label><div class="actions"><button type="submit" class="primary" disabled>取り込む</button><button type="button" data-review-refresh>表示を更新</button></div></form>
 <p data-review-status role="status"></p>
 <details><summary>取り込み方</summary><p>Claude Codeで <code>/sickstyle-instagram export</code> を実行し、作成された <code>metricool-review.json</code> を選びます。Metricoolには直接同期しません。</p></details>
 </details></section>`;
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
