import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMemoryHostOwnershipStore } from "./host-property-ownership";
import {
  HOUSEKEEPING_PROOF_HOST_PHOTO_LIST_COLUMNS,
  HOUSEKEEPING_PROOF_HOST_PHOTO_MAX,
  HOUSEKEEPING_PROOF_HOST_TASK_REVIEW_COLUMNS,
  HOUSEKEEPING_PROOF_REVIEW_RPC,
  createMemoryHousekeepingProofHostReviewStore,
  createSupabaseHousekeepingProofHostReviewStore,
  housekeepingProofHostPhotoBytesResponse,
  isHousekeepingProofHostPhotoId,
  listHousekeepingProofHostPhotoStatus,
  listHousekeepingProofHostPhotos,
  loadHousekeepingProofHostPhotoBytes,
  mapHousekeepingProofReviewRpcCode,
  parseHousekeepingProofHostPhotoQuery,
  parseHousekeepingProofHostReviewBody,
  reviewHousekeepingProofHostBatch,
  type HousekeepingProofHostPhotoRow,
  type HousekeepingProofHostReviewStore,
  type HousekeepingProofHostTaskRow,
  type HousekeepingProofReviewBatchArgs,
} from "./housekeeping-proof-host-review";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const HOST_A = "11111111-1111-4111-8111-111111111111";
const HOST_B = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PHOTO_NEW = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const PHOTO_OLD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const PHOTO_EXTRA = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const PHOTO_DECIDED = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const PATH_NEW = `proof/${PHOTO_NEW}.jpg`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd8, 0x00, 0x10]);

const DEV_AUTH = { userId: "00000000-0000-4000-8000-000000000001", source: "dev-fallback" as const };

function search(reservationId: string, stage: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({ reservationId, stage, ...extra });
  return params;
}

function ownedStore() {
  return createMemoryHostOwnershipStore({
    properties: { "prop-1": { hostId: HOST_A }, "prop-2": { hostId: HOST_B } },
    reservations: { "res-1": { propertyId: "prop-1" }, "res-2": { propertyId: "prop-2" }, "res-elena": { propertyId: "prop-1" } },
  });
}

function reviewStore(overrides: Parameters<typeof createMemoryHousekeepingProofHostReviewStore>[0] = {}) {
  return createMemoryHousekeepingProofHostReviewStore({
    tasks: [
      {
        id: TASK_ID,
        property_id: "prop-1",
        reservation_id: "res-1",
        stage: "post_checkout",
        status: "submitted",
      },
    ],
    photos: [
      { id: PHOTO_OLD, task_id: TASK_ID, uploaded_at: "2026-09-03T12:00:00.000Z", storage_path: `proof/${PHOTO_OLD}.jpg` },
      { id: PHOTO_NEW, task_id: TASK_ID, uploaded_at: "2026-09-03T15:00:00.000Z", storage_path: PATH_NEW },
    ],
    files: { [PATH_NEW]: JPEG, [`proof/${PHOTO_OLD}.jpg`]: JPEG },
    ...overrides,
  });
}

