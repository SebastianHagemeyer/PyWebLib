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
  code        text not null check (char_length(code) <= 20000),
  kind        text not null default 'python',   -- python | turtle | game
  vote_count  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_votes_idx  on public.projects (vote_count desc, created_at desc);
create index if not exists projects_author_idx on public.projects (author_id);

alter table public.projects enable row level security;

drop policy if exists "projects readable by everyone" on public.projects;
create policy "projects readable by everyone"
  on public.projects for select using (true);
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

-- Cap how many programs one person can publish. Enforced here because a
-- client-side limit is trivially bypassed. To change the cap, edit the number
-- and re-run this block (and keep PROGRAM_CAP in publish.js in step).
create or replace function public.enforce_project_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.projects where author_id = new.author_id;
  if n >= 10 then
    raise exception 'You have reached the limit of 10 published programs. Update or delete one first.'
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
