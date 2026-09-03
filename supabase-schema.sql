-- PyWebLib community schema (Supabase / Postgres).
-- Run this ONCE in your Supabase project: SQL Editor -> New query -> paste -> Run.
-- Security is enforced by the row-level-security (RLS) policies below, so the
-- public "anon" key is safe to ship in the client.

-- ============================ profiles ============================
-- One row per signed-in user, auto-created on first Google sign-in.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles readable by everyone" on public.profiles;
create policy "profiles readable by everyone"
  on public.profiles for select using (true);
drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
  on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Copy name + avatar from the Google account into a profile row on signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             split_part(coalesce(new.email, 'coder'), '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for anyone who signed in BEFORE this schema existed. The
-- trigger above only fires for NEW sign-ins, so already-created accounts need
-- this one-off pass, otherwise publishing fails (projects.author_id has no
-- matching profile). Safe to re-run.
insert into public.profiles (id, display_name, avatar_url)
select u.id,
       coalesce(u.raw_user_meta_data->>'full_name',
                u.raw_user_meta_data->>'name',
                split_part(coalesce(u.email, 'coder'), '@', 1)),
       u.raw_user_meta_data->>'avatar_url'
from auth.users u
on conflict (id) do nothing;

-- ============================ projects ============================
-- A shared program.
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  description text check (char_length(description) <= 280),
  code        text not null check (char_length(code) <= 50000),
  kind        text not null default 'python',   -- python | turtle | game
  vote_count  integer not null default 0,
  published   boolean not null default true,     -- false = a private draft (author only)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_votes_idx  on public.projects (vote_count desc, created_at desc);
create index if not exists projects_author_idx on public.projects (author_id);

alter table public.projects enable row level security;

-- Draft support: on databases created before this column existed, add it now (it
-- must exist before the read policy below, which references it). Existing rows
-- default to published = true, so nothing that was public becomes hidden.
alter table public.projects add column if not exists published boolean not null default true;

drop policy if exists "projects readable by everyone" on public.projects;
create policy "projects readable by everyone"
  on public.projects for select using (published or auth.uid() = author_id);
drop policy if exists "authenticated users publish" on public.projects;
create policy "authenticated users publish"
  on public.projects for insert with check (auth.uid() = author_id);
drop policy if exists "authors update own projects" on public.projects;
create policy "authors update own projects"
  on public.projects for update using (auth.uid() = author_id);
drop policy if exists "authors delete own projects" on public.projects;
create policy "authors delete own projects"
  on public.projects for delete using (auth.uid() = author_id);

-- A tiny JSON snapshot of the opening scene (sprite kinds + positions), captured
-- at publish time so the gallery shows a real preview without running Python.
alter table public.projects add column if not exists scene text;

-- A public view counter, bumped when someone plays or opens a program. Anyone
-- (even signed out) can add to it through increment_view() below, which is
-- security definer so it side-steps the author-only update policy, yet can ONLY
-- add one to the counter, nothing else.
alter table public.projects add column if not exists view_count integer not null default 0;

create or replace function public.increment_view(pid uuid)
returns void language sql security definer set search_path = public as $$
  update public.projects set view_count = view_count + 1 where id = pid;
$$;
grant execute on function public.increment_view(uuid) to anon, authenticated;

-- ============================ admins ============================
-- Who gets raised limits. Deliberately NOT a column on profiles: every signed-in
-- user may update their own profile row, and the anon key is public by design,
-- so an is_admin flag there could be flipped by anyone on themselves with one
-- REST call. This table has no policies and no grants, so it does not exist as
-- far as the API is concerned; rows are added from the SQL editor, which runs as
-- the owner. See supabase-migration-admins.sql.
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- Cap how many programs one person can save (drafts and published both count).
-- Enforced here because a client-side limit is trivially bypassed. To change the
-- cap, edit the number and re-run this block (keep PROGRAM_CAP in publish.js in step).
create or replace function public.enforce_project_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n   integer;
  cap integer := 10;
begin
  if exists (select 1 from public.admins where user_id = new.author_id) then
    cap := 200;
  end if;
  select count(*) into n from public.projects where author_id = new.author_id;
  if n >= cap then
    raise exception 'You have reached the limit of % programs. Update or delete one first.', cap
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_limit on public.projects;
create trigger projects_limit before insert on public.projects
  for each row execute function public.enforce_project_limit();

-- ============================ votes ============================
-- One upvote per user per project (the primary key enforces it).
create table if not exists public.votes (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.votes enable row level security;

drop policy if exists "votes readable by everyone" on public.votes;
create policy "votes readable by everyone"
  on public.votes for select using (true);
drop policy if exists "users cast own vote" on public.votes;
create policy "users cast own vote"
  on public.votes for insert with check (auth.uid() = user_id);
drop policy if exists "users remove own vote" on public.votes;
create policy "users remove own vote"
  on public.votes for delete using (auth.uid() = user_id);

-- Keep projects.vote_count in sync as votes come and go.
create or replace function public.bump_vote_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    update public.projects set vote_count = vote_count + 1 where id = new.project_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.projects set vote_count = greatest(vote_count - 1, 0) where id = old.project_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists votes_count_ins on public.votes;
create trigger votes_count_ins after insert on public.votes
  for each row execute function public.bump_vote_count();
drop trigger if exists votes_count_del on public.votes;
create trigger votes_count_del after delete on public.votes
  for each row execute function public.bump_vote_count();

-- ============================ comments ============================
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists comments_project_idx on public.comments (project_id, created_at);

alter table public.comments enable row level security;

drop policy if exists "comments readable by everyone" on public.comments;
create policy "comments readable by everyone"
  on public.comments for select using (true);
drop policy if exists "authenticated users comment" on public.comments;
create policy "authenticated users comment"
  on public.comments for insert with check (auth.uid() = user_id);
drop policy if exists "users delete own comments" on public.comments;
create policy "users delete own comments"
  on public.comments for delete using (auth.uid() = user_id);

-- ==================== leaderboard: top creators ====================
-- Total upvotes summed across each person's published programs.
create or replace view public.top_creators with (security_invoker = on) as
  select p.id,
         p.display_name,
         p.avatar_url,
         count(pr.id)                    as project_count,
         coalesce(sum(pr.vote_count), 0) as total_votes
  from public.profiles p
  join public.projects pr on pr.author_id = p.id
  group by p.id, p.display_name, p.avatar_url
  order by total_votes desc, project_count desc;

-- ==================== per-game leaderboards ====================
-- Fed by game.submit_score(points) when someone plays a shared game on its
-- page. One row per player per game, best score only, so the table stays tiny.
-- Scores die with the program (cascade), so republishing starts a fresh board.
create table if not exists public.game_scores (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  score      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists game_scores_project_idx on public.game_scores (project_id, score desc);

alter table public.game_scores enable row level security;

drop policy if exists "game scores readable by everyone" on public.game_scores;
create policy "game scores readable by everyone"
  on public.game_scores for select using (true);
drop policy if exists "players submit own game score" on public.game_scores;
create policy "players submit own game score"
  on public.game_scores for insert with check (auth.uid() = user_id);
drop policy if exists "players update own game score" on public.game_scores;
create policy "players update own game score"
  on public.game_scores for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================ grants ============================
-- RLS still governs which ROWS each role sees; these table grants are what
-- PostgREST checks first. (Supabase usually adds these, included for safety.)
grant select on public.profiles, public.projects, public.votes, public.comments to anon, authenticated;
grant select on public.top_creators to anon, authenticated;
grant insert, update, delete on public.projects to authenticated;
grant insert, delete on public.votes to authenticated;
grant insert, delete on public.comments to authenticated;
grant update on public.profiles to authenticated;
grant select on public.game_scores to anon, authenticated;
grant insert, update on public.game_scores to authenticated;

-- ============================ assets ============================
-- A user-designed sprite: a small SVG built in the Asset editor. A game uses it
-- with game.sprite(id, asset=True). The editor composes the SVG from safe
-- shapes (rects, circles, paths), so there is no author markup to sanitise.
create table if not exists public.assets (
  id          bigint generated by default as identity primary key,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  svg         text not null check (char_length(svg) <= 40000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists assets_new_idx    on public.assets (created_at desc);
create index if not exists assets_author_idx on public.assets (author_id);

alter table public.assets enable row level security;

drop policy if exists "assets readable by everyone" on public.assets;
create policy "assets readable by everyone"
  on public.assets for select using (true);
drop policy if exists "authenticated users add assets" on public.assets;
create policy "authenticated users add assets"
  on public.assets for insert with check (auth.uid() = author_id);
drop policy if exists "authors update own assets" on public.assets;
create policy "authors update own assets"
  on public.assets for update using (auth.uid() = author_id);
drop policy if exists "authors delete own assets" on public.assets;
create policy "authors delete own assets"
  on public.assets for delete using (auth.uid() = author_id);

-- Cap how many assets one person can publish (a client-side limit is bypassable).
create or replace function public.enforce_asset_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n   integer;
  cap integer := 30;
begin
  if exists (select 1 from public.admins where user_id = new.author_id) then
    cap := 500;
  end if;
  select count(*) into n from public.assets where author_id = new.author_id;
  if n >= cap then
    raise exception 'You have reached the limit of % assets. Delete one first.', cap
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists assets_limit on public.assets;
create trigger assets_limit before insert on public.assets
  for each row execute function public.enforce_asset_limit();

grant select on public.assets to anon, authenticated;
grant insert, update, delete on public.assets to authenticated;

-- ---------------------------------------------------------------------------
-- app_settings: a tiny key/value table the site reads at runtime.
--
-- One row today:
--   multiplayer_students  '1' = students (@hallam.local) may use import net,
--                         '0' = multiplayer is off for them (teachers and the
--                         rest of the site are unaffected). net.js reads this
--                         for every player and drops connected students within
--                         seconds of a change, so misbehaviour is one edit away
--                         from a fix, with no redeploy.
--
-- Flip it from the Supabase dashboard (Table editor), or:
--   update public.app_settings set value = '0' where key = 'multiplayer_students';
--
-- Anyone may READ it; only admins may WRITE, so a student cannot flip their own
-- switch.
create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);
alter table public.app_settings enable row level security;

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select using (true);

drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all
  using (exists (select 1 from public.admins where user_id = auth.uid()))
  with check (exists (select 1 from public.admins where user_id = auth.uid()));

insert into public.app_settings (key, value) values ('multiplayer_students', '1')
  on conflict (key) do nothing;

grant select on public.app_settings to anon, authenticated;
grant insert, update, delete on public.app_settings to authenticated;
