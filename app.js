/* Paper Pig — allowance, job board, reading log and weekend screen clock for families. */
const CFG = window.CHORE_JAR_CONFIG;
const APP = CFG.appName || 'Paper Pig';
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const COLORS = { green: '#1FA34A', blue: '#2F6BFF', purple: '#7A3FF2', orange: '#FF6B1A', pink: '#F0418C', teal: '#0FA3A3' };
const S = {
  user: null, family: null, members: [], invites: [], kids: [], jobs: [], goals: [], moves: [], weeks: [], credits: [], tx: [], reading: [], screen: [], sbonus: [],
  view: 'loading', profile: null, parentOk: false, tab: 'home', ptab: 'kids', jobFilter: 'All',
  authEmail: '', authStep: 'email', onboard: null
};
const store = {
  get(k) { try { return localStorage.getItem('cj-' + k) } catch (e) { return null } },
  set(k, v) { try { v == null ? localStorage.removeItem('cj-' + k) : localStorage.setItem('cj-' + k, v) } catch (e) { } }
};
try { S.parentOk = sessionStorage.getItem('cj-parent') === '1' } catch (e) { }

/* ---------- dates in the family's time zone ---------- */
const tz = () => S.family?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver';
const localDate = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) };
const fmtD = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return fmtD(d) };
const dow = s => parseD(s).getUTCDay();
const monday = s => addDays(s, -((dow(s) + 6) % 7));
const today = () => localDate();
const thisWeek = () => monday(today());
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = s => { const d = parseD(s); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` };
const short = s => `${DOW[dow(s)]}, ${md(s)}`;
const clockTime = ms => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz() });
/* Time parts in the family's time zone: "HH:MM" (24h, for <input type=time>) and back to an ISO instant. */
const tzParts = t => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
const hhmm = (t = Date.now()) => { const p = tzParts(t); return `${pad(+p.hour % 24)}:${p.minute}` };
const zonedISO = (d, hm = '12:00') => {
  const [y, m, dd] = d.split('-').map(Number), [h, mi] = String(hm || '12:00').split(':').map(Number), want = Date.UTC(y, m - 1, dd, h || 0, mi || 0);
  let t = want; for (let i = 0; i < 3; i++) { const p = tzParts(t); t += want - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) }
  return new Date(t).toISOString();
};
const pad = n => String(n).padStart(2, '0');
const fmt = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(t / 60))}:${pad(t % 60)}` };
const r2 = n => Math.round(n * 100) / 100;
const money = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = iso => iso ? new Date(iso).getTime() : 0;
const $ = id => document.getElementById(id);
const titleCase = v => String(v || '').trim().replace(/\s+/g, ' ').replace(/(^|[\s-])(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
const capFirst = v => { const t = String(v || '').trim(); return t ? t[0].toUpperCase() + t.slice(1) : t };
/* Color swatches update in place, so typing in nearby fields is never lost. */
function swatchesHTML(sel, attr = 'data-sw') { return `<div class="swatches" role="radiogroup" aria-label="Color">${Object.entries(COLORS).map(([n, c]) => `<button class="sw" type="button" role="radio" ${attr}="${n}" aria-label="${n}" aria-checked="${sel === n}" aria-pressed="${sel === n}" style="background:${c}"></button>`).join('')}</div>` }
function bindSwatches(root, attr, onPick) { root.querySelectorAll(`[${attr}]`).forEach(b => b.onclick = () => { root.querySelectorAll(`[${attr}]`).forEach(x => { const on = x === b; x.setAttribute('aria-pressed', on); x.setAttribute('aria-checked', on) }); onPick(b.getAttribute(attr)) }) }

/* ---------- data access ---------- */
async function q(p) { const { data, error } = await p; if (error) throw error; return data }
async function loadAll() {
  const fid = S.family.id, since = addDays(today(), -70);
  const [fam, members, invites, kids, jobs, weeks, credits, tx, reading, screen, sbonus, pen, goals, moves] = await Promise.all([
    q(sb.from('families').select('*').eq('id', fid).single()),
    q(sb.from('family_members').select('email,user_id').eq('family_id', fid)),
    q(sb.from('family_invites').select('email').eq('family_id', fid)),
    q(sb.from('kids').select('*').eq('family_id', fid).order('created_at')),
    q(sb.from('jobs').select('*').eq('family_id', fid).order('sort')),
    q(sb.from('weeks').select('*').eq('family_id', fid)),
    q(sb.from('credits').select('*').eq('family_id', fid).order('created_at', { ascending: false })),
    q(sb.from('transactions').select('*').eq('family_id', fid).order('created_at', { ascending: false })),
    q(sb.from('reading_sessions').select('*').eq('family_id', fid).gte('local_date', since).order('started_at', { ascending: false })),
    q(sb.from('screen_sessions').select('*').eq('family_id', fid).gte('local_date', since)),
    q(sb.from('screen_bonus').select('*').eq('family_id', fid).gte('week_start', since)),
    // Older databases may not have the jar table yet; the app keeps working without it.
    Promise.resolve(sb.from('penalties').select('*').eq('family_id', fid).order('created_at', { ascending: false })).then(r => r.error ? [] : r.data || [], () => []),
    // Savings goals arrived later too: until the database has them, there are simply no goals.
    Promise.resolve(sb.from('savings_goals').select('*').eq('family_id', fid).order('sort')).then(r => r.error ? [] : r.data || [], () => []),
    Promise.resolve(sb.from('savings_moves').select('*').eq('family_id', fid).order('created_at', { ascending: false })).then(r => r.error ? [] : r.data || [], () => []),
  ]);
  Object.assign(S, { family: fam, members, invites, kids, jobs, weeks, credits, tx, reading, screen, sbonus, pen, goals, moves });
  await ensureWeeks();
}
/* Each Monday a kid's week starts fresh at their allowance. Rows are created lazily. */
async function ensureWeeks() {
  const cur = thisWeek(), rows = [];
  for (const k of S.kids) {
    let w = k.start_week > cur ? cur : k.start_week, guard = 0;
    while (w <= cur && guard++ < 400) {
      if (!S.weeks.some(x => x.kid_id === k.id && x.week_start === w)) rows.push({ family_id: S.family.id, kid_id: k.id, week_start: w, allowance: Number(k.weekly_allowance) });
      w = addDays(w, 7);
    }
  }
  if (rows.length) {
    await q(sb.from('weeks').upsert(rows, { onConflict: 'kid_id,week_start', ignoreDuplicates: true }));
    S.weeks = await q(sb.from('weeks').select('*').eq('family_id', S.family.id));
  }
}
async function refresh() { try { await loadAll() } catch (e) { toast(errMsg(e)) } render(); if (S.view === 'kid' && kidById(S.profile) && !$('scrim')) cheerNews(kidById(S.profile)) }
// Shows the database's own reason too, so a problem can be reported and fixed instead of guessed at.
const errMsg = e => { const m = String(e?.message || e?.error_description || e || '').trim();
  return /failed to fetch|network|load failed/i.test(m) ? 'You’re offline. Try again when you’re connected.' : `That didn’t save${m ? ` (${m.slice(0, 160)})` : ''}. Try again.` };
async function act(fn, ok) { try { await fn(); if (ok) toast(ok); await refresh() } catch (e) { console.error(e); toast(errMsg(e)) } }

/* ---------- money math ---------- */
const kidById = id => S.kids.find(k => k.id === id);
const weekRow = (kid, ws) => S.weeks.find(w => w.kid_id === kid.id && w.week_start === ws);
const isApproved = c => (c.status || 'approved') === 'approved';
const approvedCredits = kid => S.credits.filter(c => c.kid_id === kid.id && isApproved(c));
const pendingClaims = kid => S.credits.filter(c => (!kid || c.kid_id === kid.id) && c.status === 'pending');
const weekCredits = (kid, ws) => approvedCredits(kid).filter(c => c.week_start === ws);
function weekTotal(kid, ws) {
  const w = weekRow(kid, ws);
  const base = w ? Number(w.allowance) : (ws === thisWeek() ? Number(kid.weekly_allowance) : 0);
  return r2(base + weekCredits(kid, ws).reduce((a, c) => a + Number(c.amount), 0));
}
function kidWeeks(kid) { return S.weeks.filter(w => w.kid_id === kid.id).sort((a, b) => b.week_start.localeCompare(a.week_start)) }
/* Bank math. Earned = every week's allowance + jobs + bonuses. Money leaves the balance only
   when a parent pays it out, buys something for the kid with it, or (only if the family turned it on) a small jar entry. */
/* Optional jar: small, explained deductions. Off unless a parent turns it on. Entries already
   made still count if the jar is later switched off, so the bank always adds up. */
const penOn = () => !!S.family?.penalty_enabled;
const penName = () => (S.family?.penalty_name || '').trim() || 'Oops Jar';
const kidPen = kid => (S.pen || []).filter(p => p.kid_id === kid.id);
const penMoney = kid => r2(kidPen(kid).reduce((a, p) => a + Number(p.amount || 0), 0));
const penMin = (kid, ws) => kidPen(kid).filter(p => p.week_start === ws).reduce((a, p) => a + (Number(p.minutes) || 0), 0);
function stats(kid) {
  const cur = thisWeek(), month = today().slice(0, 7);
  let earned = 0, monthT = 0;
  for (const w of kidWeeks(kid)) { const t = weekTotal(kid, w.week_start); earned += t; if (w.week_start.slice(0, 7) === month) monthT += t }
  const tx = S.tx.filter(t => t.kid_id === kid.id);
  const paid = tx.filter(t => t.kind === 'payout').reduce((a, t) => a + Number(t.amount), 0);
  const spent = tx.filter(t => t.kind === 'purchase').reduce((a, t) => a + Number(t.amount), 0);
  const pen = penMoney(kid), balance = r2(earned - paid - spent - pen), saved = savedTotal(kid);
  // balance = all the kid's money; saved = what's set aside in goals; bank = what's left to spend or withdraw.
  return { week: weekTotal(kid, cur), month: r2(monthT), lifetime: r2(earned), paid: r2(paid), spent: r2(spent), pen, balance, saved, bank: r2(balance - saved) };
}
/* ---------- savings goals ----------
   Up to 10 per kid. Moving money into a goal takes it out of the bank and keeps it for that goal (it's still the kid's).
   A goal's balance is the money moved in, minus money moved out, minus purchases paid from it. */
const MAX_GOALS = 10;
const kidGoals = kid => (S.goals || []).filter(g => g.kid_id === kid.id && !g.archived).sort((a, b) => (a.sort - b.sort) || String(a.created_at).localeCompare(String(b.created_at)));
function goalBal(g) {
  let b = 0;
  for (const m of S.moves || []) { if (m.to_goal === g.id) b += Number(m.amount); if (m.from_goal === g.id) b -= Number(m.amount) }
  for (const t of S.tx) if (t.goal_id === g.id && t.kind === 'purchase') b -= Number(t.amount);
  return r2(b);
}
const savedTotal = kid => r2(kidGoals(kid).reduce((a, g) => a + goalBal(g), 0));
const goalById = id => (S.goals || []).find(g => g.id === id);
const goalLabel = g => g ? g.name : 'a goal';
const goalReady = g => Number(g.target) > 0 && goalBal(g) >= Number(g.target) - 0.004;
const savLocked = () => !!S.family?.savings_locked;
/* How long the balance has been building: last payment, and what each week since added. */
function owedInfo(kid) {
  const st = stats(kid), pays = S.tx.filter(t => t.kid_id === kid.id && t.kind === 'payout').sort((a, b) => b.local_date.localeCompare(a.local_date));
  const last = pays[0]?.local_date || null, since = last ? monday(last) : (kidWeeks(kid).slice(-1)[0]?.week_start || thisWeek());
  const weeks = kidWeeks(kid).filter(w => w.week_start >= since).map(w => ({ ws: w.week_start, amt: weekTotal(kid, w.week_start) })).filter(w => w.amt > 0);
  const days = Math.round((parseD(today()) - parseD(last || since)) / 864e5);
  return { balance: st.bank, last, days, weeks, nudge: st.bank > 0 && days >= 14 };
}
const ago = d => d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : `${Math.round(d / 7)} weeks ago`;
/* Every entry in a kid's bank, newest first, each with the balance after it. */
function statement(kid) {
  const L = [];
  for (const w of kidWeeks(kid)) L.push({ date: w.week_start, ts: ms(w.week_start + 'T00:00:00Z'), title: 'Weekly allowance', kind: 'Allowance', v: Number(w.allowance), type: 'allow', id: w.week_start, week: w.week_start });
  for (const c of approvedCredits(kid)) L.push({ date: localDate(ms(c.created_at)), ts: ms(c.created_at), title: c.title, kind: c.kind === 'job' ? 'Job' : 'Bonus', v: Number(c.amount), type: c.kind, id: c.id, week: c.week_start });
  for (const t of S.tx.filter(t => t.kid_id === kid.id)) L.push({ date: t.local_date, ts: ms(t.created_at), title: t.note, kind: t.kind === 'payout' ? 'Withdrawal' : 'Bought for ' + kid.name + (t.goal_id ? ` · from ${goalLabel(goalById(t.goal_id))}` : ''), v: -Number(t.amount), type: t.kind, id: t.id });
  for (const m of (S.moves || []).filter(m => m.kid_id === kid.id)) L.push({ date: localDate(ms(m.created_at)), ts: ms(m.created_at), title: moveTitle(m), kind: 'Savings', v: 0, mv: Number(m.amount), type: 'move', id: '' });
  for (const p of kidPen(kid).filter(p => Number(p.amount) > 0)) L.push({ date: p.local_date, ts: ms(p.created_at), title: p.note, kind: penName(), v: -Number(p.amount), type: 'penalty', id: p.id });
  L.sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
  let run = 0; for (const l of L) { run = r2(run + l.v); l.bal = run }
  return L.reverse();
}
function moveTitle(m) { const f = goalById(m.from_goal), t = goalById(m.to_goal); return !f ? `Saved for ${goalLabel(t)}` : !t ? `${goalLabel(f)} back to the bank` : `${goalLabel(f)} to ${goalLabel(t)}` }
/* New money goes to this week, or next week if this week is already paid. */
function creditWeek() { return thisWeek() }
/* ---------- reading + screen math ---------- */
/* Everything is counted in seconds, so 10:40 + 10:20 = 21:00. A timer can be paused;
   its saved seconds plus the running stretch since running_since is the live total. */
const rawSec = r => (Number(r.seconds) || 0) + (r.running_since && !r.ended_at ? Math.max(0, Math.floor((Date.now() - ms(r.running_since)) / 1000)) : 0);
// A timer never counts past its length: the clock stops at zero, even before the stop has been saved.
const liveSec = r => { const s = rawSec(r), t = sessTarget(r); return t ? Math.min(s, t) : s };
/* No per-kid session limit. A 3-hour guard only catches a timer someone forgot to stop. */
const READ_GUARD_SEC = 3 * 60 * 60;
const capSec = () => READ_GUARD_SEC;
const readSec = (r, kid) => r.source === 'manual' ? Number(r.seconds) || 0 : Math.min(liveSec(r), capSec(kid));
const activeRead = kid => S.reading.find(r => r.kid_id === kid.id && !r.ended_at && r.source !== 'manual' && r.week_start === thisWeek());
/* Reading always counts; only the screen-minute bonus stops at the weekly limit. */
const readMaxed = kid => { const cap = Number(kid.reading_cap) || 0; return cap > 0 && readWeek(kid).bonus >= cap };
const MAXED = 'You’ve earned all your bonus screen time this week. This reading is just for you!';
function readCheer(kid, before, after) { const earned = after - before, cap = Number(kid.reading_cap) || 0;
  return earned > 0 ? `+${earned} screen minute${earned > 1 ? 's' : ''} earned${after >= cap ? '. You maxed out your bonus this week!' : ''}` : cap > 0 && before >= cap ? 'Your screen bonus was already maxed, so this one was just for you. Nice reading!' : cap > 0 ? 'Every second counts toward your next minute.' : 'Nice reading!' }
function readWeek(kid, ws = thisWeek()) { const sec = S.reading.filter(r => r.kid_id === kid.id && r.week_start === ws).reduce((a, r) => a + readSec(r, kid), 0); const minutes = Math.floor(sec / 60); return { sec, minutes, bonus: Math.min(minutes, Number(kid.reading_cap) || 0) } }
function screenWeek(kid, ws = thisWeek()) {
  const base = Number(kid.base_screen_minutes) || 0, bonus = readWeek(kid, ws).bonus;
  const extra = S.sbonus.filter(a => a.kid_id === kid.id && a.week_start === ws).reduce((a, x) => a + Number(x.minutes), 0) + weekCredits(kid, ws).reduce((a, c) => a + (Number(c.minutes) || 0), 0);
  const sess = S.screen.filter(x => x.kid_id === kid.id && x.week_start === ws).sort((a, b) => ms(a.started_at) - ms(b.started_at));
  const pen = penMin(kid, ws);
  const usedSec = sess.reduce((a, x) => a + liveSec(x), 0), totalSec = Math.max(0, (base + bonus + extra - pen) * 60), leftSec = Math.max(0, totalSec - usedSec);
  const active = sess.find(x => !x.ended_at && x.source !== 'manual');
  return { base, bonus, extra, pen, sess, active, usedSec, totalSec, leftSec, left: Math.floor(leftSec / 60) };
}
const hms = sec => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${pad(m)}:${pad(x)}` };
const dur = sec => { sec = Math.max(0, Math.floor(sec)); const m = Math.floor(sec / 60), x = sec % 60; return m && x ? `${m} min ${x} sec` : m ? `${m} min` : `${x} sec` };
const isScreenDay = kid => (kid.screen_days || [6, 0]).includes(dow(today()));
const screenDayNames = kid => { const d = (kid.screen_days || [6, 0]).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); return d.map(x => DAYS[x]).join(' & ') || 'no days' };

/* ---------- icons ---------- */
const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  jobs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 4V3h6v1M8 11l2 2 4-4M8 17h8"/></svg>',
  read: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10 5 7 4.5 3 5v14c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5zM12 6.5V20"/></svg>',
  screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M8 21h8M12 17v4"/></svg>',
  kids: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.5 3.5 5.2"/></svg>',
  ledger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 6h10.5M9.5 12h10.5M9.5 18h10.5"/><circle cx="4.8" cy="6" r="1.3"/><circle cx="4.8" cy="12" r="1.3"/><circle cx="4.8" cy="18" r="1.3"/></svg>',
  pay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M2.5 10h19M6 15h4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6.5v11"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h-1A.5.5 0 0 1 4 15.5z"/><path d="M8.5 8.5h7M8.5 12h4.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4M12 3v2"/></svg>',
  dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 7.5C15.7 5.9 14.1 5 12 5c-2.8 0-4.5 1.4-4.5 3.4 0 4.6 9.2 2.6 9.2 7.2 0 2-1.9 3.4-4.7 3.4-2.3 0-4-1-4.8-2.7M12 2.5v19"/></svg>',
  jar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8M9 3v3c-2.4 1-4 3.2-4 6v6a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-6c0-2.8-1.6-5-4-6V3"/><path d="M8.5 14h7"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
  cup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3c0 1.5 1.5 1.5 1.5 3M12 3c0 1.5 1.5 1.5 1.5 3"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.5h2c.7-1.4 2.2-2.5 4.3-2.5 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>'
};
const avatar = (k, cls = '') => `<span class="avatar ${cls}" style="background:${COLORS[k.color] || COLORS.green}">${esc((k.name || '?').slice(0, 1))}</span>`;
const supportHTML = (open = false) => `<details class="support" ${open ? 'open' : ''}><summary><span class="cup" aria-hidden="true">${I.cup}</span>Love the app? Buy me a coffee.</summary>
  <div class="support-links"><a class="venmo" href="https://venmo.com/u/${encodeURIComponent(CFG.venmo)}" target="_blank" rel="noopener">Venmo <b>@${esc(CFG.venmo)}</b></a>
  <a class="cash" href="https://cash.app/$${encodeURIComponent(CFG.cashapp)}" target="_blank" rel="noopener">Cash App <b>$${esc(CFG.cashapp)}</b></a>
  ${CFG.paypal ? `<a class="paypal" href="https://www.paypal.com/paypalme/${encodeURIComponent(CFG.paypal)}" target="_blank" rel="noopener">PayPal <b>@${esc(CFG.paypal)}</b></a>` : ''}
  <span class="support-note">It&rsquo;s free! Tips keep it running.</span></div></details>`;

const brandName = () => { const w = APP.split(' '); return w.length > 1 ? `${esc(w.slice(0, -1).join(' '))} <span class="story">${esc(w[w.length - 1])}</span>` : esc(APP) };
/* ---------- playful backdrop: coins, sparkles, paper planes, little pig storybooks, clocks and TVs drifting and bobbing behind everything ---------- */
const PIGGY = 'piggy.png';
(function playroom() {
  const W2 = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
  const SH = {
    sparkle: '<path d="M16 2c1.3 7.6 3.4 9.8 11 11-7.6 1.3-9.7 3.4-11 11-1.3-7.6-3.4-9.7-11-11 7.6-1.2 9.7-3.4 11-11z" fill="currentColor"/>',
    coin: '<ellipse cx="17.5" cy="16" rx="9" ry="12" fill="currentColor" opacity=".7"/><ellipse cx="14.5" cy="16" rx="9" ry="12" fill="currentColor"/><path d="M10 20c-1-6 1-10 4-12" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>',
    plane: `<path d="M3 15 29 4l-7 23-6.5-9z" ${W2}/><path d="M15.5 18 29 4M15.5 18v8l3.5-4.5" ${W2}/>`,
    book: `<path d="M4 8c4-1.5 8-1.5 12 1 4-2.5 8-2.5 12-1v16c-4-1.5-8-1.5-12 1-4-2.5-8-2.5-12-1z" ${W2}/><path d="M16 9v16" ${W2}/>`,
    pigbook: '<path d="M3 10c4.5-1.2 9-.6 13 2.6 4-3.2 8.5-3.8 13-2.6v15.5c-4.5-1-9-.4-13 2.5-4-2.9-8.5-3.5-13-2.5z" fill="currentColor" stroke="var(--edge)" stroke-width="2" stroke-linejoin="round"/><path d="M6 11.5c3.4-.6 7 .2 10 2.6 3-2.4 6.6-3.2 10-2.6v11c-3.4-.5-7 .3-10 2.6-3-2.3-6.6-3.1-10-2.6z" fill="#fff" stroke="var(--edge)" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 14v11" stroke="var(--edge)" stroke-width="1.6"/>',
    page: `<path d="M8 4h11l6 6v18H8z" ${W2}/><path d="M19 4v6h6M12 16h9M12 21h9" ${W2}/>`,
    clock: `<circle cx="16" cy="17" r="10" ${W2}/><path d="M16 11v6l4 3M13 4h6" ${W2}/>`,
    tv: `<rect x="4" y="8" width="24" height="16" rx="3" ${W2}/><path d="M11 28h10M12 4l4 4 4-4" ${W2}/>`,
    star: `<path d="m16 4 3.5 7.3 8 1-5.9 5.5 1.5 7.9L16 21.9l-7.1 3.8 1.5-7.9-5.9-5.5 8-1z" ${W2}/>`,
    heart: '<path d="M16 27S4 19.5 4 12a6 6 0 0 1 12-1 6 6 0 0 1 12 1c0 7.5-12 15-12 15z" fill="currentColor"/>',
  };
  // [shape, tone, x%, y%, size px, motion]; tones: g gold, p pink, b blue, m muted ink
  const items = [
    ['sparkle', 'g', 6, 8, 26, 'twinkle'], ['coin', 'g', 82, 6, 24, 'flip'], ['pigbook', 'p', 72, 28, 40, 'float'], ['plane', 'b', 10, 30, 30, 'float'],
    ['sparkle', 'g', 46, 18, 14, 'twinkle'], ['page', 'b', 88, 46, 26, 'bob'], ['coin', 'g', 18, 58, 20, 'flip'], ['star', 'g', 60, 52, 20, 'spin'],
    ['pigbook', 'p', 4, 78, 34, 'bob'], ['plane', 'p', 64, 74, 30, 'float'], ['heart', 'p', 36, 88, 16, 'twinkle'], ['sparkle', 'g', 92, 86, 20, 'twinkle'],
    ['coin', 'g', 40, 40, 16, 'flip'], ['pigbook', 'p', 84, 64, 26, 'float'], ['star', 'g', 26, 14, 16, 'spin'], ['sparkle', 'g', 54, 94, 14, 'twinkle'],
  ];
  const el = document.createElement('div'); el.className = 'playroom'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = items.map(([k, tone, x, y, size, mo], i) => `<span class="pr ${tone} m-${mo}" style="left:${x}%;top:${y}%;width:${size}px;--d:${(7 + (i * 37) % 9)}s;animation-delay:-${(i * 1.7).toFixed(1)}s"><svg viewBox="0 0 32 32">${SH[k]}</svg></span>`).join('');
  document.body.prepend(el);
})();
/* ---------- the Paper Pig coin, drawn in code so it can spin, drop and roll ---------- */
const COIN_RIDGES = [-52, -34, -16, 2, 20, 38, 56].map(d => { const t = d * Math.PI / 180, y = (56 + 45 * Math.sin(t)).toFixed(1), c = Math.cos(t); return `M${(49 + 33 * c).toFixed(1)} ${y}H${(55 + 33 * c).toFixed(1)}` }).join('');
const coinSVG = (cls = '') => `<svg class="coin ${cls}" viewBox="0 0 104 112" aria-hidden="true"><defs><linearGradient id="coinface" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#FFE34D"/><stop offset="1" stop-color="#FCB80F"/></linearGradient></defs>
  <g transform="rotate(-10 52 56)" stroke="#161311" stroke-linecap="round" stroke-linejoin="round">
  <ellipse cx="59" cy="56" rx="33" ry="45" fill="#F2A400" stroke-width="7"/><path d="${COIN_RIDGES}" stroke-width="3.6" fill="none"/>
  <ellipse cx="47" cy="56" rx="33" ry="45" fill="url(#coinface)" stroke-width="7"/>
  <path d="M29 71C26 46 35 27 50 20" stroke-width="5.5" fill="none"/></g></svg>`;
/* Canvas version for confetti: same shapes, squashed sideways as it spins. */
function drawCoin(g, r, sx) {
  g.save(); g.scale(Math.max(.14, Math.abs(sx)), 1); g.lineJoin = 'round';
  g.beginPath(); g.ellipse(r * .18, 0, r * .74, r, 0, 0, 7); g.fillStyle = '#F2A400'; g.fill(); g.lineWidth = r * .16; g.strokeStyle = '#161311'; g.stroke();
  g.beginPath(); g.ellipse(0, 0, r * .74, r, 0, 0, 7); g.fillStyle = '#FFD12E'; g.fill(); g.stroke();
  g.beginPath(); g.ellipse(-r * .06, 0, r * .48, r * .7, 0, Math.PI * .95, Math.PI * 1.45); g.lineWidth = r * .12; g.lineCap = 'round'; g.stroke();
  g.restore();
}
/* A friendly icon and colour for each job category. */
const CAT = {
  'Kitchen': ['#FD8066', '<path d="M8 3v7a3 3 0 0 0 3 3v8M5 3v5M11 3v5M17 3c-2 1-3 4-3 7 0 2 1 3 3 3v8"/>'],
  'Laundry': ['#5B8DEF', '<path d="M8 4 3 7l2 4 3-1v11h8V10l3 1 2-4-5-3c-1 2-2 3-4 3S9 6 8 4z"/>'],
  'Pets': ['#C98A3A', '<circle cx="7" cy="10" r="2"/><circle cx="11" cy="6" r="2"/><circle cx="16" cy="7" r="2"/><circle cx="19" cy="11.5" r="2"/><path d="M8.5 18c0-3 2-5.5 4.5-5.5s4.5 2.5 4.5 5.5c0 2-1.5 3-4.5 3s-4.5-1-4.5-3z"/>'],
  'Outside': ['#1E8A4A', '<path d="M12 21v-5M12 3l6 8h-3l4 5H5l4-5H6z"/>'],
  'Car': ['#1597A3', '<path d="M4 16v-3l2-5h12l2 5v3zM3 16h18v3H3z"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="16.5" cy="19" r="1.5"/>'],
  'Family helper': ['#E4578F', '<path d="M12 20s-8-4.8-8-10a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5.2-8 10-8 10z"/>'],
  'Around the house': ['#6E4FD8', '<path d="M3 11 12 4l9 7M6 10v10h12V10M10 20v-5h4v5"/>'],
};
const catIco = c => { const [col, p] = CAT[c] || ['#6A5F55', '<circle cx="12" cy="12" r="7"/>']; return `<span class="cat-ico" style="--c:${col}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${p}</svg></span>` };
/* ---------- celebrations: confetti, a cheer card and a little chime for good things ---------- */
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function confetti(power = 1) {
  if (reduceMotion()) return;
  const c = document.createElement('canvas'); c.className = 'confetti'; document.body.appendChild(c);
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight; c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const cols = ['#FC3067', '#FFFFFF', '#FFC21A', '#2F6BFF', '#FC3067', '#FFC21A'];
  const N = Math.round(140 * power), P = [];
  for (let i = 0; i < N; i++) { const left = i % 2 === 0; P.push({ x: left ? -10 : W + 10, y: H * (0.55 + Math.random() * 0.3), vx: (left ? 1 : -1) * (5 + Math.random() * 9) * .5, vy: -(10 + Math.random() * 12) * .5, r: 5 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - .5) * .2, col: cols[i % cols.length], shape: i % 3 }) }
  const t0 = performance.now();
  (function frame(t) {
    const el = t - t0; g.clearRect(0, 0, W, H);
    for (const q of P) { q.vy += 0.095; q.vx *= 0.9925; q.x += q.vx; q.y += q.vy; q.rot += q.vr;
      g.save(); g.translate(q.x, q.y); g.rotate(q.rot); g.fillStyle = q.col; g.globalAlpha = Math.max(0, 1 - Math.max(0, el - 3600) / 1400);
      if (q.shape === 0) drawCoin(g, q.r * 1.7, Math.cos(q.rot * 2));
      else if (q.shape === 1) { /* a four-point sparkle */ const r = q.r * 1.2; g.beginPath(); g.moveTo(0, -r); g.quadraticCurveTo(r * .12, -r * .12, r, 0); g.quadraticCurveTo(r * .12, r * .12, 0, r); g.quadraticCurveTo(-r * .12, r * .12, -r, 0); g.quadraticCurveTo(-r * .12, -r * .12, 0, -r); g.fill() }
      else { g.beginPath(); g.arc(0, 0, q.r * .45, 0, 7); g.fill() }
      g.restore() }
    if (el < 5000) requestAnimationFrame(frame); else c.remove();
  })(t0);
}
function chime() { try { unlockAudio(); if (!audio) return; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { const o = audio.createOscillator(), v = audio.createGain(), t = audio.currentTime + i * .09; o.type = 'triangle'; o.frequency.value = f; o.connect(v); v.connect(audio.destination); v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(.12, t + .02); v.gain.exponentialRampToValueAtTime(.0001, t + .35); o.start(t); o.stop(t + .4) }) } catch (e) { } }
let cheerTimer;
function celebrate(title, sub, { power = 1, icon = 'star', sound = true } = {}) {
  confetti(power); if (sound) chime();
  document.querySelector('.cheer')?.remove(); clearTimeout(cheerTimer);
  // Stays until the kid closes it: tap the button, tap outside the card, or press Escape.
  const el = document.createElement('div'); el.className = 'cheer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', title);
  el.innerHTML = `<div class="cheer-card"><img class="cheer-pig" src="${PIGGY}" alt="" width="120" height="105"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}<button class="save cheer-ok" type="button">${esc(CHEER_OK[Math.floor(Math.random() * CHEER_OK.length)])}</button></div>`;
  const close = () => { document.removeEventListener('keydown', onKey); el.classList.add('out'); setTimeout(() => el.remove(), 300) };
  const onKey = e => { if (e.key === 'Escape') close() };
  el.onclick = e => { if (e.target === el || e.target.closest('.cheer-ok')) close() };
  document.addEventListener('keydown', onKey); document.body.appendChild(el); el.querySelector('.cheer-ok').focus({ preventScroll: true, focusVisible: false });
}
const CHEER_OK = ['Yay!', 'Awesome!', 'Got it!', 'Woo-hoo!'];
const PRAISE = ['Way to go!', 'Awesome!', 'You did it!', 'Nice work!', 'Look at you go!', 'High five!', 'Super job!'];
const praise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)];
/* When a kid opens their screen, cheer for anything good that happened since they last looked. */
function cheerNews(kid) {
  const key = 'seen-' + kid.id, raw = store.get(key), ok = approvedCredits(kid), weeks = kidWeeks(kid).map(w => w.week_start);
  const now = { c: ok.map(c => c.id), w: weeks, b: S.sbonus.filter(b => b.kid_id === kid.id).map(b => b.id) };
  store.set(key, JSON.stringify(now));
  if (!raw) return;
  let seen; try { seen = JSON.parse(raw) } catch (e) { return }
  const newC = ok.filter(c => !(seen.c || []).includes(c.id)), newW = weeks.filter(w => !(seen.w || []).includes(w)), newB = S.sbonus.filter(b => b.kid_id === kid.id && !(seen.b || []).includes(b.id));
  const amt = r2(newC.reduce((a, c) => a + Number(c.amount), 0) + newW.reduce((a, w) => a + Number(S.weeks.find(x => x.kid_id === kid.id && x.week_start === w)?.allowance || 0), 0));
  const mins = newB.reduce((a, b) => a + Number(b.minutes), 0) + newC.reduce((a, c) => a + (Number(c.minutes) || 0), 0);
  if (!amt && !mins) return;
  const what = newC.length === 1 && !newW.length ? `${newC[0].title} was approved` : newW.length && !newC.length ? 'Your weekly allowance landed' : 'New money in your bank';
  setTimeout(() => celebrate(amt ? `+${money(amt)}!` : `+${mins} screen minutes!`, amt && mins ? `${what}, plus ${mins} screen minutes` : what, { power: 1.2, icon: 'coin' }), Math.max(500, bankAnimUntil - Date.now()));
}
/* ---------- top-level render ---------- */
const app = $('app');
function render() {
  document.title = APP;
  const v = S.view;
  // Kids see the pig-pink side of the paper; everyone else sees the white side.
  document.body.dataset.side = v === 'kid' ? 'kid' : 'grown';
  // Each kid's screens are tinted with their own color, so it's obvious whose profile is open.
  const kc = v === 'kid' && COLORS[kidById(S.profile)?.color];
  if (kc) document.body.style.setProperty('--kidc', kc); else document.body.style.removeProperty('--kidc');
  if (v === 'loading') app.innerHTML = `<div class="loading"><img src="${PIGGY}" alt="" width="88" height="77"><span>Loading…</span></div>`;
  else if (v === 'auth') app.innerHTML = authHTML();
  else if (v === 'onboard') app.innerHTML = onboardHTML();
  else if (v === 'who') app.innerHTML = whoHTML();
  else if (v === 'kid') app.innerHTML = kidAppHTML();
  else if (v === 'parent') app.innerHTML = parentAppHTML();
  bindAll();
  if (v === 'kid' && S.tab === 'home') bankAnim(kidById(S.profile));
  if (v === 'auth' || v === 'who') oriMount();
  // Keep the tour in step with the screen right away, so an old tip never flashes over a new screen.
  if (!renderTour) { renderTour = true; try { tourTick() } catch (e) { } finally { renderTour = false } }
}
let renderTour = false;

