-- Microblock 7D3: narrow SECURITY DEFINER RPCs for Square host correlation.
-- Keeps canonical 7D1 host_subscriptions table ACL unchanged (no service_role DML).

begin;

-- BEGIN square billing host correlation RPCs

create or replace function public.square_billing_host_customer_owners(
  p_square_environment pg_catalog.text,
  p_square_customer_id pg_catalog.text
)
returns table (
  user_id pg_catalog.uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_environment pg_catalog.text;
  v_customer_id pg_catalog.text;
begin
  if p_square_environment is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square environment';
  end if;
  v_environment := pg_catalog.btrim(p_square_environment);
  if v_environment <> 'sandbox'
     and v_environment <> 'production' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square environment';
  end if;

  if p_square_customer_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square customer id';
  end if;
  v_customer_id := pg_catalog.btrim(p_square_customer_id);
  if v_customer_id = '' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square customer id';
  end if;

  return query
  select s.user_id
  from public.host_subscriptions as s
  where s.square_environment = v_environment
    and s.square_customer_id = v_customer_id;
end;
$$;

create or replace function public.square_billing_host_by_subscription(
  p_square_environment pg_catalog.text,
  p_square_subscription_id pg_catalog.text
)
returns table (
  user_id pg_catalog.uuid,
  plan_id pg_catalog.text,
  billing_cycle pg_catalog.text,
  billing_amount_usd pg_catalog.numeric,
  square_environment pg_catalog.text,
  square_location_id pg_catalog.text,
  square_plan_variation_id pg_catalog.text,
  square_customer_id pg_catalog.text,
  square_subscription_id pg_catalog.text,
  square_subscription_status pg_catalog.text,
  square_subscription_version pg_catalog.numeric,
  square_start_date pg_catalog.date,
  square_charged_through_date pg_catalog.date,
  square_canceled_date pg_catalog.date,
  complimentary_ends_at pg_catalog.timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_environment pg_catalog.text;
  v_subscription_id pg_catalog.text;
begin
  if p_square_environment is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square environment';
  end if;
  v_environment := pg_catalog.btrim(p_square_environment);
  if v_environment <> 'sandbox'
     and v_environment <> 'production' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square environment';
  end if;

  if p_square_subscription_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square subscription id';
  end if;
  v_subscription_id := pg_catalog.btrim(p_square_subscription_id);
  if v_subscription_id = '' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square subscription id';
  end if;

  return query
  select
    s.user_id,
    s.plan_id,
    s.billing_cycle,
    s.billing_amount_usd,
    s.square_environment,
    s.square_location_id,
    s.square_plan_variation_id,
    s.square_customer_id,
    s.square_subscription_id,
    s.square_subscription_status,
    s.square_subscription_version::pg_catalog.numeric,
    s.square_start_date,
    s.square_charged_through_date,
    s.square_canceled_date,
    s.complimentary_ends_at
  from public.host_subscriptions as s
  where s.square_environment = v_environment
    and s.square_subscription_id = v_subscription_id;
end;
$$;

create or replace function public.square_billing_upsert_host_square_correlation(
  p_user_id pg_catalog.uuid,
  p_plan_id pg_catalog.text,
  p_billing_cycle pg_catalog.text,
  p_billing_amount_usd pg_catalog.numeric,
  p_square_environment pg_catalog.text,
  p_square_location_id pg_catalog.text,
  p_square_plan_variation_id pg_catalog.text,
  p_square_customer_id pg_catalog.text,
  p_square_subscription_id pg_catalog.text,
  p_square_subscription_status pg_catalog.text,
  p_square_subscription_version pg_catalog.numeric default null,
  p_square_start_date pg_catalog.date default null,
  p_square_charged_through_date pg_catalog.date default null,
  p_square_canceled_date pg_catalog.date default null,
  p_complimentary_ends_at pg_catalog.timestamptz default null
)
returns table (
  user_id pg_catalog.uuid,
  plan_id pg_catalog.text,
  billing_cycle pg_catalog.text,
  billing_amount_usd pg_catalog.numeric,
  square_environment pg_catalog.text,
  square_location_id pg_catalog.text,
  square_plan_variation_id pg_catalog.text,
  square_customer_id pg_catalog.text,
  square_subscription_id pg_catalog.text,
  square_subscription_status pg_catalog.text,
  square_subscription_version pg_catalog.numeric,
  square_start_date pg_catalog.date,
  square_charged_through_date pg_catalog.date,
  square_canceled_date pg_catalog.date,
  complimentary_ends_at pg_catalog.timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id pg_catalog.uuid;
  v_plan_id pg_catalog.text;
  v_billing_cycle pg_catalog.text;
  v_billing_amount_usd pg_catalog.numeric(10, 2);
  v_environment pg_catalog.text;
  v_location_id pg_catalog.text;
  v_plan_variation_id pg_catalog.text;
  v_customer_id pg_catalog.text;
  v_subscription_id pg_catalog.text;
  v_subscription_status pg_catalog.text;
  v_subscription_version pg_catalog.int8;
  v_now pg_catalog.timestamptz := pg_catalog.now();
begin
  if p_user_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid user id';
  end if;
  v_user_id := p_user_id;

  if p_plan_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid plan id';
  end if;
  v_plan_id := pg_catalog.btrim(p_plan_id);
  if v_plan_id <> 'starter'
     and v_plan_id <> 'pro'
     and v_plan_id <> 'portfolio'
     and v_plan_id <> 'agency' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid plan id';
  end if;

  if p_billing_cycle is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid billing cycle';
  end if;
  v_billing_cycle := pg_catalog.btrim(p_billing_cycle);
  if v_billing_cycle <> 'monthly'
     and v_billing_cycle <> 'annual' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid billing cycle';
  end if;

  if p_billing_amount_usd is null
     or p_billing_amount_usd::pg_catalog.text in ('NaN', 'Infinity', '-Infinity')
     or p_billing_amount_usd <= 0 then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid billing amount';
  end if;
  v_billing_amount_usd := p_billing_amount_usd;

  if p_square_environment is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square environment';
  end if;
  v_environment := pg_catalog.btrim(p_square_environment);
  if v_environment <> 'sandbox'
     and v_environment <> 'production' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square environment';
  end if;

  if p_square_location_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square location id';
  end if;
  v_location_id := pg_catalog.btrim(p_square_location_id);
  if v_location_id = '' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square location id';
  end if;

  if p_square_plan_variation_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square plan variation id';
  end if;
  v_plan_variation_id := pg_catalog.btrim(p_square_plan_variation_id);
  if v_plan_variation_id = '' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square plan variation id';
  end if;

  if p_square_customer_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square customer id';
  end if;
  v_customer_id := pg_catalog.btrim(p_square_customer_id);
  if v_customer_id = '' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square customer id';
  end if;

  if p_square_subscription_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square subscription id';
  end if;
  v_subscription_id := pg_catalog.btrim(p_square_subscription_id);
  if v_subscription_id = '' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square subscription id';
  end if;

  if p_square_subscription_status is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square subscription status';
  end if;
  v_subscription_status := pg_catalog.btrim(p_square_subscription_status);
  if v_subscription_status = '' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid square subscription status';
  end if;

  if p_square_subscription_version is not null then
    if p_square_subscription_version::pg_catalog.text in ('NaN', 'Infinity', '-Infinity')
       or p_square_subscription_version < 0
       or p_square_subscription_version <> pg_catalog.trunc(p_square_subscription_version) then
      raise exception using
        errcode = 'ZB001',
        message = 'invalid square subscription version';
    end if;
    v_subscription_version := p_square_subscription_version::pg_catalog.int8;
  else
    v_subscription_version := null;
  end if;

  if exists (
    select 1
    from public.host_subscriptions as s
    where s.square_environment = v_environment
      and s.square_customer_id = v_customer_id
      and s.user_id <> v_user_id
  ) then
    raise exception using
      errcode = 'ZB409',
      message = 'square customer ownership conflict';
  end if;

  if exists (
    select 1
    from public.host_subscriptions as s
    where s.square_environment = v_environment
      and s.square_subscription_id = v_subscription_id
      and s.user_id <> v_user_id
  ) then
    raise exception using
      errcode = 'ZB409',
      message = 'square subscription ownership conflict';
  end if;

  insert into public.host_subscriptions (
    user_id,
    plan_id,
    status,
    monthly_usd,
    billing_cycle,
    billing_amount_usd,
    square_environment,
    square_location_id,
    square_plan_variation_id,
    square_customer_id,
    square_subscription_id,
    square_subscription_status,
    square_subscription_version,
    square_start_date,
    square_charged_through_date,
    square_canceled_date,
    complimentary_ends_at,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    v_plan_id,
    'active',
    v_billing_amount_usd,
    v_billing_cycle,
    v_billing_amount_usd,
    v_environment,
    v_location_id,
    v_plan_variation_id,
    v_customer_id,
    v_subscription_id,
    v_subscription_status,
    v_subscription_version,
    p_square_start_date,
    p_square_charged_through_date,
    p_square_canceled_date,
    p_complimentary_ends_at,
    v_now,
    v_now
  )
  on conflict (user_id) do update
  set
    plan_id = excluded.plan_id,
    billing_cycle = excluded.billing_cycle,
    billing_amount_usd = excluded.billing_amount_usd,
    monthly_usd = excluded.monthly_usd,
    square_environment = excluded.square_environment,
    square_location_id = excluded.square_location_id,
    square_plan_variation_id = excluded.square_plan_variation_id,
    square_customer_id = excluded.square_customer_id,
    square_subscription_id = excluded.square_subscription_id,
    square_subscription_status = excluded.square_subscription_status,
    square_subscription_version = excluded.square_subscription_version,
    square_start_date = excluded.square_start_date,
    square_charged_through_date = excluded.square_charged_through_date,
    square_canceled_date = excluded.square_canceled_date,
    complimentary_ends_at = excluded.complimentary_ends_at,
    updated_at = v_now;

  return query
  select
    s.user_id,
    s.plan_id,
    s.billing_cycle,
    s.billing_amount_usd,
    s.square_environment,
    s.square_location_id,
    s.square_plan_variation_id,
    s.square_customer_id,
    s.square_subscription_id,
    s.square_subscription_status,
    s.square_subscription_version::pg_catalog.numeric,
    s.square_start_date,
    s.square_charged_through_date,
    s.square_canceled_date,
    s.complimentary_ends_at
  from public.host_subscriptions as s
  where s.user_id = v_user_id;
end;
$$;

revoke all on function public.square_billing_host_customer_owners(
  pg_catalog.text,
  pg_catalog.text
) from public;
revoke all on function public.square_billing_host_customer_owners(
  pg_catalog.text,
  pg_catalog.text
) from anon;
revoke all on function public.square_billing_host_customer_owners(
  pg_catalog.text,
  pg_catalog.text
) from authenticated;
grant execute on function public.square_billing_host_customer_owners(
  pg_catalog.text,
  pg_catalog.text
) to service_role;

revoke all on function public.square_billing_host_by_subscription(
  pg_catalog.text,
  pg_catalog.text
) from public;
revoke all on function public.square_billing_host_by_subscription(
  pg_catalog.text,
  pg_catalog.text
) from anon;
revoke all on function public.square_billing_host_by_subscription(
  pg_catalog.text,
  pg_catalog.text
) from authenticated;
grant execute on function public.square_billing_host_by_subscription(
  pg_catalog.text,
  pg_catalog.text
) to service_role;

revoke all on function public.square_billing_upsert_host_square_correlation(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.date,
  pg_catalog.date,
  pg_catalog.date,
  pg_catalog.timestamptz
) from public;
revoke all on function public.square_billing_upsert_host_square_correlation(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.date,
  pg_catalog.date,
  pg_catalog.date,
  pg_catalog.timestamptz
) from anon;
revoke all on function public.square_billing_upsert_host_square_correlation(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.date,
  pg_catalog.date,
  pg_catalog.date,
  pg_catalog.timestamptz
) from authenticated;
grant execute on function public.square_billing_upsert_host_square_correlation(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.date,
  pg_catalog.date,
  pg_catalog.date,
  pg_catalog.timestamptz
) to service_role;

-- END square billing host correlation RPCs

commit;
