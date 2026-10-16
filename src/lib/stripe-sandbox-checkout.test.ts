import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BillingCycle } from "./zencierge-plans";
import type { StripeSandboxPlanConfiguration } from "./stripe-sandbox-plans";
import type {
  StripeSandboxCheckoutClient,
  StripeSandboxCheckoutPrice,
  StripeSandboxCheckoutProduct,
} from "./stripe-sandbox-checkout";

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
  STRIPE_SANDBOX_SUPPORTED_PLAN_IDS,
} = await import("./stripe-sandbox-plans");
const {
  STRIPE_SANDBOX_CHECKOUT_CANCEL_URL,
  STRIPE_SANDBOX_CHECKOUT_PRICE_EXPECTATIONS,
  STRIPE_SANDBOX_CHECKOUT_SUCCESS_URL,
  prepareStripeSandboxCheckoutSession,
} = await import("./stripe-sandbox-checkout");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const PRODUCT_NAMES = {
  starter: "Starter Host",
  pro: "Pro Superhost",
  portfolio: "Portfolio Host",
  agency: "Co-Host Agency",
} as const;

const SESSION_URL = "https://checkout.stripe.com/c/pay/cs_test_fictional";
const IDEMPOTENCY_KEY = "11111111-1111-4111-8111-111111111111";

function fictionalPriceId(planId: string, billingCycle: string) {
  return `price_fictional_${planId}_${billingCycle}`;
}

function configuration(): StripeSandboxPlanConfiguration {
  const config: StripeSandboxPlanConfiguration = {};
  for (const planId of STRIPE_SANDBOX_SUPPORTED_PLAN_IDS) {
    for (const billingCycle of BILLING_CYCLES) {
      const variable =
        STRIPE_SANDBOX_PRICE_ENVIRONMENT_VARIABLES[planId][billingCycle];
      config[variable] = fictionalPriceId(planId, billingCycle);
    }
  }
  return config;
}

function eligiblePrice(
  planId: (typeof STRIPE_SANDBOX_SUPPORTED_PLAN_IDS)[number],
  billingCycle: BillingCycle,
  priceId: string,
  product: StripeSandboxCheckoutPrice["product"],
): StripeSandboxCheckoutPrice {
  const expected = STRIPE_SANDBOX_CHECKOUT_PRICE_EXPECTATIONS[planId][billingCycle];
  return {
    id: priceId,
    livemode: false,
    active: true,
    currency: "usd",
    unit_amount: expected.unitAmount,
    type: "recurring",
    billing_scheme: "per_unit",
    recurring: {
      interval: expected.interval,
      interval_count: 1,
      usage_type: "licensed",
    },
    product,
  };
}

function fakeClient(options: {
  price: StripeSandboxCheckoutPrice;
  product?: StripeSandboxCheckoutProduct;
  retrieveError?: unknown;
  createError?: unknown;
  session?: { id?: string; url?: string | null; livemode?: boolean };
}) {
  const calls = {
    retrieved: [] as string[],
    productReads: [] as string[],
    created: [] as Array<{
      params: unknown;
      options?: { idempotencyKey?: string };
    }>,
  };
  const client: StripeSandboxCheckoutClient = {
    prices: {
      async retrieve(id) {
        calls.retrieved.push(id);
        if (options.retrieveError) throw options.retrieveError;
        return { ...options.price, id: options.price.id ?? id };
      },
    },
    products: {
      async retrieve(id) {
        calls.productReads.push(id);
        if (!options.product) throw new Error("missing fictional product");
        return options.product;
      },
    },
    checkout: {
      sessions: {
        async create(params, requestOptions) {
          calls.created.push({ params, options: requestOptions });
          if (options.createError) throw options.createError;
          return options.session ?? {
            id: "cs_test_fictional",
            url: SESSION_URL,
            livemode: false,
          };
        },
      },
    },
  };
  return { client, calls };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    planId: "pro",
    billingCycle: "monthly",
    successUrl: STRIPE_SANDBOX_CHECKOUT_SUCCESS_URL,
    cancelUrl: STRIPE_SANDBOX_CHECKOUT_CANCEL_URL,
    idempotencyKey: IDEMPOTENCY_KEY,
    ...overrides,
  };
}

