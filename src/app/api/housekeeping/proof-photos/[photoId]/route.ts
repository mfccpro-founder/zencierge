import "server-only";

import { requireHostAuthContext } from "@/lib/supabase-route";
import { housekeepingProofJson } from "@/lib/housekeeping-proof";
import {
  createSupabaseHousekeepingProofHostReviewStore,
  housekeepingProofHostPhotoBytesResponse,
  housekeepingProofHostReviewAdminClient,
  housekeepingProofHostReviewOwnershipStore,
  loadHousekeepingProofHostPhotoBytes,
} from "@/lib/housekeeping-proof-host-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ photoId: string }> },
) {
  const auth = await requireHostAuthContext();
  if (auth.error) return auth.error;

  const admin = housekeepingProofHostReviewAdminClient();
  if (!admin) return housekeepingProofJson({ error: "unavailable" }, 503);

  try {
    const { photoId } = await context.params;
    const result = await loadHousekeepingProofHostPhotoBytes({
      userId: auth.user?.id,
      hostAuthSource: auth.source,
      photoId,
      ownershipStore: housekeepingProofHostReviewOwnershipStore(admin),
      store: createSupabaseHousekeepingProofHostReviewStore(admin),
    });
    if (result.bytes && result.status === 200) {
      return housekeepingProofHostPhotoBytesResponse(result.bytes);
    }
    return housekeepingProofJson(result.body ?? { error: "unavailable" }, result.status);
  } catch {
    return housekeepingProofJson({ error: "unavailable" }, 503);
  }
}
