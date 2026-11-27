const fmt=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const renderInstagramReplyDrafts=()=>`<section class="panel" id="ig-reply-drafts">
 <div class="panelhead"><h2>DM返信案</h2><span class="badge">本人専用</span></div>
 <p>Dotが確認したDMの返信案です。内容を確認してコピーし、Instagramで手動で送信してください。</p>
 <div class="actions"><button type="button" class="secondary" data-drafts-refresh>一覧を更新</button><a href="https://www.instagram.com/direct/inbox/" target="_blank" rel="noopener noreferrer">Instagramの受信箱を開く</a></div>
 <p role="status" aria-live="polite" data-drafts-status>読み込み中…</p>
 <div data-drafts-list></div>
 </section>`;
export function bindInstagramReplyDrafts({panel,api,esc}){
 if(!panel)return;
 const get=q=>panel.querySelector(q),status=get('[data-drafts-status]'),list=get('[data-drafts-list]'),refresh=get('[data-drafts-refresh]');
 let drafts=[];
 async function load(){
  refresh.disabled=true;status.textContent='読み込み中…';
  try{
   const data=await api('instagram/reply-drafts');
   if(!panel.isConnected)return;
   drafts=data.drafts;
   list.innerHTML=drafts.map((d,i)=>`<article class="ig-reply-draft"><div class="panelhead"><h3>${esc(d.peer)}</h3><small>${fmt.format(new Date(d.createdAt))}</small></div>
     ${d.note?`<p class="note">${esc(d.note)}</p>`:''}
     <p class="ig-reply-body" data-reply-body>${esc(d.text)}</p><button type="button" data-copy-reply="${i}">返信案をコピー</button></article>`).join('');
   status.textContent=drafts.length?'新しい順（最大40件）':'返信案はまだありません。';
  }catch{if(panel.isConnected){drafts=[];list.replaceChildren();status.textContent='返信案を取得できませんでした。「一覧を更新」を押してください。';}}
  finally{refresh.disabled=false;}
 }
 refresh.addEventListener('click',load);
 list.addEventListener('click',async e=>{
  const button=e.target.closest('[data-copy-reply]');if(!button)return;
  const draft=drafts[Number(button.dataset.copyReply)];if(!draft)return;
  try{await navigator.clipboard.writeText(draft.text);status.textContent='返信案をコピーしました。Instagramには送信していません。';}
  catch{const body=button.closest('article')?.querySelector('[data-reply-body]');if(body){const range=document.createRange();range.selectNodeContents(body);const sel=window.getSelection();sel?.removeAllRanges();sel?.addRange(range);}status.textContent='自動コピーできませんでした。文面を選択してコピーしてください。';}
 });
 void load();
}