async function errorMessage(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }
  throw new Error("invalid Stripe Sandbox checkout was accepted");
}

async function runStripeSandboxCheckoutTests() {
  const config = configuration();
  const script = readFileSync(
    join(process.cwd(), "scripts/verify-stripe-sandbox-prices.mjs"),
    "utf8",
  );
  assert(
    STRIPE_SANDBOX_CHECKOUT_PRICE_EXPECTATIONS.agency.monthly.unitAmount ===
      19900 &&
      STRIPE_SANDBOX_CHECKOUT_PRICE_EXPECTATIONS.agency.monthly.interval ===
        "month" &&
      STRIPE_SANDBOX_CHECKOUT_PRICE_EXPECTATIONS.agency.annual.unitAmount ===
        199000 &&
      STRIPE_SANDBOX_CHECKOUT_PRICE_EXPECTATIONS.agency.annual.interval ===
        "year",
    "Agency expects 19900 monthly cents and 199000 annual cents",
  );
  const scriptPriceRows = [
    ...script.matchAll(
      /planToken: "(starter|pro|portfolio|agency)",\s*cycle: "(monthly|annual)",[\s\S]*?unitAmount: (\d+),\s*interval: "(month|year)"/g,
    ),
  ];
  assert(
    scriptPriceRows.length === 8,
    "verification script covers eight Stripe Sandbox prices",
  );
  for (const match of scriptPriceRows) {
    const planId = match[1] as "starter" | "pro" | "portfolio" | "agency";
    const billingCycle = match[2] as BillingCycle;
    const expected = STRIPE_SANDBOX_CHECKOUT_PRICE_EXPECTATIONS[planId][billingCycle];
    assert(
      expected.unitAmount === Number(match[3]) && expected.interval === match[4],
      `${planId} ${billingCycle} uses the verification script amount`,
    );
  }

  for (const planId of STRIPE_SANDBOX_SUPPORTED_PLAN_IDS) {
    for (const billingCycle of BILLING_CYCLES) {
      const priceId = fictionalPriceId(planId, billingCycle);
      const { client, calls } = fakeClient({
        price: eligiblePrice(planId, billingCycle, priceId, {
          id: `prod_fictional_${planId}`,
          name: PRODUCT_NAMES[planId],
          active: true,
        }),
      });
      const prepared = await prepareStripeSandboxCheckoutSession(
        request({
          planId,
          billingCycle,
          priceId: "price_fictional_attacker",
        }),
        "sandbox",
        config,
        client,
      );
      assert(
        calls.retrieved.length === 1 &&
          calls.retrieved[0] === priceId &&
          calls.retrieved[0] !== "price_fictional_attacker",
        `${planId} ${billingCycle} retrieves only the configured price`,
      );
      assert(calls.created.length === 1, `${planId} ${billingCycle} creates one session`);
      const created = calls.created[0];
      assert(
        JSON.stringify(created.params) ===
          JSON.stringify({
            mode: "subscription",
            client_reference_id: IDEMPOTENCY_KEY,
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: STRIPE_SANDBOX_CHECKOUT_SUCCESS_URL,
            cancel_url: STRIPE_SANDBOX_CHECKOUT_CANCEL_URL,
          }),
        `${planId} ${billingCycle} prepares one subscription line`,
      );
      assert(
        created.options?.idempotencyKey === IDEMPOTENCY_KEY,
        `${planId} ${billingCycle} sends the idempotency key`,
      );
      assert(
        prepared.sessionId === "cs_test_fictional" &&
          prepared.url === SESSION_URL &&
          prepared.priceId === priceId &&
          prepared.planId === planId &&
          prepared.billingCycle === billingCycle,
        `${planId} ${billingCycle} returns the prepared session`,
      );
    }
  }

  const stringProduct = fakeClient({
    price: eligiblePrice("starter", "monthly", fictionalPriceId("starter", "monthly"), "prod_fictionalstarter"),
    product: { id: "prod_fictionalstarter", name: "Starter Host", active: true },
  });
  await prepareStripeSandboxCheckoutSession(
    request({ planId: "starter", billingCycle: "monthly" }),
    "sandbox",
    config,
    stringProduct.client,
  );
  assert(
    stringProduct.calls.productReads.length === 1 &&
      stringProduct.calls.created.length === 1,
    "a product id is read before the session is created",
  );

  const live = fakeClient({
    price: {
      ...eligiblePrice("pro", "monthly", fictionalPriceId("pro", "monthly"), {
        id: "prod_fictional_pro",
        name: "Pro Superhost",
        active: true,
      }),
      livemode: true,
    },
  });
  assert(
    (await errorMessage(() =>
      prepareStripeSandboxCheckoutSession(request(), "sandbox", config, live.client),
    )) === "Stripe Sandbox price is not eligible for checkout" &&
      live.calls.created.length === 0,
    "a live price does not create a session",
  );

  const wrongAmount = fakeClient({
    price: {
      ...eligiblePrice("pro", "monthly", fictionalPriceId("pro", "monthly"), {
        id: "prod_fictional_pro",
        name: "Pro Superhost",
        active: true,
      }),
      unit_amount: 100,
    },
  });
  assert(
    (await errorMessage(() =>
      prepareStripeSandboxCheckoutSession(
        request(),
        "sandbox",
        config,
        wrongAmount.client,
      ),
    )) === "Stripe Sandbox price is not eligible for checkout" &&
      wrongAmount.calls.created.length === 0,
    "an incompatible amount does not create a session",
  );

  const agencyWrongAmount = fakeClient({
    price: {
      ...eligiblePrice(
        "agency",
        "monthly",
        fictionalPriceId("agency", "monthly"),
        {
          id: "prod_fictional_agency",
          name: "Co-Host Agency",
          active: true,
        },
      ),
      unit_amount: 1990,
    },
  });
  assert(
    (await errorMessage(() =>
      prepareStripeSandboxCheckoutSession(
        request({ planId: "agency", billingCycle: "monthly" }),
        "sandbox",
        config,
        agencyWrongAmount.client,
      ),
    )) === "Stripe Sandbox price is not eligible for checkout" &&
      agencyWrongAmount.calls.created.length === 0,
    "an Agency price with the wrong amount does not create a session",
  );

  const agencyWrongInterval = fakeClient({
    price: {
      ...eligiblePrice(
        "agency",
        "annual",
        fictionalPriceId("agency", "annual"),
        {
          id: "prod_fictional_agency",
          name: "Co-Host Agency",
          active: true,
        },
      ),
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "licensed",
      },
    },
  });
  assert(
    (await errorMessage(() =>
      prepareStripeSandboxCheckoutSession(
        request({ planId: "agency", billingCycle: "annual" }),
        "sandbox",
        config,
        agencyWrongInterval.client,
      ),
    )) === "Stripe Sandbox price is not eligible for checkout" &&
      agencyWrongInterval.calls.created.length === 0,
    "an Agency price with the wrong interval does not create a session",
  );

  for (const successUrl of [
    "https://localhost:3000/dev/stripe-sandbox/success?session_id={CHECKOUT_SESSION_ID}",
    "http://127.0.0.1:3000/dev/stripe-sandbox/success?session_id={CHECKOUT_SESSION_ID}",
    "http://localhost:3001/dev/stripe-sandbox/success?session_id={CHECKOUT_SESSION_ID}",
    "http://localhost:3000/checkout/success",
    "http://evil.test/dev/stripe-sandbox/success",
  ]) {
    const blocked = fakeClient({
      price: eligiblePrice("pro", "monthly", fictionalPriceId("pro", "monthly"), {
        name: "Pro Superhost",
        active: true,
      }),
    });
    assert(
      (await errorMessage(() =>
        prepareStripeSandboxCheckoutSession(
          request({ successUrl }),
          "sandbox",
          config,
          blocked.client,
        ),
      )) === "Stripe Sandbox checkout URL is not allowed" &&
        blocked.calls.retrieved.length === 0 &&
        blocked.calls.created.length === 0,
      "return URLs outside the localhost Stripe sandbox routes are rejected",
    );
  }

  const missingKey = fakeClient({
    price: eligiblePrice("pro", "monthly", fictionalPriceId("pro", "monthly"), {
      name: "Pro Superhost",
      active: true,
    }),
  });
  assert(
    (await errorMessage(() =>
      prepareStripeSandboxCheckoutSession(
        request({ idempotencyKey: "   " }),
        "sandbox",
        config,
        missingKey.client,
      ),
    )) === "Stripe Sandbox checkout idempotency key is required" &&
      missingKey.calls.created.length === 0,
    "a missing idempotency key does not create a session",
  );

  const nonLocalKey = fakeClient({
    price: eligiblePrice("pro", "monthly", fictionalPriceId("pro", "monthly"), {
      name: "Pro Superhost",
      active: true,
    }),
  });
  assert(
    (await errorMessage(() =>
      prepareStripeSandboxCheckoutSession(
        request({ idempotencyKey: "manual-checkout-key" }),
        "sandbox",
        config,
        nonLocalKey.client,
      ),
    )) === "Stripe Sandbox checkout idempotency key is required" &&
      nonLocalKey.calls.created.length === 0,
    "a non-UUID key cannot create a Checkout outside the registered local flow",
  );

  const retrieveFailure = fakeClient({
    price: eligiblePrice("pro", "monthly", fictionalPriceId("pro", "monthly"), {
      name: "Pro Superhost",
      active: true,
    }),
    retrieveError: new Error(
      "sk_test_FICTIONAL_SECRET https://checkout.stripe.com/c/pay/cs_test_secret",
    ),
  });
  const retrieveMessage = await errorMessage(() =>
    prepareStripeSandboxCheckoutSession(
      request(),
      "sandbox",
      config,
      retrieveFailure.client,
    ),
  );
  assert(
    retrieveMessage === "Stripe Sandbox checkout is unavailable" &&
      !retrieveMessage.includes("sk_test_") &&
      !retrieveMessage.includes("checkout.stripe.com") &&
      retrieveFailure.calls.created.length === 0,
    "a Stripe read failure does not create a session or echo secrets",
  );

  const createFailure = fakeClient({
    price: eligiblePrice("pro", "monthly", fictionalPriceId("pro", "monthly"), {
      id: "prod_fictional_pro",
      name: "Pro Superhost",
      active: true,
    }),
    createError: new Error(`${SESSION_URL} sk_test_FICTIONAL_SECRET`),
  });
  const createMessage = await errorMessage(() =>
    prepareStripeSandboxCheckoutSession(
      request(),
      "sandbox",
      config,
      createFailure.client,
    ),
  );
  assert(
    createMessage === "Stripe Sandbox checkout is unavailable" &&
      !createMessage.includes(SESSION_URL) &&
      !createMessage.includes("sk_test_") &&
      createFailure.calls.created.length === 1,
    "a Stripe session failure stays sanitized",
  );

  const proPrice = eligiblePrice("pro", "monthly", fictionalPriceId("pro", "monthly"), {
    id: "prod_fictionalpro",
    name: "Pro Superhost",
    active: true,
  });
  for (const [label, session] of [
    ["live session", { id: "cs_test_fictional", url: SESSION_URL, livemode: true }],
    ["invalid session id", { id: "cs_live_fictional", url: SESSION_URL, livemode: false }],
    [
      "other checkout domain",
      {
        id: "cs_test_fictional",
        url: "https://example.com/c/pay/cs_test_fictional",
        livemode: false,
      },
    ],
    [
      "deceptive checkout domain",
      {
        id: "cs_test_fictional",
        url: "https://checkout.stripe.com.ejemplo.com/c/pay/cs_test_fictional",
        livemode: false,
      },
    ],
  ] as const) {
    const rejected = fakeClient({ price: proPrice, session });
    const message = await errorMessage(() =>
      prepareStripeSandboxCheckoutSession(request(), "sandbox", config, rejected.client),
    );
    assert(
      message === "Stripe Sandbox checkout is unavailable" &&
        !message.includes("ejemplo.com") &&
        !message.includes("example.com") &&
        !message.includes("cs_live_"),
      `${label} is rejected without echoing the session`,
    );
  }

  const source = readFileSync(
    join(process.cwd(), "src/lib/stripe-sandbox-checkout.ts"),
    "utf8",
  );
  assert(
    !source.includes("console.") &&
      !source.includes("process.env") &&
      !source.includes("supabase") &&
      !source.includes("from \"square\"") &&
      !source.includes("customer_email"),
    "checkout preparation does not log, read env, or touch Square or Supabase",
  );

  console.log("Stripe Sandbox checkout preparation tests passed");
}

await runStripeSandboxCheckoutTests();
