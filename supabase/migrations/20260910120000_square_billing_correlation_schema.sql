-- Billing Phase 2B Microblock 7D1: additive Square correlation schema.
-- No Square operations and no webhook processor replacement.
-- Preserve the Microblock 6D cancellation update-only contract.

begin;

do $square_billing_correlation_preflight$
declare
  v_rpc pg_catalog.regprocedure;
  v_rpc_definition pg_catalog.text;
  v_cancellation_branch pg_catalog.text;
begin
  if pg_catalog.to_regclass('public.host_subscriptions') is null
     or pg_catalog.to_regclass('public.subscription_payments') is null
     or pg_catalog.to_regclass('public.subscription_webhook_events') is null then
    raise exception using
      errcode = '55000',
      message = 'Square billing correlation precondition failed';
  end if;

  if pg_catalog.to_regclass('public.square_payment_methods') is not null
     or pg_catalog.to_regclass('public.square_subscription_intents') is not null
     or pg_catalog.to_regclass('public.square_subscription_invoices') is not null then
    raise exception using
      errcode = '55000',
      message = 'Square billing correlation objects already exist';
  end if;

  if exists (
    select 1
    from information_schema.columns as columns
    where columns.table_schema = 'public'
      and (columns.table_name, columns.column_name) in (
        values
          ('host_subscriptions', 'billing_cycle'),
          ('host_subscriptions', 'billing_amount_usd'),
          ('host_subscriptions', 'square_environment'),
          ('host_subscriptions', 'square_location_id'),
          ('host_subscriptions', 'square_plan_variation_id'),
          ('host_subscriptions', 'square_subscription_status'),
          ('host_subscriptions', 'square_subscription_version'),
          ('host_subscriptions', 'square_start_date'),
          ('host_subscriptions', 'square_charged_through_date'),
          ('host_subscriptions', 'square_canceled_date'),
          ('subscription_payments', 'billing_cycle'),
          ('subscription_payments', 'square_environment'),
          ('subscription_payments', 'square_location_id'),
          ('subscription_payments', 'square_subscription_id'),
          ('subscription_payments', 'square_invoice_id'),
          ('subscription_payments', 'square_order_id')
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'Square billing correlation columns already exist';
  end if;

  v_rpc := pg_catalog.to_regprocedure(
    'public.process_subscription_webhook_atomic(' ||
    'text,text,text,text,uuid,text,text,numeric,numeric,' ||
    'text,text,text,timestamp with time zone,timestamp with time zone)'
  );

  if v_rpc is null then
    raise exception using
      errcode = '55000',
      message = 'Microblock 6D webhook processor is unavailable';
  end if;

  select pg_catalog.pg_get_functiondef(v_rpc::pg_catalog.oid)
  into v_rpc_definition;

  if pg_catalog.position(
       '-- BEGIN cancellation update-only branch' in v_rpc_definition
     ) = 0
     or pg_catalog.position(
       '-- END cancellation update-only branch' in v_rpc_definition
     ) = 0 then
    raise exception using
      errcode = '55000',
      message = 'Microblock 6D cancellation contract is unavailable';
  end if;

  v_cancellation_branch := pg_catalog.split_part(
    pg_catalog.split_part(
      v_rpc_definition,
      '-- BEGIN cancellation update-only branch',
      2
    ),
    '-- END cancellation update-only branch',
    1
  );

  if pg_catalog.position(
       'update public.host_subscriptions as s' in v_cancellation_branch
     ) = 0
     or pg_catalog.position(
       'where s.user_id = p_user_id' in v_cancellation_branch
     ) = 0
     or pg_catalog.position(
       'returning s.plan_id into resolved_plan_id' in v_cancellation_branch
     ) = 0
     or pg_catalog.position('plan_id =' in v_cancellation_branch) <> 0
     or pg_catalog.position('monthly_usd =' in v_cancellation_branch) <> 0 then
    raise exception using
      errcode = '55000',
      message = 'Microblock 6D cancellation contract is incompatible';
  end if;
end;
$square_billing_correlation_preflight$;

-- BEGIN square billing correlation schema
alter table public.host_subscriptions
  add column billing_cycle pg_catalog.text,
  add column billing_amount_usd pg_catalog.numeric(10, 2),
  add column square_environment pg_catalog.text,
  add column square_location_id pg_catalog.text,
  add column square_plan_variation_id pg_catalog.text,
  add column square_subscription_status pg_catalog.text,
  add column square_subscription_version pg_catalog.int8,
  add column square_start_date pg_catalog.date,
  add column square_charged_through_date pg_catalog.date,
  add column square_canceled_date pg_catalog.date,
  add constraint host_subscriptions_billing_cycle_check
    check (
      billing_cycle is null
      or billing_cycle in ('monthly', 'annual')
    ),
  add constraint host_subscriptions_billing_amount_usd_check
    check (
      billing_amount_usd is null
      or (
        billing_amount_usd::pg_catalog.text not in (
          'NaN',
          'Infinity',
          '-Infinity'
        )
        and billing_amount_usd > 0
      )
    ),
  add constraint host_subscriptions_square_environment_check
    check (
      square_environment is null
      or square_environment in ('sandbox', 'production')
    ),
  add constraint host_subscriptions_square_location_id_check
    check (
      square_location_id is null
      or pg_catalog.btrim(square_location_id) <> ''
    ),
  add constraint host_subscriptions_square_plan_variation_id_check
    check (
      square_plan_variation_id is null
      or pg_catalog.btrim(square_plan_variation_id) <> ''
    ),
  add constraint host_subscriptions_square_subscription_status_check
    check (
      square_subscription_status is null
      or pg_catalog.btrim(square_subscription_status) <> ''
    ),
  add constraint host_subscriptions_square_subscription_version_check
    check (
      square_subscription_version is null
      or square_subscription_version >= 0
    ),
  add constraint host_subscriptions_square_customer_environment_key
    unique (square_environment, square_customer_id),
  add constraint host_subscriptions_square_subscription_environment_key
    unique (square_environment, square_subscription_id);

comment on column public.host_subscriptions.billing_cycle is
  'Canonical Zencierge billing cycle: monthly or annual.';

comment on column public.host_subscriptions.billing_amount_usd is
  'Amount charged per billing cycle; monthly_usd remains normalized monthly MRR.';

comment on column public.host_subscriptions.square_subscription_status is
  'Last accepted raw Square status, separate from local entitlement status.';

comment on column public.host_subscriptions.square_charged_through_date is
  'Square charged-through date preserved as a calendar date.';

create table public.square_payment_methods (
  id pg_catalog.uuid primary key default gen_random_uuid(),
  user_id pg_catalog.uuid not null
    references auth.users (id) on delete cascade,
  square_environment pg_catalog.text not null,
  square_customer_id pg_catalog.text not null,
  square_card_id pg_catalog.text not null,
  card_brand pg_catalog.text,
  last_4 pg_catalog.text,
  exp_month pg_catalog.int2,
  exp_year pg_catalog.int4,
  enabled pg_catalog.bool not null default true,
  consented_at pg_catalog.timestamptz not null,
  created_at pg_catalog.timestamptz not null default pg_catalog.now(),
  updated_at pg_catalog.timestamptz not null default pg_catalog.now(),
  constraint square_payment_methods_environment_check
    check (square_environment in ('sandbox', 'production')),
  constraint square_payment_methods_customer_id_check
    check (pg_catalog.btrim(square_customer_id) <> ''),
  constraint square_payment_methods_card_id_check
    check (pg_catalog.btrim(square_card_id) <> ''),
  constraint square_payment_methods_last_4_check
    check (last_4 is null or last_4 ~ '^[0-9]{4}$'),
  constraint square_payment_methods_exp_month_check
    check (exp_month is null or exp_month between 1 and 12),
  constraint square_payment_methods_exp_year_check
    check (exp_year is null or exp_year >= 2000),
  constraint square_payment_methods_environment_card_key
    unique (square_environment, square_card_id)
);

create index square_payment_methods_user_environment_idx
  on public.square_payment_methods (
    user_id,
    square_environment,
    created_at desc
  );

comment on table public.square_payment_methods is
  'Server-only Square card identifiers and masked display metadata.';

create table public.square_subscription_intents (
  id pg_catalog.uuid primary key default gen_random_uuid(),
  user_id pg_catalog.uuid not null
    references auth.users (id) on delete cascade,
  plan_id pg_catalog.text not null,
  billing_cycle pg_catalog.text not null,
  billing_amount_usd pg_catalog.numeric(10, 2) not null,
  status pg_catalog.text not null default 'pending',
  square_environment pg_catalog.text not null,
  square_location_id pg_catalog.text not null,
  square_plan_variation_id pg_catalog.text not null,
  square_customer_id pg_catalog.text,
  square_card_id pg_catalog.text,
  square_subscription_id pg_catalog.text,
  customer_idempotency_key pg_catalog.text not null,
  card_idempotency_key pg_catalog.text not null,
  subscription_idempotency_key pg_catalog.text not null,
  complimentary_until pg_catalog.timestamptz,
  expires_at pg_catalog.timestamptz not null,
  last_error_code pg_catalog.text,
  created_at pg_catalog.timestamptz not null default pg_catalog.now(),
  updated_at pg_catalog.timestamptz not null default pg_catalog.now(),
  constraint square_subscription_intents_plan_id_check
    check (plan_id in ('starter', 'pro', 'portfolio', 'agency')),
  constraint square_subscription_intents_billing_cycle_check
    check (billing_cycle in ('monthly', 'annual')),
  constraint square_subscription_intents_amount_check
    check (
      billing_amount_usd::pg_catalog.text not in (
        'NaN',
        'Infinity',
        '-Infinity'
      )
      and billing_amount_usd > 0
    ),
  constraint square_subscription_intents_status_check
    check (
      status in (
        'pending',
        'customer_ready',
        'card_ready',
        'subscription_ready',
        'completed',
        'failed',
        'expired'
      )
    ),
  constraint square_subscription_intents_environment_check
    check (square_environment in ('sandbox', 'production')),
  constraint square_subscription_intents_location_id_check
    check (pg_catalog.btrim(square_location_id) <> ''),
  constraint square_subscription_intents_plan_variation_id_check
    check (pg_catalog.btrim(square_plan_variation_id) <> ''),
  constraint square_subscription_intents_customer_id_check
    check (
      square_customer_id is null
      or pg_catalog.btrim(square_customer_id) <> ''
    ),
  constraint square_subscription_intents_card_id_check
    check (
      square_card_id is null
      or pg_catalog.btrim(square_card_id) <> ''
    ),
  constraint square_subscription_intents_subscription_id_check
    check (
      square_subscription_id is null
      or pg_catalog.btrim(square_subscription_id) <> ''
    ),
  constraint square_subscription_intents_customer_idempotency_key_check
    check (
      pg_catalog.btrim(customer_idempotency_key) <> ''
      and pg_catalog.length(customer_idempotency_key) <= 45
    ),
  constraint square_subscription_intents_card_idempotency_key_check
    check (
      pg_catalog.btrim(card_idempotency_key) <> ''
      and pg_catalog.length(card_idempotency_key) <= 45
    ),
  constraint square_subscription_intents_subscription_idempotency_key_check
    check (
      pg_catalog.btrim(subscription_idempotency_key) <> ''
      and pg_catalog.length(subscription_idempotency_key) <= 45
    ),
  constraint square_subscription_intents_error_code_check
    check (
      last_error_code is null
      or pg_catalog.btrim(last_error_code) <> ''
    ),
  constraint square_subscription_intents_expiration_check
    check (expires_at > created_at),
  constraint square_subscription_intents_customer_idempotency_key
    unique (square_environment, customer_idempotency_key),
  constraint square_subscription_intents_card_idempotency_key
    unique (square_environment, card_idempotency_key),
  constraint square_subscription_intents_subscription_idempotency_key
    unique (square_environment, subscription_idempotency_key)
);

create unique index square_subscription_intents_one_open_per_user_idx
  on public.square_subscription_intents (
    user_id,
    square_environment
  )
  where status in (
    'pending',
    'customer_ready',
    'card_ready',
    'subscription_ready'
  );

create unique index square_subscription_intents_subscription_id_idx
  on public.square_subscription_intents (
    square_environment,
    square_subscription_id
  )
  where square_subscription_id is not null;

create index square_subscription_intents_expiration_idx
  on public.square_subscription_intents (expires_at)
  where status in (
    'pending',
    'customer_ready',
    'card_ready',
    'subscription_ready'
  );

comment on table public.square_subscription_intents is
  'Server-only idempotent Square subscription setup state.';

create table public.square_subscription_invoices (
  square_environment pg_catalog.text not null,
  square_invoice_id pg_catalog.text not null,
  square_subscription_id pg_catalog.text not null,
  square_order_id pg_catalog.text,
  square_location_id pg_catalog.text not null,
  user_id pg_catalog.uuid not null
    references auth.users (id) on delete cascade,
  plan_id pg_catalog.text not null,
  billing_cycle pg_catalog.text not null,
  square_plan_variation_id pg_catalog.text not null,
  square_invoice_status pg_catalog.text not null,
  square_invoice_version pg_catalog.int8,
  amount_usd pg_catalog.numeric(10, 2),
  currency pg_catalog.text,
  due_date pg_catalog.date,
  paid_at pg_catalog.timestamptz,
  created_at pg_catalog.timestamptz not null default pg_catalog.now(),
  updated_at pg_catalog.timestamptz not null default pg_catalog.now(),
  constraint square_subscription_invoices_pkey
    primary key (square_environment, square_invoice_id),
  constraint square_subscription_invoices_environment_check
    check (square_environment in ('sandbox', 'production')),
  constraint square_subscription_invoices_invoice_id_check
    check (pg_catalog.btrim(square_invoice_id) <> ''),
  constraint square_subscription_invoices_subscription_id_check
    check (pg_catalog.btrim(square_subscription_id) <> ''),
  constraint square_subscription_invoices_order_id_check
    check (
      square_order_id is null
      or pg_catalog.btrim(square_order_id) <> ''
    ),
  constraint square_subscription_invoices_location_id_check
    check (pg_catalog.btrim(square_location_id) <> ''),
  constraint square_subscription_invoices_plan_id_check
    check (plan_id in ('starter', 'pro', 'portfolio', 'agency')),
  constraint square_subscription_invoices_billing_cycle_check
    check (billing_cycle in ('monthly', 'annual')),
  constraint square_subscription_invoices_plan_variation_id_check
    check (pg_catalog.btrim(square_plan_variation_id) <> ''),
  constraint square_subscription_invoices_status_check
    check (pg_catalog.btrim(square_invoice_status) <> ''),
  constraint square_subscription_invoices_version_check
    check (
      square_invoice_version is null
      or square_invoice_version >= 0
    ),
  constraint square_subscription_invoices_amount_check
    check (
      amount_usd is null
      or (
        amount_usd::pg_catalog.text not in (
          'NaN',
          'Infinity',
          '-Infinity'
        )
        and amount_usd >= 0
      )
    ),
  constraint square_subscription_invoices_currency_check
    check (
      currency is null
      or pg_catalog.btrim(currency) <> ''
    )
);

create unique index square_subscription_invoices_order_id_idx
  on public.square_subscription_invoices (
    square_environment,
    square_order_id
  )
  where square_order_id is not null;

create index square_subscription_invoices_subscription_id_idx
  on public.square_subscription_invoices (
    square_environment,
    square_subscription_id,
    created_at desc
  );

create index square_subscription_invoices_user_idx
  on public.square_subscription_invoices (
    user_id,
    created_at desc
  );

comment on table public.square_subscription_invoices is
  'Server-only Invoice and Order correlation for recurring Square billing.';

alter table public.subscription_payments
  add column billing_cycle pg_catalog.text,
  add column square_environment pg_catalog.text,
  add column square_location_id pg_catalog.text,
  add column square_subscription_id pg_catalog.text,
  add column square_invoice_id pg_catalog.text,
  add column square_order_id pg_catalog.text,
  add constraint subscription_payments_billing_cycle_check
    check (
      billing_cycle is null
      or billing_cycle in ('monthly', 'annual')
    ),
  add constraint subscription_payments_square_environment_check
    check (
      square_environment is null
      or square_environment in ('sandbox', 'production')
    ),
  add constraint subscription_payments_square_location_id_check
    check (
      square_location_id is null
      or pg_catalog.btrim(square_location_id) <> ''
    ),
  add constraint subscription_payments_square_subscription_id_check
    check (
      square_subscription_id is null
      or pg_catalog.btrim(square_subscription_id) <> ''
    ),
  add constraint subscription_payments_square_invoice_id_check
    check (
      square_invoice_id is null
      or pg_catalog.btrim(square_invoice_id) <> ''
    ),
  add constraint subscription_payments_square_order_id_check
    check (
      square_order_id is null
      or pg_catalog.btrim(square_order_id) <> ''
    );

create index subscription_payments_square_subscription_idx
  on public.subscription_payments (
    square_environment,
    square_subscription_id,
    created_at desc
  )
  where square_subscription_id is not null;

create index subscription_payments_square_invoice_idx
  on public.subscription_payments (
    square_environment,
    square_invoice_id,
    created_at desc
  )
  where square_invoice_id is not null;

create index subscription_payments_square_order_idx
  on public.subscription_payments (
    square_environment,
    square_order_id,
    created_at desc
  )
  where square_order_id is not null;

alter table public.square_payment_methods enable row level security;
alter table public.square_subscription_intents enable row level security;
alter table public.square_subscription_invoices enable row level security;

revoke all on table public.square_payment_methods from public;
revoke all on table public.square_payment_methods from anon;
revoke all on table public.square_payment_methods from authenticated;
revoke all on table public.square_payment_methods from service_role;
grant select, insert, update
  on table public.square_payment_methods
  to service_role;

revoke all on table public.square_subscription_intents from public;
revoke all on table public.square_subscription_intents from anon;
revoke all on table public.square_subscription_intents from authenticated;
revoke all on table public.square_subscription_intents from service_role;
grant select, insert, update
  on table public.square_subscription_intents
  to service_role;

revoke all on table public.square_subscription_invoices from public;
revoke all on table public.square_subscription_invoices from anon;
revoke all on table public.square_subscription_invoices from authenticated;
revoke all on table public.square_subscription_invoices from service_role;
grant select, insert, update
  on table public.square_subscription_invoices
  to service_role;
-- END square billing correlation schema

commit;