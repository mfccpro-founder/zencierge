export const SYSTEM_HEALTH_TIMEZONE = "America/New_York";
export const SYSTEM_HEALTH_TTS_WINDOW_HOURS = 24;
export const SYSTEM_HEALTH_SQUARE_WINDOW_DAYS = 30;
export const SYSTEM_HEALTH_SUPABASE_SLOW_MS = 2000;

export const SYSTEM_HEALTH_SERVICE_IDS = [
  "platform",
  "guest_stay",
  "isabela_text",
  "isabela_voice",
  "housekeeping",
  "secure_access",
  "supabase",
  "square_billing",
  "notifications",
] as const;

export type SystemHealthServiceId = (typeof SYSTEM_HEALTH_SERVICE_IDS)[number];

export type SystemHealthStatus = "healthy" | "degraded" | "down" | "unknown";

export const SYSTEM_HEALTH_SERVICE_LABELS: Record<SystemHealthServiceId, string> = {
  platform: "Zencierge Platform",
  guest_stay: "Guest Stay",
  isabela_text: "Isabela Text",
  isabela_voice: "Isabela Voice / TTS",
  housekeeping: "Housekeeping",
  secure_access: "Secure Access",
  supabase: "Supabase",
  square_billing: "Square Billing",
  notifications: "Notifications",
};

export type SystemHealthServiceCard = {
  id: SystemHealthServiceId;
  label: string;
  status: SystemHealthStatus;
  /** Founder-facing explanation — never secrets. */
  reason: string;
  /** ISO timestamp of this health evaluation. */
  checkedAt: string;
  /** Last observed product activity when known. */
  lastActivityAt: string | null;
  latencyMs: number | null;
  detailLines: string[];
};

export type SystemHealthHeader = {
  headline: string;
  healthyCount: number;
  degradedCount: number;
  downCount: number;
  unknownCount: number;
};

export type TtsHealthWindowStats = {
  windowHours: number;
  requests: number;
  successes: number;
  failures: number;
  successRatePercent: number | null;
  failureRatePercent: number | null;
  latestSuccessAt: string | null;
  latestFailureAt: string | null;
};

export type SquareHealthWindowStats = {
  windowDays: number;
  succeeded: number;
  failed: number;
  refunded: number;
  pastDueSubscriptions: number;
  canceledSubscriptions: number;
  latestPaymentAt: string | null;
  credentialsConfigured: boolean;
  mockCheckout: boolean;
};

/** Prefer canonical values; fall back to legacy values for legacy-origin rows. */
export function normalizeSquarePaymentState(row: Record<string, unknown>): string {
  return String(row.status ?? row.payment_status ?? "").toLowerCase();
}

/** Prefer canonical created_at; fall back to legacy paid_at. */
export function normalizeSquarePaymentAt(row: Record<string, unknown>): string {
  const at = row.created_at ?? row.paid_at;
  return typeof at === "string" ? at : at != null ? String(at) : "";
}

export function countSquarePaymentsFromRows(rows: Record<string, unknown>[]): {
  succeeded: number;
  failed: number;
  refunded: number;
  latestPaymentAt: string | null;
} {
  let succeeded = 0;
  let failed = 0;
  let refunded = 0;
  let latestPaymentAt: string | null = null;
  for (const row of rows) {
    const status = normalizeSquarePaymentState(row);
    const at = normalizeSquarePaymentAt(row);
    if (at && (!latestPaymentAt || at > latestPaymentAt)) latestPaymentAt = at;
    if (status === "succeeded" || status === "success" || status === "paid") succeeded += 1;
    else if (status === "refunded" || status.includes("refund")) refunded += 1;
    else if (/fail|declin|cancel/.test(status)) failed += 1;
  }
  return { succeeded, failed, refunded, latestPaymentAt };
}

export function roundPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function evaluateTtsHealth(stats: TtsHealthWindowStats): {
  status: SystemHealthStatus;
  reason: string;
  detailLines: string[];
  lastActivityAt: string | null;
} {
  const detailLines = [
    `Window: last ${stats.windowHours}h`,
    `TTS requests: ${stats.requests}`,
    `Successes: ${stats.successes}`,
    `Failures: ${stats.failures}`,
  ];
  if (stats.successRatePercent != null) {
    detailLines.push(`Success rate: ${stats.successRatePercent}%`);
  }
  if (stats.failureRatePercent != null) {
    detailLines.push(`Failure rate: ${stats.failureRatePercent}%`);
  }
  if (stats.latestSuccessAt) detailLines.push(`Latest success: ${stats.latestSuccessAt}`);
  if (stats.latestFailureAt) detailLines.push(`Latest failure: ${stats.latestFailureAt}`);

  const lastActivityAt = maxIso(stats.latestSuccessAt, stats.latestFailureAt);

  if (stats.requests === 0) {
    return {
      status: "unknown",
      reason: "No recent activity — no TTS events in the observation window",
      detailLines,
      lastActivityAt: null,
    };
  }

  const failureRate = stats.failureRatePercent ?? 0;
  if (stats.successes === 0 && stats.failures >= 5) {
    return {
      status: "down",
      reason: "All recent TTS attempts failed",
      detailLines,
      lastActivityAt,
    };
  }
  if (failureRate >= 50 || (stats.failures >= 3 && stats.successes === 0)) {
    return {
      status: "degraded",
      reason: "Elevated TTS failure rate in the recent window",
      detailLines,
      lastActivityAt,
    };
  }
  if (failureRate >= 20) {
    return {
      status: "degraded",
      reason: "Some TTS failures observed recently",
      detailLines,
      lastActivityAt,
    };
  }
  return {
    status: "healthy",
    reason: "Recent TTS successes with acceptable failure rate",
    detailLines,
    lastActivityAt,
  };
}

