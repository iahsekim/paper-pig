-- Paper Pig database schema for Supabase.
-- Run once in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- Every table is scoped to a family. Row Level Security makes sure a signed-in
-- parent can only ever read or write rows for the family they belong to.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Our family' check (char_length(name) <= 60),
  timezone    text not null default 'America/Denver',
  pin_hash    text,
  created_at  timestamptz not null default now()
);

create table if not exists public.family_members (
  family_id   uuid not null references public.families on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  email       text,
  created_at  timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table if not exists public.family_invites (
  family_id   uuid not null references public.families on delete cascade,
  email       text not null check (char_length(email) <= 254),
  created_at  timestamptz not null default now(),
  primary key (family_id, email)
);

create table if not exists public.kids (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null references public.families on delete cascade,
  name                text not null check (char_length(name) between 1 and 40),
  color               text not null default 'green',
  weekly_allowance    numeric(8,2) not null default 5 check (weekly_allowance >= 0 and weekly_allowance <= 1000),
  base_screen_minutes int not null default 100 check (base_screen_minutes between 0 and 2000),
  reading_cap         int not null default 60 check (reading_cap between 0 and 2000),
  max_read_session    int not null default 60 check (max_read_session between 5 and 240),
  screen_days         int[] not null default '{6,0}',
  start_week          date not null,
  goal_name           text check (char_length(goal_name) <= 60),
  goal_amount         numeric(8,2) check (goal_amount > 0 and goal_amount <= 100000),
  created_at          timestamptz not null default now()
);

create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid references public.kids on delete cascade,
  kid_ids     uuid[] not null default '{}',
  title       text not null check (char_length(title) between 1 and 80),
  done_means  text not null default '' check (char_length(done_means) <= 160),
  category    text not null default 'Around the house' check (char_length(category) <= 40),
  price       numeric(8,2) not null default 1 check (price >= 0 and price <= 1000),
  enabled     boolean not null default true,
  sort        int not null default 0,
  bonus_minutes int not null default 0 check (bonus_minutes between 0 and 240),
  created_at  timestamptz not null default now()
);

-- One row per kid per week. "allowance" is fixed when the week starts (Monday).
-- paid_at / paid_total are unused (kept for older installs); payments live in transactions.
create table if not exists public.weeks (
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  week_start  date not null,
  allowance   numeric(8,2) not null default 0 check (allowance >= 0),
  paid_at     timestamptz,
  paid_total  numeric(10,2),
  primary key (kid_id, week_start)
);

-- Money in: completed jobs and bonuses. Amounts are always positive.
create table if not exists public.credits (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  week_start  date not null,
  kind        text not null check (kind in ('job','bonus')),
  title       text not null check (char_length(title) between 1 and 120),
  amount      numeric(8,2) not null check (amount > 0 and amount <= 1000),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  -- 'pending' = the kid tapped "I did it" and a parent hasn't approved yet. Only 'approved' counts.
  status      text not null default 'approved' check (status in ('approved','pending')),
  minutes     int not null default 0 check (minutes between 0 and 600),
  job_id      uuid references public.jobs on delete set null
);

-- Money out of a kid's balance: cash or a transfer the parent handed over ('payout'),
-- or something the parent bought for the kid with their money ('purchase').
-- Every entry needs an explanation. There is no way to take money away as a punishment.
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  kind        text not null check (kind in ('payout','purchase')),
  amount      numeric(8,2) not null check (amount > 0 and amount <= 10000),
  note        text not null check (char_length(trim(note)) between 1 and 120),
  local_date  date not null,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

create table if not exists public.reading_sessions (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families on delete cascade,
  kid_id        uuid not null references public.kids on delete cascade,
  book          text not null check (char_length(book) between 1 and 100),
  local_date    date not null,
  week_start    date not null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  -- seconds saved so far; while running, add the time since running_since. Null running_since = paused.
  seconds       int not null default 0 check (seconds between 0 and 36000),
  running_since timestamptz,
  source        text not null default 'timer' check (source in ('timer','manual')),
  minutes       int not null default 0
);

