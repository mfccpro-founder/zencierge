import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase-admin";
import {
  billingPriceUsd,
  parseBillingCycle,
  parsePlanId,
  type BillingCycle,
  type ZenciergePlanId,
} from "./zencierge-plans";

type CheckoutRow = {
  id: string;
  user_id: string;
  plan_id: string;
  billing_cycle: string;
  expected_price_id: string;
  stripe_subscription_id: string | null;
  status: string;
  updated_at: string;
};

type InvoiceRow = {
  invoice_id: string;
  checkout_session_id: string;
  stripe_subscription_id: string;
  webhook_event_id: string;
};

type EventRow = {
  event_id: string;
  event_type: string;
  status: string;
  checkout_session_id: string | null;
  invoice_id: string | null;
  stripe_subscription_id: string | null;
};

export type StripeSandboxAccessSnapshot = {
  checkouts: CheckoutRow[];
  invoices: InvoiceRow[];
  events: EventRow[];
};

export type StripeSandboxAccessStore = {
  load(userId: string): Promise<StripeSandboxAccessSnapshot>;
};

export type StripeSandboxAccessClient = {
  subscriptions: { retrieve(id: string): Promise<unknown> };
  invoices: { retrieve(id: string): Promise<unknown> };
};

export type StripeSandboxAccessResult =
  | {
      granted: true;
      source: "stripe_sandbox";
      planId: ZenciergePlanId;
      billingCycle: BillingCycle;
      currentPeriodEnd: string;
      checkoutSessionId: string;
    }
  | { granted: false; reason: string };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function objectId(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  return typeof record(value)?.id === "string" ? (record(value)?.id as string) : null;
}