export function evaluateSquareHealth(stats: SquareHealthWindowStats): {
  status: SystemHealthStatus;
  reason: string;
  detailLines: string[];
  lastActivityAt: string | null;
} {
  const detailLines = [
    `Window: last ${stats.windowDays}d payments`,
    `Succeeded: ${stats.succeeded}`,
    `Failed cards/charges: ${stats.failed}`,
    `Refunded: ${stats.refunded}`,
    `Past due subscriptions: ${stats.pastDueSubscriptions}`,
    `Canceled subscriptions: ${stats.canceledSubscriptions}`,
  ];
  if (stats.latestPaymentAt) detailLines.push(`Latest payment activity: ${stats.latestPaymentAt}`);
  detailLines.push(
    stats.credentialsConfigured
      ? "Square credentials: configured"
      : stats.mockCheckout
        ? "Square: mock checkout mode"
        : "Square credentials: not configured",
  );
  detailLines.push("Note: an individual failed card is not Square Down.");

  const hasPaymentTraffic = stats.succeeded + stats.failed + stats.refunded > 0;

  if (!stats.credentialsConfigured && !hasPaymentTraffic) {
    return {
      status: "unknown",
      reason: stats.mockCheckout
        ? "No recent activity — Square mock mode; no live payment traffic observed"
        : "No recent activity — Square credentials not configured and no payment rows observed",
      detailLines,
      lastActivityAt: stats.latestPaymentAt,
    };
  }

  if (!hasPaymentTraffic) {
    return {
      status: "unknown",
      reason: "No recent activity — no payment rows in the observation window",
      detailLines,
      lastActivityAt: stats.latestPaymentAt,
    };
  }

  // Isolated or clustered card failures with ongoing succeeds = billing quality, not integration down.
  if (stats.succeeded > 0) {
    if (stats.failed > 0) {
      return {
        status: "degraded",
        reason: "Square integration receiving payments; some customer cards failed (not system Down)",
        detailLines,
        lastActivityAt: stats.latestPaymentAt,
      };
    }
    return {
      status: "healthy",
      reason: "Recent successful Square payment activity observed",
      detailLines,
      lastActivityAt: stats.latestPaymentAt,
    };
  }

  // Failures only — concerning but not proven "Square Down" without webhook observability.
  if (stats.failed >= 3) {
    return {
      status: "degraded",
      reason: "Only failed charges observed recently — investigate; not marked Down without integration proof",
      detailLines,
      lastActivityAt: stats.latestPaymentAt,
    };
  }

  return {
    status: "degraded",
    reason: "Payment activity without recent successes",
    detailLines,
    lastActivityAt: stats.latestPaymentAt,
  };
}

export function evaluateSupabaseProbe(input: {
  clientReady: boolean;
  queryOk: boolean;
  latencyMs: number | null;
  errorMessage: string | null;
}): { status: SystemHealthStatus; reason: string; detailLines: string[]; latencyMs: number | null } {
  if (!input.clientReady) {
    return {
      status: "down",
      reason: "Service role client unavailable",
      detailLines: ["Supabase admin client could not be created from env"],
      latencyMs: null,
    };
  }
  if (!input.queryOk) {
    return {
      status: "down",
      reason: "Database probe failed",
      detailLines: [sanitizePublicError(input.errorMessage) ?? "Read probe failed"],
      latencyMs: input.latencyMs,
    };
  }
  if (input.latencyMs != null && input.latencyMs > SYSTEM_HEALTH_SUPABASE_SLOW_MS) {
    return {
      status: "degraded",
      reason: "Database responding slowly",
      detailLines: [`Probe latency ${input.latencyMs}ms (threshold ${SYSTEM_HEALTH_SUPABASE_SLOW_MS}ms)`],
      latencyMs: input.latencyMs,
    };
  }
  return {
    status: "healthy",
    reason: "Lightweight read probe succeeded",
    detailLines: [
      input.latencyMs != null ? `Probe latency ${input.latencyMs}ms` : "Probe succeeded",
    ],
    latencyMs: input.latencyMs,
  };
}

export function evaluateDependencyUnknownService(input: {
  id: SystemHealthServiceId;
  supabaseStatus: SystemHealthStatus;
  reasonWhenDbOk: string;
}): { status: SystemHealthStatus; reason: string; detailLines: string[] } {
  if (input.supabaseStatus === "down") {
    return {
      status: "down",
      reason: "Depends on Supabase — database probe is down",
      detailLines: [input.reasonWhenDbOk],
    };
  }
  if (input.supabaseStatus === "degraded") {
    return {
      status: "degraded",
      reason: "Depends on Supabase — database probe is degraded",
      detailLines: [input.reasonWhenDbOk],
    };
  }
  return {
    status: "unknown",
    reason: input.reasonWhenDbOk,
    detailLines: ["No request metrics store yet — traffic is not inferred as healthy"],
  };
}

