import {
  SYSTEM_HEALTH_SERVICE_IDS,
  type SystemHealthServiceCard,
  type SystemHealthServiceId,
  type SystemHealthStatus,
} from "@/lib/admin-system-health-shared";

export const SYSTEM_HEALTH_ALERT_COOLDOWN_MS = 90 * 60 * 1000;
export const SYSTEM_HEALTH_ALERT_DOWN_CONSECUTIVE = 2;
export const SYSTEM_HEALTH_ALERT_DEGRADED_CONSECUTIVE = 3;

/**
 * Automatic Founder alert scheduler (Vercel Cron).
 * Keep false until production activation — see deploy/ALERTS_V1B_SCHEDULER.md.
 * Prepared cadence (not live): every 15 minutes (`SYSTEM_HEALTH_ALERTS_SCHEDULER_CRON`).
 */
export const SYSTEM_HEALTH_ALERTS_SCHEDULER_ENABLED = false;
export const SYSTEM_HEALTH_ALERTS_SCHEDULER_CRON = "*/15 * * * *";
export const SYSTEM_HEALTH_ALERTS_SCHEDULER_PATH = "/api/cron/system-health-alerts";

/** Dedicated non-UI service id for Founder Alerts email lifecycle tests. Never shown on System Health. */
export const SYNTHETIC_ALERT_TEST_SERVICE_ID = "synthetic_alert_test" as const;
export const SYNTHETIC_ALERT_TEST_REASON = "SYNTHETIC_FOUNDER_ALERT_TEST — ignore";

/** Services that may generate Founder emails in Alerts V1. */
export const SYSTEM_HEALTH_ALERTABLE_SERVICE_IDS = [
  "platform",
  "supabase",
  "isabela_voice",
  "square_billing",
] as const satisfies readonly SystemHealthServiceId[];

export type SystemHealthAlertableServiceId =
  (typeof SYSTEM_HEALTH_ALERTABLE_SERVICE_IDS)[number];

/** Production alertables + synthetic test id (state/email only — not System Health UI). */
export type SystemHealthAlertTrackedServiceId =
  | SystemHealthAlertableServiceId
  | typeof SYNTHETIC_ALERT_TEST_SERVICE_ID;

export type SystemHealthAlertKind = "opened" | "escalated" | "recovered";
export type SystemHealthAlertSeverity = "degraded" | "down" | "recovered";

export type SystemHealthAlertStateRow = {
  serviceId: SystemHealthAlertTrackedServiceId;
  lastStatus: SystemHealthStatus;
  consecutiveBad: number;
  lastAlertedAt: string | null;
  lastAlertKind: SystemHealthAlertKind | null;
  lastAlertSeverity: SystemHealthAlertSeverity | null;
  lastReason: string;
  lastRecoveredAt: string | null;
  updatedAt: string;
};

export type SystemHealthAlertDecision =
  | { action: "noop"; next: SystemHealthAlertStateRow; notify: null }
  | {
      action: "opened" | "escalated" | "recovered";
      next: SystemHealthAlertStateRow;
      notify: {
        kind: SystemHealthAlertKind;
        severity: SystemHealthAlertSeverity;
        serviceId: SystemHealthAlertTrackedServiceId;
        status: SystemHealthStatus;
        reason: string;
        checkedAt: string;
      };
    };

export function isSystemHealthAlertableServiceId(
  id: string,
): id is SystemHealthAlertableServiceId {
  return (SYSTEM_HEALTH_ALERTABLE_SERVICE_IDS as readonly string[]).includes(id);
}

export function isSystemHealthAlertTrackedServiceId(
  id: string,
): id is SystemHealthAlertTrackedServiceId {
  return (
    isSystemHealthAlertableServiceId(id) || id === SYNTHETIC_ALERT_TEST_SERVICE_ID
  );
}

export function isSyntheticAlertsAllowed(nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}

export function emptyAlertState(
  serviceId: SystemHealthAlertTrackedServiceId,
  nowIso: string,
): SystemHealthAlertStateRow {
  return {
    serviceId,
    lastStatus: "unknown",
    consecutiveBad: 0,
    lastAlertedAt: null,
    lastAlertKind: null,
    lastAlertSeverity: null,
    lastReason: "",
    lastRecoveredAt: null,
    updatedAt: nowIso,
  };
}

