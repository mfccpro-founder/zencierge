import {
  resolveStripeSandboxPlan,
  type StripeSandboxPlanConfiguration,
  type StripeSandboxSupportedPlanId,
} from "./stripe-sandbox-plans";
import type { BillingCycle } from "./zencierge-plans";

/**
 * Prepares one Stripe Checkout subscription session for local sandbox tests.
 * Price ids come only from the injected sandbox configuration.
 * This module does not grant access, write to Supabase, or log session URLs.
 *
 * Cent amounts and intervals match scripts/verify-stripe-sandbox-prices.mjs.
 */
export const STRIPE_SANDBOX_CHECKOUT_PRICE_EXPECTATIONS = {
  starter: {
    monthly: { unitAmount: 4900, interval: "month" },
    annual: { unitAmount: 49000, interval: "year" },
  },
  pro: {
    monthly: { unitAmount: 9900, interval: "month" },
    annual: { unitAmount: 99000, interval: "year" },
  },
  portfolio: {
    monthly: { unitAmount: 14900, interval: "month" },
    annual: { unitAmount: 149000, interval: "year" },
  },
  agency: {
    monthly: { unitAmount: 19900, interval: "month" },
    annual: { unitAmount: 199000, interval: "year" },
  },
} as const satisfies Record<
  StripeSandboxSupportedPlanId,
  Record<BillingCycle, { unitAmount: number; interval: "month" | "year" }>
>;

export const STRIPE_SANDBOX_CHECKOUT_SUCCESS_URL =
  "http://localhost:3000/dev/stripe-sandbox/success?session_id={CHECKOUT_SESSION_ID}";

export const STRIPE_SANDBOX_CHECKOUT_CANCEL_URL =
  "http://localhost:3000/dev/stripe-sandbox/cancel";

const URL_ERROR = "Stripe Sandbox checkout URL is not allowed";
const IDEMPOTENCY_ERROR = "Stripe Sandbox checkout idempotency key is required";
const INELIGIBLE_PRICE_ERROR = "Stripe Sandbox price is not eligible for checkout";
const UNAVAILABLE_ERROR = "Stripe Sandbox checkout is unavailable";

export type StripeSandboxCheckoutPrice = {
  id?: string;
  livemode?: boolean;
  active?: boolean;
  currency?: string;
  unit_amount?: number | null;
  type?: string;
  billing_scheme?: string;
  recurring?: {
    interval?: string;
    interval_count?: number;
    usage_type?: string;
  } | null;
  product?: string | StripeSandboxCheckoutProduct;
};

export type StripeSandboxCheckoutProduct = {
  id?: string;
  name?: string;
  active?: boolean;
  deleted?: boolean | void;
};

export type StripeSandboxCheckoutSessionParams = {
  mode: "subscription";
  client_reference_id: string;
  line_items: [{ price: string; quantity: 1 }];
  success_url: string;
  cancel_url: string;
};

export type StripeSandboxCheckoutClient = {
  prices: {
    retrieve(
      id: string,
      params?: { expand?: string[] },
    ): Promise<StripeSandboxCheckoutPrice>;
  };
  products: {
    retrieve(id: string): Promise<StripeSandboxCheckoutProduct>;
  };
  checkout: {
    sessions: {
      create(
        params: StripeSandboxCheckoutSessionParams,
        options?: { idempotencyKey?: string },
      ): Promise<StripeSandboxCheckoutSession>;
    };
  };
};

export type StripeSandboxCheckoutSession = {
  id?: string;
  url?: string | null;
  livemode?: boolean;
};

export type StripeSandboxCheckoutRequest = {
  planId: unknown;
  billingCycle: unknown;
  successUrl: unknown;
  cancelUrl: unknown;
  idempotencyKey: unknown;
};

export type PreparedStripeSandboxCheckout = {
  sessionId: string;
  url: string;
  priceId: string;
  planId: StripeSandboxSupportedPlanId;
  billingCycle: BillingCycle;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireIdempotencyKey(value: unknown) {
  if (typeof value !== "string") throw new Error(IDEMPOTENCY_ERROR);
  const trimmed = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    throw new Error(IDEMPOTENCY_ERROR);
  }
  return trimmed;
}

function assertReturnUrl(value: unknown, expected: string) {
  if (value !== expected) throw new Error(URL_ERROR);
}

function planNamePattern(planId: StripeSandboxSupportedPlanId) {
  return new RegExp(`\\b${planId}\\b`, "i");
}

