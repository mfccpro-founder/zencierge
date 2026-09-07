import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryHostOwnershipStore, DEV_SYNTHETIC_PROPERTY_IDS } from "./host-property-ownership";
import { mockDevHostUser } from "./dev-host-session";
import {
  HOUSEKEEPING_PROOF_OPTIONS_MAX_PROPERTIES,
  HOUSEKEEPING_PROOF_OPTIONS_PROPERTY_COLUMNS,
  HOUSEKEEPING_PROOF_OPTIONS_RESERVATION_COLUMNS,
  HOUSEKEEPING_PROOF_OPTIONS_STAGES,
  createMemoryHousekeepingProofOptionsStore,
  housekeepingProofOptionsEligibleStages,
  listHousekeepingProofOptions,
} from "./housekeeping-proof-options";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const HOST_A = "11111111-1111-4111-8111-111111111111";
const HOST_B = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-11T12:00:00.000Z");

const windowedProperty = {
  id: "prop-hk-1",
  name: "Bayview Loft",
  timezone: "UTC",
  checkInTime: "3:00 PM",
  checkOutTime: "11:00 AM",
};

const liveReservation = {
  id: "res-hk-1",
  property_id: "prop-hk-1",
  check_in: "2026-09-10",
  check_out: "2026-09-14",
  status: "upcoming",
};

function realOwnership() {
  return createMemoryHostOwnershipStore({
    properties: {
      "prop-hk-1": { hostId: HOST_A },
      "prop-other": { hostId: HOST_B },
      "prop-null": { hostId: null },
    },
    reservations: { "res-hk-1": { propertyId: "prop-hk-1" } },
  });
}

function optionsStore(overrides?: Parameters<typeof createMemoryHousekeepingProofOptionsStore>[0]) {
  return createMemoryHousekeepingProofOptionsStore({
    properties: [
      windowedProperty,
      { ...windowedProperty, id: "prop-other", name: "Other Host Villa" },
      { ...windowedProperty, id: "prop-null", name: "Null Host" },
    ],
    reservations: [
      liveReservation,
      { ...liveReservation, id: "res-other", property_id: "prop-other" },
      { ...liveReservation, id: "res-null", property_id: "prop-null" },
    ],
    ...overrides,
  });
}

async function list(overrides?: Record<string, unknown>) {
  return listHousekeepingProofOptions({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    ownershipStore: realOwnership(),
    store: optionsStore(),
    now: NOW,
    ...overrides,
  });
}

