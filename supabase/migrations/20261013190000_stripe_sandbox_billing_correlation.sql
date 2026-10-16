-- Stripe Sandbox isolated correlation (Checkout sessions, webhook events, invoices).
-- Additive. Does not alter Square, host_subscriptions, subscription_payments,
-- subscription_webhook_events, or product-access RPCs.
-- Does not grant host access. Service-role RPCs only.
-- Do not apply this file from the application.

begin;

do $stripe_sandbox_billing_correlation_preflight$
declare
  v_name pg_catalog.text;
begin
  foreach v_name in array array[
    'stripe_sandbox_checkout_sessions',
    'stripe_sandbox_webhook_events',
    'stripe_sandbox_invoices'
  ]
  loop
    if pg_catalog.to_regclass('public.' || v_name) is not null then
      raise exception using
        errcode = '55000',
        message = 'Stripe Sandbox billing correlation objects already exist';
    end if;
  end loop;

  if pg_catalog.to_regprocedure(
       'public.stripe_sandbox_register_checkout_session(uuid,text,text,text)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.stripe_sandbox_attach_stripe_session_id(uuid,text)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.stripe_sandbox_apply_webhook_event(text,text,text,text,text,text,text)'
     ) is not null then
    raise exception using
      errcode = '55000',
      message = 'Stripe Sandbox billing correlation RPCs already exist';
  end if;
end;
$stripe_sandbox_billing_correlation_preflight$;

-- BEGIN stripe sandbox billing correlation schema

create table public.stripe_sandbox_checkout_sessions (
  id pg_catalog.uuid primary key default pg_catalog.gen_random_uuid(),
  user_id pg_catalog.uuid not null
    references auth.users (id) on delete cascade,
  plan_id pg_catalog.text not null,
  billing_cycle pg_catalog.text not null,
  expected_price_id pg_catalog.text not null,
  stripe_session_id pg_catalog.text,
  stripe_subscription_id pg_catalog.text,
  status pg_catalog.text not null default 'pending',
  created_at pg_catalog.timestamptz not null default pg_catalog.now(),
  updated_at pg_catalog.timestamptz not null default pg_catalog.now(),
  constraint stripe_sandbox_checkout_sessions_plan_id_check
    check (plan_id in ('starter', 'pro', 'portfolio', 'agency')),
  constraint stripe_sandbox_checkout_sessions_billing_cycle_check
    check (billing_cycle in ('monthly', 'annual')),
  constraint stripe_sandbox_checkout_sessions_price_id_check
    check (expected_price_id ~ '^price_[A-Za-z0-9_]+$'),
  constraint stripe_sandbox_checkout_sessions_session_id_check
    check (
      stripe_session_id is null
      or pg_catalog.btrim(stripe_session_id) <> ''
    ),
  constraint stripe_sandbox_checkout_sessions_subscription_id_check
    check (
      stripe_subscription_id is null
      or pg_catalog.btrim(stripe_subscription_id) <> ''
    ),
  constraint stripe_sandbox_checkout_sessions_status_check
    check (status in ('pending', 'open', 'correlated')),
  constraint stripe_sandbox_checkout_sessions_stripe_session_id_key
    unique (stripe_session_id)
);

create unique index stripe_sandbox_checkout_sessions_subscription_id_idx
  on public.stripe_sandbox_checkout_sessions (stripe_subscription_id)
  where stripe_subscription_id is not null;

comment on table public.stripe_sandbox_checkout_sessions is
  'Local Stripe Sandbox Checkout rows created for an authenticated user before Stripe is called. Isolated from Square and host_subscriptions.';

