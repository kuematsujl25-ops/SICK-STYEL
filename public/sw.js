const CACHE='sickstyle-shell-v4';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/offline.html','/style.css','/logo-mark.png','/icon-192.png','/icon-512.png'])));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;if(url.pathname.startsWith('/api/')){event.respondWith(fetch(event.request,{cache:'no-store'}));return;}if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));return;}if(event.request.method==='GET'&&['/style.css','/logo-mark.png','/icon-192.png','/icon-512.png'].includes(url.pathname))event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));});

self.addEventListener('push',event=>{
 let msg={};try{msg=event.data?.json()||{};}catch{}
 let title=String(msg.title||'SICKSTYLEからのお知らせ').slice(0,100);
 let body=String(msg.body||'管理アプリをご確認ください').slice(0,500);
 event.waitUntil((async()=>{
  if(msg.reminderId){
   let active=false;
   if(Number.isFinite(msg.expiresAt)&&Date.now()<msg.expiresAt){
    try{const r=await fetch('/api/notifications/meeting-active?id='+encodeURIComponent(msg.reminderId),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});active=r.ok&&(await r.json()).active&&Date.now()<msg.expiresAt;}catch{}
   }
   // Safari requires every delivered push to show a notification. A neutral fallback
   // preserves subscriptions without presenting a cancelled/expired meeting as upcoming.
   if(!active){title='会議予定のお知らせ｜SICKSTYLE';body='予定が変更・終了したか、最新の状態を確認できませんでした。アプリでご確認ください。';}
  }
  await self.registration.showNotification(title,{
  body,tag:String(msg.tag||'sickstyle').slice(0,140),icon:'/icon-192.png',badge:'/icon-192.png',
  data:{url:['/?notifications=1','/?meetings=1'].includes(msg.url)?msg.url:'/'}
 });
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const path=['/?notifications=1','/?meetings=1'].includes(event.notification.data?.url)?event.notification.data.url:'/';
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(w=>new URL(w.url).origin===self.location.origin);
  if(existing){await existing.focus();if('navigate'in existing)await existing.navigate(path);return;}
  await self.clients.openWindow(path);
 })());
});