export async function runHousekeepingProofOptionsTests() {
  const here = dirname(fileURLToPath(import.meta.url));
  const libSrc = readFileSync(join(here, "housekeeping-proof-options.ts"), "utf8");
  const routeSrc = readFileSync(join(here, "../app/api/housekeeping/proof-options/route.ts"), "utf8");
  const source = `${libSrc}\n${routeSrc}`;

  assert(routeSrc.includes("requireHostAuthContext"), "route authenticates");
  assert(routeSrc.indexOf("requireHostAuthContext") < routeSrc.indexOf("housekeepingProofAdminClient"), "auth before admin client");
  assert(routeSrc.indexOf("requireHostAuthContext") < routeSrc.indexOf("listHousekeepingProofOptions"), "auth before options query");
  assert(routeSrc.indexOf("housekeepingProofAdminClient") < routeSrc.indexOf("listHousekeepingProofOptions"), "admin after auth before list");
  assert(routeSrc.includes("export async function GET"), "GET endpoint");
  assert(!routeSrc.includes("searchParams") && !routeSrc.includes("nextUrl") && !routeSrc.includes("request.json"), "no query/body ownership controls");
  assert(routeSrc.includes("housekeepingProofJson"), "uses proof JSON headers");
  const { housekeepingProofJson } = await import("./housekeeping-proof");
  const headers = housekeepingProofJson({ ok: true }, 200).headers;
  assert(headers.get("Cache-Control") === "no-store", "cache no-store");
  assert(headers.get("Referrer-Policy") === "no-referrer", "referrer no-referrer");

  let queried = false;
  const unauth = await listHousekeepingProofOptions({
    userId: null,
    hostAuthSource: "supabase-auth",
    ownershipStore: realOwnership(),
    store: {
      async listProperties() {
        queried = true;
        return { kind: "rows", rows: [] };
      },
      async listReservations() {
        queried = true;
        return { kind: "rows", rows: [] };
      },
      async listPendingReviewStages() {
        queried = true;
        return { kind: "rows", rows: [] };
      },
      async listTerminalIssueStages() {
        queried = true;
        return { kind: "rows", rows: [] };
      },
    },
  });
  assert(unauth.status === 401 && (unauth.body as { error?: string }).error === "Unauthorized", "unauthenticated -> 401");
  assert(!queried, "unauthenticated does not query listings");

  const noSource = await list({ hostAuthSource: null, userId: HOST_A });
  assert(noSource.status === 401, "missing auth source -> 401");

  const ok = await list();
  assert(ok.status === 200, "owned host is 200");
  const body = ok.body as {
    ok?: boolean;
    properties?: Array<Record<string, unknown>>;
    reservations?: Array<Record<string, unknown>>;
  };
  assert(body.ok === true, "ok true");
  assert(Object.keys(body).sort().join(",") === "ok,pendingHousekeepingCount,properties,reservations", "top-level keys exact");
  assert((body as { pendingHousekeepingCount?: number }).pendingHousekeepingCount === 0, "no pending review stages → count 0");
  assert(body.properties?.length === 1 && body.properties[0]?.id === "prop-hk-1", "real auth returns only matching host_id properties");
  assert(Boolean(body.properties?.[0]) && Object.keys(body.properties![0]!).sort().join(",") === "id,name", "property keys exact");
  assert(body.reservations?.length === 1 && body.reservations[0]?.id === "res-hk-1", "other-host and null-host reservations excluded");
  assert(
    Boolean(body.reservations?.[0]) &&
      Object.keys(body.reservations![0]!).sort().join(",") === "checkIn,checkOut,eligibleStages,id,propertyId,status",
    "reservation keys exact",
  );
  assert(
    JSON.stringify(body.reservations?.[0]?.eligibleStages) === JSON.stringify(["post_checkout"]),
    "expired ready_for_checkin omitted on 11 Sep",
  );

  const bothOpen = await list({ now: new Date("2026-09-09T12:00:00.000Z") });
  const bothBody = bothOpen.body as { reservations?: Array<{ eligibleStages?: string[] }> };
  assert(
    JSON.stringify(bothBody.reservations?.[0]?.eligibleStages) === JSON.stringify([...HOUSEKEEPING_PROOF_OPTIONS_STAGES]),
    "both stages when both windows are open",
  );

  const expired = await list({ now: new Date("2026-09-16T12:00:00.000Z") });
  const expiredBody = expired.body as { reservations?: unknown[]; properties?: unknown[] };
  assert(expired.status === 200 && expiredBody.reservations?.length === 0, "reservation omitted when no stages remain");
  assert((expiredBody.properties?.length ?? 0) === 1, "property remains when stays expire");

  const canceled = await list({
    store: optionsStore({
      reservations: [{ ...liveReservation, status: "canceled" }],
    }),
  });
  assert((canceled.body as { reservations?: unknown[] }).reservations?.length === 0, "canceled excluded");
  const cancelled = await list({
    store: optionsStore({
      reservations: [{ ...liveReservation, status: "cancelled" }],
    }),
  });
  assert((cancelled.body as { reservations?: unknown[] }).reservations?.length === 0, "cancelled spelling excluded");
  const voided = await list({
    store: optionsStore({
      reservations: [{ ...liveReservation, status: "void" }],
    }),
  });
  assert((voided.body as { reservations?: unknown[] }).reservations?.length === 0, "void excluded");

  const noZone = await list({
    store: optionsStore({
      properties: [{ ...windowedProperty, timezone: "" }],
    }),
  });
  assert((noZone.body as { reservations?: unknown[] }).reservations?.length === 0, "missing timezone excluded");
  const badZone = await list({
    store: optionsStore({
      properties: [{ ...windowedProperty, timezone: "Not/AZone" }],
    }),
  });
  assert((badZone.body as { reservations?: unknown[] }).reservations?.length === 0, "invalid timezone excluded");
  const noClock = await list({
    store: optionsStore({
      properties: [{ ...windowedProperty, checkInTime: "", checkOutTime: "" }],
    }),
  });
  assert((noClock.body as { reservations?: unknown[] }).reservations?.length === 0, "missing clock configuration excluded");
  assert(
    housekeepingProofOptionsEligibleStages(liveReservation, { ...windowedProperty, checkOutTime: "" }, NOW).length === 0,
    "empty clock is not treated as a fallback",
  );

  const expiredPending = await list({
    now: new Date("2026-09-16T12:00:00.000Z"),
    store: optionsStore({
      pending: [
        {
          reservationId: "res-hk-1",
          propertyId: "prop-hk-1",
          stage: "post_checkout",
          status: "submitted",
          pendingPhotoCount: 2,
        },
      ],
    }),
  });
  const expiredPendingBody = expiredPending.body as { reservations?: Array<{ id?: string; eligibleStages?: string[] }> };
  assert(expiredPending.status === 200, "outside-window pending review is 200");
  assert(expiredPendingBody.reservations?.length === 1 && expiredPendingBody.reservations[0]?.id === "res-hk-1", "outside-window owned stay with pending photos remains available");
  assert(
    JSON.stringify(expiredPendingBody.reservations?.[0]?.eligibleStages) === JSON.stringify(["post_checkout"]),
    "only the pending reviewable stage is restored after the clock window",
  );
  assert(
    (expiredPending.body as { pendingHousekeepingCount?: number }).pendingHousekeepingCount === 1,
    "pendingHousekeepingCount reflects owned pending review stages",
  );

  const expiredNeedsAttention = await list({
    now: new Date("2026-09-16T12:00:00.000Z"),
    store: optionsStore({
      pending: [
        {
          reservationId: "res-hk-1",
          propertyId: "prop-hk-1",
          stage: "post_checkout",
          status: "needs_attention",
          pendingPhotoCount: 1,
        },
      ],
    }),
  });
  const expiredNeedsBody = expiredNeedsAttention.body as { reservations?: Array<{ eligibleStages?: string[] }> };
  assert(
    expiredNeedsAttention.status === 200 &&
      JSON.stringify(expiredNeedsBody.reservations?.[0]?.eligibleStages) === JSON.stringify(["post_checkout"]),
    "out-of-window needs_attention with pending photos remains eligible",
  );

  const expiredDecided = await list({
    now: new Date("2026-09-16T12:00:00.000Z"),
    store: optionsStore({
      pending: [
        {
          reservationId: "res-hk-1",
          propertyId: "prop-hk-1",
          stage: "post_checkout",
          status: "submitted",
          pendingPhotoCount: 0,
        },
      ],
    }),
  });
  assert((expiredDecided.body as { reservations?: unknown[] }).reservations?.length === 0, "outside-window task with all photos decided is excluded");

  const expiredApproved = await list({
    now: new Date("2026-09-16T12:00:00.000Z"),
    store: optionsStore({
      pending: [
        {
          reservationId: "res-hk-1",
          propertyId: "prop-hk-1",
          stage: "post_checkout",
          status: "approved",
          pendingPhotoCount: 2,
        },
      ],
    }),
  });
  assert((expiredApproved.body as { reservations?: unknown[] }).reservations?.length === 0, "approved tasks are excluded");
  const expiredClosed = await list({
    now: new Date("2026-09-16T12:00:00.000Z"),
    store: optionsStore({
      pending: [
        {
          reservationId: "res-hk-1",
          propertyId: "prop-hk-1",
          stage: "post_checkout",
          status: "closed",
          pendingPhotoCount: 2,
        },
      ],
    }),
  });
  assert((expiredClosed.body as { reservations?: unknown[] }).reservations?.length === 0, "closed tasks are excluded");

  const expiredNoPhotos = await list({
    now: new Date("2026-09-16T12:00:00.000Z"),
    store: optionsStore({ pending: [] }),
  });
  assert((expiredNoPhotos.body as { reservations?: unknown[] }).reservations?.length === 0, "outside-window stay without pending photos is excluded");

  const unownedPending = await list({
    now: new Date("2026-09-16T12:00:00.000Z"),
    store: optionsStore({
      pending: [
        {
          reservationId: "res-other",
          propertyId: "prop-other",
          stage: "post_checkout",
          status: "submitted",
          pendingPhotoCount: 3,
        },
        {
          reservationId: "res-hk-1",
          propertyId: "prop-other",
          stage: "post_checkout",
          status: "submitted",
          pendingPhotoCount: 1,
        },
      ],
    }),
  });
  const unownedBody = unownedPending.body as { reservations?: Array<{ id?: string; propertyId?: string }> };
  assert((unownedBody.reservations?.length ?? 0) === 0, "unowned stays and mismatched property tasks are excluded");
  assert(!JSON.stringify(unownedPending.body).includes("res-other"), "unowned reservation id is not leaked");
  assert(!JSON.stringify(unownedPending.body).includes("prop-other"), "unowned property id is not leaked");
  assert(!JSON.stringify(unownedPending.body).includes("proof/"), "storage paths are not leaked");

  const inWindowStill = await list({
    store: optionsStore({
      pending: [
        {
          reservationId: "res-hk-1",
          propertyId: "prop-hk-1",
          stage: "post_checkout",
          status: "open",
          pendingPhotoCount: 1,
        },
      ],
    }),
  });
  const inWindowBody = inWindowStill.body as { reservations?: Array<{ id?: string; eligibleStages?: string[] }> };
  assert(inWindowBody.reservations?.length === 1 && inWindowBody.reservations[0]?.id === "res-hk-1", "existing in-window owned stay remains available");
  assert(
    JSON.stringify(inWindowBody.reservations?.[0]?.eligibleStages) === JSON.stringify(["post_checkout"]),
    "in-window eligible stages stay the same when pending matches the open window",
  );

  const inWindowApproved = await list({
    store: optionsStore({
      terminal: [{ reservationId: "res-hk-1", propertyId: "prop-hk-1", stage: "post_checkout", status: "approved" }],
    }),
  });
  assert((inWindowApproved.body as { reservations?: unknown[] }).reservations?.length === 0, "in-window approved stage is absent");

  const inWindowClosed = await list({
    store: optionsStore({
      terminal: [{ reservationId: "res-hk-1", propertyId: "prop-hk-1", stage: "post_checkout", status: "closed" }],
    }),
  });
  assert((inWindowClosed.body as { reservations?: unknown[] }).reservations?.length === 0, "in-window closed stage is absent");

  const oneTerminalKeepsOther = await list({
    now: new Date("2026-09-09T12:00:00.000Z"),
    store: optionsStore({
      terminal: [{ reservationId: "res-hk-1", propertyId: "prop-hk-1", stage: "post_checkout", status: "approved" }],
    }),
  });
  const oneTerminalBody = oneTerminalKeepsOther.body as { reservations?: Array<{ eligibleStages?: string[] }> };
  assert(oneTerminalKeepsOther.status === 200 && oneTerminalBody.reservations?.length === 1, "stay remains when one stage is terminal");
  assert(
    JSON.stringify(oneTerminalBody.reservations?.[0]?.eligibleStages) === JSON.stringify(["ready_for_checkin"]),
    "one terminal stage does not remove another valid stage",
  );

  const bothTerminal = await list({
    now: new Date("2026-09-09T12:00:00.000Z"),
    store: optionsStore({
      terminal: [
        { reservationId: "res-hk-1", propertyId: "prop-hk-1", stage: "post_checkout", status: "approved" },
        { reservationId: "res-hk-1", propertyId: "prop-hk-1", stage: "ready_for_checkin", status: "closed" },
      ],
    }),
  });
  assert((bothTerminal.body as { reservations?: unknown[] }).reservations?.length === 0, "both terminal stages omit the reservation");

  const pendingCannotResurrect = await list({
    now: new Date("2026-09-16T12:00:00.000Z"),
    store: optionsStore({
      pending: [
        {
          reservationId: "res-hk-1",
          propertyId: "prop-hk-1",
          stage: "post_checkout",
          status: "approved",
          pendingPhotoCount: 2,
        },
      ],
      terminal: [{ reservationId: "res-hk-1", propertyId: "prop-hk-1", stage: "post_checkout", status: "approved" }],
    }),
  });
  assert((pendingCannotResurrect.body as { reservations?: unknown[] }).reservations?.length === 0, "pending merge cannot resurrect an approved stage");

  const unownedTerminal = await list({
    store: optionsStore({
      terminal: [
        { reservationId: "res-other", propertyId: "prop-other", stage: "post_checkout", status: "approved" },
        { reservationId: "res-hk-1", propertyId: "prop-other", stage: "post_checkout", status: "closed" },
      ],
    }),
  });
  const unownedTerminalBody = unownedTerminal.body as { reservations?: Array<{ eligibleStages?: string[] }> };
  assert(
    JSON.stringify(unownedTerminalBody.reservations?.[0]?.eligibleStages) === JSON.stringify(["post_checkout"]),
    "ownership mismatch on terminal rows is ignored",
  );

  const failTerminal = await list({ store: optionsStore({ failTerminal: true }) });
  assert(failTerminal.status === 503 && (failTerminal.body as { error?: string }).error === "unavailable", "terminal lookup error -> 503");
  assert(!("details" in failTerminal.body) && !("message" in failTerminal.body), "terminal lookup error has no database details");
  const throwTerminal = await list({ store: optionsStore({ throwTerminal: true }) });
  assert(throwTerminal.status === 503 && (throwTerminal.body as { error?: string }).error === "unavailable", "terminal lookup throw -> 503");

  const failOwn = await list({
    ownershipStore: createMemoryHostOwnershipStore({ failList: true }),
  });
  assert(failOwn.status === 503 && (failOwn.body as { error?: string }).error === "unavailable", "ownership error -> 503");
  const failProps = await list({ store: optionsStore({ failProperties: true }) });
  assert(failProps.status === 503, "property query error -> 503");
  const failRes = await list({ store: optionsStore({ failReservations: true }) });
  assert(failRes.status === 503, "reservation query error -> 503");
  const failPending = await list({ store: optionsStore({ failPending: true }) });
  assert(failPending.status === 503, "pending-review query error -> 503");
  const trunc = await list({ store: optionsStore({ truncateReservations: true }) });
  assert(trunc.status === 503, "truncated reservation query -> 503");
  assert(failOwn.status !== 200 && failProps.status !== 200, "query failure is not empty 200");

  const emptyHost = await list({
    ownershipStore: createMemoryHostOwnershipStore({ properties: {} }),
  });
  assert(emptyHost.status === 200, "no owned properties is 200");
  assert(
    JSON.stringify(emptyHost.body) ===
      JSON.stringify({ ok: true, properties: [], reservations: [], pendingHousekeepingCount: 0 }),
    "empty success arrays",
  );

  const sorted = await list({
    store: optionsStore({
      properties: [
        { ...windowedProperty, id: "prop-hk-1", name: "Zulu House" },
        { ...windowedProperty, id: "prop-hk-2", name: "Alpha House" },
      ],
      reservations: [
        { ...liveReservation, id: "res-b", property_id: "prop-hk-1", check_in: "2026-09-12", check_out: "2026-09-15" },
        { ...liveReservation, id: "res-a", property_id: "prop-hk-2", check_in: "2026-09-11", check_out: "2026-09-13" },
      ],
    }),
    ownershipStore: createMemoryHostOwnershipStore({
      properties: {
        "prop-hk-1": { hostId: HOST_A },
        "prop-hk-2": { hostId: HOST_A },
      },
    }),
  });
  const sortedBody = sorted.body as {
    properties: Array<{ name: string }>;
    reservations: Array<{ id: string }>;
  };
  assert(sortedBody.properties.map((row) => row.name).join(",") === "Alpha House,Zulu House", "properties sorted by name");
  assert(sortedBody.reservations.map((row) => row.id).join(",") === "res-a,res-b", "reservations sorted by check-in");

  const tooMany = await list({
    ownershipStore: createMemoryHostOwnershipStore({
      properties: Object.fromEntries(
        Array.from({ length: HOUSEKEEPING_PROOF_OPTIONS_MAX_PROPERTIES + 1 }, (_, index) => [
          `prop-x-${index}`,
          { hostId: HOST_A },
        ]),
      ),
    }),
  });
  assert(tooMany.status === 503, "oversized owned set is unavailable, not silent omit");

  const devStore = createMemoryHousekeepingProofOptionsStore({
    properties: [
      { ...windowedProperty, id: "prop-1", name: "Seed One" },
      { ...windowedProperty, id: "prop-99", name: "Not Allowlisted" },
    ],
    reservations: [
      { ...liveReservation, id: "res-seed", property_id: "prop-1" },
      { ...liveReservation, id: "res-extra", property_id: "prop-99" },
    ],
  });
  const devOk = await listHousekeepingProofOptions({
    userId: mockDevHostUser().id,
    hostAuthSource: "dev-fallback",
    ownershipStore: createMemoryHostOwnershipStore(),
    store: devStore,
    now: NOW,
    nodeEnv: "development",
  });
  const devBody = devOk.body as { properties?: Array<{ id: string }>; reservations?: Array<{ propertyId: string }> };
  assert(devOk.status === 200, "dev fallback allowed outside production");
  assert((devBody.properties ?? []).every((row) => (DEV_SYNTHETIC_PROPERTY_IDS as readonly string[]).includes(row.id)), "dev fallback limited to seed properties");
  assert(!(devBody.properties ?? []).some((row) => row.id === "prop-99"), "non-seed property excluded in fallback");
  assert((devBody.reservations ?? []).every((row) => row.propertyId === "prop-1"), "fallback reservations stay on seed properties");

  const devProd = await listHousekeepingProofOptions({
    userId: mockDevHostUser().id,
    hostAuthSource: "dev-fallback",
    ownershipStore: createMemoryHostOwnershipStore({
      properties: { "prop-1": { hostId: HOST_A } },
    }),
    store: devStore,
    now: NOW,
    nodeEnv: "production",
  });
  assert(
    JSON.stringify(devProd.body) ===
      JSON.stringify({ ok: true, properties: [], reservations: [], pendingHousekeepingCount: 0 }),
    "dev fallback disabled in production",
  );

  assert(HOUSEKEEPING_PROOF_OPTIONS_PROPERTY_COLUMNS === "id, name, timezone, check_in, check_out", "property select mask");
  assert(HOUSEKEEPING_PROOF_OPTIONS_RESERVATION_COLUMNS === "id, property_id, check_in, check_out, status", "reservation select mask");
  assert(libSrc.includes('select(HOUSEKEEPING_PROOF_OPTIONS_PROPERTY_COLUMNS)'), "properties use the options mask");
  assert(libSrc.includes('select(HOUSEKEEPING_PROOF_OPTIONS_RESERVATION_COLUMNS)'), "reservations use the options mask");
  assert(!libSrc.includes('select("*")') && !libSrc.includes("select('*')"), "no select star");
  assert(
    HOUSEKEEPING_PROOF_OPTIONS_STAGES.join(",") === "post_checkout,ready_for_checkin",
    "eligibleStages allowlist exact",
  );

  assert(!/fetchListings/.test(source), "no fetchListings");
  assert(!/createBrowserClient|from\("@\/lib\/supabase"\)/.test(source), "no anonymous/browser Supabase");
  assert(!/stay-links|issueGuestStayLink|validateGuestStayToken|GUEST_STAY_PATH/.test(source), "no guest stay-links");
  assert(!/\/api\/housekeeping\/options(?!-)/.test(source.replaceAll("/api/housekeeping/proof-options", "")), "legacy options path unused");
  assert(!source.includes("/housekeeping/upload"), "no legacy upload");
  assert(!/getPublicUrl|HOUSEKEEPING_STORAGE_BUCKET/.test(source), "no public Storage");
  assert(!/console\.(log|info|debug|error|warn)/.test(source), "no console logging");
  assert(!/guest_name|"guest"|email|phone|address|access_code|wifi|lockbox|handbook|token_hash|created_by/.test(libSrc.replace(/HOUSEKEEPING_PROOF_OPTIONS_MAX_PROPERTIES/g, "")), "no forbidden field names in options lib");
  assert(!/storage_path|getPublicUrl|createSignedUrl/.test(source), "pending-review lookup never selects storage paths or signed URLs");
  assert(libSrc.includes("listOwnedPropertyIds"), "uses existing ownership list");
  assert(libSrc.includes("housekeepingProofWindows"), "uses existing window logic");
  assert(libSrc.includes("listTerminalIssueStages"), "terminal stages are loaded for issue eligibility");
  assert(libSrc.includes("HOUSEKEEPING_PROOF_OPTIONS_TERMINAL_TASK_STATUSES"), "approved and closed are explicit terminal statuses");
  assert(libSrc.includes("withoutTerminalStages"), "terminal stages are removed after merge");
  assert(
    libSrc.replace(/\r\n/g, "\n").includes("withoutTerminalStages(\n        mergeEligibleStages("),
    "terminal removal wraps window and pending merge",
  );
  assert(libSrc.includes('.in("status", [...HOUSEKEEPING_PROOF_OPTIONS_TERMINAL_TASK_STATUSES])'), "terminal lookup filters approved and closed");
  assert(!JSON.stringify(ok.body).includes("task_id") && !JSON.stringify(ok.body).includes("taskId"), "payload has no task id");
  assert(!JSON.stringify(ok.body).includes("reviewedBy") && !JSON.stringify(ok.body).includes("token_hash"), "payload has no reviewer or token fields");
  assert(!JSON.stringify(inWindowApproved.body).includes("approved"), "approved status is not returned to the client");
  assert(!JSON.stringify(inWindowClosed.body).includes("closed"), "closed status is not returned as a task status");
  const rpcSrc = readFileSync(join(here, "../../supabase/migrations/20260903001500_housekeeping_proof_issue_rpc.sql"), "utf8");
  assert(
    rpcSrc.includes("where public.housekeeping_proof_tasks.status in ('open', 'submitted', 'needs_attention')"),
    "issue RPC source remains untouched",
  );
  const cardSrc = readFileSync(join(here, "../components/dashboard/housekeeping-proof-link-card.tsx"), "utf8");
  assert(cardSrc.includes("canStartHousekeepingProofGenerate"), "host card generate gating is unchanged");
  assert(!cardSrc.includes("listTerminalIssueStages"), "host card remains untouched");
  assert(libSrc.includes("listPendingReviewStages"), "pending review stages are merged into options");
  assert(libSrc.includes("housekeeping_proof_tasks"), "pending lookup uses proof tasks");
  assert(libSrc.includes("housekeeping_proof_photos"), "pending lookup uses proof photos");
  assert(libSrc.includes('.eq("review_status", HOUSEKEEPING_PROOF_OPTIONS_PENDING_PHOTO_STATUS)'), "only pending photos keep a stay selectable");
  assert(!libSrc.includes("approved") || libSrc.includes("needs_attention"), "reviewable statuses stay explicit");
}

const isDirectRun = process.argv[1]?.includes("housekeeping-proof-options.test");
if (isDirectRun) {
  runHousekeepingProofOptionsTests()
    .then(() => {
      console.log("housekeeping-proof-options tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "housekeeping-proof-options tests failed");
      process.exitCode = 1;
    });
}
