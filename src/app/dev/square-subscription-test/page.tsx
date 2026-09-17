import { notFound } from "next/navigation";
import { resolveSquareWebPaymentsPublicConfig } from "@/lib/square-web-payments-config";
import {
  billingPriceUsd,
  parseBillingCycle,
  parsePlanId,
  type BillingCycle,
  type ZenciergePlanId,
} from "@/lib/zencierge-plans";
import { createSupabaseRouteClient } from "@/lib/supabase-route";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  readSquareB4cAuthorizedIntentIdFromEnv,
  resolveB4cSingleEnrollAllowed,
} from "./b4c-single-enroll-gate";
import { SquareSubscriptionAuthStatus } from "./square-subscription-auth-status";
import { SquareSubscriptionTestClient } from "./square-subscription-test-client";

export const dynamic = "force-dynamic";

const UI_ONLY_INTENT_ID = "00000000-0000-4000-8000-0000000000b4";
const OPEN_INTENT_STATUSES = new Set([
  "pending",
  "customer_ready",
  "card_ready",
  "subscription_ready",
]);

export type B4cAuthorizedIntentCatalog = {
  planId: ZenciergePlanId;
  billingCycle: BillingCycle;
  amountUsd: number;
  displayLabel: string;
};

function isDevSandboxTestAllowed() {
  if (process.env.NODE_ENV === "production") return false;
  try {
    const config = resolveSquareWebPaymentsPublicConfig();
    return config.ok && config.sandbox && config.environment === "sandbox";
  } catch {
    return false;
  }
}

