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

alter table public.properties add column if not exists assigned_avatar_name text not null default 'Elena';
alter table public.properties add column if not exists assigned_phone_number text not null default '';
alter table public.properties add column if not exists avatar_system_prompt text not null default '';
alter table public.properties add column if not exists timezone text not null default 'America/New_York';

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

-- Host SaaS billing plans: Starter $49 / Pro $99 / Portfolio $149 / Agency $199. Webhooks use the service role key.
create table if not exists public.host_subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  plan_id text not null default 'starter'
    check (plan_id in ('starter', 'pro', 'portfolio', 'agency')),
  status text not null default 'inactive'
    check (status in ('active', 'past_due', 'canceled', 'inactive', 'trial')),
  monthly_usd numeric(10, 2) not null default 49,
  is_lifetime_free boolean not null default false,
  square_customer_id text,
  square_subscription_id text,
  current_period_end timestamptz,
  last_payment_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.host_subscriptions add column if not exists is_lifetime_free boolean not null default false;

alter table public.host_subscriptions add column if not exists complimentary_starts_at timestamptz;
alter table public.host_subscriptions add column if not exists complimentary_ends_at timestamptz;
alter table public.host_subscriptions add column if not exists complimentary_granted_by uuid references auth.users (id) on delete set null;
alter table public.host_subscriptions add column if not exists complimentary_granted_at timestamptz;

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid,
  gateway_payment_id varchar(255) unique,
  amount_paid numeric(10, 2),
  net_revenue numeric(10, 2),
  gateway_fee numeric(10, 2),
  payment_status varchar(50),
  paid_at timestamptz default now(),
  user_id uuid references auth.users (id) on delete cascade,
  host_email text,
  amount_usd numeric(10, 2),
  currency text not null default 'USD',
  plan_id text,
  status text check (status in ('succeeded', 'failed', 'refunded')),
  provider_event text,
  provider_payment_id text unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_subscription_payments_user_id
  on public.subscription_payments (user_id);
create index if not exists subscription_payments_user_idx on public.subscription_payments (user_id, created_at desc);

-- BEGIN subscription webhook replay contract
create table if not exists public.subscription_webhook_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload_sha256 text not null,
  status text not null,
  payment_id text null,
  subscription_id text null,
  user_id uuid null,
  received_at timestamptz not null default pg_catalog.now(),
  processed_at timestamptz null,
  constraint subscription_webhook_events_pkey
    primary key (provider, event_id),
  constraint subscription_webhook_events_provider_check
    check (provider in ('square', 'generic_subscription')),
  constraint subscription_webhook_events_event_id_check
    check (pg_catalog.btrim(event_id) <> ''),
  constraint subscription_webhook_events_event_type_check
    check (
      event_type in (
        'payment.succeeded',
        'payment.failed',
        'subscription.canceled'
      )
    ),
  constraint subscription_webhook_events_payload_sha256_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint subscription_webhook_events_status_check
    check (status in ('processing', 'processed')),
  constraint subscription_webhook_events_processed_state_check
    check (
      (status = 'processing' and processed_at is null)
      or
      (status = 'processed' and processed_at is not null)
    )
);

comment on table public.subscription_webhook_events is
  'Service-role-only durable replay ledger for normalized subscription webhook events.';

alter table public.subscription_webhook_events enable row level security;

revoke all on table public.subscription_webhook_events from public;
revoke all on table public.subscription_webhook_events from anon;
revoke all on table public.subscription_webhook_events from authenticated;
revoke all on table public.subscription_webhook_events from service_role;
grant select on table public.subscription_webhook_events to service_role;

