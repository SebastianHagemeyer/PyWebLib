-- ===========================================================================
-- PyWebLib migration: featured (pinned) programs.
--
-- Lets an admin (a row in public.admins, see supabase-migration-admins.sql)
-- pin a published program so it sits at the top of the community gallery on
-- ALL three tabs (Trending, New, Top) and wears a gold frame. Everyone else is
-- unchanged: a normal user can neither feature their own post nor anyone's.
--
-- Paste the whole file into the Supabase SQL editor and Run. Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The columns. `featured_at` is what the strip sorts by, so the most
--    recently pinned post leads and the order is not left to chance.
-- ---------------------------------------------------------------------------
alter table public.projects add column if not exists featured    boolean not null default false;
alter table public.projects add column if not exists featured_at timestamptz;

-- Partial index: the gallery only ever asks for the featured rows, and there
-- are a handful of them, so index those and leave the rest out of it.
create index if not exists projects_featured_idx
  on public.projects (featured_at desc) where featured;

-- ---------------------------------------------------------------------------
-- 2. Lock the column to admins.
--
--    RLS gates ROWS, not COLUMNS, and "authors update own projects" already
--    lets every signed-in user update their own row. Without this trigger,
--    pinning yourself to the top of the gallery is one REST call with the
--    public anon key. A trigger is the column-level lock RLS cannot express.
--
--    Not SECURITY DEFINER: it must see the CALLER, and is_admin() is already
--    definer, so it can read the admins table from here.
-- ---------------------------------------------------------------------------
create or replace function public.projects_guard_featured()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- Quietly refuse rather than erroring: publishing must never fail because
    -- some client helpfully sent the column along.
    if new.featured and not public.is_admin() then
      new.featured := false;
    end if;
  elsif (new.featured is distinct from old.featured) and not public.is_admin() then
    raise exception 'only an admin can feature a program';
  end if;

  -- A private draft is not in the gallery, so it cannot lead it. This runs
  -- AFTER the check above, so an author unpublishing their own featured post
  -- is an automatic clear, not a permission error.
  if not new.published then
    new.featured := false;
  end if;

  -- Stamp (and clear) featured_at here, so no client has to be trusted to.
  if new.featured and new.featured_at is null then
    new.featured_at := now();
  elsif not new.featured then
    new.featured_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_guard_featured on public.projects;
create trigger projects_guard_featured
  before insert or update on public.projects
  for each row execute function public.projects_guard_featured();

-- ---------------------------------------------------------------------------
-- 3. Check. Deliberately NOT `select public.is_admin()`: the SQL editor runs
--    as the table owner, not as your signed-in user, so auth.uid() is null
--    there and is_admin() answers false however much of an admin you are.
--    That question only has a real answer from the browser, which is where
--    the page asks it. These four do have an answer here.
--
--    Expect: admins >= 1, both _ok true, pinned_now 0 on a first run.
-- ---------------------------------------------------------------------------
select (select count(*) from public.admins)                  as admins,
       to_regclass('public.projects_featured_idx') is not null as index_ok,
       exists (select 1 from pg_trigger
                where tgname = 'projects_guard_featured'
                  and tgrelid = 'public.projects'::regclass)   as trigger_ok,
       (select count(*) from public.projects where featured) as pinned_now;
