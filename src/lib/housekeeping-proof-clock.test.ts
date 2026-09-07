import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { calendarToday } from "./dashboard-data";
import { createMemoryHostOwnershipStore } from "./host-property-ownership";
import {
  HOUSEKEEPING_PROOF_DEMO_LOCAL_HOUR,
  HOUSEKEEPING_PROOF_DEMO_TIMEZONE,
  HOUSEKEEPING_PROOF_STAGE_WINDOW_MS,
  housekeepingProofDemoInstant,
  housekeepingProofNow,
  housekeepingProofStageWindowMs,
  isHousekeepingProofDemoClockEnabled,
  rematerializeHousekeepingProofDemoExpiresAt,
} from "./housekeeping-proof-clock";
import {
  createMemoryHousekeepingProofStore,
  hashHousekeepingProofToken,
  housekeepingProofWindows,
  issueHousekeepingProofLink,
  validateHousekeepingProofToken,
} from "./housekeeping-proof";
import {
  createMemoryHousekeepingProofOptionsStore,
  housekeepingProofOptionsEligibleStages,
  listHousekeepingProofOptions,
} from "./housekeeping-proof-options";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const here = dirname(fileURLToPath(import.meta.url));
const HOST = "11111111-1111-4111-8111-111111111111";

const demoProperty = {
  id: "prop-demo-1",
  name: "Demo Loft",
  timezone: HOUSEKEEPING_PROOF_DEMO_TIMEZONE,
  checkInTime: "3:00 PM",
  checkOutTime: "11:00 AM",
  city: "Miami Beach",
};

/** Matches dashboard seed shape around calendarToday (arriving same day). */
const demoReservation = {
  id: "res-demo-1",
  property_id: "prop-demo-1",
  check_in: calendarToday,
  check_out: "2026-08-28",
  status: "arriving",
};

