import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryHostOwnershipStore } from "./host-property-ownership";
import { mockDevHostUser } from "./dev-host-session";
import {
  HOUSEKEEPING_PROOF_ISSUE_RATE_MAX,
  HOUSEKEEPING_PROOF_MAX_BODY_BYTES,
  HOUSEKEEPING_PROOF_PATH_PREFIX,
  HOUSEKEEPING_PROOF_PROPERTY_PUBLIC_COLUMNS,
  HOUSEKEEPING_PROOF_PROPERTY_WINDOW_COLUMNS,
  HOUSEKEEPING_PROOF_RESERVATION_COLUMNS,
  HOUSEKEEPING_PROOF_RPC,
  HOUSEKEEPING_PROOF_TASK_LOOKUP_COLUMNS,
  HOUSEKEEPING_PROOF_TOKEN_LOOKUP_COLUMNS,
  HOUSEKEEPING_PROOF_VALIDATE_RATE_MAX,
  createMemoryHousekeepingProofStore,
  generateHousekeepingProofToken,
  hashHousekeepingProofToken,
  housekeepingProofBodyTooLarge,
  housekeepingProofCreatedBy,
  housekeepingProofIssueRateKey,
  housekeepingProofJson,
  housekeepingProofValidateRateKey,
  housekeepingProofWindows,
  isValidHousekeepingProofTokenFormat,
  issueHousekeepingProofLink,
  mapHousekeepingProofIssueRpcCode,
  parseHousekeepingProofLinkBody,
  parseHousekeepingProofTokenBody,
  validateHousekeepingProofToken,
} from "./housekeeping-proof";
import { runHousekeepingProofIssueRpcTests } from "./housekeeping-proof-issue-rpc.test";
import { runHousekeepingProofSchemaTests } from "./housekeeping-proof-schema.test";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const AUTH_USER = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const reservation = {
  id: "res-hk-1",
  property_id: "prop-hk-1",
  check_in: "2026-09-10",
  check_out: "2026-09-14",
  status: "upcoming",
};

const property = {
  id: "prop-hk-1",
  name: "Bayview Loft",
  city: "Miami Beach",
  timezone: "UTC",
  checkInTime: "3:00 PM",
  checkOutTime: "11:00 AM",
};

function ownershipStore() {
  return createMemoryHostOwnershipStore({
    properties: { "prop-hk-1": { hostId: AUTH_USER } },
    reservations: { "res-hk-1": { propertyId: "prop-hk-1" } },
  });
}

function proofStore() {
  return createMemoryHousekeepingProofStore({
    reservations: [reservation],
    properties: [property],
  });
}

async function issue(overrides?: Record<string, unknown>) {
  return issueHousekeepingProofLink({
    userId: AUTH_USER,
    hostAuthSource: "supabase-auth",
    body: { reservationId: reservation.id, stage: "post_checkout" },
    ip: "203.0.113.10",
    now: new Date("2026-09-11T12:00:00.000Z"),
    store: proofStore(),
    ownershipStore: ownershipStore(),
    issueRateMap: new Map(),
    ...overrides,
  });
}