/* ---------- the logo, as a book that opens ----------
   Drawn on a canvas. The book is a set of sheets hinged on the spine. Each sheet has a front
   (seen while it lies on the right) and a back (seen once it has turned onto the left):
     sheet 0  front: the closed cover        back: inside of the cover
     sheet 1  front: a blank page             back: the logo's lower left page
     sheet 2  front: a blank page             back: the logo's upper left page
     sheet 3  front: a blank page             back: the left half of the pig
   Under the turning sheets the right side is the logo's own page stack (and, once the last
   page lifts, the right half of the pig). Every turning sheet is drawn in thin vertical strips
   with real perspective and a little curl, so it reads like paper. When every sheet has
   landed, the picture is the logo itself. Plays once per visit; tap it to play again. */
const ORI_SRC = { cover: 'pp-cover.png', lcover: 'pp-lcover.png', lp1: 'pp-lp1.png', lp1t: 'pp-lp1t.png', lp1s: 'pp-lp1s.png', lp2: 'pp-lp2.png', lp2w: 'pp-lp2w.png', rpage: 'pp-rpage.png', rbook: 'pp-rbook.png', headl: 'pp-headl.png', headr: 'pp-headr.png', earl: 'pp-earl.png', earr: 'pp-earr.png' };
let ORI = null, oriLoading = null, logoPlayed = false, oriRaf = 0;
function oriLoad() {
  if (ORI) return Promise.resolve(ORI);
  return oriLoading || (oriLoading = Promise.all(Object.entries(ORI_SRC).map(([k, src]) => new Promise(res => { const im = new Image(); im.onload = () => (im.decode ? im.decode().catch(() => { }) : Promise.resolve()).then(() => res([k, im])); im.onerror = () => res([k, null]); im.src = src }))).then(list => (ORI = Object.fromEntries(list))));
}
function logoAnim() {
  const still = logoPlayed; logoPlayed = true;
  return `<h1 class="logo-h ori-logo ${still ? 'still' : ''}"><span class="sr">${esc(APP)}</span>
    <canvas class="ori-cv" width="600" height="524" aria-hidden="true"></canvas>
    <span class="ori-word" aria-hidden="true"><img class="logo-l" src="wordmark-l.png" alt=""><img class="logo-d" src="wordmark-d.png" alt=""></span></h1>`;
}
const oriEase = t => t * t * (3 - 2 * t);            // gentle in and out, so overlapping turns flow into each other
const oriBack = t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2) };
const oriClamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
/* the schedule, in seconds. Each page starts lifting before the one before it lands, so the motion never stops. */
const ORI_T = { cover: [.12, .6], s1: [.46, .96], s2: [.8, 1.3], s3: [1.14, 1.68], earl: [1.6, 1.84], earr: [1.65, 1.89], end: 1.92 };
const ORI_W = 600, ORI_H = 524;
/* Everything the frame needs, as a list of draws: flat layers, transformed quads, and the turning sheets.
   The same list is drawn by WebGL when it is available, or by the 2D canvas otherwise. */
function oriScene(t) {
  const I = ORI, W = ORI_W, H = ORI_H, X0 = W / 2, pw = W / 2, cy = H * .6, f = W * 2.6, out = [];
  const prog = ([a, b]) => oriClamp((t - a) / (b - a));
  const pc = prog(ORI_T.cover), p1 = prog(ORI_T.s1), p2 = prog(ORI_T.s2), p3 = prog(ORI_T.s3);
  const shift = -pw * .5 * (1 - oriEase(pc)), alpha = oriClamp(t / .14);
  const rect = (img, x, y0 = 0, y1 = H) => img && out.push({ img, alpha, q: [[x + shift, y0], [x + shift + img.width * (H / img.height), y0], [x + shift + img.width * (H / img.height), y1], [x + shift, y1]] });
  // [front, back while turning, back once landed, progress]; page 1 takes the logo's exact shape once page 2 covers it
  const sheets = [[I.cover, I.lcover, I.lcover, pc], [I.rpage, I.lp1t, p2 >= 1 ? I.lp1 : I.lp1s, p1], [I.rpage, I.lp2, I.lp2w, p2], [I.rpage, I.headl, I.headl, p3]];
  for (const [, , landed, p] of sheets) if (p >= 1) rect(landed, 0);
  if (pc > 0) {
    rect(I.rbook, X0);
    if (p3 > 0) { const e = Math.max(.001, oriBack(oriClamp((p3 - .06) / .55))), hy = H * .78; rect(I.headr, X0, hy - hy * e, hy + (H - hy) * e) }
  } else rect(I.cover, X0);
  for (const [front, back, , p] of sheets) if (p > 0 && p < 1) out.push({ turn: true, front, back, p: oriEase(p), alpha, shift, X0, pw, H, cy, f });
  for (const [img, span, hx, sgn] of [[I.earl, ORI_T.earl, .27, -1], [I.earr, ORI_T.earr, .73, 1]]) {
    const q = prog(span); if (!img || q <= 0) continue;
    const e = oriBack(q), hy = H * .21, x = W * hx + shift, a = sgn * (1 - e) * 2.2, k = .3 + .7 * e, c = Math.cos(a) * k, s_ = Math.sin(a) * k;
    const T = ([px, py]) => { const dx = px + shift - x, dy = py - hy; return [x + c * dx - s_ * dy, hy + s_ * dx + c * dy] };
    out.push({ img, alpha: alpha * oriClamp(q / .3), q: [T([0, 0]), T([W, 0]), T([W, H]), T([0, H])] });
  }
  return out;
}
/* The turning sheet as a strip of columns from the spine out: screen x, top, bottom, and which face shows. */
function oriSheet(o, N) {
  const { p, X0, pw, H, cy, f, shift } = o, th = p * Math.PI, curl = .55 * Math.sin(th), cols = [];
  let x = 0, z = 0;
  for (let j = 0; j <= N; j++) {
    if (j) { const u = j / N, phi = oriClamp(th - curl * u * u, 0, Math.PI); x += Math.cos(phi) * pw / N; z += Math.sin(phi) * pw / N }
    const s = f / (f - z), top = cy - cy * s - z * s * .2;
    cols.push({ x: X0 + x * s + shift, top, bot: top + H * s, u: j / N });
  }
  return cols;
}
function oriFrame(cv, t) {
  const R = oriGL(cv), scene = oriScene(t);
  if (R) return R.draw(scene);
  const g = cv.getContext('2d'); g.setTransform(cv.width / ORI_W, 0, 0, cv.height / ORI_H, 0, 0); g.clearRect(0, 0, ORI_W, ORI_H);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  for (const d of scene) {
    g.globalAlpha = d.alpha;
    if (d.turn) { oriTurn2D(g, d); continue }
    const [a, b, , e] = d.q, w = Math.hypot(b[0] - a[0], b[1] - a[1]), h = Math.hypot(e[0] - a[0], e[1] - a[1]);
    g.save(); g.transform((b[0] - a[0]) / d.img.width, (b[1] - a[1]) / d.img.width, (e[0] - a[0]) / d.img.height, (e[1] - a[1]) / d.img.height, a[0], a[1]); g.drawImage(d.img, 0, 0); g.restore();
  }
  g.globalAlpha = 1;
}
/* 2D fallback for a turning sheet: thin sheared strips (only used when WebGL is not available). */
function oriTurn2D(g, d) {
  const cols = oriSheet(d, 96), N = cols.length - 1;
  for (let j = 0; j < N; j++) {
    const A = cols[j], B = cols[j + 1], front = B.x - A.x >= 0, img = front ? d.front : d.back; if (!img) continue;
    const iw = img.width, ih = img.height, sw = iw / N, sx = front ? A.u * iw : iw - B.u * iw, dx = Math.abs(B.x - A.x) + .5;
    const L = front ? A : B, Rr = front ? B : A;
    g.save(); g.transform(dx / sw, (Rr.top - L.top) / sw, 0, (L.bot - L.top) / ih, L.x, L.top);
    g.drawImage(img, Math.max(0, sx - sw), 0, Math.min(sw * 3, iw - Math.max(0, sx - sw)), ih, -(sx - Math.max(0, sx - sw)), 0, Math.min(sw * 3, iw - Math.max(0, sx - sw)), ih); g.restore();
  }
}
/* WebGL renderer: every layer is a textured quad, and a turning sheet is one textured mesh, so a frame costs almost nothing. */
function oriGL(cv) {
  if (cv._ori !== undefined) return cv._ori;
  let gl = null;
  try { gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true }) } catch (e) { }
  if (!gl) return (cv._ori = null);
  const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;attribute vec2 uv;uniform vec2 r;varying vec2 v;void main(){v=uv;gl_Position=vec4(p.x/r.x*2.-1.,1.-p.y/r.y*2.,0.,1.);}'));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;uniform sampler2D t;uniform float a;void main(){gl_FragColor=texture2D(t,v)*a;}'));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return (cv._ori = null);
  gl.useProgram(pr);
  const buf = gl.createBuffer(), lp = gl.getAttribLocation(pr, 'p'), luv = gl.getAttribLocation(pr, 'uv'), lr = gl.getUniformLocation(pr, 'r'), la = gl.getUniformLocation(pr, 'a');
  gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(lp); gl.enableVertexAttribArray(luv);
  gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(luv, 2, gl.FLOAT, false, 16, 8);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const tex = new Map();
  const texOf = img => {
    let t = tex.get(img); if (t) return t;
    t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    tex.set(img, t); return t;
  };
  const strip = (img, verts, alpha) => { if (!img || verts.length < 16) return; gl.bindTexture(gl.TEXTURE_2D, texOf(img)); gl.uniform1f(la, alpha); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW); gl.drawArrays(gl.TRIANGLE_STRIP, 0, verts.length / 4) };
  const draw = scene => {
    gl.viewport(0, 0, cv.width, cv.height); gl.uniform2f(lr, ORI_W, ORI_H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    for (const d of scene) {
      if (!d.turn) { const [a, b, c, e] = d.q; strip(d.img, [a[0], a[1], 0, 0, b[0], b[1], 1, 0, e[0], e[1], 0, 1, c[0], c[1], 1, 1], d.alpha); continue }
      // one mesh per face: columns where the page faces you show its front, the rest its back
      const cols = oriSheet(d, 72); let run = [], face = null;
      const flush = () => { if (run.length) strip(face ? d.front : d.back, run, d.alpha) };
      for (let j = 0; j < cols.length; j++) {
        const c = cols[j], nx = cols[Math.min(j + 1, cols.length - 1)], f = j < cols.length - 1 ? nx.x - c.x >= 0 : face;
        const u = f ? c.u : 1 - c.u;
        if (face !== null && f !== face) { const uu = face ? c.u : 1 - c.u; run.push(c.x, c.top, uu, 0, c.x, c.bot, uu, 1); flush(); run = [] }
        face = f; run.push(c.x, c.top, u, 0, c.x, c.bot, u, 1);
      }
      flush();
    }
  };
  return (cv._ori = { draw });
}
function oriMount() {
  const cv = document.querySelector('.ori-cv'); if (!cv) return;
  const box = cv.closest('.ori-logo'), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  cancelAnimationFrame(oriRaf);
  oriLoad().then(() => {
    if (!cv.isConnected) return;
    if (box.classList.contains('still') || reduce) { box.classList.add('done'); oriFrame(cv, ORI_T.end); return }
    oriFrame(cv, 0);
    // start the canvas and the wordmark's CSS on the same frame, so they stay in step
    requestAnimationFrame(t0 => {
      box.classList.add('play');
      const step = now => { if (!cv.isConnected) return; const t = (now - t0) / 1000; oriFrame(cv, Math.min(t, ORI_T.end)); if (t < ORI_T.end) oriRaf = requestAnimationFrame(step); else box.classList.add('done') };
      oriRaf = requestAnimationFrame(step);
    });
  });
}
// Tap the logo to watch the book open again.
document.addEventListener('click', e => {
  const el = e.target.closest('.ori-logo'); if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.remove('still', 'play', 'done'); void el.offsetWidth; oriMount();
});
oriLoad();
/* ---------- install on the home screen (no app store) ---------- */
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e });
addEventListener('appinstalled', () => { installEvt = null; toast('Paper Pig is on your home screen'); if (S.view !== 'kid') render() });
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if ('serviceWorker' in navigator && /(^|\.)paperpig\.app$|\.netlify\.app$/.test(location.hostname)) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { }));
const installLink = () => isInstalled() ? '' : '<button class="link" type="button" data-install>Get the app</button> · ';
const SHARE_ICO = '<svg class="ishare" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5v9h14v-9h-1"/></svg>';
function installSheet() {
  // Chrome and Edge (Android, computers) can install with one tap. iPhone and iPad need Safari's Share menu.
  if (installEvt) { const e = installEvt; installEvt = null; e.prompt(); return }
  const ios = isIOS(), android = /Android/i.test(navigator.userAgent);
  const steps = ios ? [`Open <b>${esc(location.host || 'paperpig.app')}</b> in Safari.`, `Tap <b>Share</b> ${SHARE_ICO}. If you don’t see it, tap <b>•••</b> first.`, 'Scroll down, tap <b>Add to Home Screen</b>, then <b>Add</b>. If you see <b>Open as Web App</b>, leave it on.', 'Open Paper Pig from your home screen and sign in with the <b>code</b> from the email.']
    : android ? [`Open <b>${esc(location.host || 'paperpig.app')}</b> in Chrome.`, 'Tap the menu <b>⋮</b> at the top right.', 'Tap <b>Add to Home screen</b> or <b>Install app</b>, then <b>Install</b>.']
    : ['In <b>Chrome</b> or <b>Edge</b>: click the install icon at the right end of the address bar, or open the menu and choose <b>Install Paper Pig</b>.', 'In <b>Safari</b> on a Mac: choose <b>File → Add to Dock</b>.'];
  openSheet(`<h2>Put Paper Pig on your home screen</h2><p class="hint">It opens full screen with its own icon, like any other app. Free, and no app store needed.</p>
    <ol class="isteps">${steps.map(t => `<li>${t}</li>`).join('')}</ol>
    ${ios ? '<p class="hint">The home-screen app keeps its own sign-in, so you’ll sign in once more inside it. Use the code: links in emails open in Safari instead.</p>' : ''}
    <button class="save" data-close type="button">Got it</button>`);
}
/* ---------- sign in ---------- */
// An invite email links to #invite=<email>: fill in the email and say why they're here. The address stays out of the URL afterwards.
try { const m = location.hash.match(/invite=([^&]+)/); if (m) { S.authEmail = decodeURIComponent(m[1]); S.invited = true; history.replaceState(null, '', location.pathname + location.search) } } catch (e) { }
function authHTML() {
  const code = S.authStep === 'code';
  return `<section class="screen-center">
    ${logoAnim()}
    <p class="lede">${S.invited && !code ? 'You’re invited! Sign in with your email to join your family.' : 'Allowance, chores, reading and screen time, all in one place kids can see and trust.'}</p>
    <div class="card form">
      ${code ? `<div class="field"><label class="label" for="codeIn">Enter the code we sent to ${esc(S.authEmail)}</label>
        <input id="codeIn" class="code-in" inputmode="numeric" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" maxlength="12" placeholder="CODE"></div>
        <button class="save" id="codeGo" type="button">Sign in</button>
        <p class="hint">Or tap the link in the email on this device. <button class="link" id="authBack" type="button">Use a different email</button></p>`
      : `<div class="field"><label class="label" for="emailIn">Parent or guardian email</label>
        <input id="emailIn" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(S.authEmail)}"></div>
        <button class="save" id="emailGo" type="button">Email me a sign-in code</button>
        <p class="hint">No password. We email you a code each time you sign in on a new device. Kids sign in with your email too, then pick their name.</p>`}
    </div>
    <div class="foot">${supportHTML()}<span>${installLink()}<button class="link" type="button" data-fb="hi">Feedback</button> · <button class="link" type="button" data-privacy>Privacy</button></span></div></section>`;
}
async function sendCode() {
  const email = $('emailIn').value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Enter a valid email address.');
  const b = $('emailGo'); b.disabled = true; b.textContent = 'Sending…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
  if (error) { b.disabled = false; b.textContent = 'Email me a sign-in code'; console.error(error); return toast(/rate/i.test(error.message) ? 'Too many tries. Wait a minute and try again.' : 'Couldn’t send the email: ' + (error.message || 'unknown error')) }
  S.authEmail = email; S.authStep = 'code'; render(); setTimeout(() => $('codeIn')?.focus(), 50);
}
async function verifyCode() {
  const token = $('codeIn').value.replace(/[\s-]/g, ''), b = $('codeGo');
  if (token.length < 6) return toast('Enter the whole code from the email.');
  if (b.disabled) return; b.disabled = true; b.textContent = 'Checking\u2026';
  let { error } = await sb.auth.verifyOtp({ email: S.authEmail, token, type: 'email' });
  if (error && /expired|invalid/i.test(error.message)) ({ error } = await sb.auth.verifyOtp({ email: S.authEmail, token, type: 'signup' }).then(r => r.error ? { error } : r));
  if (error) { console.error(error); b.disabled = false; b.textContent = 'Sign in'; return toast(/expired|invalid/i.test(error.message) ? 'That code didn\u2019t match or has expired. Use the code in the newest email.' : 'Couldn\u2019t sign in: ' + error.message) }
}

/* ---------- onboarding: one friendly question per screen ---------- */
const OB_STAGES = 4, obStage = s => ({ family: 0, pin: 1, jobs: 3 }[s] ?? 2);
const ALLOW_PICKS = [0, 3, 5, 7, 10, 15], SCREEN_PICKS = [0, 60, 120, 180, 300];
const DAY_SETS = [['Weekends', [6, 0]], ['Fri to Sun', [5, 6, 0]], ['Every day', [1, 2, 3, 4, 5, 6, 0]]];
const sameDays = (a, b) => a.length === b.length && a.every(d => b.includes(d));
const daysLabel = d => d.length === 7 ? 'every day' : !d.length ? 'no screen days' : sameDays(d, [6, 0]) ? 'weekends' : sameDays(d, [1, 2, 3, 4, 5]) ? 'weekdays' : [1, 2, 3, 4, 5, 6, 0].filter(x => d.includes(x)).map(x => DOW[x]).join(', ');
const kidSummary = k => `${Number(k.weekly_allowance) ? money(Number(k.weekly_allowance)) + ' a week' : 'No allowance'} · ${Number(k.base_screen_minutes) ? `${mins(Number(k.base_screen_minutes))} of screens, ${daysLabel(k.screen_days || [])}` : 'No screen time'}`;
function newKidDraft() {
  const O = S.onboard, last = O.kids[O.kids.length - 1], keys = Object.keys(COLORS);
  return { key: 'k' + Math.random().toString(36).slice(2, 10), name: '', color: keys.find(c => !O.kids.some(k => k.color === c)) || keys[O.kids.length % keys.length],
    weekly_allowance: last ? last.weekly_allowance : 5, base_screen_minutes: last ? last.base_screen_minutes : 120, reading_cap: 60, screen_days: last ? [...last.screen_days] : [6, 0] };
}
function onboardHTML() {
  const O = S.onboard, st = obStage(O.step), K = O.cur, nm = esc(K?.name || 'your kid'), n = O.kids.length;
  const top = `<div class="ob-top">${O.step === 'family' ? '<span></span>' : `<button class="ob-back" id="obBack" type="button">${I.chev}Back</button>`}<div class="steps" role="img" aria-label="Step ${st + 1} of ${OB_STAGES}">${Array.from({ length: OB_STAGES }, (_, i) => `<i class="${i <= st ? 'on' : ''}"></i>`).join('')}</div></div>`;
  const ask = (h, sub, body, next = 'Next', cls = '') => `<section class="ob ${cls}">${top}<div class="ob-q"><h2>${h}</h2>${sub ? `<p class="lede">${sub}</p>` : ''}</div>${body}<button class="save" id="obNext" type="button">${next}</button></section>`;
  const chip = (attr, v, on, label) => `<button class="chip" type="button" ${attr}="${v}" aria-pressed="${on}">${label}</button>`;
  switch (O.step) {
    case 'family': return ask('Welcome! What’s your family’s name?', 'Setup takes about a minute. You can change anything later.',
      `<div class="field"><label class="label" for="famName">Family name</label><input id="famName" class="inbig" maxlength="60" placeholder="The Rivera Family" autocapitalize="words" value="${esc(O.name)}"></div>`);
    case 'pin': return ask('Now pick a parent PIN.', 'Kids use this app too. A 4-digit PIN keeps the grown-up tools to you.',
      `<div class="row2"><div class="field"><label class="label" for="pin1">PIN</label><input id="pin1" class="pin inbig" inputmode="numeric" type="password" maxlength="4" autocomplete="off" value="${esc(O.pin)}"></div>
      <div class="field"><label class="label" for="pin2">Type it again</label><input id="pin2" class="pin inbig" inputmode="numeric" type="password" maxlength="4" autocomplete="off" value="${esc(O.pin)}"></div></div>`);
    case 'kidName': return ask(n ? 'What’s your next kid’s name?' : 'Let’s add your kids. What’s the first one’s name?', 'First names only.',
      `<div class="ob-kid"><span class="avatar big" id="obPrev" style="background:${COLORS[K.color]}">${esc((K.name || '?').slice(0, 1).toUpperCase())}</span></div>
      <div class="field"><label class="label" for="obName">First name</label><input id="obName" class="inbig" maxlength="40" autocomplete="off" autocapitalize="words" value="${esc(K.name)}"></div>
      <div class="field"><span class="label">Pick a color</span>${swatchesHTML(K.color)}</div>`);
    case 'allow': return ask(`How much allowance does ${nm} get each week?`, `It goes into ${nm}’s bank every Monday. Jobs earn extra.`,
      `<div class="field"><label class="label" for="obAmt">Each week</label><div class="moneyin"><span>$</span><input id="obAmt" class="inbig" type="number" inputmode="decimal" min="0" max="1000" step="0.5" value="${esc(K.weekly_allowance)}"></div></div>
      <div class="chips">${ALLOW_PICKS.map(v => chip('data-amt', v, Number(K.weekly_allowance) === v, v ? '$' + v : 'None')).join('')}</div>`);
    case 'screen': return ask(`How much screen time does ${nm} get each week?`, `Reading earns more: every minute ${nm} reads adds a screen minute, up to 1 hr a week.`,
      `<div class="chips">${SCREEN_PICKS.map(v => chip('data-smin', v, Number(K.base_screen_minutes) === v, v ? mins(v) : 'None')).join('')}</div>
      <div class="field"><label class="label" for="obMin">Or type the minutes</label><input id="obMin" class="inbig" type="number" inputmode="numeric" min="0" max="2000" step="5" value="${esc(K.base_screen_minutes)}"></div>`);
    case 'days': return ask(`Which days are screen days for ${nm}?`, 'Screens only count on these days.',
      `<div class="chips">${DAY_SETS.map(([l, d]) => chip('data-dset', d.join(','), sameDays(K.screen_days, d), l)).join('')}</div>
      <div class="chips daychips">${[1, 2, 3, 4, 5, 6, 0].map(d => chip('data-oday', d, K.screen_days.includes(d), DOW[d])).join('')}</div>`);
    case 'more': return ask(n === 1 ? `${esc(O.kids[0].name)} is all set. Any other kids?` : `${n} kids so far. Any more?`, '',
      `<div class="list">${O.kids.map((k, i) => `<button class="row" type="button" data-obedit="${i}">${avatar(k)}<span class="t"><b>${esc(k.name)}</b><span>${esc(kidSummary(k))}</span></span><span class="link">Edit</span></button>`).join('')}</div>
      <button class="pill soft" id="obAddKid" type="button" style="justify-self:start">${I.plus}Add another kid</button>`, 'That’s everyone');
    default: return ask(n > 1 ? 'What jobs can your kids do for extra money?' : `What jobs can ${esc(O.kids[0].name)} do for extra money?`,
      n > 1 ? 'Here’s a starter list. Check who can do each one, and tap any job to change it.' : 'Here’s a starter list. Keep what fits, and tap any job to change or delete it.',
      jobsEditorHTML(jobsModel()), 'Finish setup', 'ob-long');
  }
}
/* A kid is added to the draft list once their last question is answered. If the job list already exists,
   they join the jobs every other kid shares. */
