import "server-only";

import { NextRequest } from "next/server";
import { requireHostAuthContext } from "@/lib/supabase-route";
import { housekeepingProofBodyTooLarge, housekeepingProofJson } from "@/lib/housekeeping-proof";
import {
  createSupabaseHousekeepingProofHostReviewStore,
  housekeepingProofHostReviewAdminClient,
  housekeepingProofHostReviewOwnershipStore,
  reviewHousekeepingProofHostBatch,
} from "@/lib/housekeeping-proof-host-review";
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

  const auth = await requireHostAuthContext();
  if (auth.error) return auth.error;

  const admin = housekeepingProofHostReviewAdminClient();
  if (!admin) return housekeepingProofJson({ error: "unavailable" }, 503);

  try {
    const result = await reviewHousekeepingProofHostBatch({
      userId: auth.user?.id,
      hostAuthSource: auth.source,
      body,
      ownershipStore: housekeepingProofHostReviewOwnershipStore(admin),
      store: createSupabaseHousekeepingProofHostReviewStore(admin),
    });
    if (result.status === 200 && body && typeof body === "object" && !Array.isArray(body)) {
      const reservationId = typeof (body as { reservationId?: unknown }).reservationId === "string" ? (body as { reservationId: string }).reservationId : "";
      const stage = typeof (body as { stage?: unknown }).stage === "string" ? (body as { stage: string }).stage : "";
      const decision = (body as { decision?: unknown }).decision;
      const { data, error } = await admin.from("housekeeping_proof_tasks").select("id").eq("reservation_id", reservationId).eq("stage", stage).maybeSingle();
      if (error || !data || typeof data.id !== "string") return housekeepingProofJson({ error: "unavailable" }, 503);
      await createSupabaseGuestServiceRequestStore(admin).markByProofTask(data.id, decision === "approve" ? "completed" : "needs_attention");
    }
    return housekeepingProofJson(result.body, result.status);
  } catch {
    return housekeepingProofJson({ error: "unavailable" }, 503);
  }
}
