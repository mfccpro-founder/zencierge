import {
  emptyAlertState,
  evaluateSystemHealthAlertTransition,
  isSyntheticAlertsAllowed,
  isSystemHealthAlertTrackedServiceId,
  SYNTHETIC_ALERT_TEST_REASON,
  SYNTHETIC_ALERT_TEST_SERVICE_ID,
  SYSTEM_HEALTH_ALERTABLE_SERVICE_IDS,
  SYSTEM_HEALTH_ALERTS_SCHEDULER_ENABLED,
  type SystemHealthAlertKind,
  type SystemHealthAlertSeverity,
  type SystemHealthAlertStateRow,
  type SystemHealthAlertTrackedServiceId,
  type SystemHealthAlertableServiceId,
} from "@/lib/admin-system-health-alerts-shared";
import { getAdminSystemHealthSnapshot } from "@/lib/admin-system-health";
import type { SystemHealthStatus } from "@/lib/admin-system-health-shared";
import { notifyFounderSystemHealth } from "@/lib/notify-founder-system-health";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";

/** Server-only Founder System Health Alerts. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("admin-system-health-alerts is server-only");
}

type DbAlertRow = {
  service_id: string;
  last_status: string;
  consecutive_bad: number;
  last_alerted_at: string | null;
  last_alert_kind: string | null;
  last_alert_severity: string | null;
  last_reason: string | null;
  last_recovered_at: string | null;
  updated_at: string;
};

function mapDbRow(row: DbAlertRow): SystemHealthAlertStateRow | null {
  if (!isSystemHealthAlertTrackedServiceId(row.service_id)) return null;
  const lastStatus = row.last_status as SystemHealthStatus;
  if (!["healthy", "degraded", "down", "unknown"].includes(lastStatus)) return null;
  const kind = row.last_alert_kind as SystemHealthAlertKind | null;
  const severity = row.last_alert_severity as SystemHealthAlertSeverity | null;
  return {
    serviceId: row.service_id,
    lastStatus,
    consecutiveBad: Math.max(0, Number(row.consecutive_bad) || 0),
    lastAlertedAt: row.last_alerted_at,
    lastAlertKind:
      kind === "opened" || kind === "escalated" || kind === "recovered" ? kind : null,
    lastAlertSeverity:
      severity === "degraded" || severity === "down" || severity === "recovered"
        ? severity
        : null,
    lastReason: (row.last_reason ?? "").slice(0, 280),
    lastRecoveredAt: row.last_recovered_at,
    updatedAt: row.updated_at,
  };
}

function toDbPayload(row: SystemHealthAlertStateRow) {
  return {
    service_id: row.serviceId,
    last_status: row.lastStatus,
    consecutive_bad: row.consecutiveBad,
    last_alerted_at: row.lastAlertedAt,
    last_alert_kind: row.lastAlertKind,
    last_alert_severity: row.lastAlertSeverity,
    last_reason: row.lastReason.slice(0, 280),
    last_recovered_at: row.lastRecoveredAt,
    updated_at: row.updatedAt,
  };
}

export type SystemHealthAlertRunResult = {
  generatedAt: string;
  serviceRoleReady: boolean;
  error: string | null;
  evaluated: number;
  notified: number;
  recovered: number;
  escalated: number;
  opened: number;
  unconfigured: number;
  emailFailures: number;
  syntheticMode: boolean;
  details: Array<{
    serviceId: SystemHealthAlertTrackedServiceId;
    action: "noop" | SystemHealthAlertKind;
    email?: "sent" | "unconfigured" | "failed" | "skipped";
  }>;
};

export type SystemHealthAlertSummary = {
  serviceRoleReady: boolean;
  error: string | null;
  /** Automatic Vercel Cron — false until intentionally activated. */
  schedulerEnabled: boolean;
  openIncidents: number;
  /** Latest durable state write across alertable services (any evaluation). */
  lastEvaluatedAt: string | null;
  /** Latest Founder alert email send (opened / escalated / recovered). */
  lastAlertedAt: string | null;
  lastAlertKind: SystemHealthAlertKind | null;
  rows: SystemHealthAlertStateRow[];
};

export type RunSystemHealthAlertsOptions = {
  now?: Date;
  /**
   * Non-production only. When set, evaluate ONLY the dedicated synthetic_alert_test
   * observation — never mutates System Health UI snapshot and never touches platform row.
   */
  syntheticObservation?: {
    status: Extract<SystemHealthStatus, "healthy" | "degraded" | "down">;
    reason?: string;
  };
};

