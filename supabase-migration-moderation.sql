-- ===========================================================================
-- PyWebLib migration: admin moderation of the community gallery.
--
-- Lets an admin (a row in public.admins, granted only from the SQL editor,
-- see supabase-migration-admins.sql) rename or delete ANY user's program, so
-- abusive titles/posts can be taken down. Ordinary users are unchanged: they
-- can still only edit and delete their own.
--
-- Paste the whole file into the Supabase SQL editor and Run. Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tell the page whether the signed-in user is an admin, WITHOUT exposing
--    the admins table (which has no grants by design). SECURITY DEFINER so it
--    can read admins; only returns a boolean about the caller. Mirrors the
--    my_program_cap() pattern in supabase-migration-caps.sql.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. RLS: admins may read, update and delete any project. These are permissive
--    policies, so they sit alongside (OR with) the existing author-only ones,
--    which stay exactly as they were.
-- ---------------------------------------------------------------------------
drop policy if exists "admins read any project" on public.projects;
create policy "admins read any project"
  on public.projects for select
  using (public.is_admin());

drop policy if exists "admins update any project" on public.projects;
create policy "admins update any project"
  on public.projects for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete any project" on public.projects;
create policy "admins delete any project"
  on public.projects for delete
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Check. Run while signed in as yourself; expect true for the owner.
-- ---------------------------------------------------------------------------
select public.is_admin() as i_am_admin;
