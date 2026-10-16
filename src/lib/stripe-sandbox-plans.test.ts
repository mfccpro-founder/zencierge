import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BillingCycle } from "./zencierge-plans";
import type {
  StripeSandboxPlanConfiguration,
  StripeSandboxPriceEnvironmentVariable,
  StripeSandboxSupportedPlanId,
} from "./stripe-sandbox-plans";

// Node strips types but does not resolve extensionless relative TypeScript.
// Append `.ts` only for those local specifiers, after this file has loaded.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[cm]?[jt]sx?$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { BILLING_CYCLES } = await import("./zencierge-plans");
const {
  STRIPE_SANDBOX_PRICE_ENVIRONMENT_VARIABLES,
  STRIPE_SANDBOX_PRICE_OWNERSHIP_VERIFICATION,
  STRIPE_SANDBOX_SUPPORTED_PLAN_IDS,
  resolveStripeSandboxPlan,
} = await import("./stripe-sandbox-plans");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function fictionalPriceId(variable: StripeSandboxPriceEnvironmentVariable) {
  return `price_fictional_${variable.toLowerCase()}`;
}

function completeSandboxConfiguration(): StripeSandboxPlanConfiguration {
  const configuration: StripeSandboxPlanConfiguration = {};
  for (const planId of STRIPE_SANDBOX_SUPPORTED_PLAN_IDS) {
    for (const billingCycle of BILLING_CYCLES) {
      const variable =
        STRIPE_SANDBOX_PRICE_ENVIRONMENT_VARIABLES[planId][billingCycle];
      configuration[variable] = fictionalPriceId(variable);
    }
  }
  return configuration;
}

function errorMessage(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }
  throw new Error("invalid Stripe Sandbox plan configuration was accepted");
}

