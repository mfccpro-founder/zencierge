import "server-only";

import { NextRequest } from "next/server";
import { requireHostAuthContext } from "@/lib/supabase-route";
import {
  housekeepingProofAdminClient,
  housekeepingProofBodyTooLarge,
  housekeepingProofClientIp,
  housekeepingProofJson,
  housekeepingProofOwnershipStore,
  issueHousekeepingProofLink,
  createSupabaseHousekeepingProofStore,
} from "@/lib/housekeeping-proof";
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

  const admin = housekeepingProofAdminClient();
  if (!admin) return housekeepingProofJson({ error: "unavailable" }, 503);

  try {
    const result = await issueHousekeepingProofLink({
      userId: auth.user?.id,
      hostAuthSource: auth.source,
      body,
      ip: housekeepingProofClientIp(request.headers),
      store: createSupabaseHousekeepingProofStore(admin),
      ownershipStore: housekeepingProofOwnershipStore(admin),
    });
    if (result.status === 200 && body && typeof body === "object" && !Array.isArray(body)) {
      const reservationId = typeof (body as { reservationId?: unknown }).reservationId === "string" ? (body as { reservationId: string }).reservationId : "";
      const stage = typeof (body as { stage?: unknown }).stage === "string" ? (body as { stage: string }).stage : "";
      const { data, error } = await admin.from("housekeeping_proof_tasks").select("id").eq("reservation_id", reservationId).eq("stage", stage).maybeSingle();
      if (error || !data || typeof data.id !== "string") return housekeepingProofJson({ error: "unavailable" }, 503);
      await createSupabaseGuestServiceRequestStore(admin).linkProofForReservation(reservationId, data.id);
    }
    return housekeepingProofJson(result.body, result.status);
  } catch {
    return housekeepingProofJson({ error: "unavailable" }, 503);
  }
}
