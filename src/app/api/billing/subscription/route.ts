import { requireHostUser } from "@/lib/supabase-route";
import { hasLifetimeVipAccess } from "@/lib/lifetime-vip";
import { countHostProperties } from "@/lib/host-listings-server";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  isHostAccessGranted,
  isPaidSubscriptionStatus,
  isTrialWindowOpen,
  parsePlanId,
  planFromMetadata,
  ZENCIERGE_PLANS,
} from "@/lib/zencierge-plans";
import { resolveConfiguredStripeSandboxAccess } from "@/lib/stripe-sandbox-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;

  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return Response.json({ error: "Service unavailable" }, { status: 503 });
  const propertyCountResult = await countHostProperties(admin, auth.user.id);
  if (propertyCountResult.kind === "unavailable") {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const propertyCount = propertyCountResult.count;
  const meta = auth.user.user_metadata as Record<string, unknown> | undefined;
  const metaPlan = planFromMetadata(meta);

  const { data: sub, error: subError } = await auth.supabase
    .from("host_subscriptions")
    .select(
      "plan_id, status, monthly_usd, last_payment_at, current_period_end, square_customer_id, square_subscription_id, square_subscription_status, complimentary_ends_at, complimentary_starts_at, is_lifetime_free",
    )
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const tableMissing = Boolean(
    subError?.message && /schema cache|does not exist|host_subscriptions/i.test(subError.message),
  );
  const stripeSandboxAccess = await resolveConfiguredStripeSandboxAccess({
    authenticated: auth.source === "supabase-auth",
    userId: auth.user.id,
    squareSubscriptionId: (sub?.square_subscription_id as string | null | undefined) ?? null,
  });
  const planId = stripeSandboxAccess.granted
    ? stripeSandboxAccess.planId
    : (parsePlanId(sub?.plan_id) ?? metaPlan);
  const plan = ZENCIERGE_PLANS[planId];
  const trialEndsAt = typeof meta?.trial_ends_at === "string" ? meta.trial_ends_at : null;
  const metadataTrialActive = isTrialWindowOpen(trialEndsAt);
  // A verified Stripe sandbox payment is the effective access source. Keep the
  // untouched metadata trial visible separately, but do not describe paid access as a trial.
  const trialActive = !stripeSandboxAccess.granted && metadataTrialActive;
  const complimentaryEndsAt =
    typeof sub?.complimentary_ends_at === "string" ? sub.complimentary_ends_at : null;
  const compOpen =
    typeof complimentaryEndsAt === "string" &&
    Number.isFinite(Date.parse(complimentaryEndsAt)) &&
    Date.parse(complimentaryEndsAt) > Date.now();
  const standardAccess = isHostAccessGranted({
    subscriptionStatus: (sub?.status as string | undefined) ?? (meta?.subscription_status as string | undefined),
    metadata: meta,
    complimentaryEndsAt,
    isLifetimeFree: sub?.is_lifetime_free === true,
    lifetimeVip: hasLifetimeVipAccess(auth.user),
    squareSubscriptionId: (sub?.square_subscription_id as string | null | undefined) ?? null,
    squareSubscriptionStatus: (sub?.square_subscription_status as string | null | undefined) ?? null,
  });
  const access = standardAccess || stripeSandboxAccess.granted;
  const status = stripeSandboxAccess.granted
    ? "active"
    : isPaidSubscriptionStatus(sub?.status as string | undefined)
    ? "active"
    : compOpen
      ? "complimentary"
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
    monthlyUsd: stripeSandboxAccess.granted
      ? plan.monthlyUsd
      : Number(sub?.monthly_usd ?? plan.monthlyUsd),
    status,
    isActive,
    maxProperties: plan.maxProperties,
    propertyCount,
    canAddProperty,
    canUseOvernightCoverage: planId !== "starter",
    canUseAgencyTools: planId === "agency",
    lastPaymentAt: sub?.last_payment_at ?? null,
    currentPeriodEnd: stripeSandboxAccess.granted
      ? stripeSandboxAccess.currentPeriodEnd
      : (complimentaryEndsAt ?? trialEndsAt ?? sub?.current_period_end ?? null),
    accessSource: stripeSandboxAccess.granted ? "stripe_sandbox" : "standard",
    billingCycle: stripeSandboxAccess.granted ? stripeSandboxAccess.billingCycle : null,
    squareCustomerId: sub?.square_customer_id ?? null,
    tableReady: !tableMissing,
    payments: payments ?? [],
    trialEndsAt,
    trialActive,
    metadataTrialActive,
    complimentaryEndsAt,
    complimentaryStartsAt: sub?.complimentary_starts_at ?? null,
    complimentaryActive: compOpen,
  });
}
