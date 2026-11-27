const ROOT='/api/owner-media/files';
const PANEL='owner-media';
const dateFmt=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const statuses={draft:'未送信',queued:'受け取り待ち',received:'受け取り済み',complete:'対応完了'};
export const renderOwnerMedia=()=>`<section class="panel owner-media" id="${PANEL}">
 <div class="panelhead"><h2>素材・Dotへの依頼</h2><span class="badge">本人専用</span></div>
 <p>動画・画像を確認し、制作・修正・投稿予約の依頼をまとめます。</p>
 <div class="owner-media-status note" role="status" aria-live="polite">読み込み中…</div>
 <div class="owner-media-library">
  <div class="actions"><label>素材を登録 <input class="owner-media-upload" type="file" accept="image/jpeg,image/png,image/webp,video/mp4" disabled></label></div>
  <p class="note">JPG、PNG、WebP、MP4 ／ 25 MBまで ／ 非公開</p>
  <div class="owner-media-gallery" aria-label="素材一覧"></div><button class="owner-media-more" type="button" hidden>さらに表示</button>
 </div>
 <form class="owner-media-form">
  <label>依頼の種類<select name="type"><option>制作</option><option>修正</option><option>投稿予約</option></select></label>
  <label>対象素材<select name="assetId"><option value="">素材を指定しない</option></select></label>
  <label class="owner-media-date" hidden>希望日時（日本時間）<input type="datetime-local" name="scheduledJst"></label>
  <label>依頼内容<textarea name="note" placeholder="例：冒頭5秒をもう少し強く。タイトルを大きくしてほしい。" rows="3" required maxlength="900"></textarea></label>
  <div class="actions"><button class="primary" type="submit">依頼を保存</button></div>
  <p class="owner-media-help note">依頼を保存しても自動で予約・公開はされません。</p>
 </form>
 <h3>依頼履歴</h3><div class="owner-media-history"></div>
 </section>`;
