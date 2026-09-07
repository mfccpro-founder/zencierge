import {
  createMemoryStayTokenStore,
  createSupabaseStayTokenStore,
  extractStayLinksQueryDiagnostic,
  extractStayLinksPostDiagnostic,
  classifyStayTokenInsertForeignKey,
  generateStayToken,
  hashStayToken,
  isValidStayTokenFormat,
  issueGuestStayLink,
  listEligibleQrStaysForProperty,
  logStayLinksGetFailure,
  logStayLinksPostFailure,
  mapStayReservationFromLiveRow,
  parseStayLinkBody,
  parseStayTokenBody,
  publicStayHasForbiddenFields,
  publicStayMetadata,
  sanitizeStayLinksDiagnostic,
  sanitizeStayLinksPostDiagnostic,
  stayExpiresAt,
  stayLinksDiagnosticLooksPrivate,
  stayLinksFailureLogLine,
  stayLinksPostFailureLogLine,
  stayTokenCreatedBy,
  stayTokenCreatedByMode,
  validateGuestStayToken,
  withPropertyStayTimes,
  type StayPropertyRecord,
  type StayReservationRecord,
} from "./guest-stay-token";
import { isMockDevHostUserId, mockDevHostUser } from "./dev-host-session";
import { createMemoryHostOwnershipStore, stayLinksPostOwnershipGate } from "./host-property-ownership";
import type { SupabaseClient } from "@supabase/supabase-js";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const property: StayPropertyRecord = {
  id: "prop-stay-1",
  name: "Bayview Loft",
  city: "Miami Beach",
  timezone: "UTC",
};

const reservation: StayReservationRecord = {
  id: "res-stay-1",
  property_id: "prop-stay-1",
  check_in: "2026-09-10",
  check_in_time: "3:00 PM",
  check_out: "2026-09-14",
  check_out_time: "11:00 AM",
  status: "upcoming",
};

function seedStore(overrides?: { reservations?: StayReservationRecord[]; properties?: StayPropertyRecord[] }) {
  return createMemoryStayTokenStore({
    reservations: overrides?.reservations ?? [reservation],
    properties: overrides?.properties ?? [property],
  });
}

