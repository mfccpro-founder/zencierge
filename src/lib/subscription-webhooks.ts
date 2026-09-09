import { createHash } from "node:crypto";
import { recordFunnelEvent, recordSquareCharge } from "@/lib/admin-revenue-store";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { parsePlanId, planFromUsdAmount, ZENCIERGE_PLANS, type ZenciergePlanId } from "@/lib/zencierge-plans";

export type SubscriptionWebhookEvent = "payment.succeeded" | "payment.failed" | "subscription.canceled";
export type SubscriptionWebhookProvider = "square" | "generic_subscription";

export type SubscriptionWebhookInput = {
  type: SubscriptionWebhookEvent;
  userId?: string | null;
  email?: string | null;
  planId?: ZenciergePlanId | null;
  amountUsd?: number | null;
  paymentId?: string | null;
  squareCustomerId?: string | null;
  squareSubscriptionId?: string | null;
  occurredAt?: string | null;
};

export type ProviderSubscriptionWebhookInput =
  SubscriptionWebhookInput & {
    provider: SubscriptionWebhookProvider;
    eventId: string;
  };

export type ProviderSubscriptionWebhookFingerprintInput = {
  provider: SubscriptionWebhookProvider;
  eventId: string;
  type: SubscriptionWebhookEvent;
  userId: string | null;
  email: string | null;
  planId: ZenciergePlanId | null;
  amountUsd: number | null;
  paymentId: string | null;
  squareCustomerId: string | null;
  squareSubscriptionId: string | null;
  occurredAt: string | null;
};

export type ProviderSubscriptionWebhookAtomicArgs = {
  p_provider: SubscriptionWebhookProvider;
  p_event_id: string;
  p_event_type: SubscriptionWebhookEvent;
  p_payload_sha256: string;
  p_user_id: string | null;
  p_email: string | null;
  p_plan_id: ZenciergePlanId;
  p_monthly_usd: number;
  p_amount_usd: number | null;
  p_payment_id: string | null;
  p_square_customer_id: string | null;
  p_square_subscription_id: string | null;
  p_occurred_at: string | null;
  p_current_period_end: null;
};

export type ProviderSubscriptionWebhookAtomicResult = {
  processed: boolean;
  replayed: boolean;
  skipped_subscription: boolean;
  resolved_user_id: string | null;
  resolved_plan_id: ZenciergePlanId;
  subscription_status: "active" | "past_due" | "canceled";
};

export type ProviderSubscriptionWebhookStore = {
  resolveUserId(input: {
    userId?: string | null;
    email?: string | null;
  }): Promise<string | null>;
  processAtomic(
    args: ProviderSubscriptionWebhookAtomicArgs,
  ): Promise<unknown>;
};

export type ProviderSubscriptionWebhookDependencies = {
  createStore(): ProviderSubscriptionWebhookStore;
  resolvePlan(input: {
    planId?: ZenciergePlanId | null;
    amountUsd: number;
  }): {
    planId: ZenciergePlanId;
    monthlyUsd: number;
  };
  now(): Date;
  recordCharge: typeof recordSquareCharge;
  recordFunnel: typeof recordFunnelEvent;
};

export type ProviderSubscriptionWebhookResult = {
  ok: true;
  processed: boolean;
  replayed: boolean;
  skippedSubscription: boolean;
  userId: string | null;
  planId: ZenciergePlanId;
  status: "active" | "past_due" | "canceled";
};

export type HostSubscriptionRow = {
  user_id: string;
  email: string | null;
  plan_id: string;
  status: string;
  monthly_usd: number;
  square_customer_id: string | null;
  square_subscription_id: string | null;
  current_period_end: string | null;
  last_payment_at: string | null;
};

export type SubscriptionPaymentRow = {
  id: string;
  user_id: string | null;
  host_email: string | null;
  amount_usd: number;
  plan_id: string | null;
  status: string;
  provider_event: string | null;
  provider_payment_id: string | null;
  created_at: string;
};

export type ValidatedSubscriptionWebhookPayment =
  | {
      ok: true;
      paymentId: string;
      amountUsd: number;
    }
  | {
      ok: false;
      error: "Invalid payment event";
    };

/**
 * Payment events must carry provider-issued identity and measured money.
 * Never synthesize either field from event time or catalog pricing.
 */
