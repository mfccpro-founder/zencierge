import { createSupabaseAdminClient, tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  complimentaryEndsAtFromPreset,
  evaluateSquareCompSafety,
  isComplimentaryWindowOpen,
  resolveComplimentaryPlanId,
  type ComplimentaryAction,
  type ComplimentaryMonthPreset,
} from "@/lib/complimentary-access-core";
import { ZENCIERGE_PLANS } from "@/lib/zencierge-plans";

export type {
  ComplimentaryAction,
  ComplimentaryMonthPreset,
  SquareCompSafety,
} from "@/lib/complimentary-access-core";
export {
  COMPLIMENTARY_MONTH_PRESETS,
  addMonthsUtc,
  complimentaryDaysRemaining,
  complimentaryEndsAtFromPreset,
  evaluateSquareCompSafety,
  isComplimentaryWindowOpen,
  parseComplimentaryMonths,
} from "@/lib/complimentary-access-core";

export type HostSubscriptionCompRow = {
  user_id: string;
  email: string | null;
  plan_id: string;
  status: string;
  monthly_usd: number;
  is_lifetime_free: boolean | null;
  square_customer_id: string | null;
  square_subscription_id: string | null;
  complimentary_starts_at: string | null;
  complimentary_ends_at: string | null;
  complimentary_granted_by: string | null;
  complimentary_granted_at: string | null;
};

function asIsoOrNull(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export async function loadHostSubscriptionComp(
  userId: string,
): Promise<
  | { kind: "ready"; row: HostSubscriptionCompRow | null }
  | { kind: "unavailable"; error: string }
> {
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return { kind: "unavailable", error: "Service role unavailable" };

  const { data, error } = await admin
    .from("host_subscriptions")
    .select(
      "user_id, email, plan_id, status, monthly_usd, is_lifetime_free, square_customer_id, square_subscription_id, complimentary_starts_at, complimentary_ends_at, complimentary_granted_by, complimentary_granted_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (/complimentary_|column|schema cache/i.test(error.message)) {
      return {
        kind: "unavailable",
        error:
          "Complimentary columns are missing. Apply migration 20260905220500_host_subscriptions_complimentary.sql.",
      };
    }
    return { kind: "unavailable", error: error.message };
  }

  return { kind: "ready", row: (data as HostSubscriptionCompRow | null) ?? null };
}

export type ApplyComplimentaryInput = {
  targetUserId: string;
  targetEmail?: string | null;
  actorUserId: string;
  action: ComplimentaryAction;
  planId?: string | null;
  months?: ComplimentaryMonthPreset | null;
  customEndsAt?: string | null;
  now?: Date;
};

export type ApplyComplimentaryResult =
  | { ok: true; row: HostSubscriptionCompRow }
  | { ok: false; status: number; error: string; code?: string };

/**
 * Founder-only mutation. Never calls Square. Refuses when an active/past_due
 * Square subscription would still be able to charge the customer.
 */
export async function applyComplimentaryAccess(
  input: ApplyComplimentaryInput,
): Promise<ApplyComplimentaryResult> {
  const now = input.now ?? new Date();
  const loaded = await loadHostSubscriptionComp(input.targetUserId);
  if (loaded.kind === "unavailable") {
    return { ok: false, status: 503, error: loaded.error, code: "schema_or_service" };
  }

  const existing = loaded.row;
  const safety = evaluateSquareCompSafety({
    status: existing?.status,
    squareSubscriptionId: existing?.square_subscription_id,
  });

  if (input.action === "grant" || input.action === "extend") {
    if (!safety.ok) {
      return { ok: false, status: 409, error: safety.message, code: safety.code };
    }
  }

  let endsAt: string | null = null;
  let startsAt: string | null = existing?.complimentary_starts_at ?? null;

  if (input.action === "end") {
    if (!existing) {
      return { ok: false, status: 404, error: "No subscription row to end.", code: "missing_subscription" };
    }
    endsAt = now.toISOString();
    if (!startsAt) startsAt = endsAt;
  } else {
    const custom = asIsoOrNull(input.customEndsAt);
    if (custom) {
      if (Date.parse(custom) <= now.getTime()) {
        return { ok: false, status: 400, error: "Custom expiration must be in the future." };
      }
      endsAt = custom;
    } else {
      const months = input.months ?? null;
      if (!months) {
        return { ok: false, status: 400, error: "Choose a duration preset or custom expiration." };
      }
      const base =
        input.action === "extend" && isComplimentaryWindowOpen(existing?.complimentary_ends_at, now)
          ? new Date(String(existing!.complimentary_ends_at))
          : now;
      endsAt = complimentaryEndsAtFromPreset(months, base);
    }
    if (!startsAt || input.action === "grant" || !isComplimentaryWindowOpen(existing?.complimentary_ends_at, now)) {
      startsAt = now.toISOString();
    }
  }

  const planId = resolveComplimentaryPlanId(input.planId, existing?.plan_id);
  const plan = ZENCIERGE_PLANS[planId];

  const admin = createSupabaseAdminClient();
  const row: Record<string, unknown> = {
    user_id: input.targetUserId,
    email: input.targetEmail?.trim().toLowerCase() || existing?.email || null,
    plan_id: planId,
    status: existing?.status && existing.status !== "active" ? existing.status : "inactive",
    monthly_usd: plan.monthlyUsd,
    is_lifetime_free: existing?.is_lifetime_free ?? false,
    square_customer_id: existing?.square_customer_id ?? null,
    square_subscription_id: existing?.square_subscription_id ?? null,
    complimentary_starts_at: startsAt,
    complimentary_ends_at: endsAt,
    complimentary_granted_by: input.actorUserId,
    complimentary_granted_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  if (input.action === "end" && existing?.status === "active") {
    row.status = "active";
    row.monthly_usd = Number(existing.monthly_usd ?? plan.monthlyUsd);
  }

  if ((input.action === "grant" || input.action === "extend") && existing?.status === "active") {
    return {
      ok: false,
      status: 409,
      error:
        "Customer subscription status is active. Resolve paid billing before granting complimentary access.",
      code: "active_local_status",
    };
  }

  const { data, error } = await admin
    .from("host_subscriptions")
    .upsert(row, { onConflict: "user_id" })
    .select(
      "user_id, email, plan_id, status, monthly_usd, is_lifetime_free, square_customer_id, square_subscription_id, complimentary_starts_at, complimentary_ends_at, complimentary_granted_by, complimentary_granted_at",
    )
    .single();

  if (error) {
    return { ok: false, status: 500, error: error.message, code: "upsert_failed" };
  }

  return { ok: true, row: data as HostSubscriptionCompRow };
}
