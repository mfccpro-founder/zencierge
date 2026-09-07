-- Zencierge Local Guide (host-authored recommendations).
-- Do not apply from the app. Run in the Supabase SQL editor when ready.
-- public.properties.id is text (see supabase/schema.sql).

create table if not exists public.property_local_guide (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties (id) on delete cascade,
  category text not null check (
    category in ('restaurant', 'pharmacy', 'grocery', 'hospital', 'gas', 'attraction')
  ),
  business_name text not null,
  distance_miles numeric check (distance_miles is null or distance_miles >= 0),
  host_note text not null default '',
  website_or_maps_link text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists property_local_guide_lookup
  on public.property_local_guide (property_id, category, active, sort_order);

create or replace function public.touch_property_local_guide_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists property_local_guide_set_updated_at on public.property_local_guide;
create trigger property_local_guide_set_updated_at
  before update on public.property_local_guide
  for each row
  execute function public.touch_property_local_guide_updated_at();

alter table public.property_local_guide enable row level security;

drop policy if exists "anon all property_local_guide" on public.property_local_guide;

-- Guest reads happen on the server. No anonymous policies.
drop policy if exists "hosts select own local guide" on public.property_local_guide;
create policy "hosts select own local guide"
  on public.property_local_guide
  for select
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_local_guide.property_id
    )
  );

drop policy if exists "hosts insert own local guide" on public.property_local_guide;
create policy "hosts insert own local guide"
  on public.property_local_guide
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_local_guide.property_id
    )
  );

drop policy if exists "hosts update own local guide" on public.property_local_guide;
create policy "hosts update own local guide"
  on public.property_local_guide
  for update
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_local_guide.property_id
    )
  )
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_local_guide.property_id
    )
  );

drop policy if exists "hosts delete own local guide" on public.property_local_guide;
create policy "hosts delete own local guide"
  on public.property_local_guide
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_local_guide.property_id
    )
  );