function unix(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function subscriptionInvoiceId(invoice: Record<string, unknown>) {
  const parent = record(invoice.parent);
  const details = record(parent?.subscription_details);
  return objectId(details?.subscription);
}

function verifyRemoteBilling(input: {
  subscription: unknown;
  invoice: unknown;
  subscriptionId: string;
  invoiceId: string;
  expectedPriceId: string;
  planId: ZenciergePlanId;
  billingCycle: BillingCycle;
  nowMs: number;
}) {
  const subscription = record(input.subscription);
  const invoice = record(input.invoice);
  const items = record(subscription?.items)?.data;
  if (!subscription || !invoice || !Array.isArray(items) || items.length !== 1) return null;

  const item = record(items[0]);
  const price = record(item?.price);
  const recurring = record(price?.recurring);
  const periodStart = unix(item?.current_period_start);
  const periodEnd = unix(item?.current_period_end);
  const paidAt = unix(record(invoice.status_transitions)?.paid_at);
  const invoiceLines = record(invoice.lines)?.data;
  const invoiceLine = Array.isArray(invoiceLines) && invoiceLines.length === 1
    ? record(invoiceLines[0])
    : null;
  const invoiceLinePeriod = record(invoiceLine?.period);
  const invoiceLinePrice = record(record(invoiceLine?.pricing)?.price_details)?.price;
  const invoicePeriodStart = unix(invoiceLinePeriod?.start);
  const invoicePeriodEnd = unix(invoiceLinePeriod?.end);
  const expectedInterval = input.billingCycle === "annual" ? "year" : "month";
  const expectedAmount = billingPriceUsd(input.planId, input.billingCycle) * 100;

  const valid =
    subscription.id === input.subscriptionId &&
    subscription.livemode === false &&
    subscription.status === "active" &&
    price?.id === input.expectedPriceId &&
    price?.livemode === false &&
    recurring?.interval === expectedInterval &&
    recurring?.interval_count === 1 &&
    periodStart !== null &&
    periodEnd !== null &&
    periodStart * 1000 <= input.nowMs &&
    input.nowMs < periodEnd * 1000 &&
    invoice.id === input.invoiceId &&
    invoice.livemode === false &&
    invoice.status === "paid" &&
    paidAt !== null &&
    paidAt > 0 &&
    paidAt * 1000 <= input.nowMs &&
    invoicePeriodStart !== null &&
    invoicePeriodEnd !== null &&
    invoicePeriodStart === periodStart &&
    invoicePeriodEnd === periodEnd &&
    invoicePeriodStart * 1000 <= input.nowMs &&
    input.nowMs < invoicePeriodEnd * 1000 &&
    invoice.currency === "usd" &&
    invoice.amount_paid === expectedAmount &&
    invoiceLine?.amount === expectedAmount &&
    invoiceLine?.currency === "usd" &&
    objectId(invoiceLinePrice) === input.expectedPriceId &&
    subscriptionInvoiceId(invoice) === input.subscriptionId;

  return valid && periodEnd !== null ? new Date(periodEnd * 1000).toISOString() : null;
}

export function stripeSandboxAccessOptionEnabled(input: {
  nodeEnv: string | undefined;
  enabled: string | undefined;
}) {
  return input.nodeEnv === "development" && input.enabled?.trim().toLowerCase() === "true";
}

export async function resolveStripeSandboxAccess(input: {
  nodeEnv: string | undefined;
  enabled: string | undefined;
  authenticated: boolean;
  userId: string;
  squareSubscriptionId: string | null | undefined;
  now?: Date;
  store: StripeSandboxAccessStore;
  stripe: StripeSandboxAccessClient;
}): Promise<StripeSandboxAccessResult> {
  if (!stripeSandboxAccessOptionEnabled(input)) return { granted: false, reason: "disabled" };
  if (!input.authenticated) return { granted: false, reason: "unauthenticated" };
  if (input.squareSubscriptionId?.trim()) return { granted: false, reason: "square-host-protected" };

  let snapshot: StripeSandboxAccessSnapshot;
  try {
    snapshot = await input.store.load(input.userId);
  } catch {
    return { granted: false, reason: "local-verification-unavailable" };
  }

  const nowMs = (input.now ?? new Date()).getTime();
  for (const checkout of snapshot.checkouts) {
    const planId = parsePlanId(checkout.plan_id);
    const billingCycle = parseBillingCycle(checkout.billing_cycle);
    if (
      checkout.user_id !== input.userId ||
      checkout.status !== "correlated" ||
      !checkout.stripe_subscription_id ||
      !planId ||
      !billingCycle
    ) continue;

    const invoices = snapshot.invoices.filter(
      (invoice) =>
        invoice.checkout_session_id === checkout.id &&
        invoice.stripe_subscription_id === checkout.stripe_subscription_id,
    );
    for (const invoice of invoices) {
      const applied = snapshot.events.some(
        (event) =>
          event.event_id === invoice.webhook_event_id &&
          event.event_type === "invoice.paid" &&
          event.status === "applied" &&
          event.checkout_session_id === checkout.id &&
          event.invoice_id === invoice.invoice_id &&
          event.stripe_subscription_id === checkout.stripe_subscription_id,
      );
      if (!applied) continue;

      try {
        const [subscription, remoteInvoice] = await Promise.all([
          input.stripe.subscriptions.retrieve(checkout.stripe_subscription_id),
          input.stripe.invoices.retrieve(invoice.invoice_id),
        ]);
        const currentPeriodEnd = verifyRemoteBilling({
          subscription,
          invoice: remoteInvoice,
          subscriptionId: checkout.stripe_subscription_id,
          invoiceId: invoice.invoice_id,
          expectedPriceId: checkout.expected_price_id,
          planId,
          billingCycle,
          nowMs,
        });
        if (!currentPeriodEnd) continue;
        return {
          granted: true,
          source: "stripe_sandbox",
          planId,
          billingCycle,
          currentPeriodEnd,
          checkoutSessionId: checkout.id,
        };
      } catch {
        return { granted: false, reason: "stripe-verification-unavailable" };
      }
    }
  }
  return { granted: false, reason: "not-eligible" };
}

export function createStripeSandboxAccessStore(
  admin: Pick<SupabaseClient, "from">,
): StripeSandboxAccessStore {
  return {
    async load(userId) {
      const checkoutResult = await admin
        .from("stripe_sandbox_checkout_sessions")
        .select("id,user_id,plan_id,billing_cycle,expected_price_id,stripe_subscription_id,status,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (checkoutResult.error) throw new Error("Stripe Sandbox access lookup failed");
      const checkouts = (checkoutResult.data ?? []) as CheckoutRow[];
      const ids = checkouts.map((row) => row.id);
      if (ids.length === 0) return { checkouts, invoices: [], events: [] };

      const [invoiceResult, eventResult] = await Promise.all([
        admin
          .from("stripe_sandbox_invoices")
          .select("invoice_id,checkout_session_id,stripe_subscription_id,webhook_event_id")
          .in("checkout_session_id", ids),
        admin
          .from("stripe_sandbox_webhook_events")
          .select("event_id,event_type,status,checkout_session_id,invoice_id,stripe_subscription_id")
          .in("checkout_session_id", ids),
      ]);
      if (invoiceResult.error || eventResult.error) {
        throw new Error("Stripe Sandbox access lookup failed");
      }
      return {
        checkouts,
        invoices: (invoiceResult.data ?? []) as InvoiceRow[],
        events: (eventResult.data ?? []) as EventRow[],
      };
    },
  };
}

export async function resolveConfiguredStripeSandboxAccess(input: {
  authenticated: boolean;
  userId: string;
  squareSubscriptionId: string | null | undefined;
}) {
  const enabled = process.env.STRIPE_SANDBOX_ACCESS_ENABLED;
  if (!stripeSandboxAccessOptionEnabled({ nodeEnv: process.env.NODE_ENV, enabled })) {
    return { granted: false, reason: "disabled" } as const;
  }
  const key = process.env.STRIPE_SANDBOX_SECRET_KEY?.trim() ?? "";
  if (!key.startsWith("sk_test_")) return { granted: false, reason: "not-configured" } as const;
  try {
    return await resolveStripeSandboxAccess({
      nodeEnv: process.env.NODE_ENV,
      enabled,
      authenticated: input.authenticated,
      userId: input.userId,
      squareSubscriptionId: input.squareSubscriptionId,
      store: createStripeSandboxAccessStore(createSupabaseAdminClient()),
      stripe: new Stripe(key),
    });
  } catch {
    return { granted: false, reason: "not-configured" } as const;
  }
}
