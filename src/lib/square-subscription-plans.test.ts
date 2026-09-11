import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BILLING_CYCLES,
  ZENCIERGE_PLAN_IDS,
  billingPriceUsd,
  type BillingCycle,
  type ZenciergePlanId,
} from "./zencierge-plans";
import {
  SQUARE_PLAN_VARIATION_ENVIRONMENT_VARIABLES,
  resolveSquareSubscriptionPlan,
  type SquareEnvironmentName,
  type SquareSubscriptionPlanEnvironment,
} from "./square-subscription-plans";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const EXPECTED_PRICES = {
  starter: { monthly: 49, annual: 490 },
  pro: { monthly: 99, annual: 990 },
  portfolio: { monthly: 149, annual: 1490 },
  agency: { monthly: 199, annual: 1990 },
} as const satisfies Record<
  ZenciergePlanId,
  Record<BillingCycle, number>
>;

function fakeVariationId(
  environment: SquareEnvironmentName,
  planId: ZenciergePlanId,
  billingCycle: BillingCycle,
) {
  return `${environment === "sandbox" ? "SBX" : "PRD"}_${planId.toUpperCase()}_${billingCycle.toUpperCase()}_123`;
}

function completeEnvironment(): SquareSubscriptionPlanEnvironment {
  const env: SquareSubscriptionPlanEnvironment = {};
  for (const environment of ["sandbox", "production"] as const) {
    for (const planId of ZENCIERGE_PLAN_IDS) {
      for (const billingCycle of BILLING_CYCLES) {
        const variableName =
          SQUARE_PLAN_VARIATION_ENVIRONMENT_VARIABLES[environment][planId][
            billingCycle
          ];
        env[variableName] = fakeVariationId(
          environment,
          planId,
          billingCycle,
        );
      }
    }
  }
  return env;
}

function errorMessage(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }
  throw new Error("invalid Square subscription configuration was accepted");
}

