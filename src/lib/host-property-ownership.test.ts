import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMemoryHostOwnershipStore,
  createSupabaseHostOwnershipStore,
  DEV_SYNTHETIC_PROPERTY_IDS,
  DEV_SYNTHETIC_RESERVATION_IDS,
  hostOwnsProperty,
  hostOwnsReservation,
  isDevSyntheticPropertyId,
  isDevSyntheticReservationId,
  isHostOwnershipUuid,
  listOwnedPropertyIds,
  stayLinksPostOwnershipGate,
  type HostOwnershipAuth,
  type HostOwnershipStore,
} from "./host-property-ownership";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const HOST_A = "11111111-1111-4111-8111-111111111111";
const HOST_B = "22222222-2222-4222-8222-222222222222";
const REAL_AUTH: HostOwnershipAuth = { userId: HOST_A, source: "supabase-auth" };
const DEV_AUTH: HostOwnershipAuth = { userId: "00000000-0000-4000-8000-000000000001", source: "dev-fallback" };

function writeTrackingStore(inner: HostOwnershipStore) {
  const writes: string[] = [];
  const store = new Proxy(inner, {
    get(target, prop, receiver) {
      const key = String(prop);
      if (/insert|update|upsert|delete|rpc/i.test(key)) {
        writes.push(key);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { store: store as HostOwnershipStore, writes };
}

function sourceText() {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "host-property-ownership.ts"), "utf8");
}

export async function runHostPropertyOwnershipTests() {
  const matching = createMemoryHostOwnershipStore({
    properties: { "prop-live-1": { hostId: HOST_A } },
  });
  const owned = await hostOwnsProperty({
    propertyId: "prop-live-1",
    auth: REAL_AUTH,
    store: matching,
  });
  assert(owned.kind === "owned", "matching real host_id → owned");

  const nullHost = createMemoryHostOwnershipStore({
    properties: { "prop-live-1": { hostId: null } },
  });
  const nullResult = await hostOwnsProperty({
    propertyId: "prop-live-1",
    auth: REAL_AUTH,
    store: nullHost,
  });
  assert(nullResult.kind === "unowned", "null host_id → unowned");

  const otherHost = createMemoryHostOwnershipStore({
    properties: { "prop-live-1": { hostId: HOST_B } },
  });
  const otherResult = await hostOwnsProperty({
    propertyId: "prop-live-1",
    auth: REAL_AUTH,
    store: otherHost,
  });
  assert(otherResult.kind === "unowned", "different host_id → unowned");

  const throwingStore: HostOwnershipStore = {
    async lookupPropertyHostId() {
      throw new Error("should not query");
    },
    async lookupReservationPropertyId() {
      throw new Error("should not query");
    },
    async listPropertyIdsByHostId() {
      throw new Error("should not query");
    },
  };
  const invalidAuth = await hostOwnsProperty({
    propertyId: "prop-live-1",
    auth: { userId: "not-a-uuid", source: "supabase-auth" },
    store: throwingStore,
  });
  assert(invalidAuth.kind === "unowned", "invalid real auth id → unowned");
  const emptyAuth = await hostOwnsProperty({
    propertyId: "prop-live-1",
    auth: { userId: "", source: "supabase-auth" },
    store: throwingStore,
  });
  assert(emptyAuth.kind === "unowned", "empty real auth id → unowned");

  const reservationStore = createMemoryHostOwnershipStore({
    properties: { "prop-live-1": { hostId: HOST_A } },
    reservations: { "res-live-1": { propertyId: "prop-live-1" } },
  });
  const resOwned = await hostOwnsReservation({
    reservationId: "res-live-1",
    propertyId: "prop-live-1",
    auth: REAL_AUTH,
    store: reservationStore,
  });
  assert(resOwned.kind === "owned", "owned reservation through property → owned");

  const mismatch = await hostOwnsReservation({
    reservationId: "res-live-1",
    propertyId: "prop-other",
    auth: REAL_AUTH,
    store: reservationStore,
  });
  assert(mismatch.kind === "unowned", "reservation/property mismatch → unowned");

  const missingProperty = await hostOwnsProperty({
    propertyId: "prop-missing",
    auth: REAL_AUTH,
    store: matching,
  });
  assert(missingProperty.kind === "unowned", "missing property → unowned");
  const missingReservation = await hostOwnsReservation({
    reservationId: "res-missing",
    propertyId: "prop-live-1",
    auth: REAL_AUTH,
    store: reservationStore,
  });
  assert(missingReservation.kind === "unowned", "missing reservation → unowned");

  const queryErrorStore = createMemoryHostOwnershipStore({
    properties: { "prop-live-1": { hostId: HOST_A } },
    reservations: { "res-live-1": { propertyId: "prop-live-1" } },
    failPropertyIds: new Set(["prop-live-1"]),
    failReservationIds: new Set(["res-fail"]),
  });
  const propertyUnavailable = await hostOwnsProperty({
    propertyId: "prop-live-1",
    auth: REAL_AUTH,
    store: queryErrorStore,
  });
  assert(propertyUnavailable.kind === "unavailable", "property query error → unavailable");
  const reservationUnavailable = await hostOwnsReservation({
    reservationId: "res-fail",
    propertyId: "prop-live-1",
    auth: REAL_AUTH,
    store: queryErrorStore,
  });
  assert(reservationUnavailable.kind === "unavailable", "reservation query error → unavailable");
  const thrownUnavailable = await hostOwnsProperty({
    propertyId: "prop-live-1",
    auth: REAL_AUTH,
    store: throwingStore,
  });
  assert(thrownUnavailable.kind === "unavailable", "thrown query → unavailable not unowned");

  const seedProperty = await hostOwnsProperty({
    propertyId: DEV_SYNTHETIC_PROPERTY_IDS[0],
    auth: DEV_AUTH,
    store: throwingStore,
    nodeEnv: "development",
  });
  assert(seedProperty.kind === "owned", "explicit synthetic property owned in non-production dev-fallback");

  const seedReservationStore = createMemoryHostOwnershipStore({
    reservations: { [DEV_SYNTHETIC_RESERVATION_IDS[0]]: { propertyId: DEV_SYNTHETIC_PROPERTY_IDS[0] } },
  });
  const seedReservation = await hostOwnsReservation({
    reservationId: DEV_SYNTHETIC_RESERVATION_IDS[0],
    propertyId: DEV_SYNTHETIC_PROPERTY_IDS[0],
    auth: DEV_AUTH,
    store: seedReservationStore,
    nodeEnv: "test",
  });
  assert(seedReservation.kind === "owned", "explicit synthetic reservation owned in non-production dev-fallback");

  const liveOnSeedStore = createMemoryHostOwnershipStore({
    reservations: { "res-live-on-seed": { propertyId: DEV_SYNTHETIC_PROPERTY_IDS[0] } },
  });
  const liveOnSeed = await hostOwnsReservation({
    reservationId: "res-live-on-seed",
    propertyId: DEV_SYNTHETIC_PROPERTY_IDS[0],
    auth: DEV_AUTH,
    store: liveOnSeedStore,
    nodeEnv: "development",
  });
  assert(liveOnSeed.kind === "owned", "live non-seed reservation id on an allowed dev property → owned");
  const liveOnSeedGate = await stayLinksPostOwnershipGate({
    reservationId: "res-live-on-seed",
    propertyId: DEV_SYNTHETIC_PROPERTY_IDS[0],
    auth: DEV_AUTH,
    store: liveOnSeedStore,
    nodeEnv: "development",
  });
  assert(liveOnSeedGate.kind === "owned", "matching caller property → POST gate owned");

  const liveOnArbitrary = await hostOwnsReservation({
    reservationId: "res-live-on-arbitrary",
    propertyId: "prop-arbitrary-null",
    auth: DEV_AUTH,
    store: createMemoryHostOwnershipStore({
      reservations: { "res-live-on-arbitrary": { propertyId: "prop-arbitrary-null" } },
    }),
    nodeEnv: "development",
  });
  assert(liveOnArbitrary.kind === "unowned", "reservation on arbitrary property → unowned");

  const missingDevReservation = await hostOwnsReservation({
    reservationId: "res-missing-dev",
    propertyId: DEV_SYNTHETIC_PROPERTY_IDS[0],
    auth: DEV_AUTH,
    store: liveOnSeedStore,
    nodeEnv: "development",
  });
  assert(missingDevReservation.kind === "unowned", "missing reservation → unowned");

  const liveMismatch = await hostOwnsReservation({
    reservationId: "res-live-on-seed",
    propertyId: DEV_SYNTHETIC_PROPERTY_IDS[1],
    auth: DEV_AUTH,
    store: liveOnSeedStore,
    nodeEnv: "development",
  });
  assert(liveMismatch.kind === "unowned", "caller property mismatch → unowned");

  const liveQueryError = await hostOwnsReservation({
    reservationId: "res-fail",
    propertyId: DEV_SYNTHETIC_PROPERTY_IDS[0],
    auth: DEV_AUTH,
    store: queryErrorStore,
    nodeEnv: "development",
  });
  assert(liveQueryError.kind === "unavailable", "query error → unavailable");

  const arbitraryNull = createMemoryHostOwnershipStore({
    properties: { "prop-arbitrary-null": { hostId: null } },
  });
  const arbitraryResult = await hostOwnsProperty({
    propertyId: "prop-arbitrary-null",
    auth: DEV_AUTH,
    store: arbitraryNull,
    nodeEnv: "development",
  });
  assert(arbitraryResult.kind === "unowned", "arbitrary null-host row under dev-fallback → unowned");

  const prodFallbackProperty = await hostOwnsProperty({
    propertyId: DEV_SYNTHETIC_PROPERTY_IDS[0],
    auth: DEV_AUTH,
    store: throwingStore,
    nodeEnv: "production",
  });
  assert(prodFallbackProperty.kind === "unowned", "production disables property dev fallback");
  const prodFallbackReservation = await hostOwnsReservation({
    reservationId: DEV_SYNTHETIC_RESERVATION_IDS[0],
    propertyId: DEV_SYNTHETIC_PROPERTY_IDS[0],
    auth: DEV_AUTH,
    store: seedReservationStore,
    nodeEnv: "production",
  });
  assert(prodFallbackReservation.kind === "unowned", "production disables reservation dev fallback");

  const tracked = writeTrackingStore(matching);
  await hostOwnsProperty({ propertyId: "prop-live-1", auth: REAL_AUTH, store: tracked.store });
  await hostOwnsReservation({
    reservationId: "res-live-1",
    propertyId: "prop-live-1",
    auth: REAL_AUTH,
    store: tracked.store,
  });
  assert(tracked.writes.length === 0, "helper performs no insert/update/upsert/delete");

  const src = sourceText();
  assert(!/\.insert\s*\(/.test(src), "source has no insert");
  assert(!/\.update\s*\(/.test(src), "source has no update");
  assert(!/\.upsert\s*\(/.test(src), "source has no upsert");
  assert(!/\.delete\s*\(/.test(src), "source has no delete");
  assert(!/\bconsole\s*\./.test(src), "source has no console logging");
  assert(!src.includes("@/lib/supabase\""), "does not import anonymous supabase client");
  assert(!src.includes("@/lib/supabase'"), "does not import anonymous supabase client");
  assert(!/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY/.test(src), "no secret names in helper source");
  assert(src.includes('select("host_id")'), "property lookup selects host_id only");
  assert(src.includes('select("property_id")'), "reservation lookup selects property_id only");

  assert(isHostOwnershipUuid(HOST_A), "uuid helper accepts valid id");
  assert(!isHostOwnershipUuid("prop-1"), "uuid helper rejects seed text ids");
  assert(isDevSyntheticPropertyId("prop-1"), "seed property allowlist");
  assert(!isDevSyntheticPropertyId("prop-arbitrary-null"), "non-seed property not allowlisted");
  assert(isDevSyntheticReservationId("res-elena"), "seed reservation allowlist");
  assert(!isDevSyntheticReservationId("res-arbitrary"), "non-seed reservation not allowlisted");

  const fakeClient = {
    from() {
      throw new Error("supabase client must not be used in these tests");
    },
  };
  const supabaseStore = createSupabaseHostOwnershipStore(fakeClient as never);
  assert(typeof supabaseStore.lookupPropertyHostId === "function", "supabase store is read lookup only");
  assert(typeof supabaseStore.listPropertyIdsByHostId === "function", "supabase store lists by host_id");

  const mixedListStore = createMemoryHostOwnershipStore({
    properties: {
      "prop-mine": { hostId: HOST_A },
      "prop-other": { hostId: HOST_B },
      "prop-null": { hostId: null },
    },
    reservations: {
      "res-mine": { propertyId: "prop-mine" },
      "res-other": { propertyId: "prop-other" },
      "res-null": { propertyId: "prop-null" },
      "res-mismatch": { propertyId: "prop-mine" },
    },
  });
  const listedMine = await listOwnedPropertyIds({ auth: REAL_AUTH, store: mixedListStore });
  if (listedMine.kind !== "ids") throw new Error("real host sees only matching host_id properties");
  assert(listedMine.ids.length === 1 && listedMine.ids[0] === "prop-mine", "real host sees only matching host_id properties");
  assert(!listedMine.ids.includes("prop-null") && !listedMine.ids.includes("prop-other"), "null-host and other-host properties excluded");

  const listError = await listOwnedPropertyIds({
    auth: REAL_AUTH,
    store: createMemoryHostOwnershipStore({ failList: true }),
  });
  assert(listError.kind === "unavailable", "GET ownership query error → unavailable not empty success");

  const invalidList = await listOwnedPropertyIds({
    auth: { userId: "not-a-uuid", source: "supabase-auth" },
    store: throwingStore,
  });
  assert(invalidList.kind === "ids" && invalidList.ids.length === 0, "invalid auth id → no owned properties");

  const ownedGate = await stayLinksPostOwnershipGate({
    reservationId: "res-mine",
    auth: REAL_AUTH,
    store: mixedListStore,
  });
  assert(ownedGate.kind === "owned" && ownedGate.propertyId === "prop-mine", "owned reservation POST continues");

  const otherGate = await stayLinksPostOwnershipGate({
    reservationId: "res-other",
    auth: REAL_AUTH,
    store: mixedListStore,
  });
  assert(otherGate.kind === "unowned", "other-host POST → unowned before token issue");
  const nullGate = await stayLinksPostOwnershipGate({
    reservationId: "res-null",
    auth: REAL_AUTH,
    store: mixedListStore,
  });
  assert(nullGate.kind === "unowned", "null-host POST → unowned before token issue");
  const mismatchGate = await stayLinksPostOwnershipGate({
    reservationId: "res-mismatch",
    propertyId: "prop-other",
    auth: REAL_AUTH,
    store: mixedListStore,
  });
  assert(mismatchGate.kind === "unowned", "mismatch POST → unowned before token issue");

  const unavailableGate = await stayLinksPostOwnershipGate({
    reservationId: "res-fail",
    auth: REAL_AUTH,
    store: queryErrorStore,
  });
  assert(unavailableGate.kind === "unavailable", "unavailable ownership query → not unowned");

  const seedList = await listOwnedPropertyIds({
    auth: DEV_AUTH,
    store: throwingStore,
    nodeEnv: "development",
  });
  if (seedList.kind !== "ids") throw new Error("non-production dev-fallback lists explicit seed properties");
  assert(
    DEV_SYNTHETIC_PROPERTY_IDS.every((id) => seedList.ids.includes(id)),
    "non-production dev-fallback lists explicit seed properties",
  );
  assert(!seedList.ids.includes("prop-arbitrary-null"), "arbitrary dev property remains forbidden");

  const seedGate = await stayLinksPostOwnershipGate({
    reservationId: DEV_SYNTHETIC_RESERVATION_IDS[0],
    auth: DEV_AUTH,
    store: seedReservationStore,
    nodeEnv: "development",
  });
  assert(seedGate.kind === "owned", "non-production dev-fallback seed reservation still works");

  const arbitraryGate = await stayLinksPostOwnershipGate({
    reservationId: "res-arbitrary",
    auth: DEV_AUTH,
    store: createMemoryHostOwnershipStore({
      properties: { "prop-arbitrary-null": { hostId: null } },
      reservations: { "res-arbitrary": { propertyId: "prop-arbitrary-null" } },
    }),
    nodeEnv: "development",
  });
  assert(arbitraryGate.kind === "unowned", "arbitrary dev property remains forbidden on POST");

  const prodList = await listOwnedPropertyIds({
    auth: DEV_AUTH,
    store: throwingStore,
    nodeEnv: "production",
  });
  assert(prodList.kind === "ids" && prodList.ids.length === 0, "production disables GET dev fallback");
  const prodGate = await stayLinksPostOwnershipGate({
    reservationId: DEV_SYNTHETIC_RESERVATION_IDS[0],
    auth: DEV_AUTH,
    store: seedReservationStore,
    nodeEnv: "production",
  });
  assert(prodGate.kind === "unowned", "production disables POST dev fallback");

  await listOwnedPropertyIds({ auth: REAL_AUTH, store: tracked.store });
  await stayLinksPostOwnershipGate({ reservationId: "res-live-1", auth: REAL_AUTH, store: tracked.store });
  assert(tracked.writes.length === 0, "list and POST gate perform no writes");

  const here = dirname(fileURLToPath(import.meta.url));
  const routeSrc = readFileSync(join(here, "../app/api/guest/stay-links/route.ts"), "utf8");
  assert(!routeSrc.includes("fetchListings"), "no all-listings ownership shortcut remains");
  assert(!routeSrc.includes("ownedListingIds"), "ownedListingIds shortcut removed");
  assert(routeSrc.includes("listOwnedPropertyIds"), "GET uses proven owned ids");
  assert(routeSrc.includes("stayLinksPostOwnershipGate"), "POST gates on reservation ownership");
  const postSrc = routeSrc.slice(routeSrc.indexOf("export async function POST"));
  assert(
    postSrc.indexOf("stayLinksPostOwnershipGate") < postSrc.indexOf("issueGuestStayLink"),
    "POST ownership runs before token issue",
  );
  assert(src.includes('select("id")'), "owned-id list selects id only");
  assert(src.includes('eq("host_id"'), "owned-id list filters by host_id");
}

const isDirectRun = process.argv[1]?.includes("host-property-ownership.test");
if (isDirectRun) {
  runHostPropertyOwnershipTests()
    .then(() => {
      console.log("host-property-ownership tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "host-property-ownership tests failed");
      process.exitCode = 1;
    });
}