function commitKid() {
  const O = S.onboard, K = O.cur; K.name = capFirst(K.name);
  if (O.jobs && !O.jobs.some(j => j.kid_ids.includes(K.key))) for (const j of O.jobs) if (O.kids.every(k => j.kid_ids.includes(k.key))) j.kid_ids.push(K.key);
  O.kids.push(K); O.cur = null;
}
function initJobs() {
  const O = S.onboard, keys = O.kids.map(k => k.key);
  if (!O.jobs) O.jobs = CATALOG.filter(c => c.on).map(c => ({ id: 'd' + c.id, title: c.title, done_means: c.done, category: c.cat, price: c.price, bonus_minutes: 0, kid_ids: [...keys] }));
  else O.jobs.forEach(j => { j.kid_ids = j.kid_ids.filter(x => keys.includes(x)) });
}
function bindOnboard() {
  const O = S.onboard, K = O.cur, val = id => $(id)?.value ?? '';
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn }, each = (sel, fn) => app.querySelectorAll(sel).forEach(el => el.onclick = () => fn(el));
  const go = s => { O.step = s; render(); window.scrollTo(0, 0); if (['family', 'pin', 'kidName'].includes(s)) app.querySelector('input')?.focus() };
  const press = (attr, fn) => app.querySelectorAll(`[${attr}]`).forEach(b => b.setAttribute('aria-pressed', fn(b.getAttribute(attr))));
  const next = {
    family: () => { O.name = titleCase(val('famName')) || 'Our Family'; go('pin') },
    pin: () => { const a = val('pin1'), b = val('pin2'); if (!/^\d{4}$/.test(a)) return toast('Use 4 digits.'); if (a !== b) return toast('The PINs don’t match.'); O.pin = a;
      if (O.kids.length) return go('more'); O.cur = O.cur || newKidDraft(); go('kidName') },
    kidName: () => { const nm = capFirst(val('obName')); if (!nm) { toast('Type a first name.'); return $('obName').focus() } K.name = nm; go('allow') },
    allow: () => { K.weekly_allowance = Math.min(1000, Math.max(0, r2(parseFloat(val('obAmt')) || 0))); go('screen') },
    screen: () => { K.base_screen_minutes = Math.min(2000, Math.max(0, parseInt(val('obMin')) || 0)); go('days') },
    days: () => { commitKid(); go('more') },
    more: () => { initJobs(); go('jobs') },
    jobs: finishOnboard,
  };
  const back = { pin: 'family', kidName: () => O.kids.length ? (O.cur = null, 'more') : 'pin', allow: 'kidName', screen: 'allow', days: 'screen', more: () => { O.cur = O.kids.pop(); return 'days' }, jobs: 'more' };
  on('obNext', () => next[O.step]());
  on('obBack', () => { const b = back[O.step]; go(typeof b === 'function' ? b() : b) });
  app.querySelectorAll('.ob input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('obNext').click() } });
  if ($('famName')) $('famName').onblur = e => { e.target.value = titleCase(e.target.value) };
  if (O.step === 'kidName') {
    const prev = () => { const p = $('obPrev'); p.style.background = COLORS[K.color]; p.textContent = (K.name || '?').trim().slice(0, 1).toUpperCase() || '?' };
    $('obName').oninput = e => { K.name = e.target.value; prev() };
    bindSwatches(app, 'data-sw', c => { K.color = c; prev() });
  }
  each('[data-amt]', b => { K.weekly_allowance = Number(b.dataset.amt); $('obAmt').value = b.dataset.amt; press('data-amt', v => Number(v) === K.weekly_allowance) });
  if ($('obAmt')) $('obAmt').oninput = e => { K.weekly_allowance = e.target.value; press('data-amt', v => e.target.value !== '' && Number(v) === Number(e.target.value)) };
  each('[data-smin]', b => { K.base_screen_minutes = Number(b.dataset.smin); $('obMin').value = b.dataset.smin; press('data-smin', v => Number(v) === K.base_screen_minutes) });
  if ($('obMin')) $('obMin').oninput = e => { K.base_screen_minutes = e.target.value; press('data-smin', v => e.target.value !== '' && Number(v) === Number(e.target.value)) };
  const days = () => { press('data-oday', v => K.screen_days.includes(Number(v))); press('data-dset', v => sameDays(K.screen_days, v.split(',').map(Number))) };
  each('[data-dset]', b => { K.screen_days = b.dataset.dset.split(',').map(Number); days() });
  each('[data-oday]', b => { const d = Number(b.dataset.oday); K.screen_days = K.screen_days.includes(d) ? K.screen_days.filter(x => x !== d) : [...K.screen_days, d]; days() });
  each('[data-obedit]', b => onboardKidSheet(Number(b.dataset.obedit)));
  on('obAddKid', () => { O.cur = newKidDraft(); go('kidName') });
}
function onboardKidSheet(i) {
  const O = S.onboard, k = O.kids[i], K = { ...k, screen_days: [...k.screen_days] };
  openSheet(`<h2>Edit ${esc(k.name)}</h2>${kidFieldsHTML(K)}<button class="save" id="kGo" type="button">Save</button>
    <button class="cancel danger-link" id="kDel" type="button">Remove ${esc(k.name)}</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    bindKidFields(layer, K);
    $('kGo').onclick = () => { const b = kidBody(K); if (!b.name) { toast('Type a first name.'); return $('kN').focus() } Object.assign(k, b); closeSheet(); render() };
    $('kDel').onclick = () => { O.kids.splice(i, 1); (O.jobs || []).forEach(j => { j.kid_ids = j.kid_ids.filter(x => x !== k.key) }); closeSheet();
      if (!O.kids.length) { O.cur = newKidDraft(); O.step = 'kidName' } render() };
  });
}
async function finishOnboard() {
  const O = S.onboard, b = $('obNext'); b.disabled = true; b.textContent = 'Setting up…';
  try {
    initJobs();
    const fid = await q(sb.rpc('create_family', { p_name: titleCase(O.name) || 'Our Family', p_tz: O.tz }));
    S.family = { id: fid, timezone: O.tz };
    await q(sb.from('families').update({ pin_hash: await hashPin(fid, O.pin) }).eq('id', fid));
    // Remember what's been saved, so tapping Finish again after a dropped connection doesn't add anyone twice.
    O.made = O.made || {};
    for (const k of O.kids) if (!O.made[k.key]) O.made[k.key] = (await addKid(kidBody(k), { join: false })).id;
    if (!O.jobsMade && O.jobs.length) await q(sb.from('jobs').insert(O.jobs.map((j, i) => ({ family_id: fid, title: j.title, done_means: j.done_means || '', category: j.category, price: Number(j.price) || 0,
      bonus_minutes: Number(j.bonus_minutes) || 0, kid_ids: j.kid_ids.map(x => O.made[x]).filter(Boolean), enabled: true, sort: i }))));
    O.jobsMade = true;
    S.parentOk = true; try { sessionStorage.setItem('cj-parent', '1') } catch (e) { }
    await loadAll(); setProfile('parent'); S.ptab = 'kids'; render(); window.scrollTo(0, 0); tourStart();
  } catch (e) { console.error(e); b.disabled = false; b.textContent = 'Finish setup'; toast(errMsg(e)) }
}
/* A new kid gets every job the other kids all share (with no other kids, every job). */
async function addKid(body, opt = {}) {
  const kid = await q(sb.from('kids').insert({ family_id: S.family.id, start_week: thisWeek(), ...body }).select().single());
  if (opt.join !== false) {
    const others = S.kids.filter(k => k.id !== kid.id);
    await Promise.all(S.jobs.filter(j => others.every(k => jobKids(j).includes(k.id))).map(j => q(sb.from('jobs').update({ kid_ids: [...jobKids(j), kid.id], kid_id: null, enabled: true }).eq('id', j.id))));
  }
  return kid;
}
/* The same kid fields in Settings and in onboarding's edit sheet. */
function kidFieldsHTML(K) {
  return `<div class="field"><label class="label" for="kN">First name</label><input id="kN" maxlength="40" autocomplete="off" autocapitalize="words" value="${esc(K.name)}"></div>
    <div class="field"><span class="label">Color</span>${swatchesHTML(K.color, 'data-ksw')}</div>
    <div class="row2"><div class="field"><label class="label" for="kA">Weekly allowance ($)</label><input id="kA" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(K.weekly_allowance)}"></div>
    <div class="field"><label class="label" for="kS">Screen min / week</label><input id="kS" type="number" inputmode="numeric" min="0" step="5" value="${esc(K.base_screen_minutes)}"></div></div>
    <div class="field"><span class="tiplabel"><label class="label" for="kR">Reading bonus limit</label><button class="tip" type="button" aria-label="What is the reading bonus limit?" aria-expanded="false">?</button></span><span class="tipbox" hidden>The most extra screen minutes reading can earn in one week. Every minute read adds a screen minute, up to this number.</span><input id="kR" type="number" inputmode="numeric" min="0" step="5" value="${esc(K.reading_cap)}"></div>
    <div class="field"><span class="label">Screen days</span><div class="chips daychips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip" type="button" data-kd="${d}" aria-pressed="${K.screen_days.includes(d)}">${DOW[d]}</button>`).join('')}</div></div>`;
}
function bindKidFields(root, K) {
  const g = id => root.querySelector('#' + id);
  g('kN').oninput = e => { K.name = e.target.value }; g('kN').onblur = e => { e.target.value = K.name = capFirst(e.target.value) };
  g('kA').oninput = e => { K.weekly_allowance = e.target.value }; g('kS').oninput = e => { K.base_screen_minutes = e.target.value }; g('kR').oninput = e => { K.reading_cap = e.target.value };
  bindSwatches(root, 'data-ksw', c => { K.color = c });
  root.querySelectorAll('[data-kd]').forEach(b => b.onclick = () => { const d = Number(b.dataset.kd); K.screen_days = K.screen_days.includes(d) ? K.screen_days.filter(x => x !== d) : [...K.screen_days, d]; b.setAttribute('aria-pressed', K.screen_days.includes(d)) });
}
const kidBody = K => ({ name: capFirst(K.name), color: K.color, weekly_allowance: Math.min(1000, Math.max(0, r2(Number(K.weekly_allowance) || 0))),
  base_screen_minutes: Math.min(2000, Math.max(0, parseInt(K.base_screen_minutes) || 0)), reading_cap: Math.min(2000, Math.max(0, parseInt(K.reading_cap) || 0)), screen_days: K.screen_days });
