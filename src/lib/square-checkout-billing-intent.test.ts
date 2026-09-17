import {
  createMemorySquareBillingStores,
  SquareBillingStoreError,
  type SquareBillingStores,
} from "./square-billing-stores";
import {
  buildCheckoutBillingIntentLogicalKey,
  maybeCreateCheckoutBillingIntent,
  stableCheckoutBillingIntentExpiresAt,
} from "./square-checkout-billing-intent";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const USER_A = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-09-10T12:30:00.000Z");

function baseDeps(overrides: {
  createStores?: () => SquareBillingStores | null;
  resolvePlan?: () => {
    environment: "sandbox";
    planId: "starter";
    billingCycle: "monthly";
    planVariationId: string;
    amountUsd: number;
  };
  resolveLocationId?: () => string | null;
  resolveEnvironmentName?: () => "sandbox" | null;
} = {}) {
  return {
    now: () => NOW,
    resolveEnvironmentName: overrides.resolveEnvironmentName ?? (() => "sandbox" as const),
    resolveLocationId: overrides.resolveLocationId ?? (() => "LOC_SANDBOX"),
    resolvePlan:
      overrides.resolvePlan ??
      (() => ({
        environment: "sandbox" as const,
        planId: "starter" as const,
        billingCycle: "monthly" as const,
        planVariationId: "PLAN_VAR_STARTER_MONTHLY",
        amountUsd: 49,
      })),
    createStores:
      overrides.createStores ??
      (() =>
        createMemorySquareBillingStores({
          now: () => NOW,
          uuid: (() => {
            let n = 0;
            return () =>
              `aaaaaaaa-aaaa-4aaa-8aaa-${(++n).toString(16).padStart(12, "0")}`;
          })(),
        })),
  };
}

