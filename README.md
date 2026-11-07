# Paper Pig

A free web app for families: a weekly allowance, a job board with prices, a reading log that earns screen minutes, and a weekend screen clock that can't be paused.

- **Parents** sign in with just an email (a 6-digit code or magic link, no password), and answer a few quick questions: each kid's name, allowance, screen time and screen days, then which jobs each kid can do.
- **Kids** sign in on the same email, pick their profile, and see their week: the allowance, every job and bonus with the reason, what's in their bank, and what's been withdrawn or spent.
- **A bank for each kid.** Every Monday the kid earns their allowance, plus any jobs and bonuses. It all builds up as a balance in their bank. Money only comes out when you record a withdrawal (cash or a transfer) or a purchase you made for them with their money. Every entry needs an explanation. Nothing is taken away as a punishment unless you turn on the optional jar (below).

The site is plain HTML, CSS and JavaScript with no build step. It's hosted on Netlify, and Supabase handles sign-in and the database.

---

## Setup (about 15 minutes)

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), sign up and create a **new project**. The free plan works.
2. Open **SQL Editor → New query**, paste everything in [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.
4. Paste both into [`config.js`](config.js). The anon key is meant to be public, because the database rules in `schema.sql` keep each family's data private.

### 2. Turn on sign-in codes

1. **Authentication → Providers → Email**: make sure Email is enabled. Leave "Confirm email" on.
2. **Authentication → Email Templates → Magic Link**: replace the body with this, so parents get a code they can type on any device (handy for a kid's iPad):

   ```html
   <h2>Your Paper Pig sign-in code</h2>
   <p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
   <p>Or tap to sign in on this device: <a href="{{ .ConfirmationURL }}">Sign in</a></p>
   <p>If you didn't ask for this, you can ignore it.</p>
   ```

   Make the same change to the **Confirm signup** template, which a parent receives the very first time.
3. **Authentication → URL Configuration**: set **Site URL** to your Netlify address (for example `https://paperpig.app`) and add it under **Redirect URLs**.

### 3. Set up real email before you share it (important)

Supabase's built-in email is for testing only: it sends just a few emails per hour, and only to people on your Supabase team. Before sharing the link, send sign-in emails through Resend (free tier: 3,000 emails a month).

1. Make a free [Resend](https://resend.com) account, add a domain you own, and add the DNS records Resend shows you. Wait until the domain shows **Verified**.
2. In Resend, create an **API key** (Sending access is enough).
3. In Supabase: **Project Settings → Authentication → SMTP Settings → Enable custom SMTP**
   - Host `smtp.resend.com`, port `465`
   - Username `resend`
   - Password: the Resend API key
   - Sender email: an address on your verified domain, like `hello@yourdomain.com`. Sender name: `Paper Pig`
4. Under **Authentication → Rate Limits**, set emails to around 30 per hour.

(Alternative with no new account: use a Gmail or Google Workspace address with an app password. Host `smtp.gmail.com`, port `465`.)

### 4. Deploy on Netlify

Feedback (Settings → Contact & feedback, the chat button, or Feedback on the sign-in screen) is emailed to `NOTIFY_EMAIL` through Resend by the Netlify function `feedback`, so it works once invites and member alerts are set up. Reply to the email to answer the sender (when they typed their address). To send feedback somewhere else, set `FEEDBACK_EMAIL`. Check it at `/.netlify/functions/feedback`: it should say `{"email":true}`. If the email ever fails, the app falls back to **Netlify Forms** (messages under **Forms → feedback**).


1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import an existing project → GitHub →** pick this repo.
3. Leave the build command empty. The publish directory is `.` (already set in `netlify.toml`). Click **Deploy**.
4. Optional: **Domain settings** to add your own domain. Update the Supabase Site URL if you do.

That's it. Visit the site, sign in with your email, and set up your family.

### 5. Timer alerts (ring with the app closed)

This uses the same secret as step 6, so set that up too (or at least its secret, Vault entry and `JOINED_HOOK_SECRET`).

1. **Supabase → Integrations → Cron**: turn it on. (Database → Extensions: `pg_net` should be on too.)
2. Visit `https://<your site>/.netlify/functions/ring?new-keys`. Copy the two values into **Netlify → Environment variables** (scope: Functions): `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Keep the private one secret. Redeploy.
3. **Supabase → SQL Editor:** run `schema.sql` again. It adds the device table and checks for finished timers every second.
4. Visit `/.netlify/functions/ring`: it should say `"ready":true`. Then on a phone, Settings → **Timer alerts**.

Check it's running: `select * from cron.job_run_details where command like '%pp_ring_due%' order by start_time desc limit 5;` If you change the site's address, change `paperpig.app` in `pp_ring_due` in `schema.sql`.

### 6. Optional: get an email and a sheet row when someone joins

1. Make up a long random secret (one is enough for everything below).
2. **Google Sheet:** make a sheet, then **Extensions → Apps Script**, paste [`tools/members-sheet.gs`](tools/members-sheet.gs), Save. **Project Settings → Script properties → Add**: `SECRET` = your secret. **Deploy → New deployment → Web app**, Execute as **Me**, Who has access **Anyone** → Deploy → copy the Web app URL.
3. **Netlify → Environment variables** (scope: Functions): `JOINED_HOOK_SECRET` = your secret, `NOTIFY_EMAIL` = where the alerts go, `SHEET_WEBHOOK_URL` = the Web app URL, and optionally `SHEET_URL` = the sheet's link (a button in the email). Redeploy. Visiting `/.netlify/functions/joined` shows what's set.
4. **Supabase → SQL Editor:** run `schema.sql` again (it adds the trigger), then `select vault.create_secret('your secret', 'pp_hook_secret');`
5. Optional, to list the people who joined before: `select public.pp_announce_member(family_id, user_id, true) from public.family_members order by created_at;` (sheet rows only, no emails).

---

## How it works

| Thing | Rule |
|---|---|
| Week | Monday to Sunday in the family's time zone (set in Settings). |
| Allowance | Each Monday a kid's week starts at their weekly allowance. A change counts from the current week. |
| Setup | One question per screen: family name, parent PIN, then for each kid their name and color, weekly allowance, screen minutes a week and screen days. Last comes a starter job list to keep, edit, delete or add to. With two or more kids, each job has a checkbox per kid. |
| Job list | One list for the family. With two or more kids, each job shows a checkbox per kid: everyone checked sees it on their board and can do it and get paid. Tap a job to edit it right in the list (name, what done means, pay, screen bonus, group); changes save as you type. Delete takes a second tap to confirm. A kid added later gets the jobs the other kids all share. **More job ideas** adds suggestions with one tap. |
| Jobs | The kid taps a job and **I did it**. It waits under **Needs your OK** (with a badge) until a parent taps **OK** or **Not yet**. Parents can also log a job directly. A job can also carry bonus screen minutes. |
| Bonuses | **Add bonus**: money or screen minutes, always with an explanation the kid can see. |
| Savings goals | Up to 10 per kid, each with a name and a price. **Move money** takes money out of the bank and keeps it in a goal (or moves it between goals, or back). The big **In your bank** number is what's left to spend; saved money is shown separately. Kids manage their own goals; parents see and manage them from the kid's card. **Settings → Lock savings** lets kids save but not move money back to the bank. When a goal is reached, the parent taps **Bought it** and the purchase comes out of that goal. Withdrawals and the jar only take from the bank. |
| Bank balance | Each kid's card shows what's banked and the last withdrawal. After two weeks with no withdrawal, a reminder with **Withdraw** appears (not while the kid is saving toward a goal). |
| Withdrawals | **Ledger → Money → Withdraw cash**: type the amount you handed over and an explanation. It comes out of the kid's bank. |
| Purchases | **Bank → Bought something**: what you bought for them with their money, with an explanation. You can't go below their balance. |
| Ledger | **Ledger** tab, per kid: Money (every allowance, job, bonus, payment and purchase, with running balance), Screen time and Reading (every session, manual entry and bonus minutes, week by week). Tap any entry to edit its amount, explanation, time or day, or delete it. Adding time lets you pick the day of the week. |
| Optional jar | Off by default. Turn it on in **Settings** and give it your family's name for it (Oops Jar, Swear Jar, Not-Nice Bucket…). Each kid card then gets a jar button for small take-aways of money or screen minutes. It suggests 10¢ to 25¢ or 1 to 5 minutes; taking all of it is possible but is a separate, deliberate tap. Every entry needs a reason, shows in both ledgers, and can be edited or deleted. The kid's **How it works** explains the jar while it's on. |
| Totals per kid | Bank balance, this week, this month, lifetime earned, withdrawn, and spent. Each entry shows the running balance, like a bank statement. |
| Reading | The kid starts a timer and types the book, and can pause and resume it. Time is kept to the second, so 10:40 + 10:20 = 21 minutes, and each full minute adds a screen minute that week, up to the kid's limit. A forgotten timer stops itself. Parents can add reading by hand. |
| Screen time | Base minutes plus reading minutes, used on the kid's screen days. The clock counts down the week's time to the second and can be paused. It stops itself at zero. Parents can add screen time used by hand (it counts this week). Time is only taken away through the optional jar. Base minutes, screen days and reading limit are in **Settings → Screen time**. |
| Timers | Reading and screens can each run as a **stopwatch** or a **timer**. Timers come in 5-minute steps; for screens, never more than what's left, plus that exact amount (22 min left offers 5, 10, 15, 20, 22). At zero the session stops at exactly that length, so exactly that much is used, even if no one has the app open (the database checks every second) or a grown-up is looking at their side. If the kid's screen is open, an alarm rings until it's turned off. Each kid's last choice is remembered. While the app is open, the screen stays awake and the alarm rings in the app. With **Timer alerts** on (below), the device also rings when the app is closed or the screen is locked. |
| Timer alerts | On by default: the first timer started on a phone, tablet or computer asks to allow notifications (browsers only ask after a tap), and once allowed it stays on. **Settings → Timer alerts** turns it off or back on for that device. When any kid's timer runs out, every device that turned it on gets a "Time's up!" notification with its own notification sound, within a few seconds, even with the app closed or the screen locked. It's one notification per timer (a website can't loop a sound or pick its own). iPhone and iPad need the home-screen app (iOS 16.4 or later); silent mode and Do Not Disturb mute it, like any notification. Coming back to the app afterwards shows the alarm card without ringing again. Setup: below. |
| Get the app | Not in any app store: it installs from the browser. iPhone/iPad: Safari → Share → **Add to Home Screen**. Android: Chrome menu → **Install app**. Computers: Chrome/Edge install icon in the address bar. **Get the app** (sign-in screen, Who's here, Settings) shows the steps for the device, or installs in one tap where the browser allows it. `sw.js` lets it open without a connection. |
| Tour | Right after setup, a guided tour highlights the parent dashboard (kid card, quick actions, savings, Jobs, Ledger, Settings), has the parent tap **Switch** and open a kid, then walks through the kid's side (bank, jobs, reading, screens, savings, ledger). Skip any time; **Settings → Take the tour again** replays it. |
| Parent PIN | Kids share the parent's sign-in, so parent tools sit behind a 4-digit PIN. After signing in fresh with the email code, a parent can reset a forgotten PIN. |
| Second parent | Settings → **Parents and guardians → Send invite** emails them a link (via a Netlify function and Resend). They sign in with that email and join automatically. **Send again** re-sends it. Needs `RESEND_API_KEY` set in Netlify's environment variables. |
| Delete | Settings → **Delete account and all data** removes the family and the login. |
| Member alerts | When anyone joins (a new family, or a parent accepting an invite), the database posts them to the Netlify function `joined`, which emails the owner and updates the members Google Sheet: one row per family on a Families tab, with every parent on that row. Setup: below. |
| Feedback | Settings → **Report a bug / Request a feature / Say hi**, or **Contact** on the sign-in screen. Emailed to the owner (function `feedback`, Resend), with Netlify Forms as the backup. |

## Files

```
index.html            page shell
styles.css            all styles (light + dark)
app.js                the app
jobs.js               job ideas (58 jobs; the 15 marked on make the starter list)
config.js             your Supabase URL/key, app name, Venmo + Cash App handles
privacy.html          privacy page
supabase/schema.sql   database tables, security rules and functions
netlify.toml          Netlify settings and security headers
netlify/functions/    invite.js (invite emails), joined.js (new member alerts), feedback.js, ring.js (timer alerts)
package.json          the one thing the functions need: web-push (Netlify installs it)
tools/members-sheet.gs  Apps Script for the members Google Sheet
```

To rename the app, change `appName` in `config.js` and the `<title>`/manifest text. To change the donation handles, edit `venmo`, `cashapp` and `paypal` in `config.js`.

## Support

Paper Pig is free. If it helps your family: **Venmo [@mike-shai](https://venmo.com/u/mike-shai)** · **Cash App [$mikeshai](https://cash.app/$mikeshai)** · **PayPal [mikeshai](https://www.paypal.com/paypalme/mikeshai)**
