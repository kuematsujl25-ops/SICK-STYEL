// Authenticated SICKSTYLE notifications. Opt-in only; no browser permission prompt on load.
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode=s=>{const b=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));return Uint8Array.from(b,c=>c.charCodeAt(0));};
async function api(path,method='GET',data){
 const r=await fetch('/api/notifications'+path,{method,credentials:'same-origin',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
 const body=await r.json();if(!r.ok)throw Error(body.error||'通知設定に失敗しました');return body;
}
function localTime(s){return new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});}
// Service Workerの登録・有効化が失敗/保留のままだと navigator.serviceWorker.ready が解決しないことがある
// （端末のブラウザー設定やネットワーク事情による）。通知履歴の表示はプッシュ登録状態に依存しないため、
// ここで必ずタイムアウトして「この端末ではプッシュ通知が利用できない」側に倒し、履歴表示自体を止めない。
const withTimeout=(p,ms)=>Promise.race([p,new Promise(resolve=>setTimeout(()=>resolve(null),ms))]);
export async function mountNotifications(){
 const panel=document.querySelector('#notification-panel');if(!panel)return;
 const ref=panel;
 ref.textContent='通知設定を読み込み中…';
 try{
 const [status,inbox]=await Promise.all([api('/status'),api('')]);if(!document.contains(ref))return;
 const supports=typeof window.Notification!=='undefined'&&'serviceWorker'in navigator&&'PushManager'in window;
 const registration=supports?await withTimeout(navigator.serviceWorker.ready,4000):null;
 const current=registration?await withTimeout(registration.pushManager.getSubscription(),4000):null;
 const permission=supports?Notification.permission:'unsupported';
 ref.innerHTML='<p>毎朝9時：今日の予定 ／ 20時：売上速報 ／ 22時：売上データ分析 ／ AI社員：分析完了・レビュー承認の通知</p>'+
  '<p class="note">日本時間で通知します。未取得の売上は0円として扱いません。iPhoneではSafariから「ホーム画面に追加」したSICKSTYLEアプリを開き、通知を許可してください。</p>'+
  '<div class="actions"><button class="primary" id="notification-enable" '+(!status.configured||!supports||permission==='denied'||current?'disabled':'')+'>この端末で通知を有効にする</button>'+
  '<button class="secondary" id="notification-disable" '+(!current?'disabled':'')+'>この端末への通知を停止</button>'+ '<button class="secondary" id="notification-test" '+(!current?'disabled':'')+'>テスト通知を送信</button></div>'+
  '<p class="note">通知の状態：'+(current?'この端末で登録済み':permission==='denied'?'通知が拒否されています（端末の設定から許可してください）':!supports?'この表示環境ではプッシュ通知が利用できません':!status.configured?'配信用キーの本番設定待ち':'端末で未登録')+
  ' ／ 登録端末数：'+status.devices+'</p>'+
  '<h3>通知履歴</h3><div class="records">'+(inbox.items.length?inbox.items.map(x=>
  '<article class="record"><b>'+escapeHtml(x.title)+'</b><p>'+escapeHtml(x.body)+'</p><small>'+escapeHtml(localTime(x.createdAt))+(x.readAt?' · 確認済み':' · 未確認')+'</small><div class="actions">'+(x.readAt?'':'<button class="secondary" data-notification-read="'+escapeHtml(x.id)+'">確認済みにする</button>')+'</div></article>').join(''):'<p class="note">通知はまだありません。通知先を登録して予定時刻を迎えると、ここに履歴が保存されます。</p>')+'</div>';
 const enable=ref.querySelector('#notification-enable');
 if(enable)enable.onclick=async()=>{
  // Must be initiated by the person's click; never auto-prompt.
  try{
   const result=await Notification.requestPermission();if(result!=='granted')throw Error('通知が許可されていません');
   const reg=await withTimeout(navigator.serviceWorker.ready,8000);
   if(!reg)throw Error('この端末でService Workerの準備が完了しませんでした。ページを再読み込みしてもう一度お試しください');
   const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(status.publicKey)});
   try{await api('/subscribe','POST',{subscription:sub.toJSON()});}
   catch(e){
    // サーバー側の登録が失敗した場合（登録端末5台の上限・通信エラー等）、ブラウザー側の購読だけが
    // 残ると、次回この画面を開いたときgetSubscription()がこの「サーバーが知らない」購読を見つけて
    // 「登録済み」と誤表示し、有効化ボタンが再試行できないまま無効化され続けてしまう
    // （Codex独立レビュー指摘）。ブラウザー側の購読も必ず取り消し、状態を一致させる。
    try{await sub.unsubscribe();}catch{}
    throw e;
   }
   mountNotifications();
  }catch(e){alert(e.message);}
 };
 const disable=ref.querySelector('#notification-disable');
 if(disable)disable.onclick=async()=>{try{const reg=await withTimeout(navigator.serviceWorker.ready,8000);const sub=reg?await withTimeout(reg.pushManager.getSubscription(),8000):null;if(sub){await api('/unsubscribe','POST',{endpoint:sub.endpoint});await sub.unsubscribe();}mountNotifications();}catch(e){alert(e.message);}};
 const test=ref.querySelector('#notification-test');if(test)test.onclick=async()=>{try{const r=await api('/test','POST',{});alert(r.created?'テスト通知を送信しました。端末の通知を確認してください。':'この1分以内にテスト通知を送信済みです。');mountNotifications();}catch(e){alert(e.message);}};
 ref.querySelectorAll('[data-notification-read]').forEach(btn=>btn.onclick=async()=>{try{await api('/read','POST',{id:btn.dataset.notificationRead});mountNotifications();}catch(e){alert(e.message);}});
 }catch(e){if(document.contains(ref))ref.textContent='通知を読み込めませんでした：'+e.message;}
}