export function validateSubscriptionWebhookPayment(
  input: SubscriptionWebhookInput,
): ValidatedSubscriptionWebhookPayment | null {
  if (
    input.type !== "payment.succeeded" &&
    input.type !== "payment.failed"
  ) {
    return null;
  }

  const paymentId =
    typeof input.paymentId === "string" ? input.paymentId.trim() : "";
  const amountUsd = input.amountUsd;

  if (
    !paymentId ||
    typeof amountUsd !== "number" ||
    !Number.isFinite(amountUsd) ||
    amountUsd <= 0
  ) {
    return {
      ok: false,
      error: "Invalid payment event",
    };
  }

  return {
    ok: true,
    paymentId,
    amountUsd,
  };
}

function periodEndFromNow() {
  const end = new Date();
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end.toISOString();
}

function normalizedNullableString(
  value: string | null | undefined,
) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizedEmail(value: string | null | undefined) {
  return normalizedNullableString(value)?.toLowerCase() ?? null;
}

function normalizedProviderTimestamp(
  value: string | null | undefined,
) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

/**
 * Fingerprints only stable, normalized provider-envelope values.
 * Database lookup results, current catalog prices and wall-clock fallbacks
 * must never participate in replay identity comparison.
 */
export function subscriptionWebhookFingerprint(
  input: ProviderSubscriptionWebhookFingerprintInput,
) {
  const ordered = {
    provider: input.provider,
    eventId: input.eventId,
    type: input.type,
    userId: input.userId,
    email: input.email,
    planId: input.planId,
    amountUsd: input.amountUsd,
    paymentId: input.paymentId,
    squareCustomerId: input.squareCustomerId,
    squareSubscriptionId: input.squareSubscriptionId,
    occurredAt: input.occurredAt,
  };

  return createHash("sha256")
    .update(JSON.stringify(ordered), "utf8")
    .digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function subscriptionStatusFor(type: SubscriptionWebhookEvent) {
  return type === "payment.succeeded"
    ? "active"
    : type === "payment.failed"
      ? "past_due"
      : "canceled";
}

function parseProviderAtomicResult(
  data: unknown,
  expected: {
    userId: string | null;
    planId: ZenciergePlanId;
    status: "active" | "past_due" | "canceled";
  },
): ProviderSubscriptionWebhookAtomicResult | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0];
  if (!isRecord(row)) return null;

  const processed = row.processed;
  const replayed = row.replayed;
  if (
    typeof processed !== "boolean" ||
    typeof replayed !== "boolean"
  ) {
    return null;
  }
  if (processed === replayed) return null;
  if (typeof row.skipped_subscription !== "boolean") return null;

  const resolvedUserId =
    typeof row.resolved_user_id === "string"
      ? row.resolved_user_id
      : row.resolved_user_id === null
        ? null
        : undefined;
  if (resolvedUserId === undefined) return null;
  if (resolvedUserId !== expected.userId) return null;
  if (row.skipped_subscription !== (expected.userId === null)) return null;
  if (row.resolved_plan_id !== expected.planId) return null;
  if (row.subscription_status !== expected.status) return null;

  return {
    processed,
    replayed,
    skipped_subscription: row.skipped_subscription,
    resolved_user_id: resolvedUserId,
    resolved_plan_id: expected.planId,
    subscription_status: expected.status,
  };
}

async function resolveUserId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId?: string | null,
  email?: string | null,
) {
  if (userId) return userId;
  const trimmed = email?.trim().toLowerCase();
  if (!trimmed) return null;
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return null;
  return data.users.find((user) => user.email?.toLowerCase() === trimmed)?.id ?? null;
}

