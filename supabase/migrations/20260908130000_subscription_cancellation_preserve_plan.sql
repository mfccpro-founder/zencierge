-- Billing Phase 2A Microblock 6D: preserve subscription metadata on cancellation.
-- Service-role only. Do not apply this file from the application.

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