-- Founder Back Office read path for income and MRR.
-- Does not change the 7D1 table ACL or existing RLS policies.
-- service_role still has no SELECT on these tables.
-- A normal host cannot execute these functions. Their JWT still matches
-- only auth.uid() = user_id through the existing SELECT policies.
-- Run in the Supabase SQL editor. Do not apply from the app.

begin;

-- BEGIN founder backoffice billing read

create or replace function public.founder_backoffice_host_subscriptions_page(
  p_after_created_at pg_catalog.timestamptz,
  p_after_user_id pg_catalog.uuid,
  p_limit pg_catalog.int4
)
returns table (
  user_id pg_catalog.uuid,
  email pg_catalog.text,
  plan_id pg_catalog.text,
  status pg_catalog.text,
  current_period_end pg_catalog.timestamptz,
  last_payment_at pg_catalog.timestamptz,
  square_customer_id pg_catalog.text,
  square_subscription_id pg_catalog.text,
  is_lifetime_free pg_catalog.bool,
  complimentary_starts_at pg_catalog.timestamptz,
  complimentary_ends_at pg_catalog.timestamptz,
  complimentary_granted_by pg_catalog.uuid,
  created_at pg_catalog.timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_limit pg_catalog.int4;
begin
  if (p_after_created_at is null) <> (p_after_user_id is null) then
    raise exception using
      errcode = '22023',
      message = 'incomplete host subscription read cursor';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 1000), 1), 1000);

  return query
  select
    s.user_id,
    s.email,
    s.plan_id,
    s.status,
    s.current_period_end,
    s.last_payment_at,
    s.square_customer_id,
    s.square_subscription_id,
    s.is_lifetime_free,
    s.complimentary_starts_at,
    s.complimentary_ends_at,
    s.complimentary_granted_by,
    s.created_at
  from public.host_subscriptions as s
  where p_after_created_at is null
     or s.created_at > p_after_created_at
     or (s.created_at = p_after_created_at and s.user_id > p_after_user_id)
  order by s.created_at asc, s.user_id asc
  limit v_limit;
end;
$$;

comment on function public.founder_backoffice_host_subscriptions_page(
  pg_catalog.timestamptz,
  pg_catalog.uuid,
  pg_catalog.int4
) is
  'Founder Back Office MRR page. Execute is service_role only. No host-scoped argument.';

create or replace function public.founder_backoffice_subscription_payments_page(
  p_from pg_catalog.timestamptz,
  p_to pg_catalog.timestamptz,
  p_after_created_at pg_catalog.timestamptz,
  p_after_id pg_catalog.uuid,
  p_limit pg_catalog.int4,
  p_newest_first pg_catalog.bool
)
returns table (
  id pg_catalog.uuid,
  user_id pg_catalog.uuid,
  subscription_id pg_catalog.uuid,
  host_email pg_catalog.text,
  amount_usd pg_catalog.numeric,
  amount_paid pg_catalog.numeric,
  plan_id pg_catalog.text,
  status pg_catalog.text,
  payment_status pg_catalog.text,
  provider_payment_id pg_catalog.text,
  gateway_payment_id pg_catalog.text,
  created_at pg_catalog.timestamptz,
  paid_at pg_catalog.timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_limit pg_catalog.int4;
begin
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception using
      errcode = '22023',
      message = 'incomplete subscription payment read cursor';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception using
      errcode = '22023',
      message = 'invalid subscription payment read range';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 1000), 1), 1000);

  -- Income keeps created_at >= p_from and created_at < p_to.
  -- created_at is not null and id is the primary key, so the cursor is unique.
  -- p_newest_first walks the same window from the newest row for the 500-row health sample.
  if coalesce(p_newest_first, false) then
    return query
    select
      p.id,
      p.user_id,
      p.subscription_id,
      p.host_email,
      p.amount_usd,
      p.amount_paid,
      p.plan_id,
      p.status,
      p.payment_status,
      p.provider_payment_id,
      p.gateway_payment_id,
      p.created_at,
      p.paid_at
    from public.subscription_payments as p
    where (p_from is null or p.created_at >= p_from)
      and (p_to is null or p.created_at < p_to)
      and (
        p_after_created_at is null
        or p.created_at < p_after_created_at
        or (p.created_at = p_after_created_at and p.id < p_after_id)
      )
    order by p.created_at desc, p.id desc
    limit v_limit;
    return;
  end if;

  return query
  select
    p.id,
    p.user_id,
    p.subscription_id,
    p.host_email,
    p.amount_usd,
    p.amount_paid,
    p.plan_id,
    p.status,
    p.payment_status,
    p.provider_payment_id,
    p.gateway_payment_id,
    p.created_at,
    p.paid_at
  from public.subscription_payments as p
  where (p_from is null or p.created_at >= p_from)
    and (p_to is null or p.created_at < p_to)
    and (
      p_after_created_at is null
      or p.created_at > p_after_created_at
      or (p.created_at = p_after_created_at and p.id > p_after_id)
    )
  order by p.created_at asc, p.id asc
  limit v_limit;
end;
$$;

comment on function public.founder_backoffice_subscription_payments_page(
  pg_catalog.timestamptz,
  pg_catalog.timestamptz,
  pg_catalog.timestamptz,
  pg_catalog.uuid,
  pg_catalog.int4,
  pg_catalog.bool
) is
  'Founder Back Office collected-income page. Execute is service_role only. No host-scoped argument.';

revoke all on function public.founder_backoffice_host_subscriptions_page(
  pg_catalog.timestamptz,
  pg_catalog.uuid,
  pg_catalog.int4
) from public;
revoke all on function public.founder_backoffice_host_subscriptions_page(
  pg_catalog.timestamptz,
  pg_catalog.uuid,
  pg_catalog.int4
) from anon;
revoke all on function public.founder_backoffice_host_subscriptions_page(
  pg_catalog.timestamptz,
  pg_catalog.uuid,
  pg_catalog.int4
) from authenticated;
grant execute on function public.founder_backoffice_host_subscriptions_page(
  pg_catalog.timestamptz,
  pg_catalog.uuid,
  pg_catalog.int4
) to service_role;

revoke all on function public.founder_backoffice_subscription_payments_page(
  pg_catalog.timestamptz,
  pg_catalog.timestamptz,
  pg_catalog.timestamptz,
  pg_catalog.uuid,
  pg_catalog.int4,
  pg_catalog.bool
) from public;
revoke all on function public.founder_backoffice_subscription_payments_page(
  pg_catalog.timestamptz,
  pg_catalog.timestamptz,
  pg_catalog.timestamptz,
  pg_catalog.uuid,
  pg_catalog.int4,
  pg_catalog.bool
) from anon;
revoke all on function public.founder_backoffice_subscription_payments_page(
  pg_catalog.timestamptz,
  pg_catalog.timestamptz,
  pg_catalog.timestamptz,
  pg_catalog.uuid,
  pg_catalog.int4,
  pg_catalog.bool
) from authenticated;
grant execute on function public.founder_backoffice_subscription_payments_page(
  pg_catalog.timestamptz,
  pg_catalog.timestamptz,
  pg_catalog.timestamptz,
  pg_catalog.uuid,
  pg_catalog.int4,
  pg_catalog.bool
) to service_role;

-- END founder backoffice billing read

commit;