async function applyLegacySubscriptionWebhook(
  input: SubscriptionWebhookInput,
) {
  const validatedPayment = validateSubscriptionWebhookPayment(input);
  if (validatedPayment && !validatedPayment.ok) {
    throw new Error(validatedPayment.error);
  }

  const admin = createSupabaseAdminClient();
  const at = input.occurredAt ?? new Date().toISOString();
  const amountUsd = validatedPayment?.amountUsd ?? Number(input.amountUsd ?? 0);
  const planId = parsePlanId(input.planId) ?? (amountUsd > 0 ? planFromUsdAmount(amountUsd) : "starter");
  const monthlyUsd = ZENCIERGE_PLANS[planId].monthlyUsd;
  const userId = await resolveUserId(admin, input.userId, input.email);
  const email = input.email?.trim().toLowerCase() || null;

  if (input.type === "payment.succeeded" || input.type === "payment.failed") {
    if (!validatedPayment) {
      throw new Error("Invalid payment event");
    }
    const status = input.type === "payment.succeeded" ? "succeeded" : "failed";
    const paymentRow = {
      user_id: userId,
      host_email: email,
      amount_usd: validatedPayment.amountUsd,
      currency: "USD",
      plan_id: planId,
      status,
      provider_event: input.type,
      provider_payment_id: validatedPayment.paymentId,
    };
    const { error: payError } = await admin.from("subscription_payments").upsert(paymentRow, {
      onConflict: "provider_payment_id",
    });
    if (payError) throw payError;

    recordSquareCharge({
      at,
      amountUsd: validatedPayment.amountUsd,
      status: status === "succeeded" ? "SUCCESS" : "FAILED",
      email: email ?? undefined,
      planId,
      squarePaymentId: paymentRow.provider_payment_id,
    });
    if (status === "succeeded") {
      recordFunnelEvent({ type: "paid", planId, source: "webhook", email: email ?? undefined, at });
    }
  }

  if (!userId) {
    return { ok: true, skippedSubscription: true, reason: "no matching auth user" };
  }

  const nextStatus =
    input.type === "payment.succeeded" ? "active" : input.type === "payment.failed" ? "past_due" : "canceled";

  const row: Record<string, unknown> = {
    user_id: userId,
    email,
    plan_id: planId,
    status: nextStatus,
    monthly_usd: monthlyUsd,
    updated_at: at,
  };
  if (input.squareCustomerId) row.square_customer_id = input.squareCustomerId;
  if (input.squareSubscriptionId) row.square_subscription_id = input.squareSubscriptionId;
  if (input.type === "payment.succeeded") {
    row.last_payment_at = at;
    row.current_period_end = periodEndFromNow();
  }

  const { error: subError } = await admin.from("host_subscriptions").upsert(row, { onConflict: "user_id" });
  if (subError) throw subError;

  return { ok: true, userId, planId, status: nextStatus };
}

export async function applyProviderSubscriptionWebhook(
  input: ProviderSubscriptionWebhookInput,
  dependencies: ProviderSubscriptionWebhookDependencies =
    DEFAULT_PROVIDER_SUBSCRIPTION_WEBHOOK_DEPENDENCIES,
): Promise<ProviderSubscriptionWebhookResult> {
  const provider =
    input.provider === "square" ||
    input.provider === "generic_subscription"
      ? input.provider
      : null;
  const eventId =
    typeof input.eventId === "string" ? input.eventId.trim() : "";

  if (!provider || !eventId) {
    throw new Error("Invalid provider webhook event");
  }

  const validatedPayment = validateSubscriptionWebhookPayment(input);
  if (validatedPayment && !validatedPayment.ok) {
    throw new Error(validatedPayment.error);
  }

  const providerUserId = normalizedNullableString(input.userId);
  const email = normalizedEmail(input.email);
  const providerPlanId = parsePlanId(input.planId);
  const paymentId = validatedPayment?.paymentId ?? null;
  const amountUsd = validatedPayment?.amountUsd ?? null;
  const squareCustomerId = normalizedNullableString(
    input.squareCustomerId,
  );
  const squareSubscriptionId = normalizedNullableString(
    input.squareSubscriptionId,
  );
  const occurredAt = normalizedProviderTimestamp(input.occurredAt);

  const store = dependencies.createStore();
  const userId = await store.resolveUserId({
    userId: providerUserId,
    email,
  });

  const resolvedPlan = dependencies.resolvePlan({
    planId: input.planId,
    amountUsd: amountUsd ?? 0,
  });
  const planId = parsePlanId(resolvedPlan.planId);
  const monthlyUsd = resolvedPlan.monthlyUsd;
  if (
    !planId ||
    typeof monthlyUsd !== "number" ||
    !Number.isFinite(monthlyUsd) ||
    monthlyUsd <= 0
  ) {
    throw new Error("Invalid provider webhook plan");
  }

  const fingerprint = subscriptionWebhookFingerprint({
    provider,
    eventId,
    type: input.type,
    userId: providerUserId,
    email,
    planId: providerPlanId,
    amountUsd,
    paymentId,
    squareCustomerId,
    squareSubscriptionId,
    occurredAt,
  });

  const rpcArgs: ProviderSubscriptionWebhookAtomicArgs = {
    p_provider: provider,
    p_event_id: eventId,
    p_event_type: input.type,
    p_payload_sha256: fingerprint,
    p_user_id: userId,
    p_email: email,
    p_plan_id: planId,
    p_monthly_usd: monthlyUsd,
    p_amount_usd: amountUsd,
    p_payment_id: paymentId,
    p_square_customer_id: squareCustomerId,
    p_square_subscription_id: squareSubscriptionId,
    p_occurred_at: occurredAt,
    p_current_period_end: null,
  };

  const rawResult = await store.processAtomic(rpcArgs);
  const status = subscriptionStatusFor(input.type);
  const result = parseProviderAtomicResult(rawResult, {
    userId,
    planId,
    status,
  });
  if (!result) {
    throw new Error("Invalid subscription webhook RPC result");
  }

  if (result.processed && validatedPayment) {
    const sideEffectAt = occurredAt ?? dependencies.now().toISOString();

    dependencies.recordCharge({
      at: sideEffectAt,
      amountUsd: validatedPayment.amountUsd,
      status:
        input.type === "payment.succeeded" ? "SUCCESS" : "FAILED",
      email: email ?? undefined,
      planId,
      squarePaymentId: validatedPayment.paymentId,
    });

    if (input.type === "payment.succeeded") {
      dependencies.recordFunnel({
        type: "paid",
        planId,
        source: "webhook",
        email: email ?? undefined,
        at: sideEffectAt,
      });
    }
  }

  return {
    ok: true,
    processed: result.processed,
    replayed: result.replayed,
    skippedSubscription: result.skipped_subscription,
    userId: result.resolved_user_id,
    planId: result.resolved_plan_id,
    status: result.subscription_status,
  };
}

