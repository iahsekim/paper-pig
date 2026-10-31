/* Paper Pig service worker: makes the site installable and lets it open without a connection.
   Always asks the network first, so families get updates right away; the saved copy is only a fallback.
   Only this site's own files are kept. Sign-in, data (Supabase) and email are never cached. */
const CACHE = 'paperpig-v3';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/index.html']).catch(() => { }))) });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())) });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/.netlify/')) return;
  e.respondWith(fetch(r).then(res => { if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)) } return res })
    .catch(() => caches.match(r).then(hit => hit || (r.mode === 'navigate' ? caches.match('/') : Response.error()))));
});

/* Timer alerts: when a reading or screen timer runs out, the database sends a push (netlify/functions/ring.js),
   and this shows it with the phone's notification sound, even with the app closed or the screen locked.
   It comes again every 10 seconds, for up to 2 minutes, until someone taps it (or swipes it away, where the
   phone tells us). The tap stops the ringing with the token that came with it, signed in or not. */
self.window = self;
try { importScripts('/config.js') } catch (_) { }
const CFG = self.CHORE_JAR_CONFIG || {};
const ringOff = d => (d && d.sid && d.tok && CFG.supabaseUrl) ? fetch(CFG.supabaseUrl + '/rest/v1/rpc/pp_ring_off', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + CFG.supabaseAnonKey },
  body: JSON.stringify({ p_id: d.sid, p_token: d.tok }),
}).catch(() => { }) : Promise.resolve();
const closeRings = async sid => { try { if (sid) (await self.registration.getNotifications()).forEach(x => { if (x.data && x.data.sid === sid) x.close() }) } catch (_) { } };

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {} } catch (_) { d = { body: e.data ? e.data.text() : '' } }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // The app is open and in front: it rings on its own, so this one stays quiet.
    const open = wins.some(w => w.visibilityState === 'visible');
    // One notification per timer: the new ring replaces the last one instead of piling up.
    await closeRings(d.sid);
    await self.registration.showNotification(d.title || 'Time’s up!', {
      body: d.body || 'A timer is done.', tag: (d.sid ? 'pp-' + d.sid : 'pp-timer') + '-' + (d.n || 0), requireInteraction: !open, silent: open,
      icon: '/icon-192.png', vibrate: [400, 150, 400, 150, 800], data: { url: d.url || '/', sid: d.sid || '', tok: d.tok || '' },
    });
  })());
});
self.addEventListener('notificationclick', e => {
  const d = e.notification.data || {};
  e.notification.close();
  e.waitUntil(Promise.all([ringOff(d), closeRings(d.sid), self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => 'focus' in x);
    return w ? w.focus() : self.clients.openWindow(d.url || '/');
  })]));
});
self.addEventListener('notificationclose', e => { e.waitUntil(ringOff(e.notification.data || {})) });
