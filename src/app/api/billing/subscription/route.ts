import { requireHostUser } from "@/lib/supabase-route";
import { fetchListings } from "@/lib/supabase-listings";
import {
  isHostAccessGranted,
  isPaidSubscriptionStatus,
  isTrialWindowOpen,
  parsePlanId,
  planFromMetadata,
  ZENCIERGE_PLANS,
} from "@/lib/zencierge-plans";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;

  const listings = await fetchListings();
  const propertyCount = listings.properties.length;
  const meta = auth.user.user_metadata as Record<string, unknown> | undefined;
  const metaPlan = planFromMetadata(meta);

  const { data: sub, error: subError } = await auth.supabase
    .from("host_subscriptions")
    .select(
      "plan_id, status, monthly_usd, last_payment_at, current_period_end, square_customer_id, square_subscription_id",
    )
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const tableMissing = Boolean(
    subError?.message && /schema cache|does not exist|host_subscriptions/i.test(subError.message),
  );
  const planId = parsePlanId(sub?.plan_id) ?? metaPlan;
  const plan = ZENCIERGE_PLANS[planId];
  const trialEndsAt = typeof meta?.trial_ends_at === "string" ? meta.trial_ends_at : null;
  const trialActive = isTrialWindowOpen(trialEndsAt);
  const access = isHostAccessGranted({
    subscriptionStatus: (sub?.status as string | undefined) ?? (meta?.subscription_status as string | undefined),
    metadata: meta,
  });
  const status = isPaidSubscriptionStatus(sub?.status as string | undefined)
    ? "active"
    : trialActive || (access && !isPaidSubscriptionStatus(sub?.status as string | undefined))
      ? "trial"
      : ((sub?.status as string | undefined) ?? "inactive");
  const isActive = access;
  const canAddProperty = isActive && (!Number.isFinite(plan.maxProperties) || propertyCount < plan.maxProperties);

  const paymentsQuery = auth.supabase
    .from("subscription_payments")
    .select("id, amount_usd, plan_id, status, provider_payment_id, created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(25);
  const { data: payments } = await paymentsQuery;

  return Response.json({
    planId,
    planName: plan.name,
    monthlyUsd: Number(sub?.monthly_usd ?? plan.monthlyUsd),
    status,
    isActive,
    maxProperties: plan.maxProperties,
    propertyCount,
    canAddProperty,
    canUseOvernightCoverage: planId !== "starter",
    canUseAgencyTools: planId === "agency",
    lastPaymentAt: sub?.last_payment_at ?? null,
    currentPeriodEnd: trialEndsAt ?? sub?.current_period_end ?? null,
    squareCustomerId: sub?.square_customer_id ?? null,
    tableReady: !tableMissing,
    payments: payments ?? [],
    trialEndsAt,
    trialActive,
  });
}
