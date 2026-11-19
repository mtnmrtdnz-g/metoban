// Sadece uygulama dosyalarını önbelleğe alır; Google API isteklerine dokunmaz (her zaman ağdan gider).
const C='metoban-v37',FILES=['./','./index.html','./providers.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./mark.svg','./vendor/leaflet-gesture-handling.min.js','./vendor/leaflet-gesture-handling.min.css'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin)return;
  // önce ağ (güncel sürüm), ağ yoksa önbellek
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true})));});
