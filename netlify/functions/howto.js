// The "how to use Paper Pig" email, sent from the admin page (paperpig.app/admin → Email families).
//
// Who can use it: only a Paper Pig admin. The caller's sign-in token has to get an answer from the database
// function pp_admin_overview, which only answers people in pp_admins.
// Who it can email: only parents and guardians of families on Paper Pig (never any other address), each one
// their own email, and never the same person twice (pp_email_log). Your own family is left out.
//
// Environment variables in Netlify (already set for invites): RESEND_API_KEY.
// Optional: HOWTO_FROM (default "Mike from Paper Pig <mike@paperpig.app>": any address at paperpig.app sends, no inbox needed),
//           HOWTO_REPLY_TO (where replies go; default: the email of the admin who sends it).
//
// POST, with the admin's sign-in token as "Authorization: Bearer ...", and one of:
//   { action: "list" }                       everyone it could go to, and who already got it
//   { action: "preview", status: "notset" }  the email as a family sees it ("notset" or "setup")
//   { action: "test" }                       sends it to the admin only, marked [Test]; not recorded
//   { action: "send", emails: [...] }        sends it (up to 100 per call) and records who got it

const crypto = require('crypto');

const SB_URL = process.env.SUPABASE_URL || 'https://wddbtkmtqunsbpfyzkxd.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_nvKmj2yOomzogvrTKwXVNw_jr6EZjSG';
const SITE = (process.env.SITE_URL || 'https://paperpig.app').replace(/\/$/, '');
const FROM = process.env.HOWTO_FROM || 'Mike from Paper Pig <mike@paperpig.app>';  // not noreply: the email asks people to reply
const KIND = 'howto-1';     // change this to send a new version to everyone again
const PER_CALL = 100;       // Resend sends up to 100 in one batch

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isEmail = s => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/.test(s);
const statusOf = f => !f.kids ? 'notset' : f.actions7 > 0 ? 'week' : f.actions30 > 0 ? 'month' : f.actions > 0 ? 'quiet' : 'never';

exports.handler = async (event) => {
  try { return await run(event) } catch (e) { console.error('howto crashed', e); return json(500, { error: 'crash', detail: String(e && e.message || e) }) }
};