create table if not exists public.screen_sessions (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families on delete cascade,
  kid_id        uuid not null references public.kids on delete cascade,
  local_date    date not null,
  week_start    date not null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  seconds       int not null default 0 check (seconds between 0 and 36000),
  running_since timestamptz,
  source        text not null default 'clock' check (source in ('clock','manual')),
  note          text check (char_length(note) <= 120),
  minutes       int not null default 0
);

-- Extra screen minutes a parent gives, always with an explanation.
create table if not exists public.screen_bonus (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  week_start  date not null,
  minutes     int not null check (minutes between 1 and 600),
  note        text not null check (char_length(trim(note)) between 1 and 120),
  created_at  timestamptz not null default now()
);

-- Optional countdown timers: when set, the session stops by itself (and the app rings) at this length.
alter table public.reading_sessions add column if not exists target_seconds int check (target_seconds is null or target_seconds between 60 and 36000);
alter table public.screen_sessions  add column if not exists target_seconds int check (target_seconds is null or target_seconds between 60 and 36000);

-- Optional "oops jar": small deductions of money or screen minutes, always with a reason.
-- Off for every family unless a parent turns it on in Settings, and the family picks its name.
alter table public.families add column if not exists penalty_enabled boolean not null default false;
alter table public.families add column if not exists penalty_name text not null default 'Oops Jar';
create table if not exists public.penalties (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  local_date  date not null,
  week_start  date not null,
  amount      numeric(8,2) not null default 0 check (amount >= 0),
  minutes     int not null default 0 check (minutes between 0 and 600),
  note        text not null check (char_length(trim(note)) between 1 and 120),
  created_at  timestamptz not null default now(),
  check (amount > 0 or minutes > 0)
);

-- Older versions used this to take minutes away. The app no longer does that; kept so upgrades don't fail.
create table if not exists public.screen_adjust (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  week_start  date not null,
  minutes     int not null check (minutes between 1 and 600),
  note        text not null default 'Screens without the clock' check (char_length(note) <= 120),
  created_at  timestamptz not null default now()
);

-- Savings goals: up to 10 per kid. Moving money into a goal takes it out of the kid's bank (what they can spend)
-- and keeps it for that goal; the money is still the kid's. A goal's balance = moves in - moves out - purchases from it.
create table if not exists public.savings_goals (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 40),
  emoji       text not null default '' check (char_length(emoji) <= 16),
  target      numeric(8,2) check (target is null or (target > 0 and target <= 100000)),
  sort        int not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
-- from_goal / to_goal null = the bank.
create table if not exists public.savings_moves (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  from_goal   uuid references public.savings_goals on delete cascade,
  to_goal     uuid references public.savings_goals on delete cascade,
  amount      numeric(8,2) not null check (amount > 0 and amount <= 100000),
  by_role     text not null default 'kid' check (by_role in ('kid','parent')),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  check (from_goal is distinct from to_goal)
);
-- A purchase can be paid from a goal instead of the bank.
alter table public.transactions add column if not exists goal_id uuid references public.savings_goals on delete set null;
-- When on, kids can put money into goals and move it between goals, but only a parent/guardian can move it back to the bank.
alter table public.families add column if not exists savings_locked boolean not null default false;
create index if not exists goals_kid on public.savings_goals (kid_id);
create index if not exists moves_kid on public.savings_moves (kid_id);


