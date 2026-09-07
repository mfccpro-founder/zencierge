import {
  aggregateTtsEvents,
  buildSystemHealthHeader,
  countSquarePaymentsFromRows,
  evaluateDependencyUnknownService,
  evaluateNotificationsConfig,
  evaluatePlatformHealth,
  evaluateSquareHealth,
  evaluateSupabaseProbe,
  evaluateTtsHealth,
  sanitizePublicError,
  SYSTEM_HEALTH_SERVICE_IDS,
  SYSTEM_HEALTH_SERVICE_LABELS,
  SYSTEM_HEALTH_SQUARE_WINDOW_DAYS,
  SYSTEM_HEALTH_TIMEZONE,
  SYSTEM_HEALTH_TTS_WINDOW_HOURS,
  type SquareHealthWindowStats,
  type SystemHealthHeader,
  type SystemHealthServiceCard,
  type SystemHealthStatus,
} from "@/lib/admin-system-health-shared";
import { configuredPublicOrigin } from "@/lib/public-app-url";
import { hasUsableSquareCredentials, preferMockSquareCheckout } from "@/lib/square-checkout";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";

/** Server-only Founder System Health. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("admin-system-health is server-only");
}

export type AdminSystemHealthSnapshot = {
  generatedAt: string;
  timeZone: typeof SYSTEM_HEALTH_TIMEZONE;
  serviceRoleReady: boolean;
  error: string | null;
  header: SystemHealthHeader;
  services: SystemHealthServiceCard[];
};

function twilioConfigured(): boolean {
  const sid = (process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN ?? process.env.TWILIO_API_KEY ?? "").trim();
  const from = (process.env.TWILIO_FROM_NUMBER ?? process.env.TWILIO_PHONE_NUMBER ?? "").trim();
  return Boolean(sid && token && from);
}

function resendConfigured(): boolean {
  return Boolean((process.env.RESEND_API_KEY || "").trim());
}

function card(
  id: (typeof SYSTEM_HEALTH_SERVICE_IDS)[number],
  partial: Omit<SystemHealthServiceCard, "id" | "label">,
): SystemHealthServiceCard {
  return {
    id,
    label: SYSTEM_HEALTH_SERVICE_LABELS[id],
    ...partial,
  };
}

async function probeSupabase(): Promise<{
  clientReady: boolean;
  queryOk: boolean;
  latencyMs: number | null;
  errorMessage: string | null;
}> {
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) {
    return { clientReady: false, queryOk: false, latencyMs: null, errorMessage: null };
  }
  const started = Date.now();
  const { error } = await admin.from("host_subscriptions").select("user_id").limit(1);
  const latencyMs = Date.now() - started;
  if (error) {
    return {
      clientReady: true,
      queryOk: false,
      latencyMs,
      errorMessage: error.message,
    };
  }
  return { clientReady: true, queryOk: true, latencyMs, errorMessage: null };
}

async function probeTtsGet(): Promise<{ ok: boolean | null; latencyMs: number | null }> {
  const origin = configuredPublicOrigin();
  if (!origin) return { ok: null, latencyMs: null };
  const started = Date.now();
  try {
    const response = await fetch(`${origin}/api/tts`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) return { ok: false, latencyMs };
    const body = (await response.json().catch(() => null)) as { status?: string } | null;
    return { ok: body?.status === "ok", latencyMs };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

async function loadTtsWindow(admin: NonNullable<ReturnType<typeof tryCreateSupabaseAdminClient>>) {
  const since = new Date(Date.now() - SYSTEM_HEALTH_TTS_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("ai_usage_events")
    .select("status, created_at, operation")
    .eq("operation", "tts")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return {
      error: error.message,
      stats: aggregateTtsEvents([], SYSTEM_HEALTH_TTS_WINDOW_HOURS),
    };
  }

  const rows = ((data ?? []) as { status?: string; created_at?: string; operation?: string }[])
    .filter((row) => row.operation === "tts")
    .map((row) => ({
      status: String(row.status ?? ""),
      created_at: String(row.created_at ?? ""),
    }));

  return { error: null as string | null, stats: aggregateTtsEvents(rows, SYSTEM_HEALTH_TTS_WINDOW_HOURS) };
}

/** Live-compatible first; documented schema.sql names as fallback. Never hard-require `.status`. */
const SQUARE_PAYMENT_READ_ATTEMPTS = [
  { columns: "payment_status, amount_paid, paid_at", timeCol: "paid_at" as const },
  { columns: "payment_status, paid_at", timeCol: "paid_at" as const },
  { columns: "status, amount_usd, created_at", timeCol: "created_at" as const },
  { columns: "status, created_at", timeCol: "created_at" as const },
];