function isBadStatus(status: SystemHealthStatus): status is "degraded" | "down" {
  return status === "degraded" || status === "down";
}

function consecutiveThreshold(status: "degraded" | "down"): number {
  return status === "down"
    ? SYSTEM_HEALTH_ALERT_DOWN_CONSECUTIVE
    : SYSTEM_HEALTH_ALERT_DEGRADED_CONSECUTIVE;
}

/**
 * Square customer-card / billing-quality degradation is not a Founder platform incident.
 * Only down, or degraded reasons that indicate read/integration failure.
 */
export function isActionableAlertStatus(
  serviceId: SystemHealthAlertTrackedServiceId,
  status: SystemHealthStatus,
  reason: string,
): boolean {
  if (status === "unknown" || status === "healthy") return false;
  if (serviceId === SYNTHETIC_ALERT_TEST_SERVICE_ID) return isBadStatus(status);
  if (serviceId !== "square_billing") return isBadStatus(status);
  if (status === "down") return true;
  if (status === "degraded") {
    // Billing quality / customer cards — never Founder platform incident.
    if (
      /failed card|customer cards failed|not system [Dd]own|not marked [Dd]own|billing quality|only failed charges|without recent successes/i.test(
        reason,
      )
    ) {
      return false;
    }
    return /could not read|unreadable|service role unavailable|probe failed/i.test(reason);
  }
  return false;
}

function withinCooldown(
  prior: SystemHealthAlertStateRow,
  severity: SystemHealthAlertSeverity,
  nowMs: number,
): boolean {
  if (!prior.lastAlertedAt || !prior.lastAlertSeverity) return false;
  if (prior.lastAlertSeverity !== severity) return false;
  const last = Date.parse(prior.lastAlertedAt);
  if (!Number.isFinite(last)) return false;
  return nowMs - last < SYSTEM_HEALTH_ALERT_COOLDOWN_MS;
}

function hadOpenIncident(prior: SystemHealthAlertStateRow): boolean {
  return prior.lastAlertKind === "opened" || prior.lastAlertKind === "escalated";
}

/**
 * Pure evaluator — no I/O. One service evaluation for Alerts V1.
 */
export function evaluateSystemHealthAlertTransition(input: {
  serviceId: SystemHealthAlertTrackedServiceId;
  current: Pick<SystemHealthServiceCard, "status" | "reason" | "checkedAt">;
  prior: SystemHealthAlertStateRow | null;
  now?: Date;
}): SystemHealthAlertDecision {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const prior = input.prior ?? emptyAlertState(input.serviceId, nowIso);
  const status = input.current.status;
  const reason = (input.current.reason || "").trim().slice(0, 280);
  const checkedAt = input.current.checkedAt || nowIso;

  const baseNext: SystemHealthAlertStateRow = {
    ...prior,
    serviceId: input.serviceId,
    lastStatus: status,
    lastReason: reason,
    updatedAt: nowIso,
  };

  // Recovery path
  if (status === "healthy") {
    const nextHealthy: SystemHealthAlertStateRow = {
      ...baseNext,
      consecutiveBad: 0,
    };
    if (hadOpenIncident(prior) && isBadStatus(prior.lastStatus)) {
      return {
        action: "recovered",
        next: {
          ...nextHealthy,
          lastAlertedAt: nowIso,
          lastAlertKind: "recovered",
          lastAlertSeverity: "recovered",
          lastRecoveredAt: nowIso,
        },
        notify: {
          kind: "recovered",
          severity: "recovered",
          serviceId: input.serviceId,
          status: "healthy",
          reason: reason || "Service returned to healthy",
          checkedAt,
        },
      };
    }
    return {
      action: "noop",
      next: {
        ...nextHealthy,
        // Keep last alert metadata for history; consecutive reset.
      },
      notify: null,
    };
  }

  // unknown / non-actionable (e.g. Square customer-card degraded) — never alert; reset consecutive
  if (status === "unknown" || !isActionableAlertStatus(input.serviceId, status, reason)) {
    return {
      action: "noop",
      next: {
        ...baseNext,
        consecutiveBad: 0,
      },
      notify: null,
    };
  }

  // degraded / down actionable
  const consecutiveBad =
    isBadStatus(prior.lastStatus) &&
    isActionableAlertStatus(input.serviceId, prior.lastStatus, prior.lastReason)
      ? prior.consecutiveBad + 1
      : 1;

  const nextBad: SystemHealthAlertStateRow = {
    ...baseNext,
    consecutiveBad,
  };

  // Escalation: degraded → down may notify immediately even inside cooldown.
  if (prior.lastStatus === "degraded" && status === "down") {
    const canEscalate =
      hadOpenIncident(prior) || consecutiveBad >= SYSTEM_HEALTH_ALERT_DOWN_CONSECUTIVE;
    if (canEscalate) {
      return {
        action: "escalated",
        next: {
          ...nextBad,
          lastAlertedAt: nowIso,
          lastAlertKind: "escalated",
          lastAlertSeverity: "down",
        },
        notify: {
          kind: "escalated",
          severity: "down",
          serviceId: input.serviceId,
          status,
          reason,
          checkedAt,
        },
      };
    }
  }

  const needed = consecutiveThreshold(status);
  if (consecutiveBad < needed) {
    return { action: "noop", next: nextBad, notify: null };
  }

  if (withinCooldown(prior, status, nowMs)) {
    return { action: "noop", next: nextBad, notify: null };
  }

  return {
    action: "opened",
    next: {
      ...nextBad,
      lastAlertedAt: nowIso,
      lastAlertKind: "opened",
      lastAlertSeverity: status,
    },
    notify: {
      kind: "opened",
      severity: status,
      serviceId: input.serviceId,
      status,
      reason,
      checkedAt,
    },
  };
}