-- Upgrades for databases created from an earlier version of this file (safe to re-run).
alter table public.reading_sessions add column if not exists seconds int not null default 0;
alter table public.reading_sessions add column if not exists running_since timestamptz;
alter table public.reading_sessions add column if not exists source text not null default 'timer';
alter table public.screen_sessions add column if not exists seconds int not null default 0;
alter table public.screen_sessions add column if not exists running_since timestamptz;
alter table public.screen_sessions add column if not exists ended_at timestamptz;
alter table public.screen_sessions add column if not exists source text not null default 'clock';
alter table public.screen_sessions add column if not exists note text;
alter table public.screen_sessions alter column minutes set default 0;
alter table public.screen_sessions drop constraint if exists screen_sessions_minutes_check;
alter table public.reading_sessions drop constraint if exists reading_sessions_minutes_check;
alter table public.credits add column if not exists status text not null default 'approved';
alter table public.credits add column if not exists minutes int not null default 0;
alter table public.credits add column if not exists job_id uuid references public.jobs on delete set null;
alter table public.jobs add column if not exists bonus_minutes int not null default 0;
alter table public.kids add column if not exists goal_name text;
alter table public.kids add column if not exists goal_amount numeric(8,2);

-- Earlier versions had one saving goal on the kid. It becomes their first savings goal (starting at $0, so no balance moves).
insert into public.savings_goals (family_id, kid_id, name, target)
  select k.family_id, k.id, left(trim(k.goal_name), 40), k.goal_amount from public.kids k
   where coalesce(trim(k.goal_name), '') <> '' and not exists (select 1 from public.savings_goals g where g.kid_id = k.id);
update public.kids set goal_name = null, goal_amount = null where goal_name is not null;

-- Shared jobs: one job list per family. kid_ids says which kids see each job on their board,
-- and every kid listed can do it and get paid. (Earlier versions kept a separate copy per kid in kid_id.)
alter table public.jobs add column if not exists kid_ids uuid[] not null default '{}';
alter table public.jobs alter column kid_id drop not null;

-- Merge the per-kid copies from earlier versions into one shared job (safe to re-run: only old rows are touched).
do $$
begin
  if exists (select 1 from public.jobs where kid_id is not null) then
    create temp table job_merge on commit drop as
      select j.id, j.kid_id, j.enabled,
             first_value(j.id) over (partition by j.family_id, lower(trim(j.title)) order by j.enabled desc, j.sort, j.created_at, j.id) as keep_id
        from public.jobs j where j.kid_id is not null;
    update public.jobs j
       set kid_ids = coalesce((select array_agg(distinct m.kid_id) from job_merge m where m.keep_id = j.id and m.enabled), '{}')
     where j.id in (select keep_id from job_merge);
    update public.credits c set job_id = m.keep_id from job_merge m where c.job_id = m.id and m.id <> m.keep_id;
    delete from public.jobs where id in (select id from job_merge where id <> keep_id);
    -- Jobs no kid had switched on were only suggestions; they live in the app's ideas list now.
    update public.credits set job_id = null where job_id in (select id from public.jobs where kid_id is not null and kid_ids = '{}');
    delete from public.jobs where kid_id is not null and kid_ids = '{}';
    update public.jobs set kid_id = null, enabled = true where kid_id is not null;
  end if;
end $$;

-- When a kid is removed, take them off every job.
create or replace function public.jobs_drop_kid()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.jobs set kid_ids = array_remove(kid_ids, old.id) where family_id = old.family_id and old.id = any(kid_ids);
  return old;
end $$;
drop trigger if exists kids_drop_from_jobs on public.kids;
create trigger kids_drop_from_jobs after delete on public.kids for each row execute function public.jobs_drop_kid();

create index if not exists jobs_family on public.jobs (family_id);
create index if not exists credits_kid on public.credits (kid_id, week_start);
create index if not exists tx_kid on public.transactions (kid_id);
create index if not exists reading_kid on public.reading_sessions (kid_id, week_start);
create index if not exists screen_kid on public.screen_sessions (kid_id, week_start);
create index if not exists members_user on public.family_members (user_id);

-- ---------------------------------------------------------------- helpers

create or replace function public.my_family_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select family_id from public.family_members where user_id = auth.uid()
$$;

