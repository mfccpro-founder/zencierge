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
    return housekeepingProofJson(result.body, result.status);
  } catch {
    return housekeepingProofJson({ error: "unavailable" }, 503);
  }
}
