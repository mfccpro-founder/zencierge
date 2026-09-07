import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateTtsEvents,
  buildSystemHealthHeader,
  countSquarePaymentsFromRows,
  evaluateSquareHealth,
  evaluateTtsHealth,
  normalizeSquarePaymentAt,
  normalizeSquarePaymentState,
  SYSTEM_HEALTH_SERVICE_IDS,
  type SystemHealthServiceCard,
} from "./admin-system-health-shared";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function sampleService(
  partial: Pick<SystemHealthServiceCard, "id" | "status"> & Partial<SystemHealthServiceCard>,
): SystemHealthServiceCard {
  return {
    label: partial.id,
    reason: "test",
    checkedAt: "2026-09-06T00:00:00.000Z",
    lastActivityAt: null,
    latencyMs: null,
    detailLines: [],
    ...partial,
  };
}

export function runAdminSystemHealthTests() {
  const root = process.cwd();

  // TTS: no traffic → unknown (not healthy)
  const noTraffic = evaluateTtsHealth(aggregateTtsEvents([], 24));
  assert(noTraffic.status === "unknown", "TTS no-traffic → unknown");
  assert(/no recent activity/i.test(noTraffic.reason), "TTS unknown reason mentions no recent activity");

  const mixed = evaluateTtsHealth(
    aggregateTtsEvents(
      [
        { status: "success", created_at: "2026-09-06T12:00:00.000Z" },
        { status: "success", created_at: "2026-09-06T12:01:00.000Z" },
        { status: "success", created_at: "2026-09-06T12:02:00.000Z" },
        { status: "success", created_at: "2026-09-06T12:03:00.000Z" },
        { status: "failed", created_at: "2026-09-06T12:04:00.000Z" },
      ],
      24,
    ),
  );
  assert(mixed.status === "healthy" || mixed.status === "degraded", "TTS aggregation runs");
  assert(mixed.lastActivityAt === "2026-09-06T12:04:00.000Z", "latest activity prefers newest");

  const mostlyFail = evaluateTtsHealth(
    aggregateTtsEvents(
      [
        { status: "failed", created_at: "2026-09-06T12:00:00.000Z" },
        { status: "failed", created_at: "2026-09-06T12:01:00.000Z" },
        { status: "success", created_at: "2026-09-06T12:02:00.000Z" },
      ],
      24,
    ),
  );
  assert(mostlyFail.status === "degraded", "high TTS failure rate → degraded");

  const allFail = evaluateTtsHealth(
    aggregateTtsEvents(
      Array.from({ length: 5 }, (_, i) => ({
        status: "failed",
        created_at: `2026-09-06T12:0${i}:00.000Z`,
      })),
      24,
    ),
  );
  assert(allFail.status === "down", "sustained TTS failures → down");

  // Square: isolated failed cards do NOT mark Down when succeeds exist
  const cardFail = evaluateSquareHealth({
    windowDays: 30,
    succeeded: 10,
    failed: 1,
    refunded: 0,
    pastDueSubscriptions: 2,
    canceledSubscriptions: 1,
    latestPaymentAt: "2026-09-05T10:00:00.000Z",
    credentialsConfigured: true,
    mockCheckout: false,
  });
  assert(cardFail.status !== "down", "isolated failed Square card does not mark Square Down");
  assert(cardFail.status === "degraded" || cardFail.status === "healthy", "Square remains operational");
  assert(/not system Down|not Square Down|failed card/i.test(cardFail.reason + cardFail.detailLines.join(" ")), "Square copy distinguishes card fails");

  const noSquareTraffic = evaluateSquareHealth({
    windowDays: 30,
    succeeded: 0,
    failed: 0,
    refunded: 0,
    pastDueSubscriptions: 0,
    canceledSubscriptions: 0,
    latestPaymentAt: null,
    credentialsConfigured: true,
    mockCheckout: false,
  });
  assert(noSquareTraffic.status === "unknown", "missing Square traffic → unknown honestly");

  // Tolerant payment_status path (live schema)
  const fromPaymentStatus = countSquarePaymentsFromRows([
    { payment_status: "succeeded", paid_at: "2026-09-01T12:00:00.000Z" },
    { payment_status: "failed", paid_at: "2026-09-02T12:00:00.000Z" },
    { payment_status: "refunded", paid_at: "2026-09-03T12:00:00.000Z" },
  ]);
  assert(fromPaymentStatus.succeeded === 1, "payment_status succeeded counted");
  assert(fromPaymentStatus.failed === 1, "payment_status failed counted");
  assert(fromPaymentStatus.refunded === 1, "payment_status refunded counted");
  assert(fromPaymentStatus.latestPaymentAt === "2026-09-03T12:00:00.000Z", "paid_at used for latest");
  assert(normalizeSquarePaymentState({ payment_status: "failed", status: "succeeded" }) === "failed", "payment_status preferred over status");
  assert(normalizeSquarePaymentAt({ paid_at: "a", created_at: "b" }) === "a", "paid_at preferred over created_at");

  // Fallback status / created_at path (documented schema)
  const fromStatus = countSquarePaymentsFromRows([
    { status: "succeeded", created_at: "2026-09-04T12:00:00.000Z" },
    { status: "failed", created_at: "2026-09-05T12:00:00.000Z" },
  ]);
  assert(fromStatus.succeeded === 1 && fromStatus.failed === 1, "status fallback counts");
  assert(fromStatus.latestPaymentAt === "2026-09-05T12:00:00.000Z", "created_at fallback for latest");

  const header = buildSystemHealthHeader(
    SYSTEM_HEALTH_SERVICE_IDS.map((id, index) =>
      sampleService({
        id,
        status: index === 0 ? "degraded" : index === 1 ? "unknown" : "healthy",
      }),
    ),
  );
  assert(header.degradedCount === 1 && header.unknownCount === 1, "header counts statuses");
  assert(/1 Degraded/.test(header.headline) && /1 Unknown/.test(header.headline), "header lists degraded/unknown");

  const allHealthy = buildSystemHealthHeader(
    SYSTEM_HEALTH_SERVICE_IDS.map((id) => sampleService({ id, status: "healthy" })),
  );
  assert(allHealthy.headline === "All Systems Operational", "all healthy headline");

  const page = readFileSync(join(root, "src/app/(founder-admin)/backoffice/system/page.tsx"), "utf8");
  assert(page.includes("getAdminSystemHealthSnapshot"), "system page uses snapshot");
  assert(!page.includes("BackOfficeComingNext"), "system page is live");
  assert(page.includes("BackOfficeSystemHealthMobile"), "mobile compact view mounted");
  assert(page.includes("BackOfficeSystemHealthDesktop"), "desktop compact grid mounted");
  assert(!/ON\/OFF|Emergency|kill switch/i.test(page), "no emergency controls");

  const mobileView = readFileSync(
    join(root, "src/components/admin/backoffice-system-health-view.tsx"),
    "utf8",
  );
  assert(mobileView.includes('"use client"'), "mobile view is client");
  assert(mobileView.includes("grid-cols-2"), "mobile uses 2-column status grid");
  assert(mobileView.includes("lg:grid-cols-3"), "desktop uses 3-column grid");
  assert(mobileView.includes("system-health-mobile-detail"), "mobile details panel");
  assert(mobileView.includes("system-health-desktop-detail"), "desktop details on demand");
  assert(mobileView.includes("Tap a service for details"), "mobile details hidden by default");
  assert(mobileView.includes("click a service for details"), "desktop details hidden by default");
  assert(!mobileView.includes("grid-cols-1 gap-5"), "desktop no longer stacks full vertical cards");
  assert(mobileView.includes("md:hidden"), "mobile view hidden on desktop");
  assert(mobileView.includes("hidden") && mobileView.includes("md:block"), "desktop view hidden on mobile");
  assert(mobileView.includes("min-h-12") || mobileView.includes("min-h-11"), "touch targets large enough");
  assert(mobileView.includes("formatSystemHealthStatus"), "status text labels retained");
  assert(mobileView.includes("aria-pressed") || mobileView.includes("aria-expanded"), "accessible disclosure");
  assert(SYSTEM_HEALTH_SERVICE_IDS.every((id) => mobileView.includes(id)), "all service ids present for labels");

  // Health logic module must remain the source of truth (UI-only change).
  const domain = readFileSync(join(root, "src/lib/admin-system-health.ts"), "utf8");
  assert(domain.includes("getAdminSystemHealthSnapshot"), "snapshot export");
  assert(domain.includes("payment_status"), "tolerant live payment_status read");
  assert(domain.includes("paid_at"), "tolerant live paid_at read");
  assert(domain.includes("loadSubscriptionPaymentsTolerant") || domain.includes("SQUARE_PAYMENT_READ_ATTEMPTS") || domain.includes("payment_status, amount_paid, paid_at"), "multi-attempt Square payment select");
  assert(!domain.includes('.select("status, created_at, paid_at")'), "no hard-coded status-only Square select");
  assert(domain.includes("Could not read Square payment records") || domain.includes("paymentsLoad.error"), "true query failure surfaces unhealthy Square card");
  assert(domain.includes('method: "GET"') && domain.includes("/api/tts"), "safe TTS GET probe");
  assert(!domain.includes("streamElenaSpeech"), "does not synthesize speech");
  assert(!domain.includes("recordAiUsageEvent"), "health does not write usage events");
  assert(!domain.includes("issueGuestStayLink"), "no fake guest tokens");
  assert(!domain.includes("submit_housekeeping"), "no fake HK proofs");
  assert(!domain.includes("api.resend.com") && !domain.includes("api.twilio.com"), "no notification probes");
  assert(!domain.includes("createSquareClient"), "does not call Square SDK for health");
  assert(!/fetch\([^\)]*tts[^\)]*POST|method:\s*"POST"[\s\S]{0,80}\/api\/tts/i.test(domain), "no paid TTS POST health call");
  assert(!domain.includes("applySubscriptionWebhook"), "does not alter Square webhook path");
  assert(!domain.includes("from(\"host_subscriptions\").upsert"), "does not write subscriptions");

  const overview = readFileSync(join(root, "src/app/(founder-admin)/backoffice/page.tsx"), "utf8");
  assert(overview.includes("getAdminSystemHealthSnapshot"), "Overview uses live system health");
  assert(overview.includes("/backoffice/system"), "Overview links to System");
  assert(!overview.includes("System monitoring — not instrumented"), "Overview placeholder removed");

  const layout = readFileSync(join(root, "src/app/(founder-admin)/backoffice/layout.tsx"), "utf8");
  assert(layout.includes("isSuperAdmin"), "Founder can view via SuperAdmin layout");
  assert(layout.includes('redirect("/dashboard")'), "ordinary host cannot access");

  const nav = readFileSync(join(root, "src/components/admin/backoffice-nav.tsx"), "utf8");
  assert(/href: "\/backoffice\/system"[\s\S]*?status: "ready"/.test(nav), "System nav ready");

  console.log("admin-system-health tests passed");
}

runAdminSystemHealthTests();
