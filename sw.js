/* Paper Pig service worker: makes the site installable and lets it open without a connection.
   Always asks the network first, so families get updates right away; the saved copy is only a fallback.
   Only this site's own files are kept. Sign-in, data (Supabase) and email are never cached. */
const CACHE = 'paperpig-v2';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/index.html']).catch(() => { }))) });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())) });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/.netlify/')) return;
  e.respondWith(fetch(r).then(res => { if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)) } return res })
    .catch(() => caches.match(r).then(hit => hit || (r.mode === 'navigate' ? caches.match('/') : Response.error()))));
});

/* Timer alerts: when a reading or screen timer runs out, the database sends a push (netlify/functions/ring.js),
   and this shows it with the phone's notification sound, even with the app closed or the screen locked. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {} } catch (_) { d = { body: e.data ? e.data.text() : '' } }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // The app is open and in front: it already rings on its own, so this one stays quiet.
    const open = wins.some(w => w.visibilityState === 'visible');
    await self.registration.showNotification(d.title || 'Time’s up!', {
      body: d.body || 'A timer is done.', tag: d.tag || 'pp-timer', renotify: true, requireInteraction: !open, silent: open,
      icon: '/icon-192.png', vibrate: [400, 150, 400, 150, 800], data: { url: d.url || '/' },
    });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => 'focus' in x);
    return w ? w.focus() : self.clients.openWindow((e.notification.data && e.notification.data.url) || '/');
  }));
});
