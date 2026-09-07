import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GUEST_STAY_ACCESS_MAX_BODY_BYTES,
  GUEST_STAY_ACCESS_MAX_FIELD_CHARS,
  GUEST_STAY_ACCESS_PROPERTY_COLUMNS,
  createGuestStayAccessRateLimiter,
  createMemoryStayAccessStore,
  guestStayAccessContentLengthRejected,
  guestStayAccessJson,
  guestStayAccessPendingKeys,
  guestStayAccessReadyKeys,
  guestStayAccessSerializedBodyTooLarge,
  handleGuestStayAccess,
  stayAccessStartsAt,
} from "./guest-stay-access";
import {
  createMemoryStayTokenStore,
  generateStayToken,
  hashStayToken,
  issueGuestStayLink,
  parseStayTokenBody,
  stayExpiresAt,
  type StayPropertyRecord,
  type StayReservationRecord,
} from "./guest-stay-token";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const HOST = "00000000-0000-4000-8000-000000000001";
const NYC = "America/New_York";

const property: StayPropertyRecord = {
  id: "prop-access-1",
  name: "Bayview Loft",
  city: "Miami Beach",
  timezone: "UTC",
  checkInTime: "15:00",
  checkOutTime: "11:00",
};

const reservation: StayReservationRecord = {
  id: "res-access-1",
  property_id: "prop-access-1",
  check_in: "2026-09-10",
  check_in_time: "",
  check_out: "2026-09-14",
  check_out_time: "",
  status: "upcoming",
};

const nycProperty: StayPropertyRecord = {
  id: "prop-access-nyc",
  name: "Hudson Loft",
  city: "New York",
  timezone: NYC,
  checkInTime: "3:00 PM",
  checkOutTime: "11:00 AM",
};

const nycReservation: StayReservationRecord = {
  id: "res-access-nyc",
  property_id: "prop-access-nyc",
  check_in: "2026-09-10",
  check_in_time: "",
  check_out: "2026-09-14",
  check_out_time: "",
  status: "upcoming",
};

function accessRow(overrides: Record<string, unknown> = {}) {
  return {
    id: property.id,
    wifi_network: "Zencierge-Guest",
    wifi_password: "miami2026",
    door_code: "4920#",
    ...overrides,
  };
}

function unlimitedLimiter() {
  return { limited: () => false };
}

async function issueToken(input: {
  property: StayPropertyRecord;
  reservation: StayReservationRecord;
  now: Date;
}) {
  const store = createMemoryStayTokenStore({
    reservations: [input.reservation],
    properties: [input.property],
  });
  const created = await issueGuestStayLink({
    userId: HOST,
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [input.property.id],
    body: { reservationId: input.reservation.id },
    store,
    now: input.now,
  });
  assert(created.status === 200, "issue token");
  return { store, token: String(created.body.token) };
}

async function access(input: {
  tokenStore: ReturnType<typeof createMemoryStayTokenStore>;
  accessStore: ReturnType<typeof createMemoryStayAccessStore>;
  body: unknown;
  now: Date;
  ipKey?: string;
  contentLength?: number | null;
  ipLimiter?: { limited: (key: string) => boolean };
  tokenLimiter?: { limited: (key: string) => boolean };
}) {
  return handleGuestStayAccess({
    body: input.body,
    contentLength: input.contentLength,
    ipKey: input.ipKey ?? "test-ip",
    now: input.now,
    tokenStore: input.tokenStore,
    accessStore: input.accessStore,
    ipLimiter: input.ipLimiter ?? unlimitedLimiter(),
    tokenLimiter: input.tokenLimiter ?? unlimitedLimiter(),
  });
}

