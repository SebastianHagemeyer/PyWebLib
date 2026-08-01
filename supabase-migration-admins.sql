-- ===========================================================================
-- PyWebLib migration: an admins list with raised limits.
--
-- Paste the whole file into the Supabase SQL editor and Run. It is safe to run
-- more than once. The SQL editor runs as the table owner, which is exactly why
-- this is the only place admins can be granted.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Who gets raised limits.
--
-- Deliberately NOT a column on profiles. Every signed-in user may update their
-- own profile row ("users update own profile" + grant update on profiles to
-- authenticated), and the anon key is public by design, so an is_admin flag
-- living there could be flipped by anyone on themselves with one REST call.
--
-- This table has no policies and no grants, so it does not exist as far as the
-- API is concerned. Rows are added here, in the SQL editor, only.
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The caps. Same triggers as before, but the number now depends on whether
--    the author is in admins. Everyone else is unchanged: 30 assets, 10
--    programs.
-- ---------------------------------------------------------------------------
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

-- The triggers themselves are unchanged; re-created here so a fresh database
-- and an existing one end up identical.
drop trigger if exists assets_limit on public.assets;
create trigger assets_limit before insert on public.assets
  for each row execute function public.enforce_asset_limit();

drop trigger if exists projects_limit on public.projects;
create trigger projects_limit before insert on public.projects
  for each row execute function public.enforce_project_limit();

-- ---------------------------------------------------------------------------
-- 3. Make the owner an admin. Matched by email against auth.users, so it works
--    without knowing the uuid.
-- ---------------------------------------------------------------------------
insert into public.admins (user_id, note)
select id, 'owner'
from auth.users
where email = 'hagemeyer.sebastian@gmail.com'
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. While we are here: the raised SVG size limit, in case it was never run.
--    Safe either way.
-- ---------------------------------------------------------------------------
alter table public.assets drop constraint if exists assets_svg_check;
alter table public.assets add constraint assets_svg_check
  check (char_length(svg) <= 40000);

-- ---------------------------------------------------------------------------
-- 5. Check it worked. Expect one row, with is_admin = true and your asset count.
-- ---------------------------------------------------------------------------
select u.email,
       (a.user_id is not null)                                   as is_admin,
       (select count(*) from public.assets   s where s.author_id = u.id) as assets,
       (select count(*) from public.projects p where p.author_id = u.id) as programs
from auth.users u
left join public.admins a on a.user_id = u.id
where u.email = 'hagemeyer.sebastian@gmail.com';
