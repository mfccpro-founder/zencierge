export const ZENCIERGE_PLAN_IDS = ["starter", "pro", "portfolio", "agency"] as const;

export type ZenciergePlanId = (typeof ZENCIERGE_PLAN_IDS)[number];

export type ZenciergePlan = {
  id: ZenciergePlanId;
  name: string;
  monthlyUsd: number;
  maxProperties: number;
  blurb: string;
  featured?: boolean;
  /** Shown on Portfolio / Agency so Pro features (including AirCover) are inherited. */
  includesPrior?: string;
  features: string[];
};

const AIRCOVER = "AirCover PDF Vault & Dispute Dossier";

export const ZENCIERGE_PLANS: Record<ZenciergePlanId, ZenciergePlan> = {
  starter: {
    id: "starter",
    name: "Starter Host",
    monthlyUsd: 49,
    maxProperties: 1,
    blurb: "Autonomous operations for single-property self-managers.",
    features: ["1 Listing Included", "1 AI Voice Line (24/7)", "AI Turnover Auditing", "True-Net NOI Ledger"],
  },
  pro: {
    id: "pro",
    name: "Pro Superhost",
    monthlyUsd: 99,
    maxProperties: 4,
    blurb: "Zero co-host dependency for growing multi-unit hosts.",
    features: ["Up to 4 Listings", "4 AI Voice Lines", AIRCOVER, "Cleaner Escrow Release"],
  },
  portfolio: {
    id: "portfolio",
    name: "Portfolio Host",
    monthlyUsd: 149,
    maxProperties: 8,
    featured: true,
    blurb: "Full autonomous fleet operations for serious real estate portfolios.",
    includesPrior: "Includes everything in Pro Superhost, plus:",
    features: [
      "Up to 8 Listings",
      "8 Dedicated AI Lines",
      AIRCOVER,
      "Unlimited Vision Tokens",
      "Automated Smart Lock Sync",
    ],
  },
  agency: {
    id: "agency",
    name: "Co-Host Agency",
    monthlyUsd: 199,
    maxProperties: 20,
    blurb: "Scale boutique co-hosting agency operations with zero staff overhead.",
    includesPrior: "Includes everything in Pro Superhost, plus:",
    features: [
      "Up to 20 Listings",
      AIRCOVER,
      "White-label Statements",
      "Multi-Team Call Routing",
      "Priority 24/7 Founder Support",
    ],
  },
};

export function parsePlanId(value: unknown): ZenciergePlanId | null {
  if (typeof value !== "string") return null;
  return (ZENCIERGE_PLAN_IDS as readonly string[]).includes(value) ? (value as ZenciergePlanId) : null;
}

export function planFromMetadata(meta: Record<string, unknown> | null | undefined): ZenciergePlanId {
  return parsePlanId(meta?.plan) ?? "starter";
}

export function planFromUsdAmount(amountUsd: number): ZenciergePlanId {
  if (amountUsd >= 180) return "agency";
  if (amountUsd >= 140) return "portfolio";
  if (amountUsd >= 90) return "pro";
  return "starter";
}

export function isPaidSubscriptionStatus(status: string | null | undefined) {
  return status === "active";
}

export const TRIAL_DAYS = 14;

export function trialEndsAtIso(from = new Date()) {
  const end = new Date(from);
  end.setUTCDate(end.getUTCDate() + TRIAL_DAYS);
  return end.toISOString();
}

export function isTrialWindowOpen(trialEndsAt: unknown, now = new Date()) {
  if (typeof trialEndsAt !== "string" || !trialEndsAt.trim()) return false;
  const end = Date.parse(trialEndsAt);
  return Number.isFinite(end) && end > now.getTime();
}

export function trialDaysRemaining(trialEndsAt: unknown, now = new Date()) {
  if (!isTrialWindowOpen(trialEndsAt, now)) return 0;
  const end = Date.parse(String(trialEndsAt));
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

export function buildTrialMetadata(planId: ZenciergePlanId, extra: Record<string, unknown> = {}) {
  const started = new Date().toISOString();
  return {
    ...extra,
    plan: planId,
    subscription_status: "trial",
    trial_started_at: started,
    trial_ends_at: trialEndsAtIso(new Date(started)),
  };
}

export function isHostAccessGranted(input: {
  subscriptionStatus?: string | null;
  metadata?: Record<string, unknown> | null;
  complimentaryEndsAt?: string | null;
  isLifetimeFree?: boolean | null;
  lifetimeVip?: boolean | null;
}) {
  const meta = input.metadata ?? {};
  const status = String(input.subscriptionStatus ?? meta.subscription_status ?? "");
  if (input.lifetimeVip === true) return true;
  if (input.isLifetimeFree === true) return true;
  if (isPaidSubscriptionStatus(status)) return true;
  if (isComplimentaryEndsOpen(input.complimentaryEndsAt)) return true;
  // Public 14-day trial: server-side window only. Never treat bare status "trial" as permanent.
  if (isTrialWindowOpen(meta.trial_ends_at)) return true;
  return false;
}

function isComplimentaryEndsOpen(endsAt: string | null | undefined) {
  if (typeof endsAt !== "string" || !endsAt.trim()) return false;
  const end = Date.parse(endsAt);
  return Number.isFinite(end) && end > Date.now();
}
