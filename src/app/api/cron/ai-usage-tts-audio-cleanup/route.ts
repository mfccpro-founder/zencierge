import { cleanupAiUsageAudioBatch, createAiUsageAudioStorage } from "@/lib/ai-usage-audio";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCHEDULING_NOTE =
  "Scheduler OFF. Prepared for Vercel Cron */15 (see deploy/vercel.crons.ai-usage-tts-audio.example.json). The private bucket has no automatic expiry. Auth: Bearer CRON_SECRET or x-cron-secret.";

function extractCronSecret(request: Request): string {
  const headerSecret = request.headers.get("x-cron-secret")?.trim() ?? "";
  if (headerSecret) return headerSecret;
  const auth = request.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  return bearer?.[1]?.trim() ?? "";
}

/**
 * Deletes expired and orphan TTS audio through the meter cleanup RPCs and the Storage API.
 * Automatic scheduling stays off until the private bucket is verified in sandbox.
 */
async function handle(request: Request) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) {
    return Response.json(
      { ok: false, error: "CRON_SECRET is not configured", schedulingNote: SCHEDULING_NOTE },
      { status: 503 },
    );
  }
  if (extractCronSecret(request) !== expected) {
    return Response.json({ ok: false, error: "Unauthorized", schedulingNote: SCHEDULING_NOTE }, { status: 401 });
  }

  const admin = tryCreateSupabaseAdminClient();
  if (!admin) {
    return Response.json(
      { ok: false, error: "Storage admin is not configured", schedulingNote: SCHEDULING_NOTE },
      { status: 503 },
    );
  }

  const result = await cleanupAiUsageAudioBatch({
    rpc: admin,
    storage: createAiUsageAudioStorage((bucket) => admin.storage.from(bucket)),
  });
  return Response.json(
    {
      ok: result.ok,
      marked: result.marked,
      listed: result.listed,
      acknowledged: result.acknowledged,
      retry: result.retry,
      skipped: result.skipped,
      recovered: result.recovered,
      untrackedDeferred: result.untrackedDeferred,
      error: result.message ?? null,
      schedulingNote: SCHEDULING_NOTE,
    },
    { status: result.ok ? 200 : 500 },
  );
}

export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}