function resolveProviderWebhookPlan(input: {
  planId?: ZenciergePlanId | null;
  amountUsd: number;
}) {
  const planId =
    parsePlanId(input.planId) ??
    (input.amountUsd > 0 ? planFromUsdAmount(input.amountUsd) : "starter");
  return {
    planId,
    monthlyUsd: ZENCIERGE_PLANS[planId].monthlyUsd,
  };
}

function createProviderSubscriptionWebhookStore():
  ProviderSubscriptionWebhookStore {
  const admin = createSupabaseAdminClient();

  return {
    resolveUserId: (input) =>
      resolveUserId(admin, input.userId, input.email),
    async processAtomic(args) {
      const { data, error } = await admin.rpc(
        "process_subscription_webhook_atomic",
        args,
      );
      if (error) throw error;
      return data;
    },
  };
}

const DEFAULT_PROVIDER_SUBSCRIPTION_WEBHOOK_DEPENDENCIES:
  ProviderSubscriptionWebhookDependencies = {
    createStore: createProviderSubscriptionWebhookStore,
    resolvePlan: resolveProviderWebhookPlan,
    now: () => new Date(),
    recordCharge: recordSquareCharge,
    recordFunnel: recordFunnelEvent,
  };

function hasProviderWebhookEnvelope(
  input: SubscriptionWebhookInput | ProviderSubscriptionWebhookInput,
) {
  return (
    Object.prototype.hasOwnProperty.call(input, "provider") ||
    Object.prototype.hasOwnProperty.call(input, "eventId")
  );
}

export async function applySubscriptionWebhook(
  input: SubscriptionWebhookInput | ProviderSubscriptionWebhookInput,
) {
  if (hasProviderWebhookEnvelope(input)) {
    return applyProviderSubscriptionWebhook(
      input as ProviderSubscriptionWebhookInput,
    );
  }

  return applyLegacySubscriptionWebhook(input);
}

export function normalizeWebhookType(raw: string | undefined): SubscriptionWebhookEvent | null {
  const type = (raw ?? "").trim().toLowerCase();
  if (type === "payment.succeeded" || type === "invoice.paid") {
    return "payment.succeeded";
  }
  if (type === "payment.failed" || type === "invoice.payment_failed") {
    return "payment.failed";
  }
  if (type === "subscription.canceled" || type === "subscription.cancelled") {
    return "subscription.canceled";
  }
  return null;
}
