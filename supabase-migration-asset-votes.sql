-- ===========================================================================
-- PyWebLib migration: upvotes and remix credit for Asset studio sprites.
--
--   1. asset_votes: one upvote per person per asset (no downvotes).
--   2. assets.vote_count: kept in step by a trigger, and locked so an author
--      cannot write their own count with the public anon key.
--   3. assets.remix_of: the asset a remix was copied from, so the original
--      maker stays credited after the remix is published.
--
-- Needs the assets table from supabase-schema.sql.
-- Paste the whole file into the Supabase SQL editor and Run. Safe to re-run.
-- ===========================================================================

alter table public.assets add column if not exists vote_count integer not null default 0;
alter table public.assets add column if not exists remix_of bigint
  references public.assets(id) on delete set null;

create index if not exists assets_votes_idx on public.assets (vote_count desc, created_at desc);

-- ---------------------------------------------------------------------------
-- 1. The votes. The primary key is the one-vote-per-person rule.
-- ---------------------------------------------------------------------------
create table if not exists public.asset_votes (
  asset_id   bigint not null references public.assets(id) on delete cascade,
  user_id    uuid   not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (asset_id, user_id)
);
create index if not exists asset_votes_user_idx on public.asset_votes (user_id);

alter table public.asset_votes enable row level security;

drop policy if exists "asset votes readable by everyone" on public.asset_votes;
create policy "asset votes readable by everyone"
  on public.asset_votes for select using (true);
drop policy if exists "users cast own asset vote" on public.asset_votes;
create policy "users cast own asset vote"
  on public.asset_votes for insert with check (auth.uid() = user_id);
drop policy if exists "users remove own asset vote" on public.asset_votes;
create policy "users remove own asset vote"
  on public.asset_votes for delete using (auth.uid() = user_id);

grant select on public.asset_votes to anon, authenticated;
grant insert, delete on public.asset_votes to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Keep assets.vote_count in step with the votes.
-- ---------------------------------------------------------------------------
create or replace function public.bump_asset_vote_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    update public.assets set vote_count = vote_count + 1 where id = new.asset_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.assets set vote_count = greatest(vote_count - 1, 0) where id = old.asset_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists asset_votes_count_ins on public.asset_votes;
create trigger asset_votes_count_ins after insert on public.asset_votes
  for each row execute function public.bump_asset_vote_count();
drop trigger if exists asset_votes_count_del on public.asset_votes;
create trigger asset_votes_count_del after delete on public.asset_votes
  for each row execute function public.bump_asset_vote_count();

-- ---------------------------------------------------------------------------
-- 3. Lock vote_count. RLS gates rows, not columns, and "authors update own
--    assets" would otherwise let anyone set their own count to a million.
--    The only legitimate writer is the trigger above, which runs one trigger
--    level deeper (pg_trigger_depth() > 1). Everything else keeps the old
--    value, and a new asset always starts at 0.
-- ---------------------------------------------------------------------------
create or replace function public.assets_guard_votes()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.vote_count := 0;
  elsif pg_trigger_depth() <= 1 then
    new.vote_count := old.vote_count;
  end if;
  return new;
end;
$$;

drop trigger if exists assets_guard_votes on public.assets;
create trigger assets_guard_votes
  before insert or update on public.assets
  for each row execute function public.assets_guard_votes();

-- Check: expect all three true.
select to_regclass('public.asset_votes') is not null                    as votes_table_ok,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'assets'
                  and column_name = 'remix_of')                          as remix_col_ok,
       exists (select 1 from pg_trigger
                where tgname = 'assets_guard_votes'
                  and tgrelid = 'public.assets'::regclass)               as guard_ok;
