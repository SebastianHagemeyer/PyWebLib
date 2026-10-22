-- ===========================================================================
-- PyWebLib migration: admin moderation of the Asset studio.
--
-- Lets an admin (a row in public.admins, see supabase-migration-admins.sql)
-- rename or delete ANY community asset, the same way
-- supabase-migration-moderation.sql does for programs. Ordinary users are
-- unchanged: they can still only edit and delete their own.
--
-- Needs public.is_admin() from supabase-migration-moderation.sql.
-- Paste the whole file into the Supabase SQL editor and Run. Safe to re-run.
-- ===========================================================================

drop policy if exists "admins update any asset" on public.assets;
create policy "admins update any asset"
  on public.assets for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete any asset" on public.assets;
create policy "admins delete any asset"
  on public.assets for delete
  using (public.is_admin());

-- Check: both policies should be listed.
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'assets' and policyname like 'admins%';
