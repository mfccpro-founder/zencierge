import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SYSTEM_HEALTH_ALERT_COOLDOWN_MS,
  SYSTEM_HEALTH_ALERT_DEGRADED_CONSECUTIVE,
  SYSTEM_HEALTH_ALERT_DOWN_CONSECUTIVE,
  SYSTEM_HEALTH_ALERTABLE_SERVICE_IDS,
  SYSTEM_HEALTH_ALERTS_SCHEDULER_CRON,
  SYSTEM_HEALTH_ALERTS_SCHEDULER_ENABLED,
  SYSTEM_HEALTH_ALERTS_SCHEDULER_PATH,
  SYNTHETIC_ALERT_TEST_SERVICE_ID,
  buildFounderAlertSubject,
  buildFounderAlertText,
  emptyAlertState,
  evaluateSystemHealthAlertTransition,
  isActionableAlertStatus,
  isObservationOnlyServiceId,
  isSyntheticAlertsAllowed,
  parseFounderAlertEmails,
  type SystemHealthAlertStateRow,
} from "./admin-system-health-alerts-shared";
import { SYSTEM_HEALTH_SERVICE_IDS } from "./admin-system-health-shared";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function priorOpened(
  partial: Partial<SystemHealthAlertStateRow> & Pick<SystemHealthAlertStateRow, "serviceId">,
): SystemHealthAlertStateRow {
  return {
    lastStatus: "degraded",
    consecutiveBad: 3,
    lastAlertedAt: "2026-09-07T00:00:00.000Z",
    lastAlertKind: "opened",
    lastAlertSeverity: "degraded",
    lastReason: "elevated latency",
    lastRecoveredAt: null,
    updatedAt: "2026-09-07T00:00:00.000Z",
    ...partial,
  };
}

