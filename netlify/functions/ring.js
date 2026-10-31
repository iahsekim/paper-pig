// Rings a family's phones and tablets when a reading or screen timer runs out, even when Paper Pig is closed
// or the screen is locked. The database calls this when a timer ends (supabase/schema.sql, "timer alerts"), and again
// every 10 seconds for up to 2 minutes until someone taps the notification, with the notification and the push
// addresses of the family's devices. Nobody else can: the request has to
// carry the shared secret. Devices the push service says are gone come back in "gone", and the database forgets them.
//
// Environment variables in Netlify (Site configuration > Environment variables, scope: Functions):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  the push keys. Get a fresh pair by visiting
//                                        https://paperpig.app/.netlify/functions/ring?new-keys
//   JOINED_HOOK_SECRET                   already set for member alerts (the same text as pp_hook_secret in Supabase Vault)
// A plain visit (GET) reports whether it's ready, and gives the app the public key.

const crypto = require('crypto');
const webpush = require('web-push');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y) };
const clip = (s, n) => String(s ?? '').slice(0, n);

exports.handler = async (event) => {
  try { return await run(event) } catch (e) { console.error('ring crashed', e); return json(500, { error: 'crash', detail: String(e && e.message || e) }) }
};

async function run(event) {
  const env = process.env, pub = env.VAPID_PUBLIC_KEY, priv = env.VAPID_PRIVATE_KEY;
  if (event.httpMethod === 'GET') {
    const qs = event.queryStringParameters || {};
    if (!(pub && priv) && 'new-keys' in qs) {
      const k = webpush.generateVAPIDKeys();
      return json(200, { setup: 'Add both as environment variables in Netlify (scope: Functions), then redeploy. Keep the private key secret.', VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey });
    }
    return json(200, { ready: !!(pub && priv && env.JOINED_HOOK_SECRET), publicKey: pub || null });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
  const secret = env.JOINED_HOOK_SECRET;
  const h = event.headers || {};
  if (!secret || !same(h['x-pp-hook'] || h['X-Pp-Hook'] || '', secret)) return json(401, { error: 'secret' });
  if (!pub || !priv) return json(200, { ring: 0, gone: [], error: 'VAPID keys are not set' });

  let m = {};
  try { m = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : (event.body || '{}')) } catch (e) { return json(400, { error: 'body' }) }
  const subs = (Array.isArray(m.subs) ? m.subs : []).slice(0, 50)
    .filter(s => s && /^https:\/\//.test(s.endpoint || '') && s.keys && s.keys.p256dh && s.keys.auth);
  // sid + tok let a tap on the notification stop the ringing (pp_ring_off); n counts the rings, 0 is the first.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const sid = UUID.test(m.sid || '') ? m.sid : '', tok = UUID.test(m.tok || '') ? m.tok : '';
  const payload = JSON.stringify({ title: clip(m.title, 60) || 'Time’s up!', body: clip(m.body, 180), sid, tok, n: Math.max(0, Math.min(50, parseInt(m.n) || 0)), url: '/' });

  webpush.setVapidDetails(env.VAPID_SUBJECT || 'https://paperpig.app', pub, priv);
  const gone = []; let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      // A ring is only useful right away: drop it if the device can't get it within a minute.
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, payload, { TTL: 60, urgency: 'high', timeout: 6000 });
      sent++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) gone.push(s.endpoint);
      else console.error('push failed', e && e.statusCode, clip(e && (e.body || e.message), 200), new URL(s.endpoint).host);
    }
  }));
  // The database reads this reply back (it must start with {"ring":) to forget the gone devices.
  return json(200, { ring: sent, gone });
}
