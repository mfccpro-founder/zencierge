-- Replace the founder payment page so varchar columns match the text result.
-- payment_status is character varying(50). gateway_payment_id is character varying(255).
-- RETURNS TABLE requires those exact result types, so both are cast to text.
-- Does not change host_subscriptions, the 7D1 table ACL, or existing policies.

begin;

-- BEGIN founder backoffice subscription payments text casts

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
      p.payment_status::pg_catalog.text,
      p.provider_payment_id,
      p.gateway_payment_id::pg_catalog.text,
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
    p.payment_status::pg_catalog.text,
    p.provider_payment_id,
    p.gateway_payment_id::pg_catalog.text,
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

-- END founder backoffice subscription payments text casts

commit;