-- BEGIN subscription cancellation preserve plan RPC
create or replace function public.process_subscription_webhook_atomic(
  p_provider pg_catalog.text,
  p_event_id pg_catalog.text,
  p_event_type pg_catalog.text,
  p_payload_sha256 pg_catalog.text,
  p_user_id pg_catalog.uuid,
  p_email pg_catalog.text,
  p_plan_id pg_catalog.text,
  p_monthly_usd pg_catalog.numeric,
  p_amount_usd pg_catalog.numeric,
  p_payment_id pg_catalog.text,
  p_square_customer_id pg_catalog.text,
  p_square_subscription_id pg_catalog.text,
  p_occurred_at pg_catalog.timestamptz,
  p_current_period_end pg_catalog.timestamptz
)
returns table (
  processed pg_catalog.bool,
  replayed pg_catalog.bool,
  skipped_subscription pg_catalog.bool,
  resolved_user_id pg_catalog.uuid,
  resolved_plan_id pg_catalog.text,
  subscription_status pg_catalog.text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_provider pg_catalog.text;
  v_event_id pg_catalog.text;
  v_event_type pg_catalog.text;
  v_email pg_catalog.text;
  v_plan_id pg_catalog.text;
  v_payment_id pg_catalog.text;
  v_square_customer_id pg_catalog.text;
  v_square_subscription_id pg_catalog.text;
  v_occurred_at pg_catalog.timestamptz;
  v_current_period_end pg_catalog.timestamptz;
  v_claimed_provider pg_catalog.text;
  v_existing_event_type pg_catalog.text;
  v_existing_payload_sha256 pg_catalog.text;
  v_existing_status pg_catalog.text;
  v_processed_count pg_catalog.bigint;
begin
  if p_provider is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_provider := pg_catalog.btrim(p_provider);

  if v_provider <> 'square'
     and v_provider <> 'generic_subscription' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  if p_event_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_event_id := pg_catalog.btrim(p_event_id);
  if v_event_id = '' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  if p_event_type is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_event_type := pg_catalog.btrim(p_event_type);
  if v_event_type <> 'payment.succeeded'
     and v_event_type <> 'payment.failed'
     and v_event_type <> 'subscription.canceled' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  if p_payload_sha256 is null
     or p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  if v_event_type = 'payment.succeeded'
     or v_event_type = 'payment.failed' then
    if p_plan_id is null then
      raise exception using
        errcode = 'ZB001',
        message = 'invalid webhook event';
    end if;
    v_plan_id := pg_catalog.btrim(p_plan_id);
    if v_plan_id = '' then
      raise exception using
        errcode = 'ZB001',
        message = 'invalid webhook event';
    end if;

    if p_monthly_usd is null
       or p_monthly_usd::pg_catalog.text in ('NaN', 'Infinity', '-Infinity')
       or p_monthly_usd <= 0 then
      raise exception using
        errcode = 'ZB001',
        message = 'invalid webhook event';
    end if;

    if p_payment_id is null then
      raise exception using
        errcode = 'ZB001',
        message = 'invalid payment event';
    end if;

    v_payment_id := pg_catalog.btrim(p_payment_id);
    if v_payment_id = '' then
      raise exception using
        errcode = 'ZB001',
        message = 'invalid payment event';
    end if;

    if p_amount_usd is null
       or p_amount_usd::pg_catalog.text in ('NaN', 'Infinity', '-Infinity')
       or p_amount_usd <= 0 then
      raise exception using
        errcode = 'ZB001',
        message = 'invalid payment event';
    end if;
  else
    if p_plan_id is null then
      v_plan_id := null;
    else
      v_plan_id := pg_catalog.btrim(p_plan_id);
      if v_plan_id = '' then
        v_plan_id := null;
      end if;
    end if;
    v_payment_id := null;
  end if;

  if p_email is null then
    v_email := null;
  else
    v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
    if v_email = '' then
      v_email := null;
    end if;
  end if;

  if p_square_customer_id is null then
    v_square_customer_id := null;
  else
    v_square_customer_id := pg_catalog.btrim(p_square_customer_id);
    if v_square_customer_id = '' then
      v_square_customer_id := null;
    end if;
  end if;

  if p_square_subscription_id is null then
    v_square_subscription_id := null;
  else
    v_square_subscription_id :=
      pg_catalog.btrim(p_square_subscription_id);
    if v_square_subscription_id = '' then
      v_square_subscription_id := null;
    end if;
  end if;

  if p_occurred_at is null then
    v_occurred_at := pg_catalog.now();
  else
    v_occurred_at := p_occurred_at;
  end if;

  if v_event_type = 'payment.succeeded' then
    if p_current_period_end is null then
      v_current_period_end :=
        pg_catalog.now() + '1 month'::pg_catalog.interval;
    else
      v_current_period_end := p_current_period_end;
    end if;
  else
    v_current_period_end := null;
  end if;

  insert into public.subscription_webhook_events (
    provider,
    event_id,
    event_type,
    payload_sha256,
    status,
    payment_id,
    subscription_id,
    user_id
  )
  values (
    v_provider,
    v_event_id,
    v_event_type,
    p_payload_sha256,
    'processing',
    v_payment_id,
    v_square_subscription_id,
    p_user_id
  )
  on conflict (provider, event_id) do nothing
  returning provider into v_claimed_provider;

  if v_claimed_provider is null then
    select
      e.event_type,
      e.payload_sha256,
      e.status
    into
      v_existing_event_type,
      v_existing_payload_sha256,
      v_existing_status
    from public.subscription_webhook_events as e
    where e.provider = v_provider
      and e.event_id = v_event_id
    for update;

    if not found then
      raise exception using
        errcode = 'ZB003',
        message = 'webhook event claim unavailable';
    end if;

    if v_existing_event_type is distinct from v_event_type
       or v_existing_payload_sha256 is distinct from p_payload_sha256 then
      raise exception using
        errcode = 'ZB002',
        message = 'webhook event identity conflict';
    end if;

    if v_existing_status = 'processed' then
      processed := false;
      replayed := true;
      resolved_user_id := p_user_id;
      subscription_status :=
        case
          when v_event_type = 'payment.succeeded' then 'active'
          when v_event_type = 'payment.failed' then 'past_due'
          else 'canceled'
        end;

      if v_event_type = 'subscription.canceled' then
        resolved_plan_id := null;
        if p_user_id is null then
          skipped_subscription := true;
        else
          select s.plan_id
          into resolved_plan_id
          from public.host_subscriptions as s
          where s.user_id = p_user_id;

          skipped_subscription := not found;
        end if;
      else
        skipped_subscription := p_user_id is null;
        resolved_plan_id := v_plan_id;
      end if;

      return next;
      return;
    end if;

    raise exception using
      errcode = 'ZB003',
      message = 'webhook event processing state conflict';
  end if;

  subscription_status :=
    case
      when v_event_type = 'payment.succeeded' then 'active'
      when v_event_type = 'payment.failed' then 'past_due'
      else 'canceled'
    end;
  resolved_user_id := p_user_id;

  if v_event_type = 'subscription.canceled' then
    -- BEGIN cancellation update-only branch
    resolved_plan_id := null;
    skipped_subscription := true;

    if p_user_id is not null then
      update public.host_subscriptions as s
      set
        email =
          case
            when v_email is null then s.email
            else v_email
          end,
        status = 'canceled',
        square_customer_id =
          case
            when v_square_customer_id is null
              then s.square_customer_id
            else v_square_customer_id
          end,
        square_subscription_id =
          case
            when v_square_subscription_id is null
              then s.square_subscription_id
            else v_square_subscription_id
          end,
        updated_at = v_occurred_at
      where s.user_id = p_user_id
      returning s.plan_id into resolved_plan_id;

      if found then
        skipped_subscription := false;
      end if;
    end if;
    -- END cancellation update-only branch
  else
    insert into public.subscription_payments (
      user_id,
      host_email,
      amount_usd,
      currency,
      plan_id,
      status,
      provider_event,
      provider_payment_id
    )
    values (
      p_user_id,
      v_email,
      p_amount_usd,
      'USD',
      v_plan_id,
      case
        when v_event_type = 'payment.succeeded' then 'succeeded'
        else 'failed'
      end,
      v_event_type,
      v_payment_id
    )
    on conflict (provider_payment_id) do update
    set
      user_id = excluded.user_id,
      host_email = excluded.host_email,
      amount_usd = excluded.amount_usd,
      currency = excluded.currency,
      plan_id = excluded.plan_id,
      status = excluded.status,
      provider_event = excluded.provider_event;

    resolved_plan_id := v_plan_id;
    if p_user_id is null then
      skipped_subscription := true;
    else
      insert into public.host_subscriptions (
        user_id,
        email,
        plan_id,
        status,
        monthly_usd,
        square_customer_id,
        square_subscription_id,
        current_period_end,
        last_payment_at,
        updated_at
      )
      values (
        p_user_id,
        v_email,
        v_plan_id,
        subscription_status,
        p_monthly_usd,
        v_square_customer_id,
        v_square_subscription_id,
        v_current_period_end,
        case
          when v_event_type = 'payment.succeeded' then v_occurred_at
          else null
        end,
        v_occurred_at
      )
      on conflict (user_id) do update
      set
        email = excluded.email,
        plan_id = excluded.plan_id,
        status = excluded.status,
        monthly_usd = excluded.monthly_usd,
        square_customer_id =
          case
            when v_square_customer_id is null
              then public.host_subscriptions.square_customer_id
            else excluded.square_customer_id
          end,
        square_subscription_id =
          case
            when v_square_subscription_id is null
              then public.host_subscriptions.square_subscription_id
            else excluded.square_subscription_id
          end,
        current_period_end =
          case
            when v_event_type = 'payment.succeeded'
              then excluded.current_period_end
            else public.host_subscriptions.current_period_end
          end,
        last_payment_at =
          case
            when v_event_type = 'payment.succeeded'
              then excluded.last_payment_at
            else public.host_subscriptions.last_payment_at
          end,
        updated_at = excluded.updated_at;

      skipped_subscription := false;
    end if;
  end if;

  update public.subscription_webhook_events as e
  set
    status = 'processed',
    processed_at = pg_catalog.now()
  where e.provider = v_provider
    and e.event_id = v_event_id
    and e.status = 'processing';

  get diagnostics v_processed_count = row_count;
  if v_processed_count <> 1 then
    raise exception using
      errcode = 'ZB003',
      message = 'webhook event finalization unavailable';
  end if;

  processed := true;
  replayed := false;
  return next;
end;
$$;

revoke all on function public.process_subscription_webhook_atomic(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.numeric,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.timestamptz,
  pg_catalog.timestamptz
) from public;
revoke all on function public.process_subscription_webhook_atomic(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.numeric,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.timestamptz,
  pg_catalog.timestamptz
) from anon;
revoke all on function public.process_subscription_webhook_atomic(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.numeric,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.timestamptz,
  pg_catalog.timestamptz
) from authenticated;
grant execute on function public.process_subscription_webhook_atomic(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.numeric,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.timestamptz,
  pg_catalog.timestamptz
) to service_role;
-- END subscription cancellation preserve plan RPC
-- END subscription webhook replay contract

create table if not exists public.host_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.host_profiles enable row level security;

drop policy if exists "host_profiles_own_select" on public.host_profiles;
create policy "host_profiles_own_select"
  on public.host_profiles for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "host_profiles_own_upsert" on public.host_profiles;
create policy "host_profiles_own_upsert"
  on public.host_profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "host_profiles_own_update" on public.host_profiles;
create policy "host_profiles_own_update"
  on public.host_profiles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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
  property_id text not null,
  reservation_id text not null,
  category text not null,
  storage_path text not null,
  image_url text not null,
  captured_at timestamptz not null default now(),
  staff_name text,
  content_type text,
  file_size int,
  notes text,
  report_id uuid,
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

alter table public.housekeeping_photos add column if not exists notes text;
alter table public.housekeeping_photos add column if not exists report_id uuid;

create table if not exists public.housekeeping_reports (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  property_name text,
  property_city text,
  reservation_id text,
  category text not null,
  notes text,
  staff_name text,
  photos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists housekeeping_reports_property_idx
  on public.housekeeping_reports (property_id, created_at desc);

alter table public.housekeeping_reports enable row level security;

drop policy if exists "hosts read housekeeping reports" on public.housekeeping_reports;
create policy "hosts read housekeeping reports"
  on public.housekeeping_reports for select
  to authenticated
  using (true);

create table if not exists public.host_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  body text not null,
  href text not null,
  report_id uuid,
  property_id text,
  created_at timestamptz not null default now()
);

alter table public.host_alerts enable row level security;

drop policy if exists "hosts read host alerts" on public.host_alerts;
create policy "hosts read host alerts"
  on public.host_alerts for select
  to authenticated
  using (true);

-- Property supply tracking (consumables per listing)
create table if not exists public.property_supplies (
  property_id text not null references public.properties (id) on delete cascade,
  sku text not null check (sku in ('toilet_paper', 'towels', 'coffee', 'soap_shampoo', 'trash_bags')),
  current_stock numeric not null default 0,
  min_threshold numeric not null default 1,
  unit text not null default 'units',
  restock_qty numeric not null default 1,
  last_turnover_at timestamptz,
  last_staff_name text,
  updated_at timestamptz not null default now(),
  primary key (property_id, sku)
);

create table if not exists public.property_supply_logs (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties (id) on delete cascade,
  event_type text not null check (event_type in ('turnover', 'restock', 'adjust')),
  staff_name text,
  reservation_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists property_supplies_updated_idx
  on public.property_supplies (updated_at desc);
create index if not exists property_supply_logs_property_idx
  on public.property_supply_logs (property_id, created_at desc);

alter table public.property_supplies enable row level security;
alter table public.property_supply_logs enable row level security;

drop policy if exists "anon all property_supplies" on public.property_supplies;
create policy "anon all property_supplies"
  on public.property_supplies for all to anon
  using (true) with check (true);

drop policy if exists "anon all property_supply_logs" on public.property_supply_logs;
create policy "anon all property_supply_logs"
  on public.property_supply_logs for all to anon
  using (true) with check (true);


