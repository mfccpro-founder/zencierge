import {
  deleteSyntheticAlertTestState,
  runSystemHealthAlertsEvaluation,
} from "@/lib/admin-system-health-alerts";
import {
  isSyntheticAlertsAllowed,
  SYNTHETIC_ALERT_TEST_REASON,
} from "@/lib/admin-system-health-alerts-shared";
import type { SystemHealthStatus } from "@/lib/admin-system-health-shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function extractCronSecret(request: Request): string {
  const headerSecret = request.headers.get("x-cron-secret")?.trim() ?? "";
  if (headerSecret) return headerSecret;
  const auth = request.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  return bearer?.[1]?.trim() ?? "";
}

function unauthorized() {
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function forbiddenSynthetic() {
  return Response.json(
    { ok: false, error: "Synthetic Founder alert tests are disabled in production." },
    { status: 403 },
  );
}

type SyntheticBody = {
  syntheticTest?: boolean;
  status?: string;
  cleanupSynthetic?: boolean;
};

async function parseBody(request: Request): Promise<SyntheticBody | null> {
  if (request.method === "GET") return null;
  try {
    return (await request.json()) as SyntheticBody;
  } catch {
    return null;
  }
}

const SCHEDULING_NOTE =
  "Scheduler OFF. Prepared for Vercel Cron */15 (see deploy/ALERTS_V1B_SCHEDULER.md). Auth: Bearer CRON_SECRET or x-cron-secret.";

/**
 * Founder System Health Alerts V1 cron.
 * Protect with CRON_SECRET. Automatic scheduler is OFF until production activation.
 *
 * Auth (ready for Vercel Cron later — no redesign):
 * - Vercel Cron will send Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set.
 * - Manual/ops can use x-cron-secret or Bearer now.
 *
 * Non-production optional body:
 * { "syntheticTest": true, "status": "degraded"|"down"|"healthy" }
 * { "syntheticTest": true, "cleanupSynthetic": true }
 */
function logScheduledRun(payload: {
  at: string;
  httpOk: boolean;
  opened: number;
  escalated: number;
  recovered: number;
  emailFailures: number;
  synthetic?: boolean;
}) {
  console.info("[cron/system-health-alerts]", payload);
}

async function handle(request: Request) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) {
    return Response.json(
      {
        ok: false,
        error: "CRON_SECRET is not configured",
      },
      { status: 503 },
    );
  }

  if (extractCronSecret(request) !== expected) {
    return unauthorized();
  }

  const body = await parseBody(request);

  if (body?.syntheticTest) {
    if (!isSyntheticAlertsAllowed()) {
      return forbiddenSynthetic();
    }

    if (body.cleanupSynthetic) {
      const cleanup = await deleteSyntheticAlertTestState();
      return Response.json({
        ok: cleanup.ok,
        cleanupSynthetic: true,
        error: cleanup.error,
        schedulingNote: "Synthetic test state cleanup only. Automatic scheduler remains OFF.",
      });
    }

    const status = (body.status || "").trim() as SystemHealthStatus;
    if (status !== "healthy" && status !== "degraded" && status !== "down") {
      return Response.json(
        {
          ok: false,
          error: 'syntheticTest requires status: "healthy" | "degraded" | "down"',
        },
        { status: 400 },
      );
    }

    try {
      const result = await runSystemHealthAlertsEvaluation({
        syntheticObservation: {
          status,
          reason: SYNTHETIC_ALERT_TEST_REASON,
        },
      });
      const ok = !result.error;
      logScheduledRun({
        at: new Date().toISOString(),
        httpOk: ok,
        opened: result.opened,
        escalated: result.escalated,
        recovered: result.recovered,
        emailFailures: result.emailFailures,
        synthetic: true,
      });
      return Response.json({
        ok,
        ...result,
        syntheticReason: SYNTHETIC_ALERT_TEST_REASON,
        schedulingNote:
          "Synthetic-only evaluation. System Health UI unchanged. Automatic scheduler remains OFF.",
      });
    } catch (cause) {
      console.warn("[cron/system-health-alerts] synthetic evaluation failed", {
        at: new Date().toISOString(),
        httpOk: false,
      });
      return Response.json(
        {
          ok: false,
          error: cause instanceof Error ? cause.message : "Synthetic alert evaluation failed",
        },
        { status: 500 },
      );
    }
  }

  try {
    const result = await runSystemHealthAlertsEvaluation();
    const ok = !result.error;
    logScheduledRun({
      at: new Date().toISOString(),
      httpOk: ok,
      opened: result.opened,
      escalated: result.escalated,
      recovered: result.recovered,
      emailFailures: result.emailFailures,
    });
    return Response.json({
      ok,
      ...result,
      schedulingNote: SCHEDULING_NOTE,
    });
  } catch (cause) {
    console.warn("[cron/system-health-alerts] evaluation failed", {
      at: new Date().toISOString(),
      httpOk: false,
    });
    return Response.json(
      {
        ok: false,
        error: cause instanceof Error ? cause.message : "Alert evaluation failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
