import {
  resolveSquareEnvironment,
  type ResolvedSquareEnvironment,
} from "./square-client";
import {
  billingPriceUsd,
  parseBillingCycle,
  parsePlanId,
  type BillingCycle,
  type ZenciergePlanId,
} from "./zencierge-plans";

export type SquareEnvironmentName = ResolvedSquareEnvironment["name"];

export type SquarePlanVariationEnvironmentVariable =
  `SQUARE_${Uppercase<SquareEnvironmentName>}_PLAN_VARIATION_${Uppercase<ZenciergePlanId>}_${Uppercase<BillingCycle>}`;

export type SquareSubscriptionPlanEnvironment = {
  [name: string]: string | undefined;
  SQUARE_ENVIRONMENT?: string;
} & Partial<
  Record<SquarePlanVariationEnvironmentVariable, string | undefined>
>;

export const SQUARE_PLAN_VARIATION_ENVIRONMENT_VARIABLES = {
  sandbox: {
    starter: {
      monthly: "SQUARE_SANDBOX_PLAN_VARIATION_STARTER_MONTHLY",
      annual: "SQUARE_SANDBOX_PLAN_VARIATION_STARTER_ANNUAL",
    },
    pro: {
      monthly: "SQUARE_SANDBOX_PLAN_VARIATION_PRO_MONTHLY",
      annual: "SQUARE_SANDBOX_PLAN_VARIATION_PRO_ANNUAL",
    },
    portfolio: {
      monthly: "SQUARE_SANDBOX_PLAN_VARIATION_PORTFOLIO_MONTHLY",
      annual: "SQUARE_SANDBOX_PLAN_VARIATION_PORTFOLIO_ANNUAL",
    },
    agency: {
      monthly: "SQUARE_SANDBOX_PLAN_VARIATION_AGENCY_MONTHLY",
      annual: "SQUARE_SANDBOX_PLAN_VARIATION_AGENCY_ANNUAL",
    },
  },
  production: {
    starter: {
      monthly: "SQUARE_PRODUCTION_PLAN_VARIATION_STARTER_MONTHLY",
      annual: "SQUARE_PRODUCTION_PLAN_VARIATION_STARTER_ANNUAL",
    },
    pro: {
      monthly: "SQUARE_PRODUCTION_PLAN_VARIATION_PRO_MONTHLY",
      annual: "SQUARE_PRODUCTION_PLAN_VARIATION_PRO_ANNUAL",
    },
    portfolio: {
      monthly: "SQUARE_PRODUCTION_PLAN_VARIATION_PORTFOLIO_MONTHLY",
      annual: "SQUARE_PRODUCTION_PLAN_VARIATION_PORTFOLIO_ANNUAL",
    },
    agency: {
      monthly: "SQUARE_PRODUCTION_PLAN_VARIATION_AGENCY_MONTHLY",
      annual: "SQUARE_PRODUCTION_PLAN_VARIATION_AGENCY_ANNUAL",
    },
  },
} as const satisfies Record<
  SquareEnvironmentName,
  Record<
    ZenciergePlanId,
    Record<BillingCycle, SquarePlanVariationEnvironmentVariable>
  >
>;

export type ResolvedSquareSubscriptionPlan = {
  environment: SquareEnvironmentName;
  planId: ZenciergePlanId;
  billingCycle: BillingCycle;
  planVariationId: string;
  amountUsd: number;
};

const UNAVAILABLE_CONFIGURATION_ERROR =
  "Square subscription plan configuration is unavailable";
const PLACEHOLDER_PATTERN =
  /placeholder|your[-_ ]?square|replace[-_ ]?me|plan[-_ ]?variation[-_ ]?id/i;

function normalizedPlanId(value: unknown) {
  if (typeof value !== "string") return null;
  return parsePlanId(value.trim().toLowerCase());
}

function configuredPlanVariationId(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  if (!normalized || PLACEHOLDER_PATTERN.test(normalized)) {
    throw new Error(UNAVAILABLE_CONFIGURATION_ERROR);
  }
  return normalized;
}

export function resolveSquareSubscriptionPlan(
  input: {
    planId: unknown;
    billingCycle: unknown;
  },
  env: SquareSubscriptionPlanEnvironment = process.env,
): ResolvedSquareSubscriptionPlan {
  const environment = resolveSquareEnvironment(
    env.SQUARE_ENVIRONMENT,
  ).name;
  const planId = normalizedPlanId(input.planId);
  if (!planId) {
    throw new Error("Invalid Square subscription plan");
  }
  const billingCycle = parseBillingCycle(input.billingCycle);
  if (!billingCycle) {
    throw new Error("Invalid Square billing cycle");
  }

  const variableName =
    SQUARE_PLAN_VARIATION_ENVIRONMENT_VARIABLES[environment][planId][
      billingCycle
    ];
  const planVariationId = configuredPlanVariationId(env[variableName]);

  return {
    environment,
    planId,
    billingCycle,
    planVariationId,
    amountUsd: billingPriceUsd(planId, billingCycle),
  };
}