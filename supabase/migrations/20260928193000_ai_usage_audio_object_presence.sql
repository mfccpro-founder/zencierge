-- Read-only presence of one TTS audio object. Pending review. Do not assume this file has been applied.
-- Cleanup uses it to tell a missing upload from committed audio and from a pending upload.
-- It does not insert, update, or delete, and it does not grant privileges on any table.
-- EXECUTE is revoked from public, anon, and authenticated, then granted only to service_role.
-- The function and its grants are applied in one transaction.

begin;

create or replace function public.describe_ai_usage_audio_object(
  p_object_key pg_catalog.text
)
returns table (
  result_presence pg_catalog.text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_commit pg_catalog.text;
  v_cleanup pg_catalog.text;
  v_deleted pg_catalog.timestamptz;
begin
  if p_object_key is null or pg_catalog.btrim(p_object_key) = '' then
    return query select 'missing'::pg_catalog.text;
    return;
  end if;

  select o.commit_state, o.cleanup_state, o.storage_deleted_at
  into v_commit, v_cleanup, v_deleted
  from public.ai_usage_audio_objects as o
  where o.object_key = pg_catalog.btrim(p_object_key);

  if v_commit is null then
    return query select 'missing'::pg_catalog.text;
    return;
  end if;
  if v_deleted is not null then
    return query select 'deleted'::pg_catalog.text;
    return;
  end if;
  if v_cleanup = 'cleanup_requested' then
    return query select 'cleanup'::pg_catalog.text;
    return;
  end if;
  if v_commit = 'committed' then
    return query select 'committed'::pg_catalog.text;
    return;
  end if;
  if v_commit = 'pending_upload' then
    return query select 'pending'::pg_catalog.text;
    return;
  end if;

  return query select 'registered'::pg_catalog.text;
end;
$$;

revoke all on function public.describe_ai_usage_audio_object(pg_catalog.text) from public;
revoke all on function public.describe_ai_usage_audio_object(pg_catalog.text) from anon;
revoke all on function public.describe_ai_usage_audio_object(pg_catalog.text) from authenticated;
grant execute on function public.describe_ai_usage_audio_object(pg_catalog.text) to service_role;

commit;
