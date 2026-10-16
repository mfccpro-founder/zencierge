import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Property } from "@/lib/dashboard-data";
import {
  createSupabaseStayTokenStore,
  hashStayToken,
  validateGuestStayToken,
} from "@/lib/guest-stay-token";
import { loadPropertyById } from "@/lib/host-listings-server";

export type GuestPropertyAccess =
  | { kind: "authorized"; property: Property }
  | { kind: "rejected"; status: number; error: string };

export async function authorizeGuestProperty(input: {
  admin: SupabaseClient;
  token: unknown;
  requestedPropertyId?: unknown;
  now?: Date;
}): Promise<GuestPropertyAccess> {
  const validation = await validateGuestStayToken({
    body: { token: input.token },
    now: input.now,
    store: createSupabaseStayTokenStore(input.admin),
  });
  if (validation.status !== 200) {
    return {
      kind: "rejected",
      status: validation.status,
      error: String(validation.body.error ?? "invalid"),
    };
  }

  const token = String(input.token);
  const { data: tokenRow, error: tokenError } = await input.admin
    .from("guest_stay_tokens")
    .select("property_id")
    .eq("token_hash", hashStayToken(token))
    .maybeSingle();
  if (tokenError || !tokenRow?.property_id) {
    return { kind: "rejected", status: 404, error: "invalid" };
  }
  const requested = typeof input.requestedPropertyId === "string" ? input.requestedPropertyId.trim() : "";
  if (requested && requested !== tokenRow.property_id) {
    return { kind: "rejected", status: 403, error: "forbidden" };
  }
  const loaded = await loadPropertyById(input.admin, tokenRow.property_id);
  if (loaded.kind !== "found") {
    return { kind: "rejected", status: loaded.kind === "unavailable" ? 503 : 404, error: "unavailable" };
  }
  return { kind: "authorized", property: loaded.property };
}