/** Short Founder-email names (card labels may be longer). */
const FOUNDER_ALERT_SERVICE_NAMES: Record<SystemHealthAlertTrackedServiceId, string> = {
  platform: "Platform",
  supabase: "Supabase",
  isabela_voice: "Isabela Voice",
  square_billing: "Square",
  synthetic_alert_test: "Synthetic Alert Test",
};

export function buildFounderAlertSubject(input: {
  kind: SystemHealthAlertKind;
  severity: SystemHealthAlertSeverity;
  serviceId: SystemHealthAlertTrackedServiceId;
}): string {
  const name = FOUNDER_ALERT_SERVICE_NAMES[input.serviceId];
  if (input.kind === "recovered") return `[Zencierge Recovered] ${name} Healthy`;
  if (input.severity === "down") return `[Zencierge Critical] ${name} Down`;
  return `[Zencierge Warning] ${name} Degraded`;
}

export function buildFounderAlertText(input: {
  kind: SystemHealthAlertKind;
  severity: SystemHealthAlertSeverity;
  serviceId: SystemHealthAlertTrackedServiceId;
  status: SystemHealthStatus;
  reason: string;
  checkedAt: string;
  systemUrl: string;
}): string {
  const name = FOUNDER_ALERT_SERVICE_NAMES[input.serviceId];
  const when = (() => {
    try {
      return new Date(input.checkedAt).toLocaleString("en-US", {
        timeZone: "America/New_York",
      });
    } catch {
      return input.checkedAt;
    }
  })();
  const sanitized = input.reason
    .replace(/service_role|api[_-]?key|bearer|password|token|secret|sb_secret/gi, "[redacted]")
    .slice(0, 280);

  return [
    `Zencierge System Health alert`,
    ``,
    `Service: ${name}`,
    `Status: ${input.status}`,
    `Severity: ${input.severity}`,
    `Event: ${input.kind}`,
    `Reason: ${sanitized || "—"}`,
    `Checked: ${when} (America/New_York)`,
    ``,
    `Open System Health: ${input.systemUrl}`,
    ``,
    `This message contains no guest tokens, access codes, passwords, or API keys.`,
  ].join("\n");
}

export function parseFounderAlertEmails(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.includes("@"));
}

/** Sanity: ensure we never treat observation-only services as alertable in V1. */
export function isObservationOnlyServiceId(id: SystemHealthServiceId): boolean {
  return !(SYSTEM_HEALTH_ALERTABLE_SERVICE_IDS as readonly string[]).includes(id);
}

export function allSystemHealthServiceIds(): readonly SystemHealthServiceId[] {
  return SYSTEM_HEALTH_SERVICE_IDS;
}
