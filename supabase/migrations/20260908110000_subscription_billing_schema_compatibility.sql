-- Billing Phase 2A prerequisite: additive compatibility for the empty legacy
-- billing tables. Existing ACLs and effective privileges remain unchanged.

do $subscription_billing_compatibility$
declare
  v_host_columns pg_catalog.jsonb;
  v_payment_columns pg_catalog.jsonb;
  v_host_relation pg_catalog.oid;
  v_payment_relation pg_catalog.oid;
begin
  select classes.oid
  into v_host_relation
  from pg_catalog.pg_class as classes
  join pg_catalog.pg_namespace as namespaces
    on namespaces.oid = classes.relnamespace
  where namespaces.nspname = 'public'
    and classes.relname = 'host_subscriptions'
    and classes.relkind = 'r'
    and pg_catalog.pg_get_userbyid(classes.relowner) = 'postgres'
    and classes.relrowsecurity
    and not classes.relforcerowsecurity;

  if v_host_relation is null then
    raise exception using
      errcode = '55000',
      message = 'host_subscriptions compatibility precondition failed';
  end if;

  select classes.oid
  into v_payment_relation
  from pg_catalog.pg_class as classes
  join pg_catalog.pg_namespace as namespaces
    on namespaces.oid = classes.relnamespace
  where namespaces.nspname = 'public'
    and classes.relname = 'subscription_payments'
    and classes.relkind = 'r'
    and pg_catalog.pg_get_userbyid(classes.relowner) = 'postgres'
    and classes.relrowsecurity
    and not classes.relforcerowsecurity;

  if v_payment_relation is null then
    raise exception using
      errcode = '55000',
      message = 'subscription_payments compatibility precondition failed';
  end if;

  lock table public.host_subscriptions, public.subscription_payments
    in access exclusive mode;

  if exists (select 1 from public.host_subscriptions) then
    raise exception using
      errcode = '55000',
      message = 'host_subscriptions must be empty';
  end if;

  if exists (select 1 from public.subscription_payments) then
    raise exception using
      errcode = '55000',
      message = 'subscription_payments must be empty';
  end if;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'position', attributes.attnum,
      'name', attributes.attname,
      'type', pg_catalog.format_type(
        attributes.atttypid,
        attributes.atttypmod
      ),
      'not_null', attributes.attnotnull,
      'default', coalesce(
        pg_catalog.pg_get_expr(
          defaults.adbin,
          defaults.adrelid
        ),
        ''
      ),
      'identity', attributes.attidentity,
      'generated', attributes.attgenerated
    )
    order by attributes.attnum
  )
  into v_host_columns
  from pg_catalog.pg_attribute as attributes
  left join pg_catalog.pg_attrdef as defaults
    on defaults.adrelid = attributes.attrelid
   and defaults.adnum = attributes.attnum
  where attributes.attrelid = v_host_relation
    and attributes.attnum > 0
    and not attributes.attisdropped;

  if v_host_columns is distinct from
    '[
      {"position":1,"name":"user_id","type":"uuid","not_null":true,"default":"","identity":"","generated":""},
      {"position":2,"name":"email","type":"text","not_null":false,"default":"","identity":"","generated":""},
      {"position":3,"name":"plan_id","type":"text","not_null":true,"default":"''starter''::text","identity":"","generated":""},
      {"position":4,"name":"status","type":"text","not_null":true,"default":"''inactive''::text","identity":"","generated":""},
      {"position":5,"name":"monthly_usd","type":"numeric(10,2)","not_null":true,"default":"29","identity":"","generated":""},
      {"position":6,"name":"square_customer_id","type":"text","not_null":false,"default":"","identity":"","generated":""},
      {"position":7,"name":"square_subscription_id","type":"text","not_null":false,"default":"","identity":"","generated":""},
      {"position":8,"name":"current_period_end","type":"timestamp with time zone","not_null":false,"default":"","identity":"","generated":""},
      {"position":9,"name":"last_payment_at","type":"timestamp with time zone","not_null":false,"default":"","identity":"","generated":""},
      {"position":10,"name":"created_at","type":"timestamp with time zone","not_null":true,"default":"now()","identity":"","generated":""},
      {"position":11,"name":"complimentary_starts_at","type":"timestamp with time zone","not_null":false,"default":"","identity":"","generated":""},
      {"position":12,"name":"complimentary_ends_at","type":"timestamp with time zone","not_null":false,"default":"","identity":"","generated":""},
      {"position":13,"name":"complimentary_granted_by","type":"uuid","not_null":false,"default":"","identity":"","generated":""},
      {"position":14,"name":"complimentary_granted_at","type":"timestamp with time zone","not_null":false,"default":"","identity":"","generated":""}
    ]'::pg_catalog.jsonb then
    raise exception using
      errcode = '55000',
      message = 'unexpected host_subscriptions column contract';
  end if;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'position', attributes.attnum,
      'name', attributes.attname,
      'type', pg_catalog.format_type(
        attributes.atttypid,
        attributes.atttypmod
      ),
      'not_null', attributes.attnotnull,
      'default', coalesce(
        pg_catalog.pg_get_expr(
          defaults.adbin,
          defaults.adrelid
        ),
        ''
      ),
      'identity', attributes.attidentity,
      'generated', attributes.attgenerated
    )
    order by attributes.attnum
  )
  into v_payment_columns
  from pg_catalog.pg_attribute as attributes
  left join pg_catalog.pg_attrdef as defaults
    on defaults.adrelid = attributes.attrelid
   and defaults.adnum = attributes.attnum
  where attributes.attrelid = v_payment_relation
    and attributes.attnum > 0
    and not attributes.attisdropped;

  if v_payment_columns is distinct from
    '[
      {"position":1,"name":"id","type":"uuid","not_null":true,"default":"gen_random_uuid()","identity":"","generated":""},
      {"position":2,"name":"subscription_id","type":"uuid","not_null":false,"default":"","identity":"","generated":""},
      {"position":3,"name":"gateway_payment_id","type":"character varying(255)","not_null":true,"default":"","identity":"","generated":""},
      {"position":4,"name":"amount_paid","type":"numeric(10,2)","not_null":true,"default":"","identity":"","generated":""},
      {"position":5,"name":"net_revenue","type":"numeric(10,2)","not_null":true,"default":"","identity":"","generated":""},
      {"position":6,"name":"gateway_fee","type":"numeric(10,2)","not_null":true,"default":"","identity":"","generated":""},
      {"position":7,"name":"payment_status","type":"character varying(50)","not_null":true,"default":"","identity":"","generated":""},
      {"position":8,"name":"paid_at","type":"timestamp with time zone","not_null":false,"default":"now()","identity":"","generated":""},
      {"position":9,"name":"user_id","type":"uuid","not_null":false,"default":"","identity":"","generated":""}
    ]'::pg_catalog.jsonb then
    raise exception using
      errcode = '55000',
      message = 'unexpected subscription_payments column contract';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraints
    where constraints.conrelid = v_host_relation
  ) <> 3
     or not exists (
       select 1
       from pg_catalog.pg_constraint as constraints
       where constraints.conrelid = v_host_relation
         and constraints.conname = 'host_subscriptions_pkey'
         and constraints.contype = 'p'
         and constraints.convalidated
         and not constraints.condeferrable
         and not constraints.condeferred
         and pg_catalog.pg_get_constraintdef(
           constraints.oid,
           true
         ) = 'PRIMARY KEY (user_id)'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint as constraints
       where constraints.conrelid = v_host_relation
         and constraints.conname =
           'host_subscriptions_user_id_fkey'
         and constraints.contype = 'f'
         and constraints.convalidated
         and not constraints.condeferrable
         and not constraints.condeferred
         and pg_catalog.pg_get_constraintdef(
           constraints.oid,
           true
         ) = 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint as constraints
       where constraints.conrelid = v_host_relation
         and constraints.conname =
           'host_subscriptions_complimentary_granted_by_fkey'
         and constraints.contype = 'f'
         and constraints.convalidated
         and not constraints.condeferrable
         and not constraints.condeferred
         and pg_catalog.pg_get_constraintdef(
           constraints.oid,
           true
         ) = 'FOREIGN KEY (complimentary_granted_by) REFERENCES auth.users(id) ON DELETE SET NULL'
     ) then
    raise exception using
      errcode = '55000',
      message = 'unexpected host_subscriptions constraints';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraints
    where constraints.conrelid = v_payment_relation
  ) <> 3
     or not exists (
       select 1
       from pg_catalog.pg_constraint as constraints
       where constraints.conrelid = v_payment_relation
         and constraints.conname = 'subscription_payments_pkey'
         and constraints.contype = 'p'
         and constraints.convalidated
         and not constraints.condeferrable
         and not constraints.condeferred
         and pg_catalog.pg_get_constraintdef(
           constraints.oid,
           true
         ) = 'PRIMARY KEY (id)'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint as constraints
       where constraints.conrelid = v_payment_relation
         and constraints.conname =
           'subscription_payments_gateway_payment_id_key'
         and constraints.contype = 'u'
         and constraints.convalidated
         and not constraints.condeferrable
         and not constraints.condeferred
         and pg_catalog.pg_get_constraintdef(
           constraints.oid,
           true
         ) = 'UNIQUE (gateway_payment_id)'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint as constraints
       where constraints.conrelid = v_payment_relation
         and constraints.conname =
           'subscription_payments_user_id_fkey'
         and constraints.contype = 'f'
         and constraints.convalidated
         and not constraints.condeferrable
         and not constraints.condeferred
         and pg_catalog.pg_get_constraintdef(
           constraints.oid,
           true
         ) = 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
     ) then
    raise exception using
      errcode = '55000',
      message = 'unexpected subscription_payments constraints';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_index as indexes
    where indexes.indrelid = v_host_relation
  ) <> 2
     or not exists (
       select 1
       from pg_catalog.pg_index as indexes
       join pg_catalog.pg_class as index_relations
         on index_relations.oid = indexes.indexrelid
       join pg_catalog.pg_namespace as index_namespaces
         on index_namespaces.oid = index_relations.relnamespace
       join pg_catalog.pg_attribute as attributes
         on attributes.attrelid = indexes.indrelid
        and attributes.attname = 'user_id'
       where indexes.indrelid = v_host_relation
         and index_namespaces.nspname = 'public'
         and index_relations.relname = 'host_subscriptions_pkey'
         and indexes.indisunique
         and indexes.indisprimary
         and indexes.indisvalid
         and indexes.indisready
         and indexes.indnkeyatts = 1
         and indexes.indnatts = 1
         and indexes.indkey[0] = attributes.attnum
         and indexes.indexprs is null
         and indexes.indpred is null
     )
     or not exists (
       select 1
       from pg_catalog.pg_index as indexes
       join pg_catalog.pg_class as index_relations
         on index_relations.oid = indexes.indexrelid
       join pg_catalog.pg_namespace as index_namespaces
         on index_namespaces.oid = index_relations.relnamespace
       join pg_catalog.pg_attribute as attributes
         on attributes.attrelid = indexes.indrelid
        and attributes.attname = 'complimentary_ends_at'
       where indexes.indrelid = v_host_relation
         and index_namespaces.nspname = 'public'
         and index_relations.relname =
           'host_subscriptions_complimentary_ends_idx'
         and not indexes.indisunique
         and not indexes.indisprimary
         and indexes.indisvalid
         and indexes.indisready
         and indexes.indnkeyatts = 1
         and indexes.indnatts = 1
         and indexes.indkey[0] = attributes.attnum
         and indexes.indexprs is null
         and pg_catalog.regexp_replace(
           pg_catalog.lower(
             pg_catalog.pg_get_expr(
               indexes.indpred,
               indexes.indrelid,
               true
             )
           ),
           '[[:space:]]',
           '',
           'g'
         ) = 'complimentary_ends_atisnotnull'
     ) then
    raise exception using
      errcode = '55000',
      message = 'unexpected host_subscriptions index inventory';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_index as indexes
    where indexes.indrelid = v_payment_relation
  ) <> 3
     or not exists (
       select 1
       from pg_catalog.pg_index as indexes
       join pg_catalog.pg_class as index_relations
         on index_relations.oid = indexes.indexrelid
       join pg_catalog.pg_namespace as index_namespaces
         on index_namespaces.oid = index_relations.relnamespace
       join pg_catalog.pg_attribute as attributes
         on attributes.attrelid = indexes.indrelid
        and attributes.attname = 'id'
       where indexes.indrelid = v_payment_relation
         and index_namespaces.nspname = 'public'
         and index_relations.relname = 'subscription_payments_pkey'
         and indexes.indisunique
         and indexes.indisprimary
         and indexes.indisvalid
         and indexes.indisready
         and indexes.indnkeyatts = 1
         and indexes.indnatts = 1
         and indexes.indkey[0] = attributes.attnum
         and indexes.indexprs is null
         and indexes.indpred is null
     )
     or not exists (
       select 1
       from pg_catalog.pg_index as indexes
       join pg_catalog.pg_class as index_relations
         on index_relations.oid = indexes.indexrelid
       join pg_catalog.pg_namespace as index_namespaces
         on index_namespaces.oid = index_relations.relnamespace
       join pg_catalog.pg_attribute as attributes
         on attributes.attrelid = indexes.indrelid
        and attributes.attname = 'gateway_payment_id'
       where indexes.indrelid = v_payment_relation
         and index_namespaces.nspname = 'public'
         and index_relations.relname =
           'subscription_payments_gateway_payment_id_key'
         and indexes.indisunique
         and not indexes.indisprimary
         and indexes.indisvalid
         and indexes.indisready
         and indexes.indnkeyatts = 1
         and indexes.indnatts = 1
         and indexes.indkey[0] = attributes.attnum
         and indexes.indexprs is null
         and indexes.indpred is null
     )
     or not exists (
       select 1
       from pg_catalog.pg_index as indexes
       join pg_catalog.pg_class as index_relations
         on index_relations.oid = indexes.indexrelid
       join pg_catalog.pg_namespace as index_namespaces
         on index_namespaces.oid = index_relations.relnamespace
       join pg_catalog.pg_attribute as attributes
         on attributes.attrelid = indexes.indrelid
        and attributes.attname = 'user_id'
       where indexes.indrelid = v_payment_relation
         and index_namespaces.nspname = 'public'
         and index_relations.relname =
           'idx_subscription_payments_user_id'
         and not indexes.indisunique
         and not indexes.indisprimary
         and indexes.indisvalid
         and indexes.indisready
         and indexes.indnkeyatts = 1
         and indexes.indnatts = 1
         and indexes.indkey[0] = attributes.attnum
         and indexes.indexprs is null
         and indexes.indpred is null
     ) then
    raise exception using
      errcode = '55000',
      message = 'unexpected subscription_payments index inventory';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policy as policies
    where policies.polrelid = v_host_relation
  ) <> 1
     or not exists (
       select 1
       from pg_catalog.pg_policy as policies
       where policies.polrelid = v_host_relation
         and policies.polname = 'hosts read own subscription'
         and policies.polcmd = 'r'
         and policies.polpermissive
         and pg_catalog.cardinality(policies.polroles) = 1
         and exists (
           select 1
           from pg_catalog.unnest(policies.polroles)
             as policy_role(role_oid)
           join pg_catalog.pg_roles as roles
             on roles.oid = policy_role.role_oid
           where roles.rolname = 'authenticated'
         )
         and not exists (
           select 1
           from pg_catalog.unnest(policies.polroles)
             as policy_role(role_oid)
           left join pg_catalog.pg_roles as roles
             on roles.oid = policy_role.role_oid
           where roles.rolname is distinct from 'authenticated'
         )
         and pg_catalog.regexp_replace(
           pg_catalog.pg_get_expr(
             policies.polqual,
             policies.polrelid
           ),
           '[[:space:]]',
           '',
           'g'
         ) = '(auth.uid()=user_id)'
         and policies.polwithcheck is null
     ) then
    raise exception using
      errcode = '55000',
      message = 'unexpected host_subscriptions policy contract';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policy as policies
    where policies.polrelid = v_payment_relation
  ) then
    raise exception using
      errcode = '55000',
      message = 'subscription_payments unexpectedly has policies';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger as triggers
    where triggers.tgrelid in (
      v_host_relation,
      v_payment_relation
    )
      and not triggers.tgisinternal
  ) then
    raise exception using
      errcode = '55000',
      message = 'billing tables unexpectedly have non-internal triggers';
  end if;

  alter table public.host_subscriptions
    add column is_lifetime_free pg_catalog.boolean not null default false,
    add column updated_at pg_catalog.timestamptz not null default pg_catalog.now(),
    add constraint host_subscriptions_plan_id_check
      check (plan_id in ('starter', 'pro', 'agency')),
    add constraint host_subscriptions_status_check
      check (
        status in (
          'active',
          'past_due',
          'canceled',
          'inactive',
          'trial'
        )
      );

  alter table public.subscription_payments
    alter column gateway_payment_id drop not null,
    alter column amount_paid drop not null,
    alter column net_revenue drop not null,
    alter column gateway_fee drop not null,
    alter column payment_status drop not null,
    add column host_email pg_catalog.text,
    add column amount_usd pg_catalog.numeric(10, 2),
    add column currency pg_catalog.text not null default 'USD',
    add column plan_id pg_catalog.text,
    add column status pg_catalog.text,
    add column provider_event pg_catalog.text,
    add column provider_payment_id pg_catalog.text,
    add column created_at pg_catalog.timestamptz not null default pg_catalog.now(),
    add constraint subscription_payments_status_check
      check (status in ('succeeded', 'failed', 'refunded')),
    add constraint subscription_payments_provider_payment_id_key
      unique (provider_payment_id);

  create index subscription_payments_user_idx
    on public.subscription_payments (user_id, created_at desc);

  create policy "hosts read own payments"
    on public.subscription_payments
    for select
    to authenticated
    using (auth.uid() = user_id);
end;
$subscription_billing_compatibility$;