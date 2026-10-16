import type { SupabaseClient } from "@supabase/supabase-js";

export type StripeSandboxRpcRow = {
  checkout_session_id?: string | null;
  event_id?: string | null;
  invoice_id?: string | null;
  replayed?: boolean | null;
  status?: string | null;
};

export type StripeSandboxPersistence = {
  register(input: {
    userId: string;
    planId: string;
    billingCycle: string;
    expectedPriceId: string;
  }): Promise<{ checkoutSessionId: string; status: string }>;
  attach(input: {
    checkoutSessionId: string;
    stripeSessionId: string;
  }): Promise<{ checkoutSessionId: string; status: string }>;
  applyWebhook(input: {
    eventId: string;
    payloadSha256: string;
    eventType: "checkout.session.completed" | "invoice.paid";
    invoiceId: string | null;
    stripeSubscriptionId: string | null;
    stripeSessionId: string | null;
    clientReferenceId: string | null;
  }): Promise<{
    replayed: boolean;
    status: string;
    eventId: string;
    checkoutSessionId: string | null;
    invoiceId: string | null;
  }>;
};

function firstRow(data: unknown, operation: string): StripeSandboxRpcRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error(`Stripe Sandbox ${operation} returned no row`);
  }
  return row as StripeSandboxRpcRow;
}

export function createStripeSandboxPersistence(
  admin: Pick<SupabaseClient, "rpc">,
): StripeSandboxPersistence {
  return {
    async register(input) {
      const { data, error } = await admin.rpc(
        "stripe_sandbox_register_checkout_session",
        {
          p_user_id: input.userId,
          p_plan_id: input.planId,
          p_billing_cycle: input.billingCycle,
          p_expected_price_id: input.expectedPriceId,
        },
      );
      if (error) throw new Error("Stripe Sandbox checkout registration failed");
      const row = firstRow(data, "checkout registration");
      if (typeof row.checkout_session_id !== "string" || typeof row.status !== "string") {
        throw new Error("Stripe Sandbox checkout registration returned an invalid row");
      }
      return { checkoutSessionId: row.checkout_session_id, status: row.status };
    },

    async attach(input) {
      const { data, error } = await admin.rpc(
        "stripe_sandbox_attach_stripe_session_id",
        {
          p_checkout_session_id: input.checkoutSessionId,
          p_stripe_session_id: input.stripeSessionId,
        },
      );
      if (error) throw new Error("Stripe Sandbox checkout attachment failed");
      const row = firstRow(data, "checkout attachment");
      if (typeof row.checkout_session_id !== "string" || typeof row.status !== "string") {
        throw new Error("Stripe Sandbox checkout attachment returned an invalid row");
      }
      return { checkoutSessionId: row.checkout_session_id, status: row.status };
    },

    async applyWebhook(input) {
      const { data, error } = await admin.rpc("stripe_sandbox_apply_webhook_event", {
        p_event_id: input.eventId,
        p_payload_sha256: input.payloadSha256,
        p_event_type: input.eventType,
        p_invoice_id: input.invoiceId,
        p_stripe_subscription_id: input.stripeSubscriptionId,
        p_stripe_session_id: input.stripeSessionId,
        p_client_reference_id: input.clientReferenceId,
      });
      if (error) throw new Error("Stripe Sandbox webhook persistence failed");
      const row = firstRow(data, "webhook persistence");
      if (typeof row.event_id !== "string" || typeof row.status !== "string") {
        throw new Error("Stripe Sandbox webhook persistence returned an invalid row");
      }
      return {
        replayed: row.replayed === true,
        status: row.status,
        eventId: row.event_id,
        checkoutSessionId: row.checkout_session_id ?? null,
        invoiceId: row.invoice_id ?? null,
      };
    },
  };
}
