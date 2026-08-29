import { requireHostUser } from "@/lib/supabase-route";
import { fetchListings, upsertProperty } from "@/lib/supabase-listings";
import type { Property } from "@/lib/dashboard-data";
import { planFromMetadata, ZENCIERGE_PLANS, isHostAccessGranted, parsePlanId } from "@/lib/zencierge-plans";

export async function POST(request: Request) {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;

  let property: Property;
  try {
    property = (await request.json()) as Property;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!property?.id || !property.name?.trim()) {
    return Response.json({ error: "Property id and name are required" }, { status: 400 });
  }

  const { data: sub } = await auth.supabase
    .from("host_subscriptions")
    .select("plan_id, status")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const planId = parsePlanId(sub?.plan_id) ?? planFromMetadata(auth.user.user_metadata);
  const plan = ZENCIERGE_PLANS[planId];
  const listings = await fetchListings();
  const existing = listings.properties.some((row) => row.id === property.id);
  const billed = isHostAccessGranted({
    subscriptionStatus: sub?.status as string | undefined,
    metadata: auth.user.user_metadata as Record<string, unknown> | undefined,
  });

  if (!existing && !billed) {
    return Response.json(
      { error: "Start a 14-day free trial or activate a Zencierge plan to add listings.", plan: planId },
      { status: 403 },
    );
  }

  if (!existing && Number.isFinite(plan.maxProperties) && listings.properties.length >= plan.maxProperties) {
    return Response.json(
      {
        error:
          planId === "starter"
            ? "Starter allows 1 listing. Upgrade to Pro, Portfolio, or Agency to add more."
            : `Your ${plan.name} plan allows up to ${plan.maxProperties} properties.`,
        plan: planId,
        maxProperties: plan.maxProperties,
        count: listings.properties.length,
      },
      { status: 403 },
    );
  }

  try {
    await upsertProperty(property);
    return Response.json({ ok: true, id: property.id, plan: planId });
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : "Could not save property" },
      { status: 500 },
    );
  }
}
