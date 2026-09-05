-- ============================================================================
-- Wardrobe app — Supabase schema
-- Run this whole file once in the Supabase SQL editor (Project > SQL Editor).
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE where practical, but
-- if you're iterating, drop the wardrobe_* tables first.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Garments
-- ----------------------------------------------------------------------------
create table if not exists wardrobe_garments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users default auth.uid(),
  name            text not null,
  category        text not null check (category in (
                    'tops', 'bottoms', 'outerwear', 'footwear', 'socks',
                    'underwear', 'sleepwear', 'activewear', 'formal', 'accessories',
                    'towels', 'bedding'
                  )),
  subcategory     text,
  color           text,
  quantity        int not null default 1 check (quantity >= 1),
  dirty_count     int not null default 0,
  image_path      text,
  brand           text,
  size            text,
  purchase_price  numeric,
  purchase_date   date,
  care_notes      text,
  last_worn       date,
  wear_count      int not null default 0,
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),

  constraint dirty_within_quantity check (dirty_count >= 0 and dirty_count <= quantity)
);

alter table wardrobe_garments enable row level security;

create policy "wardrobe_garments_owner"
  on wardrobe_garments
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 2. Outfits
-- ----------------------------------------------------------------------------
create table if not exists wardrobe_outfits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users default auth.uid(),
  name        text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

alter table wardrobe_outfits enable row level security;

create policy "wardrobe_outfits_owner"
  on wardrobe_outfits
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. Outfit <-> garment join table
-- ----------------------------------------------------------------------------
create table if not exists wardrobe_outfit_items (
  outfit_id   uuid not null references wardrobe_outfits(id) on delete cascade,
  garment_id  uuid not null references wardrobe_garments(id) on delete cascade,
  user_id     uuid not null references auth.users default auth.uid(),

  primary key (outfit_id, garment_id)
);

alter table wardrobe_outfit_items enable row level security;

create policy "wardrobe_outfit_items_owner"
  on wardrobe_outfit_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 4. Wear log
-- ----------------------------------------------------------------------------
create table if not exists wardrobe_wear_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users default auth.uid(),
  garment_id  uuid not null references wardrobe_garments(id) on delete cascade,
  worn_at     date not null default current_date
);

alter table wardrobe_wear_log enable row level security;

create policy "wardrobe_wear_log_owner"
  on wardrobe_wear_log
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 5. Indexes (not required for correctness, but this is a filter-heavy app)
-- ----------------------------------------------------------------------------
create index if not exists idx_wardrobe_garments_user     on wardrobe_garments (user_id);
create index if not exists idx_wardrobe_garments_category on wardrobe_garments (user_id, category);
create index if not exists idx_wardrobe_outfits_user       on wardrobe_outfits (user_id);
create index if not exists idx_wardrobe_outfit_items_user  on wardrobe_outfit_items (user_id);
create index if not exists idx_wardrobe_wear_log_user      on wardrobe_wear_log (user_id);
create index if not exists idx_wardrobe_wear_log_garment   on wardrobe_wear_log (garment_id);

-- ----------------------------------------------------------------------------
-- 6. Storage bucket for garment photos
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('wardrobe', 'wardrobe', false)
on conflict (id) do nothing;

-- Path convention: {user_id}/{garment_id}.jpg
-- storage.foldername(name) splits the object path on '/', so element [1] is
-- the top-level folder — i.e. the uploader's user id.
create policy "wardrobe_storage_owner_select"
  on storage.objects for select
  using (
    bucket_id = 'wardrobe'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "wardrobe_storage_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'wardrobe'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "wardrobe_storage_owner_update"
  on storage.objects for update
  using (
    bucket_id = 'wardrobe'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'wardrobe'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "wardrobe_storage_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'wardrobe'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================================
-- Migration: add 'towels' and 'bedding' categories (Household section)
-- Run this once if wardrobe_garments already exists from an earlier version
-- of this file — the CREATE TABLE above won't re-apply to an existing table.
-- ============================================================================
alter table wardrobe_garments drop constraint wardrobe_garments_category_check;

alter table wardrobe_garments add constraint wardrobe_garments_category_check
  check (category in (
    'tops', 'bottoms', 'outerwear', 'footwear', 'socks',
    'underwear', 'sleepwear', 'activewear', 'formal', 'accessories',
    'towels', 'bedding'
  ));
