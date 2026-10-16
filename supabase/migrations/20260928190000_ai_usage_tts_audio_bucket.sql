-- Private bucket for TTS meter audio. Pending review. Do not assume this file has been applied.
-- Server access uses the Storage API with service_role. This file creates no anon or authenticated policy.
-- Existing storage.objects policies are checked by supabase/verification/20260928190000_ai_usage_tts_audio_storage_access.sql.
-- It does not create public URLs, signed URLs, or a bucket lifecycle expiry.
-- Object retention is the application expires_at field plus mark_ai_usage_audio_for_cleanup.
-- file_size_limit is 5242880 bytes, the same ceiling as AI_USAGE_TTS_AUDIO_MAX_BYTES.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ai-usage-tts-audio',
  'ai-usage-tts-audio',
  false,
  5242880,
  array['audio/mpeg', 'audio/wav', 'audio/pcm']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
