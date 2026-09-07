import "server-only";

import { NextRequest } from "next/server";
import { requireHostAuthContext } from "@/lib/supabase-route";
import {
  authorizeHostStayLink,
  createSupabaseStayTokenStore,
  guestStayAdminClient,
  issueGuestStayLink,
  listEligibleQrStaysForProperty,
  logStayLinksGetFailure,
  logStayLinksPostFailure,
  parseStayLinkBody,
  stayJson,
} from "@/lib/guest-stay-token";
import { hostStayLinksGetGate, parseStayLinksPropertyId } from "@/lib/guest-stay-qr";
import {
  createSupabaseHostOwnershipStore,
  listOwnedPropertyIds,
  stayLinksPostOwnershipGate,
  type HostOwnershipAuthSource,
} from "@/lib/host-property-ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 40;
const rateHits = new Map<string, number[]>();

function rateLimited(key: string) {
  const now = Date.now();
  const recent = (rateHits.get(key) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    rateHits.set(key, recent);
    return true;
  }
  recent.push(now);
  rateHits.set(key, recent);
  if (rateHits.size > 500) {
    const oldest = rateHits.keys().next().value;
    if (oldest) rateHits.delete(oldest);
  }
  return false;
}

function hostOwnershipAuth(userId: string | null | undefined, source: HostOwnershipAuthSource | null) {
  if (source !== "supabase-auth" && source !== "dev-fallback") return null;
  return { userId, source };
}

export async function GET(request: NextRequest) {
  const auth = await requireHostAuthContext();
  if (auth.error) return auth.error;

  const gated = hostStayLinksGetGate(auth.user?.id);
  if (gated) return stayJson(gated.body, gated.status);

  if (rateLimited(`stay-links-get:${auth.user?.id ?? "none"}`)) {
    return stayJson({ error: "unavailable" }, 429);
  }

  const propertyId = parseStayLinksPropertyId(request.nextUrl.searchParams.get("propertyId"));
  if (!propertyId) return stayJson({ error: "invalid" }, 400);

  const provenance = hostOwnershipAuth(auth.user?.id, auth.source);
  if (!provenance) {
    logStayLinksGetFailure({ branch: "authorization-error", status: 401, errorName: "Unauthorized" });
    return stayJson({ error: "Unauthorized" }, 401);
  }

  const admin = guestStayAdminClient();
  if (!admin) {
    logStayLinksGetFailure({ branch: "admin-missing", status: 503, errorName: "AdminMissing" });
    return stayJson({ error: "unavailable" }, 503);
  }

  const ownershipStore = createSupabaseHostOwnershipStore(admin);
  let ownedPropertyIds: string[] = [];
  try {
    const listed = await listOwnedPropertyIds({ auth: provenance, store: ownershipStore });
    if (listed.kind === "unavailable") {
      logStayLinksGetFailure({ branch: "ownership-unavailable", status: 503, errorName: "Unavailable" });
      return stayJson({ error: "unavailable" }, 503);
    }
    ownedPropertyIds = listed.ids;
  } catch {
    logStayLinksGetFailure({ branch: "ownership-unavailable", status: 503, errorName: "Unavailable" });
    return stayJson({ error: "unavailable" }, 503);
  }

  const access = authorizeHostStayLink(auth.user?.id, ownedPropertyIds, propertyId);
  if (access === "unauthorized") {
    logStayLinksGetFailure({ branch: "authorization-error", status: 401, errorName: "Unauthorized" });
    return stayJson({ error: "Unauthorized" }, 401);
  }
  if (access === "forbidden") {
    logStayLinksGetFailure({ branch: "ownership-unowned", status: 403, errorName: "Forbidden" });
    return stayJson({ error: "forbidden" }, 403);
  }

  try {
    const result = await listEligibleQrStaysForProperty({ admin, propertyId });
    if (result.diagnostic) logStayLinksGetFailure(result.diagnostic);
    return stayJson(result.body, result.status);
  } catch {
    logStayLinksGetFailure({ branch: "catch", status: 503, errorName: "Error" });
    return stayJson({ error: "unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireHostAuthContext();
  if (auth.error) return auth.error;

  if (rateLimited(`stay-links-post:${auth.user?.id ?? "none"}`)) {
    return stayJson({ error: "unavailable" }, 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return stayJson({ error: "invalid" }, 400);
  }

  const provenance = hostOwnershipAuth(auth.user?.id, auth.source);
  if (!provenance) return stayJson({ error: "Unauthorized" }, 401);

  const parsed = parseStayLinkBody(body);
  if ("error" in parsed) return stayJson({ error: parsed.error }, 400);

  const admin = guestStayAdminClient();
  if (!admin) return stayJson({ error: "unavailable" }, 503);

  const ownershipStore = createSupabaseHostOwnershipStore(admin);
  let ownedPropertyId: string;
  try {
    const gate = await stayLinksPostOwnershipGate({
      reservationId: parsed.reservationId,
      auth: provenance,
      store: ownershipStore,
    });
    if (gate.kind === "unowned") {
      logStayLinksPostFailure({ branch: "ownership-unowned", status: 403, errorName: "Forbidden" });
      return stayJson({ error: "forbidden" }, 403);
    }
    if (gate.kind === "unavailable") {
      logStayLinksPostFailure({ branch: "ownership-unavailable", status: 503, errorName: "Unavailable" });
      return stayJson({ error: "unavailable" }, 503);
    }
    ownedPropertyId = gate.propertyId;
  } catch {
    logStayLinksPostFailure({ branch: "ownership-unavailable", status: 503, errorName: "Unavailable" });
    return stayJson({ error: "unavailable" }, 503);
  }

  try {
    const result = await issueGuestStayLink({
      userId: auth.user?.id,
      hostAuthSource: auth.source,
      ownedPropertyIds: [ownedPropertyId],
      body,
      store: createSupabaseStayTokenStore(admin),
    });
    if (result.diagnostic) logStayLinksPostFailure(result.diagnostic);
    return stayJson(result.body, result.status);
  } catch {
    logStayLinksPostFailure({ branch: "catch", status: 503, errorName: "Error" });
    return stayJson({ error: "unavailable" }, 503);
  }
}