create table public.stripe_sandbox_webhook_events (
  event_id pg_catalog.text primary key,
  payload_sha256 pg_catalog.text not null,
  event_type pg_catalog.text not null,
  status pg_catalog.text not null,
  invoice_id pg_catalog.text,
  checkout_session_id pg_catalog.uuid
    references public.stripe_sandbox_checkout_sessions (id),
  stripe_subscription_id pg_catalog.text,
  stripe_session_id pg_catalog.text,
  client_reference_id pg_catalog.text,
  received_at pg_catalog.timestamptz not null default pg_catalog.now(),
  processed_at pg_catalog.timestamptz,
  constraint stripe_sandbox_webhook_events_event_id_check
    check (pg_catalog.btrim(event_id) <> ''),
  constraint stripe_sandbox_webhook_events_payload_sha256_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint stripe_sandbox_webhook_events_event_type_check
    check (
      event_type in (
        'checkout.session.completed',
        'invoice.paid'
      )
    ),
  constraint stripe_sandbox_webhook_events_status_check
    check (
      status in (
        'processing',
        'awaiting_correlation',
        'correlated',
        'applied',
        'unrelated',
        'conflict',
        'duplicate_invoice'
      )
    ),
  constraint stripe_sandbox_webhook_events_processed_state_check
    check (
      (
        status in ('processing', 'awaiting_correlation')
        and processed_at is null
      )
      or (
        status in (
          'correlated',
          'applied',
          'unrelated',
          'conflict',
          'duplicate_invoice'
        )
        and processed_at is not null
      )
    )
);

comment on table public.stripe_sandbox_webhook_events is
  'Stripe Sandbox webhook ledger. awaiting_correlation remains reprocessable. applied is used only after an invoice row is inserted.';

create table public.stripe_sandbox_invoices (
  invoice_id pg_catalog.text primary key,
  checkout_session_id pg_catalog.uuid not null
    references public.stripe_sandbox_checkout_sessions (id),
  stripe_subscription_id pg_catalog.text not null,
  webhook_event_id pg_catalog.text not null
    references public.stripe_sandbox_webhook_events (event_id),
  created_at pg_catalog.timestamptz not null default pg_catalog.now(),
  constraint stripe_sandbox_invoices_invoice_id_check
    check (pg_catalog.btrim(invoice_id) <> ''),
  constraint stripe_sandbox_invoices_subscription_id_check
    check (pg_catalog.btrim(stripe_subscription_id) <> ''),
  constraint stripe_sandbox_invoices_webhook_event_id_key
    unique (webhook_event_id)
);

create index stripe_sandbox_invoices_subscription_id_idx
  on public.stripe_sandbox_invoices (
    stripe_subscription_id,
    created_at desc
  );

create index stripe_sandbox_invoices_checkout_session_id_idx
  on public.stripe_sandbox_invoices (
    checkout_session_id,
    created_at desc
  );

create index stripe_sandbox_webhook_events_awaiting_idx
  on public.stripe_sandbox_webhook_events (received_at, event_id)
  where status = 'awaiting_correlation';

comment on table public.stripe_sandbox_invoices is
  'Stripe Sandbox invoices correlated to a local Checkout session. stripe_subscription_id is not unique so renewals can accumulate.';

alter table public.stripe_sandbox_checkout_sessions enable row level security;
alter table public.stripe_sandbox_webhook_events enable row level security;
alter table public.stripe_sandbox_invoices enable row level security;

revoke all on table public.stripe_sandbox_checkout_sessions from public;
revoke all on table public.stripe_sandbox_checkout_sessions from anon;
revoke all on table public.stripe_sandbox_checkout_sessions from authenticated;
revoke all on table public.stripe_sandbox_checkout_sessions from service_role;
grant select on table public.stripe_sandbox_checkout_sessions to service_role;

revoke all on table public.stripe_sandbox_webhook_events from public;
revoke all on table public.stripe_sandbox_webhook_events from anon;
revoke all on table public.stripe_sandbox_webhook_events from authenticated;
revoke all on table public.stripe_sandbox_webhook_events from service_role;
grant select on table public.stripe_sandbox_webhook_events to service_role;

revoke all on table public.stripe_sandbox_invoices from public;
revoke all on table public.stripe_sandbox_invoices from anon;
revoke all on table public.stripe_sandbox_invoices from authenticated;
revoke all on table public.stripe_sandbox_invoices from service_role;
grant select on table public.stripe_sandbox_invoices to service_role;

-- END stripe sandbox billing correlation schema

-- BEGIN stripe sandbox billing correlation RPCs