export function ownerRequestText(r,fileName){
 return ['【SICK STYLEアプリからの依頼】','依頼：'+r.type,'依頼ID：'+r.id,r.scheduledJst?'希望：'+r.scheduledJst.replace('T',' ')+'（日本時間）':null,r.assetId?'対象素材：'+(fileName||r.assetId)+'（必要に応じてファイルを添付）':null,'',r.note,'',r.type==='投稿予約'?'投稿内容・日時を確認してから進めてください。':null].filter(v=>v!==null&&v!==undefined).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function bindOwnerMedia({panel,api,esc}){
 if(!panel)return;
 const find=s=>panel.querySelector(s),statusEl=find('.owner-media-status'),form=find('form'),upload=find('.owner-media-upload'),more=find('.owner-media-more'),gallery=find('.owner-media-gallery');
 const asset=form.elements.assetId,date=form.elements.scheduledJst,submit=form.querySelector('button[type=submit]'),history=find('.owner-media-history');
 let files=[],requests=[],cursor=null,requestId=crypto.randomUUID(),available=false,bridge=false;
 const setStatus=(v)=>{statusEl.textContent=v;};
 const fmt=d=>dateFmt.format(new Date(d));
 function paintFiles(){
  const selected=asset.value;
  asset.innerHTML='<option value="">素材を指定しない</option>'+files.map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
  if(files.some(f=>f.id===selected))asset.value=selected;
  gallery.innerHTML=files.length?files.map(f=>`<article class="owner-media-card"><div class="owner-media-frame">${f.type==='video/mp4'?'<video controls playsinline preload="none" src="'+ROOT+'/'+esc(f.id)+'" aria-label="'+esc(f.name)+'"></video>':'<img loading="lazy" alt="'+esc(f.name)+'" src="'+ROOT+'/'+esc(f.id)+'">'}</div><b>${esc(f.name)}</b><small>${fmt(f.createdAt)} ・ ${(f.bytes/(1024*1024)).toFixed(1)} MB</small><button type="button" data-owner-use="${esc(f.id)}">この素材で依頼</button></article>`).join(''):(available?'<p class="note">登録済みの素材はまだありません。</p>':'');
  more.hidden=!cursor;
  for(const button of gallery.querySelectorAll('[data-owner-use]'))button.onclick=()=>{asset.value=button.dataset.ownerUse;form.elements.note.focus();};
 }
 function paintHistory(){
  history.innerHTML=requests.length?requests.map(r=>`<article class="owner-media-request"><div><b>${esc(r.type)}</b> <span class="badge">${statuses[r.state]||statuses.draft}</span> <small>${fmt(r.createdAt)}</small></div>${r.scheduledJst?'<small>希望日時 '+esc(r.scheduledJst.replace('T',' '))+' JST</small>':''}<p>${esc(r.note)}</p>${r.result?'<p><b>Dotからの結果</b><br>'+esc(r.result)+'</p>':''}${bridge&&r.state==='draft'?'<button class="primary" type="button" data-owner-send="'+esc(r.id)+'">Dotに送る</button>':''}<button type="button" data-owner-copy="${esc(r.id)}">指示をコピー</button><textarea class="owner-media-copy" rows="5" hidden readonly aria-label="コピーする指示"></textarea></article>`).join(''):'<p class="note">依頼はまだありません。</p>';
  for(const button of history.querySelectorAll('[data-owner-send]'))button.onclick=async()=>{
   button.disabled=true;
   try{
    const saved=await api('owner-media/requests/send','POST',{id:button.dataset.ownerSend});
    requests=requests.map(r=>r.id===saved.id?saved:r);paintHistory();
    setStatus('Dotへの受け渡し待ちです。投稿や予約はまだ実行されていません。');
   }catch(e){setStatus(e.message);}finally{button.disabled=false;}
  };
  for(const button of history.querySelectorAll('[data-owner-copy]'))button.onclick=async()=>{
   const r=requests.find(x=>x.id===button.dataset.ownerCopy),text=ownerRequestText(r,files.find(f=>f.id===r.assetId)?.name);
   try{await navigator.clipboard.writeText(text);setStatus('指示をコピーしました。Dotチャットに貼って送信してください。');}
   catch{const area=button.nextElementSibling;area.hidden=false;area.value=text;area.select();}
  };
 }
 async function loadFiles(append=false){
  const data=await api('owner-media/files'+(append&&cursor?'?cursor='+encodeURIComponent(cursor):''));
  available=data.available;cursor=data.cursor;
  files=append?[...new Map([...files,...data.files].map(x=>[x.id,x])).values()]:data.files;
  upload.disabled=!available;
  paintFiles();
 }
 function mode(){
  const scheduled=form.elements.type.value==='投稿予約';
  date.required=scheduled;asset.required=scheduled;date.parentElement.hidden=!scheduled;
 }
 form.elements.type.onchange=mode;mode();
 more.onclick=async()=>{more.disabled=true;try{await loadFiles(true);}catch(e){setStatus(e.message);}finally{more.disabled=false;}};
 upload.onchange=async()=>{
  const file=upload.files[0];if(!file)return;
  if(file.size>25*1024*1024){setStatus('ファイルは25 MBまでです。');upload.value='';return;}
  upload.disabled=true;setStatus('素材を登録しています…');
  try{
   const res=await fetch(ROOT,{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type,'X-Sickstyle-Media-Name':encodeURIComponent(file.name)},body:file});
   const data=await res.json();if(!res.ok)throw Error(data.error||'登録できませんでした。');
   files=[data,...files];paintFiles();asset.value=data.id;setStatus('素材を登録しました。');
  }catch(e){setStatus(e.message);}finally{upload.disabled=!available;upload.value='';}
 };
 form.onsubmit=async(event)=>{
  event.preventDefault();submit.disabled=true;const d=new FormData(form);
  try{const record=await api('owner-media/requests','POST',{id:requestId,type:d.get('type'),assetId:d.get('assetId')||null,scheduledJst:d.get('type')==='投稿予約'?d.get('scheduledJst'):null,note:d.get('note')});
   requests=[record,...requests.filter(x=>x.id!==record.id)];paintHistory();form.reset();mode();requestId=crypto.randomUUID();setStatus('依頼を保存しました。Dotにはまだ送信していません。');
  }catch(e){if(e.body?.error?.includes('別の依頼ID'))requestId=crypto.randomUUID();setStatus(e.message);}finally{submit.disabled=false;}
 };
 Promise.allSettled([loadFiles(),api('owner-media/requests').then(d=>{requests=d.requests;bridge=d.bridge===true;find('.owner-media-help').textContent=bridge?'保存した依頼の「Dotに送る」で受け渡しを開始します。予約・公開は自動では行いません。':'Dotへの直接連携は未接続です。「指示をコピー」で、いつものDotチャットに貼って送信できます。';paintHistory();})]).then(results=>{
  const err=results.find(r=>r.status==='rejected');setStatus(err?err.reason.message:available?'':'素材の非公開保存先は未接続です。依頼の保存は利用できます。');
 });
}
