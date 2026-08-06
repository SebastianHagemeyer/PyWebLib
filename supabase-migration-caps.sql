-- ===========================================================================
-- PyWebLib migration: let the page know your real limits.
--
-- The database has always enforced the caps correctly (10 programs / 30 assets,
-- 200 / 500 for admins). The PAGE did not: publish.js carried
-- `const PROGRAM_CAP = 10` and had no way to learn any better, because
-- public.admins deliberately has no grants, so the anon key cannot read it.
--
-- The result was an admin being told "you have 10 programs, the most allowed"
-- while the database would happily have taken 200.
--
-- These two functions close that gap without opening the admins table. They are
-- security definer, but they take no arguments and answer only for auth.uid(),
-- so all a caller can ever learn is their own cap. There is no way to ask about
-- anyone else, and no way to enumerate who is an admin.
--
-- Paste into the Supabase SQL editor of the PyWebLib project and Run.
-- Safe to run more than once.
-- ===========================================================================

set search_path = public;

create or replace function public.my_program_cap()
returns integer language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 0
    when exists (select 1 from public.admins where user_id = auth.uid()) then 200
    else 10
  end;
$$;

create or replace function public.my_asset_cap()
returns integer language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 0
    when exists (select 1 from public.admins where user_id = auth.uid()) then 500
    else 30
  end;
$$;

-- Signed-in callers only. anon gets nothing: it has no auth.uid() to answer for.
revoke all on function public.my_program_cap() from public, anon;
revoke all on function public.my_asset_cap()   from public, anon;
grant execute on function public.my_program_cap() to authenticated;
grant execute on function public.my_asset_cap()   to authenticated;

-- ---------------------------------------------------------------------------
-- Check. Run while signed in as yourself in the app, or just confirm the
-- functions exist. Expect 200 / 500 for an admin, 10 / 30 for everyone else.
-- ---------------------------------------------------------------------------
select u.email,
       (a.user_id is not null) as is_admin,
       case when a.user_id is not null then 200 else 10 end as program_cap,
       case when a.user_id is not null then 500 else  30 end as asset_cap,
       (select count(*) from public.projects p where p.author_id = u.id) as programs
from auth.users u
left join public.admins a on a.user_id = u.id
where u.email not like '%@hallam.local'
order by u.created_at;