function acceptedCheckoutSession(session: StripeSandboxCheckoutSession | null | undefined) {
  if (!session || session.livemode !== false) throw new Error(UNAVAILABLE_ERROR);
  if (typeof session.id !== "string" || !session.id.startsWith("cs_test_")) {
    throw new Error(UNAVAILABLE_ERROR);
  }
  if (typeof session.url !== "string" || session.url.length === 0) {
    throw new Error(UNAVAILABLE_ERROR);
  }
  let parsed: URL;
  try {
    parsed = new URL(session.url);
  } catch {
    throw new Error(UNAVAILABLE_ERROR);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "checkout.stripe.com" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.port !== "" && parsed.port !== "443")
  ) {
    throw new Error(UNAVAILABLE_ERROR);
  }
  return { sessionId: session.id, url: session.url };
}

async function loadProduct(
  stripe: StripeSandboxCheckoutClient,
  productField: StripeSandboxCheckoutPrice["product"],
) {
  if (typeof productField === "string") {
    if (!/^prod_[A-Za-z0-9]+$/.test(productField)) {
      throw new Error(INELIGIBLE_PRICE_ERROR);
    }
    try {
      return await stripe.products.retrieve(productField);
    } catch {
      throw new Error(UNAVAILABLE_ERROR);
    }
  }
  if (typeof productField === "object" && productField !== null) return productField;
  throw new Error(INELIGIBLE_PRICE_ERROR);
}

function assertEligiblePrice(
  planId: StripeSandboxSupportedPlanId,
  billingCycle: BillingCycle,
  priceId: string,
  price: StripeSandboxCheckoutPrice,
  product: StripeSandboxCheckoutProduct,
) {
  const expected = STRIPE_SANDBOX_CHECKOUT_PRICE_EXPECTATIONS[planId][billingCycle];
  const recurring = isRecord(price.recurring) ? price.recurring : null;
  const productName = typeof product.name === "string" ? product.name : "";
  const eligible =
    price.id === priceId &&
    price.livemode === false &&
    price.active === true &&
    price.currency === "usd" &&
    price.unit_amount === expected.unitAmount &&
    price.type === "recurring" &&
    price.billing_scheme === "per_unit" &&
    recurring?.interval === expected.interval &&
    recurring?.interval_count === 1 &&
    recurring?.usage_type === "licensed" &&
    product.deleted !== true &&
    product.active === true &&
    planNamePattern(planId).test(productName);
  if (!eligible) throw new Error(INELIGIBLE_PRICE_ERROR);
}

export async function prepareStripeSandboxCheckoutSession(
  input: StripeSandboxCheckoutRequest,
  environment: string | undefined,
  configuration: StripeSandboxPlanConfiguration,
  stripe: StripeSandboxCheckoutClient,
): Promise<PreparedStripeSandboxCheckout> {
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  assertReturnUrl(input.successUrl, STRIPE_SANDBOX_CHECKOUT_SUCCESS_URL);
  assertReturnUrl(input.cancelUrl, STRIPE_SANDBOX_CHECKOUT_CANCEL_URL);

  const resolved = resolveStripeSandboxPlan(
    { planId: input.planId, billingCycle: input.billingCycle },
    environment,
    configuration,
  );

  let price: StripeSandboxCheckoutPrice;
  try {
    price = await stripe.prices.retrieve(resolved.priceId, {
      expand: ["product"],
    });
  } catch {
    throw new Error(UNAVAILABLE_ERROR);
  }

  const product = await loadProduct(stripe, price.product);
  assertEligiblePrice(
    resolved.planId,
    resolved.billingCycle,
    resolved.priceId,
    price,
    product,
  );

  let session: StripeSandboxCheckoutSession;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        client_reference_id: idempotencyKey,
        line_items: [{ price: resolved.priceId, quantity: 1 }],
        success_url: STRIPE_SANDBOX_CHECKOUT_SUCCESS_URL,
        cancel_url: STRIPE_SANDBOX_CHECKOUT_CANCEL_URL,
      },
      { idempotencyKey },
    );
  } catch {
    throw new Error(UNAVAILABLE_ERROR);
  }

  const accepted = acceptedCheckoutSession(session);
  return {
    sessionId: accepted.sessionId,
    url: accepted.url,
    priceId: resolved.priceId,
    planId: resolved.planId,
    billingCycle: resolved.billingCycle,
  };
}