async function loadAlertStates(): Promise<{
  ready: boolean;
  error: string | null;
  byId: Map<SystemHealthAlertTrackedServiceId, SystemHealthAlertStateRow>;
}> {
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) {
    return {
      ready: false,
      error: "SUPABASE_SERVICE_ROLE_KEY is not configured.",
      byId: new Map(),
    };
  }

  const { data, error } = await admin.from("system_health_alert_state").select(
    "service_id, last_status, consecutive_bad, last_alerted_at, last_alert_kind, last_alert_severity, last_reason, last_recovered_at, updated_at",
  );

  if (error) {
    return {
      ready: true,
      error: error.message.includes("system_health_alert_state")
        ? "system_health_alert_state table is missing. Apply migration 20260907001500_system_health_alert_state.sql."
        : error.message,
      byId: new Map(),
    };
  }

  const byId = new Map<SystemHealthAlertTrackedServiceId, SystemHealthAlertStateRow>();
  for (const raw of (data ?? []) as DbAlertRow[]) {
    const mapped = mapDbRow(raw);
    if (mapped) byId.set(mapped.serviceId, mapped);
  }
  return { ready: true, error: null, byId };
}

async function persistAlertState(row: SystemHealthAlertStateRow): Promise<string | null> {
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return "SUPABASE_SERVICE_ROLE_KEY is not configured.";
  const { error } = await admin.from("system_health_alert_state").upsert(toDbPayload(row), {
    onConflict: "service_id",
  });
  if (error) {
    console.warn("[founder-alerts] persist failed", row.serviceId, error.message);
    return error.message;
  }
  return null;
}