async function hashPin(fid, pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fid + ':' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- who's using ---------- */
/* Money a kid hasn't seen yet (approved jobs, bonuses, new allowance weeks), without marking it seen. */
function unseenMoney(kid) {
  let seen; try { seen = JSON.parse(store.get('seen-' + kid.id) || 'null') } catch (e) { seen = null }
  if (!seen) return 0;
  const c = approvedCredits(kid).filter(c => !(seen.c || []).includes(c.id)).reduce((a, c) => a + Number(c.amount), 0);
  const w = kidWeeks(kid).filter(w => !(seen.w || []).includes(w.week_start)).reduce((a, w) => a + Number(w.allowance || 0), 0);
  return r2(c + w);
}
const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' };
/* Who's using: each kid is their own paper pig, in their color, with a reason to tap. */
function whoHTML() {
  const tiles = S.kids.map((k, i) => {
    const st = stats(k), sw = screenWeek(k), news = unseenMoney(k), pend = pendingClaims(k).length, ready = kidGoals(k).find(goalReady);
    // One extra line, only when it matters right now: a job waiting, or screens open today.
    const extra = pend ? `${I.clock}${pend} job${pend > 1 ? 's' : ''} waiting for a grown-up` : isScreenDay(k) && sw.leftSec ? `${I.screen}${mins(sw.left)} of screens left` : '';
    return `<button class="kidtile" type="button" data-who="${k.id}" style="--kc:${COLORS[k.color]};--i:${i}">
      ${news > 0 ? `<span class="news">+${money(news)} new!</span>` : ''}
      <span class="kt-face">${esc((k.name || '?').slice(0, 1).toUpperCase())}</span>
      <b class="kt-name">${esc(k.name)}</b>
      <span class="kt-info"><span class="kt-bal">${coinSVG('mini')}${money(st.bank)}</span>
        <span class="kt-sub">${ready ? `Enough for ${esc(goalLabel(ready))}!` : st.saved > 0 ? `in the bank · ${money(st.saved)} saved` : 'in the bank'}</span>
        ${extra ? `<span class="kt-line">${extra}</span>` : ''}</span></button>`;
  }).join('');
  return `<section class="screen-center whoscreen">${logoAnim()}
    <h2 class="who-q">${hello()}! Who's here?</h2>
    ${S.kids.length ? `<div class="kidtiles ${S.kids.length === 1 ? 'one' : ''}">${tiles}</div>` : '<p class="hint" style="text-align:center">No kids yet. Choose Parent/guardian to add one.</p>'}
    <button class="partile" type="button" data-who="parent"><span class="pt-lock">${I.lock}</span><span class="t"><b>Parent/guardian</b><span>Settings, approvals and the ledger. PIN needed.</span></span>${I.chev}</button>
    <div class="foot">${supportHTML()}<span>${installLink()}<button class="link" type="button" data-fb="hi">Feedback</button> · <button class="link" id="signOutWho" type="button">Switch account</button></span></div></section>`;
}
function setProfile(p) { S.profile = p; store.set('profile', p); S.view = p === 'parent' ? 'parent' : 'kid'; S.tab = 'home'; if (p !== 'parent') { const k = kidById(p); if (k) setTimeout(() => cheerNews(k), 50) } }
function chooseProfile(p) {
  if (p !== 'parent') { setProfile(p); render(); window.scrollTo(0, 0); return }
  if (S.parentOk) { setProfile('parent'); render(); return }
  pinSheet(() => { setProfile('parent'); render() });
}
function switchProfile() { S.parentOk = false; try { sessionStorage.removeItem('cj-parent') } catch (e) { } S.view = 'who'; store.set('profile', null); render(); window.scrollTo(0, 0) }

/* ---------- kid app ---------- */
const KTABS = [['home', 'Home', 'home'], ['jobs', 'Jobs', 'jobs'], ['ledger', 'Ledger', 'ledger']];
function kidAppHTML() {
  const kid = kidById(S.profile); if (!kid) { S.view = 'who'; return whoHTML() }
  if (!['home', 'jobs', 'ledger'].includes(S.tab)) S.tab = 'home';
  const greet = { home: 'Hi there!', jobs: 'Pick a job, earn money', ledger: 'Everything logged' }[S.tab];
  return `<header><div class="hello"><span class="mypig" style="--kc:${COLORS[kid.color]}" aria-hidden="true">${esc((kid.name || '?').slice(0, 1).toUpperCase())}</span><div><small>${greet}</small><h1>${esc(kid.name)}</h1></div></div>
    <div class="hbtns"><button class="lock icon" type="button" data-fb="hi" aria-label="Send feedback">${I.chat}</button><button class="lock" id="swapBtn" type="button">${I.swap} Switch</button></div></header>
    <main>${({ home: kidHome, jobs: kidJobs, ledger: kidLedger })[S.tab](kid)}</main>
    ${tabbar(KTABS, S.tab)}`;
}
function tabbar(tabs, cur, badges = {}) {
  return `<nav class="tabbar" role="tablist"><div class="in">${tabs.map(([k, l, ic]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${cur === k}"><span class="ic">${I[ic]}</span>${l}${badges[k] ? `<span class="badge">${badges[k]}</span>` : ''}</button>`).join('')}</div></nav>`;
}
function creditRow(c) { return `<div class="row"><span class="ico ${c.kind === 'job' ? 'j' : 'm'}">${c.kind === 'job' ? I.check : I.star}</span><span class="t"><b>${esc(c.title)}</b><span>${c.kind === 'job' ? 'Job' : 'Bonus'} · ${short(localDate(ms(c.created_at)))}</span></span><span class="amt up">+${money(Number(c.amount))}</span></div>` }
function stmtRow(l, kid, parent) {
  const ico = l.type === 'job' ? `<span class="ico j">${I.check}</span>` : l.type === 'bonus' ? `<span class="ico m">${I.star}</span>` : l.type === 'payout' ? `<span class="ico s">${I.cash}</span>` : l.type === 'purchase' ? `<span class="ico r">${I.bag}</span>` : l.type === 'penalty' ? `<span class="ico x">${I.jar}</span>` : l.type === 'move' ? `<span class="ico sv">${I.swap}</span>` : `<span class="ico m">${I.coin}</span>`;
  const tg = parent && l.id ? 'button' : 'div';
  return `<${tg} ${tg === 'button' ? `type="button" data-edit="${l.type}|${l.id}|${kid.id}"` : ''} class="row">${ico}<span class="t"><b>${esc(l.title)}</b><span>${esc(l.kind)} · ${short(l.date)}${l.type !== 'allow' && l.ts ? ' · ' + clockTime(l.ts) : ''}${tg === 'button' ? ' · tap to edit' : ''}</span></span><span class="stack">${l.type === 'move' ? `<span class="amt mv">${money(l.mv)}</span>` : `<span class="amt ${l.v >= 0 ? 'up' : 'out'}">${l.v >= 0 ? '+' : '\u2212'}${money(Math.abs(l.v))}</span>`}<span class="bal num">${money(l.bal)}</span></span></${tg}>`;
}
/* Kid home: status first. The bank (with a way to earn more), then the two timers, then this week's log. */
/* One bar for all savings goals together, under the bank number. Each goal counts up to its price. */
function allGoalsHTML(kid) {
  const G = kidGoals(kid).filter(g => Number(g.target) > 0), want = r2(G.reduce((a, g) => a + Number(g.target), 0));
  const have = r2(G.reduce((a, g) => a + Math.min(goalBal(g), Number(g.target)), 0)), pct = want ? Math.min(100, Math.round(100 * have / want)) : 0;
  if (!G.length) return '';
  return `<a class="allgoals" href="#savings"><span class="ag-top"><span>Saving for ${G.length} goal${G.length > 1 ? 's' : ''}</span><b class="num">${money(have)} of ${money(want)}</b></span>
    <span class="meter gmeter" data-gid="all-${kid.id}" data-pct="${pct}"><i style="width:${pct}%"></i></span>
    <span class="ag-sub">${pct >= 100 ? 'Every goal is ready!' : `${pct}% of the way`}<span class="ag-see">See goals ${I.chev}</span></span></a>`;
}
/* Big minute numbers on the reading and screen cards: "45 min", "1 hr 20 min". */
const bigMin = m => { m = Math.max(0, Math.floor(m)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} hr${r ? ` ${r} min` : ''}` : `${m} min` };
function kidHome(kid) {
  const st = stats(kid), sw = screenWeek(kid), rw = readWeek(kid), mine = pendingClaims(kid), G = kidGoals(kid);
  const ra = activeRead(kid), sa = sw.active, cap = Number(kid.reading_cap) || 0;
  const scrSub = !isScreenDay(kid) ? `Opens ${screenDayNames(kid)}` : sw.leftSec ? `of ${mins(Math.round(sw.totalSec / 60))} this week` : 'All used this week';
  const rdSub = cap ? (rw.bonus >= cap ? 'Bonus maxed! Read for fun' : `${rw.bonus} of ${cap} bonus min`) : 'this week';
  const recent = ledgerItems(kid, thisWeek()).slice(0, 4);
  return `<section class="hero bank">
      <span class="hero-coin">${coinSVG()}</span><div class="label">In your bank</div><div class="big num" id="bankBig">${money(st.bank)}</div>
      ${G.length ? allGoalsHTML(kid) : ''}
      <div class="hero-foot"><span>This week <b>+${money(st.week)}</b></span>${G.length ? '' : `<button class="link-w" type="button" data-newgoal="${kid.id}">Start saving for something</button>`}</div>
      <button class="earn" type="button" data-tab="jobs">${I.jobs}<span>Earn more with jobs</span>${I.chev}</button>
    </section>
    ${mine.length ? `<button class="waitline" type="button" data-tab="ledger">${I.clock}<span><b>${mine.length} job${mine.length > 1 ? 's' : ''}</b> waiting for a grown-up to check</span></button>` : ''}
    ${ra ? `<section class="board rdb" id="readBoard">${readBoardHTML(kid)}</section>` : ''}
    ${sa ? `<section class="board" id="board">${boardHTML(kid)}</section>` : ''}
    ${ra && sa ? '' : `<section class="starts">
      ${ra ? '' : `<button class="start rd" type="button" id="startRead"><span class="pl">${I.read}</span><span class="sbig num ${bigMin(rw.minutes).length > 7 ? 'long' : ''}">${bigMin(rw.minutes)} <small>read</small></span>${cap ? `<span class="mini-bar"><i style="width:${Math.min(100, 100 * rw.bonus / cap)}%"></i></span>` : ''}<span class="ssub">${rdSub}</span><b>Start reading ${I.chev}</b></button>`}
      ${sa ? '' : `<button class="start sc ${isScreenDay(kid) && sw.leftSec ? '' : 'off'}" type="button" id="startScr"><span class="pl">${I.screen}</span><span class="sbig num ${bigMin(sw.left).length > 7 ? 'long' : ''}">${bigMin(sw.left)} <small>left</small></span><span class="mini-bar"><i style="width:${sw.totalSec ? Math.min(100, 100 * sw.leftSec / sw.totalSec) : 0}%"></i></span><span class="ssub">${scrSub}</span><b>Start screens ${I.chev}</b></button>`}
    </section>`}
    ${savingsHTML(kid)}
    <section class="sect"><div class="sect-h"><h3>This week</h3><button class="link" type="button" data-tab="ledger">See ledger</button></div>
      <div class="list">${recent.length ? recent.map(r => ledgerRowHTML(r, false)).join('') : '<div class="empty">Nothing logged yet this week.</div>'}</div></section>
    <section class="ptools"><button class="pill soft" id="rulesBtn" type="button">How it works</button></section>`;
}
/* Kid ledger: one list of everything, week by week, newest first, each line with its day and time. */
function kidLedger(kid) {
  const ws = S.kweek || thisWeek(), f = S.kfilter || 'all', st = stats(kid);
  return `${weekNav(ws, 'kweek')}${weekSummary(kid, ws)}
    <div class="filters">${LFILTERS.map(([v, l]) => `<button class="chip" type="button" data-kf="${v}" aria-pressed="${f === v}">${l}</button>`).join('')}</div>
    ${f === 'money' ? `<section class="buckets"><button class="bucket pd ${st.paid ? '' : 'zero'}" type="button" data-txlist="payout"><span class="label">Withdrawn</span><b class="num">${money(st.paid)}</b><span class="see">See list</span></button><button class="bucket sp ${st.spent ? '' : 'zero'}" type="button" data-txlist="purchase"><span class="label">Spent on things</span><b class="num">${money(st.spent)}</b><span class="see">See list</span></button>${st.pen ? `<div class="bucket jar"><span class="label">${esc(penName())}</span><b class="num">${money(st.pen)}</b><span class="see">In the ledger</span></div>` : ''}</section>` : ''}
    ${f === 'screen' ? eqHTML(kid, screenWeek(kid, ws)) : ''}
    ${ledgerListHTML(kid, ws, f, false)}
    <div class="ptools"><button class="pill soft" type="button" data-manual="read">+ Reading by hand</button><button class="pill soft" type="button" data-manual="screen">+ Screen time by hand</button></div>`;
}
const LFILTERS = [['all', 'All'], ['money', 'Money'], ['reading', 'Reading'], ['screen', 'Screens']];
function weekNav(ws, key) {
  return `<div class="weeknav"><button class="pill soft" type="button" data-wk="${key}|${addDays(ws, -7)}" aria-label="Previous week">‹</button><b>${ws === thisWeek() ? 'This week' : 'Week of ' + md(ws)}<small>${short(ws)} – ${short(addDays(ws, 6))}</small></b><button class="pill soft" type="button" data-wk="${key}|${addDays(ws, 7)}" aria-label="Next week" ${ws >= thisWeek() ? 'disabled' : ''}>›</button></div>`;
}
/* Compact time for summaries: 44m, 1h 15m. */
const hm = sec => { const m = Math.floor((sec || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m` };
function weekSummary(kid, ws) {
  const earned = weekTotal(kid, ws), rw = readWeek(kid, ws), sw = screenWeek(kid, ws);
  return `<section class="wsum"><div><span class="wi m">${I.dollar}</span><b class="num">+${money(earned)}</b><span>Earned</span></div><div><span class="wi r">${I.read}</span><b class="num">${hm(rw.sec)}</b><span>Read</span><small>+${rw.bonus} screen min</small></div><div><span class="wi s">${I.screen}</span><b class="num">${hm(sw.usedSec)}</b><span>Screens</span><small>${hm(sw.leftSec)} left</small></div></section>`;
}
/* Every line item for one kid and one week. kind filters: all | money | reading | screen. */
function ledgerItems(kid, ws, f = 'all') {
  const R = [], money_ = f === 'all' || f === 'money', rd = f === 'all' || f === 'reading', sc = f === 'all' || f === 'screen';
  if (money_) {
    const w = weekRow(kid, ws);
    if (w && Number(w.allowance)) R.push({ date: ws, ts: ms(zonedISO(ws, '00:00')), notime: true, ico: `<span class="ico m">${I.coin}</span>`, title: 'Weekly allowance', sub: 'Allowance', amt: '+' + money(Number(w.allowance)), cls: 'up', edit: `allow|${ws}|${kid.id}` });
    for (const c of S.credits.filter(c => c.kid_id === kid.id && c.week_start === ws)) {
      const wait = !isApproved(c), m = Number(c.minutes) || 0;
      R.push({ date: localDate(ms(c.created_at)), ts: ms(c.created_at), ico: `<span class="ico ${wait ? 'w' : c.kind === 'job' ? 'j' : 'm'}">${wait ? I.clock : c.kind === 'job' ? I.check : I.star}</span>`, title: c.title,
        sub: (wait ? 'Waiting for a grown-up' : c.kind === 'job' ? 'Job' : 'Bonus') + (m ? ` · +${m} screen min` : ''), amt: '+' + money(Number(c.amount)), cls: wait ? 'wait' : 'up', edit: `${c.kind === 'job' ? 'job' : 'bonus'}|${c.id}|${kid.id}` });
    }
    for (const t of S.tx.filter(t => t.kid_id === kid.id && monday(t.local_date) === ws))
      R.push({ date: t.local_date, ts: ms(t.created_at), ico: `<span class="ico ${t.kind === 'payout' ? 's' : 'r'}">${t.kind === 'payout' ? I.cash : I.bag}</span>`, title: t.note, sub: t.kind === 'payout' ? 'Withdrawal' : 'Spent' + (t.goal_id ? ` · from ${goalLabel(goalById(t.goal_id))}` : ''), amt: '−' + money(Number(t.amount)), cls: 'out', edit: `${t.kind}|${t.id}|${kid.id}` });
    for (const m of (S.moves || []).filter(m => m.kid_id === kid.id && monday(localDate(ms(m.created_at))) === ws))
      R.push({ date: localDate(ms(m.created_at)), ts: ms(m.created_at), ico: `<span class="ico sv">${I.swap}</span>`, title: moveTitle(m), sub: 'Savings' + (m.by_role === 'parent' ? ' · by a grown-up' : ''), amt: money(Number(m.amount)), cls: 'mv', edit: '' });
    for (const p of kidPen(kid).filter(p => p.week_start === ws && Number(p.amount) > 0))
      R.push({ date: p.local_date, ts: ms(p.created_at), ico: `<span class="ico x">${I.jar}</span>`, title: p.note, sub: penName(), amt: '−' + money(Number(p.amount)), cls: 'out', edit: `penalty|${p.id}` });
  }
  if (rd) for (const r of S.reading.filter(r => r.kid_id === kid.id && r.week_start === ws))
    R.push({ date: r.local_date, ts: ms(r.started_at), when: span(r), ico: `<span class="ico r">${I.read}</span>`, title: r.book, sub: 'Reading' + (sessTarget(r) ? ` · ${minLabel(Math.round(sessTarget(r) / 60))} timer` : '') + (r.source === 'manual' ? ' · added by a grown-up' : !r.ended_at ? (r.running_since ? ' · reading now' : ' · paused') : ''), amt: dur(readSec(r, kid)), cls: 'rd', edit: `read|${r.id}` });
  if (sc) {
    for (const x of S.screen.filter(x => x.kid_id === kid.id && x.week_start === ws))
      R.push({ date: x.local_date, ts: ms(x.started_at), when: span(x), ico: `<span class="ico s">${I.screen}</span>`, title: x.note || 'Screen time', sub: 'Screens' + (sessTarget(x) ? ` · ${minLabel(Math.round(sessTarget(x) / 60))} timer` : '') + (x.source === 'manual' ? ' · added by a grown-up' : !x.ended_at ? (x.running_since ? ' · on now' : ' · paused') : ''), amt: '−' + dur(liveSec(x)), cls: 'out', edit: `screen|${x.id}` });
    for (const b of S.sbonus.filter(b => b.kid_id === kid.id && b.week_start === ws))
      R.push({ date: localDate(ms(b.created_at)), ts: ms(b.created_at), ico: `<span class="ico m">${I.star}</span>`, title: b.note, sub: 'Bonus screen minutes', amt: `+${b.minutes} min`, cls: 'up', edit: `sbonus|${b.id}` });
    for (const p of kidPen(kid).filter(p => p.week_start === ws && Number(p.minutes) > 0))
      R.push({ date: p.local_date, ts: ms(p.created_at), ico: `<span class="ico x">${I.jar}</span>`, title: p.note, sub: penName() + ' · screen minutes', amt: `−${p.minutes} min`, cls: 'out', edit: `penalty|${p.id}` });
  }
  return R.sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
}
function ledgerRowHTML(r, parent) {
  const tg = parent && r.edit ? 'button' : 'div';
  const time = r.notime ? '' : r.when || clockTime(r.ts);
  return `<${tg} ${tg === 'button' ? `type="button" data-edit="${r.edit}"` : ''} class="row">${r.ico}<span class="t"><b>${esc(r.title)}</b><span>${time ? time + ' · ' : ''}${esc(r.sub)}</span></span><span class="amt ${r.cls}">${r.amt}</span></${tg}>`;
}
function ledgerListHTML(kid, ws, f, parent) {
  const R = ledgerItems(kid, ws, f); if (!R.length) return '<div class="list"><div class="empty">Nothing logged this week.</div></div>';
  let last = '', out = '';
  for (const r of R) { if (r.date !== last) { out += `<div class="lgroup">${short(r.date)}${r.date === today() ? ' · today' : ''}</div>`; last = r.date } out += ledgerRowHTML(r, parent) }
  return `<div class="list">${out}</div>`;
}
/* Jobs belong to the family. kid_ids lists who sees each one, and every kid listed can do it and get paid.
   (Rows from before shared jobs kept one copy per kid in kid_id.) */
const jobKids = j => j.kid_id ? (j.enabled ? [j.kid_id] : []) : (j.kid_ids || []);
const jobsFor = kid => S.jobs.filter(j => jobKids(j).includes(kid.id));
function kidJobs(kid) {
  const on = jobsFor(kid), mine = pendingClaims(kid);
  const cats = ['All', ...new Set(on.map(j => j.category))]; if (!cats.includes(S.jobFilter)) S.jobFilter = 'All';
  return `${mine.length ? `<section class="sect"><div class="sect-h"><h3>Waiting for a grown-up</h3></div><div class="list">${mine.map(c => `<div class="row wait-row"><span class="ico j">${I.clock}</span><span class="t"><b>${esc(c.title)}</b><span>${short(localDate(ms(c.created_at)))}</span></span><span class="amt">+${money(Number(c.amount))}</span></div>`).join('')}</div></section>` : ''}
    ${on.length ? `<section class="sect"><div class="filters">${cats.map(c => `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === S.jobFilter}">${esc(c)}</button>`).join('')}</div>
    <div class="list">${on.filter(j => S.jobFilter === 'All' || j.category === S.jobFilter).sort((a, b) => a.price - b.price).map(j => `<button class="row jobrow" type="button" data-claim="${j.id}">${catIco(j.category)}<span class="t"><b>${esc(j.title)}</b><span>${esc(j.done_means)}</span></span><span class="stack"><span class="price num">${coinSVG('mini')}${money(Number(j.price))}</span>${Number(j.bonus_minutes) ? `<span class="bal">+${j.bonus_minutes} screen min</span>` : ''}</span></button>`).join('')}</div></section>`
      : `<div class="list"><div class="empty">No jobs on your board yet.</div></div>`}`;
}
function claimSheet(kid, job) {
  openSheet(`<span class="label">${esc(job.category)}</span><h2>${esc(job.title)}</h2>
    <div class="done-box"><span class="label">Done means</span><b>${esc(job.done_means || 'Finished all the way')}</b></div>
    <p class="hint">A grown-up will check it. Then <b>${money(Number(job.price))}</b>${Number(job.bonus_minutes) ? ` and <b>${job.bonus_minutes} screen minutes</b>` : ''} go to you.</p>
    <button class="save" id="clGo" type="button">I did it</button><button class="cancel" data-close type="button">Not yet</button>`, () => {
    $('clGo').onclick = async () => { closeSheet(); unlockAudio(); await act(() => q(sb.from('credits').insert({ family_id: S.family.id, kid_id: kid.id, week_start: thisWeek(), kind: 'job', title: job.title, amount: Number(job.price), minutes: Number(job.bonus_minutes) || 0, job_id: job.id, status: 'pending' })));
      celebrate(praise(), `${job.title} is waiting for a grown-up to check. ${money(Number(job.price))} is on the way!`, { icon: 'check' }) };
  });
}
/* The savings goals list: on the kid's home screen, and in a sheet for parents. */
function savingsHTML(kid) {
  const G = kidGoals(kid), st = stats(kid);
  const card = g => { const b = goalBal(g), t = Number(g.target) || 0, pct = t ? Math.min(100, Math.round(100 * b / t)) : 0, ready = goalReady(g);
    return `<button class="goal${ready ? ' ready' : ''}" type="button" data-goal="${g.id}"><span class="g-pct num">${t ? pct + '%' : coinSVG('mini')}</span>
      <span class="g-main"><b>${esc(g.name)}</b>${t ? `<span class="meter gmeter" data-gid="${g.id}" data-pct="${pct}"><i style="width:${pct}%"></i></span>` : ''}
      <span class="g-sub">${ready ? 'Ready to buy!' : t ? `${money(b)} of ${money(t)} · ${money(t - b)} to go` : 'Saving, no price set'}</span></span>
      <span class="g-amt num">${money(b)}<small>saved</small></span></button>` };
  return `<section class="sect savings" id="savings"><div class="sect-h"><h3>Savings goals</h3>${G.length && G.length < MAX_GOALS ? `<button class="link" type="button" data-newgoal="${kid.id}">+ New goal</button>` : ''}</div>
    ${G.length ? `<div class="list goals">${G.map(card).join('')}</div>
      <button class="pill soft movebtn" type="button" data-move="${kid.id}">${I.swap}Move money</button>`
      : `<button class="goal-empty" type="button" data-newgoal="${kid.id}"><span class="g-pct add">${I.plus}</span><span class="g-main"><b>Save up for something</b><span class="g-sub">Put money aside for a goal. It's still yours, just saved for later.</span></span>${I.chev}</button>`}
  </section>`;
}
function savingsSheet(kid) {
  openSheet(`<span class="label">${esc(kid.name)} · ${money(stats(kid).bank)} in the bank</span><h2>${esc(kid.name)}’s savings</h2>${savingsHTML(kid)}
    ${savLocked() ? '<p class="hint">Savings are locked: kids can add money and move it between goals; only you can move it back to the bank. Change this in Settings.</p>' : ''}
    <button class="cancel" data-close type="button">Close</button>`, () => bindSavings(layer));
}
function bindSavings(root) {
  root.querySelectorAll('[data-goal]').forEach(b => b.onclick = () => goalSheet(goalById(b.dataset.goal)));
  root.querySelectorAll('[data-newgoal]').forEach(b => b.onclick = () => goalEditSheet(kidById(b.dataset.newgoal)));
  root.querySelectorAll('[data-move]').forEach(b => b.onclick = () => moveSheet(kidById(b.dataset.move)));
}
function goalSheet(g) {
  if (!g) return; const kid = kidById(g.kid_id), b = goalBal(g), t = Number(g.target) || 0, pct = t ? Math.min(100, Math.round(100 * b / t)) : 0;
  const parent = S.view === 'parent', locked = savLocked() && !parent, others = kidGoals(kid).filter(x => x.id !== g.id);
  openSheet(`<span class="label">Savings goal${parent ? ` · ${esc(kid.name)}` : ''}</span><h2>${esc(g.name)}</h2>
    <div class="gs-amt"><b class="num">${money(b)}</b><span>${t ? `saved of ${money(t)}` : 'saved'}</span></div>
    ${t ? `<span class="meter gs-meter"><i style="width:${pct}%"></i></span><p class="hint">${goalReady(g) ? (parent ? 'Ready to buy! When you buy it, tap <b>Bought it</b> and the money comes out of this goal.' : '<b>Ready to buy!</b> Tell a grown-up.') : `<b>${money(t - b)}</b> to go.`}</p>` : ''}
    <div class="row2"><button class="pill" type="button" id="gIn">Add money</button><button class="pill soft" type="button" id="gOut" ${b > 0 ? '' : 'disabled'}>Move out</button></div>
    ${parent && b > 0 ? `<button class="pill ok" type="button" id="gBought">${I.bag}Bought it</button>` : ''}
    <button class="pill soft" type="button" id="gEdit" style="justify-self:start">Edit goal</button>
    <button class="cancel danger-link" type="button" id="gDel">Delete goal</button><button class="cancel" data-close type="button">Close</button>`, () => {
    $('gIn').onclick = () => moveSheet(kid, { to: g.id });
    $('gOut').onclick = () => { if (locked && !others.length) return toast('Savings are locked. A grown-up can move this back to the bank.'); moveSheet(kid, { from: g.id }) };
    if ($('gBought')) $('gBought').onclick = () => txSheet(kid, 'purchase', { goal: g.id, amount: t ? Math.min(b, t) : b, note: g.name });
    $('gEdit').onclick = () => goalEditSheet(kid, g);
    $('gDel').onclick = () => {
      if (b > 0 && locked) return toast('Savings are locked. Ask a grown-up to delete a goal that has money in it.');
      confirmSheet(`Delete ${g.name}?`, b > 0 ? `The ${money(b)} saved in it goes back to ${parent ? kid.name + '’s' : 'your'} bank.` : 'It has no money in it.', 'Delete goal', async () => {
        if (b > 0) await q(sb.from('savings_moves').insert({ family_id: S.family.id, kid_id: kid.id, from_goal: g.id, to_goal: null, amount: b, by_role: parent ? 'parent' : 'kid' }));
        await q(sb.from('savings_goals').update({ archived: true }).eq('id', g.id));
      }, 'Goal deleted');
    };
  });
}
/* Move money between the bank and goals, or from one goal to another. */
function moveSheet(kid, pre = {}) {
  const G = kidGoals(kid), parent = S.view === 'parent', locked = savLocked() && !parent;
  if (!G.length) return goalEditSheet(kid);
  const acct = [{ id: '', name: 'Bank', bal: stats(kid).bank }, ...G.map(g => ({ id: g.id, name: g.name, bal: goalBal(g) }))];
  const st = { from: pre.from ?? '', to: pre.to ?? null, amt: pre.amt ? String(pre.amt) : '' };
  // Locked savings: from a goal, a kid can only move to another goal.
  const canTo = a => a.id !== st.from && !(locked && st.from !== '' && a.id === '');
  const draw = () => {
    if (st.to === null || !canTo(acct.find(a => a.id === st.to) || { id: st.from })) st.to = acct.find(canTo)?.id ?? null;
    const src = acct.find(a => a.id === st.from) || acct[0];
    openSheet(`<h2>Move money</h2>
      <div class="field"><span class="label">From</span><div class="chips acct">${acct.map(a => `<button class="chip" type="button" data-mfrom="${a.id}" aria-pressed="${a.id === st.from}">${esc(a.name)} <small>${money(a.bal)}</small></button>`).join('')}</div></div>
      <div class="field"><span class="label">To</span><div class="chips acct">${acct.filter(a => a.id !== st.from).map(a => `<button class="chip" type="button" data-mto="${a.id}" aria-pressed="${a.id === st.to}" ${canTo(a) ? '' : 'disabled'}>${esc(a.name)}</button>`).join('')}</div>
        ${locked && st.from !== '' ? '<p class="hint">Savings are locked, so only a grown-up can move money back to the bank.</p>' : ''}</div>
      <div class="field"><label class="label" for="mvAmt">How much?</label><div class="moneyin"><span>$</span><input id="mvAmt" class="inbig" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00" value="${esc(st.amt)}"></div>
        ${src.bal > 0 ? `<div class="chips">${[1, 5, 10].filter(v => v < src.bal).map(v => `<button class="chip" type="button" data-mva="${v}">$${v}</button>`).join('')}<button class="chip" type="button" data-mva="${src.bal}">All · ${money(src.bal)}</button></div>` : `<p class="hint">${src.id ? 'This goal is empty.' : 'The bank is empty right now.'}</p>`}</div>
      <button class="save" id="mvGo" type="button" ${src.bal > 0 && st.to !== null ? '' : 'disabled'}>Move it</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
      const amt = $('mvAmt'); amt.oninput = () => { st.amt = amt.value };
      layer.querySelectorAll('[data-mfrom]').forEach(b => b.onclick = () => { st.from = b.dataset.mfrom; if (st.to === st.from) st.to = null; draw() });
      layer.querySelectorAll('[data-mto]').forEach(b => b.onclick = () => { st.to = b.dataset.mto; draw() });
      layer.querySelectorAll('[data-mva]').forEach(b => b.onclick = () => { st.amt = Number(b.dataset.mva).toFixed(2); amt.value = st.amt });
      $('mvGo').onclick = async () => {
        const a = r2(parseFloat(amt.value) || 0), from = acct.find(x => x.id === st.from), to = acct.find(x => x.id === st.to);
        if (a <= 0) return toast('Enter an amount.'); if (!to) return toast('Pick where it goes.');
        if (a > from.bal + 0.001) return toast(`${from.id ? from.name : 'The bank'} only has ${money(from.bal)}.`);
        closeSheet(); unlockAudio();
        await act(() => q(sb.from('savings_moves').insert({ family_id: S.family.id, kid_id: kid.id, from_goal: from.id || null, to_goal: to.id || null, amount: a, by_role: parent ? 'parent' : 'kid' })));
        const g = goalById(to.id);
        if (!g) return toast(`Moved ${money(a)} back to the bank`);
        const left = Number(g.target) ? r2(Number(g.target) - goalBal(g)) : 0;
        if (parent) return toast(`Moved ${money(a)} to ${goalLabel(g)}`);
        celebrate(goalReady(g) ? 'You reached your goal!' : 'Saved!', goalReady(g) ? `${goalLabel(g)} is ready. Tell a grown-up!` : `${money(a)} is saved for ${goalLabel(g)}.${left > 0 ? ` ${money(left)} to go!` : ''}`, { power: goalReady(g) ? 1.4 : .9, icon: 'coin' });
      };
    });
  };
  draw();
}
function goalEditSheet(kid, g) {
  const G = kidGoals(kid); if (!g && G.length >= MAX_GOALS) return toast(`That's the most goals (${MAX_GOALS}). Finish or delete one first.`);
  const i = g ? G.findIndex(x => x.id === g.id) : -1;
  openSheet(`<h2>${g ? 'Edit goal' : 'New savings goal'}</h2>
    <div class="field"><label class="label" for="gN">What are you saving for?</label><input id="gN" maxlength="40" autocapitalize="sentences" value="${esc(g?.name || '')}" placeholder="A new video game"></div>
    <div class="field"><label class="label" for="gT">How much does it cost?</label><div class="moneyin"><span>$</span><input id="gT" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00" value="${g?.target ? Number(g.target).toFixed(2) : ''}"></div></div>
    ${g && G.length > 1 ? `<div class="ptools"><button class="pill soft" type="button" id="gUp" ${i === 0 ? 'disabled' : ''}>Move up</button><button class="pill soft" type="button" id="gDown" ${i === G.length - 1 ? 'disabled' : ''}>Move down</button></div>` : ''}
    <button class="save" id="gSave" type="button">${g ? 'Save' : 'Start saving'}</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    const swap = d => act(async () => { const order = G.map(x => x.id), j = i + d;[order[i], order[j]] = [order[j], order[i]]; await Promise.all(order.map((id, k) => q(sb.from('savings_goals').update({ sort: k }).eq('id', id)))) }).then(() => goalEditSheet(kid, goalById(g.id)));
    if ($('gUp')) $('gUp').onclick = () => swap(-1); if ($('gDown')) $('gDown').onclick = () => swap(1);
    $('gSave').onclick = async () => {
      const name = capFirst($('gN').value), target = Math.min(100000, r2(parseFloat($('gT').value) || 0));
      if (!name) { toast('What are you saving for?'); return $('gN').focus() }
      if (target <= 0) { toast('How much does it cost? A goal needs a price.'); return $('gT').focus() }
      closeSheet();
      if (g) return act(() => q(sb.from('savings_goals').update({ name, target }).eq('id', g.id)), 'Saved');
      let row; try { row = await q(sb.from('savings_goals').insert({ family_id: S.family.id, kid_id: kid.id, name, target, sort: G.length ? Math.max(...G.map(x => x.sort || 0)) + 1 : 0 }).select().single()) } catch (e) { console.error(e); return toast(errMsg(e)) }
      await refresh();
      toast(stats(kid).bank > 0 ? `${goalLabel(row)} is set. Tap Move money to start saving.` : `${goalLabel(row)} is set. Earn some money to start saving!`);
    };
  });
}
function txListSheet(kid, kind) {
  const rows = S.tx.filter(t => t.kid_id === kid.id && t.kind === kind).sort((a, b) => b.local_date.localeCompare(a.local_date) || ms(b.created_at) - ms(a.created_at));
  const total = rows.reduce((a, t) => a + Number(t.amount), 0);
  openSheet(`<span class="label">${esc(kid.name)} · ${money(total)} total</span><h2>${kind === 'payout' ? 'Withdrawn' : 'Spent on things'}</h2>
    <div class="list">${rows.length ? rows.map(t => `<div class="row"><span class="ico ${kind === 'payout' ? 's' : 'r'}">${kind === 'payout' ? I.cash : I.bag}</span><span class="t"><b>${esc(t.note)}</b><span>${short(t.local_date)}</span></span><span class="amt">${money(Number(t.amount))}</span></div>`).join('') : `<div class="empty">${kind === 'payout' ? 'No withdrawals yet. Your money is waiting in your bank.' : 'Nothing bought yet.'}</div>`}</div>
    <button class="cancel" data-close type="button">Close</button>`);
}
function readBoardHTML(kid) {
  const a = activeRead(kid);
  if (a) { const run = !!a.running_since, sec = readSec(a, kid), tg = sessTarget(a);
    return `<div class="bline"><span class="label">${run ? (tg ? `${I.bell}Timer · ${minLabel(Math.round(tg / 60))}` : 'Reading now') : 'Paused'}</span><b>${esc(a.book)}</b></div>
    <div class="digits num ${run ? '' : 'idle'}" id="readDigits">${hms(tg ? tg - sec : sec)}</div>
    ${tg ? `<div class="bar"><i id="readBar" style="width:${Math.min(100, 100 * sec / tg)}%"></i></div>` : ''}
    <p class="note">${run ? (readMaxed(kid) ? 'Your screen bonus is maxed this week, so this one’s just for you. ' : '') + (tg ? 'It rings when the timer is done.' : 'Pause any time.') : 'Your time is saved. Tap Resume when you pick the book back up.'}</p>
    <div class="row2">${run ? '<button class="ghost" id="pauseRead" type="button">Pause</button>' : '<button class="ghost" id="resumeRead" type="button">Resume</button>'}<button class="go white" id="stopRead" type="button">I'm done</button></div>`; }
  return `<div class="bline"><span class="label">Reading timer</span>${readMaxed(kid) ? '<span><b>Bonus maxed!</b> Read for fun</span>' : '<span>1 min = <b>1 screen min</b></span>'}</div>
    <div class="digits idle num">00:00</div><button class="go white" id="startRead" type="button">Start reading</button>`;
}
let pick = null, confirming = false;
/* "2:10 PM – 2:42 PM" for a finished session, just the start while it's still going. */
const span = x => { const st = ms(x.started_at), en = x.ended_at ? ms(x.ended_at) : 0; return en && en - st >= 60000 ? `${clockTime(st)} \u2013 ${clockTime(en)}` : clockTime(st) };
/* Screen time for a kid: one big "left" number, a bar, then where the minutes came from. */
const mins = m => { m = Math.max(0, Math.round(m)); return m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min` };
function eqHTML(kid, x, extra = '') {
  const got = x.base + x.bonus + x.extra, usedPct = x.totalSec ? Math.min(100, 100 * x.usedSec / x.totalSec) : (x.usedSec ? 100 : 0);
  const line = (ico, cls, what, v) => `<div class="st-row"><span class="ico ${cls}">${ico}</span><span class="st-what">${what}</span><b class="num">${v}</b></div>`;
  return `<section class="card stime">
    <div class="st-head"><span class="ico s">${I.screen}</span><div><b class="st-left num" id="eqLeft">${hms(x.leftSec)}</b><span class="st-sub">screen time left this week</span></div></div>
    <div class="st-bar" aria-hidden="true"><i id="stBar" style="width:${usedPct}%"></i></div>
    <p class="hint">Screens are open on ${screenDayNames(kid)}.</p>
    <div class="st-list">
      ${line(I.clock, 'w', 'Every week you get', mins(x.base))}
      ${line(I.read, 'r', 'You earned by reading', '+' + mins(x.bonus))}
      ${x.extra ? line(I.star, 'm', 'Bonus minutes', '+' + mins(x.extra)) : ''}
      ${x.pen ? line(I.jar, 'x', esc(penName()), '−' + mins(x.pen)) : ''}
      <div class="st-row st-used"><span class="ico s">${I.screen}</span><span class="st-what">You've watched</span><b class="num" id="eqUsed">${mins(Math.floor(x.usedSec / 60))}</b></div>
    </div>${extra}</section>`;
}
function boardHTML(kid) {
  const x = screenWeek(kid), a = x.active;
  if (a) { const run = !!a.running_since, tg = sessTarget(a);
    if (tg) return `<div class="bline"><span class="label">${run ? `${I.bell}Timer · ${minLabel(Math.round(tg / 60))}` : 'Paused'}</span><b>${esc(a.note || 'Screens')}</b></div>
      <div class="digits num ${run ? '' : 'idle'}" id="digits">${hms(tg - liveSec(a))}</div><div class="bar"><i id="barfill" style="width:${Math.min(100, 100 * liveSec(a) / tg)}%"></i></div>
      <p class="note">${run ? 'It rings when the timer is done.' : 'Timer is paused, so screens are off. Tap Resume to keep going.'} <b id="wkLeft">${hms(x.leftSec)}</b> left this week.</p>
      <div class="row2">${run ? '<button class="ghost" id="pauseScr" type="button">Pause</button>' : '<button class="go" id="resumeScr" type="button">Resume</button>'}<button class="ghost" id="doneScr" type="button">I'm done</button></div>`;
    return `<div class="bline"><span class="label">${run ? 'Watching now' : 'Paused'}</span><b>${esc(a.note || 'Screens')}</b></div>
      <div class="digits num ${run ? '' : 'idle'}" id="digits">${hms(x.leftSec)}</div><div class="bar"><i id="barfill" style="width:${x.totalSec ? 100 * x.usedSec / x.totalSec : 100}%"></i></div>
      <p class="note">This session <b id="sessUsed">${hms(liveSec(a))}</b>. ${run ? 'That big number is what’s left this week. Pause whenever you stop. At zero, screens go off.' : 'Clock is paused, so screens are off. Tap Resume to keep going.'}</p>
      <div class="row2">${run ? '<button class="ghost" id="pauseScr" type="button">Pause</button>' : '<button class="go" id="resumeScr" type="button">Resume</button>'}<button class="ghost" id="doneScr" type="button">I'm done</button></div>`; }
  if (!isScreenDay(kid)) return `<div class="bline"><span class="label">Screen clock</span><span>Opens <b>${screenDayNames(kid)}</b></span></div>
    <div class="digits idle num">${hms(x.leftSec)}</div><p class="note">That's your time so far. Reading this week adds more.</p>`;
  if (!x.leftSec) return `<div class="bline"><span class="label">Screen clock</span></div><div class="digits idle num">00:00</div><p class="note">All of this week's time is used. New time starts Monday.</p>`;
  return `<div class="bline"><span class="label">Ready</span><span><b>${dur(x.leftSec)}</b> left this week</span></div><div class="digits num">${hms(x.leftSec)}</div>
    <p class="note">Start the clock when screens go on. Pause it when you stop.</p><button class="go" id="startBtn" type="button">Start clock</button>`;
}
/* ---------- parent app ---------- */
const PTABS = [['kids', 'Kids', 'kids'], ['jobs', 'Jobs', 'jobs'], ['pay', 'Ledger', 'ledger'], ['settings', 'Settings', 'gear']];
function parentAppHTML() {
  
  const greet = { kids: 'Parent/guardian', jobs: 'Family jobs', pay: 'Every entry, editable', settings: 'Family settings' }[S.ptab];
  return `<header><div class="hello"><div><small>${greet}</small><h1>${esc(S.family.name || APP)}</h1></div></div>
    <div class="hbtns"><button class="lock icon" type="button" data-fb="hi" aria-label="Send feedback">${I.chat}</button><button class="lock on" id="swapBtn" type="button">${I.swap} Switch</button></div></header>
    <main>${({ kids: pKids, jobs: pJobs, pay: pPay, settings: pSettings })[S.ptab]()}</main>
    ${tabbar(PTABS, S.ptab, { kids: pendingClaims().length })}`;
}
function pKids() {
  if (!S.kids.length) return `<div class="card"><p class="hint">Add your first kid to get started.</p><button class="save" id="addKidBtn" type="button">+ Add a kid</button></div><div class="foot ptail">${supportHTML()}</div>`;
  const pend = pendingClaims();
  let h = pend.length ? `<section class="sect"><div class="sect-h"><h3>Needs your OK</h3><span class="label">${pend.length}</span></div><div class="list">${pend.map(c => { const k = kidById(c.kid_id); return `<div class="row wait-row">${avatar(k)}<span class="t"><b>${esc(c.title)}</b><span>${esc(k?.name || '')} says it's done · ${short(localDate(ms(c.created_at)))}</span></span>
      <span class="decide"><button class="pill soft" type="button" data-notyet="${c.id}">Not yet</button><button class="pill ok" type="button" data-approve="${c.id}">OK +${money(Number(c.amount))}${Number(c.minutes) ? ` +${c.minutes}m` : ''}</button></span></div>` }).join('')}</div></section>` : '';
  for (const k of S.kids) { const o = owedInfo(k); if (o.nudge) h += `<div class="nudge"><span><b>${esc(k.name)} has ${money(o.balance)} banked</b> · ${o.last ? `last withdrawal ${ago(o.days)}` : `no withdrawals yet, ${o.weeks.length} week${o.weeks.length === 1 ? '' : 's'} of savings`}</span><button class="pill" type="button" data-payall="${k.id}">Withdraw ${money(o.balance)}</button></div>` }
  return h + S.kids.map(k => {
    const st = stats(k), sw = screenWeek(k), rw = readWeek(k), o = owedInfo(k), G = kidGoals(k), ready = G.filter(goalReady);
    return `<article class="kcard" style="--kc:${COLORS[k.color]}"><div class="kh">${avatar(k)}<h3>${esc(k.name)}</h3><span class="wk num" style="color:color-mix(in srgb, ${COLORS[k.color]} 78%, var(--ink))">${money(st.bank)}<small>In the bank</small></span></div>
      <div class="owedline">${o.last ? `Last withdrawal ${short(o.last)} (${ago(o.days)})` : 'No withdrawals yet'}</div>
      <button class="saveline" type="button" data-savings="${k.id}"><span>${G.length ? `<b>${money(st.saved)}</b> saved in ${G.length} goal${G.length > 1 ? 's' : ''}${ready.length ? ` · <span class="rdy">${ready.length > 1 ? `${ready.length} ready to buy` : `${esc(goalLabel(ready[0]))} is ready to buy`}</span>` : ''}` : 'No savings goals yet'}</span>${I.chev}</button>
      <div class="kstats"><div><b class="num">${money(st.week)}</b><span>This week</span></div><div><b class="num">${money(st.month)}</b><span>Month</span></div><div><b class="num">${money(st.lifetime)}</b><span>Lifetime</span></div></div>
      <div class="kstats"><div><b class="num">${hms(sw.leftSec)}</b><span>Screen left</span></div><div><b class="num" style="color:var(--read)">+${rw.bonus}</b><span>Reading bonus</span></div><div><b class="num">${hms(rw.sec)}</b><span>Read</span></div></div>
      <div class="kact"><button class="pill" type="button" data-logjob="${k.id}">Log a job</button><button class="pill ok" type="button" data-bonus="${k.id}">Add bonus</button><button class="pill soft" type="button" data-purchase="${k.id}">Bought something</button>${penOn() ? `<button class="pill soft jarpill" type="button" data-pen="${k.id}">${I.jar}${esc(penName())}</button>` : ''}<button class="pill soft" type="button" data-more="${k.id}">More</button></div></article>`;
  }).join('') + `<button class="pill soft" id="addKidBtn" type="button" style="justify-self:start">+ Add a kid</button><div class="foot ptail">${supportHTML()}</div>`;
}
function pJobs() {
  if (!S.kids.length) return `<div class="card"><p class="hint">Add a kid first.</p></div>`;
  return `<p class="hint jobs-lede">${S.kids.length > 1 ? 'Check who can do each job. Tap a job to edit it.' : `These jobs are on ${esc(S.kids[0].name)}’s board. Tap a job to edit it.`}</p>${jobsEditorHTML(jobsModel())}`;
}
/* The job list, shared by onboarding (a draft kept in S.onboard, saved when setup finishes) and the Jobs tab (saved jobs).
   Jobs are edited right in the list: tap one to open it, changes save as you go. */
