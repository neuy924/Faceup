const VERSION='retouch-v2-__BUILD__';
const FILES=['./','index.html','styles.css','app.js','engine.js','worker.js','faces.js','store.js','manifest.webmanifest','icon-180.png','icon-512.png',
'vendor/vision_bundle.mjs','vendor/jpeg-encoder.js','vendor/face_landmarker.task','vendor/wasm/vision_wasm_internal.js','vendor/wasm/vision_wasm_internal.wasm','vendor/wasm/vision_wasm_module_internal.js','vendor/wasm/vision_wasm_module_internal.wasm'];
self.addEventListener('install',e=>e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES.map(f=>new Request(f,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n.startsWith('retouch-')&&n!==VERSION).map(n=>caches.delete(n)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request)));});
