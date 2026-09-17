import { resolveSquareEnvironment } from "@/lib/square-client";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";

/** Server-only fail-soft payment correlation enrichment. */
if (typeof window !== "undefined") {
  throw new Error("square-payment-enrichment is server-only");
}

const CORRELATION_SELECT =
  "provider_payment_id, square_order_id, square_location_id, square_environment, square_invoice_id, square_subscription_id, billing_cycle";

export type SquarePaymentEnrichmentInput = {
  providerPaymentId: string;
  squareOrderId: string | null;
  squareLocationId: string | null;
};

export type SquarePaymentEnrichmentSkipReason =
  | "missing_payment_id"
  | "missing_environment"
  | "admin_unavailable"
  | "payment_not_found"
  | "nothing_to_fill";

export type SquarePaymentEnrichmentResult =
  | {
      status: "updated";
      fields: Array<
        "square_order_id" | "square_location_id" | "square_environment"
      >;
    }
  | {
      status: "skipped";
      reason: SquarePaymentEnrichmentSkipReason;
    }
  | {
      status: "failed_soft";
      reason: "select_error" | "update_error" | "unexpected";
    };

export type SquarePaymentEnrichmentAdminClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message?: string } | null;
        }>;
      };
    };
    update: (values: Record<string, string>) => {
      eq: (
        column: string,
        value: string,
      ) => Promise<{
        error: { message?: string } | null;
      }>;
    };
  };
};

export type SquarePaymentEnrichmentDependencies = {
  createAdmin?: () => SquarePaymentEnrichmentAdminClient | null;
  resolveEnvironmentName?: () => "sandbox" | "production" | null;
  env?: {
    SQUARE_ENVIRONMENT?: string;
  };
};

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function defaultResolveEnvironmentName(
  env?: SquarePaymentEnrichmentDependencies["env"],
): "sandbox" | "production" | null {
  try {
    return resolveSquareEnvironment(env?.SQUARE_ENVIRONMENT).name;
  } catch {
    return null;
  }
}

/**
 * Fail-soft: fills null correlation columns on subscription_payments from
 * payment payload ids + local Square environment. Never throws. Never
 * synthesizes invoice/subscription/billing_cycle. Never overwrites non-nulls.
 */
export async function enrichSubscriptionPaymentSquareCorrelation(
  input: SquarePaymentEnrichmentInput,
  deps: SquarePaymentEnrichmentDependencies = {},
): Promise<SquarePaymentEnrichmentResult> {
  try {
    const providerPaymentId = nullableString(input.providerPaymentId);
    if (!providerPaymentId) {
      return { status: "skipped", reason: "missing_payment_id" };
    }

    const resolveEnvironmentName =
      deps.resolveEnvironmentName ??
      (() => defaultResolveEnvironmentName(deps.env));
    const squareEnvironment = resolveEnvironmentName();
    if (!squareEnvironment) {
      return { status: "skipped", reason: "missing_environment" };
    }

    const createAdmin =
      deps.createAdmin ??
      (() =>
        tryCreateSupabaseAdminClient() as SquarePaymentEnrichmentAdminClient | null);
    const admin = createAdmin();
    if (!admin) {
      return { status: "skipped", reason: "admin_unavailable" };
    }

    const selected = await admin
      .from("subscription_payments")
      .select(CORRELATION_SELECT)
      .eq("provider_payment_id", providerPaymentId)
      .maybeSingle();

    if (selected.error) {
      return { status: "failed_soft", reason: "select_error" };
    }
    if (!selected.data) {
      return { status: "skipped", reason: "payment_not_found" };
    }

    const currentOrderId = nullableString(selected.data.square_order_id);
    const currentLocationId = nullableString(selected.data.square_location_id);
    const currentEnvironment = nullableString(selected.data.square_environment);

    const incomingOrderId = nullableString(input.squareOrderId);
    const incomingLocationId = nullableString(input.squareLocationId);

    const patch: Record<string, string> = {};
    const fields: Array<
      "square_order_id" | "square_location_id" | "square_environment"
    > = [];

    if (currentOrderId === null && incomingOrderId) {
      patch.square_order_id = incomingOrderId;
      fields.push("square_order_id");
    }
    if (currentLocationId === null && incomingLocationId) {
      patch.square_location_id = incomingLocationId;
      fields.push("square_location_id");
    }
    if (currentEnvironment === null) {
      patch.square_environment = squareEnvironment;
      fields.push("square_environment");
    }

    if (fields.length === 0) {
      return { status: "skipped", reason: "nothing_to_fill" };
    }

    const updated = await admin
      .from("subscription_payments")
      .update(patch)
      .eq("provider_payment_id", providerPaymentId);

    if (updated.error) {
      return { status: "failed_soft", reason: "update_error" };
    }

    return { status: "updated", fields };
  } catch {
    return { status: "failed_soft", reason: "unexpected" };
  }
}
