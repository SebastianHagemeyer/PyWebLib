-- ===========================================================================
-- PyWebLib migration: class-code sign-in for schools.
--
-- A second way in, for a class that has no Google accounts: a student types a
-- code and a 3-digit PIN, nothing else. Each one is an ordinary Supabase
-- email/password user underneath, so every RLS policy (auth.uid() = author_id),
-- every cap, vote, comment and game leaderboard keeps working with NO schema
-- changes anywhere else.
--
--   email    = <code>@hallam.local          e.g. abc0001@hallam.local
--   password = <CODE><PIN>                  e.g. ABC0001482
--
-- The kid never sees either: auth.js builds both from the two boxes they fill
-- in. The PIN is what stops one student signing in as another just by knowing
-- their code (which is printed on their school gear). It is a classroom speed
-- bump, not a secret: 3 digits is 1000 guesses, so it stops a nosey classmate,
-- not someone determined to write a script.
--
-- THIS FILE IS PUBLIC. It ships the machinery and an obviously fake example
-- roster. Real children's names, codes and PINs go in a roster file kept OFF
-- this repo (see "Loading a real roster" below).
--
-- Paste the whole file into the Supabase SQL editor of the PyWebLib project
-- (ref dwjwbqovfxsemlnzdcye) and Run. Safe to run more than once.
--
-- Before running: Supabase -> Authentication -> Sign In / Providers -> the
-- Email provider must be ENABLED (it is by default). Nothing else to set up;
-- accounts are created already-confirmed, so no mail is ever sent.
-- ===========================================================================

-- crypt()/gen_salt() live in pgcrypto, which Supabase puts in `extensions`.
-- Listing both schemas means this resolves wherever the extension landed.
set search_path = public, extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. The private roster.
--
-- Same reasoning as public.admins: no policies and no grants, so it does not
-- exist as far as the API is concerned. Neither the anon key nor a signed-in
-- student can read it. The handle is the only public part (it is copied to
-- profiles.display_name); the real name, class and PIN never leave this table.
-- ---------------------------------------------------------------------------
create table if not exists public.students (
  code       text primary key,
  user_id    uuid references auth.users(id) on delete set null,
  first_name text not null,
  last_name  text not null,
  class      text not null,
  year_level integer not null,
  handle     text not null unique,
  pin        text not null check (pin ~ '^[0-9]{3}$'),
  created_at timestamptz not null default now()
);

alter table public.students enable row level security;
revoke all on public.students from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Turn roster rows into real accounts.
--
-- Idempotent three ways: a student who already has an account keeps it and
-- everything they made, a half-finished run picks up where it stopped, and a
-- changed handle or PIN is pushed through. Re-running is therefore also how
-- you reset a forgotten PIN: edit public.students, call this again.
--
-- Deliberately NOT security definer. It needs owner rights on auth.users, so
-- if the execute grant below ever leaked, a caller would still just get a
-- permission error rather than the ability to mint accounts.
-- ---------------------------------------------------------------------------
create or replace function public.sync_student_accounts()
returns integer language plpgsql set search_path = public, extensions as $$
declare
  s    record;
  uid  uuid;
  mail text;
  made integer := 0;
begin
  for s in select * from public.students order by class, code loop
    mail := lower(s.code) || '@hallam.local';

    select id into uid from auth.users where email = mail;

    if uid is null then
      uid := gen_random_uuid();

      -- The four *_token columns must be '' and not null: GoTrue reads them
      -- into plain Go strings and blows up on a NULL.
      insert into auth.users (
        instance_id, id, aud, role,
        email, encrypted_password, email_confirmed_at,
        created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
        mail, crypt(s.code || s.pin, gen_salt('bf')), now(),
        now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', s.handle),
        '', '', '', ''
      );

      insert into auth.identities (
        id, user_id, provider_id, provider, identity_data,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), uid, uid::text, 'email',
        jsonb_build_object('sub', uid::text, 'email', mail,
                           'email_verified', true, 'phone_verified', false),
        now(), now(), now()
      )
      on conflict do nothing;

      made := made + 1;
    else
      update auth.users set
        encrypted_password = crypt(s.code || s.pin, gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        raw_user_meta_data = jsonb_build_object('full_name', s.handle),
        updated_at         = now()
      where id = uid;
    end if;

    update public.students set user_id = uid where code = s.code;

    -- handle_new_user() already made this row from raw_user_meta_data; the
    -- upsert is what keeps an edited handle in step on a re-run.
    insert into public.profiles (id, display_name)
    values (uid, s.handle)
    on conflict (id) do update set display_name = excluded.display_name;
  end loop;

  return made;
end;
$$;

revoke all on function public.sync_student_accounts() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. What a roster row looks like. DELIBERATELY COMMENTED OUT.
--
--    This file is public, so anything it actually inserts would be an account
--    whose credentials are published on GitHub for anyone to sign in with. The
--    shape is documentation; the rows come from your own private roster file.
--
--    Handles are what the world sees on a published program, so pick something
--    anonymous: no child's real name should ever reach a public page.
--
--  insert into public.students (code, first_name, last_name, class, year_level, handle, pin) values
--    ('ABC0001', 'Example', 'Student', '7ITX', 7, 'Quiet Aardvark', '482'),
--    ('DEF0002', 'Second',  'Example', '7ITX', 7, 'Sunny Capybara', '117')
--  on conflict (code) do update set
--    first_name = excluded.first_name, last_name  = excluded.last_name,
--    class      = excluded.class,      year_level = excluded.year_level,
--    handle     = excluded.handle,     pin        = excluded.pin;
-- ---------------------------------------------------------------------------

-- Harmless on an empty roster (returns 0); confirms the function compiled.
select public.sync_student_accounts() as accounts_created;

-- ---------------------------------------------------------------------------
-- 4. Loading a real roster.
--
-- Keep it OUT of this repo: it is a list of children's names next to working
-- credentials, and this repo is public. Put it somewhere private, and paste it
-- into the SQL editor after this file. It only needs the insert plus the sync:
--
--   insert into public.students (code, first_name, last_name, class, year_level, handle, pin) values
--     ('ABC0001', 'Real', 'Name', '7ITC', 7, 'Bold Marmot', '482'),
--     ...
--   on conflict (code) do update set
--     first_name = excluded.first_name, last_name = excluded.last_name,
--     class      = excluded.class,      year_level = excluded.year_level,
--     handle     = excluded.handle,     pin        = excluded.pin;
--
--   select public.sync_student_accounts();
--
-- To print the handout (who types what), run:
--
--   select class, code as sign_in_code, pin,
--          first_name || ' ' || last_name as student,
--          handle as shown_publicly
--   from public.students order by class, last_name;
-- ---------------------------------------------------------------------------