export function runAdminSystemHealthAlertsTests() {
  const root = process.cwd();
  const now = new Date("2026-09-07T01:00:00.000Z");

  assert(SYSTEM_HEALTH_ALERT_DOWN_CONSECUTIVE === 2, "down threshold is 2");
  assert(SYSTEM_HEALTH_ALERT_DEGRADED_CONSECUTIVE === 3, "degraded threshold is 3");
  assert(SYSTEM_HEALTH_ALERT_COOLDOWN_MS === 90 * 60 * 1000, "90 minute cooldown");
  assert(
    SYSTEM_HEALTH_ALERTABLE_SERVICE_IDS.join(",") ===
      "platform,supabase,isabela_voice,square_billing",
    "V1 alertable services",
  );
  assert(isObservationOnlyServiceId("guest_stay"), "Guest Stay observation only");
  assert(isObservationOnlyServiceId("isabela_text"), "Isabela Text observation only");
  assert(isObservationOnlyServiceId("housekeeping"), "Housekeeping observation only");
  assert(isObservationOnlyServiceId("secure_access"), "Secure Access observation only");
  assert(isObservationOnlyServiceId("notifications"), "Notifications observation only");
  assert(
    !(SYSTEM_HEALTH_SERVICE_IDS as readonly string[]).includes("synthetic_alert_test"),
    "synthetic id never in System Health UI ids",
  );
  assert(isSyntheticAlertsAllowed("development") === true, "synthetic allowed in development");
  assert(isSyntheticAlertsAllowed("production") === false, "synthetic blocked in production");
  assert(
    buildFounderAlertSubject({
      kind: "opened",
      severity: "degraded",
      serviceId: "synthetic_alert_test",
    }) === "[Zencierge Warning] Synthetic Alert Test Degraded",
    "synthetic warning subject",
  );

  // unknown never alerts
  {
    const d = evaluateSystemHealthAlertTransition({
      serviceId: "isabela_voice",
      current: {
        status: "unknown",
        reason: "No recent TTS traffic",
        checkedAt: now.toISOString(),
      },
      prior: emptyAlertState("isabela_voice", now.toISOString()),
      now,
    });
    assert(d.action === "noop" && d.notify === null, "unknown never alerts");
    assert(d.next.consecutiveBad === 0, "unknown resets consecutive");
  }

  // one degraded check does not alert
  {
    const d = evaluateSystemHealthAlertTransition({
      serviceId: "platform",
      current: { status: "degraded", reason: "repeated failures", checkedAt: now.toISOString() },
      prior: null,
      now,
    });
    assert(d.action === "noop" && d.notify === null, "first degraded does not alert");
    assert(d.next.consecutiveBad === 1, "first degraded consecutive=1");
  }

  // degraded alerts on third consecutive
  {
    let state: SystemHealthAlertStateRow | null = null;
    let lastAction = "noop";
    for (let i = 0; i < 3; i += 1) {
      const d = evaluateSystemHealthAlertTransition({
        serviceId: "supabase",
        current: {
          status: "degraded",
          reason: "elevated latency",
          checkedAt: now.toISOString(),
        },
        prior: state,
        now: new Date(now.getTime() + i * 15 * 60 * 1000),
      });
      state = d.next;
      lastAction = d.action;
      if (i < 2) assert(d.notify === null, `degraded check ${i + 1} no email`);
    }
    assert(lastAction === "opened", "third degraded opens alert");
    assert(state?.consecutiveBad === 3, "third degraded consecutive=3");
  }

  // down alerts on second consecutive
  {
    let state: SystemHealthAlertStateRow | null = null;
    let lastAction = "noop";
    for (let i = 0; i < 2; i += 1) {
      const d = evaluateSystemHealthAlertTransition({
        serviceId: "platform",
        current: { status: "down", reason: "probe failed", checkedAt: now.toISOString() },
        prior: state,
        now: new Date(now.getTime() + i * 15 * 60 * 1000),
      });
      state = d.next;
      lastAction = d.action;
      if (i === 0) assert(d.notify === null, "first down no email");
    }
    assert(lastAction === "opened", "second down opens alert");
  }

  // same state does not spam during cooldown
  {
    const openedAt = new Date("2026-09-07T00:00:00.000Z");
    const prior = priorOpened({
      serviceId: "supabase",
      lastStatus: "down",
      lastAlertSeverity: "down",
      consecutiveBad: 4,
      lastAlertedAt: openedAt.toISOString(),
    });
    const d = evaluateSystemHealthAlertTransition({
      serviceId: "supabase",
      current: { status: "down", reason: "still down", checkedAt: now.toISOString() },
      prior,
      now: new Date(openedAt.getTime() + 30 * 60 * 1000),
    });
    assert(d.action === "noop" && d.notify === null, "cooldown blocks repeat down email");
  }

  // degraded → down escalates inside cooldown
  {
    const openedAt = new Date("2026-09-07T00:00:00.000Z");
    const prior = priorOpened({
      serviceId: "supabase",
      lastStatus: "degraded",
      lastAlertSeverity: "degraded",
      consecutiveBad: 3,
      lastAlertedAt: openedAt.toISOString(),
    });
    const d = evaluateSystemHealthAlertTransition({
      serviceId: "supabase",
      current: { status: "down", reason: "probe failed", checkedAt: now.toISOString() },
      prior,
      now: new Date(openedAt.getTime() + 20 * 60 * 1000),
    });
    assert(d.action === "escalated" && d.notify?.kind === "escalated", "degraded→down escalates");
    assert(d.notify?.severity === "down", "escalation severity is down");
  }

  // recovery sends exactly one recovery email and resets counters
  {
    const prior = priorOpened({
      serviceId: "platform",
      lastStatus: "down",
      lastAlertSeverity: "down",
      consecutiveBad: 5,
    });
    const recovered = evaluateSystemHealthAlertTransition({
      serviceId: "platform",
      current: { status: "healthy", reason: "ok", checkedAt: now.toISOString() },
      prior,
      now,
    });
    assert(recovered.action === "recovered", "recovery action");
    assert(recovered.notify?.kind === "recovered", "recovery email");
    assert(recovered.next.consecutiveBad === 0, "recovery resets consecutive");

    const again = evaluateSystemHealthAlertTransition({
      serviceId: "platform",
      current: { status: "healthy", reason: "ok", checkedAt: now.toISOString() },
      prior: recovered.next,
      now: new Date(now.getTime() + 15 * 60 * 1000),
    });
    assert(again.action === "noop" && again.notify === null, "second healthy is not another recovery");
  }

  // Isabela no-traffic (unknown) does not alert
  assert(
    !isActionableAlertStatus("isabela_voice", "unknown", "No recent TTS traffic"),
    "Isabela no traffic not actionable",
  );

  // isolated failed Square card does not alert
  assert(
    !isActionableAlertStatus(
      "square_billing",
      "degraded",
      "Square integration receiving payments; some customer cards failed (not system Down)",
    ),
    "customer card failures not Founder Square Down",
  );
  assert(
    !isActionableAlertStatus(
      "square_billing",
      "degraded",
      "Only failed charges observed recently — investigate; not marked Down without integration proof",
    ),
    "failed-charges-only is billing quality not system outage",
  );
  assert(
    isActionableAlertStatus(
      "square_billing",
      "degraded",
      "Could not read Square payment records",
    ),
    "Square read failure is actionable",
  );
  assert(
    isActionableAlertStatus("square_billing", "down", "Service role unavailable"),
    "Square down is actionable",
  );

  // Square customer-card degraded never opens via evaluator
  {
    const d = evaluateSystemHealthAlertTransition({
      serviceId: "square_billing",
      current: {
        status: "degraded",
        reason: "some customer cards failed (not system Down)",
        checkedAt: now.toISOString(),
      },
      prior: {
        ...emptyAlertState("square_billing", now.toISOString()),
        lastStatus: "degraded",
        consecutiveBad: 10,
        lastReason: "some customer cards failed (not system Down)",
      },
      now,
    });
    assert(d.notify === null, "Square card degraded never emails");
  }

  // email content: subject + no secrets
  const subjectWarn = buildFounderAlertSubject({
    kind: "opened",
    severity: "degraded",
    serviceId: "isabela_voice",
  });
  const subjectCrit = buildFounderAlertSubject({
    kind: "opened",
    severity: "down",
    serviceId: "supabase",
  });
  const subjectRec = buildFounderAlertSubject({
    kind: "recovered",
    severity: "recovered",
    serviceId: "supabase",
  });
  assert(subjectWarn === "[Zencierge Warning] Isabela Voice Degraded", "warning subject");
  assert(subjectCrit === "[Zencierge Critical] Supabase Down", "critical subject");
  assert(subjectRec === "[Zencierge Recovered] Supabase Healthy", "recovery subject");

  const text = buildFounderAlertText({
    kind: "opened",
    severity: "down",
    serviceId: "supabase",
    status: "down",
    reason: "probe failed with api_key=sk-secret and Bearer token abc",
    checkedAt: now.toISOString(),
    systemUrl: "https://example.com/backoffice/system",
  });
  assert(text.includes("/backoffice/system"), "email links System page");
  assert(!text.includes("sk-secret"), "email redacts api key material");
  assert(!text.includes("Bearer token abc") || text.includes("[redacted]"), "email redacts bearer");
  assert(!/guest.?token|door.?code|password/i.test(text) || text.includes("no guest tokens"), "no secrets claim");

  assert(parseFounderAlertEmails("a@x.com, b@y.com").length === 2, "parse founder emails");
  assert(parseFounderAlertEmails("").length === 0, "empty founder emails");
  assert(parseFounderAlertEmails("ADMIN_EMAILS-lookalike").length === 0, "no fake emails");

  // Files + security posture
  const migration = join(root, "supabase/migrations/20260907001500_system_health_alert_state.sql");
  assert(existsSync(migration), "alert state migration exists");
  const sql = readFileSync(migration, "utf8");
  assert(sql.includes("system_health_alert_state"), "migration table name");
  assert(sql.includes("enable row level security"), "RLS enabled");
  assert(sql.includes("grant all on table public.system_health_alert_state to service_role"), "service_role only");
  assert(sql.includes("revoke all on table public.system_health_alert_state from anon"), "anon revoked");
  assert(sql.includes("revoke all on table public.system_health_alert_state from authenticated"), "auth revoked");

  const notify = readFileSync(join(root, "src/lib/notify-founder-system-health.ts"), "utf8");
  assert(notify.includes("FOUNDER_ALERT_EMAILS"), "uses FOUNDER_ALERT_EMAILS");
  assert(!notify.includes("process.env.ADMIN_EMAILS"), "does not fall back to admin allowlist env");
  assert(notify.includes("api.resend.com"), "Resend pattern");
  assert(notify.includes("unconfigured"), "empty destination = unconfigured");

  const domain = readFileSync(join(root, "src/lib/admin-system-health-alerts.ts"), "utf8");
  assert(domain.includes("getAdminSystemHealthSnapshot"), "evaluator uses health snapshot");
  assert(domain.includes("runSystemHealthAlertsEvaluation"), "run export");
  assert(domain.includes("notifyFounderSystemHealth"), "sends founder email");
  assert(domain.includes("emailFailures"), "tracks email failures without throw-all");
  assert(domain.includes("syntheticObservation"), "runner supports synthetic observation");
  assert(domain.includes("SYNTHETIC_ALERT_TEST_SERVICE_ID"), "dedicated synthetic service id");
  assert(domain.includes("isSyntheticAlertsAllowed"), "production gate helper used");

  const cron = readFileSync(join(root, "src/app/api/cron/system-health-alerts/route.ts"), "utf8");
  assert(cron.includes("CRON_SECRET"), "cron protected by secret");
  assert(cron.includes("Unauthorized"), "invalid secret rejected");
  assert(cron.includes("runSystemHealthAlertsEvaluation"), "cron runs evaluator");
  assert(cron.includes("syntheticTest"), "cron accepts synthetic test body");
  assert(cron.includes("isSyntheticAlertsAllowed"), "cron gates synthetic on non-production");
  assert(cron.includes("Authorization"), "documents Bearer auth for Vercel Cron");
  assert(cron.includes("x-cron-secret"), "keeps manual x-cron-secret auth");
  assert(cron.includes("[cron/system-health-alerts]"), "lightweight cron run logging");
  assert(cron.includes("emailFailures"), "logs emailFailures count");
  assert(cron.includes("Scheduler OFF"), "cron documents scheduler OFF");
  assert(!cron.includes("process.env.ADMIN_EMAILS"), "cron does not use ADMIN_EMAILS");
  assert(SYNTHETIC_ALERT_TEST_SERVICE_ID === "synthetic_alert_test", "synthetic id constant");
  assert(SYSTEM_HEALTH_ALERTS_SCHEDULER_ENABLED === false, "automatic scheduler remains OFF");
  assert(SYSTEM_HEALTH_ALERTS_SCHEDULER_CRON === "*/15 * * * *", "prepared 15m cadence");
  assert(
    SYSTEM_HEALTH_ALERTS_SCHEDULER_PATH === "/api/cron/system-health-alerts",
    "prepared cron path",
  );

  assert(!existsSync(join(root, "vercel.json")), "no live vercel.json cron (scheduler OFF)");
  const preparedCron = JSON.parse(
    readFileSync(join(root, "deploy/vercel.crons.alerts-v1b.example.json"), "utf8"),
  ) as { crons?: Array<{ path?: string; schedule?: string }> };
  assert(Array.isArray(preparedCron.crons), "prepared cron example exists");
  assert(preparedCron.crons!.length === 1, "exactly one prepared scheduler");
  assert(
    preparedCron.crons![0]?.path === "/api/cron/system-health-alerts",
    "prepared cron path matches alerts route",
  );
  assert(preparedCron.crons![0]?.schedule === "*/15 * * * *", "prepared cadence every 15 minutes");
  assert(existsSync(join(root, "deploy/ALERTS_V1B_SCHEDULER.md")), "activation doc exists");

  const envExample = readFileSync(join(root, ".env.example"), "utf8");
  assert(envExample.includes("FOUNDER_ALERT_EMAILS="), "env documents FOUNDER_ALERT_EMAILS");
  assert(envExample.includes("CRON_SECRET="), "env documents CRON_SECRET");
  assert(envExample.includes("Vercel Cron"), "env documents Vercel Cron Bearer injection");
  assert(envExample.includes("OFF now"), "env documents scheduler OFF");

  const systemPage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/system/page.tsx"),
    "utf8",
  );
  assert(systemPage.includes("getSystemHealthAlertSummary"), "System page shows alert summary");
  assert(systemPage.includes("getAdminSystemHealthSnapshot"), "System page keeps health snapshot");
  assert(systemPage.includes("scheduler"), "System page shows scheduler status");
  assert(systemPage.includes("lastEvaluatedAt"), "System page shows last evaluation");
  assert(systemPage.includes("lastAlertedAt"), "System page shows last alert send");

  const layout = readFileSync(join(root, "src/app/(founder-admin)/backoffice/layout.tsx"), "utf8");
  assert(layout.includes("isSuperAdmin"), "Founder gate remains");
  assert(layout.includes('redirect("/dashboard")'), "normal host cannot read Founder surfaces");

  // No emergency controls / SMS / kill switches in this block
  assert(!domain.includes("kill switch") && !domain.includes("killSwitch"), "no kill switches");
  assert(!notify.includes("twilio") && !notify.includes("TWILIO"), "no SMS in V1");
  assert(!cron.includes("Emergency"), "no emergency controls in cron");

  console.log("admin-system-health-alerts tests passed");
}

runAdminSystemHealthAlertsTests();
