self.addEventListener('install', (e) => {
    console.log('[Service Worker] Install');
    e.waitUntil(
        caches.open('frog-calendar-v1').then((cache) => {
            return cache.addAll([
                './',
                './index.html',
                './style.css',
                './app.js',
                './manifest.json'
            ]);
        })
    );
});

self.addEventListener('fetch', (e) => {
    // PWA 필수 조건 충족을 위한 가벼운 네트워크 우선(Network-First) 전략
    e.respondWith(
        fetch(e.request).catch(() => {
            return caches.match(e.request);
        })
    );
});