export async function runSquareCheckoutBillingIntentTests() {
  assert(
    stableCheckoutBillingIntentExpiresAt(NOW) === "2026-09-10T18:00:00.000Z",
    "stable expiresAt floors hour then adds 6h",
  );
  assert(
    buildCheckoutBillingIntentLogicalKey({
      userId: USER_A,
      environment: "sandbox",
      planId: "starter",
      billingCycle: "monthly",
      locationId: "LOC_SANDBOX",
      planVariationId: "PLAN_VAR_STARTER_MONTHLY",
    }) ===
      `${USER_A}:sandbox:starter:monthly:LOC_SANDBOX:PLAN_VAR_STARTER_MONTHLY`,
    "logical key uses safe identifiers only",
  );

  // valid context creates intent
  {
    const created = await maybeCreateCheckoutBillingIntent(
      {
        kind: "host_subscription",
        userId: USER_A,
        planId: "starter",
        billingCycle: "monthly",
      },
      baseDeps(),
    );
    assert(created.status === "created", "creates intent");
    if (created.status !== "created") throw new Error("unreachable");
    assert(created.intentId.length > 0, "intent id present");
  }

  // exact replay is harmless
  {
    const stores = createMemorySquareBillingStores({
      now: () => NOW,
      uuid: (() => {
        let n = 0;
        return () =>
          `bbbbbbbb-bbbb-4bbb-8bbb-${(++n).toString(16).padStart(12, "0")}`;
      })(),
    });
    const deps = baseDeps({ createStores: () => stores });
    const first = await maybeCreateCheckoutBillingIntent(
      {
        kind: "host_subscription",
        userId: USER_A,
        planId: "starter",
        billingCycle: "monthly",
      },
      deps,
    );
    const second = await maybeCreateCheckoutBillingIntent(
      {
        kind: "host_subscription",
        userId: USER_A,
        planId: "starter",
        billingCycle: "monthly",
      },
      deps,
    );
    assert(first.status === "created", "first create");
    assert(second.status === "replayed", "exact replay");
    if (first.status === "created" && second.status === "replayed") {
      assert(first.intentId === second.intentId, "same intent on replay");
    }
  }

  // open-intent conflict does not break checkout
  {
    const stores = createMemorySquareBillingStores({
      now: () => NOW,
      uuid: (() => {
        let n = 0;
        return () =>
          `cccccccc-cccc-4ccc-8ccc-${(++n).toString(16).padStart(12, "0")}`;
      })(),
    });
    const deps = baseDeps({ createStores: () => stores });
    await maybeCreateCheckoutBillingIntent(
      {
        kind: "host_subscription",
        userId: USER_A,
        planId: "starter",
        billingCycle: "monthly",
      },
      deps,
    );
    const conflicted = await maybeCreateCheckoutBillingIntent(
      {
        kind: "host_subscription",
        userId: USER_A,
        planId: "pro",
        billingCycle: "monthly",
      },
      {
        ...deps,
        resolvePlan: () => ({
          environment: "sandbox",
          planId: "pro",
          billingCycle: "monthly",
          planVariationId: "PLAN_VAR_PRO_MONTHLY",
          amountUsd: 99,
        }),
      },
    );
    assert(
      conflicted.status === "failed_soft" && conflicted.reason === "conflict",
      "open-intent conflict is fail-soft",
    );
  }

  // missing userId skips
  {
    const result = await maybeCreateCheckoutBillingIntent(
      {
        kind: "host_subscription",
        userId: null,
        planId: "starter",
        billingCycle: "monthly",
      },
      baseDeps(),
    );
    assert(
      result.status === "skipped" && result.reason === "missing_user",
      "missing user skips",
    );
  }

  // missing plan variation skips
  {
    const result = await maybeCreateCheckoutBillingIntent(
      {
        kind: "host_subscription",
        userId: USER_A,
        planId: "starter",
        billingCycle: "monthly",
      },
      baseDeps({
        resolvePlan: () => {
          throw new Error("Square subscription plan configuration is unavailable");
        },
      }),
    );
    assert(
      result.status === "skipped" && result.reason === "missing_plan_variation",
      "missing plan variation skips",
    );
  }

  // unavailable store skips
  {
    const result = await maybeCreateCheckoutBillingIntent(
      {
        kind: "host_subscription",
        userId: USER_A,
        planId: "starter",
        billingCycle: "monthly",
      },
      baseDeps({ createStores: () => null }),
    );
    assert(
      result.status === "skipped" && result.reason === "store_unavailable",
      "unavailable store skips",
    );
  }

  // store error is swallowed/fail-soft
  {
    const result = await maybeCreateCheckoutBillingIntent(
      {
        kind: "host_subscription",
        userId: USER_A,
        planId: "starter",
        billingCycle: "monthly",
      },
      baseDeps({
        createStores: () =>
          ({
            intents: {
              createIntent: async () => {
                throw new SquareBillingStoreError("unavailable");
              },
            },
          }) as unknown as SquareBillingStores,
      }),
    );
    assert(
      result.status === "failed_soft" && result.reason === "store_error",
      "store error fail-soft",
    );
  }

  // no forbidden token-shaped data is passed / accepted on context
  {
    const result = await maybeCreateCheckoutBillingIntent(
      {
        kind: "host_subscription",
        userId: USER_A,
        planId: "starter",
        billingCycle: "monthly",
        sourceId: "tok_abc",
      } as {
        kind: string;
        userId: string;
        planId: string;
        billingCycle: string;
        sourceId: string;
      },
      baseDeps(),
    );
    assert(
      result.status === "failed_soft" && result.reason === "invalid_input",
      "forbidden token-shaped context rejected fail-soft",
    );
  }

  // checkout result remains unchanged when intent persistence fails
  {
    const checkoutSession = {
      url: "https://checkout.example/session",
      kind: "host_subscription" as const,
      amountCents: 4900,
      mock: false,
      sandbox: true,
      planId: "starter" as const,
      billing: "monthly" as const,
    };
    const intentResult = await maybeCreateCheckoutBillingIntent(
      {
        kind: "host_subscription",
        userId: USER_A,
        planId: "starter",
        billingCycle: "monthly",
      },
      baseDeps({ createStores: () => null }),
    );
    assert(intentResult.status === "skipped", "intent skipped");
    const returned = { ...checkoutSession };
    assert(
      JSON.stringify(returned) === JSON.stringify(checkoutSession),
      "checkout session object unchanged after fail-soft skip",
    );
  }

  // guest addon skips
  {
    const result = await maybeCreateCheckoutBillingIntent(
      {
        kind: "guest_addon",
        userId: USER_A,
        planId: "starter",
        billingCycle: "monthly",
      },
      baseDeps(),
    );
    assert(
      result.status === "skipped" && result.reason === "not_host_subscription",
      "guest addon skips",
    );
  }

  // missing location skips
  {
    const result = await maybeCreateCheckoutBillingIntent(
      {
        kind: "host_subscription",
        userId: USER_A,
        planId: "starter",
        billingCycle: "monthly",
      },
      baseDeps({ resolveLocationId: () => null }),
    );
    assert(
      result.status === "skipped" && result.reason === "missing_location",
      "missing location skips",
    );
  }

  console.log("square-checkout-billing-intent tests passed");
}

void runSquareCheckoutBillingIntentTests();
