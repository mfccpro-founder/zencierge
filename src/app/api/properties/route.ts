import { requireHostUser } from "@/lib/supabase-route";
import { fetchListings, upsertProperty } from "@/lib/supabase-listings";
import type { Property } from "@/lib/dashboard-data";
import { planFromMetadata, ZENCIERGE_PLANS } from "@/lib/zencierge-plans";

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

  const planId = planFromMetadata(auth.user.user_metadata);
  const plan = ZENCIERGE_PLANS[planId];
  const listings = await fetchListings();
  const existing = listings.properties.some((row) => row.id === property.id);

  if (!existing && Number.isFinite(plan.maxProperties) && listings.properties.length >= plan.maxProperties) {
    return Response.json(
      {
        error:
          planId === "starter"
            ? "El plan Starter permite 1 propiedad. Actualiza a Pro o Agency para añadir más."
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