function maskId(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}…`;
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function formatIntentPlanLabel(
  planId: ZenciergePlanId,
  billingCycle: BillingCycle,
  amountUsd: number,
) {
  const planLabel = `${planId.slice(0, 1).toUpperCase()}${planId.slice(1)}`;
  const cycleLabel = billingCycle === "annual" ? "Annual" : "Monthly";
  return `${planLabel} · ${cycleLabel} · $${amountUsd}`;
}

async function loadIntentGateFields(intentId: string): Promise<{
  userId: string | null;
  status: string | null;
  expiresAt: string | null;
}> {
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) {
    return { userId: null, status: null, expiresAt: null };
  }
  const { data, error } = await admin
    .from("square_subscription_intents")
    .select("user_id, status, expires_at")
    .eq("id", intentId)
    .maybeSingle();
  if (error || !data) {
    return { userId: null, status: null, expiresAt: null };
  }
  return {
    userId: (data.user_id as string | null) ?? null,
    status: (data.status as string | null) ?? null,
    expiresAt: (data.expires_at as string | null) ?? null,
  };
}

function asNonblank(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loadAuthorizedIntentCatalog(input: {
  queryIntentId: string;
  sessionUserId: string | null;
  authorizedIntentId: string | null;
}): Promise<{
  catalog: B4cAuthorizedIntentCatalog | null;
  reason: string;
}> {
  if (!input.authorizedIntentId) {
    return { catalog: null, reason: "authorized_intent_unconfigured" };
  }
  if (input.queryIntentId.trim().toLowerCase() !== input.authorizedIntentId) {
    return { catalog: null, reason: "intent_not_authorized" };
  }

  const admin = tryCreateSupabaseAdminClient();
  if (!admin) {
    return { catalog: null, reason: "intent_unreadable" };
  }

  const { data, error } = await admin
    .from("square_subscription_intents")
    .select(
      "user_id, status, plan_id, billing_cycle, billing_amount_usd, square_environment, square_plan_variation_id",
    )
    .eq("id", input.authorizedIntentId)
    .maybeSingle();
  if (error || !data) {
    return { catalog: null, reason: "intent_missing" };
  }

  const ownerId = asNonblank(data.user_id);
  if (!ownerId) {
    return { catalog: null, reason: "intent_owner_missing" };
  }
  if (!input.sessionUserId || input.sessionUserId !== ownerId) {
    return { catalog: null, reason: "wrong_owner" };
  }

  const status = asNonblank(data.status);
  if (!status || !OPEN_INTENT_STATUSES.has(status)) {
    return { catalog: null, reason: "intent_not_open" };
  }

  if (asNonblank(data.square_environment) !== "sandbox") {
    return { catalog: null, reason: "intent_not_sandbox" };
  }

  const planId = parsePlanId(data.plan_id);
  const billingCycle = parseBillingCycle(data.billing_cycle);
  if (!planId || !billingCycle) {
    return { catalog: null, reason: "unsupported_plan_or_cycle" };
  }

  if (!asNonblank(data.square_plan_variation_id)) {
    return { catalog: null, reason: "variation_missing" };
  }

  const storedAmount = Number(data.billing_amount_usd);
  const configuredAmount = billingPriceUsd(planId, billingCycle);
  if (!Number.isFinite(storedAmount) || storedAmount !== configuredAmount) {
    return { catalog: null, reason: "amount_mismatch" };
  }

  return {
    catalog: {
      planId,
      billingCycle,
      amountUsd: configuredAmount,
      displayLabel: formatIntentPlanLabel(planId, billingCycle, configuredAmount),
    },
    reason: "ok",
  };
}

export default async function SquareSubscriptionTestPage({
  searchParams,
}: {
  searchParams: Promise<{ intentId?: string }>;
}) {
  if (!isDevSandboxTestAllowed()) {
    notFound();
  }

  const params = await searchParams;
  const authorizedIntentId = readSquareB4cAuthorizedIntentIdFromEnv();
  const queryIntentId = params.intentId?.trim() || "";
  const intentId = queryIntentId || UI_ONLY_INTENT_ID;
  const intentSource = queryIntentId ? "query" : "ui_only_placeholder";
  const enrollEnabled =
    intentSource === "query" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      intentId,
    ) &&
    intentId !== UI_ONLY_INTENT_ID;

  const config = resolveSquareWebPaymentsPublicConfig();
  if (!config.ok) {
    notFound();
  }

  const supabase = await createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let singleEnroll = {
    allowed: false,
    reason: "placeholder_or_invalid_intent",
  };

  if (enrollEnabled) {
    const intentFields = await loadIntentGateFields(intentId);
    singleEnroll = resolveB4cSingleEnrollAllowed({
      nodeEnv: process.env.NODE_ENV,
      squareEnvironment: process.env.SQUARE_ENVIRONMENT,
      intentId,
      authorizedIntentId,
      sessionUserId: user?.id ?? null,
      intentOwnerUserId: intentFields.userId,
      intentStatus: intentFields.status,
      expiresAt: intentFields.expiresAt,
    });
  }

  const authorizedCatalog = await loadAuthorizedIntentCatalog({
    queryIntentId,
    sessionUserId: user?.id ?? null,
    authorizedIntentId,
  });
  const authorizedIntentMatch = Boolean(
    authorizedIntentId &&
      queryIntentId.trim().toLowerCase() === authorizedIntentId,
  );

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-400">
            Dev · Sandbox only · B4C
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Square sandbox subscription enroll
          </h1>
          <p className="max-w-2xl text-sm text-slate-400">
            {authorizedCatalog.catalog
              ? `${authorizedCatalog.catalog.displayLabel} enroll via Web Payments.`
              : "Authorized intent plan unavailable."}{" "}
            Host Payment Link checkout remains unchanged. Production enroll
            paths are untouched.
          </p>
        </header>

        <p
          className="rounded-xl border border-amber-500/60 bg-amber-950/40 px-4 py-3 text-sm font-semibold text-amber-100"
          role="status"
        >
          Sandbox B4C only — one controlled enrollment attempt.
        </p>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Environment
              </dt>
              <dd className="font-medium text-emerald-300">{config.environment}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Plan
              </dt>
              <dd className="font-medium text-white">
                {authorizedCatalog.catalog
                  ? authorizedCatalog.catalog.displayLabel
                  : `Unavailable (${authorizedCatalog.reason})`}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Application ID (masked)
              </dt>
              <dd className="font-mono text-xs text-slate-200">
                {maskId(config.applicationId)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Location ID (masked)
              </dt>
              <dd className="font-mono text-xs text-slate-200">
                {maskId(config.locationId)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Intent ID
              </dt>
              <dd className="font-mono text-xs text-slate-200">
                {intentId}{" "}
                <span className="text-slate-500">({intentSource})</span>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Authorized enroll intent
              </dt>
              <dd className="font-mono text-xs text-slate-200">
                {authorizedIntentId
                  ? maskId(authorizedIntentId)
                  : "unconfigured"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Live enroll gate
              </dt>
              <dd className="font-mono text-xs text-slate-200">
                {singleEnroll.allowed
                  ? "open (manual Subscribe only)"
                  : `closed (${singleEnroll.reason})`}
              </dd>
            </div>
          </dl>
          {intentSource === "ui_only_placeholder" ? (
            <p className="mt-3 text-xs text-amber-200/90">
              Enroll disabled until a real intent is passed as{" "}
              <code className="text-amber-100">?intentId=&lt;uuid&gt;</code>.
            </p>
          ) : singleEnroll.allowed ? (
            <p className="mt-3 text-xs text-emerald-200/90">
              Live sandbox enroll unlocked. Click Subscribe once — no auto-retry.
            </p>
          ) : (
            <p className="mt-3 text-xs text-amber-200/90">
              Live enroll blocked — diagnostic-only tokenize remains available.
            </p>
          )}
        </section>

        <SquareSubscriptionAuthStatus
          intentId={intentId}
          enrollEnabled={enrollEnabled}
        />

        <SquareSubscriptionTestClient
          intentId={intentId}
          catalog={authorizedCatalog.catalog}
          enrollEnabled={enrollEnabled}
          singleEnrollEnabled={singleEnroll.allowed}
          authorizedIntentMatch={authorizedIntentMatch}
        />
      </div>
    </main>
  );
}
