import { parseBillingCycle, parsePlanId } from "./zencierge-plans";
import type { BillingCycle } from "./zencierge-plans";

/**
 * Local Stripe Sandbox plan correspondence.
 *
 * A value that matches the `price_` prefix is accepted only as a syntactic
 * Price id. That check does not prove the Price exists, is active, or belongs
 * to the Stripe Sandbox account. Remote verification against Stripe is pending
 * and is out of scope for this module.
 */
export const STRIPE_SANDBOX_PRICE_OWNERSHIP_VERIFICATION = "pending" as const;

export const STRIPE_SANDBOX_SUPPORTED_PLAN_IDS = [
  "starter",
  "pro",
  "portfolio",
  "agency",
] as const;

export type StripeSandboxSupportedPlanId =
  (typeof STRIPE_SANDBOX_SUPPORTED_PLAN_IDS)[number];

export type StripeSandboxPriceEnvironmentVariable =
  | "STRIPE_SANDBOX_PRICE_STARTER_MONTHLY"
  | "STRIPE_SANDBOX_PRICE_STARTER_ANNUAL"
  | "STRIPE_SANDBOX_PRICE_PRO_MONTHLY"
  | "STRIPE_SANDBOX_PRICE_PRO_ANNUAL"
  | "STRIPE_SANDBOX_PRICE_PORTFOLIO_MONTHLY"
  | "STRIPE_SANDBOX_PRICE_PORTFOLIO_ANNUAL"
  | "STRIPE_SANDBOX_PRICE_AGENCY_MONTHLY"
  | "STRIPE_SANDBOX_PRICE_AGENCY_ANNUAL";

export const STRIPE_SANDBOX_PRICE_ENVIRONMENT_VARIABLES = {
  starter: {
    monthly: "STRIPE_SANDBOX_PRICE_STARTER_MONTHLY",
    annual: "STRIPE_SANDBOX_PRICE_STARTER_ANNUAL",
  },
  pro: {
    monthly: "STRIPE_SANDBOX_PRICE_PRO_MONTHLY",
    annual: "STRIPE_SANDBOX_PRICE_PRO_ANNUAL",
  },
  portfolio: {
    monthly: "STRIPE_SANDBOX_PRICE_PORTFOLIO_MONTHLY",
    annual: "STRIPE_SANDBOX_PRICE_PORTFOLIO_ANNUAL",
  },
  agency: {
    monthly: "STRIPE_SANDBOX_PRICE_AGENCY_MONTHLY",
    annual: "STRIPE_SANDBOX_PRICE_AGENCY_ANNUAL",
  },
} as const satisfies Record<
  StripeSandboxSupportedPlanId,
  Record<BillingCycle, StripeSandboxPriceEnvironmentVariable>
>;

export type StripeSandboxPlanConfiguration = Partial<
  Record<StripeSandboxPriceEnvironmentVariable, string | undefined>
>;

export type ResolvedStripeSandboxPlan = {
  environment: "sandbox";
  planId: StripeSandboxSupportedPlanId;
  billingCycle: BillingCycle;
  priceId: string;
  environmentVariable: StripeSandboxPriceEnvironmentVariable;
};

const SANDBOX_ENVIRONMENT = "sandbox";
const ENVIRONMENT_ERROR = "Stripe environment must be sandbox";
const INVALID_PLAN_ERROR = "Invalid Stripe Sandbox plan";
const INVALID_CYCLE_ERROR = "Invalid Stripe Sandbox billing cycle";
const UNAVAILABLE_PRICE_ERROR =
  "Stripe Sandbox price configuration is unavailable";

/** Format only. Remote Sandbox ownership verification is pending. */
const PRICE_ID_FORMAT = /^price_[A-Za-z0-9_]+$/;

function normalizedPlanId(value: unknown) {
  if (typeof value !== "string") return null;
  return parsePlanId(value.trim().toLowerCase());
}

function isSupportedPlanId(
  planId: string,
): planId is StripeSandboxSupportedPlanId {
  return (STRIPE_SANDBOX_SUPPORTED_PLAN_IDS as readonly string[]).includes(
    planId,
  );
}

function configuredPriceId(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  if (!PRICE_ID_FORMAT.test(normalized)) {
    throw new Error(UNAVAILABLE_PRICE_ERROR);
  }
  return normalized;
}

export function resolveStripeSandboxPlan(
  input: {
    planId: unknown;
    billingCycle: unknown;
  },
  environment: string | undefined,
  configuration: StripeSandboxPlanConfiguration,
): ResolvedStripeSandboxPlan {
  const environmentName = environment?.trim().toLowerCase() ?? "";
  if (environmentName !== SANDBOX_ENVIRONMENT) {
    throw new Error(ENVIRONMENT_ERROR);
  }

  const planId = normalizedPlanId(input.planId);
  if (!planId || !isSupportedPlanId(planId)) {
    throw new Error(INVALID_PLAN_ERROR);
  }

  const billingCycle = parseBillingCycle(input.billingCycle);
  if (!billingCycle) {
    throw new Error(INVALID_CYCLE_ERROR);
  }

  const environmentVariable =
    STRIPE_SANDBOX_PRICE_ENVIRONMENT_VARIABLES[planId][billingCycle];
  const configuredValue =
    configuration && typeof configuration === "object"
      ? configuration[environmentVariable]
      : undefined;

  return {
    environment: "sandbox",
    planId,
    billingCycle,
    priceId: configuredPriceId(configuredValue),
    environmentVariable,
  };
}