-- One transaction-scoped advisory lock for every writer RPC.
-- Sandbox volume is low; serializing writers avoids mixed per-entity lock
-- orders (deadlocks) at the cost of no concurrent Stripe Sandbox writes.
create or replace function public.stripe_sandbox_acquire_writer_lock()
returns pg_catalog.void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('zencierge.stripe_sandbox.writer', 0)
  );
end;
$$;

create or replace function public.stripe_sandbox_advance_claimed_event(
  p_event_id pg_catalog.text
)
returns pg_catalog.text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_event public.stripe_sandbox_webhook_events%rowtype;
  v_ref pg_catalog.uuid;
  v_match_count pg_catalog.int4;
  v_checkout public.stripe_sandbox_checkout_sessions%rowtype;
  v_inserted pg_catalog.text;
  v_owner pg_catalog.text;
  v_existing_checkout pg_catalog.uuid;
  v_existing_sub pg_catalog.text;
  v_now pg_catalog.timestamptz := pg_catalog.now();
begin
  perform public.stripe_sandbox_acquire_writer_lock();

  select e.*
  into v_event
  from public.stripe_sandbox_webhook_events as e
  where e.event_id = p_event_id
  for update;

  if not found then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  if v_event.status is distinct from 'processing'
     and v_event.status is distinct from 'awaiting_correlation' then
    return v_event.status;
  end if;

  if v_event.event_type = 'invoice.paid' then
    if v_event.invoice_id is null then
      update public.stripe_sandbox_webhook_events as e
      set
        status = 'unrelated',
        processed_at = v_now
      where e.event_id = v_event.event_id;
      return 'unrelated';
    end if;

    if v_event.stripe_subscription_id is null then
      update public.stripe_sandbox_webhook_events as e
      set
        status = 'unrelated',
        processed_at = v_now
      where e.event_id = v_event.event_id;
      return 'unrelated';
    end if;

    select pg_catalog.count(*)::pg_catalog.int4
    into v_match_count
    from public.stripe_sandbox_checkout_sessions as s
    where s.stripe_subscription_id = v_event.stripe_subscription_id;

    if v_match_count > 1 then
      update public.stripe_sandbox_webhook_events as e
      set
        status = 'conflict',
        processed_at = v_now
      where e.event_id = v_event.event_id;
      return 'conflict';
    end if;

    if v_match_count = 0 then
      update public.stripe_sandbox_webhook_events as e
      set
        status = 'awaiting_correlation',
        processed_at = null
      where e.event_id = v_event.event_id;
      return 'awaiting_correlation';
    end if;

    select s.*
    into v_checkout
    from public.stripe_sandbox_checkout_sessions as s
    where s.stripe_subscription_id = v_event.stripe_subscription_id
    order by s.id
    for update;

    insert into public.stripe_sandbox_invoices as i (
      invoice_id,
      checkout_session_id,
      stripe_subscription_id,
      webhook_event_id
    )
    values (
      v_event.invoice_id,
      v_checkout.id,
      v_event.stripe_subscription_id,
      v_event.event_id
    )
    on conflict on constraint stripe_sandbox_invoices_pkey do nothing
    returning i.invoice_id into v_inserted;

    if v_inserted is null then
      select
        i.webhook_event_id,
        i.checkout_session_id,
        i.stripe_subscription_id
      into
        v_owner,
        v_existing_checkout,
        v_existing_sub
      from public.stripe_sandbox_invoices as i
      where i.invoice_id = v_event.invoice_id
      for update;

      if v_owner is distinct from v_event.event_id then
        if v_existing_checkout is distinct from v_checkout.id
           or v_existing_sub
             is distinct from v_event.stripe_subscription_id then
          update public.stripe_sandbox_webhook_events as e
          set
            status = 'conflict',
            processed_at = v_now
          where e.event_id = v_event.event_id;
          return 'conflict';
        end if;

        update public.stripe_sandbox_webhook_events as e
        set
          status = 'duplicate_invoice',
          checkout_session_id = v_checkout.id,
          processed_at = v_now
        where e.event_id = v_event.event_id;
        return 'duplicate_invoice';
      end if;
    end if;

    update public.stripe_sandbox_webhook_events as e
    set
      status = 'applied',
      checkout_session_id = v_checkout.id,
      processed_at = v_now
    where e.event_id = v_event.event_id
      and exists (
        select 1
        from public.stripe_sandbox_invoices as i
        where i.invoice_id = v_event.invoice_id
          and i.webhook_event_id = v_event.event_id
      );

    if not found then
      raise exception using
        errcode = 'ZB003',
        message = 'invoice apply missing invoice row';
    end if;

    return 'applied';
  end if;

  if v_event.event_type = 'checkout.session.completed' then
    v_ref := null;
    if v_event.client_reference_id is not null
       and v_event.client_reference_id ~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then
      v_ref := v_event.client_reference_id::pg_catalog.uuid;
    end if;

    select pg_catalog.count(distinct s.id)::pg_catalog.int4
    into v_match_count
    from public.stripe_sandbox_checkout_sessions as s
    where (v_ref is not null and s.id = v_ref)
       or (
         v_event.stripe_session_id is not null
         and s.stripe_session_id = v_event.stripe_session_id
       )
       or (
         v_event.stripe_subscription_id is not null
         and s.stripe_subscription_id = v_event.stripe_subscription_id
       );

    if v_match_count > 1 then
      update public.stripe_sandbox_webhook_events as e
      set
        status = 'conflict',
        processed_at = v_now
      where e.event_id = v_event.event_id;
      return 'conflict';
    end if;

    if v_match_count = 0 then
      update public.stripe_sandbox_webhook_events as e
      set
        status = 'awaiting_correlation',
        processed_at = null
      where e.event_id = v_event.event_id;
      return 'awaiting_correlation';
    end if;

    select s.*
    into v_checkout
    from public.stripe_sandbox_checkout_sessions as s
    where (v_ref is not null and s.id = v_ref)
       or (
         v_event.stripe_session_id is not null
         and s.stripe_session_id = v_event.stripe_session_id
       )
       or (
         v_event.stripe_subscription_id is not null
         and s.stripe_subscription_id = v_event.stripe_subscription_id
       )
    order by s.id
    for update;

    if v_event.client_reference_id is not null
       and (
         v_ref is null
         or v_checkout.id is distinct from v_ref
       ) then
      update public.stripe_sandbox_webhook_events as e
      set
        status = 'conflict',
        processed_at = v_now
      where e.event_id = v_event.event_id;
      return 'conflict';
    end if;

    if v_event.stripe_session_id is not null
       and v_checkout.stripe_session_id is not null
       and v_checkout.stripe_session_id is distinct from v_event.stripe_session_id then
      update public.stripe_sandbox_webhook_events as e
      set
        status = 'conflict',
        processed_at = v_now
      where e.event_id = v_event.event_id;
      return 'conflict';
    end if;

    if v_event.stripe_subscription_id is not null
       and v_checkout.stripe_subscription_id is not null
       and v_checkout.stripe_subscription_id
         is distinct from v_event.stripe_subscription_id then
      update public.stripe_sandbox_webhook_events as e
      set
        status = 'conflict',
        processed_at = v_now
      where e.event_id = v_event.event_id;
      return 'conflict';
    end if;

    update public.stripe_sandbox_checkout_sessions as s
    set
      stripe_session_id = coalesce(s.stripe_session_id, v_event.stripe_session_id),
      stripe_subscription_id =
        coalesce(s.stripe_subscription_id, v_event.stripe_subscription_id),
      status = case
        when coalesce(s.stripe_subscription_id, v_event.stripe_subscription_id)
          is not null
          then 'correlated'
        when coalesce(s.stripe_session_id, v_event.stripe_session_id) is not null
          then 'open'
        else s.status
      end,
      updated_at = v_now
    where s.id = v_checkout.id;

    update public.stripe_sandbox_webhook_events as e
    set
      status = 'correlated',
      checkout_session_id = v_checkout.id,
      processed_at = v_now
    where e.event_id = v_event.event_id;

    return 'correlated';
  end if;

  raise exception using
    errcode = 'ZB001',
    message = 'invalid webhook event';