export async function deleteSyntheticAlertTestState(): Promise<{ ok: boolean; error: string | null }> {
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured." };
  const { error } = await admin
    .from("system_health_alert_state")
    .delete()
    .eq("service_id", SYNTHETIC_ALERT_TEST_SERVICE_ID);
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

export async function getSystemHealthAlertSummary(): Promise<SystemHealthAlertSummary> {
  const loaded = await loadAlertStates();
  const rows = [...loaded.byId.values()]
    .filter((row) => row.serviceId !== SYNTHETIC_ALERT_TEST_SERVICE_ID)
    .sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  let lastAlertedAt: string | null = null;
  let lastAlertKind: SystemHealthAlertKind | null = null;
  let lastEvaluatedAt: string | null = null;
  let openIncidents = 0;
  for (const row of rows) {
    if (row.lastAlertKind === "opened" || row.lastAlertKind === "escalated") {
      if (row.lastStatus === "degraded" || row.lastStatus === "down") openIncidents += 1;
    }
    if (row.lastAlertedAt) {
      if (!lastAlertedAt || Date.parse(row.lastAlertedAt) > Date.parse(lastAlertedAt)) {
        lastAlertedAt = row.lastAlertedAt;
        lastAlertKind = row.lastAlertKind;
      }
    }
    if (row.updatedAt) {
      if (!lastEvaluatedAt || Date.parse(row.updatedAt) > Date.parse(lastEvaluatedAt)) {
        lastEvaluatedAt = row.updatedAt;
      }
    }
  }
  return {
    serviceRoleReady: loaded.ready,
    error: loaded.error,
    schedulerEnabled: SYSTEM_HEALTH_ALERTS_SCHEDULER_ENABLED,
    openIncidents,
    lastEvaluatedAt,
    lastAlertedAt,
    lastAlertKind,
    rows,
  };
}

async function evaluateOneService(input: {
  serviceId: SystemHealthAlertTrackedServiceId;
  status: SystemHealthStatus;
  reason: string;
  checkedAt: string;
  prior: SystemHealthAlertStateRow | null;
  now: Date;
  result: SystemHealthAlertRunResult;
}): Promise<void> {
  const { serviceId, status, reason, checkedAt, prior, now, result } = input;
  result.evaluated += 1;
  const decision = evaluateSystemHealthAlertTransition({
    serviceId,
    current: { status, reason, checkedAt },
    prior,
    now,
  });

  let next = decision.next;
  let email: "sent" | "unconfigured" | "failed" | "skipped" = "skipped";

  if (decision.notify) {
    try {
      const notifyResult = await notifyFounderSystemHealth(decision.notify);
      if (notifyResult.ok && notifyResult.delivered) {
        email = "sent";
        result.notified += 1;
      } else if (notifyResult.ok && "unconfigured" in notifyResult && notifyResult.unconfigured) {
        email = "unconfigured";
        result.unconfigured += 1;
      } else {
        email = "failed";
        result.emailFailures += 1;
        next = {
          ...decision.next,
          lastAlertedAt: prior?.lastAlertedAt ?? null,
          lastAlertKind: prior?.lastAlertKind ?? null,
          lastAlertSeverity: prior?.lastAlertSeverity ?? null,
          lastRecoveredAt: prior?.lastRecoveredAt ?? null,
        };
      }
    } catch (cause) {
      email = "failed";
      result.emailFailures += 1;
      console.warn("[founder-alerts] notify threw", serviceId, cause);
      next = {
        ...decision.next,
        lastAlertedAt: prior?.lastAlertedAt ?? null,
        lastAlertKind: prior?.lastAlertKind ?? null,
        lastAlertSeverity: prior?.lastAlertSeverity ?? null,
        lastRecoveredAt: prior?.lastRecoveredAt ?? null,
      };
    }
  }

  const persistError = await persistAlertState(next);
  if (persistError && !result.error) {
    result.error = persistError;
  }

  if (decision.action === "opened") result.opened += 1;
  if (decision.action === "escalated") result.escalated += 1;
  if (decision.action === "recovered") result.recovered += 1;

  result.details.push({
    serviceId,
    action: decision.action,
    email,
  });
}

/**
 * Evaluate System Health snapshot against durable alert state and notify Founders when required.
 * Email failures do not throw; state may be retried on the next cron tick.
 */
export async function runSystemHealthAlertsEvaluation(
  options: RunSystemHealthAlertsOptions = {},
): Promise<SystemHealthAlertRunResult> {
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const result: SystemHealthAlertRunResult = {
    generatedAt,
    serviceRoleReady: false,
    error: null,
    evaluated: 0,
    notified: 0,
    recovered: 0,
    escalated: 0,
    opened: 0,
    unconfigured: 0,
    emailFailures: 0,
    syntheticMode: Boolean(options.syntheticObservation),
    details: [],
  };

  if (options.syntheticObservation) {
    if (!isSyntheticAlertsAllowed()) {
      result.error = "Synthetic Founder alert observations are disabled in production.";
      return result;
    }
  }

  const loaded = await loadAlertStates();
  result.serviceRoleReady = loaded.ready;
  if (loaded.error) {
    result.error = loaded.error;
    return result;
  }
  if (!loaded.ready) {
    result.error = "SUPABASE_SERVICE_ROLE_KEY is not configured.";
    return result;
  }

  // Synthetic-only path: never touches live System Health cards or platform state.
  if (options.syntheticObservation) {
    const status = options.syntheticObservation.status;
    const reason = (options.syntheticObservation.reason || SYNTHETIC_ALERT_TEST_REASON).trim();
    await evaluateOneService({
      serviceId: SYNTHETIC_ALERT_TEST_SERVICE_ID,
      status,
      reason,
      checkedAt: generatedAt,
      prior: loaded.byId.get(SYNTHETIC_ALERT_TEST_SERVICE_ID) ?? null,
      now,
      result,
    });
    return result;
  }

  let snapshot;
  try {
    snapshot = await getAdminSystemHealthSnapshot(now);
  } catch (cause) {
    result.error = cause instanceof Error ? cause.message : "System Health snapshot failed";
    return result;
  }

  for (const serviceId of SYSTEM_HEALTH_ALERTABLE_SERVICE_IDS) {
    const card = snapshot.services.find((service) => service.id === serviceId);
    if (!card) continue;

    await evaluateOneService({
      serviceId,
      status: card.status,
      reason: card.reason,
      checkedAt: card.checkedAt,
      prior: loaded.byId.get(serviceId) ?? null,
      now,
      result,
    });
  }

  return result;
}

export function emptyAlertStateForTests(
  serviceId: SystemHealthAlertableServiceId | typeof SYNTHETIC_ALERT_TEST_SERVICE_ID,
  nowIso: string,
): SystemHealthAlertStateRow {
  return emptyAlertState(serviceId, nowIso);
}
