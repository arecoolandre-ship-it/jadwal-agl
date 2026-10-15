// Service worker Jadwal AGL.
// - Halaman & ikon disimpan agar aplikasi tetap terbuka saat offline.
// - Data spreadsheet (docs.google.com) TIDAK disimpan di sini: selalu diambil dari jaringan,
//   dan aplikasi memakai salinan terakhir miliknya sendiri jika sedang offline.
const CACHE = 'jadwal-agl-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('jadwal-agl-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;   // Google Sheets, font, dll: langsung ke jaringan

  // Halaman utama: ambil versi terbaru dulu, pakai simpanan hanya jika offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); }
          return res;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  // File lain (ikon, manifest): simpanan dulu.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});