function runStripeSandboxPlanTests() {
  assert(
    STRIPE_SANDBOX_PRICE_OWNERSHIP_VERIFICATION === "pending",
    "Sandbox ownership of a price_ id stays pending remote verification",
  );

  const configuration = completeSandboxConfiguration();
  for (const planId of STRIPE_SANDBOX_SUPPORTED_PLAN_IDS) {
    for (const billingCycle of BILLING_CYCLES) {
      const variable =
        STRIPE_SANDBOX_PRICE_ENVIRONMENT_VARIABLES[planId][billingCycle];
      const resolved = resolveStripeSandboxPlan(
        { planId, billingCycle },
        "sandbox",
        configuration,
      );
      assert(
        resolved.environment === "sandbox" &&
          resolved.planId === planId &&
          resolved.billingCycle === billingCycle &&
          resolved.environmentVariable === variable &&
          resolved.priceId === fictionalPriceId(variable),
        `${planId} ${billingCycle} maps to ${variable}`,
      );
    }
  }

  const normalized = resolveStripeSandboxPlan(
    { planId: "  PrO  ", billingCycle: "  AnNuAl  " },
    "  SaNdBoX  ",
    configuration,
  );
  assert(
    normalized.planId === "pro" &&
      normalized.billingCycle === "annual" &&
      normalized.environmentVariable === "STRIPE_SANDBOX_PRICE_PRO_ANNUAL" &&
      normalized.priceId ===
        fictionalPriceId("STRIPE_SANDBOX_PRICE_PRO_ANNUAL"),
    "sandbox, plan, and billing cycle values are normalized",
  );

  assert(
    STRIPE_SANDBOX_PRICE_ENVIRONMENT_VARIABLES.agency.monthly ===
      "STRIPE_SANDBOX_PRICE_AGENCY_MONTHLY" &&
      STRIPE_SANDBOX_PRICE_ENVIRONMENT_VARIABLES.agency.annual ===
        "STRIPE_SANDBOX_PRICE_AGENCY_ANNUAL",
    "Agency monthly and annual use dedicated price variables",
  );
  const normalizedAgency = resolveStripeSandboxPlan(
    { planId: "  AGENCY  ", billingCycle: "  AnNuAl  " },
    "sandbox",
    configuration,
  );
  assert(
    normalizedAgency.planId === "agency" &&
      normalizedAgency.billingCycle === "annual" &&
      normalizedAgency.environmentVariable ===
        "STRIPE_SANDBOX_PRICE_AGENCY_ANNUAL" &&
      normalizedAgency.priceId ===
        fictionalPriceId("STRIPE_SANDBOX_PRICE_AGENCY_ANNUAL"),
    "normalized Agency annual maps to its own price variable",
  );
  const withoutAgencyMonthly = { ...configuration };
  delete withoutAgencyMonthly.STRIPE_SANDBOX_PRICE_AGENCY_MONTHLY;
  assert(
    errorMessage(() =>
      resolveStripeSandboxPlan(
        { planId: "agency", billingCycle: "monthly" },
        "sandbox",
        withoutAgencyMonthly,
      ),
    ) === "Stripe Sandbox price configuration is unavailable",
    "a missing Agency price does not fall back to another plan",
  );

  for (const environment of [undefined, "", "   ", "production", "live"]) {
    assert(
      errorMessage(() =>
        resolveStripeSandboxPlan(
          { planId: "starter", billingCycle: "monthly" },
          environment,
          configuration,
        ),
      ) === "Stripe environment must be sandbox",
      "environments other than sandbox are rejected",
    );
  }

  const starterMonthly = "STRIPE_SANDBOX_PRICE_STARTER_MONTHLY" as const;
  for (const invalidValue of [undefined, "", "   "]) {
    const missing: StripeSandboxPlanConfiguration = {
      ...configuration,
      [starterMonthly]: invalidValue,
    };
    assert(
      errorMessage(() =>
        resolveStripeSandboxPlan(
          { planId: "starter", billingCycle: "monthly" },
          "sandbox",
          missing,
        ),
      ) === "Stripe Sandbox price configuration is unavailable",
      "missing and blank price ids are rejected",
    );
  }

  const malformedSentinel = "sk_test_FICTIONAL_SENTINEL";
  for (const invalidValue of [
    "not-a-price",
    "price_",
    "PRICE_FICTIONAL_STARTER_MONTHLY",
    "price_fictional starter",
    malformedSentinel,
  ]) {
    const invalid: StripeSandboxPlanConfiguration = {
      ...configuration,
      [starterMonthly]: invalidValue,
    };
    const message = errorMessage(() =>
      resolveStripeSandboxPlan(
        { planId: "starter", billingCycle: "monthly" },
        "sandbox",
        invalid,
      ),
    );
    assert(
      message === "Stripe Sandbox price configuration is unavailable",
      "malformed price ids are rejected",
    );
    assert(
      !message.includes(invalidValue),
      "malformed price values are not echoed",
    );
  }

  const formatOnly = resolveStripeSandboxPlan(
    { planId: "starter", billingCycle: "monthly" },
    "sandbox",
    {
      ...configuration,
      [starterMonthly]: "price_fictional_not_sandbox_proof",
    },
  );
  assert(
    formatOnly.priceId === "price_fictional_not_sandbox_proof" &&
      STRIPE_SANDBOX_PRICE_OWNERSHIP_VERIFICATION === "pending",
    "price_ format does not prove Stripe Sandbox ownership",
  );

  assert(
    errorMessage(() =>
      resolveStripeSandboxPlan(
        { planId: "enterprise", billingCycle: "monthly" },
        "sandbox",
        configuration,
      ),
    ) === "Invalid Stripe Sandbox plan",
    "unsupported plans are rejected",
  );
  assert(
    errorMessage(() =>
      resolveStripeSandboxPlan(
        { planId: "starter", billingCycle: "weekly" },
        "sandbox",
        configuration,
      ),
    ) === "Invalid Stripe Sandbox billing cycle",
    "unsupported billing cycles are rejected",
  );

  const withoutStarterMonthly = { ...configuration };
  delete withoutStarterMonthly[starterMonthly];
  assert(
    errorMessage(() =>
      resolveStripeSandboxPlan(
        { planId: "starter", billingCycle: "monthly" },
        "sandbox",
        withoutStarterMonthly,
      ),
    ) === "Stripe Sandbox price configuration is unavailable",
    "a missing variable does not fall back to another price",
  );

  const attackerPriceId = "price_fictional_attacker";
  const browserResolved = resolveStripeSandboxPlan(
    {
      planId: "pro",
      billingCycle: "annual",
      priceId: attackerPriceId,
    } as {
      planId: StripeSandboxSupportedPlanId;
      billingCycle: BillingCycle;
    },
    "sandbox",
    configuration,
  );
  assert(
    browserResolved.priceId ===
      fictionalPriceId("STRIPE_SANDBOX_PRICE_PRO_ANNUAL") &&
      browserResolved.priceId !== attackerPriceId,
    "caller-supplied price ids are ignored",
  );

  const source = readFileSync(
    join(process.cwd(), "src/lib/stripe-sandbox-plans.ts"),
    "utf8",
  );
  assert(
    source.includes(
      "Remote verification against Stripe is pending",
    ),
    "remote Sandbox ownership verification stays documented as pending",
  );
  assert(
    !source.includes("process.env") &&
      !source.includes("from \"stripe\"") &&
      !source.includes("from \"square\"") &&
      !source.includes("fetch("),
    "plan correspondence does not read the process environment or call providers",
  );
  assert(
    source.includes("STRIPE_SANDBOX_PRICE_AGENCY_MONTHLY") &&
      source.includes("STRIPE_SANDBOX_PRICE_AGENCY_ANNUAL") &&
      source.includes("agency:") &&
      !source.includes("pending definition"),
    "Agency has monthly and annual Stripe Sandbox price variables",
  );

  console.log("Stripe Sandbox plan correspondence tests passed");
}

runStripeSandboxPlanTests();
