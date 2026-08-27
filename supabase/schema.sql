-- Run in the Supabase SQL editor before using the dashboard live.
-- Tables used by src/lib/supabase-listings.ts

create table if not exists public.properties (
  id text primary key,
  name text not null,
  city text not null,
  address text not null default '',
  status text not null default 'Vacant',
  revenue text not null default '$0',
  door_code text not null default '',
  smartlock text not null default '',
  wifi_network text not null default '',
  wifi_password text not null default '',
  parking text not null default '',
  gate_code text not null default '',
  check_in text not null default '',
  check_out text not null default '',
  current_guest text,
  handbook text not null default '',
  ai_handbook text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.properties add column if not exists ai_handbook text not null default '';

update public.properties
set ai_handbook = handbook
where (ai_handbook is null or ai_handbook = '')
  and handbook is not null
  and handbook <> '';

create table if not exists public.reservations (
  id text primary key,
  property_id text not null references public.properties (id) on delete cascade,
  guest text not null,
  phone text not null default '',
  platform text not null,
  check_in date not null,
  check_out date not null,
  check_in_time text not null default '',
  check_out_time text not null default '',
  access_code text not null default '',
  ai_notes text not null default '',
  nights int not null default 1,
  status text not null default 'upcoming',
  updated_at timestamptz not null default now()
);

alter table public.properties enable row level security;
alter table public.reservations enable row level security;

drop policy if exists "anon all properties" on public.properties;
create policy "anon all properties"
  on public.properties
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "anon all reservations" on public.reservations;
create policy "anon all reservations"
  on public.reservations
  for all
  to anon
  using (true)
  with check (true);
