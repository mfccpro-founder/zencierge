import { resolveSquareEnvironment } from "@/lib/square-client";
import {
  resolveSquareSubscriptionPlan,
  type SquareEnvironmentName,
  type SquareSubscriptionPlanEnvironment,
} from "@/lib/square-subscription-plans";
import {
  SquareBillingStoreError,
  assertNoSquareBillingTokenKeys,
  type SquareBillingStores,
  type SquareSubscriptionIntentRow,
} from "@/lib/square-billing-stores";
import { tryCreateSupabaseSquareBillingStores } from "@/lib/square-billing-supabase-stores";
import {
  parseBillingCycle,
  parsePlanId,
  type BillingCycle,
  type ZenciergePlanId,
} from "@/lib/zencierge-plans";

/** Server-only fail-soft checkout → billing-intent side effect. */
if (typeof window !== "undefined") {
  throw new Error("square-checkout-billing-intent is server-only");
}

const INTENT_TTL_MS = 6 * 60 * 60 * 1000;

export type CheckoutBillingIntentContext = {
  kind?: string | null;
  userId?: string | null;
  planId?: string | null;
  billingCycle?: string | null;
};

export type CheckoutBillingIntentSkipReason =
  | "not_host_subscription"
  | "missing_user"
  | "invalid_plan"
  | "invalid_billing_cycle"
  | "missing_environment"
  | "missing_location"
  | "missing_plan_variation"
  | "store_unavailable";

export type CheckoutBillingIntentResult =
  | {
      status: "created" | "replayed";
      intentId: string;
      logicalKey: string;
    }
  | {
      status: "skipped";
      reason: CheckoutBillingIntentSkipReason;
    }
  | {
      status: "failed_soft";
      reason: "conflict" | "store_error" | "invalid_input";
    };

export type CheckoutBillingIntentDependencies = {
  createStores?: () => SquareBillingStores | null;
  resolvePlan?: (input: {
    planId: ZenciergePlanId;
    billingCycle: BillingCycle;
  }) => {
    environment: SquareEnvironmentName;
    planId: ZenciergePlanId;
    billingCycle: BillingCycle;
    planVariationId: string;
    amountUsd: number;
  };
  resolveLocationId?: () => string | null;
  resolveEnvironmentName?: () => SquareEnvironmentName | null;
  now?: () => Date;
  env?: SquareSubscriptionPlanEnvironment & {
    SQUARE_LOCATION_ID?: string;
    SQUARE_ENVIRONMENT?: string;
  };
};

/**
 * Logical checkout idempotency identity (safe identifiers only).
 * Not a Square API key and never includes secrets/tokens.
 */
export function buildCheckoutBillingIntentLogicalKey(input: {
  userId: string;
  environment: SquareEnvironmentName;
  planId: ZenciergePlanId;
  billingCycle: BillingCycle;
  locationId: string;
  planVariationId: string;
}) {
  return [
    input.userId,
    input.environment,
    input.planId,
    input.billingCycle,
    input.locationId,
    input.planVariationId,
  ].join(":");
}

/**
 * Stable expires_at so same-hour checkout retries can exact-replay
 * against the one-open-intent store contract.
 */
export function stableCheckoutBillingIntentExpiresAt(now: Date): string {
  const floored = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
  );
  return new Date(floored + INTENT_TTL_MS).toISOString();
}

function defaultLocationId(env: { SQUARE_LOCATION_ID?: string }): string | null {
  const value = env.SQUARE_LOCATION_ID?.trim() ?? "";
  if (!value || /placeholder|pega_aqui|your-square/i.test(value)) return null;
  return value;
}

function defaultEnvironmentName(
  env: { SQUARE_ENVIRONMENT?: string },
): SquareEnvironmentName | null {
  try {
    return resolveSquareEnvironment(env.SQUARE_ENVIRONMENT).name;
  } catch {
    return null;
  }
}

function defaultResolvePlan(
  input: { planId: ZenciergePlanId; billingCycle: BillingCycle },
  env: SquareSubscriptionPlanEnvironment,
) {
  return resolveSquareSubscriptionPlan(input, env);
}