-- First sign-in: make a family and add the caller as its first parent.
create or replace function public.create_family(p_name text, p_tz text)
returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select family_id into fid from public.family_members where user_id = auth.uid() limit 1;
  if fid is not null then return fid; end if;
  insert into public.families (name, timezone)
    values (coalesce(nullif(trim(p_name), ''), 'Our family'), coalesce(nullif(p_tz, ''), 'America/Denver'))
    returning id into fid;
  insert into public.family_members (family_id, user_id, email) values (fid, auth.uid(), auth.email());
  return fid;
end $$;

-- A second parent signs in with an invited email and joins that family.
create or replace function public.accept_invites()
returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then return null; end if;
  select family_id into fid from public.family_invites where lower(email) = lower(auth.email()) order by created_at limit 1;
  if fid is null then return null; end if;
  insert into public.family_members (family_id, user_id, email) values (fid, auth.uid(), auth.email()) on conflict do nothing;
  delete from public.family_invites where lower(email) = lower(auth.email());
  return fid;
end $$;

-- Delete everything: the family, its kids and history, and the caller's login.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.families f
   where f.id in (select family_id from public.family_members where user_id = auth.uid());
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.my_family_ids() from public, anon;
revoke all on function public.create_family(text, text) from public, anon;
revoke all on function public.accept_invites() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.my_family_ids() to authenticated;
grant execute on function public.create_family(text, text) to authenticated;
grant execute on function public.accept_invites() to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------- row level security

alter table public.families         enable row level security;
alter table public.family_members   enable row level security;
alter table public.family_invites   enable row level security;
alter table public.kids             enable row level security;
alter table public.jobs             enable row level security;
alter table public.weeks            enable row level security;
alter table public.credits          enable row level security;
alter table public.transactions     enable row level security;
alter table public.reading_sessions enable row level security;
alter table public.screen_sessions  enable row level security;
alter table public.screen_adjust    enable row level security;
alter table public.screen_bonus     enable row level security;
alter table public.penalties        enable row level security;
alter table public.savings_goals    enable row level security;
alter table public.savings_moves    enable row level security;

drop policy if exists fam_select on public.families;
drop policy if exists fam_update on public.families;
create policy fam_select on public.families for select to authenticated using (id in (select public.my_family_ids()));
create policy fam_update on public.families for update to authenticated using (id in (select public.my_family_ids())) with check (id in (select public.my_family_ids()));

drop policy if exists mem_select on public.family_members;
create policy mem_select on public.family_members for select to authenticated using (family_id in (select public.my_family_ids()));
-- Any parent/guardian can remove another one from the family (never themselves, so a family is never left empty).
drop policy if exists mem_delete on public.family_members;
create policy mem_delete on public.family_members for delete to authenticated
  using (family_id in (select public.my_family_ids()) and user_id <> auth.uid());

drop policy if exists inv_all on public.family_invites;
create policy inv_all on public.family_invites for all to authenticated
  using (family_id in (select public.my_family_ids())) with check (family_id in (select public.my_family_ids()));

do $$
declare t text;
begin
  foreach t in array array['kids','jobs','reading_sessions','screen_sessions','screen_adjust','screen_bonus','penalties','savings_goals','savings_moves'] loop
    execute format('drop policy if exists fam_all on public.%I', t);
    execute format('create policy fam_all on public.%I for all to authenticated using (family_id in (select public.my_family_ids())) with check (family_id in (select public.my_family_ids()))', t);
  end loop;
end $$;

-- Weeks: read, create, and mark paid. Never deleted from the app.
drop policy if exists wk_select on public.weeks;
drop policy if exists wk_insert on public.weeks;
drop policy if exists wk_update on public.weeks;
create policy wk_select on public.weeks for select to authenticated using (family_id in (select public.my_family_ids()));
create policy wk_insert on public.weeks for insert to authenticated with check (family_id in (select public.my_family_ids()));
create policy wk_update on public.weeks for update to authenticated using (family_id in (select public.my_family_ids())) with check (family_id in (select public.my_family_ids()));

