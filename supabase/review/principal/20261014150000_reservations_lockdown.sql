-- REVIEW ONLY: principal fqkxlisenfrhkermwsar.
-- Apply only after the server is deployed and save_host_reservation is verified.

alter table public.reservations enable row level security;
alter table public.reservations force row level security;

do $$
declare
  policy_record record;
  column_list text;
begin
  for policy_record in
    select polname
    from pg_catalog.pg_policy
    where polrelid = 'public.reservations'::pg_catalog.regclass
  loop
    execute pg_catalog.format(
      'drop policy %I on public.reservations',
      policy_record.polname
    );
  end loop;

  select pg_catalog.string_agg(pg_catalog.format('%I', attname), ', ' order by attnum)
  into column_list
  from pg_catalog.pg_attribute
  where attrelid = 'public.reservations'::pg_catalog.regclass
    and attnum > 0
    and not attisdropped;

  execute pg_catalog.format('revoke all privileges (%s) on table public.reservations from public', column_list);
  execute pg_catalog.format('revoke all privileges (%s) on table public.reservations from anon', column_list);
  execute pg_catalog.format('revoke all privileges (%s) on table public.reservations from authenticated', column_list);
end;
$$;

revoke all privileges on table public.reservations from public;
revoke all privileges on table public.reservations from anon;
revoke all privileges on table public.reservations from authenticated;
grant select, insert, update, delete on table public.reservations to service_role;