async function loadSubscriptionPaymentsTolerant(
  admin: NonNullable<ReturnType<typeof tryCreateSupabaseAdminClient>>,
  sinceIso: string,
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  let lastError: string | null = null;
  for (const attempt of SQUARE_PAYMENT_READ_ATTEMPTS) {
    const { data, error } = await admin
      .from("subscription_payments")
      .select(attempt.columns)
      .gte(attempt.timeCol, sinceIso)
      .order(attempt.timeCol, { ascending: false })
      .limit(500);
    if (!error) {
      return { rows: (data ?? []) as unknown as Record<string, unknown>[], error: null };
    }
    lastError = error.message;
    if (!/column|schema cache|does not exist/i.test(error.message)) {
      return { rows: [], error: lastError };
    }
  }
  return { rows: [], error: lastError };
}

async function loadSquareWindow(admin: NonNullable<ReturnType<typeof tryCreateSupabaseAdminClient>>) {
  const since = new Date(
    Date.now() - SYSTEM_HEALTH_SQUARE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [paymentsLoad, subsResult] = await Promise.all([
    loadSubscriptionPaymentsTolerant(admin, since),
    admin.from("host_subscriptions").select("status"),
  ]);

  if (paymentsLoad.error) {
    return { error: paymentsLoad.error, stats: null as SquareHealthWindowStats | null };
  }

  const paymentCounts = countSquarePaymentsFromRows(paymentsLoad.rows);

  let pastDueSubscriptions = 0;
  let canceledSubscriptions = 0;
  if (!subsResult.error) {
    for (const row of (subsResult.data ?? []) as Record<string, unknown>[]) {
      const status = String(row.status ?? "").toLowerCase();
      if (status === "past_due") pastDueSubscriptions += 1;
      if (status === "canceled" || status === "cancelled") canceledSubscriptions += 1;
    }
  }

  const stats: SquareHealthWindowStats = {
    windowDays: SYSTEM_HEALTH_SQUARE_WINDOW_DAYS,
    succeeded: paymentCounts.succeeded,
    failed: paymentCounts.failed,
    refunded: paymentCounts.refunded,
    pastDueSubscriptions,
    canceledSubscriptions,
    latestPaymentAt: paymentCounts.latestPaymentAt,
    credentialsConfigured: hasUsableSquareCredentials(),
    mockCheckout: preferMockSquareCheckout(),
  };
  return { error: null as string | null, stats };
}

export async function getAdminSystemHealthSnapshot(now = new Date()): Promise<AdminSystemHealthSnapshot> {
  const checkedAt = now.toISOString();
  const [supabaseProbe, ttsGet] = await Promise.all([probeSupabase(), probeTtsGet()]);
  const supabaseEval = evaluateSupabaseProbe(supabaseProbe);
  const platformEval = evaluatePlatformHealth({
    ttsGetOk: ttsGet.ok,
    ttsGetLatencyMs: ttsGet.latencyMs,
    supabaseStatus: supabaseEval.status,
  });

  const admin = tryCreateSupabaseAdminClient();
  let voiceCard: SystemHealthServiceCard;
  let squareCard: SystemHealthServiceCard;
  let loadError: string | null = null;

  if (!admin) {
    voiceCard = card("isabela_voice", {
      status: "down",
      reason: "Cannot read ai_usage_events — service role unavailable",
      checkedAt,
      lastActivityAt: null,
      latencyMs: null,
      detailLines: ["Passive TTS health requires Supabase admin reads"],
    });
    squareCard = card("square_billing", {
      status: "down",
      reason: "Cannot read payment tables — service role unavailable",
      checkedAt,
      lastActivityAt: null,
      latencyMs: null,
      detailLines: ["Square health uses subscription_payments / host_subscriptions"],
    });
  } else {
    const [ttsLoad, squareLoad] = await Promise.all([loadTtsWindow(admin), loadSquareWindow(admin)]);
    if (ttsLoad.error) {
      loadError = sanitizePublicError(ttsLoad.error);
      voiceCard = card("isabela_voice", {
        status: "degraded",
        reason: "Could not read TTS usage events",
        checkedAt,
        lastActivityAt: null,
        latencyMs: null,
        detailLines: [loadError ?? "ai_usage_events unreadable"],
      });
    } else {
      const voice = evaluateTtsHealth(ttsLoad.stats);
      voiceCard = card("isabela_voice", {
        status: voice.status,
        reason: voice.reason,
        checkedAt,
        lastActivityAt: voice.lastActivityAt,
        latencyMs: null,
        detailLines: voice.detailLines,
      });
    }

    if (squareLoad.error || !squareLoad.stats) {
      loadError = loadError ?? sanitizePublicError(squareLoad.error);
      squareCard = card("square_billing", {
        status: "degraded",
        reason: "Could not read Square payment records",
        checkedAt,
        lastActivityAt: null,
        latencyMs: null,
        detailLines: [sanitizePublicError(squareLoad.error) ?? "subscription_payments unreadable"],
      });
    } else {
      const square = evaluateSquareHealth(squareLoad.stats);
      squareCard = card("square_billing", {
        status: square.status,
        reason: square.reason,
        checkedAt,
        lastActivityAt: square.lastActivityAt,
        latencyMs: null,
        detailLines: square.detailLines,
      });
    }
  }

  const guest = evaluateDependencyUnknownService({
    id: "guest_stay",
    supabaseStatus: supabaseEval.status,
    reasonWhenDbOk: "No recent activity — Guest Stay request metrics are not stored yet",
  });
  const text = evaluateDependencyUnknownService({
    id: "isabela_text",
    supabaseStatus: supabaseEval.status,
    reasonWhenDbOk:
      "No recent activity — Isabela Text is secure-policy (no paid LLM); request metrics not stored yet",
  });
  const hk = evaluateDependencyUnknownService({
    id: "housekeeping",
    supabaseStatus: supabaseEval.status,
    reasonWhenDbOk: "No recent activity — Housekeeping proof metrics are not aggregated yet",
  });
  const access = evaluateDependencyUnknownService({
    id: "secure_access",
    supabaseStatus: supabaseEval.status,
    reasonWhenDbOk:
      "No recent activity — Secure Access depends on stay tokens + DB; access metrics not stored (codes never shown)",
  });
  const notify = evaluateNotificationsConfig({
    resendConfigured: resendConfigured(),
    twilioConfigured: twilioConfigured(),
  });

  const services: SystemHealthServiceCard[] = [
    card("platform", {
      status: platformEval.status,
      reason: platformEval.reason,
      checkedAt,
      lastActivityAt: checkedAt,
      latencyMs: platformEval.latencyMs,
      detailLines: platformEval.detailLines,
    }),
    card("guest_stay", {
      status: guest.status,
      reason: guest.reason,
      checkedAt,
      lastActivityAt: null,
      latencyMs: null,
      detailLines: guest.detailLines,
    }),
    card("isabela_text", {
      status: text.status,
      reason: text.reason,
      checkedAt,
      lastActivityAt: null,
      latencyMs: null,
      detailLines: text.detailLines,
    }),
    voiceCard,
    card("housekeeping", {
      status: hk.status,
      reason: hk.reason,
      checkedAt,
      lastActivityAt: null,
      latencyMs: null,
      detailLines: hk.detailLines,
    }),
    card("secure_access", {
      status: access.status,
      reason: access.reason,
      checkedAt,
      lastActivityAt: null,
      latencyMs: null,
      detailLines: access.detailLines,
    }),
    card("supabase", {
      status: supabaseEval.status,
      reason: supabaseEval.reason,
      checkedAt,
      lastActivityAt: checkedAt,
      latencyMs: supabaseEval.latencyMs,
      detailLines: supabaseEval.detailLines,
    }),
    squareCard,
    card("notifications", {
      status: notify.status,
      reason: notify.reason,
      checkedAt,
      lastActivityAt: null,
      latencyMs: null,
      detailLines: notify.detailLines,
    }),
  ];

  return {
    generatedAt: checkedAt,
    timeZone: SYSTEM_HEALTH_TIMEZONE,
    serviceRoleReady: Boolean(admin),
    error: loadError,
    header: buildSystemHealthHeader(services),
    services,
  };
}

export function summarizeSystemHealthForOverview(snapshot: AdminSystemHealthSnapshot): {
  headline: string;
  statusTone: SystemHealthStatus;
} {
  const { header } = snapshot;
  let statusTone: SystemHealthStatus = "healthy";
  if (header.downCount > 0) statusTone = "down";
  else if (header.degradedCount > 0) statusTone = "degraded";
  else if (header.unknownCount > 0) statusTone = "unknown";
  return { headline: header.headline, statusTone };
}

export {
  SYSTEM_HEALTH_SERVICE_IDS,
  formatSystemHealthLatency,
  formatSystemHealthStatus,
  evaluateTtsHealth,
  evaluateSquareHealth,
  buildSystemHealthHeader,
  countSquarePaymentsFromRows,
  normalizeSquarePaymentState,
  normalizeSquarePaymentAt,
} from "@/lib/admin-system-health-shared";
