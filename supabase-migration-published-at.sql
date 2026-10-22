-- ===========================================================================
-- PyWebLib migration: published_at (when a program went public).
--
-- The New tab used to sort by created_at, which is when a program was FIRST
-- SAVED. A student who polishes a draft for a month and then publishes it got
-- the month-old date, so their game landed pages deep in New and nobody saw
-- it. published_at is stamped the moment a row goes from draft (or brand new)
-- to public, and New and Trending sort and window on that instead.
--
-- Updating a program that is already public does NOT re-stamp it, so re-saving
-- can't keep a post on page one.
--
-- Paste the whole file into the Supabase SQL editor and Run. Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The column, backfilled. We never recorded when existing posts went
--    public, so created_at is the best guess for them: they keep the exact
--    spot they have today.
-- ---------------------------------------------------------------------------
alter table public.projects add column if not exists published_at timestamptz;

update public.projects
   set published_at = created_at
 where published and published_at is null;

create index if not exists projects_published_at_idx
  on public.projects (published_at desc) where published;

-- ---------------------------------------------------------------------------
-- 2. Stamp it server-side, and lock it.
--
--    Like `featured`, RLS lets an author update their own row, so a client
--    that could write published_at could date its post into next year and
--    sit at the top of New forever. The trigger ignores whatever the client
--    sent and decides the value itself.
-- ---------------------------------------------------------------------------
create or replace function public.projects_stamp_published_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if not new.published then
    new.published_at := null;                    -- a draft has no publish date
  elsif tg_op = 'INSERT' or not coalesce(old.published, false) then
    new.published_at := now();                   -- just went public
  else
    new.published_at := old.published_at;        -- already public: keep its date
  end if;
  return new;
end;
$$;

drop trigger if exists projects_stamp_published_at on public.projects;
create trigger projects_stamp_published_at
  before insert or update on public.projects
  for each row execute function public.projects_stamp_published_at();

-- ---------------------------------------------------------------------------
-- 3. Check. Expect: both _ok true, missing 0.
-- ---------------------------------------------------------------------------
select to_regclass('public.projects_published_at_idx') is not null as index_ok,
       exists (select 1 from pg_trigger
                where tgname = 'projects_stamp_published_at'
                  and tgrelid = 'public.projects'::regclass)        as trigger_ok,
       (select count(*) from public.projects
         where published and published_at is null)                  as missing;
