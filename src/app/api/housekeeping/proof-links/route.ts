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
    return housekeepingProofJson(result.body, result.status);
  } catch {
    return housekeepingProofJson({ error: "unavailable" }, 503);
  }
}
