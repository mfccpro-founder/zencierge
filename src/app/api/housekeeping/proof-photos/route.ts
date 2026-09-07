import "server-only";

import { requireHostAuthContext } from "@/lib/supabase-route";
import { housekeepingProofJson } from "@/lib/housekeeping-proof";
import {
  createSupabaseHousekeepingProofHostReviewStore,
  housekeepingProofHostReviewAdminClient,
  housekeepingProofHostReviewOwnershipStore,
  listHousekeepingProofHostPhotos,
} from "@/lib/housekeeping-proof-host-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireHostAuthContext();
  if (auth.error) return auth.error;

  const admin = housekeepingProofHostReviewAdminClient();
  if (!admin) return housekeepingProofJson({ error: "unavailable" }, 503);

  try {
    const result = await listHousekeepingProofHostPhotos({
      userId: auth.user?.id,
      hostAuthSource: auth.source,
      search: new URL(request.url).searchParams,
      ownershipStore: housekeepingProofHostReviewOwnershipStore(admin),
      store: createSupabaseHousekeepingProofHostReviewStore(admin),
    });
    return housekeepingProofJson(result.body, result.status);
  } catch {
    return housekeepingProofJson({ error: "unavailable" }, 503);
  }
}
