import "server-only";

import { NextRequest } from "next/server";
import {
  housekeepingProofBodyTooLarge,
  housekeepingProofClientIp,
  housekeepingProofJson,
} from "@/lib/housekeeping-proof";
import {
  createSupabaseHousekeepingProofSubmitStore,
  handleHousekeepingProofSubmit,
  housekeepingProofSubmitAdminClient,
} from "@/lib/housekeeping-proof-submit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (housekeepingProofBodyTooLarge(request.headers.get("content-length"))) {
    return housekeepingProofJson({ error: "invalid" }, 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return housekeepingProofJson({ error: "invalid" }, 400);
  }
  if (housekeepingProofBodyTooLarge(null, body)) {
    return housekeepingProofJson({ error: "invalid" }, 400);
  }

  const admin = housekeepingProofSubmitAdminClient();
  if (!admin) return housekeepingProofJson({ error: "unavailable" }, 503);

  try {
    const result = await handleHousekeepingProofSubmit({
      body,
      ip: housekeepingProofClientIp(request.headers),
      store: createSupabaseHousekeepingProofSubmitStore(admin),
    });
    return housekeepingProofJson(result.body, result.status);
  } catch {
    return housekeepingProofJson({ error: "unavailable" }, 503);
  }
}