export async function runGuestStayTokenTests() {
  const samples = new Set<string>();
  for (let i = 0; i < 12; i += 1) {
    const token = generateStayToken();
    assert(isValidStayTokenFormat(token), "token format");
    assert(!samples.has(token), "token uniqueness");
    samples.add(token);
    const digest = hashStayToken(token);
    assert(digest.length === 64, "sha256 hex length");
    assert(digest !== token, "hash is not the raw token");
    assert(!digest.includes(token), "hash must not contain raw token");
  }

  assert("error" in parseStayLinkBody({ reservationId: "res-1", propertyId: "prop-1" }), "host body rejects propertyId");
  assert("error" in parseStayLinkBody({ reservationId: "res-1", expiresAt: "2026-09-14" }), "host body rejects expiration");
  assert("error" in parseStayLinkBody({ reservationId: "res-1", extra: true }), "host body rejects unknown keys");
  assert(!("error" in parseStayLinkBody({ reservationId: "res-stay-1" })), "host body allows reservationId only");
  assert("error" in parseStayTokenBody({ token: "abc", propertyId: "x" }), "guest body rejects extra keys");
  assert("error" in parseStayTokenBody({ token: "short" }), "malformed token rejected");

  const unauth = await issueGuestStayLink({
    userId: null,
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: seedStore(),
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(unauth.status === 401, "unauthenticated host creation rejected");

  const store = seedStore();
  const issued = await issueGuestStayLink({
    userId: "00000000-0000-4000-8000-000000000001",
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id, propertyId: "attacker-prop" } as unknown as { reservationId: string },
    store,
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(issued.status === 400 && issued.body.error === "invalid", "client cannot choose property");

  const created = await issueGuestStayLink({
    userId: "00000000-0000-4000-8000-000000000001",
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store,
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(created.status === 200, "valid issue");
  const token = String(created.body.token);
  assert(isValidStayTokenFormat(token), "issued token format");
  assert(created.body.path === `/guest/s/${token}`, "relative guest path");
  assert(store.tokens[0]?.created_by === null, "standard mock dev host inserts created_by null");
  assert(stayTokenCreatedBy(mockDevHostUser().id, "dev-fallback") === null, "mock id is null only because source is dev-fallback");
  assert(stayTokenCreatedBy(mockDevHostUser().id, "supabase-auth") === mockDevHostUser().id, "same mock-shaped UUID is kept when source is supabase-auth");
  const otherFallbackId = "22222222-2222-4222-8222-222222222222";
  assert(stayTokenCreatedBy(otherFallbackId, "dev-fallback") === null, "dev fallback with a different UUID still nulls created_by");
  assert(!("created_by" in created.body), "public issue body omits created_by");
  const createdKeys = Object.keys(created.body).sort().join(",");
  assert(createdKeys === "expiresAt,ok,path,token", "public successful response keys unchanged");
  assert(!store.tokens.some((row) => JSON.stringify(row).includes(token)), "only hash stored");
  assert(store.tokens.filter((row) => !row.revoked_at).length === 1, "one active token");
  assert(!publicStayHasForbiddenFields(created.body) || !("address" in created.body), "issue response has no private listing fields");
  assert(!("address" in created.body) && !("wifiPassword" in created.body) && !("doorCode" in created.body), "issue allowlist");

  const expectedExpiry = stayExpiresAt({
    checkOutDate: reservation.check_out,
    checkOutTime: reservation.check_out_time,
    timeZone: property.timezone,
  });
  assert(expectedExpiry?.toISOString() === created.body.expiresAt, "expiration from reservation checkout");

  const valid = await validateGuestStayToken({
    body: { token },
    store,
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(valid.status === 200, "valid active stay");
  assert(valid.body.status === "active", "portal status");
  assert(valid.body.propertyName === property.name, "display name");
  assert(valid.body.city === property.city, "city");
  assert(valid.body.checkIn === reservation.check_in && valid.body.checkOut === reservation.check_out, "stay dates");
  assert(!("address" in valid.body), "no address");
  assert(!("wifiPassword" in valid.body) && !("wifiNetwork" in valid.body), "no wifi");
  assert(!("doorCode" in valid.body) && !("gateCode" in valid.body) && !("accessCode" in valid.body), "no codes");
  assert(!("handbook" in valid.body) && !("phone" in valid.body) && !("email" in valid.body) && !("guest" in valid.body), "no PII");
  assert(!publicStayHasForbiddenFields(valid.body), "public allowlist");

  const meta = publicStayMetadata({ stayId: "stay-1", property, reservation });
  assert(!publicStayHasForbiddenFields(meta), "metadata helper allowlist");

  const expired = await validateGuestStayToken({
    body: { token },
    store,
    now: new Date("2026-09-14T16:00:00.000Z"),
  });
  assert(expired.status === 410 && expired.body.error === "expired", "expired stay");

  const replacement = await issueGuestStayLink({
    userId: "00000000-0000-4000-8000-000000000001",
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store,
    now: new Date("2026-09-11T13:00:00.000Z"),
  });
  assert(replacement.status === 200, "replacement issue");
  const nextToken = String(replacement.body.token);
  assert(nextToken !== token, "replacement token is new");
  const stale = await validateGuestStayToken({
    body: { token },
    store,
    now: new Date("2026-09-11T13:01:00.000Z"),
  });
  assert(stale.body.error === "revoked", "replacement revokes previous token");
  const fresh = await validateGuestStayToken({
    body: { token: nextToken },
    store,
    now: new Date("2026-09-11T13:01:00.000Z"),
  });
  assert(fresh.status === 200, "new token remains valid");
  assert(store.tokens.filter((row) => !row.revoked_at).length === 1, "only latest token active");

  const malformed = await validateGuestStayToken({ body: { token: "%%%" }, store });
  assert(malformed.body.error === "invalid", "malformed token");

  const canceledStore = seedStore({
    reservations: [{ ...reservation, status: "canceled" }],
  });
  const canceledIssue = await issueGuestStayLink({
    userId: "00000000-0000-4000-8000-000000000001",
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: canceledStore,
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(canceledIssue.body.error === "unavailable", "canceled reservation cannot issue");
  assert(canceledIssue.status === 409 && canceledIssue.diagnostic?.branch === "canceled", "canceled branch");
  assert(JSON.stringify(canceledIssue.body) === '{"error":"unavailable"}', "canceled public body unchanged");

  const mismatchStore = seedStore();
  const mismatchIssue = await issueGuestStayLink({
    userId: "00000000-0000-4000-8000-000000000001",
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: mismatchStore,
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  const mismatchToken = String(mismatchIssue.body.token);
  const tokenRow = mismatchStore.tokens.find((row) => row.token_hash === hashStayToken(mismatchToken));
  if (tokenRow) tokenRow.property_id = "other-prop";
  const mismatch = await validateGuestStayToken({
    body: { token: mismatchToken },
    store: mismatchStore,
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(mismatch.body.error === "unavailable", "reservation/property mismatch");

  const forbidden = await issueGuestStayLink({
    userId: "00000000-0000-4000-8000-000000000001",
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: ["someone-else"],
    body: { reservationId: reservation.id },
    store: seedStore(),
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(forbidden.status === 403 && forbidden.body.error === "forbidden", "mock host id still authorizes ownership (403, not 401)");

  const otherFallbackStore = seedStore();
  const otherFallbackIssued = await issueGuestStayLink({
    userId: otherFallbackId,
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: otherFallbackStore,
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(otherFallbackIssued.status === 200 && otherFallbackStore.tokens[0]?.created_by === null, "non-default fallback UUID stores created_by null");
  const otherForbidden = await issueGuestStayLink({
    userId: otherFallbackId,
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: ["someone-else"],
    body: { reservationId: reservation.id },
    store: seedStore(),
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(otherForbidden.status === 403, "fallback host still uses original id for ownership");

  const authUserId = "11111111-1111-4111-8111-111111111111";
  const authStore = seedStore();
  const authIssued = await issueGuestStayLink({
    userId: authUserId,
    hostAuthSource: "supabase-auth",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: authStore,
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(authIssued.status === 200 && authStore.tokens[0]?.created_by === authUserId, "verified Supabase Auth UUID remains in created_by");
  assert(!("created_by" in authIssued.body), "auth-user issue body still omits created_by");

  assert(stayTokenCreatedBy("not-a-uuid", "supabase-auth") === null && stayTokenCreatedBy("host", "supabase-auth") === null, "invalid id remains null");
  const invalidStore = seedStore();
  const invalidIssued = await issueGuestStayLink({
    userId: "not-a-uuid",
    hostAuthSource: "supabase-auth",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: invalidStore,
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(invalidIssued.status === 200 && invalidStore.tokens[0]?.created_by === null, "invalid host id stores created_by null");

  const envRecord = process.env as { NODE_ENV?: string };
  const previousNodeEnv = envRecord.NODE_ENV;
  let productionMock = true;
  try {
    envRecord.NODE_ENV = "production";
    productionMock = isMockDevHostUserId(mockDevHostUser().id);
  } finally {
    envRecord.NODE_ENV = previousNodeEnv;
  }
  assert(!productionMock, "predicate is false in production");
  assert(stayTokenCreatedBy(mockDevHostUser().id, "dev-fallback") === null, "test env still nulls mock created_by for dev-fallback");

  const liveMapped = mapStayReservationFromLiveRow({
    id: "qr-test-stay-20260901",
    property_id: property.id,
    check_in: "2026-09-01",
    check_out: "2026-09-03",
    status: "upcoming",
    guest_name: "omit-me",
    payout: 1,
    notes: "omit-me",
    phone: "omit-me",
  });
  assert(liveMapped?.id === "qr-test-stay-20260901" && liveMapped.check_in_time === "" && liveMapped.check_out_time === "", "live reservation maps without time columns");
  if (!liveMapped) throw new Error("live mapped reservation required");
  assert(!JSON.stringify(liveMapped).includes("omit-me"), "live reservation map drops contact fields");
  const timed = withPropertyStayTimes(liveMapped, {
    ...property,
    checkInTime: "3:00 PM",
    checkOutTime: "11:00 AM",
  });
  assert(timed.check_in_time === "3:00 PM" && timed.check_out_time === "11:00 AM", "times come from authorized property");

  const liveStore = seedStore({
    reservations: [liveMapped],
    properties: [{ ...property, checkInTime: "3:00 PM", checkOutTime: "11:00 AM" }],
  });
  const liveIssue = await issueGuestStayLink({
    userId: "00000000-0000-4000-8000-000000000001",
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: liveMapped.id },
    store: liveStore,
    now: new Date("2026-09-01T16:00:00.000Z"),
  });
  assert(liveIssue.status === 200, "token issue works without reservation time columns");
  const liveExpiry = stayExpiresAt({
    checkOutDate: "2026-09-03",
    checkOutTime: "11:00 AM",
    timeZone: property.timezone,
  });
  assert(liveIssue.body.expiresAt === liveExpiry?.toISOString(), "expiration uses property checkout time");

  const ownershipContinueStore = seedStore();
  const ownershipGate = await stayLinksPostOwnershipGate({
    reservationId: reservation.id,
    auth: { userId: authUserId, source: "supabase-auth" },
    store: createMemoryHostOwnershipStore({
      properties: { [property.id]: { hostId: authUserId } },
      reservations: { [reservation.id]: { propertyId: property.id } },
    }),
  });
  if (ownershipGate.kind !== "owned") throw new Error("owned reservation gate allows POST");
  const gatedIssue = await issueGuestStayLink({
    userId: authUserId,
    hostAuthSource: "supabase-auth",
    ownedPropertyIds: [ownershipGate.propertyId],
    body: { reservationId: reservation.id },
    store: ownershipContinueStore,
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(gatedIssue.status === 200 && ownershipContinueStore.tokens.length === 1, "owned reservation POST continues to token issue");

  const blockedIssueStore = seedStore();
  const blockedGate = await stayLinksPostOwnershipGate({
    reservationId: reservation.id,
    auth: { userId: authUserId, source: "supabase-auth" },
    store: createMemoryHostOwnershipStore({
      properties: { [property.id]: { hostId: "22222222-2222-4222-8222-222222222222" } },
      reservations: { [reservation.id]: { propertyId: property.id } },
    }),
  });
  assert(blockedGate.kind === "unowned", "other-host POST is unowned");
  assert(blockedIssueStore.tokens.length === 0, "unowned POST does not issue a token");

  const branches = [
    stayLinksFailureLogLine({ branch: "admin-missing", status: 503, errorName: "AdminMissing" }),
    stayLinksFailureLogLine({ branch: "listings-throw", status: 503, errorName: "ListingsThrow" }),
    stayLinksFailureLogLine({ branch: "authorization-error", status: 403, errorName: "Forbidden" }),
    stayLinksFailureLogLine({ branch: "ownership-unowned", status: 403, errorName: "Forbidden" }),
    stayLinksFailureLogLine({ branch: "ownership-unavailable", status: 503, errorName: "Unavailable" }),
    stayLinksFailureLogLine({ branch: "query-error", status: 503, errorName: "PostgrestError", postgrestCode: "PGRST204" }),
    stayLinksFailureLogLine({ branch: "payload-error", status: 500, errorName: "PayloadGuard" }),
    stayLinksFailureLogLine({ branch: "catch", status: 503, errorName: "Error" }),
  ];
  assert(branches[0]?.includes("branch=admin-missing") && branches[0].includes("status=503"), "admin-missing branch");
  assert(branches[1]?.includes("branch=listings-throw"), "listings-throw branch");
  assert(branches[2]?.includes("branch=authorization-error") && branches[2].includes("status=403"), "authorization-error branch");
  assert(branches[3]?.includes("branch=ownership-unowned") && branches[3].includes("status=403"), "ownership-unowned GET branch");
  assert(branches[4]?.includes("branch=ownership-unavailable") && branches[4].includes("status=503"), "ownership-unavailable GET branch");
  assert(branches[5]?.includes("branch=query-error") && branches[5].includes("postgrestCode=PGRST204"), "query-error branch");
  assert(branches[6]?.includes("branch=payload-error") && branches[6].includes("status=500"), "payload-error branch");
  assert(branches[7]?.includes("branch=catch"), "catch branch");
  assert(branches.every((line) => !stayLinksDiagnosticLooksPrivate(line)), "diagnostics omit forbidden field names");

  const leaked = extractStayLinksQueryDiagnostic({
    name: "PostgrestError",
    code: "PGRST204",
    message: "column guest_name of relation reservations does not exist",
    details: "qr-test-stay-20260901 Miami Beach 555-0100",
    hint: "token=abc address=1 phone=2",
  });
  const leakedJson = JSON.stringify(leaked);
  assert(leaked.branch === "query-error" && leaked.postgrestCode === "PGRST204", "query diagnostic keeps PostgREST code");
  assert(!leakedJson.includes("guest_name") && !leakedJson.includes("message") && !leakedJson.includes("qr-test"), "query diagnostic drops message and row data");
  const stripped = sanitizeStayLinksDiagnostic({
    branch: "query-error",
    status: 503,
    errorName: "PostgrestError",
    postgrestCode: "not-a-code",
  } as never);
  assert(!stripped.postgrestCode, "unsafe postgrest codes dropped");
  const unsafeLine = stayLinksFailureLogLine({
    branch: "catch",
    status: 503,
    errorName: "Error with token and email",
  });
  assert(unsafeLine.includes("errorName=Error") && !unsafeLine.includes("token") && !unsafeLine.includes("email"), "unsafe error names are replaced");

  const queryClient = {
    from() {
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        order() {
          return Promise.resolve({
            data: null,
            error: {
              name: "PostgrestError",
              code: "PGRST204",
              message: "secret column guest_name",
            },
          });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  const queryFail = await listEligibleQrStaysForProperty({
    admin: queryClient,
    propertyId: "prop-stay-1",
    now: new Date("2026-09-01T12:00:00.000Z"),
  });
  assert(queryFail.status === 503 && queryFail.body.error === "unavailable", "query failure stays generic to the browser");
  assert(JSON.stringify(queryFail.body) === '{"error":"unavailable"}', "browser body has no diagnostic");
  assert(queryFail.diagnostic?.branch === "query-error" && queryFail.diagnostic.postgrestCode === "PGRST204", "internal query diagnostic");

  const okClient = {
    from() {
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        order() {
          return Promise.resolve({
            data: [
              {
                id: "qr-test-stay-20260901",
                property_id: "prop-stay-1",
                check_in: "2026-09-01",
                check_out: "2026-09-03",
                status: "upcoming",
              },
            ],
            error: null,
          });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  const ok = await listEligibleQrStaysForProperty({
    admin: okClient,
    propertyId: "prop-stay-1",
    now: new Date("2026-09-01T12:00:00.000Z"),
  });
  assert(ok.status === 200 && Array.isArray(ok.body.stays) && !ok.diagnostic, "success body unchanged and unlogged");
  assert(JSON.stringify(Object.keys(ok.body)) === '["stays"]', "success payload remains stays only");

  const allowedPropertyMasks = [
    "id, name, city, timezone, check_in, check_out",
    "id, name, city, timezone",
    "id, name, city",
    "id",
  ];
  const privateSelectNeedle = /address|wifi|door|gate|handbook|phone|email|guest|token|lat|lng|secret/i;
  const schemaError = { code: "PGRST204", name: "PostgrestError" };

  function propertyLookupClient(resultsByMask: Record<string, { data: unknown; error: unknown | null }>) {
    const selects: string[] = [];
    const client = {
      from(table: string) {
        let mask = "";
        const q = {
          select(columns: string) {
            if (table === "properties") selects.push(columns);
            mask = columns;
            return q;
          },
          eq() {
            return q;
          },
          maybeSingle() {
            if (table !== "properties") return Promise.resolve({ data: null, error: null });
            return Promise.resolve(resultsByMask[mask] ?? { data: null, error: schemaError });
          },
        };
        return q;
      },
    } as unknown as SupabaseClient;
    return { client, selects };
  }

  function issueWithPropertyLookup(
    resultsByMask: Record<string, { data: unknown; error: unknown | null }>,
    stay: StayReservationRecord,
    ownedPropertyIds: string[],
  ) {
    const lookup = propertyLookupClient(resultsByMask);
    const supabaseStore = createSupabaseStayTokenStore(lookup.client);
    const mem = seedStore({ reservations: [stay] });
    return {
      selects: lookup.selects,
      run: () =>
        issueGuestStayLink({
          userId: "00000000-0000-4000-8000-000000000001",
          hostAuthSource: "dev-fallback",
          ownedPropertyIds,
          body: { reservationId: stay.id },
          store: {
            ...mem,
            getProperty: (propertyId) => supabaseStore.getProperty(propertyId),
          },
          now: new Date("2026-09-01T16:00:00.000Z"),
        }),
    };
  }

  const cityMaskOk = propertyLookupClient({
    "id, name, city, timezone, check_in, check_out": { data: null, error: schemaError },
    "id, name, city, timezone": { data: null, error: schemaError },
    "id, name, city": { data: { id: property.id, name: "Bayview Loft", city: "Miami Beach" }, error: null },
  });
  const cityMapped = await createSupabaseStayTokenStore(cityMaskOk.client).getProperty(property.id);
  assert(cityMapped?.id === property.id && cityMapped.name === "Bayview Loft" && cityMapped.city === "Miami Beach", "id/name/city mask maps");
  assert(cityMapped?.timezone === "UTC" && cityMapped.checkInTime === "" && cityMapped.checkOutTime === "", "missing timezone and times default safely");
  assert(cityMaskOk.selects[0] === allowedPropertyMasks[0] && cityMaskOk.selects[2] === allowedPropertyMasks[2], "progressive masks reach id/name/city");
  assert(cityMaskOk.selects.every((mask) => allowedPropertyMasks.includes(mask) && !privateSelectNeedle.test(mask)), "property selects stay on public masks");
  assert(!("address" in (cityMapped ?? {})) && !("wifiPassword" in (cityMapped ?? {})), "mapped property has no private fields");

  const idOnlyLookup = propertyLookupClient({
    "id, name, city, timezone, check_in, check_out": { data: null, error: schemaError },
    "id, name, city, timezone": { data: null, error: schemaError },
    "id, name, city": { data: null, error: schemaError },
    id: { data: { id: property.id }, error: null },
  });
  const idOnly = await createSupabaseStayTokenStore(idOnlyLookup.client).getProperty(property.id);
  assert(idOnly?.id === property.id && idOnly.name === "" && idOnly.city === "" && idOnly.timezone === "UTC", "id-only fallback succeeds safely");
  assert(idOnlyLookup.selects.at(-1) === "id", "falls through to id mask");

  const numericStay: StayReservationRecord = {
    ...liveMapped,
    property_id: "42",
  };
  const numericIssue = issueWithPropertyLookup(
    {
      "id, name, city, timezone, check_in, check_out": { data: { id: 42, name: "N", city: "C", timezone: "UTC" }, error: null },
    },
    numericStay,
    ["42"],
  );
  const numericCreated = await numericIssue.run();
  assert(numericCreated.status === 200, "numeric property id normalizes and matches textual reservation property_id");
  assert(numericIssue.selects.every((mask) => !privateSelectNeedle.test(mask)), "numeric lookup selects no private fields");

  const missingIssue = issueWithPropertyLookup(
    {
      "id, name, city, timezone, check_in, check_out": { data: null, error: null },
      "id, name, city, timezone": { data: null, error: null },
      "id, name, city": { data: null, error: null },
      id: { data: null, error: null },
    },
    liveMapped,
    [property.id],
  );
  const missing = await missingIssue.run();
  assert(missing.status === 409 && missing.body.error === "unavailable", "genuine missing property row remains 409");
  assert(missing.diagnostic?.branch === "property-load", "missing property uses property-load branch");

  const finalErrorLookup = propertyLookupClient({
    "id, name, city, timezone, check_in, check_out": { data: null, error: schemaError },
    "id, name, city, timezone": { data: null, error: schemaError },
    "id, name, city": { data: null, error: schemaError },
    id: { data: null, error: { code: "57014", name: "Error" } },
  });
  let storeThrew = false;
  try {
    await createSupabaseStayTokenStore(finalErrorLookup.client).getProperty(property.id);
  } catch (error) {
    storeThrew = error instanceof Error && error.message === "unavailable";
  }
  assert(storeThrew, "final id query error throws sanitized store failure");
  const finalErrorIssue = issueWithPropertyLookup(
    {
      "id, name, city, timezone, check_in, check_out": { data: null, error: schemaError },
      "id, name, city, timezone": { data: null, error: schemaError },
      "id, name, city": { data: null, error: schemaError },
      id: { data: null, error: { code: "57014", name: "Error" } },
    },
    liveMapped,
    [property.id],
  );
  const finalErrorResult = await finalErrorIssue.run();
  assert(finalErrorResult.status === 503 && JSON.stringify(finalErrorResult.body) === '{"error":"unavailable"}', "store throw is the POST 503 path");
  assert(finalErrorResult.diagnostic?.branch === "property-load", "final property query error is property-load");

  const sepStayIssue = issueWithPropertyLookup(
    {
      "id, name, city, timezone, check_in, check_out": { data: null, error: schemaError },
      "id, name, city, timezone": { data: null, error: schemaError },
      "id, name, city": { data: null, error: schemaError },
      id: { data: { id: property.id }, error: null },
    },
    liveMapped,
    [property.id],
  );
  const sepStay = await sepStayIssue.run();
  const sepExpiry = stayExpiresAt({
    checkOutDate: "2026-09-03",
    checkOutTime: "",
    timeZone: "UTC",
  });
  assert(sepStay.status === 200, "Sep 1–3 synthetic stay is not expired at end of Sep 1 UTC");
  assert(sepStay.body.expiresAt === sepExpiry?.toISOString(), "id-only property uses 23:59 checkout fallback");
  if (!sepExpiry) throw new Error("Sep 3 expiry required");
  assert(sepExpiry.getTime() > new Date("2026-09-01T16:00:00.000Z").getTime(), "Sep 3 23:59 UTC is after Sep 1 afternoon");
  assert(!sepStay.diagnostic, "successful POST issue has no diagnostic");

  const hostId = "00000000-0000-4000-8000-000000000001";
  const leaking = Object.assign(new Error("column guest_name token=abc address=1"), {
    name: "PostgrestError",
    code: "PGRST204",
    details: "qr-test-stay-20260901",
    hint: "created_by=host",
  });
  const reservationLoad = await issueGuestStayLink({
    userId: hostId,
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: {
      ...seedStore(),
      async getReservation() {
        throw leaking;
      },
    },
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(reservationLoad.status === 503 && JSON.stringify(reservationLoad.body) === '{"error":"unavailable"}', "reservation-load public body");
  assert(reservationLoad.diagnostic?.branch === "reservation-load" && reservationLoad.diagnostic.postgrestCode === "PGRST204", "reservation-load 503 branch");
  const reservationLoadLine = stayLinksPostFailureLogLine(reservationLoad.diagnostic!);
  assert(reservationLoadLine.startsWith("[stay-links-post] ") && reservationLoadLine.includes("branch=reservation-load"), "reservation-load log prefix");
  assert(!reservationLoadLine.includes("guest_name") && !reservationLoadLine.includes("token=") && !reservationLoadLine.includes("qr-test"), "reservation-load log has no row/token text");

  const propertyLoad = await issueGuestStayLink({
    userId: hostId,
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: {
      ...seedStore(),
      async getProperty() {
        throw leaking;
      },
    },
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(propertyLoad.status === 503 && JSON.stringify(propertyLoad.body) === '{"error":"unavailable"}', "property-load public body");
  assert(propertyLoad.diagnostic?.branch === "property-load", "property-load 503 branch");

  const mismatchProp = await issueGuestStayLink({
    userId: hostId,
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: {
      ...seedStore(),
      async getProperty() {
        return { ...property, id: "other-prop" };
      },
    },
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(mismatchProp.status === 409 && JSON.stringify(mismatchProp.body) === '{"error":"unavailable"}', "property-mismatch public body");
  assert(mismatchProp.diagnostic?.branch === "property-mismatch", "property-mismatch branch");

  const expiredIssue = await issueGuestStayLink({
    userId: hostId,
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: seedStore(),
    now: new Date("2026-09-14T16:00:00.000Z"),
  });
  assert(expiredIssue.status === 409 && JSON.stringify(expiredIssue.body) === '{"error":"expired"}', "expired public body");
  assert(expiredIssue.diagnostic?.branch === "expired", "expired branch");

  const revokeFail = await issueGuestStayLink({
    userId: hostId,
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: {
      ...seedStore(),
      async revokeActiveForReservation() {
        throw leaking;
      },
    },
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(revokeFail.status === 503 && JSON.stringify(revokeFail.body) === '{"error":"unavailable"}', "revoke-error public body");
  assert(revokeFail.diagnostic?.branch === "revoke-error", "revoke-error 503 branch");

  const insertFail = await issueGuestStayLink({
    userId: hostId,
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: {
      ...seedStore(),
      async insertToken() {
        throw leaking;
      },
    },
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(insertFail.status === 503 && JSON.stringify(insertFail.body) === '{"error":"unavailable"}', "insert-error public body");
  assert(insertFail.diagnostic?.branch === "insert-error", "insert-error 503 branch");
  assert(insertFail.diagnostic?.createdByMode === "null" && !insertFail.diagnostic.foreignKey, "non-23503 insert has createdByMode only");

  const leakedUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  function foreignKeyError(column: "created_by" | "reservation_id" | "property_id") {
    return {
      name: "PostgrestError",
      code: "23503",
      message: `insert or update on table "guest_stay_tokens" violates foreign key constraint "guest_stay_tokens_${column}_fkey"`,
      details: `Key (${column})=(${leakedUuid}) is not present in table "users".`,
      hint: "token=abc created_by=host",
    };
  }

  assert(classifyStayTokenInsertForeignKey(foreignKeyError("created_by")) === "created_by", "classifies created_by fkey");
  assert(classifyStayTokenInsertForeignKey(foreignKeyError("reservation_id")) === "reservation_id", "classifies reservation_id fkey");
  assert(classifyStayTokenInsertForeignKey(foreignKeyError("property_id")) === "property_id", "classifies property_id fkey");
  assert(
    classifyStayTokenInsertForeignKey({
      code: "23503",
      message: "guest_stay_tokens_created_by_fkey guest_stay_tokens_property_id_fkey",
    }) === "unknown",
    "multiple trusted names stay unknown",
  );
  assert(classifyStayTokenInsertForeignKey({ code: "23503", message: "no trusted names" }) === "unknown", "unmatched 23503 is unknown");

  const createdByFk = await issueGuestStayLink({
    userId: hostId,
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: {
      ...seedStore(),
      async insertToken() {
        throw foreignKeyError("created_by");
      },
    },
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(createdByFk.status === 503 && JSON.stringify(createdByFk.body) === '{"error":"unavailable"}', "23503 public body unchanged");
  assert(createdByFk.diagnostic?.foreignKey === "created_by" && createdByFk.diagnostic.createdByMode === "null", "23503 created_by with mock host mode null");
  const createdByFkLine = stayLinksPostFailureLogLine(createdByFk.diagnostic!);
  assert(
    createdByFkLine.includes("postgrestCode=23503") &&
      createdByFkLine.includes("foreignKey=created_by") &&
      createdByFkLine.includes("createdByMode=null"),
    "23503 log includes allowlisted fk and mode",
  );
  assert(!createdByFkLine.includes(leakedUuid) && !createdByFkLine.includes("token=") && !createdByFkLine.includes("users"), "23503 log redacts details");
  assert(!JSON.stringify(createdByFk.diagnostic).includes(leakedUuid), "diagnostic object drops leaked ids");

  const authFk = await issueGuestStayLink({
    userId: "11111111-1111-4111-8111-111111111111",
    hostAuthSource: "supabase-auth",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: {
      ...seedStore(),
      async insertToken() {
        throw foreignKeyError("reservation_id");
      },
    },
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(authFk.diagnostic?.foreignKey === "reservation_id" && authFk.diagnostic.createdByMode === "auth-uuid", "auth uuid mode with reservation fk");
  assert(stayTokenCreatedByMode("not-a-uuid", "supabase-auth") === "invalid", "invalid createdByMode");
  const invalidFk = await issueGuestStayLink({
    userId: "not-a-uuid",
    hostAuthSource: "supabase-auth",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store: {
      ...seedStore(),
      async insertToken() {
        throw foreignKeyError("property_id");
      },
    },
    now: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert(invalidFk.diagnostic?.foreignKey === "property_id" && invalidFk.diagnostic.createdByMode === "invalid", "invalid mode with property fk");
  const propertyFkLine = stayLinksPostFailureLogLine(invalidFk.diagnostic!);
  assert(!propertyFkLine.includes(leakedUuid) && !stayLinksDiagnosticLooksPrivate(propertyFkLine), "property fk log stays non-private");

  const catchLine = stayLinksPostFailureLogLine({ branch: "catch", status: 503, errorName: "Error" });
  assert(catchLine === "[stay-links-post] branch=catch status=503 errorName=Error", "catch log contract");
  const ownershipUnownedPost = stayLinksPostFailureLogLine({
    branch: "ownership-unowned",
    status: 403,
    errorName: "Forbidden",
  });
  const ownershipUnavailablePost = stayLinksPostFailureLogLine({
    branch: "ownership-unavailable",
    status: 503,
    errorName: "Unavailable",
  });
  assert(ownershipUnownedPost.includes("branch=ownership-unowned") && ownershipUnownedPost.includes("status=403"), "POST ownership-unowned log");
  assert(
    ownershipUnavailablePost.includes("branch=ownership-unavailable") && ownershipUnavailablePost.includes("status=503"),
    "POST ownership-unavailable log",
  );
  assert(!stayLinksDiagnosticLooksPrivate(ownershipUnownedPost) && !stayLinksDiagnosticLooksPrivate(ownershipUnavailablePost), "ownership logs omit private fields");

  const getLine = stayLinksFailureLogLine({ branch: "catch", status: 503, errorName: "Error" });
  const postLine = stayLinksPostFailureLogLine({ branch: "catch", status: 503, errorName: "Error" });
  assert(getLine.startsWith("[stay-links-get]") && postLine.startsWith("[stay-links-post]") && getLine !== postLine, "GET and POST loggers remain separate");
  assert(sanitizeStayLinksDiagnostic({ branch: "insert-error", status: 503, errorName: "Error" } as never).branch === "catch", "GET sanitizer rejects POST branches");
  assert(sanitizeStayLinksPostDiagnostic({ branch: "query-error", status: 503, errorName: "Error" } as never).branch === "catch", "POST sanitizer rejects GET branches");

  const dirtyPost = extractStayLinksPostDiagnostic("insert-error", 503, {
    name: "Error with token and email",
    code: "not a code",
    message: "secret",
    details: "row",
  });
  const dirtyLine = stayLinksPostFailureLogLine(dirtyPost);
  assert(!dirtyLine.includes("token") && !dirtyLine.includes("email") && !dirtyLine.includes("secret") && !dirtyLine.includes("not a code"), "unsafe POST codes and names stripped");
  assert(!stayLinksDiagnosticLooksPrivate(dirtyLine), "POST log has no forbidden keys");

  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(String(args[0]));
  };
  try {
    logStayLinksGetFailure({ branch: "query-error", status: 503, errorName: "PostgrestError", postgrestCode: "PGRST204" });
    logStayLinksPostFailure(insertFail.diagnostic!);
    assert(!created.diagnostic, "success diagnostic absent");
  } finally {
    console.error = originalError;
  }
  assert(logged.length === 2 && logged[0]?.startsWith("[stay-links-get]") && logged[1]?.startsWith("[stay-links-post]"), "GET and POST each emit one sanitized line");
  assert(logged[1]?.includes("branch=insert-error") && logged[1]?.includes("postgrestCode=PGRST204") && logged[1]?.includes("createdByMode=null"), "POST log keeps safe PostgREST code");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-token.test");
if (isDirectRun) {
  runGuestStayTokenTests()
    .then(() => {
      console.log("guest-stay-token tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "guest-stay-token tests failed");
      process.exitCode = 1;
    });
}