function runSquareSubscriptionPlanTests() {
  for (const environment of ["sandbox", "production"] as const) {
    for (const planId of ZENCIERGE_PLAN_IDS) {
      for (const billingCycle of BILLING_CYCLES) {
        const env = completeEnvironment();
        env.SQUARE_ENVIRONMENT = environment;
        const resolved = resolveSquareSubscriptionPlan(
          { planId, billingCycle },
          env,
        );
        assert(
          resolved.environment === environment &&
            resolved.planId === planId &&
            resolved.billingCycle === billingCycle,
          `${environment} ${planId} ${billingCycle} resolves canonically`,
        );
        assert(
          resolved.planVariationId ===
            fakeVariationId(environment, planId, billingCycle),
          `${environment} ${planId} ${billingCycle} uses its exact variable`,
        );
        assert(
          resolved.amountUsd === EXPECTED_PRICES[planId][billingCycle] &&
            resolved.amountUsd === billingPriceUsd(planId, billingCycle),
          `${environment} ${planId} ${billingCycle} uses the canonical price`,
        );
      }
    }
  }

  const normalizedEnv = completeEnvironment();
  normalizedEnv.SQUARE_ENVIRONMENT = "  SaNdBoX  ";
  const normalized = resolveSquareSubscriptionPlan(
    { planId: "  PrO  ", billingCycle: "  AnNuAl  " },
    normalizedEnv,
  );
  assert(
    normalized.environment === "sandbox" &&
      normalized.planId === "pro" &&
      normalized.billingCycle === "annual" &&
      normalized.amountUsd === 990,
    "valid environment, plan, and billing cycle values are normalized",
  );

  const validEnv = completeEnvironment();
  validEnv.SQUARE_ENVIRONMENT = "sandbox";
  assert(
    errorMessage(() =>
      resolveSquareSubscriptionPlan(
        { planId: "enterprise", billingCycle: "monthly" },
        validEnv,
      ),
    ) === "Invalid Square subscription plan",
    "invalid plan is rejected",
  );
  assert(
    errorMessage(() =>
      resolveSquareSubscriptionPlan(
        { planId: "starter", billingCycle: "weekly" },
        validEnv,
      ),
    ) === "Invalid Square billing cycle",
    "invalid billing cycle is rejected",
  );

  const selectedVariable =
    SQUARE_PLAN_VARIATION_ENVIRONMENT_VARIABLES.sandbox.starter.monthly;
  for (const invalidValue of [undefined, "   ", "your-square-plan-variation-id"]) {
    const env = completeEnvironment();
    env.SQUARE_ENVIRONMENT = "sandbox";
    env[selectedVariable] = invalidValue;
    assert(
      errorMessage(() =>
        resolveSquareSubscriptionPlan(
          { planId: "starter", billingCycle: "monthly" },
          env,
        ),
      ) === "Square subscription plan configuration is unavailable",
      "missing, empty, and placeholder variation IDs fail closed",
    );
  }

  const isolatedSandbox = completeEnvironment();
  isolatedSandbox.SQUARE_ENVIRONMENT = "sandbox";
  delete isolatedSandbox[selectedVariable];
  assert(
    errorMessage(() =>
      resolveSquareSubscriptionPlan(
        { planId: "starter", billingCycle: "monthly" },
        isolatedSandbox,
      ),
    ) === "Square subscription plan configuration is unavailable",
    "Sandbox never falls back to the configured Production variation",
  );

  const productionVariable =
    SQUARE_PLAN_VARIATION_ENVIRONMENT_VARIABLES.production.starter.monthly;
  const isolatedProduction = completeEnvironment();
  isolatedProduction.SQUARE_ENVIRONMENT = "production";
  delete isolatedProduction[productionVariable];
  assert(
    errorMessage(() =>
      resolveSquareSubscriptionPlan(
        { planId: "starter", billingCycle: "monthly" },
        isolatedProduction,
      ),
    ) === "Square subscription plan configuration is unavailable",
    "Production never falls back to the configured Sandbox variation",
  );

  const attackerVariationId = "ATTACKER_CONTROLLED_VARIATION_123";
  const attackerAmount = 1;
  const configured = completeEnvironment();
  configured.SQUARE_ENVIRONMENT = "sandbox";
  const browserInput = {
    planId: "pro",
    billingCycle: "annual",
    planVariationId: attackerVariationId,
    amountUsd: attackerAmount,
  };
  const browserResolved = resolveSquareSubscriptionPlan(browserInput, configured);
  assert(
    browserResolved.planVariationId !== attackerVariationId &&
      browserResolved.amountUsd === 990,
    "browser-supplied variation ID and amount are not accepted",
  );

  const secretEnvironment = "SECRET_ENVIRONMENT_VALUE";
  const secretPlan = "SECRET_PLAN_VALUE";
  const secretCycle = "SECRET_CYCLE_VALUE";
  const secretPlaceholder = "your-square-SECRET_VARIATION_VALUE";
  const credentialSentinel = "SECRET_ACCESS_TOKEN_VALUE";
  const messages = [
    errorMessage(() =>
      resolveSquareSubscriptionPlan(
        { planId: "starter", billingCycle: "monthly" },
        {
          ...completeEnvironment(),
          SQUARE_ENVIRONMENT: secretEnvironment,
        },
      ),
    ),
    errorMessage(() =>
      resolveSquareSubscriptionPlan(
        { planId: secretPlan, billingCycle: "monthly" },
        validEnv,
      ),
    ),
    errorMessage(() =>
      resolveSquareSubscriptionPlan(
        { planId: "starter", billingCycle: secretCycle },
        validEnv,
      ),
    ),
    errorMessage(() => {
      const env = {
        ...completeEnvironment(),
        SQUARE_ENVIRONMENT: "sandbox",
        SQUARE_ACCESS_TOKEN: credentialSentinel,
        [selectedVariable]: secretPlaceholder,
      };
      return resolveSquareSubscriptionPlan(
        { planId: "starter", billingCycle: "monthly" },
        env,
      );
    }),
  ];
  for (const message of messages) {
    for (const secret of [
      secretEnvironment,
      secretPlan,
      secretCycle,
      secretPlaceholder,
      credentialSentinel,
    ]) {
      assert(!message.includes(secret), "configuration errors are sanitized");
    }
  }

  const source = readFileSync(
    join(process.cwd(), "src/lib/square-subscription-plans.ts"),
    "utf8",
  );
  assert(
    !source.includes("createSquareClient") &&
      !source.includes("planFromUsdAmount"),
    "catalog configuration neither instantiates Square nor infers by amount",
  );

  console.log("Square subscription plan configuration tests passed");
}

runSquareSubscriptionPlanTests();