function mapStoreFailure(error: unknown): CheckoutBillingIntentResult {
  if (error instanceof SquareBillingStoreError) {
    if (error.code === "conflict") {
      return { status: "failed_soft", reason: "conflict" };
    }
    if (error.code === "invalid_input") {
      return { status: "failed_soft", reason: "invalid_input" };
    }
  }
  return { status: "failed_soft", reason: "store_error" };
}

/**
 * Fail-soft side effect for canonical authenticated host checkout.
 * Never throws to callers. Never changes entitlement or checkout URL.
 * Creates only a subscription intent row when configuration + store are ready.
 */
export async function maybeCreateCheckoutBillingIntent(
  context: CheckoutBillingIntentContext,
  dependencies: CheckoutBillingIntentDependencies = {},
): Promise<CheckoutBillingIntentResult> {
  try {
    assertNoSquareBillingTokenKeys(context);
    assertNoSquareBillingTokenKeys(dependencies);

    const kind = context.kind === "guest_addon" ? "guest_addon" : "host_subscription";
    if (kind !== "host_subscription") {
      return { status: "skipped", reason: "not_host_subscription" };
    }

    const userId =
      typeof context.userId === "string" ? context.userId.trim() : "";
    if (!userId) {
      return { status: "skipped", reason: "missing_user" };
    }

    const planId = parsePlanId(context.planId) ?? parsePlanId("pro");
    if (!planId) {
      return { status: "skipped", reason: "invalid_plan" };
    }

    const billingCycle =
      parseBillingCycle(context.billingCycle) ??
      parseBillingCycle("monthly");
    if (!billingCycle) {
      return { status: "skipped", reason: "invalid_billing_cycle" };
    }

    const env = (dependencies.env ?? process.env) as SquareSubscriptionPlanEnvironment & {
      SQUARE_LOCATION_ID?: string;
      SQUARE_ENVIRONMENT?: string;
    };
    const environment =
      dependencies.resolveEnvironmentName?.() ?? defaultEnvironmentName(env);
    if (!environment) {
      return { status: "skipped", reason: "missing_environment" };
    }

    const locationId =
      dependencies.resolveLocationId?.() ?? defaultLocationId(env);
    if (!locationId) {
      return { status: "skipped", reason: "missing_location" };
    }

    let resolved: {
      environment: SquareEnvironmentName;
      planId: ZenciergePlanId;
      billingCycle: BillingCycle;
      planVariationId: string;
      amountUsd: number;
    };
    try {
      resolved =
        dependencies.resolvePlan?.({ planId, billingCycle }) ??
        defaultResolvePlan({ planId, billingCycle }, env);
    } catch {
      return { status: "skipped", reason: "missing_plan_variation" };
    }
    if (
      !resolved.planVariationId.trim() ||
      resolved.environment !== environment ||
      resolved.planId !== planId ||
      resolved.billingCycle !== billingCycle
    ) {
      return { status: "skipped", reason: "missing_plan_variation" };
    }

    const createStores =
      dependencies.createStores ?? (() => tryCreateSupabaseSquareBillingStores());
    const stores = createStores();
    if (!stores) {
      return { status: "skipped", reason: "store_unavailable" };
    }

    const now = dependencies.now?.() ?? new Date();
    const expiresAt = stableCheckoutBillingIntentExpiresAt(now);
    const logicalKey = buildCheckoutBillingIntentLogicalKey({
      userId,
      environment,
      planId,
      billingCycle,
      locationId,
      planVariationId: resolved.planVariationId,
    });

    const createInput = {
      userId,
      planId,
      billingCycle,
      billingAmountUsd: resolved.amountUsd,
      squareEnvironment: environment,
      squareLocationId: locationId,
      squarePlanVariationId: resolved.planVariationId,
      complimentaryUntil: null,
      expiresAt,
    };
    assertNoSquareBillingTokenKeys(createInput);

    const result = await stores.intents.createIntent(createInput);
    const intent: SquareSubscriptionIntentRow = result.intent;
    return {
      status: result.replayed ? "replayed" : "created",
      intentId: intent.id,
      logicalKey,
    };
  } catch (error) {
    return mapStoreFailure(error);
  }
}