export function runHousekeepingProofClockTests() {
  const clockSrc = readFileSync(join(here, "housekeeping-proof-clock.ts"), "utf8");
  const optionsSrc = readFileSync(join(here, "housekeeping-proof-options.ts"), "utf8");
  const proofSrc = readFileSync(join(here, "housekeeping-proof.ts"), "utf8");
  const photoSrc = readFileSync(join(here, "housekeeping-proof-photo.ts"), "utf8");
  const cardSrc = readFileSync(join(here, "../components/dashboard/housekeeping-proof-link-card.tsx"), "utf8");

  assert(!/console\.(log|info|debug|warn|error)/.test(clockSrc), "clock has no logging");
  assert(clockSrc.includes("calendarToday"), "clock uses dashboard demonstration date");
  assert(clockSrc.includes('nodeEnv !== "production"') || clockSrc.includes("!== \"production\""), "production disables demo clock");
  assert(optionsSrc.includes("housekeepingProofNow"), "options uses shared clock");
  assert(proofSrc.includes("housekeepingProofNow"), "issue/validate use shared clock");
  assert(photoSrc.includes("housekeepingProofNow"), "upload uses shared clock");
  assert(cardSrc.includes('loadState === "ready"'), "controls still require ready state");
  assert(cardSrc.includes('setLoadState(parsed.reservations.length ? "ready" : "empty")'), "empty list still hides controls");
  assert(!cardSrc.includes("forceShow") && !cardSrc.includes("force-show"), "no forced button render");

  assert(isHousekeepingProofDemoClockEnabled("development") === true, "development enables demo clock");
  assert(isHousekeepingProofDemoClockEnabled("test") === true, "test enables demo clock");
  assert(isHousekeepingProofDemoClockEnabled("production") === false, "production disables demo clock");

  const demoNow = housekeepingProofNow({ nodeEnv: "development", timeZone: HOUSEKEEPING_PROOF_DEMO_TIMEZONE });
  const expected = housekeepingProofDemoInstant({
    date: calendarToday,
    timeZone: HOUSEKEEPING_PROOF_DEMO_TIMEZONE,
  });
  assert(demoNow.getTime() === expected.getTime(), "development now matches demo instant");
  assert(demoNow.getTime() === housekeepingProofNow({ nodeEnv: "development" }).getTime(), "default zone matches Florida demo zone");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSEKEEPING_PROOF_DEMO_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(demoNow);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  assert(`${read("year")}-${read("month")}-${read("day")}` === calendarToday, "demo clock lands on calendarToday locally");
  assert(Number(read("hour")) === HOUSEKEEPING_PROOF_DEMO_LOCAL_HOUR, "demo clock uses midday hour");

  const before = Date.now();
  const prodNow = housekeepingProofNow({ nodeEnv: "production" });
  const after = Date.now();
  assert(prodNow.getTime() >= before - 1000 && prodNow.getTime() <= after + 1000, "production uses wall clock");
  assert(Math.abs(prodNow.getTime() - demoNow.getTime()) > 24 * 60 * 60 * 1000, "production ignores demonstration date");

  const override = new Date("2030-01-01T00:00:00.000Z");
  assert(
    housekeepingProofNow({ now: override, nodeEnv: "development" }).getTime() === override.getTime(),
    "explicit now override wins in development",
  );
  assert(
    housekeepingProofNow({ now: override, nodeEnv: "production" }).getTime() === override.getTime(),
    "explicit now override wins in production",
  );

  const pastExpiry = new Date("2020-01-01T00:00:00.000Z");
  const wall = new Date("2026-09-04T20:00:00.000Z");
  const readyRemat = rematerializeHousekeepingProofDemoExpiresAt({
    stage: "ready_for_checkin",
    expiresAt: pastExpiry,
    nodeEnv: "development",
    wallNow: wall,
  });
  assert(
    readyRemat.getTime() === wall.getTime() + HOUSEKEEPING_PROOF_STAGE_WINDOW_MS.ready_for_checkin,
    "demo rematerialize uses ready_for_checkin 2h maximum",
  );
  assert(
    housekeepingProofStageWindowMs("ready_for_checkin") === 2 * 60 * 60 * 1000,
    "ready_for_checkin duration constant is 2 hours",
  );

  const checkoutRemat = rematerializeHousekeepingProofDemoExpiresAt({
    stage: "post_checkout",
    expiresAt: pastExpiry,
    nodeEnv: "development",
    wallNow: wall,
  });
  assert(
    checkoutRemat.getTime() === wall.getTime() + HOUSEKEEPING_PROOF_STAGE_WINDOW_MS.post_checkout,
    "demo rematerialize uses post_checkout 24h maximum",
  );
  assert(
    housekeepingProofStageWindowMs("post_checkout") === 24 * 60 * 60 * 1000,
    "post_checkout duration constant is 24 hours",
  );

  const futureExpiry = new Date(wall.getTime() + 60_000);
  assert(
    rematerializeHousekeepingProofDemoExpiresAt({
      stage: "ready_for_checkin",
      expiresAt: futureExpiry,
      nodeEnv: "development",
      wallNow: wall,
    }).getTime() === futureExpiry.getTime(),
    "demo does not rematerialize when expiry is still after wall clock",
  );

  assert(
    rematerializeHousekeepingProofDemoExpiresAt({
      stage: "ready_for_checkin",
      expiresAt: pastExpiry,
      nodeEnv: "production",
      wallNow: wall,
    }).getTime() === pastExpiry.getTime(),
    "production does not rematerialize an expired window",
  );
  assert(
    rematerializeHousekeepingProofDemoExpiresAt({
      stage: "ready_for_checkin",
      expiresAt: pastExpiry,
      nodeEnv: "development",
      hasExplicitNow: true,
      wallNow: wall,
    }).getTime() === pastExpiry.getTime(),
    "explicit now override keeps absolute expiry deterministic",
  );

  const stages = housekeepingProofOptionsEligibleStages(demoReservation, demoProperty, demoNow);
  assert(stages.includes("ready_for_checkin"), "local demo clock opens ready_for_checkin for calendarToday arrival");
  assert(stages.includes("post_checkout"), "local demo clock keeps post_checkout open before checkout");

  const wallFarFuture = new Date("2030-01-01T12:00:00.000Z");
  const expiredOnWall = housekeepingProofOptionsEligibleStages(demoReservation, demoProperty, wallFarFuture);
  assert(expiredOnWall.length === 0, "production-style wall clock past windows yields no stages");

  const ownership = createMemoryHostOwnershipStore({
    properties: { [demoProperty.id]: { hostId: HOST } },
    reservations: { [demoReservation.id]: { propertyId: demoProperty.id } },
  });
  const optionsStore = createMemoryHousekeepingProofOptionsStore({
    properties: [demoProperty],
    reservations: [demoReservation],
  });

  async function list(overrides: Record<string, unknown> = {}) {
    return listHousekeepingProofOptions({
      userId: HOST,
      hostAuthSource: "supabase-auth",
      ownershipStore: ownership,
      store: optionsStore,
      nodeEnv: "development",
      ...overrides,
    });
  }

  return list().then(async (devList) => {
    assert(devList.status === 200, "dev options 200");
    const body = devList.body as { reservations?: Array<{ id?: string; eligibleStages?: string[] }> };
    assert((body.reservations?.length ?? 0) === 1, "dev demo reservation is eligible");
    assert(body.reservations?.[0]?.id === demoReservation.id, "eligible id matches demo stay");
    assert(
      JSON.stringify(body.reservations?.[0]?.eligibleStages) === JSON.stringify(["post_checkout", "ready_for_checkin"]),
      "both stages open under demo clock",
    );

    const prodList = await list({ nodeEnv: "production", now: wallFarFuture });
    const prodBody = prodList.body as { reservations?: unknown[] };
    assert(prodList.status === 200 && (prodBody.reservations?.length ?? 0) === 0, "production far-future clock yields empty options");

    const canceled = await list({
      store: createMemoryHousekeepingProofOptionsStore({
        properties: [demoProperty],
        reservations: [{ ...demoReservation, status: "canceled" }],
      }),
    });
    assert((canceled.body as { reservations?: unknown[] }).reservations?.length === 0, "canceled stays remain ineligible");

    const terminal = await list({
      store: createMemoryHousekeepingProofOptionsStore({
        properties: [demoProperty],
        reservations: [demoReservation],
        terminal: [{ reservationId: demoReservation.id, propertyId: demoProperty.id, stage: "ready_for_checkin", status: "approved" }],
      }),
    });
    const terminalBody = terminal.body as { reservations?: Array<{ eligibleStages?: string[] }> };
    assert(
      JSON.stringify(terminalBody.reservations?.[0]?.eligibleStages) === JSON.stringify(["post_checkout"]),
      "approved stage remains unavailable while other open stage stays",
    );

    const bothTerminal = await list({
      store: createMemoryHousekeepingProofOptionsStore({
        properties: [demoProperty],
        reservations: [demoReservation],
        terminal: [
          { reservationId: demoReservation.id, propertyId: demoProperty.id, stage: "ready_for_checkin", status: "approved" },
          { reservationId: demoReservation.id, propertyId: demoProperty.id, stage: "post_checkout", status: "closed" },
        ],
      }),
    });
    assert((bothTerminal.body as { reservations?: unknown[] }).reservations?.length === 0, "all terminal stages yield empty list");

    const unowned = await listHousekeepingProofOptions({
      userId: HOST,
      hostAuthSource: "supabase-auth",
      ownershipStore: createMemoryHostOwnershipStore({
        properties: { "other-prop": { hostId: HOST } },
        reservations: { [demoReservation.id]: { propertyId: demoProperty.id } },
      }),
      store: optionsStore,
      nodeEnv: "development",
    });
    assert((unowned.body as { reservations?: unknown[] }).reservations?.length === 0, "ownership still required");

    const proofStore = createMemoryHousekeepingProofStore({
      reservations: [demoReservation],
      properties: [demoProperty],
    });
    const issued = await issueHousekeepingProofLink({
      userId: HOST,
      hostAuthSource: "supabase-auth",
      body: { reservationId: demoReservation.id, stage: "ready_for_checkin" },
      ip: "127.0.0.1",
      store: proofStore,
      ownershipStore: ownership,
      nodeEnv: "development",
      issueRateMap: new Map(),
    });
    assert(issued.status === 200, "demo clock allows issuance");
    const issuedBody = issued.body as { path?: string; expiresAt?: string };
    assert(typeof issuedBody.path === "string" && issuedBody.path.startsWith("/housekeeping/p/"), "issue returns relative path only");
    assert(!JSON.stringify(issued.body).includes(HOST), "issue body does not leak host id");
    const rpcExpires = Date.parse(String(proofStore.rpcCalls[0]?.expiresAt));
    assert(Number.isFinite(rpcExpires) && rpcExpires > Date.now(), "demo issue sends RPC expiry strictly after real wall clock");
    assert(
      Math.abs(rpcExpires - (Date.now() + HOUSEKEEPING_PROOF_STAGE_WINDOW_MS.ready_for_checkin)) < 5_000,
      "demo issue rematerializes ready_for_checkin to wall + 2h when absolute demo expiry is past",
    );
    assert(!JSON.stringify(issued.body).toLowerCase().includes("token"), "issue body has no token field name leak");

    const token = issuedBody.path!.slice("/housekeeping/p/".length);
    const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const validateStore = createMemoryHousekeepingProofStore({
      reservations: [demoReservation],
      properties: [demoProperty],
      tokens: [
        {
          token_hash: hashHousekeepingProofToken(token),
          task_id: taskId,
          expires_at: String(issuedBody.expiresAt),
          revoked_at: null,
        },
      ],
      tasks: [
        {
          id: taskId,
          property_id: demoProperty.id,
          stage: "ready_for_checkin",
          status: "open",
          due_at: proofStore.rpcCalls[0]!.dueAt,
        },
      ],
    });
    const validated = await validateHousekeepingProofToken({
      body: { token },
      ip: "127.0.0.1",
      store: validateStore,
      nodeEnv: "development",
      timeZone: demoProperty.timezone,
      validateRateMap: new Map(),
    });
    assert(validated.status === 200, "validate uses same demo clock as issue");

    const windows = housekeepingProofWindows({
      stage: "ready_for_checkin",
      reservation: demoReservation,
      property: demoProperty,
    });
    assert(Boolean(windows), "window computes for demo stay");
    const expiredIssue = await issueHousekeepingProofLink({
      userId: HOST,
      hostAuthSource: "supabase-auth",
      body: { reservationId: demoReservation.id, stage: "ready_for_checkin" },
      ip: "127.0.0.1",
      store: createMemoryHousekeepingProofStore({
        reservations: [demoReservation],
        properties: [demoProperty],
      }),
      ownershipStore: ownership,
      nodeEnv: "production",
      now: new Date(windows!.expiresAt.getTime() + 60_000),
      issueRateMap: new Map(),
    });
    assert(expiredIssue.status === 409, "production expired windows remain blocked");

    const postStore = createMemoryHousekeepingProofStore({
      reservations: [{ ...demoReservation, status: "departed" }],
      properties: [demoProperty],
    });
    const postIssued = await issueHousekeepingProofLink({
      userId: HOST,
      hostAuthSource: "supabase-auth",
      body: { reservationId: demoReservation.id, stage: "post_checkout" },
      ip: "127.0.0.1",
      store: postStore,
      ownershipStore: ownership,
      nodeEnv: "development",
      issueRateMap: new Map(),
    });
    assert(postIssued.status === 200, "demo post_checkout issuance succeeds");
    const postExpires = Date.parse(String(postStore.rpcCalls[0]?.expiresAt));
    assert(
      Number.isFinite(postExpires) &&
        Math.abs(postExpires - (Date.now() + HOUSEKEEPING_PROOF_STAGE_WINDOW_MS.post_checkout)) < 5_000,
      "demo post_checkout rematerializes to wall + 24h when absolute demo expiry is past",
    );

    const failStore = createMemoryHousekeepingProofStore({
      reservations: [demoReservation],
      properties: [demoProperty],
      failRpc: true,
    });
    const rpcFail = await issueHousekeepingProofLink({
      userId: HOST,
      hostAuthSource: "supabase-auth",
      body: { reservationId: demoReservation.id, stage: "ready_for_checkin" },
      ip: "127.0.0.1",
      store: failStore,
      ownershipStore: ownership,
      nodeEnv: "development",
      issueRateMap: new Map(),
    });
    assert(rpcFail.status === 503, "RPC failure returns sanitized unavailable");
    assert((rpcFail.body as { error?: string }).error === "unavailable", "RPC failure body is unavailable only");
    assert(!JSON.stringify(rpcFail.body).includes("/housekeeping/p/"), "RPC failure does not leak path/url");

    const synced = housekeepingProofNow({ nodeEnv: "development", timeZone: demoProperty.timezone }).getTime();
    assert(
      housekeepingProofNow({ nodeEnv: "development", timeZone: demoProperty.timezone }).getTime() === synced,
      "options/issue/validate share stable demo instant",
    );
  });
}

const isDirectRun = process.argv[1]?.includes("housekeeping-proof-clock.test");
if (isDirectRun) {
  runHousekeepingProofClockTests()
    .then(() => {
      console.log("housekeeping-proof-clock tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "housekeeping-proof-clock tests failed");
      process.exitCode = 1;
    });
}
