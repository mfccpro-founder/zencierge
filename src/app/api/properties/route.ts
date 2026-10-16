import { requireHostUser } from "@/lib/supabase-route";
import type { Property } from "@/lib/dashboard-data";
import { ZENCIERGE_PLANS, isHostAccessGranted, parsePlanId } from "@/lib/zencierge-plans";
import { isSuperAdmin } from "@/lib/admin-auth";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import { hasLifetimeVipAccess } from "@/lib/lifetime-vip";
import {
  createSupabaseHostOwnershipStore,
  hostOwnsProperty,
  listOwnedPropertyIds,
} from "@/lib/host-property-ownership";
import { resolveConfiguredStripeSandboxAccess } from "@/lib/stripe-sandbox-access";
import {
  createHostPropertyAtomically,
  loadHostListings,
  updateHostProperty,
} from "@/lib/host-listings-server";
import { validatePropertyWriteIdentity } from "@/lib/property-write-validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;

  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return Response.json({ error: "Service unavailable" }, { status: 503 });

  const listings = await loadHostListings(admin, auth.user.id);
  if (listings.kind === "unavailable") {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  return Response.json(
    { properties: listings.properties, reservations: listings.reservations },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Never trust client-supplied ownership. Strip any host_id / hostId fields.
  const { host_id: _ignoredHostId, hostId: _ignoredHostIdCamel, ...rest } = body;
  void _ignoredHostId;
  void _ignoredHostIdCamel;
  const property = rest as unknown as Property;
  const identity = validatePropertyWriteIdentity(property);
  if (!identity.ok) return Response.json({ error: identity.error }, { status: 400 });
  property.id = identity.value.id;
  property.name = identity.value.name;
  property.city = identity.value.city;

  const admin = tryCreateSupabaseAdminClient();
  if (!admin) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const store = createSupabaseHostOwnershipStore(admin);
  const ownershipAuth = { userId: auth.user.id, source: "supabase-auth" as const };

  const existingLookup = await store.lookupPropertyHostId(property.id);
  if (existingLookup.kind === "error") {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const isCreate = existingLookup.kind === "missing";

  const { data: sub, error: subscriptionError } = await auth.supabase
    .from("host_subscriptions")
    .select("plan_id, status, complimentary_ends_at, is_lifetime_free, square_subscription_id, square_subscription_status")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (subscriptionError) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const stripeSandboxAccess = await resolveConfiguredStripeSandboxAccess({
    authenticated: auth.source === "supabase-auth",
    userId: auth.user.id,
    squareSubscriptionId: (sub?.square_subscription_id as string | null | undefined) ?? null,
  });
  const planId = stripeSandboxAccess.granted
    ? stripeSandboxAccess.planId
    : (parsePlanId(sub?.plan_id) ?? "starter");
  const plan = ZENCIERGE_PLANS[planId];
  const billed = isHostAccessGranted({
    subscriptionStatus: sub?.status as string | undefined,
    metadata: auth.user.app_metadata as Record<string, unknown> | undefined,
    complimentaryEndsAt: (sub?.complimentary_ends_at as string | null | undefined) ?? null,
    isLifetimeFree: sub?.is_lifetime_free === true,
    lifetimeVip: hasLifetimeVipAccess({ app_metadata: auth.user.app_metadata }),
    squareSubscriptionId: (sub?.square_subscription_id as string | null | undefined) ?? null,
    squareSubscriptionStatus: (sub?.square_subscription_status as string | null | undefined) ?? null,
  }) || stripeSandboxAccess.granted;

  if (!billed) {
    return Response.json(
      { error: "Your Zencierge access is not active.", plan: planId },
      { status: 403 },
    );
  }

  if (isCreate) {
    const owned = await listOwnedPropertyIds({ auth: ownershipAuth, store });
    if (owned.kind === "unavailable") {
      return Response.json({ error: "Service unavailable" }, { status: 503 });
    }
    const ownedCount = owned.ids.length;
    if (Number.isFinite(plan.maxProperties) && ownedCount >= plan.maxProperties) {
      return Response.json(
        {
          error:
            planId === "starter"
              ? "Starter allows 1 listing. Upgrade to Pro, Portfolio, or Agency to add more."
              : `Your ${plan.name} plan allows up to ${plan.maxProperties} properties.`,
          plan: planId,
          maxProperties: plan.maxProperties,
          count: ownedCount,
        },
        { status: 403 },
      );
    }

    const created = await createHostPropertyAtomically({
      admin,
      hostId: auth.user.id,
      property,
      maxProperties: Number.isFinite(plan.maxProperties) ? plan.maxProperties : null,
    });
    if (created.kind === "limit") {
      return Response.json(
        { error: `Your ${plan.name} plan allows up to ${plan.maxProperties} properties.`, plan: planId },
        { status: 403 },
      );
    }
    if (created.kind === "conflict") {
      return Response.json({ error: "Property id already exists" }, { status: 409 });
    }
    if (created.kind === "unavailable") {
      return Response.json({ error: "Service unavailable" }, { status: 503 });
    }
    return Response.json({ ok: true, id: property.id, plan: planId });
  }

  // UPDATE: ownership required for ordinary hosts. SuperAdmin may edit content of any
  // existing row. The server update payload never includes or reassigns host_id.
  const ownership = await hostOwnsProperty({
    propertyId: property.id,
    auth: ownershipAuth,
    store,
  });
  if (ownership.kind === "unavailable") {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const founder = isSuperAdmin(auth.user);
  if (ownership.kind !== "owned" && !founder) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await updateHostProperty(
    admin,
    property,
    ownership.kind === "owned" ? auth.user.id : undefined,
  );
  if (updated.kind !== "updated") {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  return Response.json({ ok: true, id: property.id, plan: planId });
}
