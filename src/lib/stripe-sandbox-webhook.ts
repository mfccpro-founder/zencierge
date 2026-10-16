import Stripe from "stripe";
import { createHash } from "node:crypto";
import {
  extractStripeSandboxCheckoutSession,
  extractStripeSandboxInvoice,
} from "./stripe-sandbox-correlation";
import type { StripeSandboxPersistence } from "./stripe-sandbox-persistence";

/**
 * Development-only Stripe Sandbox webhook recognition.
 * Verifies the signature and test-mode flag. Does not sync subscriptions,
 * grant access, or write to Supabase.
 */
export const STRIPE_SANDBOX_WEBHOOK_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

const RECOGNIZED_EVENT_TYPES = new Set<string>(STRIPE_SANDBOX_WEBHOOK_EVENT_TYPES);

export type StripeSandboxWebhookResult = {
  status: number;
  body: Record<string, unknown>;
};

type VerifiedWebhook =
  | { ok: true; event: Stripe.Event }
  | { ok: false; result: StripeSandboxWebhookResult };

function notFound(): StripeSandboxWebhookResult {
  return { status: 404, body: { error: "Not found" } };
}

export function verifyStripeSandboxWebhook(input: {
  nodeEnv: string | undefined;
  secret: string | undefined;
  rawBody: string;
  signature: string | null;
}): VerifiedWebhook {
  if (input.nodeEnv !== "development") return { ok: false, result: notFound() };

  const secret = input.secret?.trim() ?? "";
  if (!secret) {
    return { ok: false, result: { status: 503, body: { error: "Stripe Sandbox webhook is not configured" } } };
  }

  const signature = input.signature?.trim() ?? "";
  if (!signature) {
    return { ok: false, result: { status: 400, body: { error: "Invalid Stripe signature" } } };
  }

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(input.rawBody, signature, secret);
  } catch {
    return { ok: false, result: { status: 400, body: { error: "Invalid Stripe signature" } } };
  }

  if (event.livemode !== false) {
    return { ok: false, result: { status: 400, body: { error: "Live Stripe events are not accepted" } } };
  }

  if (!RECOGNIZED_EVENT_TYPES.has(event.type)) {
    return { ok: false, result: { status: 400, body: { error: "Unrecognized Stripe Sandbox event" } } };
  }

  return { ok: true, event };
}

export function handleStripeSandboxWebhook(input: {
  nodeEnv: string | undefined;
  secret: string | undefined;
  rawBody: string;
  signature: string | null;
}): StripeSandboxWebhookResult {
  const verified = verifyStripeSandboxWebhook(input);
  if (!verified.ok) return verified.result;
  return { status: 200, body: { received: true, type: verified.event.type } };
}

export async function persistStripeSandboxWebhook(
  input: {
    nodeEnv: string | undefined;
    secret: string | undefined;
    rawBody: string;
    signature: string | null;
  },
  persistence: StripeSandboxPersistence,
): Promise<StripeSandboxWebhookResult> {
  const verified = verifyStripeSandboxWebhook(input);
  if (!verified.ok) return verified.result;

  const { event } = verified;
  if (event.type !== "checkout.session.completed" && event.type !== "invoice.paid") {
    return { status: 200, body: { received: true, type: event.type, persisted: false } };
  }

  const payloadSha256 = createHash("sha256").update(input.rawBody, "utf8").digest("hex");
  const session =
    event.type === "checkout.session.completed"
      ? extractStripeSandboxCheckoutSession(event.data.object as Stripe.Checkout.Session)
      : null;
  const invoice =
    event.type === "invoice.paid"
      ? extractStripeSandboxInvoice(event.data.object as Stripe.Invoice)
      : null;

  try {
    const stored = await persistence.applyWebhook({
      eventId: event.id,
      payloadSha256,
      eventType: event.type,
      invoiceId: invoice?.invoiceId ?? null,
      stripeSubscriptionId: invoice?.subscriptionId ?? session?.subscriptionId ?? null,
      stripeSessionId: session?.sessionId ?? null,
      clientReferenceId: session?.clientReferenceId ?? null,
    });
    return {
      status: 200,
      body: {
        received: true,
        type: event.type,
        persisted: true,
        replayed: stored.replayed,
        correlationStatus: stored.status,
      },
    };
  } catch {
    return {
      status: 503,
      body: { error: "Stripe Sandbox webhook persistence failed" },
    };
  }
}