function jobsModel() {
  if (S.view === 'onboard') {
    const O = S.onboard;
    return { kids: O.kids.map(k => ({ id: k.key, name: k.name, color: k.color })), jobs: O.jobs,
      add: (b, ok) => { O.jobs.push({ id: 'd' + Math.random().toString(36).slice(2, 10), ...b }); render(); if (ok) toast(ok) } };
  }
  return { kids: S.kids, jobs: S.jobs.map(j => ({ ...j, kid_ids: jobKids(j) })),
    add: (b, ok = 'Added') => act(() => q(sb.from('jobs').insert({ ...b, family_id: S.family.id, enabled: true, sort: S.jobs.length })), ok) };
}
const kidChk = (k, on, attr, label) => `<button class="kchk" type="button" ${attr} aria-pressed="${on}" aria-label="${esc(label)}" style="--kc:${COLORS[k.color] || COLORS.green}"><i>${I.check}</i>${esc(k.name)}</button>`;
function jobsEditorHTML(M) {
  const multi = M.kids.length > 1, have = new Set(M.jobs.map(j => j.title.trim().toLowerCase()));
  const allCats = [...new Set([...CATALOG.map(c => c.cat), ...M.jobs.map(j => j.category)])], cats = allCats.filter(c => M.jobs.some(j => j.category === c));
  const ideas = CATALOG.filter(c => !have.has(c.title.toLowerCase()));
  if (S.openJob && !M.jobs.some(j => j.id === S.openJob)) S.openJob = null;
  const row = j => {
    // With one kid there's nothing to choose, so no checkboxes, except on a job that isn't on their board (left over from a removed kid).
    const chk = multi || !j.kid_ids.length, kids = chk ? `<div class="jkids">${M.kids.map(k => kidChk(k, j.kid_ids.includes(k.id), `data-jkc="${j.id}|${k.id}"`, `${k.name} can do ${j.title}`)).join('')}</div>` : '';
    if (j.id !== S.openJob) return `<div class="row jrow${j.kid_ids.length ? '' : ' off'}" data-jrow="${j.id}"><button class="jhead" type="button" data-ej="${j.id}" aria-expanded="false"><span class="t"><b>${esc(j.title)}</b><span>${esc(j.done_means || 'Tap to say what done looks like')}</span></span>
      <span class="stack"><span class="price num">${money(Number(j.price))}</span>${Number(j.bonus_minutes) ? `<span class="bal">+${j.bonus_minutes} screen min</span>` : ''}</span></button>${kids}</div>`;
    return `<div class="row jrow open${j.kid_ids.length ? '' : ' off'}" data-jrow="${j.id}"><div class="jedit">
      <label><span>Job</span><input data-jf="title" maxlength="80" value="${esc(j.title)}" autocapitalize="sentences"></label>
      <label><span>Done means</span><input data-jf="done_means" maxlength="160" value="${esc(j.done_means)}" placeholder="What finished looks like"></label>
      <div class="jnums"><label><span>Pays</span><div class="moneyin sm"><span>$</span><input data-jf="price" type="number" inputmode="decimal" min="0" max="1000" step="0.25" value="${Number(j.price)}"></div></label>
      <label><span>Screen bonus</span><input data-jf="bonus_minutes" type="number" inputmode="numeric" min="0" max="240" step="5" value="${Number(j.bonus_minutes) || 0}"></label>
      <label><span>Group</span><select data-jf="category">${allCats.map(c => `<option ${c === j.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label></div></div>
      ${kids}<div class="jfoot"><button class="jdel" type="button" data-jdel="${j.id}">Delete</button><span class="jsaved" aria-live="polite"></span><button class="pill soft jdone" type="button" data-jdone="${j.id}">Done</button></div></div>`;
  };
  return `${cats.map(c => `<section class="sect"><div class="sect-h"><h3>${esc(c)}</h3></div><div class="list">${M.jobs.filter(j => j.category === c).map(row).join('')}</div></section>`).join('') || '<div class="list"><div class="empty">No jobs yet. Add your own, or pick some from the ideas below.</div></div>'}
    <button class="pill" id="newJob" type="button" style="justify-self:start">${I.plus}New job</button>
    ${ideas.length ? `<details class="ideas" ${S.ideasOpen ? 'open' : ''}><summary>More job ideas<span class="n">${ideas.length}</span></summary><div class="list">${ideas.map(c => `<button class="row" type="button" data-idea="${c.id}"><span class="ico add">${I.plus}</span><span class="t"><b>${esc(c.title)}</b><span>${esc(c.cat)}</span></span><span class="price num">${money(c.price)}</span></button>`).join('')}</div></details>` : ''}`;
}
/* Re-render while keeping a job row where it was on screen (rows above may grow or shrink). */
function keepRow(id, fn) { const a = app.querySelector(`[data-jrow="${id}"]`), top = a ? a.getBoundingClientRect().top : null; fn(); const b = app.querySelector(`[data-jrow="${id}"]`); if (b && top != null) window.scrollBy(0, b.getBoundingClientRect().top - top) }
function openJob(id) { keepRow(id, () => { S.openJob = S.openJob === id ? null : id; render() }); const r = app.querySelector(`[data-jrow="${id}"]`); if (r && S.openJob === id) { const b = r.getBoundingClientRect(); if (b.bottom > innerHeight - 90) scrollBy(0, b.bottom - innerHeight + 110) } }
/* Change a job in place: the draft during setup, or the saved job (quietly, without reloading the page). */
function patchJob(id, patch, after) {
  if (S.view === 'onboard') { Object.assign(S.onboard.jobs.find(x => x.id === id) || {}, patch); after && after(); return }
  const live = S.jobs.find(x => x.id === id); if (!live) return;
  const body = { ...patch, kid_ids: patch.kid_ids || jobKids(live), kid_id: null, enabled: true }; Object.assign(live, body);
  q(sb.from('jobs').update(body).eq('id', id)).then(() => after && after()).catch(e => { console.error(e); toast(errMsg(e)); refresh() });
}
function flashSaved(id) { const el = app.querySelector(`[data-jrow="${id}"] .jsaved`); if (!el) return; el.textContent = 'Saved'; clearTimeout(el._t); el._t = setTimeout(() => { el.textContent = '' }, 1400) }
/* quiet = saving while still typing: don't rewrite the field or complain about a half-typed value. */
function saveJobField(el, quiet) {
  const id = el.closest('[data-jrow]').dataset.jrow, j = jobsModel().jobs.find(x => x.id === id), f = el.dataset.jf; if (!j) return;
  let v = el.value;
  if (f === 'title') { v = capFirst(v); if (!v) { if (!quiet) { el.value = j.title; toast('A job needs a name.') } return } }
  else if (f === 'done_means') v = v.trim();
  else if (f === 'price') v = Math.min(1000, Math.max(0, r2(parseFloat(v) || 0)));
  else if (f === 'bonus_minutes') v = Math.min(240, Math.max(0, parseInt(v) || 0));
  if (!quiet && f !== 'category') el.value = v;
  if (String(j[f] ?? '') === String(v)) return;
  patchJob(id, { [f]: v }, () => f === 'category' ? keepRow(id, render) : flashSaved(id));
}
/* Check or uncheck a kid on a job, saved in place so a parent can tick through a list without the page jumping. */
function toggleJobKid(el) {
  const [jid, kid] = el.dataset.jkc.split('|'), j = jobsModel().jobs.find(x => x.id === jid); if (!j) return;
  const on = !j.kid_ids.includes(kid), ids = on ? [...j.kid_ids, kid] : j.kid_ids.filter(x => x !== kid);
  el.setAttribute('aria-pressed', on); el.closest('.jrow')?.classList.toggle('off', !ids.length);
  patchJob(jid, { kid_ids: ids }, () => flashSaved(jid));
}
async function newJob() {
  const M = jobsModel(), body = { title: 'New job', done_means: '', category: 'Around the house', price: 1, bonus_minutes: 0, kid_ids: M.kids.map(k => k.id) };
  if (S.view === 'onboard') { const id = 'd' + Math.random().toString(36).slice(2, 10); S.onboard.jobs.push({ id, ...body }); S.openJob = id; render() }
  else { try { const row = await q(sb.from('jobs').insert({ ...body, family_id: S.family.id, enabled: true, sort: S.jobs.length }).select().single()); S.jobs.push(row); S.openJob = row.id; render() } catch (e) { console.error(e); return toast(errMsg(e)) } }
  const r = app.querySelector(`[data-jrow="${S.openJob}"]`); if (!r) return; r.scrollIntoView({ block: 'center' }); const t = r.querySelector('[data-jf="title"]'); t.focus(); t.select();
}
/* Delete asks for a second tap instead of a pop-up. */
function deleteJob(el) {
  const id = el.dataset.jdel;
  if (!el.classList.contains('armed')) { el.classList.add('armed'); el.textContent = 'Tap again to delete'; clearTimeout(el._t); el._t = setTimeout(() => { el.classList.remove('armed'); el.textContent = 'Delete' }, 3000); return }
  S.openJob = null;
  if (S.view === 'onboard') { const O = S.onboard; O.jobs = O.jobs.filter(j => j.id !== id); render(); return toast('Deleted') }
  S.jobs = S.jobs.filter(j => j.id !== id); render();
  q(sb.from('jobs').delete().eq('id', id)).then(() => toast('Deleted. Money already earned for it stays.')).catch(e => { console.error(e); toast(errMsg(e)); refresh() });
}
/* Keep what the parent is looking at in place when a list above it grows. */
async function keepPlace(sel, fn) { const a = app.querySelector(sel), top = a ? a.getBoundingClientRect().top : null; await fn(); const b = app.querySelector(sel); if (b && top != null) window.scrollBy(0, b.getBoundingClientRect().top - top) }
function addIdea(id) {
  const c = CATALOG.find(x => x.id === id), M = jobsModel(); if (!c) return;
  keepPlace('details.ideas', () => M.add({ title: c.title, done_means: c.done, category: c.cat, price: c.price, bonus_minutes: 0, kid_ids: M.kids.map(k => k.id) }, `Added ${c.title}`));
}
/* Parent ledger: every line item for money, screen time and reading, each tappable to edit or delete. */
function timeRows(kid, view, ws) {
  const R = [];
  if (view === 'screen') {
    for (const x of S.screen.filter(x => x.kid_id === kid.id && x.week_start === ws)) R.push({ date: x.local_date, ts: ms(x.started_at), when: span(x), ico: `<span class="ico s">${I.screen}</span>`, title: x.source === 'manual' ? (x.note || 'Screen time') : 'Screen session', sub: x.source === 'manual' ? 'Added by a parent/guardian' : !x.ended_at ? (x.running_since ? 'Running now' : 'Paused') : 'Clock', v: -liveSec(x), edit: `screen|${x.id}` });
    for (const b of S.sbonus.filter(b => b.kid_id === kid.id && b.week_start === ws)) R.push({ date: localDate(ms(b.created_at)), ts: ms(b.created_at), ico: `<span class="ico m">${I.star}</span>`, title: b.note, sub: 'Bonus minutes', v: b.minutes * 60, edit: `sbonus|${b.id}` });
    for (const c of weekCredits(kid, ws).filter(c => Number(c.minutes) > 0)) R.push({ date: localDate(ms(c.created_at)), ts: ms(c.created_at), ico: `<span class="ico j">${I.check}</span>`, title: c.title, sub: 'Job bonus minutes', v: c.minutes * 60, edit: `credit|${c.id}` });
    for (const p of kidPen(kid).filter(p => p.week_start === ws && Number(p.minutes) > 0)) R.push({ date: p.local_date, ts: ms(p.created_at), ico: `<span class="ico x">${I.jar}</span>`, title: p.note, sub: penName(), v: -p.minutes * 60, edit: `penalty|${p.id}` });
    const rw = readWeek(kid, ws); if (rw.bonus) R.push({ date: addDays(ws, 6) > today() ? today() : addDays(ws, 6), ts: 0, ico: `<span class="ico r">${I.read}</span>`, title: 'Earned from reading', sub: `${dur(rw.sec)} read this week`, v: rw.bonus * 60, edit: '' });
  } else {
    for (const r of S.reading.filter(r => r.kid_id === kid.id && r.week_start === ws)) R.push({ date: r.local_date, ts: ms(r.started_at), when: span(r), ico: `<span class="ico r">${I.read}</span>`, title: r.book, sub: r.source === 'manual' ? 'Added by a parent/guardian' : !r.ended_at ? (r.running_since ? 'Reading now' : 'Paused') : 'Timer', v: readSec(r, kid), edit: `read|${r.id}` });
  }
  return R.sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
}
function timeRowHTML(r) {
  const tg = r.edit ? 'button' : 'div', pos = r.v >= 0;
  return `<${tg} ${r.edit ? `type="button" data-edit="${r.edit}"` : ''} class="row">${r.ico}<span class="t"><b>${esc(r.title)}</b><span>${short(r.date)}${r.when ? ' · ' + r.when : r.ts ? ' · ' + clockTime(r.ts) : ''} · ${esc(r.sub)}${r.edit ? ' · tap to edit' : ''}</span></span><span class="amt ${pos ? 'up' : 'out'}">${pos ? '+' : '\u2212'}${dur(Math.abs(r.v))}</span></${tg}>`;
}
function pPay() {
  if (!S.kids.length) return `<div class="card"><p class="hint">Add a kid first.</p></div>`;
  if (!kidById(S.lk)) S.lk = S.kids[0].id; const k = kidById(S.lk), view = S.lview || 'all', ws = S.lweek || thisWeek();
  let h = `${S.kids.length > 1 ? `<div class="kpick">${S.kids.map(x => `<button class="chip" type="button" data-lk="${x.id}" aria-pressed="${x.id === k.id}"><span class="dot" style="background:${COLORS[x.color]}"></span>${esc(x.name)}</button>`).join('')}</div>` : ''}
    <div class="seg">${[['all', 'All'], ['money', 'Money'], ['screen', 'Screens'], ['reading', 'Reading']].map(([v, l]) => `<button type="button" data-lview="${v}" aria-pressed="${view === v}">${l}</button>`).join('')}</div>`;
  if (view === 'all') {
    const st = stats(k);
    h += `${weekNav(ws, 'lweek')}<button class="owedline-b" type="button" data-lview="money"><span>${esc(k.name)}’s bank <b class="num">${money(st.bank)}</b>${st.saved ? ` <small class="sv">+ ${money(st.saved)} saved</small>` : ''}</span><span class="see">Withdraw or log a purchase ${I.chev}</span></button>${weekSummary(k, ws)}${ledgerListHTML(k, ws, 'all', true)}`;
  } else if (view === 'money') {
    const st = stats(k), L = statement(k), o = owedInfo(k), G = kidGoals(k);
    h += `<div class="card bankcard"><span class="label">In ${esc(k.name)}’s bank</span><b class="bankbig num">${money(st.bank)}</b>
        <p class="hint owedhint">${o.last ? `Last withdrawal <b>${short(o.last)}</b>, ${ago(o.days)}.` : 'No withdrawals yet.'}</p>
        <button class="saveline" type="button" data-savings="${k.id}"><span>${G.length ? `<b>${money(st.saved)}</b> saved in ${G.length} goal${G.length > 1 ? 's' : ''}` : 'No savings goals yet'}</span>${I.chev}</button>
        ${o.weeks.length ? `<div class="weeksince">${o.weeks.map(w => `<span><small>Week of ${md(w.ws)}</small><b class="num">${money(w.amt)}</b></span>`).join('')}</div>` : ''}
        <div class="kstats flat"><div><b class="num">${money(st.lifetime)}</b><span>Earned</span></div><div><b class="num">${money(st.paid)}</b><span>Withdrawn</span></div><div><b class="num">${money(st.spent)}</b><span>Spent</span></div>${st.pen ? `<div><b class="num" style="color:var(--danger)">${money(st.pen)}</b><span>${esc(penName())}</span></div>` : ''}</div>
        <div class="row2"><button class="pill" type="button" data-payout="${k.id}">Withdraw cash</button><button class="pill soft" type="button" data-purchase="${k.id}">Bought something</button></div>
        <div class="row2"><button class="pill soft" type="button" data-logjob="${k.id}">+ Job</button><button class="pill soft" type="button" data-bonus="${k.id}">+ Bonus</button></div>
        ${penOn() ? `<button class="pill soft jarpill" type="button" data-pen="${k.id}">${I.jar}Add to the ${esc(penName())}</button>` : ''}</div>
      <section class="sect"><div class="sect-h"><h3>Every entry</h3><span class="label">${L.length}</span></div>
      <div class="list">${L.length ? (() => { let last = '', out = ''; for (const l of L) { const w = monday(l.date); if (w !== last) { out += `<div class="lgroup">Week of ${md(w)}</div>`; last = w } out += stmtRow(l, k, true) } return out })() : '<div class="empty">No entries yet.</div>'}</div></section>`;
  } else {
    const x = screenWeek(k, ws), rw = readWeek(k, ws), R = timeRows(k, view, ws);
    h += `<div class="weeknav"><button class="pill soft" type="button" data-lweek="${addDays(ws, -7)}" aria-label="Previous week">\u2039</button><b>Week of ${md(ws)}${ws === thisWeek() ? ' · this week' : ''}</b><button class="pill soft" type="button" data-lweek="${addDays(ws, 7)}" aria-label="Next week" ${ws >= thisWeek() ? 'disabled' : ''}>\u203a</button></div>`;
    h += view === 'screen'
      ? `${eqHTML(k, x, `<div class="row2"><button class="pill soft" type="button" data-addtime="screen|${k.id}|${ws}">+ Time used</button><button class="pill soft" type="button" data-addtime="sbonus|${k.id}|${ws}">+ Bonus minutes</button></div>${penOn() && ws === thisWeek() ? `<button class="pill soft jarpill" type="button" data-pen="${k.id}|minutes">${I.jar}Add to the ${esc(penName())}</button>` : ''}`)}`
      : `<div class="card"><span class="label">Read this week</span><b class="bankbig num" style="color:var(--read)">${dur(rw.sec)}</b><p class="hint">Earned <b>+${rw.bonus}</b> screen minutes (limit ${k.reading_cap}).</p><button class="pill soft" type="button" data-addtime="read|${k.id}|${ws}" style="justify-self:start">+ Add reading</button></div>`;
    h += `<section class="sect"><div class="sect-h"><h3>${view === 'screen' ? 'Time used and added' : 'Reading sessions'}</h3><span class="label">${R.length}</span></div><div class="list">${R.length ? R.map(timeRowHTML).join('') : '<div class="empty">Nothing this week.</div>'}</div></section>`;
  }
  return h + `<p class="hint">Tap any entry to change it or delete it.</p>`;
}
/* Day picker for the 7 days of one week; days after today can't be picked. */
function dayPicker(ws, sel) {
  return `<div class="field"><span class="label">Day</span><div class="daypick">${[0, 1, 2, 3, 4, 5, 6].map(i => { const d = addDays(ws, i); return `<button class="chip" type="button" data-day="${d}" aria-pressed="${d === sel}" ${d > today() ? 'disabled' : ''}><small>${DOW[dow(d)]}</small>${parseD(d).getUTCDate()}</button>` }).join('')}</div>
    <div class="weeknav small"><button class="link" type="button" data-dweek="${addDays(ws, -7)}">\u2039 Earlier week</button>${ws < thisWeek() ? `<button class="link" type="button" data-dweek="${addDays(ws, 7)}">Later week \u203a</button>` : ''}</div></div>`;
}
/* One sheet to add or edit any line item. kind: credit, tx, allow, screen, sbonus, read */
function entrySheet(kind, kid, row, ws0) {
  const E = { ws: ws0 || thisWeek(), day: null };
  const curDay = row ? (kind === 'credit' ? localDate(ms(row.created_at)) : kind === 'sbonus' ? localDate(ms(row.created_at)) : kind === 'tx' ? row.local_date : kind === 'allow' ? row.week_start : row.local_date) : (ws0 && ws0 < thisWeek() ? addDays(ws0, 6) : today());
  E.day = curDay; E.ws = monday(curDay);
  const isTime = kind === 'screen' || kind === 'read', isMin = kind === 'sbonus';
  const live = isTime && row && !row.ended_at && row.source !== 'manual';
  const sec = isTime ? (row ? (kind === 'read' ? readSec(row, kid) : liveSec(row)) : 0) : 0;
  const titles = { credit: row?.kind === 'job' ? 'Job' : 'Bonus', tx: row?.kind === 'payout' ? 'Withdrawal' : 'Purchase', allow: 'Weekly allowance', screen: row ? 'Screen time' : 'Add screen time used', sbonus: row ? 'Bonus minutes' : 'Add bonus minutes', read: row ? 'Reading' : 'Add reading' };
  const vals = { title: row ? (row.title ?? row.note ?? row.book ?? '') : '', amount: row ? Number(row.amount ?? row.allowance ?? 0) : '', mins: isMin ? (row?.minutes ?? 10) : Math.floor(sec / 60), secs: sec % 60, jobMin: row?.minutes || 0 };
  const rowTs = row ? ms(kind === 'read' || kind === 'screen' ? row.started_at : row.created_at) : 0;
  vals.time = rowTs ? hhmm(rowTs) : hhmm();
  const draw = () => {
    openSheet(`<span class="label">${esc(kid.name)}</span><h2>${row ? 'Edit ' : ''}${titles[kind]}</h2>
      ${live ? '<p class="hint">This timer is still running. Stop it on the kid\u2019s screen first, or delete it.</p>' : ''}
      ${kind === 'allow' ? `<p class="hint">Week of ${md(row.week_start)}. Changes only this week\u2019s allowance.</p>` : ''}
      ${['credit', 'tx', 'sbonus', 'read', 'screen'].includes(kind) ? `<div class="field"><label class="label" for="eT">${kind === 'read' ? 'Book' : kind === 'screen' ? 'What was it?' : 'Explanation ' + esc(kid.name) + ' will see'}</label><input id="eT" maxlength="120" value="${esc(vals.title)}" placeholder="${kind === 'read' ? 'Book title' : kind === 'screen' ? 'What it was' : 'Explanation'}" ${live || (kind === 'screen' && row && row.source !== 'manual') ? 'disabled' : ''}></div>` : ''}
      ${['credit', 'tx', 'allow'].includes(kind) ? `<div class="field"><label class="label" for="eA">Amount ($)</label><input id="eA" type="number" inputmode="decimal" min="0.01" step="0.01" value="${vals.amount}"></div>` : ''}
      ${kind === 'credit' ? `<div class="field"><label class="label" for="eJM">Bonus screen minutes</label><input id="eJM" type="number" inputmode="numeric" min="0" max="600" value="${vals.jobMin}"></div>` : ''}
      ${isMin ? `<div class="field"><label class="label" for="eM">Minutes</label><input id="eM" type="number" inputmode="numeric" min="1" max="600" value="${vals.mins}"></div>` : ''}
      ${isTime && !live ? `<div class="row2"><div class="field"><label class="label" for="eM">Minutes</label><input id="eM" type="number" inputmode="numeric" min="0" max="600" value="${vals.mins}"></div><div class="field"><label class="label" for="eS">Seconds</label><input id="eS" type="number" inputmode="numeric" min="0" max="59" value="${vals.secs}"></div></div>` : ''}
      ${kind !== 'allow' && !live ? dayPicker(E.ws, E.day) + `<div class="field"><label class="label" for="eTm">${isTime ? 'Start time' : 'Time'}</label><input id="eTm" type="time" step="60" value="${vals.time}"></div>` : ''}
      ${live ? '' : `<button class="save" id="eGo" type="button">${row ? 'Save changes' : 'Add'}</button>`}
      ${row && kind !== 'allow' ? '<button class="cancel danger-link" id="eDel" type="button">Delete this entry</button>' : ''}
      <button class="cancel" data-close type="button">Cancel</button>`, () => {
      const keep = () => { if ($('eT')) vals.title = $('eT').value; if ($('eA')) vals.amount = $('eA').value; if ($('eM')) vals.mins = $('eM').value; if ($('eS')) vals.secs = $('eS').value; if ($('eJM')) vals.jobMin = $('eJM').value; if ($('eTm')) vals.time = $('eTm').value || vals.time };
      layer.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { E.day = b.dataset.day; layer.querySelectorAll('[data-day]').forEach(x => x.setAttribute('aria-pressed', x === b)) });
      layer.querySelectorAll('[data-dweek]').forEach(b => b.onclick = () => { keep(); E.ws = b.dataset.dweek; E.day = addDays(E.ws, 6) > today() ? today() : addDays(E.ws, 6); draw() });
      if ($('eGo')) $('eGo').onclick = async () => {
        keep(); const d = E.day, w = monday(d), title = String(vals.title).trim();
        const amt = r2(parseFloat(vals.amount) || 0), s2 = Math.max(0, parseInt(vals.mins) || 0) * 60 + Math.min(59, Math.max(0, parseInt(vals.secs) || 0));
        let tbl, body, fx = 'Saved';
        const at = kind === 'allow' ? '' : zonedISO(d, vals.time), endAt = at && new Date(ms(at) + s2 * 1000).toISOString();
        if (at && ms(at) > Date.now() + 60000) return toast('That time hasn\u2019t happened yet.');
        if (kind === 'credit') { if (!title) return toast('Add an explanation.'); if (amt <= 0) return toast('Enter an amount.'); tbl = 'credits'; body = { title, amount: amt, minutes: Math.min(600, Math.max(0, parseInt(vals.jobMin) || 0)), created_at: at, week_start: w } }
        else if (kind === 'tx') { if (!title) return toast('Add an explanation.'); if (amt <= 0) return toast('Enter an amount.'); if (amt > (row.goal_id && goalById(row.goal_id) ? goalBal(goalById(row.goal_id)) : stats(kid).bank) + Number(row.amount) + 0.001) return toast(`That's more than ${kid.name} has.`); tbl = 'transactions'; body = { note: title, amount: amt, local_date: d, created_at: at } }
        else if (kind === 'allow') { if (amt < 0) return toast('Enter an amount.'); tbl = 'weeks'; body = { allowance: amt } }
        else if (kind === 'sbonus') { const m = Math.min(600, parseInt(vals.mins) || 0); if (m < 1) return toast('Enter minutes.'); if (!title) return toast('Add an explanation.'); tbl = 'screen_bonus'; body = { minutes: m, note: title, week_start: w, created_at: at } }
        else if (kind === 'read') { if (!title) return toast('Type the book\u2019s title.'); if (!s2) return toast('Enter the time.'); tbl = 'reading_sessions'; body = { book: title, seconds: s2, local_date: d, week_start: w, started_at: at, ended_at: endAt, ...(row ? {} : { source: 'manual' }) } }
        else if (kind === 'screen') { if (!s2) return toast('Enter the time.'); if (!row && !title) return toast('Say what it was.'); tbl = 'screen_sessions'; body = { seconds: s2, local_date: d, week_start: w, started_at: at, ended_at: endAt, ...(row ? (row.source === 'manual' ? { note: title } : {}) : { note: title, source: 'manual' }) } }
        closeSheet();
        if (!row) { await act(() => q(sb.from(tbl).insert({ family_id: S.family.id, kid_id: kid.id, ...body })), 'Added'); return }
        const sel = kind === 'allow' ? sb.from('weeks').update(body).eq('kid_id', kid.id).eq('week_start', row.week_start) : sb.from(tbl).update(body).eq('id', row.id);
        await act(() => q(sel), fx);
      };
      if ($('eDel')) $('eDel').onclick = () => { const tbl = { credit: 'credits', tx: 'transactions', screen: 'screen_sessions', sbonus: 'screen_bonus', read: 'reading_sessions' }[kind]; confirmSheet('Delete this entry?', 'It\u2019s removed from the ledger and the totals update.', 'Delete', () => q(sb.from(tbl).delete().eq('id', row.id)), 'Deleted') };
    });
  };
  draw();
}
function openEdit(spec) {
  const [type, id, kidId] = spec.split('|');
  if (type === 'allow') { const k = kidById(kidId), w = S.weeks.find(x => x.kid_id === kidId && x.week_start === id); return w && entrySheet('allow', k, w) }
  if (type === 'job' || type === 'bonus' || type === 'credit') { const c = S.credits.find(x => x.id === id); return c && entrySheet('credit', kidById(c.kid_id), c) }
  if (type === 'payout' || type === 'purchase') { const t = S.tx.find(x => x.id === id); return t && entrySheet('tx', kidById(t.kid_id), t) }
  if (type === 'screen') { const x = S.screen.find(r => r.id === id); return x && entrySheet('screen', kidById(x.kid_id), x) }
  if (type === 'sbonus') { const x = S.sbonus.find(r => r.id === id); return x && entrySheet('sbonus', kidById(x.kid_id), x) }
  if (type === 'read') { const x = S.reading.find(r => r.id === id); return x && entrySheet('read', kidById(x.kid_id), x) }
  if (type === 'penalty') { const x = (S.pen || []).find(r => r.id === id); return x && penaltySheet(kidById(x.kid_id), x) }
}
function pSettings() {
  const F = S.family;
  return `<section class="sect"><div class="sect-h"><h3>Kids</h3></div><div class="list">${S.kids.map(k => `<button class="row" type="button" data-editkid="${k.id}">${avatar(k)}<span class="t"><b>${esc(k.name)}</b><span>${money(Number(k.weekly_allowance))} a week · ${k.base_screen_minutes} screen min · reading up to +${k.reading_cap}</span></span></button>`).join('')}</div>
    <button class="pill soft" id="addKidBtn" type="button" style="justify-self:start">+ Add a kid</button></section>
    ${S.kids.length ? `<section class="sect"><div class="sect-h"><h3>Screen time</h3></div>${S.kids.map(k => `<div class="card scrset">
      <div class="kidform-h">${avatar(k)}<b>${esc(k.name)}</b></div>
      <div class="row2"><div class="field"><label class="label" for="sb-${k.id}">Base minutes / week</label><input id="sb-${k.id}" type="number" inputmode="numeric" min="0" step="5" value="${k.base_screen_minutes}"></div>
      <div class="field"><span class="tiplabel"><label class="label" for="sr-${k.id}">Reading bonus limit</label><button class="tip" type="button" aria-label="What is the reading bonus limit?" aria-expanded="false">?</button></span><span class="tipbox" hidden>The most extra screen minutes reading can earn in one week. Every minute read adds a screen minute, up to this number.</span><input id="sr-${k.id}" type="number" inputmode="numeric" min="0" step="5" value="${k.reading_cap}"></div></div>
      <div class="field"><span class="label">Screen days</span><div class="chips daychips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip" type="button" data-sday="${k.id}|${d}" aria-pressed="${(k.screen_days || []).includes(d)}">${DOW[d]}</button>`).join('')}</div></div>
      <button class="pill" type="button" data-savescr="${k.id}" style="justify-self:start">Save ${esc(k.name)}'s screen time</button></div>`).join('')}</section>` : ''}
    <section class="card"><div class="togline"><span><span class="label">Savings goals</span><b>Lock savings</b></span><button class="tog" id="savLock" type="button" aria-pressed="${!!F.savings_locked}" aria-label="Lock savings"></button></div>
      <p class="hint">${F.savings_locked ? 'On: kids can put money into goals and move it between goals, but only a parent or guardian can move it back to the bank.' : 'Off: kids can move their savings back to the bank whenever they want. Turn this on if you want saved money to stay saved.'}</p></section>
    <section class="card jarset"><div class="togline"><span><span class="label">${esc(F.penalty_name || 'Oops Jar')} (optional)</span><b>Take away a little money or screen time</b></span><button class="tog" id="penTog" type="button" aria-pressed="${!!F.penalty_enabled}" aria-label="Use a jar for small take-aways"></button></div>
      <p class="hint">Off by default. When it's on, each kid card gets a jar button. Keep it small: 10¢ to 25¢, or 1 to 5 screen minutes. Every entry needs a reason and shows in the ledger.</p>
      <div id="penMore" ${F.penalty_enabled ? '' : 'hidden'}><div class="field"><label class="label" for="penNm">What your family calls it</label><input id="penNm" maxlength="30" autocapitalize="words" value="${esc(F.penalty_name || 'Oops Jar')}">
      <div class="chips">${['Oops Jar', 'Swear Jar', 'Not-Nice Bucket', 'Whoops Bucket', 'Grumble Jar'].map(n => `<button class="chip" type="button" data-pnm="${n}">${n}</button>`).join('')}</div></div></div>
      <button class="pill" id="penSave" type="button" style="justify-self:start">Save</button></section>
    <section class="card"><span class="label">Family</span>
      <div class="field"><label class="label" for="sFam">Family name</label><input id="sFam" maxlength="60" autocapitalize="words" value="${esc(F.name)}"></div>
      <div class="field"><label class="label" for="sTz">Time zone (weeks reset Monday here)</label><select id="sTz">${tzOptions(F.timezone)}</select></div>
      <button class="save" id="saveFam" type="button">Save</button>
      <button class="pill soft" id="changePin" type="button" style="justify-self:start">Change parent/guardian PIN</button>
      <button class="pill soft" id="replayTour" type="button" style="justify-self:start">Take the tour again</button></section>
    <section class="card"><span class="label">Parents and guardians</span>
      <div class="people">${S.members.map(m => `<div class="person"><span class="t"><b>${esc(m.email || 'Parent/guardian')}</b><span>${m.user_id === S.user.id ? 'You' : 'Can sign in'}</span></span>${m.user_id === S.user.id ? '' : `<button class="pill no" type="button" data-rmmember="${m.user_id}" data-email="${esc(m.email || '')}">Remove</button>`}</div>`).join('')}
      ${S.invites.map(i => `<div class="person"><span class="t"><b>${esc(i.email)}</b><span>Invited, hasn't joined yet</span></span><span class="ptools"><button class="pill soft" type="button" data-reinvite="${esc(i.email)}">Send again</button><button class="pill no" type="button" data-rminvite="${esc(i.email)}">Cancel</button></span></div>`).join('')}</div>
      <div class="field"><label class="label" for="invEmail">Add a parent or guardian</label><input id="invEmail" type="email" placeholder="Email address"></div>
      <button class="pill" id="invGo" type="button" style="justify-self:start">Send invite</button>
      <p class="hint">We email them a link. They sign in with that email and join your family. Anyone you add can add or remove others too.</p></section>
    ${pushOK() && pushKey !== '' ? `<section class="card"><div class="togline"><span><span class="label">Timer alerts</span><b>Ring on this ${({ Android: 'phone', Computer: 'computer' })[devName()] || devName()} with the app closed</b></span><button class="tog" id="pushTog" type="button" aria-pressed="${pushOn()}" aria-label="Timer alerts on this device"></button></div>
      <p class="hint">When any kid’s reading or screen timer ends, this device gets a “Time’s up!” notification with its notification sound, even if ${esc(APP)} is closed or the screen is locked. It’s on once you tap Allow (the first timer asks). Silent mode and Do Not Disturb mute it.</p></section>`
      : pushNeedsInstall() && pushKey !== '' ? `<section class="card"><span class="label">Timer alerts</span><p class="hint">To hear timers ring when ${esc(APP)} is closed or the screen is locked, add it to your home screen, open it from there, and turn on Timer alerts in Settings.</p><button class="pill" type="button" data-install style="justify-self:start">Add to home screen</button></section>` : ''}
    <section class="card"><span class="label">Contact & feedback</span><p class="hint">Found a bug, have an idea, or just want to say hi? It goes straight to the person who makes ${esc(APP)}.</p>
      <div class="ptools"><button class="pill soft" type="button" data-fb="bug">Report a bug</button><button class="pill soft" type="button" data-fb="idea">Request a feature</button><button class="pill soft" type="button" data-fb="hi">Say hi</button></div></section>
    ${isInstalled() ? '' : `<section class="card"><span class="label">Get the app</span><p class="hint">Put ${esc(APP)} on your phone’s home screen. It opens full screen like a regular app. Free, no app store.</p><button class="pill" type="button" data-install style="justify-self:start">Add to home screen</button></section>`}
    <section class="card"><span class="label">Support ${esc(APP)}</span><p class="hint">${esc(APP)} is free. If it helps your family, a coffee keeps it running.</p>${supportHTML(true)}</section>
    <section class="card"><span class="label">Account</span><p class="hint">Signed in as ${esc(S.user.email)}</p>
      <div class="ptools"><button class="pill soft" id="signOut" type="button">Sign out</button><button class="pill no" id="delAcct" type="button">Delete account and all data</button></div>
      <button class="link" type="button" data-privacy style="justify-self:start">Privacy</button></section>`;
}
function tzOptions(cur) {
  let list = []; try { list = Intl.supportedValuesOf('timeZone') } catch (e) { list = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'] }
  if (!list.includes(cur)) list.unshift(cur);
  return list.map(t => `<option ${t === cur ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

/* ---------- events ---------- */
function bindAll() {
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn };
  const each = (sel, fn) => app.querySelectorAll(sel).forEach(el => el.onclick = () => fn(el));
  // auth
  on('emailGo', sendCode); on('codeGo', verifyCode); on('authBack', () => { S.authStep = 'email'; render() });
  if ($('emailIn')) $('emailIn').onkeydown = e => { if (e.key === 'Enter') sendCode() };
  if ($('codeIn')) $('codeIn').onkeydown = e => { if (e.key === 'Enter') verifyCode() };
  app.querySelectorAll('[data-install]').forEach(b => b.onclick = installSheet);
  // onboarding
  if (S.view === 'onboard') bindOnboard();
  // job lists (onboarding and the Jobs tab)
  each('[data-ej]', el => openJob(el.dataset.ej));
  each('[data-jdone]', el => openJob(el.dataset.jdone));
  each('[data-jdel]', deleteJob);
  each('[data-jkc]', toggleJobKid);
  each('[data-idea]', el => addIdea(el.dataset.idea));
  on('newJob', newJob);
  app.querySelectorAll('[data-jf]').forEach(el => { let t;
    el.onchange = () => { clearTimeout(t); saveJobField(el) };
    if (el.tagName === 'INPUT') { el.oninput = () => { clearTimeout(t); t = setTimeout(() => saveJobField(el, true), 700) }; el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); el.blur() } } } });
  const ideas = app.querySelector('details.ideas'); if (ideas) ideas.ontoggle = () => { S.ideasOpen = ideas.open };
  // who
  each('[data-who]', el => chooseProfile(el.dataset.who));
  on('swapBtn', switchProfile);
  // tabs
  each('[data-tab]', el => { if (S.view === 'parent') S.ptab = el.dataset.tab; else S.tab = el.dataset.tab; confirming = false; S.openJob = null; render(); window.scrollTo(0, 0) });
  each('[data-cat]', el => { S.jobFilter = el.dataset.cat; render() });
  each('[data-manual]', el => manualGate(kidById(el.dataset.kid || S.profile), el.dataset.manual));
  on('rulesBtn', () => rulesSheet(kidById(S.profile)));
  // kid boards
  bindBoards();
  // parent
  each('[data-logjob]', el => logJobSheet(kidById(el.dataset.logjob)));
  each('[data-claim]', el => claimSheet(kidById(S.profile), S.jobs.find(j => j.id === el.dataset.claim)));
  each('[data-approve]', el => act(() => q(sb.from('credits').update({ status: 'approved' }).eq('id', el.dataset.approve)), 'Approved'));
  each('[data-notyet]', el => act(() => q(sb.from('credits').delete().eq('id', el.dataset.notyet)), 'Sent back to the board'));
  each('[data-payall]', el => { const k = kidById(el.dataset.payall); txSheet(k, 'payout', { amount: stats(k).bank, note: 'Cash withdrawal' }) });
  each('[data-txlist]', el => txListSheet(kidById(S.profile), el.dataset.txlist));
  bindSavings(app);
  each('[data-bonus]', el => bonusSheet(kidById(el.dataset.bonus)));
  each('[data-more]', el => kidMoreSheet(kidById(el.dataset.more)));
  each('[data-pen]', el => { const [id, m] = el.dataset.pen.split('|'); const k = kidById(id); penaltySheet(k); if (m === 'minutes') layer.querySelector('[data-pm="minutes"]')?.click() });
  on('replayTour', () => { S.ptab = 'kids'; render(); window.scrollTo(0, 0); tourStart() });
  on('savLock', () => { const v = $('savLock').getAttribute('aria-pressed') !== 'true'; $('savLock').setAttribute('aria-pressed', v);
    act(() => q(sb.from('families').update({ savings_locked: v }).eq('id', S.family.id)), v ? 'Savings locked' : 'Savings unlocked') });
  on('pushTog', () => { const b = $('pushTog');
    if (pushOn()) { b.setAttribute('aria-pressed', false); pushDisable().then(() => toast('Timer alerts are off on this device.')) }
    else pushEnable().then(ok => { b.setAttribute('aria-pressed', ok); if (ok) toast('Timer alerts are on. This device rings when a timer ends.') }) });
  on('penTog', () => { const b = $('penTog'), v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', v); $('penMore').hidden = !v });
  each('[data-pnm]', el => { $('penNm').value = el.dataset.pnm });
  on('penSave', () => { const v = $('penTog').getAttribute('aria-pressed') === 'true', nm = titleCase($('penNm').value.trim()) || 'Oops Jar';
    act(() => q(sb.from('families').update({ penalty_enabled: v, penalty_name: nm }).eq('id', S.family.id)), v ? `${nm} is on` : `${nm} is off`) });
  on('addKidBtn', () => kidSheet());
  each('[data-editkid]', el => kidSheet(kidById(el.dataset.editkid)));
  each('[data-payout]', el => txSheet(kidById(el.dataset.payout), 'payout'));
  each('[data-purchase]', el => txSheet(kidById(el.dataset.purchase), 'purchase'));
  each('[data-savings]', el => savingsSheet(kidById(el.dataset.savings)));
  each('[data-allstmt]', el => statementSheet(kidById(el.dataset.allstmt)));
  bindUndo(app);
  each('[data-lk]', el => { S.lk = el.dataset.lk; render() });
  each('[data-lview]', el => { S.lview = el.dataset.lview; render() });
  each('[data-lweek]', el => { S.lweek = el.dataset.lweek; render() });
  each('[data-wk]', el => { const [k, v] = el.dataset.wk.split('|'); S[k] = v; render() });
  each('[data-kf]', el => { S.kfilter = el.dataset.kf; render() });
  each('[data-addtime]', el => { const [kind, kid, ws] = el.dataset.addtime.split('|'); entrySheet(kind, kidById(kid), null, ws) });
  on('saveFam', () => act(() => q(sb.from('families').update({ name: titleCase($('sFam').value) || 'Our Family', timezone: $('sTz').value }).eq('id', S.family.id)), 'Saved'));
  on('changePin', () => newPinSheet());
  each('[data-rmmember]', el => confirmSheet(`Remove ${el.dataset.email || 'this person'}?`, 'They lose access to your family right away. You can invite them again later.', 'Remove', () => q(sb.from('family_members').delete().eq('family_id', S.family.id).eq('user_id', el.dataset.rmmember)), 'Removed'));
  each('[data-rminvite]', el => act(() => q(sb.from('family_invites').delete().eq('family_id', S.family.id).eq('email', el.dataset.rminvite)), 'Invite canceled'));
  on('invGo', () => { const e = $('invEmail').value.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return toast('Enter a valid email.');
    if (S.members.some(m => (m.email || '').toLowerCase() === e)) return toast('They’re already in your family.');
    const b = $('invGo'); b.disabled = true; b.textContent = 'Sending…';
    act(async () => { await q(sb.from('family_invites').upsert({ family_id: S.family.id, email: e })); const err = await sendInvite(e); toast(err ? `Added, but ${err.charAt(0).toLowerCase() + err.slice(1)} Or ask them to sign in at ${location.host || 'paperpig.app'} with ${e}.` : `Invite sent to ${e}`) }) });
  each('[data-reinvite]', async el => { el.disabled = true; el.textContent = 'Sending…'; const err = await sendInvite(el.dataset.reinvite); el.disabled = false; el.textContent = 'Send again'; toast(err || `Sent again to ${el.dataset.reinvite}`) });
  on('signOutWho', async () => { await sb.auth.signOut(); store.set('profile', null); store.set('signed-in', null); location.reload() });
  on('signOut', async () => { await sb.auth.signOut(); store.set('profile', null); location.reload() });
  on('delAcct', deleteSheet);
  each('[data-sday]', el => el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') !== 'true'));
  each('[data-savescr]', el => { const id = el.dataset.savescr, days = [...app.querySelectorAll(`[data-sday^="${id}|"]`)].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => Number(b.dataset.sday.split('|')[1]));
    if (!days.length) return toast('Pick at least one screen day.');
    act(() => q(sb.from('kids').update({ base_screen_minutes: Math.max(0, parseInt($('sb-' + id).value) || 0), reading_cap: Math.max(0, parseInt($('sr-' + id).value) || 0), screen_days: days }).eq('id', id)), 'Screen time saved') });
  each('[data-fb]', el => feedbackSheet(el.dataset.fb));
  each('[data-privacy]', () => privacySheet());
}
function bindBoards() {
  const kid = kidById(S.profile); if (!kid) return;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn };
  on('startBtn', () => screenStartSheet(kid)); on('startScr', () => screenStartSheet(kid)); on('pauseScr', () => pauseTimer('screen_sessions', screenWeek(kid).active));
  on('resumeScr', () => { unlockAudio(); resumeTimer('screen_sessions', screenWeek(kid).active) }); on('doneScr', async () => { await doneTimer('screen_sessions', screenWeek(kid).active, null); celebrate('Screens off. Nice job!', `You still have ${dur(screenWeek(kid).leftSec)} saved for later.`, { power: .5, icon: 'check' }) });
  on('startRead', () => readStartSheet(kid)); on('pauseRead', () => pauseTimer('reading_sessions', activeRead(kid), kid));
  on('resumeRead', () => resumeTimer('reading_sessions', activeRead(kid))); on('stopRead', () => stopRead(kid));
}
function rerenderBoards() { const kid = kidById(S.profile); if (!kid) return; const b = $('board'); if (b) b.innerHTML = boardHTML(kid); const r = $('readBoard'); if (r) r.innerHTML = readBoardHTML(kid); bindBoards() }
/* ---------- stopwatch or timer ----------
   A session can run open-ended (stopwatch) or count down from a set length (timer). A timer stops
   the session at exactly that length, so exactly that much is used, and rings until it's turned off. */
