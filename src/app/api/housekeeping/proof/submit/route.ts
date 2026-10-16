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
import { hashHousekeepingProofToken, parseHousekeepingProofTokenBody } from "@/lib/housekeeping-proof";
import { createSupabaseGuestServiceRequestStore } from "@/lib/guest-service-requests";

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
    if (result.status === 200) {
      const parsed = parseHousekeepingProofTokenBody(body);
      if (!("error" in parsed)) {
        const { data, error } = await admin.from("housekeeping_proof_tokens").select("task_id").eq("token_hash", hashHousekeepingProofToken(parsed.token)).maybeSingle();
        if (error || !data || typeof data.task_id !== "string") return housekeepingProofJson({ error: "unavailable" }, 503);
        await createSupabaseGuestServiceRequestStore(admin).markByProofTask(data.task_id, "evidence_submitted");
      }
    }
    return housekeepingProofJson(result.body, result.status);
  } catch {
    return housekeepingProofJson({ error: "unavailable" }, 503);
  }
}
