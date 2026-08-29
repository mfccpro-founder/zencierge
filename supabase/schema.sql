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
  trash text not null default '',
  handbook text not null default '',
  ai_handbook text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.properties add column if not exists ai_handbook text not null default '';

-- House rules Elena quotes on guest calls (Wi-Fi, parking and check-out already
-- have columns; trash was the missing one).
alter table public.properties add column if not exists trash text not null default '';

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

-- Host SaaS billing ($29 / $79 / $199). Webhooks use the service role key.
create table if not exists public.host_subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  plan_id text not null default 'starter'
    check (plan_id in ('starter', 'pro', 'agency')),
  status text not null default 'inactive'
    check (status in ('active', 'past_due', 'canceled', 'inactive', 'trial')),
  monthly_usd numeric(10, 2) not null default 29,
  square_customer_id text,
  square_subscription_id text,
  current_period_end timestamptz,
  last_payment_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  host_email text,
  amount_usd numeric(10, 2) not null,
  currency text not null default 'USD',
  plan_id text,
  status text not null check (status in ('succeeded', 'failed', 'refunded')),
  provider_event text,
  provider_payment_id text unique,
  created_at timestamptz not null default now()
);

create index if not exists subscription_payments_user_idx on public.subscription_payments (user_id, created_at desc);

alter table public.host_subscriptions enable row level security;
alter table public.subscription_payments enable row level security;

drop policy if exists "hosts read own subscription" on public.host_subscriptions;
create policy "hosts read own subscription"
  on public.host_subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "hosts read own payments" on public.subscription_payments;
create policy "hosts read own payments"
  on public.subscription_payments for select
  to authenticated
drop policy if exists "hosts read own payments" on public.subscription_payments;
create policy "hosts read own payments"
  on public.subscription_payments for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Super-Host suite: guest capture gate, risk profiles, neighbor alerts.
-- Guests check in anonymously; reads happen server-side via service role.
-- ---------------------------------------------------------------------------
create table if not exists public.captured_guests (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  full_name text not null,
  phone text not null,
  email text not null,
  risk_status text not null default 'unknown',
  marketing_opt_in boolean not null default true,
  check_in_at timestamptz not null default now(),
  unique (property_id, email)
);
create index if not exists captured_guests_property_idx on public.captured_guests (property_id, check_in_at desc);
create index if not exists captured_guests_phone_idx on public.captured_guests (phone);

create table if not exists public.guest_risk_profiles (
  id uuid primary key default gen_random_uuid(),
  phone text unique,
  email text unique,
  risk_level text not null default 'clear' check (risk_level in ('clear', 'watch', 'flagged')),
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.neighbor_alerts (
  id uuid primary key default gen_random_uuid(),
  property_id text,
  alert_type text not null default 'noise',
  message text not null,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.captured_guests enable row level security;
alter table public.guest_risk_profiles enable row level security;
alter table public.neighbor_alerts enable row level security;

drop policy if exists "guests can check in" on public.captured_guests;
create policy "guests can check in"
  on public.captured_guests for insert
  to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- Host feature requests (product feedback). Hosts insert their own rows;
-- superadmin reads/updates status via the service role.
-- ---------------------------------------------------------------------------
create table if not exists public.host_feature_requests (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null,
  host_email text not null,
  title text not null,
  description text not null,
  category text not null check (
    category in ('housekeeping', 'messaging', 'pricing', 'disputes', 'access', 'other')
  ),
  status text not null default 'under_review' check (
    status in ('under_review', 'planned', 'in_progress', 'completed')
  ),
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'host_feature_requests' and column_name = 'user_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'host_feature_requests' and column_name = 'host_id'
  ) then
    alter table public.host_feature_requests rename column user_id to host_id;
  end if;
end $$;

alter table public.host_feature_requests drop constraint if exists host_feature_requests_category_check;
alter table public.host_feature_requests drop constraint if exists host_feature_requests_status_check;
alter table public.host_feature_requests
  add constraint host_feature_requests_category_check check (
    category in ('housekeeping', 'messaging', 'pricing', 'disputes', 'access', 'other',
      'limpieza', 'finanzas', 'huespedes', 'reglas', 'otro')
  );
alter table public.host_feature_requests
  add constraint host_feature_requests_status_check check (
    status in ('under_review', 'planned', 'in_progress', 'completed')
  );

create index if not exists host_feature_requests_created_idx
  on public.host_feature_requests (created_at desc);

alter table public.host_feature_requests enable row level security;

drop policy if exists "hosts insert own feature requests" on public.host_feature_requests;
create policy "hosts insert own feature requests"
  on public.host_feature_requests for insert
  to authenticated
  with check (auth.uid() = host_id);

drop policy if exists "hosts read own feature requests" on public.host_feature_requests;
create policy "hosts read own feature requests"
  on public.host_feature_requests for select
  to authenticated
  using (auth.uid() = host_id);

-- Housekeeping inspection photos (staff camera portal at /housekeeping/upload)
create table if not exists public.housekeeping_photos (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties (id) on delete cascade,
  reservation_id text not null,
  category text not null
    check (category in ('check_in', 'check_out', 'damage_report')),
  storage_path text not null,
  image_url text not null,
  captured_at timestamptz not null default now(),
  staff_name text,
  content_type text,
  file_size int,
  created_at timestamptz not null default now()
);

create index if not exists housekeeping_photos_property_idx
  on public.housekeeping_photos (property_id, captured_at desc);

alter table public.housekeeping_photos enable row level security;

drop policy if exists "hosts read housekeeping photos" on public.housekeeping_photos;
create policy "hosts read housekeeping photos"
  on public.housekeeping_photos for select
  to authenticated
  using (true);

insert into storage.buckets (id, name, public)
values ('housekeeping', 'housekeeping', true)
on conflict (id) do nothing;

