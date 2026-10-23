const CACHE='sickstyle-shell-v4';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/offline.html','/style.css','/logo-mark.png','/icon-192.png','/icon-512.png'])));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;if(url.pathname.startsWith('/api/')){event.respondWith(fetch(event.request,{cache:'no-store'}));return;}if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));return;}if(event.request.method==='GET'&&['/style.css','/logo-mark.png','/icon-192.png','/icon-512.png'].includes(url.pathname))event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));});

self.addEventListener('push',event=>{
 let msg={};try{msg=event.data?.json()||{};}catch{}
 const title=String(msg.title||'SICKSTYLEからのお知らせ').slice(0,100);
 const body=String(msg.body||'管理アプリをご確認ください').slice(0,500);
 event.waitUntil(self.registration.showNotification(title,{
  body,tag:String(msg.tag||'sickstyle').slice(0,140),icon:'/icon-192.png',badge:'/icon-192.png',
  data:{url:msg.url==='/?notifications=1'?'/?notifications=1':'/'}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const path=event.notification.data?.url==='/?notifications=1'?'/?notifications=1':'/';
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(w=>new URL(w.url).origin===self.location.origin);
  if(existing){await existing.focus();if('navigate'in existing)await existing.navigate(path);return;}
  await self.clients.openWindow(path);
 })());
});