const sessTarget = r => r ? (Number(r.target_seconds) || Number(store.get('tgt-' + r.id)) || 0) : 0;
const TPREF = (kind, kid) => `tpref-${kind}-${kid.id}`;
function timerPref(kind, kid) {
  let p = null; try { p = JSON.parse(store.get(TPREF(kind, kid)) || 'null') } catch (e) { }
  return p || (kind === 'screen' ? { mode: 'timer', min: 15 } : { mode: 'watch', min: 20 });
}
/* Minute choices: 5-minute steps, and for screens never more than what's left (plus that exact amount). */
function timerChoices(kind, maxMin) {
  if (kind === 'read') return [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  const top = Math.min(maxMin, 120), out = [];
  for (let m = 5; m <= top; m += 5) out.push(m);
  if (maxMin % 5 && maxMin <= 120) out.push(maxMin);
  if (maxMin > 120) out.push(maxMin);
  return out.length ? out : [Math.max(1, maxMin)];
}
const minLabel = m => mins(m);
const timerHint = (kind, m) => kind === 'screen' ? `The timer rings after ${minLabel(m)}. Turn it off, and that time comes out of your screen time.` : `The timer rings after ${minLabel(m)} of reading.`;
function timerPickHTML(kind, st, maxMin) {
  const ch = timerChoices(kind, maxMin);
  return `<div class="field"><span class="label">How long?</span>
    <div class="seg tmode"><button type="button" data-tm="watch" aria-pressed="${st.mode === 'watch'}">${I.clock}Stopwatch</button><button type="button" data-tm="timer" aria-pressed="${st.mode === 'timer'}">${I.bell}Timer</button></div>
    ${st.mode === 'timer' ? `<div class="chips tmins ${ch.length > 12 ? 'scroll' : ''}" role="radiogroup" aria-label="Minutes">${ch.map(m => `<button class="chip" type="button" role="radio" data-tmin="${m}" aria-checked="${m === st.min}" aria-pressed="${m === st.min}">${kind === 'screen' && m === maxMin ? `All ${minLabel(m)}` : minLabel(m)}</button>`).join('')}</div>
      <div class="tcustom"><label for="tminIn">Or type the minutes</label><span class="minin"><input id="tminIn" type="number" inputmode="numeric" min="1" max="${maxMin}" step="1" value="${st.min}" data-kind="${kind}"><span>min</span></span></div>
      <p class="hint" id="tHint">${timerHint(kind, st.min)}</p>${alertLineHTML()}`
      : `<p class="hint">${kind === 'screen' ? 'Runs until you stop it. At zero for the week, screens go off.' : 'Counts up until you tap I’m done.'}</p>`}</div>`;
}
/* Pick a valid starting choice: the last one used, or the closest that still fits. */
function timerState(kind, kid, maxMin) {
  const p = timerPref(kind, kid), ch = timerChoices(kind, maxMin);
  // A typed amount is kept too, as long as it still fits (screens can't go past what's left this week).
  const min = p.min >= 1 && p.min <= maxMin ? Math.round(p.min) : ch.filter(m => m <= p.min).pop() || ch[0];
  return { mode: p.mode, min };
}
function bindTimerPick(st, redraw) {
  const sel = layer.querySelector('.tmins [aria-checked="true"]'); if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
  layer.querySelectorAll('[data-tm]').forEach(b => b.onclick = () => { st.mode = b.dataset.tm; redraw() });
  layer.querySelectorAll('[data-tmin]').forEach(b => b.onclick = () => { st.min = Number(b.dataset.tmin); redraw() });
  const pg = layer.querySelector('#pushGo'); if (pg) pg.onclick = () => pushEnable().then(ok => { if (ok) { toast('Done! Timers ring on this device even when the app is closed.'); redraw() } });
  layer.querySelectorAll('.alertline [data-install]').forEach(b => b.onclick = () => installSheet());
  // Typing updates the chips, the hint and the start button in place, so the keyboard stays up.
  const inp = layer.querySelector('#tminIn'); if (!inp) return;
  const max = Number(inp.max), kind = inp.dataset.kind;
  const sync = note => { layer.querySelectorAll('[data-tmin]').forEach(b => { const on = Number(b.dataset.tmin) === st.min; b.setAttribute('aria-checked', on); b.setAttribute('aria-pressed', on) });
    const h = $('tHint'); if (h) h.textContent = note || timerHint(kind, st.min); const go = layer.querySelector('#scrGo,#rdGo'); if (go) go.textContent = `Start ${minLabel(st.min)} timer` };
  const over = () => kind === 'screen' ? `You have ${minLabel(max)} left this week, so the timer is set to ${minLabel(max)}.` : `Reading timers go up to ${minLabel(max)}.`;
  inp.oninput = () => { const v = parseInt(inp.value); if (v >= 1) { st.min = Math.min(max, v); sync(v > max ? over() : '') } };
  inp.onchange = () => { const v = parseInt(inp.value); st.min = Math.min(max, Math.max(1, v || st.min)); inp.value = st.min; sync(v > max ? over() : '') };
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur() } };
}
/* Insert a session; if the database hasn't got the timer column yet, keep the timer on this device instead. */
async function insertSession(table, row, target) {
  const body = target ? { ...row, target_seconds: target } : row;
  let { data, error } = await sb.from(table).insert(body).select().single();
  if (error && target && /target_seconds/i.test(error.message || '')) {
    ({ data, error } = await sb.from(table).insert(row).select().single());
    if (!error && data) store.set('tgt-' + data.id, String(target));
  }
  if (error) throw error;
  return data;
}
async function startScreen(kid, note, target) {
  if (screenWeek(kid).active) return; unlockAudio(); const d = today(), now = new Date().toISOString();
  await act(() => insertSession('screen_sessions', { family_id: S.family.id, kid_id: kid.id, local_date: d, week_start: monday(d), started_at: now, running_since: now, seconds: 0, source: 'clock', note: note || null }, target));
}
function screenStartSheet(kid) {
  const sw = screenWeek(kid);
  if (!isScreenDay(kid)) return toast(`Screens open ${screenDayNames(kid)}. You have ${dur(sw.leftSec) || '0 min'} so far.`);
  if (!sw.leftSec) return toast('All of this week’s screen time is used. New time starts Monday.');
  const recent = [...new Set(S.screen.filter(x => x.kid_id === kid.id && x.note && x.source !== 'manual').sort((a, b) => ms(b.started_at) - ms(a.started_at)).map(x => x.note))].slice(0, 6);
  const maxMin = Math.max(1, Math.floor(sw.leftSec / 60)), st = timerState('screen', kid, maxMin);
  let note = recent[0] || '';
  const draw = () => openSheet(`<span class="label">${dur(sw.leftSec)} left this week</span><h2>Start screens</h2><div class="field"><label class="label" for="watchIn">What are you watching or playing?</label><input id="watchIn" maxlength="80" placeholder="Show, game or app" value="${esc(note)}">
    ${recent.length ? `<div class="chips">${recent.map(b => `<button class="chip" type="button" data-watch="${esc(b)}">${esc(b)}</button>`).join('')}</div>` : ''}</div>
    ${timerPickHTML('screen', st, maxMin)}
    <button class="save" id="scrGo" type="button">${st.mode === 'timer' ? `Start ${minLabel(st.min)} timer` : 'Start the clock'}</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    $('watchIn').oninput = e => { note = e.target.value };
    layer.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => { note = b.dataset.watch; $('watchIn').value = note });
    bindTimerPick(st, draw);
    $('scrGo').onclick = async () => {
      const n = capFirst($('watchIn').value.trim()); if (!n) return toast('What are you watching?');
      if (st.mode === 'timer') pushAutoAsk();
      store.set(TPREF('screen', kid), JSON.stringify(st)); closeSheet();
      await startScreen(kid, n, st.mode === 'timer' ? Math.min(st.min * 60, screenWeek(kid).leftSec) : 0);
      toast(st.mode === 'timer' ? `Enjoy ${n}! The timer rings in ${minLabel(st.min)}.` : `Enjoy ${n}!`);
    };
  });
  draw();
}
const timerSec = (row, kid) => kid ? Math.min(liveSec(row), capSec(kid)) : liveSec(row);
async function pauseTimer(table, row, kid) { if (!row || !row.running_since) return; await act(() => q(sb.from(table).update({ seconds: timerSec(row, kid), running_since: null }).eq('id', row.id)), 'Paused. Your time is saved.') }
async function resumeTimer(table, row) { if (!row || row.running_since) return; await act(() => q(sb.from(table).update({ running_since: new Date().toISOString() }).eq('id', row.id))) }
async function doneTimer(table, row, msg, kid, secOverride) { if (!row) return; const sec = secOverride ?? timerSec(row, kid); await act(() => q(sb.from(table).update({ seconds: sec, running_since: null, ended_at: new Date().toISOString() }).eq('id', row.id)), msg) }
async function stopRead(kid) {
  const a = activeRead(kid); if (!a) return; const sec = timerSec(a, kid), before = Math.min(Number(kid.reading_cap) || 0, Math.floor((readWeek(kid).sec - readSec(a, kid)) / 60));
  await doneTimer('reading_sessions', a, null, kid);
  const after = readWeek(kid).bonus, earned = after - before;
  celebrate(`You read ${dur(sec)}!`, readCheer(kid, before, after), { power: earned > 0 ? 1.3 : .8, icon: 'read' });
}
function txSheet(kid, kind, pre = {}) {
  const st = stats(kid), pay = kind === 'payout', G = pay ? [] : kidGoals(kid).filter(g => goalBal(g) > 0);
  const T = { goal: pre.goal && G.some(g => g.id === pre.goal) ? pre.goal : '', amt: pre.amount ? Number(pre.amount).toFixed(2) : '', note: pre.note || '', date: today() };
  const srcBal = () => T.goal ? goalBal(goalById(T.goal)) : stats(kid).bank;
  const draw = () => openSheet(`<span class="label">${esc(kid.name)} has ${money(st.bank)} in the bank${st.saved ? ` + ${money(st.saved)} saved` : ''}</span><h2>${pay ? `Withdraw cash for ${esc(kid.name)}` : `You bought something for ${esc(kid.name)}`}</h2>
    <p class="hint">${pay ? 'Cash, a transfer, or anything you handed over. It comes out of their bank. Money saved in goals stays put.' : 'Something you paid for with their money.'}</p>
    ${!pay && G.length ? `<div class="field"><span class="label">Paid from</span><div class="chips acct"><button class="chip" type="button" data-src="" aria-pressed="${!T.goal}">Bank <small>${money(st.bank)}</small></button>${G.map(g => `<button class="chip" type="button" data-src="${g.id}" aria-pressed="${T.goal === g.id}">${esc(g.name)} <small>${money(goalBal(g))}</small></button>`).join('')}</div></div>` : ''}
    ${srcBal() > 0 ? `<div class="chips"><button class="chip" type="button" data-amt="${srcBal()}">All of it · ${money(srcBal())}</button>${pay ? [5, 10, 20].filter(a => a < srcBal()).map(a => `<button class="chip" type="button" data-amt="${a}">$${a}</button>`).join('') : ''}</div>` : ''}
    <div class="field"><label class="label" for="tAmt">Amount ($)</label><input id="tAmt" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00" value="${esc(T.amt)}"></div>
    <div class="field"><label class="label" for="tWhy">Explanation ${esc(kid.name)} will see</label><input id="tWhy" maxlength="120" placeholder="${pay ? 'Cash' : 'What you bought'}" value="${esc(T.note)}"></div>
    <div class="field"><label class="label" for="tDate">Date</label><input id="tDate" type="date" value="${T.date}" max="${today()}"></div>
    <button class="save" id="tGo" type="button">${pay ? 'Record withdrawal' : 'Record purchase'}</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    const keep = () => { T.amt = $('tAmt').value; T.note = $('tWhy').value; T.date = $('tDate').value };
    layer.querySelectorAll('[data-src]').forEach(b => b.onclick = () => { keep(); T.goal = b.dataset.src; const g = goalById(T.goal); if (g && !T.note) T.note = g.name; draw() });
    layer.querySelectorAll('[data-amt]').forEach(b => b.onclick = () => { $('tAmt').value = Number(b.dataset.amt).toFixed(2) });
    $('tGo').onclick = async () => {
      const a = r2(parseFloat($('tAmt').value) || 0), why = $('tWhy').value.trim(), d = $('tDate').value || today(), g = goalById(T.goal);
      if (a <= 0) return toast('Enter an amount.');
      if (!why) return toast('Add an explanation so ' + kid.name + ' knows what this was.');
      if (a > srcBal() + 0.001) return toast(g ? `${g.name} only has ${money(srcBal())} saved.` : `That's more than ${kid.name} has in the bank (${money(stats(kid).bank)}).${stats(kid).saved ? ' Saved money stays in its goals.' : ''}`);
      closeSheet();
      await act(() => q(sb.from('transactions').insert({ family_id: S.family.id, kid_id: kid.id, kind, amount: a, note: why, local_date: d, ...(g ? { goal_id: g.id } : {}) })), pay ? `${money(a)} withdrawn` : `${money(a)} purchase recorded`);
      // A goal that's been bought and emptied is done.
      if (g && Number(g.target) > 0 && goalBal(g) <= 0.004) { await act(() => q(sb.from('savings_goals').update({ archived: true }).eq('id', g.id))); toast(`Bought! ${goalLabel(g)} is done.`) }
    };
  });
  draw();
}
function statementSheet(kid) {
  const parent = S.view === 'parent';
  openSheet(`<span class="label">${esc(kid.name)} · ${money(stats(kid).bank)} in the bank${stats(kid).saved ? ` + ${money(stats(kid).saved)} saved` : ''}</span><h2>Money statement</h2><p class="hint">The right column is all of ${esc(kid.name)}’s money, bank and savings together.</p><div class="list">${statement(kid).map(l => stmtRow(l, kid, parent)).join('')}</div><button class="cancel" data-close type="button">Close</button>`, () => { bindUndo(layer); layer.querySelectorAll('[data-edit]').forEach(b => { const f = b.onclick; b.onclick = () => { closeSheet(); f() } }) });
}
function bindUndo(root) { root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEdit(b.dataset.edit)) }
/* ticking: updates the display; it only writes to stop a timer that has run out */
let wasActive = null, wakeLock = null, audio = null, autoStopping = false;
const stopping = new Set();
/* Any other timer that has reached zero (another kid's, or while on the grown-up side) stops at exactly its length
   too. The database does this as well, every second; this covers the moment before it does. */