-- Credits and transactions: read, add, and undo (delete) a mistake. No edits, so amounts can't be changed later.
do $$
declare t text;
begin
  foreach t in array array['credits','transactions'] loop
    execute format('drop policy if exists cr_select on public.%I', t);
    execute format('drop policy if exists cr_insert on public.%I', t);
    execute format('drop policy if exists cr_delete on public.%I', t);
    execute format('create policy cr_select on public.%I for select to authenticated using (family_id in (select public.my_family_ids()))', t);
    execute format('create policy cr_insert on public.%I for insert to authenticated with check (family_id in (select public.my_family_ids()))', t);
    execute format('create policy cr_delete on public.%I for delete to authenticated using (family_id in (select public.my_family_ids()))', t);
  end loop;
end $$;

-- Parents can edit any entry from the Ledger (fix an amount, explanation or day).
-- Money amounts still can't be negative; the checks on each table enforce that.
drop trigger if exists credits_only_approve on public.credits;
drop function if exists public.credits_only_approve();
drop policy if exists cr_update on public.credits;
drop policy if exists cr_update on public.transactions;
create policy cr_update on public.credits for update to authenticated using (family_id in (select public.my_family_ids())) with check (family_id in (select public.my_family_ids()));
create policy cr_update on public.transactions for update to authenticated using (family_id in (select public.my_family_ids())) with check (family_id in (select public.my_family_ids()));

-- ---------------------------------------------------------------- new member alerts
-- Whenever someone joins (a new family, or a parent/guardian accepting an invite), the database posts the
-- new member to the Netlify function /.netlify/functions/joined, which emails the owner and adds a row to
-- the members Google Sheet. Nothing leaves the database until the shared secret is saved in Supabase Vault
-- (it is never written in this file). Run once in the SQL editor, with the same secret as Netlify's
-- JOINED_HOOK_SECRET:
--   select vault.create_secret('<the secret>', 'pp_hook_secret');
-- To add the people who joined before this existed to the sheet (no emails are sent for them):
--   select public.pp_announce_member(family_id, user_id, true) from public.family_members order by created_at;
do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net is not available here: %', sqlerrm; end $$;

