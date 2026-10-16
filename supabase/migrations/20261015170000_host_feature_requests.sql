-- Host-authenticated product feedback for the private pilot.
-- This migration is self-contained and does not grant direct table access to
-- anon or authenticated. The existing authenticated server route performs
-- validated writes with service_role after resolving the host with getUser().

create table if not exists public.host_feature_requests (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  host_email text not null,
  title text not null,
  description text not null,
  category text not null,
  status text not null default 'under_review',
  created_at timestamptz not null default now(),
  constraint host_feature_requests_title_check
    check (char_length(btrim(title)) >= 3),
  constraint host_feature_requests_description_check
    check (char_length(btrim(description)) >= 8),
  constraint host_feature_requests_category_check
    check (category in ('housekeeping', 'messaging', 'pricing', 'disputes', 'access', 'other')),
  constraint host_feature_requests_status_check
    check (status in ('under_review', 'planned', 'in_progress', 'completed'))
);

create index if not exists host_feature_requests_host_created_idx
  on public.host_feature_requests (host_id, created_at desc);

alter table public.host_feature_requests
  drop constraint if exists host_feature_requests_title_check,
  drop constraint if exists host_feature_requests_description_check,
  drop constraint if exists host_feature_requests_category_check,
  drop constraint if exists host_feature_requests_status_check;

alter table public.host_feature_requests
  add constraint host_feature_requests_title_check
    check (char_length(btrim(title)) >= 3),
  add constraint host_feature_requests_description_check
    check (char_length(btrim(description)) >= 8),
  add constraint host_feature_requests_category_check
    check (category in ('housekeeping', 'messaging', 'pricing', 'disputes', 'access', 'other')),
  add constraint host_feature_requests_status_check
    check (status in ('under_review', 'planned', 'in_progress', 'completed'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.host_feature_requests'::regclass
      and contype = 'f'
      and conname = 'host_feature_requests_host_id_fkey'
  ) then
    alter table public.host_feature_requests
      add constraint host_feature_requests_host_id_fkey
      foreign key (host_id) references auth.users(id) on delete cascade;
  end if;
end
$$;

alter table public.host_feature_requests enable row level security;
alter table public.host_feature_requests force row level security;

drop policy if exists "hosts insert own feature requests" on public.host_feature_requests;
create policy "hosts insert own feature requests"
  on public.host_feature_requests
  for insert
  to authenticated
  with check (auth.uid() = host_id);

drop policy if exists "hosts read own feature requests" on public.host_feature_requests;
create policy "hosts read own feature requests"
  on public.host_feature_requests
  for select
  to authenticated
  using (auth.uid() = host_id);

revoke all on table public.host_feature_requests from public, anon, authenticated, service_role;
grant select, insert, update on table public.host_feature_requests to service_role;

comment on table public.host_feature_requests is
  'Authenticated host feedback submitted through the validated server route.';