export async function runHousekeepingProofTests() {
  const here = dirname(fileURLToPath(import.meta.url));
  const libSrc = readFileSync(join(here, "housekeeping-proof.ts"), "utf8");
  const issueRouteSrc = readFileSync(join(here, "../app/api/housekeeping/proof-links/route.ts"), "utf8");
  const validateRouteSrc = readFileSync(join(here, "../app/api/housekeeping/proof/route.ts"), "utf8");
  const source = `${libSrc}\n${issueRouteSrc}\n${validateRouteSrc}`;

  assert("error" in parseHousekeepingProofLinkBody({ reservationId: "res-hk-1" }), "host body requires stage");
  assert("error" in parseHousekeepingProofLinkBody({ stage: "post_checkout" }), "host body requires reservationId");
  assert("error" in parseHousekeepingProofLinkBody({ reservationId: "res-hk-1", stage: "post_checkout", extra: true }), "host body rejects extra keys");
  assert("error" in parseHousekeepingProofLinkBody({ reservationId: "res-hk-1", stage: "during_stay" }), "unknown stage rejected");
  assert(
    !("error" in parseHousekeepingProofLinkBody({ reservationId: "res-hk-1", stage: "ready_for_checkin" })),
    "allowlisted host body accepted",
  );
  assert("error" in parseHousekeepingProofTokenBody({ token: generateHousekeepingProofToken(), extra: 1 }), "cleaner body rejects extra keys");
  assert("error" in parseHousekeepingProofTokenBody({}), "cleaner body requires token");
  assert(housekeepingProofBodyTooLarge(String(HOUSEKEEPING_PROOF_MAX_BODY_BYTES + 1)), "oversized content-length rejected");
  assert(housekeepingProofBodyTooLarge(null, { pad: "x".repeat(HOUSEKEEPING_PROOF_MAX_BODY_BYTES) }), "oversized JSON rejected");
  assert(!housekeepingProofBodyTooLarge("120", { reservationId: "res-hk-1", stage: "post_checkout" }), "small JSON accepted");

  const samples = new Set<string>();
  for (let i = 0; i < 8; i += 1) {
    const token = generateHousekeepingProofToken();
    assert(isValidHousekeepingProofTokenFormat(token), "generated token format");
    assert(!samples.has(token), "token uniqueness");
    samples.add(token);
    const digest = hashHousekeepingProofToken(token);
    assert(digest.length === 64 && digest === digest.toLowerCase(), "sha256 lowercase hex");
    assert(digest !== token && !digest.includes(token), "hash is not plaintext");
  }
  assert(!isValidHousekeepingProofTokenFormat("%%%"), "malformed token rejected");
  assert(!isValidHousekeepingProofTokenFormat("short"), "short token rejected");

  const unauth = await issue({ userId: null });
  assert(unauth.status === 401 && unauth.body.error === "invalid", "unauthenticated host rejected");

  const unowned = await issue({
    ownershipStore: createMemoryHostOwnershipStore({
      properties: { "prop-hk-1": { hostId: "22222222-2222-4222-8222-222222222222" } },
      reservations: { "res-hk-1": { propertyId: "prop-hk-1" } },
    }),
  });
  assert(unowned.status === 403 && unowned.body.error === "unavailable", "unowned reservation rejected");

  const canceledStore = createMemoryHousekeepingProofStore({
    reservations: [{ ...reservation, status: "canceled" }],
    properties: [property],
  });
  const canceled = await issue({ store: canceledStore });
  assert(canceled.status === 409 && canceled.body.error === "unavailable", "canceled reservation does not mint");
  assert(canceledStore.rpcCalls.length === 0, "canceled does not call RPC");

  const mismatch = await issue({
    store: createMemoryHousekeepingProofStore({
      reservations: [{ ...reservation, property_id: "prop-other" }],
      properties: [property],
    }),
  });
  assert(mismatch.status === 403 && mismatch.body.error === "unavailable", "mismatched property is unowned");

  const fallback = await issue({
    userId: mockDevHostUser().id,
    hostAuthSource: "dev-fallback",
    ownershipStore: createMemoryHostOwnershipStore({
      properties: { "prop-hk-1": { hostId: null } },
      reservations: { "res-hk-1": { propertyId: "prop-hk-1" } },
    }),
    nodeEnv: "development",
  });
  assert(fallback.status !== 200, "non-synthetic listing is unowned for dev fallback");
  assert(housekeepingProofCreatedBy(mockDevHostUser().id, "dev-fallback") === null, "dev fallback created_by is null");
  assert(housekeepingProofCreatedBy(AUTH_USER, "supabase-auth") === AUTH_USER, "authenticated UUID is created_by");
  assert(housekeepingProofCreatedBy("not-a-uuid", "supabase-auth") === null, "invalid UUID is not created_by");

  const fallbackOwned = await issue({
    userId: mockDevHostUser().id,
    hostAuthSource: "dev-fallback",
    body: { reservationId: "res-elena", stage: "post_checkout" },
    store: createMemoryHousekeepingProofStore({
      reservations: [{ ...reservation, id: "res-elena", property_id: "prop-1" }],
      properties: [{ ...property, id: "prop-1" }],
    }),
    ownershipStore: createMemoryHostOwnershipStore({
      properties: { "prop-1": { hostId: null } },
      reservations: { "res-elena": { propertyId: "prop-1" } },
    }),
    nodeEnv: "development",
  });
  assert(fallbackOwned.status === 200, "dev synthetic reservation can mint");
  const fallbackStore = createMemoryHousekeepingProofStore({
    reservations: [{ ...reservation, id: "res-elena", property_id: "prop-1" }],
    properties: [{ ...property, id: "prop-1" }],
  });
  const fallbackIssued = await issueHousekeepingProofLink({
    userId: mockDevHostUser().id,
    hostAuthSource: "dev-fallback",
    body: { reservationId: "res-elena", stage: "post_checkout" },
    ip: "127.0.0.1",
    now: new Date("2026-09-11T12:00:00.000Z"),
    store: fallbackStore,
    ownershipStore: createMemoryHostOwnershipStore({
      properties: { "prop-1": { hostId: null } },
      reservations: { "res-elena": { propertyId: "prop-1" } },
    }),
    nodeEnv: "development",
    issueRateMap: new Map(),
  });
  assert(fallbackIssued.status === 200, "dev fallback issue succeeds on synthetic ids");
  assert(fallbackStore.rpcCalls[0]?.createdBy === null, "dev fallback RPC created_by is null");

  const authStore = proofStore();
  const authed = await issue({ store: authStore, issueRateMap: new Map() });
  assert(authed.status === 200, "authenticated host can issue");
  assert(authStore.rpcCalls[0]?.createdBy === AUTH_USER, "real auth UUID is passed as created_by");
  assert(Object.keys(authed.body).sort().join(",") === "expiresAt,ok,path", "host response keys");
  assert(!("token" in authed.body), "host response has no token field");
  assert(String(authed.body.path).startsWith(HOUSEKEEPING_PROOF_PATH_PREFIX), "isolated housekeeping path");
  const issuedPath = String(authed.body.path);
  const issuedToken = issuedPath.slice(HOUSEKEEPING_PROOF_PATH_PREFIX.length);
  assert(isValidHousekeepingProofTokenFormat(issuedToken), "path contains the raw token");
  assert(authStore.rpcCalls[0]?.tokenHash === hashHousekeepingProofToken(issuedToken), "RPC receives hash of issued token");
  assert(!JSON.stringify(authStore.rpcCalls[0]).includes(issuedToken), "RPC args never include plaintext token");

  const submittedBlocked = await issue({
    store: createMemoryHousekeepingProofStore({
      reservations: [reservation],
      properties: [property],
      failRpcCode: "ZP004",
    }),
    issueRateMap: new Map(),
  });
  assert(submittedBlocked.status === 409 && submittedBlocked.body.error === "submitted", "submitted task cannot mint/rotate");
  assert(
    JSON.stringify(mapHousekeepingProofIssueRpcCode("ZP004")) === JSON.stringify({ status: 409, body: { error: "submitted" } }),
    "ZP004 maps to submitted conflict",
  );
  assert(libSrc.includes("HousekeepingProofIssueRpcError"), "issue RPC error class");
  assert(libSrc.includes('code === "ZP004"'), "maps ZP004 from store");

  const checkoutWindow = housekeepingProofWindows({
    stage: "post_checkout",
    reservation,
    property,
  });
  assert(checkoutWindow !== null, "checkout window parses");
  assert(authStore.rpcCalls[0]?.dueAt === checkoutWindow?.dueAt.toISOString(), "post_checkout dueAt is checkout boundary");
  assert(
    authStore.rpcCalls[0]?.expiresAt === checkoutWindow?.expiresAt.toISOString(),
    "post_checkout expiresAt is checkout + 24h",
  );
  assert(
    checkoutWindow!.expiresAt.getTime() - checkoutWindow!.dueAt.getTime() === 24 * 60 * 60 * 1000,
    "post_checkout window is 24 hours",
  );

  const checkinStore = proofStore();
  const checkin = await issue({
    store: checkinStore,
    body: { reservationId: reservation.id, stage: "ready_for_checkin" },
    now: new Date("2026-09-10T15:30:00.000Z"),
    issueRateMap: new Map(),
  });
  const checkinWindow = housekeepingProofWindows({
    stage: "ready_for_checkin",
    reservation,
    property,
  });
  assert(checkin.status === 200, "ready_for_checkin issues");
  assert(checkinStore.rpcCalls[0]?.dueAt === checkinWindow?.dueAt.toISOString(), "ready_for_checkin dueAt is check-in boundary");
  assert(
    checkinWindow!.expiresAt.getTime() - checkinWindow!.dueAt.getTime() === 2 * 60 * 60 * 1000,
    "ready_for_checkin window is 2 hours",
  );

  const pastStore = proofStore();
  const past = await issue({
    store: pastStore,
    now: new Date("2026-09-16T12:00:00.000Z"),
    issueRateMap: new Map(),
  });
  assert(past.status === 409 && past.body.error === "unavailable", "past expiration does not mint");
  assert(pastStore.rpcCalls.length === 0, "past window does not call RPC");

  const badTzStore = createMemoryHousekeepingProofStore({
    reservations: [reservation],
    properties: [{ ...property, timezone: "" }],
  });
  const badTz = await issue({ store: badTzStore, issueRateMap: new Map() });
  assert(badTz.status === 409 && badTzStore.rpcCalls.length === 0, "missing timezone does not invent a zone or mint");

  const reissueStore = proofStore();
  const first = await issue({ store: reissueStore, issueRateMap: new Map() });
  const second = await issue({ store: reissueStore, issueRateMap: new Map() });
  assert(first.status === 200 && second.status === 200, "reissue succeeds");
  assert(reissueStore.rpcCalls.length === 2, "reissue uses the same atomic RPC twice");
  assert(
    reissueStore.rpcCalls.every((call) => call.tokenHash && call.tokenHash !== call.reservationId),
    "each reissue sends a token hash",
  );

  const publicToken = generateHousekeepingProofToken();
  const publicHash = hashHousekeepingProofToken(publicToken);
  const validateStore = createMemoryHousekeepingProofStore({
    reservations: [reservation],
    properties: [property],
    tokens: [
      {
        task_id: TASK_ID,
        token_hash: publicHash,
        expires_at: "2026-09-15T15:00:00.000Z",
        revoked_at: null,
      },
    ],
    tasks: [
      {
        id: TASK_ID,
        property_id: property.id,
        stage: "post_checkout",
        status: "open",
        due_at: "2026-09-14T11:00:00.000Z",
      },
    ],
  });
  const valid = await validateHousekeepingProofToken({
    body: { token: publicToken },
    ip: "198.51.100.20",
    now: new Date("2026-09-14T12:00:00.000Z"),
    store: validateStore,
    validateRateMap: new Map(),
  });
  assert(valid.status === 200, "open task validates");
  assert(
    Object.keys(valid.body).sort().join(",") === "city,dueAt,hasPendingPhotos,ok,propertyName,stage,status",
    "public payload keys",
  );
  assert(valid.body.propertyName === property.name && valid.body.city === property.city, "public listing labels");
  assert(valid.body.stage === "post_checkout" && valid.body.status === "open", "public stage and status");
  assert(valid.body.hasPendingPhotos === false, "no pending photos by default");
  assert(!("token" in valid.body) && !("path" in valid.body) && !("task_id" in valid.body), "public payload omits ids and token");
  assert(!("reservationId" in valid.body) && !("guest" in valid.body) && !("wifi" in valid.body), "no sensitive public fields");

  const pendingStore = createMemoryHousekeepingProofStore({
    properties: [property],
    tokens: [
      {
        task_id: TASK_ID,
        token_hash: publicHash,
        expires_at: "2026-09-15T15:00:00.000Z",
        revoked_at: null,
      },
    ],
    tasks: [
      {
        id: TASK_ID,
        property_id: property.id,
        stage: "post_checkout",
        status: "open",
        due_at: "2026-09-14T11:00:00.000Z",
      },
    ],
    pendingPhotos: [{ task_id: TASK_ID, review_status: "pending" }],
  });
  const pendingValid = await validateHousekeepingProofToken({
    body: { token: publicToken },
    ip: "198.51.100.20",
    now: new Date("2026-09-14T12:00:00.000Z"),
    store: pendingStore,
    validateRateMap: new Map(),
  });
  assert(pendingValid.status === 200 && pendingValid.body.hasPendingPhotos === true, "hasPendingPhotos true with pending");

  const missing = await validateHousekeepingProofToken({
    body: { token: generateHousekeepingProofToken() },
    ip: "198.51.100.21",
    store: validateStore,
    validateRateMap: new Map(),
  });
  assert(missing.status === 404 && missing.body.error === "invalid", "missing token row is invalid");

  const revokedStore = createMemoryHousekeepingProofStore({
    properties: [property],
    tokens: [
      {
        task_id: TASK_ID,
        token_hash: publicHash,
        expires_at: "2026-09-15T15:00:00.000Z",
        revoked_at: "2026-09-14T10:00:00.000Z",
      },
    ],
    tasks: [{ id: TASK_ID, property_id: property.id, stage: "post_checkout", status: "open", due_at: "2026-09-14T11:00:00.000Z" }],
  });
  const revoked = await validateHousekeepingProofToken({
    body: { token: publicToken },
    ip: "198.51.100.22",
    now: new Date("2026-09-14T12:00:00.000Z"),
    store: revokedStore,
    validateRateMap: new Map(),
  });
  assert(revoked.status === 410 && revoked.body.error === "revoked", "revoked token");

  const expired = await validateHousekeepingProofToken({
    body: { token: publicToken },
    ip: "198.51.100.23",
    now: new Date("2026-09-16T12:00:00.000Z"),
    store: validateStore,
    validateRateMap: new Map(),
  });
  assert(expired.status === 410 && expired.body.error === "expired", "expired token");

  const closedStore = createMemoryHousekeepingProofStore({
    properties: [property],
    tokens: [
      {
        task_id: TASK_ID,
        token_hash: publicHash,
        expires_at: "2026-09-15T15:00:00.000Z",
        revoked_at: null,
      },
    ],
    tasks: [
      {
        id: TASK_ID,
        property_id: property.id,
        stage: "post_checkout",
        status: "closed",
        due_at: "2026-09-14T11:00:00.000Z",
      },
    ],
  });
  const closed = await validateHousekeepingProofToken({
    body: { token: publicToken },
    ip: "198.51.100.24",
    now: new Date("2026-09-14T12:00:00.000Z"),
    store: closedStore,
    validateRateMap: new Map(),
  });
  assert(closed.status === 409 && closed.body.error === "unavailable", "closed task is not an active portal");

  const approvedStore = createMemoryHousekeepingProofStore({
    properties: [property],
    tokens: [
      {
        task_id: TASK_ID,
        token_hash: publicHash,
        expires_at: "2026-09-15T15:00:00.000Z",
        revoked_at: null,
      },
    ],
    tasks: [
      {
        id: TASK_ID,
        property_id: property.id,
        stage: "post_checkout",
        status: "approved",
        due_at: "2026-09-14T11:00:00.000Z",
      },
    ],
  });
  const approved = await validateHousekeepingProofToken({
    body: { token: publicToken },
    ip: "198.51.100.25",
    now: new Date("2026-09-14T12:00:00.000Z"),
    store: approvedStore,
    validateRateMap: new Map(),
  });
  assert(approved.status === 200, "approved validation is 200");
  assert(JSON.stringify(approved.body) === JSON.stringify({ ok: true, status: "approved" }), "approved body is exactly ok,status");
  assert(Object.keys(approved.body).sort().join(",") === "ok,status", "approved keys are only ok and status");
  assert(!("propertyName" in approved.body) && !("city" in approved.body), "approved body has no property or city");
  assert(!("id" in approved.body) && !("task_id" in approved.body) && !("reservationId" in approved.body) && !("propertyId" in approved.body), "approved body has no ids");
  assert(!("path" in approved.body) && !("photo" in approved.body) && !("photos" in approved.body), "approved body has no paths or photos");
  assert(!("reviewedBy" in approved.body) && !("host" in approved.body), "approved body has no host fields");
  let propertyPublicReads = 0;
  const previousGetPropertyPublic = approvedStore.getPropertyPublic.bind(approvedStore);
  approvedStore.getPropertyPublic = async (id) => {
    propertyPublicReads += 1;
    return previousGetPropertyPublic(id);
  };
  const approvedAgain = await validateHousekeepingProofToken({
    body: { token: publicToken },
    ip: "198.51.100.26",
    now: new Date("2026-09-14T12:00:00.000Z"),
    store: approvedStore,
    validateRateMap: new Map(),
  });
  assert(approvedAgain.status === 200 && propertyPublicReads === 0, "approved validation does not load property public fields");
  const photoSrc = readFileSync(join(here, "housekeeping-proof-photo.ts"), "utf8");
  assert(
    photoSrc.includes('return status === "open" || status === "needs_attention"'),
    "approved remains forbidden by canUploadTaskStatus",
  );

  const issueMap = new Map<string, number[]>();
  for (let i = 0; i < HOUSEKEEPING_PROOF_ISSUE_RATE_MAX; i += 1) {
    const hit = await issue({ issueRateMap: issueMap, store: proofStore() });
    assert(hit.status === 200, "issue under rate limit");
  }
  const limited = await issue({ issueRateMap: issueMap, store: proofStore() });
  assert(limited.status === 429 && limited.body.error === "unavailable", "host issue rate limited");
  const otherIp = await issue({ issueRateMap: issueMap, ip: "203.0.113.99", store: proofStore() });
  assert(otherIp.status === 200, "host rate limit is per user and IP");
  assert([...issueMap.keys()].every((key) => key === housekeepingProofIssueRateKey(AUTH_USER, "203.0.113.10") || key === housekeepingProofIssueRateKey(AUTH_USER, "203.0.113.99")), "issue keys are user+ip");

  const validateMap = new Map<string, number[]>();
  for (let i = 0; i < HOUSEKEEPING_PROOF_VALIDATE_RATE_MAX; i += 1) {
    const hit = await validateHousekeepingProofToken({
      body: { token: publicToken },
      ip: "198.51.100.20",
      now: new Date("2026-09-14T12:00:00.000Z"),
      store: validateStore,
      validateRateMap: validateMap,
    });
    assert(hit.status === 200, "validate under rate limit");
  }
  const validateLimited = await validateHousekeepingProofToken({
    body: { token: publicToken },
    ip: "198.51.100.20",
    now: new Date("2026-09-14T12:00:00.000Z"),
    store: validateStore,
    validateRateMap: validateMap,
  });
  assert(validateLimited.status === 429, "cleaner validation rate limited");
  assert([...validateMap.keys()].every((key) => key === housekeepingProofValidateRateKey("198.51.100.20", publicHash)), "validate key is IP+hash");
  assert(![...validateMap.keys(), ...issueMap.keys()].some((key) => key.includes(publicToken) || key.includes(issuedToken)), "rate-limit keys never use raw token");

  const json = housekeepingProofJson({ ok: true }, 200);
  assert(json.headers.get("Cache-Control") === "no-store", "cache no-store");
  assert(json.headers.get("Referrer-Policy") === "no-referrer", "referrer no-referrer");

  assert(libSrc.includes("stayLinksPostOwnershipGate"), "uses proven ownership gate");
  assert(libSrc.includes("tryCreateSupabaseAdminClient"), "admin client is server-side");
  assert(libSrc.includes(`select(${"HOUSEKEEPING_PROOF_RESERVATION_COLUMNS"})`) || libSrc.includes("HOUSEKEEPING_PROOF_RESERVATION_COLUMNS"), "reservation select is masked");
  assert(HOUSEKEEPING_PROOF_RESERVATION_COLUMNS === "id, property_id, check_in, check_out, status", "reservation fields are status and dates only");
  assert(HOUSEKEEPING_PROOF_PROPERTY_WINDOW_COLUMNS === "id, timezone, check_in, check_out", "window property select");
  assert(HOUSEKEEPING_PROOF_PROPERTY_PUBLIC_COLUMNS === "name, city", "public property select");
  assert(HOUSEKEEPING_PROOF_TOKEN_LOOKUP_COLUMNS === "task_id, expires_at, revoked_at", "token lookup omits hash in the returned columns");
  assert(HOUSEKEEPING_PROOF_TASK_LOOKUP_COLUMNS === "id, property_id, stage, status, due_at", "task lookup is minimal");
  assert(!libSrc.includes('select("*")') && !libSrc.includes("select('*')"), "no select star");
  assert(!libSrc.includes("issueGuestStayLink") && !libSrc.includes("validateGuestStayToken"), "no guest-stay issue/validate imports");
  assert(!source.includes("/guest/s/"), "no guest stay path");
  assert(!source.includes("getPublicUrl") && !source.includes("/housekeeping/upload"), "no public storage or legacy upload");
  assert(!source.includes("housekeeping_photos") && !source.includes("housekeeping_reports"), "no legacy housekeeping tables");
  assert(!/console\.(log|info|debug|error|warn)/.test(source), "no console logging");
  assert(libSrc.includes(HOUSEKEEPING_PROOF_RPC), "atomic RPC name");
  const issuePost = issueRouteSrc.slice(issueRouteSrc.indexOf("export async function POST"));
  assert(issuePost.includes("requireHostAuthContext"), "host route authenticates");
  assert(issuePost.indexOf("housekeepingProofBodyTooLarge") < issuePost.indexOf("requireHostAuthContext"), "bounded body before auth");
  assert(issuePost.indexOf("requireHostAuthContext") < issuePost.indexOf("issueHousekeepingProofLink"), "auth before issue");
  assert(libSrc.includes('if (task.status === "approved")'), "approved is an explicit validate branch");
  assert(libSrc.indexOf('if (task.status === "approved")') < libSrc.indexOf("property = await input.store.getPropertyPublic"), "approved returns before property public lookup");
  assert(validateRouteSrc.includes("validateHousekeepingProofToken"), "cleaner route validates");
  assert(validateRouteSrc.includes("housekeepingProofBodyTooLarge"), "cleaner route bounds JSON");

  runHousekeepingProofSchemaTests();
  runHousekeepingProofIssueRpcTests();
}

const isDirectRun = process.argv[1]?.includes("housekeeping-proof.test");
if (isDirectRun) {
  runHousekeepingProofTests()
    .then(() => {
      console.log("housekeeping-proof tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "housekeeping-proof tests failed");
      process.exitCode = 1;
    });
}
