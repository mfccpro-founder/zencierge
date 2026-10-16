import "server-only";

import { NextRequest } from "next/server";
import { housekeepingProofBodyTooLarge, housekeepingProofJson } from "@/lib/housekeeping-proof";
import { handleHousekeepingDemoProgress } from "@/lib/housekeeping-mobile-demo";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (housekeepingProofBodyTooLarge(request.headers.get("content-length"))) return housekeepingProofJson({ error: "invalid" }, 400);
  let body: unknown;
  try { body = await request.json(); } catch { return housekeepingProofJson({ error: "invalid" }, 400); }
  if (housekeepingProofBodyTooLarge(null, body)) return housekeepingProofJson({ error: "invalid" }, 400);
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return housekeepingProofJson({ error: "unavailable" }, 503);
  try {
    const result = await handleHousekeepingDemoProgress(admin, body);
    return housekeepingProofJson(result.body, result.status);
  } catch {
    return housekeepingProofJson({ error: "unavailable" }, 503);
  }
}
