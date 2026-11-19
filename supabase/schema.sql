-- Slow Light: database setup.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Safe to run again; it only creates what is missing.

-- ---------------------------------------------------------------- tables

create table if not exists public.photos (
  id             uuid primary key default gen_random_uuid(),
  title          text not null default '' check (char_length(title) <= 120),
  caption        text not null default '' check (char_length(caption) <= 500),
  chapter        text not null default 'sheet' check (chapter in ('cover', 'strip', 'sheet')),
  image_path     text not null,           -- full-size file inside the storage bucket
  thumb_path     text not null,           -- small version used in the grids
  width          integer,
  height         integer,
  position       integer not null default 0,
  likes_count    integer not null default 0,
  comments_count integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists photos_order_idx on public.photos (position, created_at);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  body       text not null check (char_length(body) between 1 and 500),
  ip_hash    text,                        -- salted hash, only used for rate limiting
  created_at timestamptz not null default now()
);
create index if not exists comments_photo_idx on public.comments (photo_id, created_at desc);
create index if not exists comments_ip_idx    on public.comments (ip_hash, created_at desc);

create table if not exists public.likes (
  photo_id   uuid not null references public.photos (id) on delete cascade,
  visitor_id text not null check (char_length(visitor_id) between 8 and 64),
  ip_hash    text,
  created_at timestamptz not null default now(),
  primary key (photo_id, visitor_id)      -- one like per visitor per photo
);
create index if not exists likes_ip_idx on public.likes (ip_hash, created_at desc);

-- ------------------------------------------------- keep the counters in sync

create or replace function public.sync_likes_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.photos set likes_count = likes_count + 1 where id = new.photo_id;
  elsif tg_op = 'DELETE' then
    update public.photos set likes_count = greatest(likes_count - 1, 0) where id = old.photo_id;
  end if;
  return null;
end $$;

create or replace function public.sync_comments_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.photos set comments_count = comments_count + 1 where id = new.photo_id;
  elsif tg_op = 'DELETE' then
    update public.photos set comments_count = greatest(comments_count - 1, 0) where id = old.photo_id;
  end if;
  return null;
end $$;

drop trigger if exists likes_count_sync on public.likes;
create trigger likes_count_sync
  after insert or delete on public.likes
  for each row execute function public.sync_likes_count();

drop trigger if exists comments_count_sync on public.comments;
create trigger comments_count_sync
  after insert or delete on public.comments
  for each row execute function public.sync_comments_count();

-- ------------------------------------------------------------ row security
-- Visitors (the public "anon" key) may only READ photos and comments.
-- Every write goes through the PHP API, which uses the secret service key.
-- Likes are not readable by visitors at all (visitor ids stay private).

alter table public.photos   enable row level security;
alter table public.comments enable row level security;
alter table public.likes    enable row level security;

drop policy if exists "public can read photos" on public.photos;
create policy "public can read photos" on public.photos
  for select to anon, authenticated using (true);

drop policy if exists "public can read comments" on public.comments;
create policy "public can read comments" on public.comments
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------- storage
-- A public bucket: anyone can view a photo by its link, only the API can add or remove.
-- The API converts every upload to WebP, so only WebP files up to 3 MB are accepted.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 3145728, array['image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 3145728,
      allowed_mime_types = array['image/webp'];