function stopFinishedTimers() {
  if (!S.family || !S.kids) return;
  for (const k of S.kids) {
    if (S.view === 'kid' && k.id === S.profile) continue; // this kid's screen rings for it below
    [[screenWeek(k).active, 'screen_sessions'], [activeRead(k), 'reading_sessions']].forEach(([row, table]) => {
      const tg = sessTarget(row);
      if (row && row.running_since && tg && rawSec(row) >= tg && !stopping.has(row.id)) {
        stopping.add(row.id); doneTimer(table, row, null, null, tg).finally(() => stopping.delete(row.id));
      }
    });
  }
}
setInterval(() => {
  if (S.view === 'kid' || S.view === 'parent') stopFinishedTimers();
  if (S.view !== 'kid') return; const kid = kidById(S.profile); if (!kid) return;
  const x = screenWeek(kid), a = x.active, r0 = activeRead(kid), id = (a && a.running_since ? a.id : '') + (r0 && r0.running_since ? r0.id : '') || null;
  if (id !== wasActive) { if (id) holdWake(); else releaseWake(); wasActive = id }
  const tg = sessTarget(a);
  if (a && a.running_since && tg && liveSec(a) >= tg && x.leftSec > 0 && !autoStopping) {
    autoStopping = true; const quiet = pushOn() && rawSec(a) - tg > 10;
    doneTimer('screen_sessions', a, null, null, tg).then(() => ringAlarm('Time\u2019s up!', `Your ${minLabel(Math.round(tg / 60))} of screens are done. ${screenWeek(kid).leftSec ? `${dur(screenWeek(kid).leftSec)} left this week.` : 'That was the last of this week\u2019s screen time.'}`,
      () => celebrate('Screens off. Nice job!', screenWeek(kid).leftSec ? `You still have ${dur(screenWeek(kid).leftSec)} saved for later.` : 'New screen time starts Monday.', { power: .6, icon: 'check' }), { quiet })).finally(() => { autoStopping = false });
    return;
  }
  if (a && a.running_since && x.leftSec <= 0 && !autoStopping) {
    autoStopping = true;
    doneTimer('screen_sessions', a, null, null, Math.max(0, liveSec(a) - (x.usedSec - x.totalSec))).then(() => ringAlarm('Time\u2019s up!', 'That was the last of this week\u2019s screen time. New time starts Monday.')).finally(() => { autoStopping = false });
    return;
  }
  if (a && a.running_since) { const d = $('digits'); if (d) d.textContent = hms(tg ? tg - liveSec(a) : x.leftSec); const wl = $('wkLeft'); if (wl) wl.textContent = hms(x.leftSec); const su = $('sessUsed'); if (su) su.textContent = hms(liveSec(a)); const f = $('barfill'); if (f) f.style.width = (tg ? Math.min(100, 100 * liveSec(a) / tg) : x.totalSec ? 100 * x.usedSec / x.totalSec : 100) + '%'; const el = $('eqLeft'); if (el) el.textContent = hms(x.leftSec); const eu = $('eqUsed'); if (eu) eu.textContent = mins(Math.floor(x.usedSec / 60)); const sb2 = $('stBar'); if (sb2) sb2.style.width = (x.totalSec ? Math.min(100, 100 * x.usedSec / x.totalSec) : 100) + '%' }
  const r = activeRead(kid);
  if (r && r.running_since) {
    const rt = sessTarget(r);
    if (rt && liveSec(r) >= rt && !autoStopping) {
      autoStopping = true; const quiet = pushOn() && rawSec(r) - rt > 10; const before = Math.min(Number(kid.reading_cap) || 0, Math.floor((readWeek(kid).sec - readSec(r, kid)) / 60));
      doneTimer('reading_sessions', r, null, kid, rt).then(() => ringAlarm('Time\u2019s up!', `You read ${minLabel(Math.round(rt / 60))}!`, () => {
        const after = readWeek(kid).bonus, earned = after - before;
        celebrate(`You read ${dur(rt)}!`, readCheer(kid, before, after), { power: earned > 0 ? 1.3 : .8, icon: 'read' });
      }, { quiet })).finally(() => { autoStopping = false });
      return;
    }
    if (liveSec(r) >= capSec(kid) && !autoStopping) { autoStopping = true; doneTimer('reading_sessions', r, 'Reading timer stopped after 3 hours. Was it left on?', kid).finally(() => { autoStopping = false }); return }
    const rd = $('readDigits'); if (rd) rd.textContent = hms(rt ? rt - readSec(r, kid) : readSec(r, kid)); const rb = $('readBar'); if (rb) rb.style.width = Math.min(100, 100 * readSec(r, kid) / rt) + '%';
  }
}, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.family && (S.view === 'kid' || S.view === 'parent')) refresh() });
setInterval(() => { if (!document.hidden && S.family && (S.view === 'kid' || S.view === 'parent') && !$('scrim') && !S.openJob) refresh() }, 60000);
function unlockAudio() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume() } catch (e) { } }
function beep() { try { if (!audio) return;[0, .35, .7].forEach(t => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audio.destination); g.gain.setValueAtTime(.25, audio.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + t + .3); o.start(audio.currentTime + t); o.stop(audio.currentTime + t + .3) }) } catch (e) { } }
/* The alarm: rings (and buzzes, where phones allow) until it's turned off. Gives up after two minutes. */
let alarmEl = null, alarmTimer = 0;
function alarmSound() {
  try { unlockAudio(); if (!audio) return; const t0 = audio.currentTime;
    [0, .16, .32, .62, .78, .94].forEach(dt => { const o = audio.createOscillator(), g = audio.createGain(), t = t0 + dt; o.type = 'square'; o.frequency.setValueAtTime(1046, t); o.frequency.setValueAtTime(1318, t + .06); o.connect(g); g.connect(audio.destination); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.16, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + .13); o.start(t); o.stop(t + .14) });
  } catch (e) { }
  try { navigator.vibrate?.([180, 80, 180, 80, 180]) } catch (e) { }
}
/* quiet: show the card without the sound (the push already rang while the app was closed) */
function ringAlarm(title, sub, after, opt = {}) {
  stopAlarm(); const started = Date.now();
  const el = alarmEl = document.createElement('div'); el.className = 'alarm'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', title);
  el.innerHTML = `<div class="alarm-card"><span class="alarm-bell">${I.bell}</span><b>${esc(title)}</b><span>${esc(sub)}</span><button class="save alarm-off" type="button">Turn off</button></div>`;
  document.body.appendChild(el);
  if (!opt.quiet) { alarmSound(); alarmTimer = setInterval(() => { if (Date.now() - started > 120000) { clearInterval(alarmTimer); return } alarmSound() }, 1500) }
  el.querySelector('.alarm-off').onclick = () => { stopAlarm(); after && after() };
  el.querySelector('.alarm-off').focus({ preventScroll: true, focusVisible: false });
}
function stopAlarm() { clearInterval(alarmTimer); try { navigator.vibrate?.(0) } catch (e) { } if (alarmEl) { alarmEl.remove(); alarmEl = null } }
// sound needs one tap to unlock on phones; any tap in the app does it
document.addEventListener('pointerdown', () => unlockAudio(), { passive: true });
async function holdWake() { try { wakeLock = await navigator.wakeLock?.request('screen') } catch (e) { } }
function releaseWake() { try { wakeLock?.release(); wakeLock = null } catch (e) { } }

/* ---------- timer alerts: ring this device when a timer ends, even with the app closed (web push) ----------
   The database notices a timer ran out and sends a push through netlify/functions/ring.js; sw.js shows it with
   the device's notification sound. Each phone or tablet turns it on for itself, and it rings for every kid's timer.
   iPhone and iPad can only do this from the home-screen app. */
const pushOK = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && /(^|\.)paperpig\.app$|\.netlify\.app$/.test(location.hostname);
const pushNeedsInstall = () => !pushOK() && isIOS() && !isInstalled();
let pushKey = null; // the server's public push key; '' when alerts aren't set up there
async function pushKeyGet() {
  if (pushKey !== null) return pushKey;
  try { const j = await (await fetch('/.netlify/functions/ring', { cache: 'no-store' })).json(); pushKey = j.ready && j.publicKey ? j.publicKey : '' } catch (e) { return '' }
  return pushKey;
}
if (/(^|\.)paperpig\.app$|\.netlify\.app$/.test(location.hostname)) pushKeyGet();
const pushOn = () => pushOK() && store.get('push') === '1' && Notification.permission === 'granted';
const b64u = s => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)) };
const sameKey = (sub, key) => { try { const a = new Uint8Array(sub.options.applicationServerKey), b = b64u(key); return a.length === b.length && a.every((v, i) => v === b[i]) } catch (e) { return true } };
const devName = () => /iPhone|iPod/.test(navigator.userAgent) ? 'iPhone' : isIOS() ? 'iPad' : /Android/i.test(navigator.userAgent) ? 'Android' : 'Computer';
async function pushSub(key) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) { await sub.unsubscribe().catch(() => { }); sub = null }
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) });
  const j = sub.toJSON();
  const { error } = await sb.rpc('pp_save_push', { p_family: S.family.id, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_label: devName() });
  if (error) throw error;
}
/* Turn it on for this device. The permission question comes first, while the tap still counts (Safari needs that).
   quiet: asked on its own when a timer starts, so a "no" doesn't get a message. */
async function pushEnable(quiet) {
  if (!pushOK()) return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { if (!quiet) toast(perm === 'denied' ? 'Notifications are blocked for Paper Pig. Allow them in this device’s settings, then try again.' : 'No problem. Timers still ring while the app is open.'); return false }
  try {
    const key = await pushKeyGet(); if (!key) { if (!quiet) toast('Timer alerts aren’t ready yet. Try again later.'); return false }
    await pushSub(key); store.set('push', '1'); return true;
  } catch (e) { if (!quiet) toast(errMsg(e)); return false }
}
/* On by default: the first timer started on a device asks to allow notifications (a browser only asks after a tap).
   Allowed once, it stays on, unless someone turns Timer alerts off in Settings ('0'). */
function pushAutoAsk() {
  if (!pushOK() || !pushKey || pushOn() || store.get('push') === '0' || Notification.permission === 'denied') return;
  pushEnable(true).then(ok => { if (ok) toast('This device will ring when the timer ends, even with the app closed.') });
}
async function pushDisable() {
  store.set('push', '0');
  try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); if (sub) { await sb.rpc('pp_drop_push', { p_endpoint: sub.endpoint }); await sub.unsubscribe() } } catch (e) { }
}
/* After sign-in: keep this device's push address saved and current (browsers change it now and then). */
async function pushRefresh() {
  if (!pushOK() || !S.family || store.get('push') === '0' || Notification.permission !== 'granted') return;
  try { const key = await pushKeyGet(); if (key) { await pushSub(key); store.set('push', '1') } } catch (e) { }
}
/* The line under a timer's minutes: will it ring with the app closed? */
function alertLineHTML() {
  if (pushKey === '') return '';
  if (pushNeedsInstall()) return `<p class="hint alertline">${I.bell}<span>To ring with the app closed or the screen locked, <button class="link" type="button" data-install>add Paper Pig to your home screen</button>.</span></p>`;
  if (!pushOK()) return '';
  if (pushOn()) return `<p class="hint alertline on">${I.bell}<span>Rings on this device even if the app is closed.</span></p>`;
  if (Notification.permission === 'denied') return `<p class="hint alertline">${I.bell}<span>Notifications are off for Paper Pig, so it only rings while the app is open.</span></p>`;
  if (store.get('push') === '0') return `<button class="pill soft alertbtn" id="pushGo" type="button">${I.bell}Ring even when the app is closed</button>`;
  if (Notification.permission === 'granted') return `<p class="hint alertline on">${I.bell}<span>Rings on this device even if the app is closed.</span></p>`;
  return `<p class="hint alertline on">${I.bell}<span>Tap Allow when it asks, so it rings even with the app closed.</span></p>`;
}

/* ---------- sheets ---------- */
const layer = $('layer');
/* An open sheet updates in place (no replayed slide-up, scroll kept), so tapping an option never feels like a reload. */
function openSheet(html, after) {
  const cur = layer.querySelector('.sheet');
  if (cur) { const top = cur.scrollTop; cur.innerHTML = html; cur.scrollTop = top; layer.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet); after && after(); return }
  layer.innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`; $('scrim').onclick = e => { if (e.target.id === 'scrim') closeSheet() }; layer.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet); after && after() }
function closeSheet() { layer.innerHTML = '' }
let tt; function toast(m) { clearTimeout(tt); let el = $('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el) } el.textContent = m; tt = setTimeout(() => el.remove(), Math.max(2800, String(m).length * 70)) }
function confirmSheet(title, body, yes, fn, ok, style = 'red') {
  openSheet(`<h2>${esc(title)}</h2><p class="hint">${esc(body)}</p><button class="save ${style === 'red' ? 'red' : ''}" id="cfYes" type="button" >${esc(yes)}</button><button class="cancel" data-close type="button">Cancel</button>`,
    () => { $('cfYes').onclick = async () => { $('cfYes').disabled = true; closeSheet(); await act(fn, ok) } });
}
function pinSheet(onOk) {
  openSheet(`<h2>Parent/guardian PIN</h2><div class="field"><label class="label" for="pinIn">Enter your 4-digit PIN</label><input id="pinIn" class="pin" inputmode="numeric" type="password" maxlength="4" autocomplete="off"></div>
    <button class="save" id="pinGo" type="button">Unlock</button><button class="cancel" data-close type="button">Cancel</button>
    ${S.canResetPin ? '<button class="cancel" id="pinReset" type="button">Forgot it? Set a new PIN</button>' : '<p class="hint">Forgot it? On the Who\'s using screen, choose Switch account, sign in again with your email, and you can set a new PIN.</p>'}`, () => {
    const r = $('pinReset'); if (r) r.onclick = () => { closeSheet(); newPinSheet(true, onOk) };
    const i = $('pinIn'); i.focus();
    const go = async () => { if (!S.family.pin_hash || await hashPin(S.family.id, i.value) === S.family.pin_hash) { S.parentOk = true; try { sessionStorage.setItem('cj-parent', '1') } catch (e) { } closeSheet(); onOk() } else { i.value = ''; toast('That PIN didn’t match.') } };
    $('pinGo').onclick = go; i.oninput = () => { if (i.value.length === 4) go() };
  });
}
function newPinSheet(force, after) {
  openSheet(`<h2>${force ? 'Set a new PIN' : 'Change PIN'}</h2><div class="field"><label class="label" for="np1">New 4-digit PIN</label><input id="np1" class="pin" inputmode="numeric" type="password" maxlength="4"></div>
    <div class="field"><label class="label" for="np2">Type it again</label><input id="np2" class="pin" inputmode="numeric" type="password" maxlength="4"></div>
    <button class="save" id="npGo" type="button">Save PIN</button>${force ? '' : '<button class="cancel" data-close type="button">Cancel</button>'}`, () => {
    $('npGo').onclick = async () => { const a = $('np1').value, b = $('np2').value; if (!/^\d{4}$/.test(a)) return toast('Use 4 digits.'); if (a !== b) return toast('The PINs don’t match.'); closeSheet(); await act(async () => { await q(sb.from('families').update({ pin_hash: await hashPin(S.family.id, a) }).eq('id', S.family.id)) }, 'PIN saved'); if (after) { S.parentOk = true; try { sessionStorage.setItem('cj-parent', '1') } catch (e) { } after() } };
  });
}
/* How it works: short, and only the rules this family has actually set up. */
function rulesSheet(kid) {
  const allow = Number(kid.weekly_allowance) || 0, base = Number(kid.base_screen_minutes) || 0, cap = Number(kid.reading_cap) || 0;
  const days = (kid.screen_days || []).length, jobs = jobsFor(kid).length > 0;
  const R = [
    allow && ['coin', 'm', `<b>${money(allow)} every Monday.</b> It's yours, no matter what.`],
    jobs && ['jobs', 'j', `<b>Jobs earn more.</b> Do one, tap I did it, and a grown-up checks.`],
    ['pay', 'p', `<b>Your money stays in your bank</b> until you spend it or take it out.`],
    ['heart', 'j', `<b>Save up for things.</b> Move money into a goal and it's kept for that goal.${savLocked() ? ' A grown-up moves it back out.' : ''}`],
    penOn() ? ['jar', 'x', `<b>The ${esc(penName())}</b> can take a little, always with a reason.`] : ['star', 'm', `<b>Money is never taken away.</b>`],
    days && base && ['screen', 's', `<b>${mins(base)} of screens a week,</b> on ${screenDayNames(kid)}.`],
    days && cap && ['read', 'r', `<b>Every minute you read</b> earns a screen minute, up to ${mins(cap)} a week.`],
    days && (base || cap) && ['clock', 's', `<b>Screens count only while the clock runs.</b>`],
  ].filter(Boolean);
  openSheet(`<h2>How it works</h2><ul class="rules">${R.map(([ic, c, t]) => `<li><span class="ico ${c}">${I[ic]}</span><span>${t}</span></li>`).join('')}</ul><button class="save" data-close type="button">Got it</button>`);
}
function readStartSheet(kid) {
  const books = [...new Set(S.reading.filter(r => r.kid_id === kid.id).map(r => r.book))].slice(0, 6);
  const st = timerState('read', kid, 60);
  let book = books[0] || '';
  const draw = () => openSheet(`<h2>Start reading</h2><div class="field"><label class="label" for="bookIn">What are you reading?</label><input id="bookIn" maxlength="100" placeholder="Book title" value="${esc(book)}">
    ${books.length ? `<div class="chips">${books.map(b => `<button class="chip" type="button" data-book="${esc(b)}">${esc(b)}</button>`).join('')}</div>` : ''}</div>
    ${timerPickHTML('read', st, 60)}
    ${readMaxed(kid) ? `<p class="done-box maxed">${MAXED}</p>` : ''}<p class="hint">Chapter books and graphic novels count. Audiobooks don't.</p><button class="save" id="rdGo" type="button" style="background:var(--read)">${st.mode === 'timer' ? `Start ${minLabel(st.min)} timer` : 'Start the stopwatch'}</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    $('bookIn').oninput = e => { book = e.target.value };
    layer.querySelectorAll('[data-book]').forEach(b => b.onclick = () => { book = b.dataset.book; $('bookIn').value = book });
    bindTimerPick(st, draw);
    $('rdGo').onclick = async () => {
      const bk = $('bookIn').value.trim(); if (!bk) return toast('Type the book’s title.'); if (activeRead(kid)) return closeSheet();
      if (st.mode === 'timer') pushAutoAsk();
      store.set(TPREF('read', kid), JSON.stringify(st)); closeSheet(); const d = today();
      unlockAudio(); const now = new Date().toISOString();
      await act(() => insertSession('reading_sessions', { family_id: S.family.id, kid_id: kid.id, book: bk, local_date: d, week_start: monday(d), started_at: now, running_since: now, seconds: 0, source: 'timer' }, st.mode === 'timer' ? st.min * 60 : 0));
      toast(st.mode === 'timer' ? `Happy reading! The timer rings in ${minLabel(st.min)}.` : `Happy reading! Enjoy ${bk}.`);
    };
  });
  draw();
}
function manualSheet(kid, kind) { entrySheet(kind === 'read' ? 'read' : 'screen', kid, null, thisWeek()) }
/* In a kid's view, manual entry needs the parent PIN each time, and doesn't leave parent mode unlocked. */
function manualGate(kid, kind) { if (S.view === 'parent') return manualSheet(kid, kind); pinSheet(() => { S.parentOk = false; try { sessionStorage.removeItem('cj-parent') } catch (e) { } manualSheet(kid, kind) }) }
function logJobSheet(kid) {
  const on = jobsFor(kid).sort((a, b) => a.title.localeCompare(b.title)), ws = creditWeek();
  openSheet(`<span class="label">Log a job for ${esc(kid.name)}</span><h2>What did ${esc(kid.name)} do?</h2>
    <div class="field"><label class="label" for="jobSearch">Search</label><input id="jobSearch" placeholder="Dishes, trash, laundry…" autocomplete="off"></div>
    <div class="list" style="box-shadow:none;border:1px solid var(--line)" id="jobList">${on.map(j => `<button class="row" type="button" data-pickjob="${j.id}" data-q="${esc((j.title + ' ' + j.category).toLowerCase())}"><span class="t"><b>${esc(j.title)}</b><span>${esc(j.category)}</span></span><span class="price num">${money(Number(j.price))}</span></button>`).join('') || '<div class="empty">No jobs on this board.</div>'}</div>
    <button class="cancel" data-close type="button">Close</button>`, () => {
    $('jobSearch').oninput = e => { const v = e.target.value.toLowerCase(); layer.querySelectorAll('[data-pickjob]').forEach(b => b.hidden = !b.dataset.q.includes(v)) };
    layer.querySelectorAll('[data-pickjob]').forEach(b => b.onclick = async () => { const j = S.jobs.find(x => x.id === b.dataset.pickjob); closeSheet();
      await act(() => q(sb.from('credits').insert({ family_id: S.family.id, kid_id: kid.id, week_start: ws, kind: 'job', title: j.title, amount: Number(j.price), minutes: Number(j.bonus_minutes) || 0, job_id: j.id, status: 'approved' })), `+${money(Number(j.price))} for ${kid.name}`) });
  });
}
function bonusSheet(kid) {
  const ws = creditWeek(); let mode = 'money';
  const draw = () => openSheet(`<span class="label">Bonus for ${esc(kid.name)}</span><h2>Something good happened</h2>
    <div class="seg" style="grid-template-columns:1fr 1fr"><button type="button" data-bm="money" aria-pressed="${mode === 'money'}">Money</button><button type="button" data-bm="minutes" aria-pressed="${mode === 'minutes'}">Screen minutes</button></div>
    <div class="chips">${(mode === 'money' ? [0.5, 1, 2, 5] : [5, 10, 15, 30]).map(a => `<button class="chip" type="button" data-amt="${a}">${mode === 'money' ? '$' + (a < 1 ? a.toFixed(2) : a) : a + ' min'}</button>`).join('')}</div>
    <div class="field"><label class="label" for="bAmt">${mode === 'money' ? 'Amount ($)' : 'Minutes'}</label><input id="bAmt" type="number" inputmode="decimal" min="${mode === 'money' ? '0.25' : '1'}" step="${mode === 'money' ? '0.25' : '1'}" value="${mode === 'money' ? 1 : 10}"></div>
    <div class="field"><label class="label" for="bWhy">Explanation ${esc(kid.name)} will see</label><input id="bWhy" maxlength="120" placeholder="What they did"></div>
    <button class="save" id="bGo" type="button">Add ${mode === 'money' ? 'money' : 'minutes'}</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    layer.querySelectorAll('[data-bm]').forEach(b => b.onclick = () => { draw.why = $('bWhy').value; mode = b.dataset.bm; draw(); $('bWhy').value = draw.why || '' });
    layer.querySelectorAll('[data-amt]').forEach(b => b.onclick = () => { $('bAmt').value = b.dataset.amt });
    $('bGo').onclick = async () => {
      const v = parseFloat($('bAmt').value) || 0, why = $('bWhy').value.trim(); if (v <= 0) return toast('Enter an amount.'); if (!why) return toast('Add an explanation so they know why.'); closeSheet();
      if (mode === 'money') { const a = r2(v); await act(() => q(sb.from('credits').insert({ family_id: S.family.id, kid_id: kid.id, week_start: ws, kind: 'bonus', title: why, amount: a, status: 'approved' })), `+${money(a)} for ${kid.name}`) }
      else { const m = Math.min(600, Math.round(v)); await act(() => q(sb.from('screen_bonus').insert({ family_id: S.family.id, kid_id: kid.id, week_start: ws, minutes: m, note: why })), `+${m} screen minutes for ${kid.name}`) }
    };
  });
  draw();
}
/* The jar: a small, explained deduction of money or screen minutes. Small amounts are the
   default and the suggestion; emptying everything is possible but deliberately a second step. */