create or replace function public.pp_announce_member(p_family uuid, p_user uuid, p_backfill boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  sec text; fam public.families%rowtype; mem public.family_members%rowtype; n int;
begin
  select decrypted_secret into sec from vault.decrypted_secrets where name = 'pp_hook_secret' limit 1;
  if sec is null or sec = '' then return; end if;
  select * into fam from public.families where id = p_family;
  select * into mem from public.family_members where family_id = p_family and user_id = p_user;
  if mem.user_id is null then return; end if;
  -- the first member of a family made it; anyone after that joined through an invite
  select count(*) into n from public.family_members where family_id = p_family and created_at <= mem.created_at;
  perform net.http_post(
    url := 'https://paperpig.app/.netlify/functions/joined',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-pp-hook', sec),
    body := jsonb_build_object(
      'kind', case when n <= 1 then 'new family' else 'joined a family' end,
      'email', mem.email, 'user_id', mem.user_id, 'family', fam.name, 'family_id', fam.id,
      'members', n, 'timezone', fam.timezone, 'joined_at', mem.created_at, 'backfill', p_backfill),
    timeout_milliseconds := 5000);
exception when others then
  -- an alert must never stop anyone from signing up
  raise warning 'pp_announce_member: %', sqlerrm;
end $$;

create or replace function public.family_members_announce()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.pp_announce_member(new.family_id, new.user_id, false);
  return new;
end $$;

drop trigger if exists family_members_announce on public.family_members;
create trigger family_members_announce after insert on public.family_members
  for each row execute function public.family_members_announce();

-- only the database itself (and you, in the SQL editor) can send an alert
revoke all on function public.pp_announce_member(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.family_members_announce() from public, anon, authenticated;

-- ---------------------------------------------------------------- timer alerts (ring with the app closed)
-- A phone or tablet that turns on "Timer alerts" saves its push address here. Every 5 seconds the database
-- looks for reading and screen timers that just ran out and asks the Netlify function /.netlify/functions/ring
-- to send a "Time's up!" notification to every device in that family. Like a kitchen timer, it keeps ringing:
-- again every 10 seconds, for up to 2 minutes, until someone taps the notification or the timer is stopped. It uses the same shared secret as the
-- member alerts (pp_hook_secret in Vault). Needs Cron: if this part says Cron is missing, turn it on in
-- Supabase (Integrations > Cron) and run this file again.
create table if not exists public.push_subs (
  endpoint    text primary key check (char_length(endpoint) between 10 and 1000),
  family_id   uuid not null references public.families on delete cascade,
  user_id     uuid,
  p256dh      text not null check (char_length(p256dh) between 10 and 200),
  auth        text not null check (char_length(auth) between 8 and 100),
  label       text check (char_length(label) <= 80),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- No policies: the app only reaches this table through the two functions below.
alter table public.push_subs enable row level security;

-- Which due time the alerts are for, how many have gone out, and the token a tap uses to stop them.
alter table public.reading_sessions add column if not exists pushed_for timestamptz;
alter table public.screen_sessions  add column if not exists pushed_for timestamptz;
alter table public.reading_sessions add column if not exists rings smallint not null default 0;
alter table public.screen_sessions  add column if not exists rings smallint not null default 0;
alter table public.reading_sessions add column if not exists ring_token uuid;
alter table public.screen_sessions  add column if not exists ring_token uuid;
create index if not exists reading_running on public.reading_sessions (running_since) where ended_at is null and running_since is not null and target_seconds is not null;
create index if not exists screen_running on public.screen_sessions (running_since) where ended_at is null and running_since is not null and target_seconds is not null;

create or replace function public.pp_save_push(p_family uuid, p_endpoint text, p_p256dh text, p_auth text, p_label text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_family is null or not exists (select 1 from public.my_family_ids() f where f = p_family) then raise exception 'Not your family'; end if;
  if p_endpoint !~ '^https://' then raise exception 'That push address doesn''t look right'; end if;
  insert into public.push_subs (endpoint, family_id, user_id, p256dh, auth, label)
  values (p_endpoint, p_family, auth.uid(), p_p256dh, p_auth, left(p_label, 80))
  on conflict (endpoint) do update set family_id = excluded.family_id, user_id = excluded.user_id, p256dh = excluded.p256dh,
    auth = excluded.auth, label = excluded.label, updated_at = now();
end $$;

create or replace function public.pp_drop_push(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = p_endpoint and family_id in (select public.my_family_ids());
$$;

create or replace function public.pp_ring_due()
returns int language plpgsql security definer set search_path = public as $$
declare
  sec text; r record; subs jsonb; sent int := 0; k int; tok uuid; what text; len text;
begin
  select decrypted_secret into sec from vault.decrypted_secrets where name = 'pp_hook_secret' limit 1;
  if sec is null or sec = '' then return 0; end if;
  -- forget devices the push service says are gone (the ring function reports them back)
  begin
    delete from public.push_subs where endpoint in (
      select jsonb_array_elements_text(content::jsonb -> 'gone') from net._http_response
       where created > now() - interval '15 minutes' and content like '{"ring":%');
  exception when others then null; end;
  for r in
    with t as (
      select 'screen' as kind, s.id, s.family_id, s.kid_id, s.target_seconds as tgt, s.pushed_for, s.rings, s.ring_token,
             s.running_since + make_interval(secs => greatest(0, s.target_seconds - s.seconds)) as due
        from public.screen_sessions s
       where s.ended_at is null and s.running_since is not null and s.target_seconds is not null
      union all
      select 'read', s.id, s.family_id, s.kid_id, s.target_seconds, s.pushed_for, s.rings, s.ring_token,
             s.running_since + make_interval(secs => greatest(0, s.target_seconds - s.seconds))
        from public.reading_sessions s
       where s.ended_at is null and s.running_since is not null and s.target_seconds is not null
    )
    select t.*, k.name as kid from t join public.kids k on k.id = t.kid_id
     where t.due <= now() and t.due > now() - interval '10 minutes'
       -- the first ring, then one every 10 seconds: 12 in all (2 minutes), unless a tap stopped it (rings = 99)
       and (t.pushed_for is distinct from t.due or (t.rings < 12 and now() >= t.due + make_interval(secs => t.rings * 10)))
  loop
    k := case when r.pushed_for is distinct from r.due then 0 else r.rings end;
    tok := coalesce(r.ring_token, gen_random_uuid());
    if r.kind = 'screen' then update public.screen_sessions set pushed_for = r.due, rings = k + 1, ring_token = tok where id = r.id;
    else update public.reading_sessions set pushed_for = r.due, rings = k + 1, ring_token = tok where id = r.id; end if;
    select coalesce(jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'keys', jsonb_build_object('p256dh', p.p256dh, 'auth', p.auth))), '[]'::jsonb)
      into subs from public.push_subs p where p.family_id = r.family_id;
    if jsonb_array_length(subs) = 0 then continue; end if;
    len := case when r.tgt >= 3600 then (r.tgt / 3600)::text || ' hr' || case when (r.tgt % 3600) / 60 > 0 then ' ' || ((r.tgt % 3600) / 60)::text || ' min' else '' end
                else greatest(1, round(r.tgt / 60.0))::int::text || ' min' end;
    what := case when r.kind = 'screen' then r.kid || '’s ' || len || ' of screens are done.' else r.kid || ' read for ' || len || '!' end;
    perform net.http_post(
      url := 'https://paperpig.app/.netlify/functions/ring',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-pp-hook', sec),
      body := jsonb_build_object('title', 'Time’s up!', 'body', what || ' Tap to turn it off.', 'sid', r.id, 'tok', tok, 'n', k, 'subs', subs),
      timeout_milliseconds := 8000);
    sent := sent + 1;
  end loop;
  return sent;
exception when others then
  raise warning 'pp_ring_due: %', sqlerrm;
  return sent;
end $$;

-- Tapping (or, on Android, swiping away) the notification stops the ringing. The phone may not be signed in
-- at that moment, so it proves itself with the token that came with the notification instead.
create or replace function public.pp_ring_off(p_id uuid, p_token uuid)
returns void language sql security definer set search_path = public as $$
  update public.screen_sessions set rings = 99 where id = p_id and ring_token = p_token;
  update public.reading_sessions set rings = 99 where id = p_id and ring_token = p_token;
$$;

revoke all on function public.pp_ring_due() from public, anon, authenticated;
revoke all on function public.pp_save_push(uuid, text, text, text, text) from public, anon;
revoke all on function public.pp_drop_push(text) from public, anon;
grant execute on function public.pp_save_push(uuid, text, text, text, text) to authenticated;
grant execute on function public.pp_drop_push(text) to authenticated;
revoke all on function public.pp_ring_off(uuid, uuid) from public;
grant execute on function public.pp_ring_off(uuid, uuid) to anon, authenticated;

-- Check for finished timers every 5 seconds, and keep Cron's own log small.
do $$ begin create extension if not exists pg_cron; exception when others then raise notice 'Cron is not available here: %', sqlerrm; end $$;
do $$ begin
  perform cron.schedule('pp-ring', '5 seconds', 'select public.pp_ring_due()');
  perform cron.schedule('pp-cron-log-cleanup', '17 4 * * *', $c$delete from cron.job_run_details where end_time < now() - interval '1 day'$c$);
exception when others then
  raise notice 'Timer alerts need Cron. Turn it on in Supabase (Integrations > Cron), then run this file again. (%)', sqlerrm;
end $$;
