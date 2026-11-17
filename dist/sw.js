// Bump the version whenever an application asset changes.
const CACHE_PREFIX='girya-shell-';
const CACHE_NAME=CACHE_PREFIX+'2026-11-17-backup1';
const ASSETS=['./','index.html','style.css','app.js','iron.css','iron.js','training.css','training.js','pwa.css','pwa.js','manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable.png','backup.css','backup.js','backup-ui.js'];
const assetURLs=new Set(ASSETS.map(p=>new URL(p,self.registration.scope).href));
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS.map(p=>new Request(new URL(p,self.registration.scope),{cache:'reload'})))));
  // A new version waits until the user explicitly applies it or closes all tabs.
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(CACHE_PREFIX)&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{if(event.data?.type==='APPLY_UPDATE')self.skipWaiting()});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  if(request.mode==='navigate'){
    event.respondWith(caches.open(CACHE_NAME).then(async cache=>(await cache.match(new URL('index.html',self.registration.scope)))||fetch(request)));
    return;
  }
  const canonical=new URL(url.pathname,url.origin).href;
  if(!assetURLs.has(canonical))return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache=>(await cache.match(canonical))||fetch(request)));
});