async function run(event) {
  if (event.httpMethod === 'GET') return json(200, { configured: !!process.env.RESEND_API_KEY, kind: KIND });
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
  const key = process.env.RESEND_API_KEY;
  const h = event.headers || {}, auth = h.authorization || h.Authorization || '';
  if (!/^Bearer \S+$/.test(auth)) return json(401, { error: 'signin' });
  let m = {};
  try { m = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : (event.body || '{}')) } catch (e) { return json(400, { error: 'body' }) }

  const sb = (path, body) => fetch(`${SB_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: SB_KEY, authorization: auth, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const who = await sb('/auth/v1/user');
  if (!who.ok) return json(401, { error: 'signin' });
  const me = await who.json();
  const ov = await sb('/rest/v1/rpc/pp_admin_overview', {});
  if (!ov.ok) return json(403, { error: 'admin' });
  const data = await ov.json();

  // everyone it could go to: one entry per parent/guardian email, your own family left out
  const people = new Map();
  for (const f of data.families || []) {
    if (f.mine) continue;
    for (const p of f.parents || []) {
      const email = String(p.email || '').trim().toLowerCase();
      if (!isEmail(email) || people.has(email)) continue;
      people.set(email, { email, family: f.name || 'Our family', status: statusOf(f), setup: f.kids > 0, joined: f.created_at, sent: (p.emailed || {})[KIND] || null });
    }
  }

  if (m.action === 'list') return json(200, { kind: KIND, from: FROM, people: [...people.values()] });
  if (m.action === 'preview') { const e = build({ email: 'parent@example.com', setup: m.status !== 'notset' }); return json(200, { subject: e.subject, html: e.html, text: e.text, from: FROM }) }

  if (!key) return json(503, { error: 'not_configured', detail: 'RESEND_API_KEY is not set in Netlify.' });
  // Sending needs the sent log, so nobody gets it twice. Looking and previewing don't.
  if (m.action === 'send' && !data.email_log) return json(409, { error: 'schema', detail: 'Run supabase/schema.sql again in Supabase: it adds the sent log, so nobody gets the email twice.' });
  const replyTo = process.env.HOWTO_REPLY_TO || me.email || undefined;

  if (m.action === 'test') {
    if (!isEmail(me.email || '')) return json(400, { error: 'email' });
    const e = build({ email: me.email, setup: m.status !== 'notset' });
    const r = await resend(key, '/emails', { from: FROM, to: [me.email], subject: `[Test] ${e.subject}`, html: e.html, text: e.text, ...(replyTo ? { reply_to: replyTo } : {}) });
    if (!r.ok) return json(502, { error: 'send_failed', detail: r.detail });
    return json(200, { ok: true, to: me.email });
  }

  if (m.action === 'send') {
    const asked = [...new Set((Array.isArray(m.emails) ? m.emails : []).map(x => String(x).trim().toLowerCase()))];
    const go = asked.map(x => people.get(x)).filter(p => p && !p.sent);
    const skipped = asked.length - go.length;
    const batch = go.slice(0, PER_CALL);
    if (!batch.length) return json(200, { sent: 0, skipped, left: 0, emails: [] });
    const msgs = batch.map(p => { const e = build({ email: p.email, setup: p.setup }); return { from: FROM, to: [p.email], subject: e.subject, html: e.html, text: e.text, ...(replyTo ? { reply_to: replyTo } : {}) } });
    // The same list never goes out twice, even if the button is pressed twice.
    const idem = KIND + '-' + crypto.createHash('sha256').update(batch.map(p => p.email).sort().join(',')).digest('hex').slice(0, 32);
    const r = await resend(key, '/emails/batch', msgs, idem);
    if (!r.ok) return json(502, { error: 'send_failed', detail: r.detail, sent: 0, skipped });
    const sent = batch.map(p => p.email);
    const log = await sb('/rest/v1/rpc/pp_admin_log_email', { p_kind: KIND, p_emails: sent });
    if (!log.ok) console.error('howto: sent but not recorded', await log.text());
    return json(200, { sent: sent.length, skipped, left: go.length - batch.length, emails: sent, recorded: log.ok });
  }
  return json(400, { error: 'action' });
}

async function resend(key, path, body, idem) {
  const r = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(idem ? { 'Idempotency-Key': idem } : {}) },
    body: JSON.stringify(body),
  });
  if (r.ok) return { ok: true, body: await r.json().catch(() => ({})) };
  const t = await r.text(); console.error('resend', r.status, t);
  let detail = t; try { detail = JSON.parse(t).message || t } catch (e) { }
  if (r.status === 429) detail = 'Resend says that is too many emails for today. Send the rest tomorrow: everyone who already got it is skipped. (' + detail + ')';
  return { ok: false, detail: String(detail).slice(0, 400) };
}

// ---------------------------------------------------------------- the email
function build({ email, setup }) {
  const subject = 'How to use Paper Pig (about 10 minutes)';
  const pre = 'Put it on your home screen, add your kids, and let them pick their first job.';
  const intro = setup
    ? 'Your family is set up. What is left is getting Paper Pig onto your phone and your kid’s screen, and showing them how it works. Here is everything you need.'
    : 'Your kids are not added yet. That part takes about five minutes, and then they can start picking jobs. Here is everything you need.';
  const hello = 'Hi, I’m Mike. I built Paper Pig for my own kids. Thank you for signing up.';
  const joke = 'Paper Pig will not do the dishes for your kids. It will get your kids to do the dishes, which is the next best thing.';
  // the last two words of a paragraph stay together, so no word sits alone on the last line
  const tie = t => t.replace(/ ([^ <>]+)$/, '&nbsp;$1');

  const P = 'margin:0 0 14px;font-size:16px;line-height:1.55';
  const H2 = 'margin:26px 0 10px;font-size:20px;line-height:1.25;color:#14101A';
  const NUM = (n) => `<span style="display:inline-block;width:26px;height:26px;line-height:26px;border-radius:13px;background:#FC3067;color:#fff;font-size:14px;font-weight:700;text-align:center;margin-right:8px;vertical-align:1px">${n}</span>`;
  const OL = items => `<ol style="margin:0 0 14px;padding:0 0 0 22px;font-size:16px;line-height:1.55">${items.map(t => `<li style="margin:0 0 6px">${tie(t)}</li>`).join('')}</ol>`;
  const UL = items => `<ul style="margin:0 0 14px;padding:0 0 0 20px;font-size:16px;line-height:1.55">${items.map(t => `<li style="margin:0 0 8px">${tie(t)}</li>`).join('')}</ul>`;
  const para = (t, style = P) => `<p style="${style}">${tie(t)}</p>`;
  const BOX = (title, inner) => `<div style="border:3px solid #000;border-radius:16px;padding:14px 16px 4px;margin:0 0 14px;background:#FFFFFF"><p style="margin:0 0 8px;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#C70F48">${title}</p>${inner}</div>`;
  const share = `<img src="${SITE}/email/share.png" width="18" height="18" alt="" style="vertical-align:-3px;border:0">`;
  const site = `<a href="${SITE}" style="color:#1F4FD1;font-weight:700">paperpig.app</a>`;
  // two app screenshots side by side, each with a line under it (pictures from the demo family, not a real one)
  const SHOT = (file, alt, cap, pad) => `<td width="50%" valign="top" style="padding:${pad}"><img src="${SITE}/email/${file}" width="236" alt="${esc(alt)}" style="display:block;width:100%;max-width:236px;height:auto;border:0;margin:0 auto"><p style="margin:8px 2px 0;font-size:14px;line-height:1.4;font-weight:600;color:#14101A;text-align:center">${tie(cap)}</p></td>`;
  const ROW = (a, b) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border-collapse:collapse"><tr>${SHOT(...a, '0 6px 0 0')}${SHOT(...b, '0 0 0 6px')}</tr></table>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#FFF0F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14101A">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(pre)}</div>
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
  <div style="background:#fff;border:4px solid #000;border-radius:22px;padding:28px 22px 22px">
    <img src="${SITE}/icon-192.png" width="56" height="56" alt="Paper Pig" style="display:block;border:3px solid #000;border-radius:14px;margin:0 0 16px">
    <h1 style="margin:0 0 14px;font-size:27px;line-height:1.15">How to use Paper Pig</h1>
    ${para(hello)}
    ${para(intro)}
    ${para(joke)}
    <a href="${SITE}" style="display:inline-block;background:#FC3067;color:#fff;text-decoration:none;font-weight:700;font-size:17px;padding:13px 22px;border:3px solid #000;border-radius:14px;margin:4px 0 6px">Open Paper Pig</a>

    <h2 style="${H2}">${NUM(1)}Put it on your home screen</h2>
    ${para('Paper Pig is not in the App Store. It installs from your browser, it is free, and it opens full screen with its own icon like any other app.')}
    ${BOX('iPhone or iPad', OL([
      `Open ${site} in <b>Safari</b>.`,
      `Tap <b>Share</b> ${share}. If you don’t see it, tap <b>•••</b> first.`,
      'Scroll down, tap <b>Add to Home Screen</b>, then <b>Add</b>. If you see <b>Open as Web App</b>, leave it on.',
      'Open Paper Pig from your home screen and sign in with the <b>code</b> from the email.',
    ]) + para('The home-screen app has its own sign-in, so you sign in once more inside it. Type the code: a link in an email opens Safari instead.', 'margin:0 0 12px;font-size:14px;line-height:1.5;color:#6B5C66'))}
    ${BOX('Android', OL([
      `Open ${site} in <b>Chrome</b>.`,
      'Tap the menu <b>⋮</b> at the top right.',
      'Tap <b>Add to Home screen</b> or <b>Install app</b>, then <b>Install</b>.',
    ]))}
    ${para('Do the same on your kid’s tablet or phone. Kids use your sign-in and pick their own name. Your parent tools stay behind your 4-digit PIN.')}

    <h2 style="${H2}">${NUM(2)}Set it up${setup ? ' (you already did this part)' : ' (about 5 minutes)'}</h2>
    ${para('Sign in with your email. There is no password: you get a code. Then it asks one question per screen: your family name, a parent PIN, and for each kid their name, weekly allowance, screen minutes (a week or a day) and screen days. Last, a starter job list with prices. Keep, change or delete any of them.')}

    <h2 style="${H2}">${NUM(3)}How a week works</h2>
    ${UL([
      '<b>Allowance.</b> Every Monday, each kid’s allowance goes into their bank.',
      '<b>Jobs.</b> Your kid picks a job and taps <b>I did it</b>. You see it under <b>Needs your OK</b>. Tap <b>OK</b> and the money lands in their bank.',
    ])}
    ${ROW(['kid-did.jpg', 'A kid’s job in Paper Pig with an I did it button', 'Your kid picks a job and taps I did it.'],
          ['parent-ok.jpg', 'The parent side of Paper Pig, with jobs waiting for an OK', 'You tap OK. The money lands in their bank.'])}
    ${UL([
      '<b>Reading earns screen time.</b> Your kid starts the reading timer. Every minute read adds a screen minute that week, up to the limit you set.',
      '<b>Screen time.</b> On screen days, the screen clock counts down their minutes. It stops at zero, even if nobody has the app open.',
    ])}
    ${ROW(['kid-bank.jpg', 'A kid’s bank in Paper Pig, with a savings goal', 'What your kid sees: their bank and their savings goal.'],
          ['kid-reading.jpg', 'The Paper Pig reading timer counting down', 'The reading timer counts down and rings when it is done.'])}
    ${UL([
      '<b>Money out.</b> When you hand over cash or buy something with their money, record it. Every entry needs an explanation, so they always know where it went.',
      '<b>Saving.</b> Kids can set money aside for something they want, and watch it add up.',
    ])}

    <h2 style="${H2}">${NUM(4)}Let the timers ring</h2>
    ${para('When a reading or screen timer runs out, your phone rings, even with the app closed or the screen locked. The first time you start a timer, tap <b>Allow</b> for notifications. On iPhone this needs the home-screen app from step 1. <b>Settings&nbsp;→ Timer&nbsp;alerts</b> turns it on or off.')}

    ${para('Questions, a bug, or an idea: reply to this email. It comes straight to me.', P + ';margin-top:24px')}
    <p style="margin:0;font-size:16px;line-height:1.55">Mike<br><span style="color:#6B5C66">Paper Pig</span></p>
  </div>
  <p style="margin:16px 6px 0;font-size:12px;line-height:1.5;color:#6B5C66">You’re getting this because ${esc(email)} signed up for Paper Pig at ${SITE.replace(/^https?:\/\//, '')}. This is a one-time how-to, not a newsletter. Paper Pig is free, with no ads.</p>
</div></body></html>`;

  const text = `How to use Paper Pig

${hello.replace(/’/g, "'")}

${intro.replace(/’/g, "'")}

${joke}

Open Paper Pig: ${SITE}

1. PUT IT ON YOUR HOME SCREEN
Paper Pig is not in the App Store. It installs from your browser, it is free, and it opens full screen with its own icon like any other app.

iPhone or iPad:
  1. Open paperpig.app in Safari.
  2. Tap Share (the square with an arrow pointing up). If you don't see it, tap ••• first.
  3. Scroll down, tap Add to Home Screen, then Add. If you see Open as Web App, leave it on.
  4. Open Paper Pig from your home screen and sign in with the code from the email.
  The home-screen app has its own sign-in, so you sign in once more inside it. Type the code: a link in an email opens Safari instead.

Android:
  1. Open paperpig.app in Chrome.
  2. Tap the menu (three dots) at the top right.
  3. Tap Add to Home screen or Install app, then Install.

Do the same on your kid's tablet or phone. Kids use your sign-in and pick their own name. Your parent tools stay behind your 4-digit PIN.

2. SET IT UP${setup ? ' (you already did this part)' : ' (about 5 minutes)'}
Sign in with your email. There is no password: you get a code. Then it asks one question per screen: your family name, a parent PIN, and for each kid their name, weekly allowance, screen minutes (a week or a day) and screen days. Last, a starter job list with prices. Keep, change or delete any of them.

3. HOW A WEEK WORKS
- Allowance. Every Monday, each kid's allowance goes into their bank.
- Jobs. Your kid picks a job and taps I did it. You see it under Needs your OK. Tap OK and the money lands in their bank.
- Reading earns screen time. Your kid starts the reading timer. Every minute read adds a screen minute that week, up to the limit you set.
- Screen time. On screen days, the screen clock counts down their minutes. It stops at zero, even if nobody has the app open.
- Money out. When you hand over cash or buy something with their money, record it. Every entry needs an explanation, so they always know where it went.
- Saving. Kids can set money aside for something they want, and watch it add up.

4. LET THE TIMERS RING
When a reading or screen timer runs out, your phone rings, even with the app closed or the screen locked. The first time you start a timer, tap Allow for notifications. On iPhone this needs the home-screen app from step 1. Settings > Timer alerts turns it on or off.

Questions, a bug, or an idea: reply to this email. It comes straight to me.

Mike
Paper Pig

You're getting this because ${email} signed up for Paper Pig at paperpig.app. This is a one-time how-to, not a newsletter. Paper Pig is free, with no ads.
`;
  return { subject, html, text };
}

exports.build = build; // for checking the email locally
