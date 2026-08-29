import { randomUUID } from "node:crypto";
import { createSquareClient } from "@/lib/square-client";
import { parsePlanId, ZENCIERGE_PLANS, type ZenciergePlanId } from "@/lib/zencierge-plans";
import { recordFunnelEvent } from "@/lib/admin-revenue-store";
import { GUEST_ADDONS, parseGuestAddonId, type GuestAddonId } from "@/lib/guest-addons";

export type SquareCheckoutKind = "host_subscription" | "guest_addon";
export type BillingCycle = "monthly" | "annual";
export type { GuestAddonId };
export { GUEST_ADDONS, parseGuestAddonId };

export function isSquareSandbox() {
  return (process.env.SQUARE_ENVIRONMENT ?? "sandbox").toLowerCase() === "sandbox";
}

export function allowMockSquareCheckout() {
  if (process.env.SQUARE_MOCK_CHECKOUT === "1") return true;
  if (process.env.NODE_ENV !== "production") return true;
  return isSquareSandbox();
}

export function hasUsableSquareCredentials() {
  const token = process.env.SQUARE_ACCESS_TOKEN?.trim() ?? "";
  const locationId = process.env.SQUARE_LOCATION_ID?.trim() ?? "";
  if (!token || !locationId) return false;
  if (/your-square|pega_aqui|placeholder/i.test(token)) return false;
  return true;
}

export function preferMockSquareCheckout() {
  return process.env.SQUARE_MOCK_CHECKOUT === "1" || !hasUsableSquareCredentials();
}

export type SquareCheckoutRequest = {
  kind?: string;
  planId?: string;
  billing?: string;
  addonId?: string;
  propertyId?: string;
  email?: string | null;
  name?: string | null;
  userId?: string | null;
  origin: string;
  forceLiveSquare?: boolean;
};

export type SquareCheckoutResult = {
  url: string;
  kind: SquareCheckoutKind;
  amountCents: number;
  mock: boolean;
  sandbox: boolean;
  planId?: ZenciergePlanId;
  billing?: BillingCycle;
  addonId?: GuestAddonId;
  propertyId?: string;
};

function mockCheckoutUrl(origin: string, params: Record<string, string>) {
  const url = new URL("/api/payments/square/checkout/complete", origin);
  url.searchParams.set("mock", "1");
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

async function ensureSquareCustomer(email: string | null | undefined, name?: string | null) {
  if (!email?.includes("@") || !hasUsableSquareCredentials()) return null;
  try {
    const { client } = createSquareClient();
    const search = await client.customers.search({
      query: {
        filter: {
          emailAddress: { exact: email },
        },
      },
    });
    const existing = search.customers?.[0]?.id;
    if (existing) return existing;
    const givenName = name?.trim().split(/\s+/)[0] || undefined;
    const created = await client.customers.create({
      emailAddress: email,
      givenName,
      idempotencyKey: randomUUID(),
      referenceId: "zencierge-host",
    });
    return created.customer?.id ?? null;
  } catch {
    return null;
  }
}

async function createPaymentLink(input: {
  name: string;
  amountCents: bigint;
  redirectUrl: string;
  email?: string | null;
}) {
  const { client, locationId } = createSquareClient();
  const checkout = await client.checkout.paymentLinks.create({
    idempotencyKey: randomUUID(),
    quickPay: {
      name: input.name,
      priceMoney: {
        amount: input.amountCents,
        currency: "USD",
      },
      locationId,
    },
    checkoutOptions: {
      redirectUrl: input.redirectUrl,
      askForShippingAddress: false,
    },
    prePopulatedData: input.email
      ? {
          buyerEmail: input.email,
        }
      : undefined,
  });
  const url = checkout.paymentLink?.url?.trim() ?? "";
  if (!url) throw new Error("Square did not return a checkout URL");
  return url;
}

export async function createSquareCheckoutSession(input: SquareCheckoutRequest): Promise<SquareCheckoutResult> {
  const kind: SquareCheckoutKind = input.kind === "guest_addon" ? "guest_addon" : "host_subscription";
  const sandbox = isSquareSandbox();
  const billing: BillingCycle = input.billing === "annual" ? "annual" : "monthly";

  if (kind === "guest_addon") {
    const addonId = parseGuestAddonId(input.addonId);
    if (!addonId) throw new Error("addonId must be early_checkin or mid_stay_clean");
    const addon = GUEST_ADDONS[addonId];
    const amountCents = addon.usd * 100;
    const propertyId = (input.propertyId ?? "").trim() || "prop-1";
    const complete = new URL("/api/payments/square/checkout/complete", input.origin);
    complete.searchParams.set("kind", "guest_addon");
    complete.searchParams.set("addon", addonId);
    complete.searchParams.set("propertyId", propertyId);

    const mockUrl = mockCheckoutUrl(input.origin, {
      kind: "guest_addon",
      addon: addonId,
      propertyId,
    });

    if (preferMockSquareCheckout()) {
      return {
        url: mockUrl,
        kind,
        amountCents,
        mock: true,
        sandbox,
        addonId,
        propertyId,
      };
    }

    try {
      await ensureSquareCustomer(input.email, input.name);
      const url = await createPaymentLink({
        name: `Zencierge · ${addon.name}`,
        amountCents: BigInt(amountCents),
        redirectUrl: complete.toString(),
        email: input.email,
      });
      return { url, kind, amountCents, mock: false, sandbox, addonId, propertyId };
    } catch (cause) {
      if (!allowMockSquareCheckout()) throw cause;
      return {
        url: mockUrl,
        kind,
        amountCents,
        mock: true,
        sandbox,
        addonId,
        propertyId,
      };
    }
  }

  const planId = parsePlanId(input.planId) ?? "pro";
  const plan = ZENCIERGE_PLANS[planId];
  const amountUsd = billing === "annual" ? plan.monthlyUsd * 10 : plan.monthlyUsd;
  const amountCents = amountUsd * 100;
  const label =
    billing === "annual" ? `${plan.name} · annual subscription` : `${plan.name} · monthly subscription`;

  recordFunnelEvent({
    type: "checkout_started",
    planId,
    source: "checkout",
    email: input.email ?? undefined,
  });

  const complete = new URL("/api/payments/square/checkout/complete", input.origin);
  complete.searchParams.set("kind", "host_subscription");
  complete.searchParams.set("plan", planId);
  complete.searchParams.set("billing", billing);

  const mockUrl = mockCheckoutUrl(input.origin, {
    kind: "host_subscription",
    plan: planId,
    billing,
  });

  if (preferMockSquareCheckout()) {
    if (input.forceLiveSquare) {
      throw new Error(
        "Square Sandbox is not configured. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID (and do not set SQUARE_MOCK_CHECKOUT=1).",
      );
    }
    return {
      url: mockUrl,
      kind,
      amountCents,
      mock: true,
      sandbox,
      planId,
      billing,
    };
  }

  try {
    await ensureSquareCustomer(input.email, input.name);
    const url = await createPaymentLink({
      name: `Zencierge ${label}`,
      amountCents: BigInt(amountCents),
      redirectUrl: complete.toString(),
      email: input.email,
    });
    return { url, kind, amountCents, mock: false, sandbox, planId, billing };
  } catch (cause) {
    if (input.forceLiveSquare || !allowMockSquareCheckout()) throw cause;
    return {
      url: mockUrl,
      kind,
      amountCents,
      mock: true,
      sandbox,
      planId,
      billing,
    };
  }
}
