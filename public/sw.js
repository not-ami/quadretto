// Quadretto — service worker: l'interfaccia si apre anche senza rete.
// I dati degli appunti li gestisce l'app (IndexedDB + coda verso il server).
const VERSION = 'quadretto-2026.11.8-B'; // aggiornato da deploy.sh
// build: 2026-11-24, multilingua (i18n.js, lang/en.js) — cambia il file, così il service worker ricarica i file anche a parità di versione
const IMG = 'quadretto-img'; // foto e PDF sono immutabili: la loro cache sopravvive agli aggiornamenti
const SHELL = [
  '/', '/css/app.css', '/js/app.js', '/js/auth.js', '/js/store.js', '/js/i18n.js', '/js/lang/en.js', '/js/ink.js', '/js/md.js', '/js/fmt.js', '/js/courses.js', '/js/version.js', '/js/code.js', '/js/changelog.js', '/js/py-worker.js', '/js/js-worker.js',
  '/js/motion.js', '/js/explain.js', '/js/posix-ref.js', '/js/xray.js', '/js/race.js', '/js/race-worker.js', '/js/sched.js', '/js/sim.js', '/js/charts.js', '/js/print.js', '/js/so-tools.js', '/js/so-templates.js', '/js/complete.js',
  '/js/ydoc.js', '/js/live.js', '/js/collab.js', '/vendor/yjs/yjs.mjs',
  '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-180.png',
  '/vendor/marked/marked.umd.js', '/vendor/purify/purify.min.js', '/vendor/katex/katex.min.js', '/vendor/katex/katex.min.css',
  '/vendor/hljs/highlight.min.js', '/vendor/fflate/browser.js', '/vendor/font-display/wght.css', '/vendor/font-mono/wght.css',
  '/js/pdfdoc.js', '/vendor/pdfjs/build/pdf.min.mjs', '/vendor/pdfjs/build/pdf.worker.min.mjs', '/vendor/pdfjs/build/pdf.renderer.min.mjs', // 2026.11.6: PDF anche offline
];
// 'reload' e 'no-cache': i file di /vendor/ sono serviti come immutabili per un anno e hanno sempre lo stesso indirizzo;
// senza, dopo un aggiornamento dei pacchetti il browser terrebbe le librerie vecchie (BUG-018, 2026-11-27).
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== IMG).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/attachments/')) {
    // foto e PDF: prima la cache, sono immutabili
    e.respondWith(caches.open(IMG).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/l/')) return; // link in sola lettura: sempre dalla rete, mai in cache (2026-11-24)
  if (url.pathname.startsWith('/vendor/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request, { cache: 'no-cache' }).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, cp)); return r; })));
    return;
  }
  // interfaccia: rete prima (aggiornamenti immediati), cache se offline
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/'))));
});
