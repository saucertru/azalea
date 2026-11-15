-- =====================================================================
-- Azelela - Supabase schema
-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PROFILES (one per account: username, pfp, banner, join date, settings)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique
              check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  avatar_url  text,
  banner_url  text,
  bio         text check (char_length(bio) <= 200),
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create unique index if not exists profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles
  for select using (true);

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Stop users editing their own join date or id
create or replace function public.protect_profile_columns()
returns trigger language plpgsql as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- Create the profile automatically when someone signs up.
-- The username comes from the sign-up form (options.data.username).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text;
  uname text;
  n int := 0;
begin
  base := regexp_replace(coalesce(new.raw_user_meta_data ->> 'username',
                                  split_part(new.email, '@', 1)), '[^A-Za-z0-9_]', '', 'g');
  if char_length(base) < 3 then base := 'user' || base; end if;
  base := left(base, 16);
  uname := base;
  while exists (select 1 from public.profiles where lower(username) = lower(uname)) loop
    n := n + 1;
    uname := left(base, 16) || n::text;
  end loop;
  insert into public.profiles (id, username) values (new.id, uname);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lets the sign-up form check if a username is free before submitting
create or replace function public.username_available(name text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(name));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- CHAT ROOMS
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  is_private  boolean not null default false,
  code        text unique,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id    uuid references public.rooms (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  room_id     uuid not null references public.rooms (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null default 'text' check (kind in ('text', 'game')),
  content     text not null default '' check (char_length(content) <= 1000),
  payload     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists messages_room_time on public.messages (room_id, created_at desc);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;

-- helper: is the current user a member of this room?
create or replace function public.is_room_member(r uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_members where room_id = r and user_id = auth.uid());
$$;

create or replace function public.can_see_room(r uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rooms
    where id = r and (is_private = false or public.is_room_member(r))
  );
$$;

-- Public rooms are visible to everyone; private rooms only to members.
-- (Private room codes are never exposed to non-members.)
drop policy if exists "see rooms" on public.rooms;
create policy "see rooms" on public.rooms
  for select using (is_private = false or public.is_room_member(id));

drop policy if exists "see own memberships" on public.room_members;
create policy "see own memberships" on public.room_members
  for select using (user_id = auth.uid());

drop policy if exists "leave rooms" on public.room_members;
create policy "leave rooms" on public.room_members
  for delete using (user_id = auth.uid());

drop policy if exists "read messages" on public.messages;
create policy "read messages" on public.messages
  for select using (public.can_see_room(room_id));

drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_room(room_id));

drop policy if exists "delete own messages" on public.messages;
create policy "delete own messages" on public.messages
  for delete using (user_id = auth.uid());

-- Create a room (private rooms get a 6-character join code)
create or replace function public.create_room(room_name text, private boolean)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  c text;
begin
  if auth.uid() is null then raise exception 'Not logged in'; end if;
  if private then
    loop
      c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      exit when not exists (select 1 from public.rooms where code = c);
    end loop;
  end if;
  insert into public.rooms (name, is_private, code, created_by)
  values (trim(room_name), private, c, auth.uid())
  returning * into r;
  insert into public.room_members (room_id, user_id) values (r.id, auth.uid());
  return r;
end $$;
grant execute on function public.create_room(text, boolean) to authenticated;

-- Join a private room with its code
create or replace function public.join_room_by_code(room_code text)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
begin
  if auth.uid() is null then raise exception 'Not logged in'; end if;
  select * into r from public.rooms where code = upper(trim(room_code));
  if not found then raise exception 'No room with that code'; end if;
  insert into public.room_members (room_id, user_id) values (r.id, auth.uid())
  on conflict do nothing;
  return r;
end $$;
grant execute on function public.join_room_by_code(text) to authenticated;

-- Starter public rooms
insert into public.rooms (name, is_private)
select v.name, false from (values ('General'), ('Gaming'), ('Music')) as v(name)
where not exists (select 1 from public.rooms where rooms.name = v.name and is_private = false);

-- Realtime for chat
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- PDF UPLOADS
-- ---------------------------------------------------------------------
create table if not exists public.pdf_uploads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  path        text not null,
  size        bigint,
  created_at  timestamptz not null default now()
);
alter table public.pdf_uploads enable row level security;

drop policy if exists "pdfs are public" on public.pdf_uploads;
create policy "pdfs are public" on public.pdf_uploads for select using (true);

drop policy if exists "upload own pdfs" on public.pdf_uploads;
create policy "upload own pdfs" on public.pdf_uploads
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "delete own pdfs" on public.pdf_uploads;
create policy "delete own pdfs" on public.pdf_uploads
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- STORAGE BUCKETS (avatars, banners, pdfs) - public read,
-- users can only write inside a folder named after their own user id.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 3145728,  array['image/png','image/jpeg','image/gif','image/webp']),
  ('banners', 'banners', true, 5242880,  array['image/png','image/jpeg','image/gif','image/webp']),
  ('pdfs',    'pdfs',    true, 26214400, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read azelela buckets" on storage.objects;
create policy "public read azelela buckets" on storage.objects
  for select using (bucket_id in ('avatars', 'banners', 'pdfs'));

drop policy if exists "upload to own folder" on storage.objects;
create policy "upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('avatars', 'banners', 'pdfs')
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "update own files" on storage.objects;
create policy "update own files" on storage.objects
  for update to authenticated
  using (bucket_id in ('avatars', 'banners', 'pdfs')
         and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delete own files" on storage.objects;
create policy "delete own files" on storage.objects
  for delete to authenticated
  using (bucket_id in ('avatars', 'banners', 'pdfs')
         and (storage.foldername(name))[1] = auth.uid()::text);