export async function runGuestStayAccessTests() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..");
  const libSrc = readFileSync(join(here, "guest-stay-access.ts"), "utf8");
  const routeSrc = readFileSync(join(root, "app/api/guest/stay-access/route.ts"), "utf8");
  const stayRouteSrc = readFileSync(join(root, "app/api/guest/stay/route.ts"), "utf8");
  const tokenSrc = readFileSync(join(here, "guest-stay-token.ts"), "utf8");
  const chatSrc = readFileSync(join(here, "guest-stay-chat.ts"), "utf8");
  const ttsSrc = readFileSync(join(here, "guest-stay-tts.ts"), "utf8");
  const elenaSrc = readFileSync(join(root, "components/guest/guest-elena-text-card.tsx"), "utf8");
  const shellSrc = readFileSync(join(root, "components/guest/guest-stay-shell.tsx"), "utf8");
  const hkProofSrc = readFileSync(join(here, "housekeeping-proof.ts"), "utf8");
  const hkOptionsSrc = readFileSync(join(here, "housekeeping-proof-options.ts"), "utf8");

  assert(GUEST_STAY_ACCESS_PROPERTY_COLUMNS === "id, wifi_network, wifi_password, door_code", "select mask");
  assert(libSrc.includes('select(GUEST_STAY_ACCESS_PROPERTY_COLUMNS)'), "supabase uses access column mask");
  assert(!/\bgate_code\b/.test(libSrc), "gate_code never selected");
  assert(!/\baccess_code\b/.test(libSrc), "reservations.access_code never selected");
  assert(!/parking|ai_handbook|assigned_phone|current_guest|lockbox|\balarm\b/.test(libSrc), "excluded listing fields absent");
  assert(!libSrc.includes("console."), "no console logging");
  assert(!routeSrc.includes("console."), "route has no console logging");
  assert(!/searchParams|URLSearchParams/.test(routeSrc), "token is not a query parameter");
  assert(routeSrc.includes("export async function POST"), "POST handler");
  assert(!/export async function (GET|PUT|PATCH|DELETE)/.test(routeSrc), "no GET or other secret surface");
  assert(routeSrc.includes("guestStayAccessJson"), "safe JSON helper");
  assert(libSrc.includes('"Cache-Control": "no-store"'), "no-store");
  assert(libSrc.includes('"Referrer-Policy": "no-referrer"'), "no-referrer");
  assert(!chatSrc.includes("guest-stay-access"), "chat does not import access");
  assert(!ttsSrc.includes("guest-stay-access"), "tts does not import access");
  assert(!elenaSrc.includes("guest-stay-access"), "Elena does not import access");
  assert(!shellSrc.includes("guest-stay-access"), "shell does not import access yet");
  assert(!stayRouteSrc.includes("stay-access") && !stayRouteSrc.includes("guest-stay-access"), "stay route untouched");
  assert(stayRouteSrc.includes("validateGuestStayToken"), "stay still validates public metadata");
  assert(!hkProofSrc.includes("guest-stay-access") && !hkOptionsSrc.includes("guest-stay-access"), "housekeeping untouched");
  assert(!libSrc.includes("guest-stay-chat") && !libSrc.includes("guest-stay-tts"), "access does not import chat/tts");
  assert(!libSrc.includes("guest-elena") && !routeSrc.includes("guest-elena"), "access does not import Elena");
  assert(!libSrc.includes("housekeeping-proof") && !routeSrc.includes("housekeeping-proof"), "no housekeeping imports");
  assert(!tokenSrc.includes("guest-stay-access"), "token module does not import access");
  assert(!/localStorage|sessionStorage/.test(libSrc + routeSrc), "no browser storage");
  assert(guestStayAccessPendingKeys().join(",") === "ok,status", "pending keys");
  assert(guestStayAccessReadyKeys().join(",") === "ok,status,wifiNetwork,wifiPassword,doorCode", "ready keys");

  assert("error" in parseStayTokenBody({ token: generateStayToken(), extra: true }), "extras rejected");
  assert("error" in parseStayTokenBody({}), "missing token rejected");
  assert("error" in parseStayTokenBody({ token: "   " }), "whitespace token rejected");
  assert("error" in parseStayTokenBody({ token: 1 }), "non-string token rejected");

  const beforeCheckIn = new Date("2026-09-10T14:59:59.000Z");
  const duringStay = new Date("2026-09-11T12:00:00.000Z");
  const issued = await issueToken({ property, reservation, now: beforeCheckIn });
  const accessStore = createMemoryStayAccessStore({ rows: { [property.id]: accessRow() } });

  const extra = await access({
    tokenStore: issued.store,
    accessStore,
    body: { token: issued.token, extra: true },
    now: duringStay,
  });
  assert(extra.status === 400 && extra.body.error === "invalid", "extra body key is invalid");
  assert(Object.keys(extra.body).join(",") === "error", "error body has only error");

  const empty = await access({
    tokenStore: issued.store,
    accessStore,
    body: {},
    now: duringStay,
  });
  assert(empty.status === 400 && empty.body.error === "invalid", "empty object invalid");

  const oversized = await access({
    tokenStore: issued.store,
    accessStore,
    body: { token: issued.token },
    contentLength: GUEST_STAY_ACCESS_MAX_BODY_BYTES + 1,
    now: duringStay,
  });
  assert(oversized.status === 400 && oversized.body.error === "invalid", "oversized content-length invalid");
  assert(guestStayAccessContentLengthRejected(GUEST_STAY_ACCESS_MAX_BODY_BYTES + 1), "content-length helper");
  assert(!guestStayAccessContentLengthRejected(null), "missing content-length allowed");
  assert(guestStayAccessSerializedBodyTooLarge({ pad: "x".repeat(GUEST_STAY_ACCESS_MAX_BODY_BYTES) }), "serialized oversized");

  const unknown = await access({
    tokenStore: issued.store,
    accessStore,
    body: { token: generateStayToken() },
    now: duringStay,
  });
  assert(unknown.status === 404 && unknown.body.error === "invalid", "unknown hash is invalid");

  const first = await issueToken({ property, reservation, now: duringStay });
  const replacement = await issueGuestStayLink({
    userId: HOST,
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: first.store,
    now: duringStay,
  });
  assert(replacement.status === 200, "replacement issued");
  const revoked = await access({
    tokenStore: first.store,
    accessStore,
    body: { token: first.token },
    now: duringStay,
  });
  assert(revoked.status === 410 && revoked.body.error === "revoked", "replaced token is revoked");

  const expiredStore = createMemoryStayTokenStore({ reservations: [reservation], properties: [property] });
  const raw = generateStayToken();
  expiredStore.tokens.push({
    id: "tok-expired",
    token_hash: hashStayToken(raw),
    reservation_id: reservation.id,
    property_id: property.id,
    expires_at: "2026-09-11T11:00:00.000Z",
    revoked_at: null,
    created_at: "2026-09-10T12:00:00.000Z",
    created_by: null,
  });
  const expired = await access({
    tokenStore: expiredStore,
    accessStore,
    body: { token: raw },
    now: duringStay,
  });
  assert(expired.status === 410 && expired.body.error === "expired", "expired token");

  const cancelable = { ...reservation, id: "res-canceled", status: "upcoming" };
  const canceledIssue = await issueToken({
    property,
    reservation: cancelable,
    now: new Date("2026-09-09T12:00:00.000Z"),
  });
  const liveCanceled = canceledIssue.store as ReturnType<typeof createMemoryStayTokenStore>;
  const cancelTarget = await liveCanceled.getReservation("res-canceled");
  assert(Boolean(cancelTarget), "canceled reservation exists");
  cancelTarget!.status = "canceled";
  const canceled = await access({
    tokenStore: canceledIssue.store,
    accessStore,
    body: { token: canceledIssue.token },
    now: duringStay,
  });
  assert(canceled.status === 409 && canceled.body.error === "unavailable", "canceled is unavailable");

  const mismatchStore = createMemoryStayTokenStore({
    reservations: [{ ...reservation, property_id: "other-prop" }],
    properties: [property, { ...property, id: "other-prop" }],
  });
  const mismatchToken = generateStayToken();
  mismatchStore.tokens.push({
    id: "tok-mismatch",
    token_hash: hashStayToken(mismatchToken),
    reservation_id: reservation.id,
    property_id: property.id,
    expires_at: "2026-09-14T11:00:00.000Z",
    revoked_at: null,
    created_at: "2026-09-10T12:00:00.000Z",
    created_by: null,
  });
  const mismatch = await access({
    tokenStore: mismatchStore,
    accessStore,
    body: { token: mismatchToken },
    now: duringStay,
  });
  assert(mismatch.status === 409 && mismatch.body.error === "unavailable", "property mismatch is unavailable");

  const pendingReads = createMemoryStayAccessStore({ rows: { [property.id]: accessRow() } });
  const pending = await access({
    tokenStore: issued.store,
    accessStore: pendingReads,
    body: { token: issued.token },
    now: beforeCheckIn,
  });
  assert(pending.status === 200, "pending http");
  assert(JSON.stringify(pending.body) === JSON.stringify({ ok: true, status: "pending" }), "exact pending payload");
  assert(Object.keys(pending.body).join(",") === "ok,status", "pending exact keys");
  assert(!("wifiNetwork" in pending.body) && !("wifiPassword" in pending.body) && !("doorCode" in pending.body), "pending has no access keys");
  assert(pendingReads.reads.length === 0, "secret query not called before check-in");

  const readyAtCheckIn = await access({
    tokenStore: issued.store,
    accessStore,
    body: { token: issued.token },
    now: new Date("2026-09-10T15:00:00.000Z"),
  });
  assert(readyAtCheckIn.status === 200 && readyAtCheckIn.body.status === "ready", "check-in boundary is ready");
  assert(Object.keys(readyAtCheckIn.body).join(",") === "ok,status,wifiNetwork,wifiPassword,doorCode", "ready exact keys");
  assert(readyAtCheckIn.body.ok === true, "ready ok");
  assert(readyAtCheckIn.body.wifiNetwork === "Zencierge-Guest", "wifi network");
  assert(readyAtCheckIn.body.wifiPassword === "miami2026", "wifi password untrimmed");
  assert(readyAtCheckIn.body.doorCode === "4920#", "door code");

  const checkoutInstant = stayExpiresAt({
    checkOutDate: reservation.check_out,
    checkOutTime: "11:00",
    timeZone: "UTC",
  });
  assert(checkoutInstant !== null, "checkout instant");
  const stillReady = await access({
    tokenStore: issued.store,
    accessStore,
    body: { token: issued.token },
    now: new Date(checkoutInstant!.getTime() - 1),
  });
  assert(stillReady.status === 200 && stillReady.body.status === "ready", "one ms before checkout is ready");
  const atCheckout = await access({
    tokenStore: issued.store,
    accessStore,
    body: { token: issued.token },
    now: checkoutInstant!,
  });
  assert(atCheckout.status === 410 && atCheckout.body.error === "expired", "checkout boundary is expired");

  const nycStart = stayAccessStartsAt({
    checkInDate: nycReservation.check_in,
    checkInTime: "3:00 PM",
    timeZone: NYC,
  });
  const nycEnd = stayExpiresAt({
    checkOutDate: nycReservation.check_out,
    checkOutTime: "11:00 AM",
    timeZone: NYC,
  });
  assert(nycStart !== null && nycEnd !== null, "nyc bounds");
  const nycIssued = await issueToken({
    property: nycProperty,
    reservation: nycReservation,
    now: new Date(nycStart!.getTime() - 60_000),
  });
  const nycAccess = createMemoryStayAccessStore({
    rows: { [nycProperty.id]: accessRow({ id: nycProperty.id, wifi_password: "  keep-spaces  " }) },
  });
  const nycPending = await access({
    tokenStore: nycIssued.store,
    accessStore: nycAccess,
    body: { token: nycIssued.token },
    now: new Date(nycStart!.getTime() - 1),
  });
  assert(nycPending.status === 200 && nycPending.body.status === "pending", "timezone before check-in is pending");
  assert(nycAccess.reads.length === 0, "timezone pending does not query secrets");
  const nycReady = await access({
    tokenStore: nycIssued.store,
    accessStore: nycAccess,
    body: { token: nycIssued.token },
    now: nycStart!,
  });
  assert(nycReady.status === 200 && nycReady.body.status === "ready", "timezone check-in is ready");
  assert(nycReady.body.wifiPassword === "  keep-spaces  ", "password characters preserved");
  const nycExpired = await access({
    tokenStore: nycIssued.store,
    accessStore: nycAccess,
    body: { token: nycIssued.token },
    now: nycEnd!,
  });
  assert(nycExpired.status === 410 && nycExpired.body.error === "expired", "timezone checkout is expired");

  const nulls = createMemoryStayAccessStore({
    rows: {
      [property.id]: {
        id: property.id,
        wifi_network: null,
        wifi_password: null,
        door_code: null,
      },
    },
  });
  const nullReady = await access({
    tokenStore: issued.store,
    accessStore: nulls,
    body: { token: issued.token },
    now: duringStay,
  });
  assert(nullReady.status === 200 && nullReady.body.status === "ready", "nulls become ready");
  assert(nullReady.body.wifiNetwork === "" && nullReady.body.wifiPassword === "" && nullReady.body.doorCode === "", "nulls become empty strings");

  const tooLong = "x".repeat(GUEST_STAY_ACCESS_MAX_FIELD_CHARS + 1);
  const longStore = createMemoryStayAccessStore({
    rows: { [property.id]: accessRow({ wifi_password: tooLong }) },
  });
  const longResult = await access({
    tokenStore: issued.store,
    accessStore: longStore,
    body: { token: issued.token },
    now: duringStay,
  });
  assert(longResult.status === 503 && longResult.body.error === "unavailable", "over-length value is unavailable");
  assert(!JSON.stringify(longResult.body).includes(tooLong), "over-length secret is not in error body");

  const exact128 = "y".repeat(GUEST_STAY_ACCESS_MAX_FIELD_CHARS);
  const exactStore = createMemoryStayAccessStore({
    rows: { [property.id]: accessRow({ door_code: exact128 }) },
  });
  const exactResult = await access({
    tokenStore: issued.store,
    accessStore: exactStore,
    body: { token: issued.token },
    now: duringStay,
  });
  assert(exactResult.status === 200 && exactResult.body.doorCode === exact128, "128-character value kept");

  const typed = createMemoryStayAccessStore({
    rows: { [property.id]: accessRow({ wifi_network: 12 }) },
  });
  const typedResult = await access({
    tokenStore: issued.store,
    accessStore: typed,
    body: { token: issued.token },
    now: duringStay,
  });
  assert(typedResult.status === 503 && typedResult.body.error === "unavailable", "wrong type is unavailable");

  const failStore = createMemoryStayAccessStore({ fail: true });
  const failResult = await access({
    tokenStore: issued.store,
    accessStore: failStore,
    body: { token: issued.token },
    now: duringStay,
  });
  assert(failResult.status === 503 && failResult.body.error === "unavailable", "query error is unavailable");
  assert(!("message" in failResult.body) && !("detail" in failResult.body) && !("hint" in failResult.body), "no db error fields");

  const throwStore = createMemoryStayAccessStore({ throwOnRead: true });
  const throwResult = await access({
    tokenStore: issued.store,
    accessStore: throwStore,
    body: { token: issued.token },
    now: duringStay,
  });
  assert(throwResult.status === 503 && throwResult.body.error === "unavailable", "throw is unavailable");
  assert(!JSON.stringify(throwResult.body).includes("store-throw"), "throw message not leaked");

  const json = guestStayAccessJson({ error: "unavailable" }, 503);
  assert(json.headers.get("Cache-Control") === "no-store", "json no-store");
  assert(json.headers.get("Referrer-Policy") === "no-referrer", "json no-referrer");
  assert((json.headers.get("Content-Type") ?? "").includes("application/json"), "json content-type");

  const ipLimiter = createGuestStayAccessRateLimiter(1, 60_000);
  const limited = await access({
    tokenStore: issued.store,
    accessStore,
    body: { token: issued.token },
    now: duringStay,
    ipLimiter,
    ipKey: "same-ip",
  });
  assert(limited.status === 200, "first request allowed");
  const limitedAgain = await access({
    tokenStore: issued.store,
    accessStore,
    body: { token: issued.token },
    now: duringStay,
    ipLimiter,
    ipKey: "same-ip",
  });
  assert(limitedAgain.status === 429 && limitedAgain.body.error === "unavailable", "ip rate limit is unavailable");
  assert(!JSON.stringify(limitedAgain.body).includes(issued.token), "rate-limit body has no token");
  assert(!JSON.stringify(limitedAgain.body).includes(hashStayToken(issued.token)), "rate-limit body has no hash");

  const tokenLimiter = createGuestStayAccessRateLimiter(1, 60_000);
  const tokenOk = await access({
    tokenStore: issued.store,
    accessStore,
    body: { token: issued.token },
    now: duringStay,
    tokenLimiter,
  });
  assert(tokenOk.status === 200, "first token request allowed");
  const tokenLimited = await access({
    tokenStore: issued.store,
    accessStore,
    body: { token: issued.token },
    now: duringStay,
    tokenLimiter,
  });
  assert(tokenLimited.status === 429 && tokenLimited.body.error === "unavailable", "token rate limit is unavailable");

  const combined = `${JSON.stringify(pending.body)}${JSON.stringify(failResult.body)}${JSON.stringify(throwResult.body)}`;
  assert(!combined.includes(issued.token), "responses omit raw token");
  assert(!combined.includes("miami2026") || pending.body.status === "pending", "pending omits password");
  assert(!JSON.stringify(pending.body).includes("miami2026"), "pending payload has no password");
  assert(!JSON.stringify(pending.body).includes("4920"), "pending payload has no door code");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-access.test");
if (isDirectRun) {
  void runGuestStayAccessTests()
    .then(() => {
      console.log("guest-stay-access tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "guest-stay-access tests failed");
      process.exitCode = 1;
    });
}