export async function runHousekeepingProofHostReviewTests() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..");
  const libSrc = readFileSync(join(here, "housekeeping-proof-host-review.ts"), "utf8");
  const statusRoute = readFileSync(join(root, "app/api/housekeeping/proof-photos/status/route.ts"), "utf8");
  const listRoute = readFileSync(join(root, "app/api/housekeeping/proof-photos/route.ts"), "utf8");
  const bytesRoute = readFileSync(join(root, "app/api/housekeeping/proof-photos/[photoId]/route.ts"), "utf8");
  const combined = `${libSrc}\n${statusRoute}\n${listRoute}\n${bytesRoute}`;

  assert(statusRoute.indexOf("requireHostAuthContext") < statusRoute.indexOf("housekeepingProofHostReviewAdminClient"), "status auth before admin");
  assert(listRoute.indexOf("requireHostAuthContext") < listRoute.indexOf("housekeepingProofHostReviewAdminClient"), "list auth before admin");
  assert(bytesRoute.indexOf("requireHostAuthContext") < bytesRoute.indexOf("housekeepingProofHostReviewAdminClient"), "bytes auth before admin");
  assert(statusRoute.indexOf("requireHostAuthContext") < statusRoute.indexOf("listHousekeepingProofHostPhotoStatus"), "status auth before query");
  assert(listRoute.indexOf("requireHostAuthContext") < listRoute.indexOf("listHousekeepingProofHostPhotos"), "list auth before query");
  assert(bytesRoute.indexOf("requireHostAuthContext") < bytesRoute.indexOf("loadHousekeepingProofHostPhotoBytes"), "bytes auth before query");

  const parsed = parseHousekeepingProofHostPhotoQuery(search("res-1", "post_checkout"));
  assert(!("error" in parsed) && parsed.reservationId === "res-1", "exact query parses");
  assert("error" in parseHousekeepingProofHostPhotoQuery(search("res-1", "post_checkout", { extra: "1" })), "extra query keys rejected");
  assert("error" in parseHousekeepingProofHostPhotoQuery(search("res-1", "during_stay")), "unknown stage rejected");
  assert(isHousekeepingProofHostPhotoId(PHOTO_NEW), "photo id format");

  const noUser = await listHousekeepingProofHostPhotoStatus({
    userId: null,
    hostAuthSource: "supabase-auth",
    search: search("res-1", "post_checkout"),
    ownershipStore: ownedStore(),
    store: reviewStore(),
  });
  assert(noUser.status === 401 && (noUser.body as { error?: string }).error === "Unauthorized", "401 missing user");

  const unowned = await listHousekeepingProofHostPhotoStatus({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    search: search("res-2", "post_checkout"),
    ownershipStore: ownedStore(),
    store: reviewStore(),
  });
  assert(unowned.status === 403, "403 unowned status");

  const otherHost = await listHousekeepingProofHostPhotoStatus({
    userId: HOST_B,
    hostAuthSource: "supabase-auth",
    search: search("res-1", "post_checkout"),
    ownershipStore: ownedStore(),
    store: reviewStore(),
  });
  assert(otherHost.status === 403, "real host isolation");

  const prodFallback = await listHousekeepingProofHostPhotoStatus({
    userId: DEV_AUTH.userId,
    hostAuthSource: "dev-fallback",
    search: search("res-elena", "post_checkout"),
    ownershipStore: ownedStore(),
    store: reviewStore(),
    nodeEnv: "production",
  });
  assert(prodFallback.status === 403, "production disables fallback");

  const mismatch = await listHousekeepingProofHostPhotoStatus({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    search: search("res-1", "post_checkout"),
    ownershipStore: ownedStore(),
    store: reviewStore({
      tasks: [
        {
          id: TASK_ID,
          property_id: "prop-2",
          reservation_id: "res-1",
          stage: "post_checkout",
          status: "open",
        },
      ],
    }),
  });
  assert(mismatch.status === 403, "task property must match reservation property");

  const closed = await listHousekeepingProofHostPhotoStatus({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    search: search("res-1", "post_checkout"),
    ownershipStore: ownedStore(),
    store: reviewStore({
      tasks: [
        {
          id: TASK_ID,
          property_id: "prop-1",
          reservation_id: "res-1",
          stage: "post_checkout",
          status: "approved",
        },
      ],
    }),
  });
  assert(
    closed.status === 200 &&
      JSON.stringify(closed.body) ===
        JSON.stringify({ ok: true, photoCount: 0, latestReceivedAt: null, reviewable: false, canIssueLink: false }),
    "approved task does not expose photos",
  );

  const fail = await listHousekeepingProofHostPhotoStatus({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    search: search("res-1", "post_checkout"),
    ownershipStore: ownedStore(),
    store: reviewStore({ failFind: true }),
  });
  assert(fail.status === 503 && (fail.body as { error?: string }).error === "unavailable", "503 find failure");

  const manyPhotos = Array.from({ length: 9 }, (_, index) => {
    const id = `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, "0")}`;
    return {
      id,
      task_id: TASK_ID,
      uploaded_at: `2026-09-03T1${index}:00:00.000Z`,
      storage_path: `proof/${id}.jpg`,
    };
  });
  const statusOk = await listHousekeepingProofHostPhotoStatus({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    search: search("res-1", "post_checkout"),
    ownershipStore: ownedStore(),
    store: reviewStore({ photos: manyPhotos }),
  });
  assert(statusOk.status === 200, "owned status 200");
  const statusBody = statusOk.body as {
    ok: boolean;
    photoCount: number;
    latestReceivedAt: string | null;
    reviewable: boolean;
    canIssueLink: boolean;
  };
  assert(Object.keys(statusBody).sort().join(",") === "canIssueLink,latestReceivedAt,ok,photoCount,reviewable", "status keys exact");
  assert(statusBody.ok === true && statusBody.reviewable === true, "reviewable submitted task");
  assert(statusBody.canIssueLink === false, "submitted cannot issue another cleaner link");
  assert(statusBody.photoCount === HOUSEKEEPING_PROOF_HOST_PHOTO_MAX, "status caps at 8");
  assert(statusBody.latestReceivedAt === "2026-09-03T18:00:00.000Z", "newest timestamp wins");
  assert(!("storage_path" in statusBody) && !("task_id" in statusBody) && !("token" in statusBody), "status omits secrets");

  const openCollecting = await listHousekeepingProofHostPhotoStatus({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    search: search("res-1", "post_checkout"),
    ownershipStore: ownedStore(),
    store: reviewStore({
      tasks: [
        {
          id: TASK_ID,
          property_id: "prop-1",
          reservation_id: "res-1",
          stage: "post_checkout",
          status: "open",
        },
      ],
      photos: manyPhotos,
    }),
  });
  assert(
    openCollecting.status === 200 &&
      (openCollecting.body as { reviewable?: boolean; photoCount?: number; canIssueLink?: boolean }).reviewable === false &&
      (openCollecting.body as { photoCount?: number }).photoCount === HOUSEKEEPING_PROOF_HOST_PHOTO_MAX &&
      (openCollecting.body as { canIssueLink?: boolean }).canIssueLink === true,
    "open task exposes photos but is not reviewable until Finish; link issue still allowed",
  );

  const listOk = await listHousekeepingProofHostPhotos({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    search: search("res-1", "post_checkout"),
    ownershipStore: ownedStore(),
    store: reviewStore(),
  });
  assert(listOk.status === 200, "owned list 200");
  const listBody = listOk.body as { ok: boolean; photos: Array<{ id: string; receivedAt: string }> };
  assert(Object.keys(listBody).sort().join(",") === "ok,photos", "list keys exact");
  assert(listBody.photos.length === 2, "two photos");
  assert(listBody.photos[0]?.id === PHOTO_NEW && listBody.photos[1]?.id === PHOTO_OLD, "newest first");
  assert(listBody.photos.every((row) => Object.keys(row).sort().join(",") === "id,receivedAt"), "photo item keys exact");
  assert(!JSON.stringify(listBody).includes("storage_path") && !JSON.stringify(listBody).includes("task_id"), "list omits paths");
  assert(!/guest|token_hash|wifi|handbook|address/.test(JSON.stringify(listBody)), "list omits guest fields");

  const listUnowned = await listHousekeepingProofHostPhotos({
    userId: HOST_B,
    hostAuthSource: "supabase-auth",
    search: search("res-1", "post_checkout"),
    ownershipStore: ownedStore(),
    store: reviewStore(),
  });
  assert(listUnowned.status === 403, "403 unowned list");

  const listedMany = await listHousekeepingProofHostPhotos({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    search: search("res-1", "post_checkout"),
    ownershipStore: ownedStore(),
    store: reviewStore({
      photos: [
        ...manyPhotos,
        { id: PHOTO_EXTRA, task_id: TASK_ID, uploaded_at: "2026-09-03T19:00:00.000Z", storage_path: `proof/${PHOTO_EXTRA}.jpg` },
      ],
    }),
  });
  const listed = (listedMany.body as { photos: Array<{ id: string; receivedAt: string }> }).photos;
  assert(listed.length === 8, "list maximum 8");
  assert(Boolean(listed[0] && listed[7] && listed[0].receivedAt >= listed[7].receivedAt), "deterministic newest-first");

  const bytesOk = await loadHousekeepingProofHostPhotoBytes({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    photoId: PHOTO_NEW,
    ownershipStore: ownedStore(),
    store: reviewStore(),
  });
  assert(bytesOk.status === 200 && Boolean(bytesOk.bytes?.equals(JPEG)), "proxy streams owned jpeg");

  const bytesUnowned = await loadHousekeepingProofHostPhotoBytes({
    userId: HOST_B,
    hostAuthSource: "supabase-auth",
    photoId: PHOTO_NEW,
    ownershipStore: ownedStore(),
    store: reviewStore(),
  });
  assert(bytesUnowned.status === 404 && !bytesUnowned.bytes, "unowned photo never returns bytes");
  assert((bytesUnowned.body as { error?: string }).error === "invalid", "404 invalid");

  const bytesMissing = await loadHousekeepingProofHostPhotoBytes({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    photoId: PHOTO_EXTRA,
    ownershipStore: ownedStore(),
    store: reviewStore(),
  });
  assert(bytesMissing.status === 404 && !bytesMissing.bytes, "missing photo 404");

  const bytesClosed = await loadHousekeepingProofHostPhotoBytes({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    photoId: PHOTO_NEW,
    ownershipStore: ownedStore(),
    store: reviewStore({
      tasks: [
        {
          id: TASK_ID,
          property_id: "prop-1",
          reservation_id: "res-1",
          stage: "post_checkout",
          status: "closed",
        },
      ],
    }),
  });
  assert(bytesClosed.status === 404 && !bytesClosed.bytes, "non-reviewable photo 404");

  const bytesFail = await loadHousekeepingProofHostPhotoBytes({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    photoId: PHOTO_NEW,
    ownershipStore: ownedStore(),
    store: reviewStore({ failDownload: true }),
  });
  assert(bytesFail.status === 503, "503 download failure");

  const image = housekeepingProofHostPhotoBytesResponse(JPEG);
  assert(image.headers.get("Content-Type") === "image/jpeg", "jpeg content type");
  assert(image.headers.get("Cache-Control") === "no-store", "bytes no-store");
  assert(image.headers.get("Referrer-Policy") === "no-referrer", "bytes no-referrer");
  assert(image.headers.get("X-Content-Type-Options") === "nosniff", "nosniff");

  assert(HOUSEKEEPING_PROOF_HOST_TASK_REVIEW_COLUMNS === "id, property_id, reservation_id, stage, status", "task mask");
  assert(HOUSEKEEPING_PROOF_HOST_PHOTO_LIST_COLUMNS === "id, uploaded_at", "list mask omits storage_path");
  assert(!combined.includes("getPublicUrl") && !combined.includes("createSignedUrl"), "no signed/public URL");
  assert(!combined.includes("createBrowserClient") && !combined.includes("createAuthBrowserClient"), "no browser supabase");
  assert(!combined.includes("/housekeeping/upload") && !combined.includes("HOUSEKEEPING_STORAGE_BUCKET"), "no legacy bucket");
  assert(!/console\.(log|info|debug|error|warn)/.test(combined), "no console logging");
  assert(libSrc.includes("stayLinksPostOwnershipGate"), "reuses ownership gate");
  assert(bytesRoute.includes("housekeepingProofHostPhotoBytesResponse"), "streams through same-origin helper");
  assert(!bytesRoute.includes("NextResponse.redirect") && !bytesRoute.includes("Location:"), "no storage redirect");

  const reviewRoute = readFileSync(join(root, "app/api/housekeeping/proof-photos/review/route.ts"), "utf8");
  const reviewPost = reviewRoute.slice(reviewRoute.indexOf("export async function POST"));
  assert(reviewPost.indexOf("housekeepingProofBodyTooLarge") < reviewPost.indexOf("requireHostAuthContext"), "oversized body before auth");
  assert(reviewPost.includes("await request.json()"), "parses JSON");
  assert(reviewPost.includes('return housekeepingProofJson({ error: "invalid" }, 400)'), "malformed JSON 400");
  assert(reviewPost.indexOf("requireHostAuthContext") < reviewPost.indexOf("housekeepingProofHostReviewAdminClient"), "auth before admin");
  assert(reviewPost.includes('if (!admin) return housekeepingProofJson({ error: "unavailable" }, 503)'), "missing admin 503");
  assert(reviewPost.indexOf("housekeepingProofHostReviewAdminClient") < reviewPost.indexOf("reviewHousekeepingProofHostBatch"), "admin before helper");
  assert(!reviewRoute.includes("housekeeping-proof-link-card") && !reviewRoute.includes("housekeeping-panel"), "no UI imports");
  assert(!reviewRoute.includes("/api/guest/") && !reviewRoute.includes("validateHousekeepingProofToken"), "no guest/cleaner imports");
  assert(!reviewRoute.includes("getPublicUrl") && !reviewRoute.includes("createSignedUrl"), "no public/signed URL");
  assert(!reviewRoute.includes("propertyId") && !reviewRoute.includes("reviewedBy"), "route never reads client propertyId/reviewedBy");
  assert(libSrc.includes("p_property_id: args.propertyId"), "RPC property id is server args");
  assert(libSrc.includes("p_reviewed_by: args.reviewedBy"), "RPC reviewer is server args");
  assert(libSrc.includes("housekeepingProofCreatedBy(input.userId, input.hostAuthSource)"), "reviewedBy from createdBy helper");
  assert(libSrc.includes(HOUSEKEEPING_PROOF_REVIEW_RPC), "review RPC name");
  assert(libSrc.includes("stayLinksPostOwnershipGate"), "review reuses ownership gate");

  function reviewBody(extra: Record<string, unknown> = {}) {
    return { reservationId: "res-1", stage: "post_checkout", decision: "approve", ...extra };
  }

  function spyReviewStore(store: HousekeepingProofHostReviewStore) {
    const calls: HousekeepingProofReviewBatchArgs[] = [];
    const wrapped: HousekeepingProofHostReviewStore = {
      findTask: store.findTask.bind(store),
      listPendingPhotos: store.listPendingPhotos.bind(store),
      getPhoto: store.getPhoto.bind(store),
      getTaskById: store.getTaskById.bind(store),
      downloadJpeg: store.downloadJpeg.bind(store),
      async reviewBatchAtomic(args) {
        calls.push(args);
        return store.reviewBatchAtomic(args);
      },
    };
    return { store: wrapped, calls };
  }

  assert("error" in parseHousekeepingProofHostReviewBody({ reservationId: "res-1", stage: "post_checkout" }), "missing decision rejected");
  assert("error" in parseHousekeepingProofHostReviewBody(reviewBody({ propertyId: "prop-1" })), "extra propertyId rejected");
  assert("error" in parseHousekeepingProofHostReviewBody(reviewBody({ reviewedBy: HOST_A })), "extra reviewedBy rejected");
  assert("error" in parseHousekeepingProofHostReviewBody(reviewBody({ reservationId: "   " })), "empty reservationId rejected");
  assert("error" in parseHousekeepingProofHostReviewBody(reviewBody({ stage: "during_stay" })), "invalid stage rejected");
  assert("error" in parseHousekeepingProofHostReviewBody(reviewBody({ decision: "reject" })), "invalid decision rejected");
  const exact = parseHousekeepingProofHostReviewBody(reviewBody());
  assert(!("error" in exact) && exact.reservationId === "res-1" && exact.decision === "approve", "exact three keys parse");

  const noUserReview = await reviewHousekeepingProofHostBatch({
    userId: null,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: reviewStore(),
  });
  assert(noUserReview.status === 401 && (noUserReview.body as { error?: string }).error === "Unauthorized", "no user 401");

  const badSource = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: null,
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: reviewStore(),
  });
  assert(badSource.status === 401 && (badSource.body as { error?: string }).error === "Unauthorized", "invalid auth source 401");

  const unownedSpy = spyReviewStore(reviewStore());
  const unownedReview = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: { reservationId: "res-2", stage: "post_checkout", decision: "approve" },
    ownershipStore: ownedStore(),
    store: unownedSpy.store,
  });
  assert(unownedReview.status === 403 && (unownedReview.body as { error?: string }).error === "unavailable", "unowned 403");
  assert(unownedSpy.calls.length === 0, "unowned does not call RPC store");

  const otherHostSpy = spyReviewStore(reviewStore());
  const otherHostReview = await reviewHousekeepingProofHostBatch({
    userId: HOST_B,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: otherHostSpy.store,
  });
  assert(otherHostReview.status === 403, "other host 403");
  assert(otherHostSpy.calls.length === 0, "other host does not call RPC store");

  const gateFail = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: createMemoryHostOwnershipStore({
      properties: { "prop-1": { hostId: HOST_A } },
      reservations: { "res-1": { propertyId: "prop-1" } },
      failReservationIds: new Set(["res-1"]),
    }),
    store: reviewStore(),
  });
  assert(gateFail.status === 503 && (gateFail.body as { error?: string }).error === "unavailable", "ownership-gate failure 503");

  const approveSpy = spyReviewStore(reviewStore());
  const approveOk = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: approveSpy.store,
  });
  assert(approveOk.status === 200, "owned approve 200");
  assert(
    JSON.stringify(Object.keys(approveOk.body).sort()) === JSON.stringify(["idempotent", "ok", "reviewedPhotoCount", "status"]),
    "camelCase success keys",
  );
  assert(
    approveOk.body.ok === true &&
      approveOk.body.status === "approved" &&
      approveOk.body.reviewedPhotoCount === 2 &&
      approveOk.body.idempotent === false,
    "approve success payload",
  );
  assert(approveSpy.calls.length === 1, "approve calls RPC once");
  assert(approveSpy.calls[0]?.propertyId === "prop-1", "trusted propertyId from ownership gate");
  assert(approveSpy.calls[0]?.reservationId === "res-1" && approveSpy.calls[0]?.stage === "post_checkout", "validated reservation and stage");
  assert(approveSpy.calls[0]?.decision === "approve", "decision approve");
  assert(approveSpy.calls[0]?.reviewedBy === HOST_A, "real host UUID stamped");
  const approvedTask = await approveSpy.store.findTask("res-1", "post_checkout");
  assert(approvedTask?.status === "approved", "task approved");
  const approvedPhotos = await approveSpy.store.listPendingPhotos(TASK_ID);
  assert(approvedPhotos.length === 2, "list still returns stored rows");

  const openReview = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: reviewStore({
      tasks: [
        {
          id: TASK_ID,
          property_id: "prop-1",
          reservation_id: "res-1",
          stage: "post_checkout",
          status: "open",
        },
      ],
    }),
  });
  assert(openReview.status === 409 && (openReview.body as { error?: string }).error === "unavailable", "open review rejected until Finish");

  const attentionCollecting = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: reviewStore({
      tasks: [
        {
          id: TASK_ID,
          property_id: "prop-1",
          reservation_id: "res-1",
          stage: "post_checkout",
          status: "needs_attention",
        },
      ],
    }),
  });
  assert(
    attentionCollecting.status === 409 && (attentionCollecting.body as { error?: string }).error === "unavailable",
    "needs_attention with pending rejected until Finish",
  );

  const attentionStore = reviewStore();
  const attentionOk = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: { reservationId: "res-1", stage: "post_checkout", decision: "needs_attention" },
    ownershipStore: ownedStore(),
    store: attentionStore,
  });
  assert(
    attentionOk.status === 200 &&
      attentionOk.body.status === "needs_attention" &&
      attentionOk.body.reviewedPhotoCount === 2 &&
      attentionOk.body.idempotent === false,
    "needs_attention success",
  );
  const attentionTask = await attentionStore.findTask("res-1", "post_checkout");
  assert(attentionTask?.status === "needs_attention", "task needs_attention");

  const fallbackSpy = spyReviewStore(reviewStore());
  const fallbackOk = await reviewHousekeepingProofHostBatch({
    userId: DEV_AUTH.userId,
    hostAuthSource: "dev-fallback",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: fallbackSpy.store,
    nodeEnv: "development",
  });
  assert(fallbackOk.status === 200, "dev-fallback can review owned synthetic stay");
  assert(fallbackSpy.calls[0]?.reviewedBy === null, "dev-fallback reviewedBy null");

  const idempotentStore = reviewStore();
  await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: idempotentStore,
  });
  const secondApprove = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: idempotentStore,
  });
  assert(
    secondApprove.status === 200 &&
      secondApprove.body.idempotent === true &&
      secondApprove.body.reviewedPhotoCount === 0 &&
      secondApprove.body.status === "approved",
    "same-decision idempotent success",
  );

  const oppositeStore = reviewStore();
  await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: oppositeStore,
  });
  const opposite = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: { reservationId: "res-1", stage: "post_checkout", decision: "needs_attention" },
    ownershipStore: ownedStore(),
    store: oppositeStore,
  });
  assert(opposite.status === 409 && (opposite.body as { error?: string }).error === "unavailable", "opposite decision 409");
  const oppositeTask = await oppositeStore.findTask("res-1", "post_checkout");
  assert(oppositeTask?.status === "approved", "opposite decision does not mutate");

  const closedReview = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: reviewStore({
      tasks: [
        {
          id: TASK_ID,
          property_id: "prop-1",
          reservation_id: "res-1",
          stage: "post_checkout",
          status: "closed",
        },
      ],
    }),
  });
  assert(closedReview.status === 409 && (closedReview.body as { error?: string }).error === "unavailable", "closed task 409");

  const missingTask = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: reviewStore({ tasks: [] }),
  });
  assert(missingTask.status === 404 && (missingTask.body as { error?: string }).error === "invalid", "missing task 404");

  const zp001 = mapHousekeepingProofReviewRpcCode("ZP001");
  const zp002 = mapHousekeepingProofReviewRpcCode("ZP002");
  const zp003 = mapHousekeepingProofReviewRpcCode("ZP003");
  const fk = mapHousekeepingProofReviewRpcCode("23503");
  const card = mapHousekeepingProofReviewRpcCode("P0003");
  const unknown = mapHousekeepingProofReviewRpcCode("XX000");
  assert(zp001.status === 503 && zp001.body.error === "unavailable", "ZP001 mapping");
  assert(zp002.status === 404 && zp002.body.error === "invalid", "ZP002 mapping");
  assert(zp003.status === 409 && zp003.body.error === "unavailable", "ZP003 mapping");
  assert(fk.status === 503 && card.status === 503 && unknown.status === 503, "native/unknown mapping");
  assert(
    [zp001, zp002, zp003, fk, card, unknown].every((row) => Object.keys(row.body).join(",") === "error"),
    "mapper body is error only",
  );
  const mappedDetail = JSON.stringify([zp001, zp002, zp003, fk, card, unknown]);
  assert(!mappedDetail.includes("DETAIL") && !mappedDetail.includes("auth.users") && !mappedDetail.includes("hint"), "no database DETAIL leakage");

  const codeOnly = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: reviewStore({ failReviewCode: "ZP001" }),
  });
  assert(codeOnly.status === 503 && JSON.stringify(codeOnly.body) === '{"error":"unavailable"}', "RPC error uses code only");

  const reviewArgs: HousekeepingProofReviewBatchArgs = {
    propertyId: "prop-1",
    reservationId: "res-1",
    stage: "post_checkout",
    decision: "approve",
    reviewedBy: HOST_A,
  };

  function fakeRpcClient(data: unknown, error: { code?: string } | null = null): SupabaseClient {
    return {
      rpc: async (fn: string) => {
        assert(fn === HOUSEKEEPING_PROOF_REVIEW_RPC, "production store calls review RPC only");
        return { data, error };
      },
    } as unknown as SupabaseClient;
  }

  async function reviewThroughProductionRpc(data: unknown) {
    return reviewHousekeepingProofHostBatch({
      userId: HOST_A,
      hostAuthSource: "supabase-auth",
      body: reviewBody(),
      ownershipStore: ownedStore(),
      store: createSupabaseHousekeepingProofHostReviewStore(fakeRpcClient(data)),
    });
  }

  const rpcApproved = await reviewThroughProductionRpc({
    status: "approved",
    reviewed_photo_count: 2,
    idempotent: false,
  });
  assert(rpcApproved.status === 200 && rpcApproved.body.status === "approved", "RPC status approved accepted");

  const rpcAttention = await reviewThroughProductionRpc([
    { status: "needs_attention", reviewed_photo_count: 1, idempotent: false },
  ]);
  assert(rpcAttention.status === 200 && rpcAttention.body.status === "needs_attention", "RPC status needs_attention accepted");

  const rpcBadStatus = await reviewThroughProductionRpc({
    status: "closed",
    reviewed_photo_count: 1,
    idempotent: false,
  });
  assert(rpcBadStatus.status === 503 && (rpcBadStatus.body as { error?: string }).error === "unavailable", "other RPC status rejected");

  const rpcEmpty = await reviewThroughProductionRpc([]);
  assert(rpcEmpty.status === 503, "empty RPC result rejected");

  const rpcMulti = await reviewThroughProductionRpc([
    { status: "approved", reviewed_photo_count: 1, idempotent: false },
    { status: "approved", reviewed_photo_count: 1, idempotent: false },
  ]);
  assert(rpcMulti.status === 503, "multiple RPC rows rejected");

  const rpcNegative = await reviewThroughProductionRpc({
    status: "approved",
    reviewed_photo_count: -1,
    idempotent: false,
  });
  assert(rpcNegative.status === 503, "negative reviewed_photo_count rejected");

  const rpcFloat = await reviewThroughProductionRpc({
    status: "approved",
    reviewed_photo_count: 1.5,
    idempotent: false,
  });
  assert(rpcFloat.status === 503, "non-integer reviewed_photo_count rejected");

  const rpcIdempotent = await reviewThroughProductionRpc({
    status: "approved",
    reviewed_photo_count: 0,
    idempotent: "true",
  });
  assert(rpcIdempotent.status === 503, "non-boolean idempotent rejected");

  await createSupabaseHousekeepingProofHostReviewStore(fakeRpcClient({
    status: "approved",
    reviewed_photo_count: 0,
    idempotent: true,
  })).reviewBatchAtomic(reviewArgs);

  type MemorySnap = HousekeepingProofHostPhotoRow & {
    review_status?: string;
    reviewed_at?: string | null;
    reviewed_by?: string | null;
  };
  type TaskSnap = HousekeepingProofHostTaskRow & { reviewed_at?: string | null };

  function photoSnap(rows: HousekeepingProofHostPhotoRow[]) {
    return rows.map((row) => {
      const item = row as MemorySnap;
      return {
        id: item.id,
        review_status: item.review_status ?? "pending",
        reviewed_at: item.reviewed_at ?? null,
        reviewed_by: item.reviewed_by ?? null,
      };
    });
  }

  const stampStore = reviewStore();
  const stampOk = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: stampStore,
  });
  assert(stampOk.status === 200 && stampOk.body.idempotent === false, "stamp review succeeds");
  const stampedTask = (await stampStore.findTask("res-1", "post_checkout")) as TaskSnap | null;
  const stampedPhotos = photoSnap(await stampStore.listPendingPhotos(TASK_ID));
  const stamp = stampedTask?.reviewed_at ?? "";
  assert(typeof stamp === "string" && stamp.length > 0, "task reviewed_at set");
  assert(stampedPhotos.every((row) => row.reviewed_at === stamp), "photos share task reviewed_at");
  assert(new Set(stampedPhotos.map((row) => row.reviewed_at)).size === 1, "one batch timestamp");

  const freezeTask = { ...stampedTask };
  const freezePhotos = photoSnap(await stampStore.listPendingPhotos(TASK_ID));
  const idempotentAgain = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: stampStore,
  });
  assert(idempotentAgain.status === 200 && idempotentAgain.body.idempotent === true, "idempotent does not rewrite");
  const afterIdempotentTask = (await stampStore.findTask("res-1", "post_checkout")) as TaskSnap | null;
  assert(afterIdempotentTask?.status === freezeTask.status && afterIdempotentTask?.reviewed_at === freezeTask.reviewed_at, "idempotent leaves task timestamps");
  assert(JSON.stringify(photoSnap(await stampStore.listPendingPhotos(TASK_ID))) === JSON.stringify(freezePhotos), "idempotent leaves photo rows");

  const failStampStore = reviewStore();
  await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: failStampStore,
  });
  const beforeConflict = {
    task: (await failStampStore.findTask("res-1", "post_checkout")) as TaskSnap | null,
    photos: photoSnap(await failStampStore.listPendingPhotos(TASK_ID)),
  };
  const conflictAgain = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: { reservationId: "res-1", stage: "post_checkout", decision: "needs_attention" },
    ownershipStore: ownedStore(),
    store: failStampStore,
  });
  assert(conflictAgain.status === 409, "conflict after complete decision");
  const afterConflictTask = (await failStampStore.findTask("res-1", "post_checkout")) as TaskSnap | null;
  assert(afterConflictTask?.status === beforeConflict.task?.status && afterConflictTask?.reviewed_at === beforeConflict.task?.reviewed_at, "failed decision leaves timestamps");
  assert(JSON.stringify(photoSnap(await failStampStore.listPendingPhotos(TASK_ID))) === JSON.stringify(beforeConflict.photos), "failed decision leaves rows");

  const mixedStore = reviewStore({
    photos: [
      { id: PHOTO_OLD, task_id: TASK_ID, uploaded_at: "2026-09-03T12:00:00.000Z", storage_path: `proof/${PHOTO_OLD}.jpg` },
      { id: PHOTO_NEW, task_id: TASK_ID, uploaded_at: "2026-09-03T15:00:00.000Z", storage_path: PATH_NEW },
      {
        id: PHOTO_DECIDED,
        task_id: TASK_ID,
        uploaded_at: "2026-09-03T10:00:00.000Z",
        storage_path: `proof/${PHOTO_DECIDED}.jpg`,
        review_status: "approved",
        reviewed_at: "2026-09-01T00:00:00.000Z",
        reviewed_by: HOST_B,
      },
    ],
  });
  const mixedOk = await reviewHousekeepingProofHostBatch({
    userId: HOST_A,
    hostAuthSource: "supabase-auth",
    body: reviewBody(),
    ownershipStore: ownedStore(),
    store: mixedStore,
  });
  assert(mixedOk.status === 200 && mixedOk.body.reviewedPhotoCount === 2, "only pending photos counted");
  const mixedPhotos = photoSnap(await mixedStore.listPendingPhotos(TASK_ID));
  const decided = mixedPhotos.find((row) => row.id === PHOTO_DECIDED);
  assert(decided?.review_status === "approved" && decided.reviewed_at === "2026-09-01T00:00:00.000Z" && decided.reviewed_by === HOST_B, "already-decided photo unchanged");
  const pendingNow = mixedPhotos.filter((row) => row.id !== PHOTO_DECIDED);
  assert(pendingNow.every((row) => row.review_status === "approved"), "pending photos approved");
  const mixedTask = (await mixedStore.findTask("res-1", "post_checkout")) as TaskSnap | null;
  assert(pendingNow.every((row) => row.reviewed_at === mixedTask?.reviewed_at), "new photos match task timestamp");
  assert(decided?.reviewed_at !== mixedTask?.reviewed_at, "prior photo timestamp preserved");
}

const isDirectRun = process.argv[1]?.includes("housekeeping-proof-host-review.test");
if (isDirectRun) {
  runHousekeepingProofHostReviewTests()
    .then(() => {
      console.log("housekeeping-proof-host-review tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "housekeeping-proof-host-review tests failed");
      process.exitCode = 1;
    });
}
