begin;

-- BEGIN square subscription status webhook
-- Durable Square subscription.created / subscription.updated reconciliation.
-- Service-role only. Do not apply this file from the application.
-- Does not replace public.process_subscription_webhook_atomic.

alter table public.subscription_webhook_events
  drop constraint subscription_webhook_events_event_type_check;

alter table public.subscription_webhook_events
  add constraint subscription_webhook_events_event_type_check
    check (
      event_type in (
        'payment.succeeded',
        'payment.failed',
        'subscription.canceled',
        'subscription.created',
        'subscription.updated'
      )
    );

create or replace function public.square_billing_apply_subscription_status_webhook(
  p_provider pg_catalog.text,
  p_event_id pg_catalog.text,
  p_event_type pg_catalog.text,
  p_payload_sha256 pg_catalog.text,
  p_square_environment pg_catalog.text,
  p_square_subscription_id pg_catalog.text,
  p_square_customer_id pg_catalog.text,
  p_square_location_id pg_catalog.text,
  p_square_plan_variation_id pg_catalog.text,
  p_square_subscription_status pg_catalog.text,
  p_square_subscription_version pg_catalog.numeric,
  p_square_start_date pg_catalog.date,
  p_square_charged_through_date pg_catalog.date,
  p_square_canceled_date pg_catalog.date
)
returns table (
  processed pg_catalog.bool,
  replayed pg_catalog.bool,
  skipped_host pg_catalog.bool,
  resolved_user_id pg_catalog.uuid,
  local_status pg_catalog.text,
  applied_square_status pg_catalog.text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_provider pg_catalog.text;
  v_event_id pg_catalog.text;
  v_event_type pg_catalog.text;
  v_environment pg_catalog.text;
  v_subscription_id pg_catalog.text;
  v_customer_id pg_catalog.text;
  v_location_id pg_catalog.text;
  v_plan_variation_id pg_catalog.text;
  v_square_status pg_catalog.text;
  v_incoming_version pg_catalog.int8;
  v_local_status pg_catalog.text;
  v_claimed_provider pg_catalog.text;
  v_existing_event_type pg_catalog.text;
  v_existing_payload_sha256 pg_catalog.text;
  v_existing_status pg_catalog.text;
  v_match_count pg_catalog.int8;
  v_host_user_id pg_catalog.uuid;
  v_stored_version pg_catalog.int8;
begin
  if p_provider is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_provider := pg_catalog.btrim(p_provider);
  if v_provider <> 'square' then
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
  if v_event_type <> 'subscription.created'
     and v_event_type <> 'subscription.updated' then
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

  if p_square_environment is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_environment := pg_catalog.btrim(p_square_environment);
  if v_environment <> 'sandbox'
     and v_environment <> 'production' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  if p_square_subscription_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_subscription_id := pg_catalog.btrim(p_square_subscription_id);
  if v_subscription_id = '' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  if p_square_customer_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_customer_id := pg_catalog.btrim(p_square_customer_id);
  if v_customer_id = '' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  if p_square_location_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_location_id := pg_catalog.btrim(p_square_location_id);
  if v_location_id = '' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  if p_square_plan_variation_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_plan_variation_id := pg_catalog.btrim(p_square_plan_variation_id);
  if v_plan_variation_id = '' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  if p_square_subscription_status is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_square_status := pg_catalog.btrim(p_square_subscription_status);
  if v_square_status <> 'ACTIVE'
     and v_square_status <> 'PENDING'
     and v_square_status <> 'PAUSED'
     and v_square_status <> 'DEACTIVATED'
     and v_square_status <> 'COMPLETED'
     and v_square_status <> 'CANCELED' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  if p_square_subscription_version is null
     or p_square_subscription_version::pg_catalog.text in (
       'NaN',
       'Infinity',
       '-Infinity'
     )
     or p_square_subscription_version < 0
     or p_square_subscription_version <> pg_catalog.trunc(p_square_subscription_version)
     or p_square_subscription_version > 9223372036854775807::pg_catalog.numeric then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_incoming_version := p_square_subscription_version::pg_catalog.int8;

  v_local_status :=
    case v_square_status
      when 'ACTIVE' then 'active'
      when 'CANCELED' then 'canceled'
      else 'inactive'
    end;

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
    null,
    v_subscription_id,
    null
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
      skipped_host := true;
      resolved_user_id := null;
      local_status := null;
      applied_square_status := null;
      return next;
      return;
    end if;

    raise exception using
      errcode = 'ZB003',
      message = 'webhook event processing state conflict';
  end if;

  select
    count(*)::pg_catalog.int8
  into v_match_count
  from public.host_subscriptions as s
  where s.square_environment = v_environment
    and s.square_subscription_id = v_subscription_id
    and s.square_customer_id = v_customer_id
    and s.square_location_id = v_location_id
    and s.square_plan_variation_id = v_plan_variation_id;

  if v_match_count > 1 then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  if v_match_count = 1 then
    select
      s.user_id,
      s.square_subscription_version
    into
      v_host_user_id,
      v_stored_version
    from public.host_subscriptions as s
    where s.square_environment = v_environment
      and s.square_subscription_id = v_subscription_id
      and s.square_customer_id = v_customer_id
      and s.square_location_id = v_location_id
      and s.square_plan_variation_id = v_plan_variation_id
    for update;
  end if;

  if v_match_count = 1
     and (
       v_stored_version is null
       or v_stored_version < v_incoming_version
     ) then
    update public.host_subscriptions as s
    set
      status = v_local_status,
      square_subscription_status = v_square_status,
      square_subscription_version = v_incoming_version,
      square_start_date = coalesce(
        p_square_start_date,
        s.square_start_date
      ),
      square_charged_through_date = coalesce(
        p_square_charged_through_date,
        s.square_charged_through_date
      ),
      square_canceled_date = coalesce(
        p_square_canceled_date,
        s.square_canceled_date
      ),
      updated_at = pg_catalog.now()
    where s.user_id = v_host_user_id;

    update public.subscription_webhook_events as e
    set
      status = 'processed',
      processed_at = pg_catalog.now(),
      user_id = v_host_user_id,
      subscription_id = v_subscription_id
    where e.provider = v_provider
      and e.event_id = v_event_id
      and e.status = 'processing';

    processed := true;
    replayed := false;
    skipped_host := false;
    resolved_user_id := v_host_user_id;
    local_status := v_local_status;
    applied_square_status := v_square_status;
    return next;
    return;
  end if;

  update public.subscription_webhook_events as e
  set
    status = 'processed',
    processed_at = pg_catalog.now(),
    user_id = v_host_user_id,
    subscription_id = v_subscription_id
  where e.provider = v_provider
    and e.event_id = v_event_id
    and e.status = 'processing';

  processed := true;
  replayed := false;
  skipped_host := true;
  resolved_user_id := v_host_user_id;
  local_status := null;
  applied_square_status := null;
  return next;
end;
$$;

revoke all on function public.square_billing_apply_subscription_status_webhook(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.date,
  pg_catalog.date,
  pg_catalog.date
) from public;
revoke all on function public.square_billing_apply_subscription_status_webhook(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.date,
  pg_catalog.date,
  pg_catalog.date
) from anon;
revoke all on function public.square_billing_apply_subscription_status_webhook(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.date,
  pg_catalog.date,
  pg_catalog.date
) from authenticated;
grant execute on function public.square_billing_apply_subscription_status_webhook(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.numeric,
  pg_catalog.date,
  pg_catalog.date,
  pg_catalog.date
) to service_role;
-- END square subscription status webhook

commit;
