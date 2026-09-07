import { requireHostUser } from "@/lib/supabase-route";
import { upsertProperty } from "@/lib/supabase-listings";
import type { Property } from "@/lib/dashboard-data";
import { planFromMetadata, ZENCIERGE_PLANS, isHostAccessGranted, parsePlanId } from "@/lib/zencierge-plans";
import { isSuperAdmin } from "@/lib/admin-auth";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import { hasLifetimeVipAccess } from "@/lib/lifetime-vip";
import {
  createSupabaseHostOwnershipStore,
  hostOwnsProperty,
  listOwnedPropertyIds,
} from "@/lib/host-property-ownership";

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

  if (!property?.id || !property.name?.trim()) {
    return Response.json({ error: "Property id and name are required" }, { status: 400 });
  }

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

  const { data: sub } = await auth.supabase
    .from("host_subscriptions")
    .select("plan_id, status, complimentary_ends_at, is_lifetime_free")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const planId = parsePlanId(sub?.plan_id) ?? planFromMetadata(auth.user.user_metadata);
  const plan = ZENCIERGE_PLANS[planId];
  const billed = isHostAccessGranted({
    subscriptionStatus: sub?.status as string | undefined,
    metadata: auth.user.user_metadata as Record<string, unknown> | undefined,
    complimentaryEndsAt: (sub?.complimentary_ends_at as string | null | undefined) ?? null,
    isLifetimeFree: sub?.is_lifetime_free === true,
    lifetimeVip: hasLifetimeVipAccess(auth.user),
  });

  if (isCreate) {
    if (!billed) {
      return Response.json(
        { error: "Start a 14-day free trial or activate a Zencierge plan to add listings.", plan: planId },
        { status: 403 },
      );
    }

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

    try {
      await upsertProperty(property, { mode: "create", hostId: auth.user.id });
      return Response.json({ ok: true, id: property.id, plan: planId });
    } catch (cause) {
      return Response.json(
        { error: cause instanceof Error ? cause.message : "Could not save property" },
        { status: 500 },
      );
    }
  }

  // UPDATE: ownership required for ordinary hosts. SuperAdmin may edit content of any
  // existing row but never reassign host_id (upsertProperty update omits host_id).
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

  try {
    await upsertProperty(property, { mode: "update" });
    return Response.json({ ok: true, id: property.id, plan: planId });
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : "Could not save property" },
      { status: 500 },
    );
  }
}