end;
$$;

create or replace function public.stripe_sandbox_reprocess_awaiting_events()
returns pg_catalog.void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_event_id pg_catalog.text;
  v_before pg_catalog.text;
  v_after pg_catalog.text;
  v_progress pg_catalog.bool;
  v_guard pg_catalog.int4 := 0;
begin
  perform public.stripe_sandbox_acquire_writer_lock();

  loop
    v_progress := false;
    v_guard := v_guard + 1;
    if v_guard > 50 then
      raise exception using
        errcode = 'ZB003',
        message = 'webhook event processing state conflict';
    end if;

    for v_event_id in
      select e.event_id
      from public.stripe_sandbox_webhook_events as e
      where e.status = 'awaiting_correlation'
      order by e.received_at, e.event_id
      for update
    loop
      select e.status
      into v_before
      from public.stripe_sandbox_webhook_events as e
      where e.event_id = v_event_id;

      v_after := public.stripe_sandbox_advance_claimed_event(v_event_id);
      if v_after is distinct from v_before then
        v_progress := true;
      end if;
    end loop;

    exit when not v_progress;
  end loop;
end;
$$;

create or replace function public.stripe_sandbox_register_checkout_session(
  p_user_id pg_catalog.uuid,
  p_plan_id pg_catalog.text,
  p_billing_cycle pg_catalog.text,
  p_expected_price_id pg_catalog.text
)
returns table (
  checkout_session_id pg_catalog.uuid,
  status pg_catalog.text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_plan pg_catalog.text;
  v_cycle pg_catalog.text;
  v_price pg_catalog.text;
  v_id pg_catalog.uuid;
  v_status pg_catalog.text;
begin
  perform public.stripe_sandbox_acquire_writer_lock();

  if p_user_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid user id';
  end if;

  if p_plan_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid plan id';
  end if;
  v_plan := pg_catalog.btrim(p_plan_id);
  if v_plan not in ('starter', 'pro', 'portfolio', 'agency') then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid plan id';
  end if;

  if p_billing_cycle is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid billing cycle';
  end if;
  v_cycle := pg_catalog.btrim(p_billing_cycle);
  if v_cycle not in ('monthly', 'annual') then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid billing cycle';
  end if;

  if p_expected_price_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid price id';
  end if;
  v_price := pg_catalog.btrim(p_expected_price_id);
  if v_price !~ '^price_[A-Za-z0-9_]+$' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid price id';
  end if;

  insert into public.stripe_sandbox_checkout_sessions as s (
    user_id,
    plan_id,
    billing_cycle,
    expected_price_id,
    status
  )
  values (
    p_user_id,
    v_plan,
    v_cycle,
    v_price,
    'pending'
  )
  returning s.id, s.status
  into v_id, v_status;

  perform public.stripe_sandbox_reprocess_awaiting_events();

  select s.status
  into v_status
  from public.stripe_sandbox_checkout_sessions as s
  where s.id = v_id;

  checkout_session_id := v_id;
  status := v_status;
  return next;
end;
$$;

create or replace function public.stripe_sandbox_attach_stripe_session_id(
  p_checkout_session_id pg_catalog.uuid,
  p_stripe_session_id pg_catalog.text
)
returns table (
  checkout_session_id pg_catalog.uuid,
  status pg_catalog.text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_session pg_catalog.text;
  v_status pg_catalog.text;
begin
  perform public.stripe_sandbox_acquire_writer_lock();

  if p_checkout_session_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid checkout session';
  end if;

  if p_stripe_session_id is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid stripe session id';
  end if;
  v_session := pg_catalog.btrim(p_stripe_session_id);
  if v_session = '' or v_session !~ '^cs_(test|live)_' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid stripe session id';
  end if;
  if v_session like 'cs_live_%' then
    raise exception using
      errcode = 'ZB001',
      message = 'live Stripe sessions are not accepted';
  end if;

  update public.stripe_sandbox_checkout_sessions as s
  set
    stripe_session_id = v_session,
    status = case
      when s.stripe_subscription_id is not null then 'correlated'
      else 'open'
    end,
    updated_at = pg_catalog.now()
  where s.id = p_checkout_session_id
    and (
      s.stripe_session_id is null
      or s.stripe_session_id = v_session
    )
  returning s.status into v_status;

  if not found then
    raise exception using
      errcode = 'ZB002',
      message = 'webhook event identity conflict';
  end if;

  perform public.stripe_sandbox_reprocess_awaiting_events();

  select s.status
  into v_status
  from public.stripe_sandbox_checkout_sessions as s
  where s.id = p_checkout_session_id;

  checkout_session_id := p_checkout_session_id;
  status := v_status;
  return next;
end;
$$;

create or replace function public.stripe_sandbox_apply_webhook_event(
  p_event_id pg_catalog.text,
  p_payload_sha256 pg_catalog.text,
  p_event_type pg_catalog.text,
  p_invoice_id pg_catalog.text,
  p_stripe_subscription_id pg_catalog.text,
  p_stripe_session_id pg_catalog.text,
  p_client_reference_id pg_catalog.text
)
returns table (
  replayed pg_catalog.bool,
  status pg_catalog.text,
  event_id pg_catalog.text,
  checkout_session_id pg_catalog.uuid,
  invoice_id pg_catalog.text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_event_id pg_catalog.text;
  v_hash pg_catalog.text;
  v_type pg_catalog.text;
  v_invoice_id pg_catalog.text;
  v_subscription_id pg_catalog.text;
  v_session_id pg_catalog.text;
  v_reference pg_catalog.text;
  v_claimed pg_catalog.text;
  v_existing public.stripe_sandbox_webhook_events%rowtype;
  v_status pg_catalog.text;
begin
  perform public.stripe_sandbox_acquire_writer_lock();

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

  if p_payload_sha256 is null
     or p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_hash := p_payload_sha256;

  if p_event_type is null then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;
  v_type := pg_catalog.btrim(p_event_type);
  if v_type not in ('checkout.session.completed', 'invoice.paid') then
    raise exception using
      errcode = 'ZB001',
      message = 'invalid webhook event';
  end if;

  v_invoice_id := nullif(pg_catalog.btrim(coalesce(p_invoice_id, '')), '');
  v_subscription_id :=
    nullif(pg_catalog.btrim(coalesce(p_stripe_subscription_id, '')), '');
  v_session_id := nullif(pg_catalog.btrim(coalesce(p_stripe_session_id, '')), '');
  v_reference :=
    nullif(pg_catalog.btrim(coalesce(p_client_reference_id, '')), '');

  if v_type = 'invoice.paid' and v_session_id is not null then
    v_session_id := null;
  end if;
  if v_type = 'invoice.paid' then
    v_reference := null;
  end if;
  if v_type = 'checkout.session.completed' then
    v_invoice_id := null;
  end if;

  insert into public.stripe_sandbox_webhook_events as e (
    event_id,
    payload_sha256,
    event_type,
    status,
    invoice_id,
    stripe_subscription_id,
    stripe_session_id,
    client_reference_id
  )
  values (
    v_event_id,
    v_hash,
    v_type,
    'processing',
    v_invoice_id,
    v_subscription_id,
    v_session_id,
    v_reference
  )
  on conflict on constraint stripe_sandbox_webhook_events_pkey do nothing
  returning e.event_id into v_claimed;

  if v_claimed is null then
    select e.*
    into v_existing
    from public.stripe_sandbox_webhook_events as e
    where e.event_id = v_event_id
    for update;

    if not found then
      raise exception using
        errcode = 'ZB003',
        message = 'webhook event claim unavailable';
    end if;

    if v_existing.event_type is distinct from v_type
       or v_existing.payload_sha256 is distinct from v_hash then
      replayed := false;
      status := 'conflict';
      event_id := v_event_id;
      checkout_session_id := v_existing.checkout_session_id;
      invoice_id := v_existing.invoice_id;
      return next;
      return;
    end if;

    if v_existing.status = 'processing' then
      raise exception using
        errcode = 'ZB003',
        message = 'webhook event processing state conflict';
    end if;

    if v_existing.status = 'awaiting_correlation' then
      v_status := public.stripe_sandbox_advance_claimed_event(v_event_id);
      if v_status = 'correlated' then
        perform public.stripe_sandbox_reprocess_awaiting_events();
      end if;

      select
        e.status,
        e.checkout_session_id,
        e.invoice_id
      into
        status,
        checkout_session_id,
        invoice_id
      from public.stripe_sandbox_webhook_events as e
      where e.event_id = v_event_id;

      replayed := false;
      event_id := v_event_id;
      return next;
      return;
    end if;

    replayed := true;
    status := v_existing.status;
    event_id := v_event_id;
    checkout_session_id := v_existing.checkout_session_id;
    invoice_id := v_existing.invoice_id;
    return next;
    return;
  end if;

  v_status := public.stripe_sandbox_advance_claimed_event(v_event_id);
  if v_status = 'correlated' then
    perform public.stripe_sandbox_reprocess_awaiting_events();
    select e.status
    into v_status
    from public.stripe_sandbox_webhook_events as e
    where e.event_id = v_event_id;
  end if;

  select
    e.status,
    e.checkout_session_id,
    e.invoice_id
  into
    status,
    checkout_session_id,
    invoice_id
  from public.stripe_sandbox_webhook_events as e
  where e.event_id = v_event_id;

  replayed := false;
  event_id := v_event_id;
  return next;
end;
$$;

revoke all on function public.stripe_sandbox_acquire_writer_lock()
  from public;
revoke all on function public.stripe_sandbox_acquire_writer_lock()
  from anon;
revoke all on function public.stripe_sandbox_acquire_writer_lock()
  from authenticated;
revoke all on function public.stripe_sandbox_acquire_writer_lock()
  from service_role;

revoke all on function public.stripe_sandbox_advance_claimed_event(pg_catalog.text)
  from public;
revoke all on function public.stripe_sandbox_advance_claimed_event(pg_catalog.text)
  from anon;
revoke all on function public.stripe_sandbox_advance_claimed_event(pg_catalog.text)
  from authenticated;
revoke all on function public.stripe_sandbox_advance_claimed_event(pg_catalog.text)
  from service_role;

revoke all on function public.stripe_sandbox_reprocess_awaiting_events()
  from public;
revoke all on function public.stripe_sandbox_reprocess_awaiting_events()
  from anon;
revoke all on function public.stripe_sandbox_reprocess_awaiting_events()
  from authenticated;
revoke all on function public.stripe_sandbox_reprocess_awaiting_events()
  from service_role;

revoke all on function public.stripe_sandbox_register_checkout_session(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text
) from public;
revoke all on function public.stripe_sandbox_register_checkout_session(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text
) from anon;
revoke all on function public.stripe_sandbox_register_checkout_session(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text
) from authenticated;
grant execute on function public.stripe_sandbox_register_checkout_session(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text
) to service_role;

revoke all on function public.stripe_sandbox_attach_stripe_session_id(
  pg_catalog.uuid,
  pg_catalog.text
) from public;
revoke all on function public.stripe_sandbox_attach_stripe_session_id(
  pg_catalog.uuid,
  pg_catalog.text
) from anon;
revoke all on function public.stripe_sandbox_attach_stripe_session_id(
  pg_catalog.uuid,
  pg_catalog.text
) from authenticated;
grant execute on function public.stripe_sandbox_attach_stripe_session_id(
  pg_catalog.uuid,
  pg_catalog.text
) to service_role;

revoke all on function public.stripe_sandbox_apply_webhook_event(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text
) from public;
revoke all on function public.stripe_sandbox_apply_webhook_event(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text
) from anon;
revoke all on function public.stripe_sandbox_apply_webhook_event(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text
) from authenticated;
grant execute on function public.stripe_sandbox_apply_webhook_event(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text
) to service_role;

alter function public.stripe_sandbox_acquire_writer_lock()
  owner to postgres;
alter function public.stripe_sandbox_advance_claimed_event(pg_catalog.text)
  owner to postgres;
alter function public.stripe_sandbox_reprocess_awaiting_events()
  owner to postgres;
alter function public.stripe_sandbox_register_checkout_session(
  pg_catalog.uuid,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text
) owner to postgres;
alter function public.stripe_sandbox_attach_stripe_session_id(
  pg_catalog.uuid,
  pg_catalog.text
) owner to postgres;
alter function public.stripe_sandbox_apply_webhook_event(
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text,
  pg_catalog.text
) owner to postgres;

-- END stripe sandbox billing correlation RPCs

commit;
