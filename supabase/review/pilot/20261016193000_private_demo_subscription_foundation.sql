-- REVIEW ONLY: dedicated Free Supabase project for the Robert Toca private demo.
-- Apply only after properties/reservations and Auth exist in the new project.
-- No business rows, no demo user, no payment identifiers, and no public writes.

begin;

do $$
begin
  if to_regclass('auth.users') is null then
    raise exception using errcode = 'ZPD00', message = 'Supabase Auth catalog is missing';
  end if;
  if to_regclass('public.properties') is null or to_regclass('public.reservations') is null then
    raise exception using errcode = 'ZPD01', message = 'properties and reservations must be installed first';
  end if;
  if to_regclass('public.host_profiles') is not null
     or to_regclass('public.host_subscriptions') is not null
     or to_regclass('public.subscription_payments') is not null then
    raise exception using errcode = 'ZPD02', message = 'private-demo account tables already exist; stop and diagnose drift';
  end if;
end;
$$;

create table public.host_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  updated_at timestamptz not null default now()
);

create table public.host_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan_id text not null check (plan_id in ('starter', 'pro', 'portfolio', 'agency')),
  status text not null default 'inactive' check (status in ('inactive', 'trial', 'active', 'past_due', 'canceled')),
  monthly_usd numeric(10,2) not null default 0 check (monthly_usd >= 0),
  last_payment_at timestamptz,
  current_period_end timestamptz,
  is_lifetime_free boolean not null default false,
  square_customer_id text,
  square_card_id text,
  square_subscription_id text,
  square_subscription_status text,
  complimentary_starts_at timestamptz,
  complimentary_ends_at timestamptz,
  complimentary_granted_by uuid references auth.users(id) on delete set null,
  complimentary_granted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_demo_window_check check (
    complimentary_starts_at is null
    or complimentary_ends_at is null
    or complimentary_ends_at > complimentary_starts_at
  )
);

create index host_subscriptions_complimentary_ends_idx
  on public.host_subscriptions (complimentary_ends_at)
  where complimentary_ends_at is not null;

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_usd numeric(10,2) not null check (amount_usd >= 0),
  plan_id text check (plan_id in ('starter', 'pro', 'portfolio', 'agency')),
  status text not null,
  provider_payment_id text,
  created_at timestamptz not null default now()
);

create index subscription_payments_user_created_idx
  on public.subscription_payments (user_id, created_at desc);

alter table public.host_subscriptions enable row level security;
alter table public.host_subscriptions force row level security;
alter table public.subscription_payments enable row level security;
alter table public.subscription_payments force row level security;
alter table public.host_profiles enable row level security;
alter table public.host_profiles force row level security;

revoke all on table public.host_profiles from public, anon, authenticated, service_role;
revoke all on table public.host_subscriptions from public, anon, authenticated, service_role;
revoke all on table public.subscription_payments from public, anon, authenticated, service_role;

grant select, insert, update on table public.host_profiles to authenticated;
grant select, insert, update on table public.host_profiles to service_role;
grant select on table public.host_subscriptions to authenticated;
grant select on table public.subscription_payments to authenticated;
grant select, insert, update on table public.host_subscriptions to service_role;
grant select, insert, update on table public.subscription_payments to service_role;

create policy "host reads own subscription"
  on public.host_subscriptions for select to authenticated
  using (auth.uid() = user_id);

create policy "host reads own payments"
  on public.subscription_payments for select to authenticated
  using (auth.uid() = user_id);

create policy "host reads own profile"
  on public.host_profiles for select to authenticated
  using (auth.uid() = user_id);

create policy "host creates own profile"
  on public.host_profiles for insert to authenticated
  with check (auth.uid() = user_id);

create policy "host updates own profile"
  on public.host_profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

commit;