export function evaluateNotificationsConfig(input: {
  resendConfigured: boolean;
  twilioConfigured: boolean;
}): { status: SystemHealthStatus; reason: string; detailLines: string[] } {
  const detailLines = [
    `Resend email: ${input.resendConfigured ? "configured" : "not configured"}`,
    `Twilio SMS: ${input.twilioConfigured ? "configured" : "not configured"}`,
    "Delivery success/failure is not durably logged yet",
  ];
  if (!input.resendConfigured && !input.twilioConfigured) {
    return {
      status: "unknown",
      reason: "No recent activity — notification providers not configured",
      detailLines,
    };
  }
  return {
    status: "unknown",
    reason: "Configured; delivery log not instrumented — no recent activity proof",
    detailLines,
  };
}

export function evaluatePlatformHealth(input: {
  ttsGetOk: boolean | null;
  ttsGetLatencyMs: number | null;
  supabaseStatus: SystemHealthStatus;
}): { status: SystemHealthStatus; reason: string; detailLines: string[]; latencyMs: number | null } {
  const detailLines: string[] = ["Founder Back Office rendered successfully"];
  if (input.ttsGetOk === true) {
    detailLines.push(
      input.ttsGetLatencyMs != null
        ? `GET /api/tts ok in ${input.ttsGetLatencyMs}ms (no synthesis)`
        : "GET /api/tts ok (no synthesis)",
    );
  } else if (input.ttsGetOk === false) {
    detailLines.push("GET /api/tts probe failed (no synthesis attempted)");
  } else {
    detailLines.push("GET /api/tts probe skipped — no public app origin configured");
  }

  if (input.supabaseStatus === "down") {
    return {
      status: "degraded",
      reason: "App process up; Supabase dependency is down",
      detailLines,
      latencyMs: input.ttsGetLatencyMs,
    };
  }
  if (input.ttsGetOk === false) {
    return {
      status: "degraded",
      reason: "App up; soft TTS route probe failed",
      detailLines,
      latencyMs: input.ttsGetLatencyMs,
    };
  }
  return {
    status: "healthy",
    reason: "Application responding",
    detailLines,
    latencyMs: input.ttsGetLatencyMs,
  };
}

export function buildSystemHealthHeader(services: SystemHealthServiceCard[]): SystemHealthHeader {
  let healthyCount = 0;
  let degradedCount = 0;
  let downCount = 0;
  let unknownCount = 0;
  for (const service of services) {
    if (service.status === "healthy") healthyCount += 1;
    else if (service.status === "degraded") degradedCount += 1;
    else if (service.status === "down") downCount += 1;
    else unknownCount += 1;
  }
  const headline =
    degradedCount === 0 && downCount === 0 && unknownCount === 0
      ? "All Systems Operational"
      : [
          degradedCount > 0 ? `${degradedCount} Degraded` : null,
          downCount > 0 ? `${downCount} Down` : null,
          unknownCount > 0 ? `${unknownCount} Unknown` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return { headline, healthyCount, degradedCount, downCount, unknownCount };
}

export function aggregateTtsEvents(
  rows: { status: string; created_at: string }[],
  windowHours: number,
): TtsHealthWindowStats {
  let successes = 0;
  let failures = 0;
  let latestSuccessAt: string | null = null;
  let latestFailureAt: string | null = null;
  for (const row of rows) {
    const at = typeof row.created_at === "string" ? row.created_at : "";
    if (row.status === "success") {
      successes += 1;
      if (!latestSuccessAt || at > latestSuccessAt) latestSuccessAt = at;
    } else if (row.status === "failed") {
      failures += 1;
      if (!latestFailureAt || at > latestFailureAt) latestFailureAt = at;
    }
  }
  const requests = successes + failures;
  return {
    windowHours,
    requests,
    successes,
    failures,
    successRatePercent: roundPercent(successes, requests),
    failureRatePercent: roundPercent(failures, requests),
    latestSuccessAt,
    latestFailureAt,
  };
}

export function formatSystemHealthStatus(status: SystemHealthStatus): string {
  if (status === "healthy") return "Healthy";
  if (status === "degraded") return "Degraded";
  if (status === "down") return "Down";
  return "Unknown";
}

export function formatSystemHealthLatency(ms: number | null): string {
  if (ms == null) return "—";
  return `${ms} ms`;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/** Strip anything that might look like a secret from probe errors. */
export function sanitizePublicError(message: string | null | undefined): string | null {
  if (!message) return null;
  const trimmed = message.replace(/\s+/g, " ").trim().slice(0, 160);
  if (/service_role|api[_-]?key|bearer|password|token|secret|sb_secret/i.test(trimmed)) {
    return "Provider/config error (details redacted)";
  }
  return trimmed;
}
