import {
  parsePlanId,
  ZENCIERGE_PLANS,
  type ZenciergePlanId,
} from "@/lib/zencierge-plans";

export const COMPLIMENTARY_MONTH_PRESETS = [1, 3, 6, 12] as const;
export type ComplimentaryMonthPreset = (typeof COMPLIMENTARY_MONTH_PRESETS)[number];

export type ComplimentaryAction = "grant" | "extend" | "end";

export type SquareCompSafety =
  | { ok: true; code: "no_square_subscription" | "square_inactive_or_canceled" }
  | {
      ok: false;
      code: "active_square_subscription" | "past_due_square_subscription";
      message: string;
    };

export function addMonthsUtc(from: Date, months: number) {
  const end = new Date(from.getTime());
  end.setUTCMonth(end.getUTCMonth() + months);
  return end;
}

export function complimentaryEndsAtFromPreset(months: ComplimentaryMonthPreset, from = new Date()) {
  return addMonthsUtc(from, months).toISOString();
}

export function isComplimentaryWindowOpen(endsAt: string | null | undefined, now = new Date()) {
  if (typeof endsAt !== "string" || !endsAt.trim()) return false;
  const end = Date.parse(endsAt);
  return Number.isFinite(end) && end > now.getTime();
}

export function complimentaryDaysRemaining(endsAt: string | null | undefined, now = new Date()) {
  if (!isComplimentaryWindowOpen(endsAt, now)) return 0;
  const end = Date.parse(String(endsAt));
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

export function evaluateSquareCompSafety(input: {
  status?: string | null;
  squareSubscriptionId?: string | null;
}): SquareCompSafety {
  const squareSub = (input.squareSubscriptionId ?? "").trim();
  if (!squareSub) return { ok: true, code: "no_square_subscription" };

  const status = String(input.status ?? "").trim().toLowerCase();
  if (status === "active") {
    return {
      ok: false,
      code: "active_square_subscription",
      message:
        "This customer has an active Square subscription. Cancel or pause it in Square before granting complimentary access — this block will not modify Square automatically.",
    };
  }
  if (status === "past_due") {
    return {
      ok: false,
      code: "past_due_square_subscription",
      message:
        "This customer has a past-due Square subscription that may still retry charges. Resolve or cancel it in Square before granting complimentary access — this block will not modify Square automatically.",
    };
  }
  return { ok: true, code: "square_inactive_or_canceled" };
}

export function parseComplimentaryMonths(value: unknown): ComplimentaryMonthPreset | null {
  const n = typeof value === "number" ? value : Number(value);
  return (COMPLIMENTARY_MONTH_PRESETS as readonly number[]).includes(n)
    ? (n as ComplimentaryMonthPreset)
    : null;
}

export function resolveComplimentaryPlanId(
  preferred: unknown,
  fallback: unknown,
): ZenciergePlanId {
  return parsePlanId(preferred) ?? parsePlanId(fallback) ?? "starter";
}

export function complimentaryCatalogMonthlyUsd(planId: ZenciergePlanId) {
  return ZENCIERGE_PLANS[planId].monthlyUsd;
}
