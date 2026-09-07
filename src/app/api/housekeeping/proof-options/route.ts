import "server-only";

import { requireHostAuthContext } from "@/lib/supabase-route";
import {
  housekeepingProofAdminClient,
  housekeepingProofJson,
  housekeepingProofOwnershipStore,
} from "@/lib/housekeeping-proof";
import {
  createSupabaseHousekeepingProofOptionsStore,
  listHousekeepingProofOptions,
} from "@/lib/housekeeping-proof-options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireHostAuthContext();
  if (auth.error) return auth.error;

  const admin = housekeepingProofAdminClient();
  if (!admin) return housekeepingProofJson({ error: "unavailable" }, 503);

  try {
    const result = await listHousekeepingProofOptions({
      userId: auth.user?.id,
      hostAuthSource: auth.source,
      ownershipStore: housekeepingProofOwnershipStore(admin),
      store: createSupabaseHousekeepingProofOptionsStore(admin),
    });
    return housekeepingProofJson(result.body, result.status);
  } catch {
    return housekeepingProofJson({ error: "unavailable" }, 503);
  }
}