const PEN_MONEY = [0.1, 0.25, 0.5, 1], PEN_MIN = [1, 2, 5, 10];
function penaltySheet(kid, row) {
  const ws = row ? row.week_start : thisWeek();
  let mode = row ? (Number(row.amount) > 0 ? 'money' : 'minutes') : 'money', all = false;
  const st = { why: row ? row.note : '', amt: row ? (Number(row.amount) || Number(row.minutes)) : null };
  const maxFor = m => m === 'money' ? r2(stats(kid).bank + (row ? Number(row.amount) || 0 : 0)) : screenWeek(kid, ws).left + (row ? Number(row.minutes) || 0 : 0);
  const fmt = (m, v) => m === 'money' ? money(v) : `${v} min`;
  const draw = () => {
    const max = maxFor(mode), presets = (mode === 'money' ? PEN_MONEY : PEN_MIN).filter(v => v <= max);
    if (st.amt == null) st.amt = presets[0] ?? 0;
    openSheet(`<span class="label">${esc(kid.name)} · ${money(stats(kid).bank)} in the bank · ${dur(screenWeek(kid, ws).leftSec)} screens left</span><h2>${row ? 'Edit' : 'Add to the'} ${esc(penName())}${row ? ' entry' : ''}</h2>
      <div class="seg" style="grid-template-columns:1fr 1fr"><button type="button" data-pm="money" aria-pressed="${mode === 'money'}">Money</button><button type="button" data-pm="minutes" aria-pressed="${mode === 'minutes'}">Screen minutes</button></div>
      <p class="hint">Keep it small: ${mode === 'money' ? '10¢ to 25¢' : '1 to 5 minutes'} is usually plenty.</p>
      ${max > 0 ? `<div class="chips">${presets.map(v => `<button class="chip" type="button" data-pa="${v}" aria-pressed="${!all && Number(st.amt) === v}">${mode === 'money' ? (v < 1 ? Math.round(v * 100) + '¢' : '$' + v) : v + ' min'}</button>`).join('')}</div>` : `<p class="hint">${esc(kid.name)} has no ${mode === 'money' ? 'money in the bank' : 'screen minutes left this week'} to take.</p>`}
      <div class="field"><label class="label" for="pAmt">${mode === 'money' ? 'Amount ($)' : 'Minutes'}</label><input id="pAmt" type="number" inputmode="${mode === 'money' ? 'decimal' : 'numeric'}" min="${mode === 'money' ? '0.01' : '1'}" step="${mode === 'money' ? '0.05' : '1'}" max="${max}" value="${mode === 'money' ? Number(st.amt || 0).toFixed(2) : st.amt || ''}"></div>
      ${max > 0 ? (all ? `<p class="warnline">That's everything: ${fmt(mode, max)}. Most of the time a little goes a long way.</p>` : `<button class="link quiet" id="pAll" type="button">Take all of it (${fmt(mode, max)})</button>`) : ''}
      <div class="field"><label class="label" for="pWhy">Why? ${esc(kid.name)} will see this</label><input id="pWhy" maxlength="120" placeholder="What happened" value="${esc(st.why)}"></div>
      <button class="save" id="pGo" type="button">${row ? 'Save changes' : `Add ${fmt(mode, Number(st.amt) || 0)} to the jar`}</button>
      ${row ? '<button class="cancel danger-link" id="pDel" type="button">Delete this entry</button>' : ''}
      <button class="cancel" data-close type="button">Cancel</button>`, () => {
      const keep = () => { st.why = $('pWhy').value; st.amt = parseFloat($('pAmt').value) || 0 };
      const label = () => { if (!row) $('pGo').textContent = `Add ${fmt(mode, mode === 'money' ? r2(parseFloat($('pAmt').value) || 0) : Math.round(parseFloat($('pAmt').value) || 0))} to the jar` };
      layer.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { if (b.dataset.pm === mode) return; keep(); mode = b.dataset.pm; st.amt = null; all = false; draw() });
      layer.querySelectorAll('[data-pa]').forEach(b => b.onclick = () => { keep(); st.amt = Number(b.dataset.pa); all = false; draw() });
      $('pAmt').oninput = () => { layer.querySelectorAll('[data-pa]').forEach(x => x.setAttribute('aria-pressed', Number(x.dataset.pa) === Number($('pAmt').value))); label() };
      if ($('pAll')) $('pAll').onclick = () => { keep(); st.amt = max; all = true; draw() };
      $('pGo').onclick = async () => {
        keep(); const why = capFirst(st.why.trim()), v = mode === 'money' ? r2(st.amt) : Math.round(st.amt), lim = maxFor(mode);
        if (v <= 0) return toast(mode === 'money' ? 'Enter an amount.' : 'Enter minutes.');
        if (v > lim + 0.001) return toast(`That's more than ${kid.name} has (${fmt(mode, lim)}).`);
        if (!why) return toast(`Add a reason so ${kid.name} knows why.`);
        const body = { amount: mode === 'money' ? v : 0, minutes: mode === 'minutes' ? v : 0, note: why };
        closeSheet();
        if (row) return act(() => q(sb.from('penalties').update(body).eq('id', row.id)), 'Saved');
        const d = today();
        await act(() => q(sb.from('penalties').insert({ family_id: S.family.id, kid_id: kid.id, local_date: d, week_start: monday(d), ...body })), `${fmt(mode, v)} into the ${penName()}`);
      };
      if ($('pDel')) $('pDel').onclick = () => confirmSheet('Delete this entry?', `It comes out of the ${penName()} and goes back to ${kid.name}.`, 'Delete', () => q(sb.from('penalties').delete().eq('id', row.id)), 'Deleted');
    });
  };
  draw();
}
function kidMoreSheet(kid) {
  const cur = thisWeek(), cr = weekCredits(kid, cur), x = screenWeek(kid), paid = false;
  const reads = S.reading.filter(r => r.kid_id === kid.id && r.week_start === cur);
  openSheet(`<div style="display:flex;gap:12px;align-items:center">${avatar(kid)}<h2>${esc(kid.name)}</h2></div>
    <div class="sect"><div class="sect-h"><h3>This week's money</h3></div><div class="list" style="box-shadow:none;border:1px solid var(--line)">
      <div class="row"><span class="ico m">${I.coin}</span><span class="t"><b>Weekly allowance</b><span>Monday</span></span><span class="amt up">+${money(Number(weekRow(kid, cur)?.allowance ?? kid.weekly_allowance))}</span></div>
      ${cr.map(c => `<button class="row" type="button" data-cedit="${c.id}" ${paid ? 'disabled' : ''}><span class="ico ${c.kind === 'job' ? 'j' : 'm'}">${c.kind === 'job' ? I.check : I.star}</span><span class="t"><b>${esc(c.title)}</b><span>${paid ? 'Paid' : 'Tap to edit'}</span></span><span class="amt up">+${money(Number(c.amount))}</span></button>`).join('')}</div></div>
    ${eqHTML(kid, x, `<div class="ptools"><button class="pill soft" id="addScr" type="button">+ Add screen time used</button><button class="pill soft" id="addMin" type="button">+ Bonus minutes</button>${x.sess.length ? '<button class="pill soft" id="undoSess" type="button">Undo last session</button>' : ''}</div>`)}
    <div class="sect"><div class="sect-h"><h3>Reading this week</h3><button class="link" id="addRead" type="button">+ Add reading</button></div><div class="list" style="box-shadow:none;border:1px solid var(--line)">${reads.length ? ledgerItems(kid, cur, 'reading').map(r => ledgerRowHTML(r, true)).join('') : '<div class="empty">No reading yet this week.</div>'}</div></div>
    <button class="pill soft" id="editThisKid" type="button" style="justify-self:start">Edit ${esc(kid.name)}'s settings</button>
    <button class="cancel" data-close type="button">Close</button>`, () => {
    layer.querySelectorAll('[data-cedit]').forEach(b => b.onclick = () => { closeSheet(); openEdit('credit|' + b.dataset.cedit) });
    layer.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { closeSheet(); openEdit(b.dataset.edit) });
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn };
    on('addMin', () => bonusSheet(kid)); on('addScr', () => manualSheet(kid, 'screen')); on('addRead', () => manualSheet(kid, 'read'));
    on('undoSess', () => { const l = x.sess[x.sess.length - 1]; confirmSheet('Undo the last session?', `${dur(liveSec(l))} goes back to this week.`, 'Undo', () => q(sb.from('screen_sessions').delete().eq('id', l.id)), 'Minutes returned') });
    on('editThisKid', () => kidSheet(kid));
  });
}

function kidSheet(kid) {
  const K = kid ? { ...kid, screen_days: [...(kid.screen_days || [6, 0])] } : { name: '', weekly_allowance: 5, color: Object.keys(COLORS).find(c => !S.kids.some(k => k.color === c)) || 'green', base_screen_minutes: 120, reading_cap: 60, screen_days: [6, 0] };
  openSheet(`<h2>${kid ? `Edit ${esc(kid.name)}` : 'Add a kid'}</h2>${kidFieldsHTML(K)}
    <p class="hint">${kid ? 'A new allowance amount counts from this week on.' : S.kids.length ? 'They get the jobs your other kids all share. You can change that in Jobs.' : 'They get every job on your list.'}</p>
    <button class="save" id="kGo" type="button">${kid ? 'Save' : 'Add kid'}</button>
    ${kid ? `<button class="cancel danger-link" id="kDel" type="button">Remove ${esc(kid.name)} and their history</button>` : ''}<button class="cancel" data-close type="button">Cancel</button>`, () => {
    bindKidFields(layer, K);
    $('kGo').onclick = async () => { const body = kidBody(K); if (!body.name) { toast('Type a first name.'); return $('kN').focus() } closeSheet();
      // A new allowance starts this week, so the bank and How it works match what was just set.
      if (kid) await act(async () => { await q(sb.from('kids').update(body).eq('id', kid.id)); if (Number(kid.weekly_allowance) !== body.weekly_allowance) await q(sb.from('weeks').update({ allowance: body.weekly_allowance }).eq('kid_id', kid.id).eq('week_start', thisWeek())) }, 'Saved');
      else await act(() => addKid(body), `${body.name} added`) };
    if (kid) $('kDel').onclick = () => confirmSheet(`Remove ${kid.name}?`, 'This deletes their earnings history, reading and screen time, and takes them off every job. It can’t be undone.', 'Remove for good', () => q(sb.from('kids').delete().eq('id', kid.id)), 'Removed');
  });
}
/** where feedback was sent from, in words (for the feedback email) */
function screenName() {
  const tab = (list, id) => (list.find(t => t[0] === id) || [, id])[1];
  if (S.view === 'parent') return `Grown-up side: ${tab(PTABS, S.ptab)} tab`;
  if (S.view === 'kid') return `Kid side: ${tab(KTABS, S.tab)} tab`;
  return ({ who: 'Who’s here? (picking a profile)', auth: 'Sign-in screen', onboard: 'Setting up a new family', loading: 'Loading screen' })[S.view] || S.view;
}
const FB = { bug: ['Report a bug', 'What happened, and what did you expect? Which screen were you on?'], idea: ['Request a feature', 'What would make this more useful for your family?'], hi: ['Say hi', 'Questions, thanks, anything.'] };
function feedbackSheet(kind) {
  let K = FB[kind] ? kind : 'hi';
  const draw = () => openSheet(`<h2>${FB[K][0]}</h2>
    <div class="seg">${Object.entries(FB).map(([k, v]) => `<button type="button" data-fk="${k}" aria-pressed="${k === K}">${({ bug: 'Bug', idea: 'Feature idea', hi: 'Say hi' })[k]}</button>`).join('')}</div>
    <div class="field"><label class="label" for="fbMsg">Message</label><textarea id="fbMsg" class="textarea" maxlength="2000" placeholder="${esc(FB[K][1])}">${esc(draw.msg || '')}</textarea></div>
    <div class="field"><label class="label" for="fbEmail">Your email (so I can reply, optional)</label><input id="fbEmail" type="email" value="${esc(draw.email ?? (S.user?.email || ''))}" placeholder="you@example.com"></div>
    <button class="save" id="fbGo" type="button">Send</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    const keep = () => { draw.msg = $('fbMsg').value; draw.email = $('fbEmail').value };
    layer.querySelectorAll('[data-fk]').forEach(b => b.onclick = () => { keep(); K = b.dataset.fk; draw() });
    $('fbGo').onclick = async () => {
      keep(); const msg = draw.msg.trim(); if (msg.length < 3) { toast('Write a short message first.'); return $('fbMsg').focus() }
      const b = $('fbGo'); b.disabled = true; b.textContent = 'Sending\u2026';
      const fb = { type: FB[K][0], message: msg, email: draw.email.trim(), page: screenName(), app: navigator.userAgent.slice(0, 200) };
      // emailed straight to the owner (netlify/functions/feedback.js); Netlify Forms is the backup
      const viaEmail = () => fetch('/.netlify/functions/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fb, website: '' }) });
      const viaForm = () => fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ 'form-name': 'feedback', 'bot-field': '', ...fb }).toString() });
      try {
        let r = await viaEmail().catch(() => null);
        if (!r || !r.ok) r = await viaForm();
        if (!r.ok) throw new Error(r.status);
        draw.msg = ''; closeSheet(); toast('Sent. Thank you!');
      } catch (e) { b.disabled = false; b.textContent = 'Send'; toast(CFG.contactEmail ? `Couldn\u2019t send. Email ${CFG.contactEmail} instead.` : 'Couldn\u2019t send. Try again in a minute.') }
    };
  });
  draw.msg = ''; draw.email = undefined; draw();
}
const PRIVACY = [
  ['The short version', `${APP} is a free tool for families. It keeps as little as possible, never sells or shares it, and has no ads, trackers or analytics.`],
  ['What we store', 'The parent or guardian\u2019s email address, used only to send sign-in codes. A family name, time zone and a scrambled (hashed) parent/guardian PIN. For each kid: a first name and color, allowance amount, job board, jobs and bonuses with their explanations, withdrawals and purchases with their explanations, a saving goal if one is set, reading sessions (book titles and time) and screen-time sessions. If you turn on timer alerts, the push address your device’s browser gives us, so a timer can ring it.'],
  ['What we don\u2019t collect', 'No last names, birthdays, photos, locations, school names, contact details or anything else about kids. Kids never make an account or enter an email. Everything sits under the parent or guardian\u2019s account.'],
  ['Who can see it', 'Only the parents and guardians signed in to your family. Data is stored with Supabase and protected by database rules that keep each family\u2019s records separate from every other family\u2019s.'],
  ['Feedback messages', 'If you send a bug report, idea or message, it\u2019s delivered to the person who runs this site, along with the email you typed (optional) and which screen you were on.'],
  ['Donations', 'The Venmo, Cash App and PayPal links open those services. This site never sees your payment details.'],
  ['Deleting your data', 'Parent/guardian \u2192 Settings \u2192 Delete account and all data permanently removes your family, every kid profile and all history right away.'],
  ['Questions', 'Use Contact on the sign-in screen, or Settings \u2192 Contact & feedback.']
];
function privacySheet() {
  openSheet(`<span class="label">${esc(APP)}</span><h2>Privacy</h2>${PRIVACY.map(([h, t]) => `<div class="field"><b style="font:700 18px var(--display)">${h}</b><p class="hint" style="color:var(--ink);font-size:15px;line-height:1.55">${t}</p></div>`).join('')}<p class="hint">Last updated October 2026.</p><button class="save" data-close type="button">Done</button>`);
}
function deleteSheet() {
  openSheet(`<h2>Delete everything?</h2><p class="hint">This permanently deletes your family, every kid profile, all earnings history, reading and screen time, and your sign-in. Other parents and guardians on this family lose access too.</p>
    <div class="field"><label class="label" for="delType">Type DELETE to confirm</label><input id="delType" autocomplete="off"></div>
    <button class="save red" id="delGo" type="button">Delete my account</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    $('delGo').onclick = async () => { if ($('delType').value.trim() !== 'DELETE') return toast('Type DELETE to confirm.');
      try { await q(sb.rpc('delete_my_account')); await sb.auth.signOut(); store.set('profile', null); location.reload() } catch (e) { toast(errMsg(e)) } };
  });
}

/* Emails the invite through the site's invite function (Netlify + Resend). Returns '' when sent, or a reason a parent can act on. */
async function sendInvite(email) {
  let r;
  try {
    const tok = (await sb.auth.getSession()).data?.session?.access_token; if (!tok) return 'Your sign-in expired. Sign out and back in, then try again.';
    r = await fetch('/.netlify/functions/invite', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ email }) });
  } catch (e) { console.warn('invite email', e); return 'Couldn’t reach the server. Check your connection and try again.' }
  if (r.ok) return '';
  const j = await r.json().catch(() => ({})); console.warn('invite email', r.status, j);
  return ({ not_configured: 'Invite emails aren’t turned on yet. The site needs its RESEND_API_KEY.', signin: 'Your sign-in expired. Sign out and back in, then try again.',
    no_invite: 'That invite was canceled. Add them again.', too_many: 'Too many open invites. Cancel some first.',
    send_failed: `The email didn’t send: ${j.detail || 'the email service refused it'}.` })[j.error] || `The email didn’t send (error ${r.status}). Try again in a minute.`;
}
/* ---------- guided tour ----------
   Runs once after setup (and again from Settings): highlights one thing at a time on the grown-up side,
   then has the parent switch to a kid and shows that side. Progress is kept per sign-in on this device. */
const TOUR_KEY = () => 'tour-' + (S.user?.id || 'x');
function tourGet() { try { return JSON.parse(store.get(TOUR_KEY()) || 'null') } catch (e) { return null } }
function tourSet(t) { store.set(TOUR_KEY(), t ? JSON.stringify(t) : null) }
function tourStart() { tourSet({ i: 0 }); tourShown = -1; tourTick() }
function tourSteps() {
  const n = esc(S.kids[0]?.name || 'your kid');
  return [
    { view: 'parent', title: 'Welcome to Paper Pig!', text: 'Here’s a quick tour, about a minute. You’re on the grown-up side, where you run things.', next: 'Show me around' },
    { view: 'parent', sel: '.kcard', title: `${n}’s card`, text: 'Their bank, this week’s money, and screen and reading time, all at a glance.' },
    { view: 'parent', sel: '.kcard .kact', title: 'Quick actions', text: 'Log a job they did, give a bonus, or record something you bought with their money.' },
    { view: 'parent', sel: '.kcard .saveline', title: 'Savings goals', text: `${n} can save up for things. Tap here any time to see or manage their goals.` },
    { view: 'parent', sel: '.tabbar [data-tab="jobs"]', title: 'Jobs', text: 'Your family’s job list. Change prices, add jobs, and choose which kid can do each one.' },
    { view: 'parent', sel: '.tabbar [data-tab="pay"]', title: 'Ledger', text: 'Every dollar and every minute, with the reason. Tap any entry to fix a mistake.' },
    { view: 'parent', sel: '.tabbar [data-tab="settings"]', title: 'Settings', text: 'Allowance and screen time, invite another parent or guardian, and lock savings.' },
    { view: 'parent', sel: '#swapBtn', title: `Now see it as ${n}`, text: `Kids use the same app. Tap <b>Switch</b> to open their side.`, act: 'switch', next: 'Switch' },
    { view: 'who', sel: '.kidtile', title: 'Who’s here?', text: `This is where kids start. Tap <b>${n}</b>.`, act: 'pick', next: `Open ${n}` },
    { view: 'kid', sel: '.hero.bank', title: `${n}’s bank`, text: 'The first thing they see. Allowance lands every Monday, and jobs and bonuses add to it.' },
    { view: 'kid', sel: '.earn', title: 'Earn more', text: 'They pick a job, tap <b>I did it</b>, and it waits for your OK.' },
    { view: 'kid', sel: '#startRead', title: 'Reading earns screen time', text: 'Every minute they read adds a minute of screen time, up to the weekly limit you set.' },
    { view: 'kid', sel: '#startScr', title: 'Screen time', text: 'It runs on a timer. When it rings, screens are done, so the app is the bad guy, not you.' },
    { view: 'kid', sel: '#savings', title: 'Savings goals', text: 'They pick something, set the price, and move money in with <b>Move money</b>. The bar under the bank shows all their goals together.' },
    { view: 'kid', sel: '.tabbar [data-tab="ledger"]', title: 'Their ledger', text: 'Every entry and the reason for it, so there’s nothing to argue about.' },
    { view: 'kid', sel: '#swapBtn', title: 'Back to the grown-up side', text: 'Tap <b>Switch</b> and enter your PIN. That’s the tour. Have fun!', next: 'Done' },
  ];
}
/* The overlay is built once and moved, not redrawn: the highlight glides from step to step and follows the page
   every frame, and the tip only fades in once scrolling has settled. Built for phones first. */
let tourShown = -1, tourEl = null, tourTarget = null, tourRaf = 0, tourSettle = 0, tourStable = 0, tourSig = '', tourSafe = -1;
function tourBox() {
  if (tourEl && tourEl.isConnected) return tourEl;
  tourEl = document.createElement('div'); tourEl.id = 'tour';
  tourEl.innerHTML = '<div class="tour-dim"></div><div class="tour-hole"></div><i class="tour-block"></i><i class="tour-block"></i><i class="tour-block"></i><i class="tour-block"></i><i class="tour-block tour-cover"></i><div class="tour-tip" role="dialog" aria-modal="true" aria-live="polite"></div>';
  document.body.appendChild(tourEl); return tourEl;
}
function tourHide(remove) { if (!tourEl) return; tourEl.classList.remove('on'); if (remove) { tourEl.remove(); tourEl = null; tourShown = -1 } }
function tourEnd() { tourSet({ done: true }); tourHide(true) }
function tourTick() {
  const t = tourGet(); if (!t || t.done || t.i == null || !S.family) return tourHide(true);
  const steps = tourSteps(), st = steps[t.i]; if (!st) return tourEnd();
  if (st.view !== S.view) {
    // The parent did the step's action themselves (tapped Switch, or a kid): carry on from there.
    const j = steps.findIndex((x, k) => k > t.i && x.view === S.view);
    if (st.act && j > 0) { tourSet({ i: j }); return tourTick() }
    return tourHide();
  }
  if (S.view === 'parent' && S.ptab !== 'kids') { S.ptab = 'kids'; render(); return }
  if (S.view === 'kid' && S.tab !== 'home') { S.tab = 'home'; render(); return }
  if ($('scrim')) return tourHide();                       // wait until a sheet or celebration is closed
  const el = st.sel ? app.querySelector(st.sel) : null;
  if (st.sel && !el) { tourSet({ i: t.i + 1 }); return tourTick() }   // not on screen right now (say, screens already running)
  const box = tourBox(), fresh = tourShown !== t.i || tourTarget !== el;
  tourTarget = el;
  if (fresh) { const first = tourShown < 0 || !box.classList.contains('on'); tourShown = t.i; tourContent(st, t.i, steps.length); tourBring(el, first) }
  box.classList.toggle('center', !el); box.classList.toggle('act', !!st.act); box.classList.add('on');
  if (!tourRaf) tourRaf = requestAnimationFrame(tourFollow);
}
function tourContent(st, i, n) {
  const box = tourBox(), tip = box.querySelector('.tour-tip'), steps = tourSteps();
  tip.innerHTML = `<div class="tour-top"><span class="label">${i + 1} of ${n}</span><button class="link quiet" type="button" id="tourSkip">${i === n - 1 ? 'Close' : 'Skip tour'}</button></div>
    <h3>${st.title}</h3><p>${st.text}</p>
    <div class="tour-btns">${i > 0 && !st.act && steps[i - 1].view === st.view ? '<button class="pill soft" type="button" id="tourBack">Back</button>' : '<span></span>'}<button class="pill" type="button" id="tourNext">${st.next || 'Next'}</button></div>`;
  $('tourSkip').onclick = tourEnd;
  if ($('tourBack')) $('tourBack').onclick = () => { tourSet({ i: i - 1 }); tourTick() };
  $('tourNext').onclick = () => {
    if (st.act === 'switch') { tourHide(); return switchProfile() }
    if (st.act === 'pick') { tourHide(); return chooseProfile(S.kids[0].id) }
    if (i === n - 1) { tourEnd(); return celebrate('You’re all set!', 'Have fun with Paper Pig.', { power: .8, icon: 'star' }) }
    tourSet({ i: i + 1 }); tourTick();
  };
}
const tourView = () => { const v = window.visualViewport; return { W: v ? v.width : innerWidth, H: v ? v.height : innerHeight } };
/* Scroll only when the target, or room for the tip next to it, is off screen. The tip waits until that's done. */
function tourBring(el, first) {
  const box = tourBox(); box.classList.add('moving'); tourStable = 0; tourSettle = Date.now() + (first ? 120 : 260);
  box.classList.toggle('jump', !first);
  if (!el) return;
  const { H } = tourView(), r = el.getBoundingClientRect(), th = (box.querySelector('.tour-tip').offsetHeight || 190) + 28, bar = S.view !== 'who' ? 96 : 16;
  if (getComputedStyle(el).position === 'fixed' || el.closest('.tabbar')) return;
  const fits = r.top >= 12 && r.bottom <= H - bar && (r.top >= th || H - bar - r.bottom >= th);
  if (fits) return;
  const goal = r.height + th > H - bar - 24 ? 14 : Math.max(14, (H - bar - (r.height + th)) / 2);
  box.classList.remove('jump'); tourSettle = Date.now() + 520;
  window.scrollBy({ top: r.top - goal, behavior: reduceMotion() ? 'auto' : 'smooth' });
}
function tourFollow() {
  tourRaf = 0; if (!tourEl || !tourEl.classList.contains('on')) return;
  const { W, H } = tourView(), el = tourTarget, tip = tourEl.querySelector('.tour-tip'), hole = tourEl.querySelector('.tour-hole');
  if (tourSafe < 0) { const pr = document.createElement('div'); pr.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px)'; document.body.appendChild(pr); tourSafe = pr.offsetHeight || 0; pr.remove() }
  const tipW = Math.min(360, W - 24); tip.style.width = tipW + 'px';
  const th = tip.offsetHeight || 190; let x = (W - tipW) / 2, y = Math.max(16, (H - th) / 2 - 20), sig = 'c';
  if (el && el.isConnected) {
    const r = el.getBoundingClientRect(), p = 8;
    const hx = Math.max(6, r.left - p), hy = Math.max(6, r.top - p), hw = Math.max(0, Math.min(W - 6, r.right + p) - hx), hh = Math.max(0, Math.min(H - 6, r.bottom + p) - hy);
    sig = [hx, hy, hw, hh, W, H, th].map(Math.round).join(',');
    if (sig !== tourSig) {
      Object.assign(hole.style, { left: hx + 'px', top: hy + 'px', width: hw + 'px', height: hh + 'px' });
      const B = tourEl.querySelectorAll('.tour-block');
      [[0, 0, W, hy], [0, hy + hh, W, H - hy - hh], [0, hy, hx, hh], [hx + hw, hy, W - hx - hw, hh], [hx, hy, hw, hh]].forEach(([l, t, w, h], k) => Object.assign(B[k].style, { left: l + 'px', top: t + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' }));
    }
    const room = H - (hy + hh) - tourSafe;
    y = room >= th + 22 ? hy + hh + 14 : hy >= th + 22 ? hy - th - 14 : H - th - 14 - tourSafe;   // below, above, or over the bottom of a tall target
    x = Math.min(W - tipW - 12, Math.max(12, hx + hw / 2 - tipW / 2));
  }
  tip.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  if (sig === tourSig) tourStable++; else { tourStable = 0; tourSig = sig }
  if (tourEl.classList.contains('moving') && Date.now() > tourSettle && tourStable > 3) { tourEl.classList.remove('moving'); setTimeout(() => tourEl?.classList.remove('jump'), 320) }
  tourRaf = requestAnimationFrame(tourFollow);
}
setInterval(tourTick, 250);
addEventListener('keydown', e => { if (e.key === 'Escape' && tourEl?.classList.contains('on')) tourEnd() });

/* ---------- boot ---------- */
async function enter(session) {
  S.user = session.user;
  try {
    let fid = (await q(sb.from('family_members').select('family_id').eq('user_id', S.user.id).limit(1)))[0]?.family_id;
    if (!fid) fid = await q(sb.rpc('accept_invites'));
    if (!fid) { S.onboard = { step: 'family', name: '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver', pin: '', kids: [], cur: null, jobs: null }; S.view = 'onboard'; return render() }
    S.family = { id: fid }; await loadAll(); pushRefresh();
    const fresh = store.get('signed-in') !== S.user.id; store.set('signed-in', S.user.id); S.canResetPin = fresh;
    const p = store.get('profile');
    if (fresh || !S.family.pin_hash) { S.parentOk = false; S.view = 'who'; render(); if (!S.family.pin_hash) newPinSheet(true); return }
    if (p && (p === 'parent' ? S.parentOk : kidById(p))) setProfile(p); else S.view = 'who';
    render();
  } catch (e) { console.error(e); S.view = 'auth'; render(); toast(errMsg(e)) }
}
let entered = null;
sb.auth.onAuthStateChange((ev, session) => {
  if (session && entered !== session.user.id) { entered = session.user.id; enter(session) }
  if (!session && ev === 'SIGNED_OUT') { entered = null; S.view = 'auth'; render() }
});
sb.auth.getSession().then(({ data }) => { if (!data.session) { S.view = 'auth'; render() } });
render();

/* Tap a ? to show or hide its explanation. */
document.addEventListener('click', e => {
  const b = e.target.closest('.tip'); if (!b) return;
  const box = b.closest('.field')?.querySelector('.tipbox'); if (!box) return;
  e.preventDefault(); box.hidden = !box.hidden; b.setAttribute('aria-expanded', String(!box.hidden));
});

/* When a kid's bank goes up: count up to the new balance and drop coins into the card.
   When it goes down (a withdrawal or purchase): count down. The goal bar grows to its new spot.
   Remembers the last balance per kid on this device, so it only plays when something changed. */
let bankAnimUntil = 0;
function bankAnim(kid) {
  const el = $('bankBig'); if (!kid || !el) return;
  const now = stats(kid).bank, key = 'bal-' + kid.id, raw = store.get(key); store.set(key, String(now));
  app.querySelectorAll('.gmeter[data-gid]').forEach(m => { const pct = Number(m.dataset.pct), gkey = 'goal-' + m.dataset.gid, gRaw = store.get(gkey); store.set(gkey, String(pct));
    if (gRaw !== null && Number(gRaw) !== pct && !reduceMotion()) { const bar = m.querySelector('i'); bar.style.width = gRaw + '%'; requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = pct + '%' })) } });
  if (raw === null) return;
  const prev = Number(raw); if (!isFinite(prev) || Math.abs(prev - now) < .005 || reduceMotion()) return;
  const t0 = performance.now(), D = 1100; if (now > prev) bankAnimUntil = Date.now() + 1700;
  (function step(t) { const p = Math.min(1, (t - t0) / D), e = 1 - (1 - p) ** 3; el.textContent = money(r2(prev + (now - prev) * e)); if (p < 1) requestAnimationFrame(step); else { el.textContent = money(now); el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 500) } })(t0);
  if (now > prev) { const hero = el.closest('.hero'); for (let i = 0; i < 3; i++) { const c = document.createElement('span'); c.className = 'coin-drop'; c.style.setProperty('--x', (52 + i * 14) + '%'); c.style.setProperty('--d', (i * 0.16) + 's'); c.innerHTML = coinSVG(); hero.appendChild(c); setTimeout(() => c.remove(), 1900) } }
}
