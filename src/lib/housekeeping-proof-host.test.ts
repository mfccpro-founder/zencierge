import {
  HOUSEKEEPING_PROOF_HOST_COPY,
  HOUSEKEEPING_PROOF_HOST_ISSUE_PATH,
  HOUSEKEEPING_PROOF_HOST_OPTIONS_PATH,
  HOUSEKEEPING_PROOF_HOST_PHOTO_LIST_PATH,
  HOUSEKEEPING_PROOF_HOST_PHOTO_REVIEW_PATH,
  HOUSEKEEPING_PROOF_HOST_PHOTO_STATUS_PATH,
  HOUSEKEEPING_PROOF_HOST_PHOTO_AWAIT_POLL_MS,
  HOUSEKEEPING_PROOF_HOST_PHOTO_POLL_MS,
  HOUSEKEEPING_PROOF_HOST_PATH_PREFIX,
  HOUSEKEEPING_PROOF_HOST_TOKEN_LENGTH,
  buildHousekeepingProofAbsoluteUrl,
  canStartHousekeepingProofGenerate,
  canStartHousekeepingProofReview,
  chooseHousekeepingProofShareOrigin,
  executeHousekeepingProofShare,
  formatHousekeepingProofReceivedAt,
  housekeepingProofHostPhotoBytesPath,
  housekeepingProofHostPhotoPollIntervalMs,
  housekeepingProofHostPhotoQuery,
  housekeepingProofHostIssueBody,
  housekeepingProofHostReviewBody,
  housekeepingProofSharePayload,
  isValidHousekeepingProofRelativePath,
  mapHousekeepingProofHostHttpStatus,
  parseHousekeepingProofPhotoListPayload,
  parseHousekeepingProofPhotoStatusPayload,
  parseHousekeepingProofIssuePayload,
  parseHousekeepingProofReviewPayload,
  parseHousekeepingProofOptionsPayload,
  pickHousekeepingProofStage,
  reservationsForHousekeepingProofProperty,
  shouldConfirmHousekeepingProofReplace,
} from "./housekeeping-proof-host";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const token = "A".repeat(HOUSEKEEPING_PROOF_HOST_TOKEN_LENGTH);
const path = `${HOUSEKEEPING_PROOF_HOST_PATH_PREFIX}${token}`;

export async function runHousekeepingProofHostTests() {
  assert(HOUSEKEEPING_PROOF_HOST_OPTIONS_PATH === "/api/housekeeping/proof-options", "options path");
  assert(HOUSEKEEPING_PROOF_HOST_ISSUE_PATH === "/api/housekeeping/proof-links", "issue path");
  assert(HOUSEKEEPING_PROOF_HOST_PHOTO_STATUS_PATH === "/api/housekeeping/proof-photos/status", "photo status path");
  assert(HOUSEKEEPING_PROOF_HOST_PHOTO_LIST_PATH === "/api/housekeeping/proof-photos", "photo list path");
  assert(HOUSEKEEPING_PROOF_HOST_PHOTO_AWAIT_POLL_MS === 5_000, "awaiting-photo poll is 5 seconds");
  assert(HOUSEKEEPING_PROOF_HOST_PHOTO_POLL_MS === 20_000, "discovered-photo poll is 20 seconds");
  assert(housekeepingProofHostPhotoPollIntervalMs(0) === HOUSEKEEPING_PROOF_HOST_PHOTO_AWAIT_POLL_MS, "zero photos use 5s poll");
  assert(housekeepingProofHostPhotoPollIntervalMs(-1) === HOUSEKEEPING_PROOF_HOST_PHOTO_AWAIT_POLL_MS, "non-positive photos use 5s poll");
  assert(housekeepingProofHostPhotoPollIntervalMs(Number.NaN) === HOUSEKEEPING_PROOF_HOST_PHOTO_AWAIT_POLL_MS, "NaN photos use 5s poll");
  assert(housekeepingProofHostPhotoPollIntervalMs(1) === HOUSEKEEPING_PROOF_HOST_PHOTO_POLL_MS, "one photo switches to 20s poll");
  assert(housekeepingProofHostPhotoPollIntervalMs(8) === HOUSEKEEPING_PROOF_HOST_PHOTO_POLL_MS, "many photos keep 20s poll");
  assert(HOUSEKEEPING_PROOF_HOST_PATH_PREFIX === "/housekeeping/p/", "cleaner path prefix");
  assert(isValidHousekeepingProofRelativePath(path), "43-char base64url path accepted");
  assert(!isValidHousekeepingProofRelativePath(`${HOUSEKEEPING_PROOF_HOST_PATH_PREFIX}${"A".repeat(42)}`), "short token rejected");
  assert(!isValidHousekeepingProofRelativePath(`${path}/extra`), "second path segment rejected");
  assert(!isValidHousekeepingProofRelativePath(`${path}?x=1`), "query rejected");
  assert(!isValidHousekeepingProofRelativePath(`${path}#x`), "fragment rejected");
  assert(!isValidHousekeepingProofRelativePath(`https://example.com${path}`), "absolute URL rejected");
  assert(!isValidHousekeepingProofRelativePath(`http://localhost:3000${path}`), "loopback absolute rejected as path");
  assert(!isValidHousekeepingProofRelativePath("//host.example/housekeeping/p/" + token), "protocol-relative rejected");

  const https = buildHousekeepingProofAbsoluteUrl("https://tunnel.example", path);
  assert(https === `https://tunnel.example${path}`, "https origin joins path");
  assert(buildHousekeepingProofAbsoluteUrl("http://localhost:3000", path).endsWith(path), "loopback http allowed");
  assert(buildHousekeepingProofAbsoluteUrl("http://192.0.2.8", path) === "", "non-loopback http rejected");
  assert(
    chooseHousekeepingProofShareOrigin("http://localhost:3000", "https://tunnel.example") === "https://tunnel.example",
    "tunnel https wins over loopback",
  );

  const parsed = parseHousekeepingProofOptionsPayload({
    ok: true,
    properties: [{ id: "prop-1", name: "Bayview" }],
    reservations: [
      {
        id: "res-1",
        propertyId: "prop-1",
        checkIn: "2026-09-10",
        checkOut: "2026-09-14",
        status: "upcoming",
        eligibleStages: ["post_checkout", "ready_for_checkin"],
      },
      {
        id: "res-2",
        propertyId: "prop-2",
        checkIn: "2026-09-11",
        checkOut: "2026-09-12",
        status: "upcoming",
        eligibleStages: ["ready_for_checkin"],
      },
    ],
  });
  assert(parsed?.properties.length === 1 && parsed.reservations.length === 2, "allowlisted options parse");
  assert(reservationsForHousekeepingProofProperty(parsed!.reservations, "prop-1").every((row) => row.propertyId === "prop-1"), "property filter");
  assert(pickHousekeepingProofStage(["ready_for_checkin"], "post_checkout") === "ready_for_checkin", "invalid stage replaced");
  assert(pickHousekeepingProofStage(["post_checkout"], "post_checkout") === "post_checkout", "eligible stage kept");
  assert(
    parseHousekeepingProofOptionsPayload({
      ok: true,
      properties: [{ id: "prop-1", name: "Bayview", guest: "Ada" }],
      reservations: [],
    })?.properties.length === 0,
    "guest field is not accepted as UI data",
  );
  assert(
    parseHousekeepingProofOptionsPayload({
      ok: true,
      properties: [{ id: "prop-1", name: "Bayview" }],
      reservations: [
        {
          id: "res-1",
          propertyId: "prop-1",
          checkIn: "2026-09-10",
          checkOut: "2026-09-14",
          status: "upcoming",
          eligibleStages: ["during_stay"],
        },
      ],
    })?.reservations.length === 0,
    "unknown stages are dropped",
  );

  assert(JSON.stringify(housekeepingProofHostIssueBody("res-1", "post_checkout")) === JSON.stringify({ reservationId: "res-1", stage: "post_checkout" }), "issue body exact");
  assert(parseHousekeepingProofIssuePayload({ ok: true, path, expiresAt: "2026-09-15T00:00:00.000Z" })?.path === path, "issue success");
  assert(parseHousekeepingProofIssuePayload({ ok: true, path: "/guest/s/" + token, expiresAt: "2026-09-15T00:00:00.000Z" }) === null, "guest path rejected");
  assert(parseHousekeepingProofIssuePayload({ ok: true, path, expiresAt: "x", extra: true }) === null, "extra issue keys rejected");

  assert(canStartHousekeepingProofGenerate({ busy: true, propertyId: "p", reservationId: "r", stage: "post_checkout", eligibleStages: ["post_checkout"] }) === false, "duplicate generate blocked");
  assert(canStartHousekeepingProofGenerate({ busy: false, propertyId: "p", reservationId: "r", stage: "post_checkout", eligibleStages: ["ready_for_checkin"] }) === false, "stage must be eligible");
  assert(canStartHousekeepingProofGenerate({ busy: false, propertyId: "p", reservationId: "r", stage: "post_checkout", eligibleStages: ["post_checkout"] }), "ready generate allowed");
  assert(
    canStartHousekeepingProofGenerate({
      busy: false,
      propertyId: "p",
      reservationId: "r",
      stage: "post_checkout",
      eligibleStages: ["post_checkout"],
      canIssueLink: false,
    }) === false,
    "submitted/blocked task cannot generate",
  );
  assert(shouldConfirmHousekeepingProofReplace(true), "held link requires confirm");
  assert(!shouldConfirmHousekeepingProofReplace(false), "first generate skips confirm");
  assert(mapHousekeepingProofHostHttpStatus(401) === "unauthorized", "401");
  assert(mapHousekeepingProofHostHttpStatus(403) === "forbidden", "403");
  assert(mapHousekeepingProofHostHttpStatus(429) === "unavailable", "429");
  assert(mapHousekeepingProofHostHttpStatus(503) === "unavailable", "503");

  const payload = housekeepingProofSharePayload("https://tunnel.example" + path);
  assert(Object.keys(payload).sort().join(",") === "text,title,url", "share keys only");
  assert(payload.url.endsWith(path) && payload.title === HOUSEKEEPING_PROOF_HOST_COPY.shareTitle, "generic share title and url");
  assert(!/property|reservation|guest|check-in|address|stage|wifi/i.test(payload.title + payload.text), "share text has no stay data");

  let copied = 0;
  const aborted = await executeHousekeepingProofShare("https://tunnel.example" + path, false, {
    share: async () => {
      const error = new Error("canceled");
      error.name = "AbortError";
      throw error;
    },
    copy: () => {
      copied += 1;
    },
  });
  assert(aborted === "cancelled" && copied === 0, "AbortError does not copy");
  const fallback = await executeHousekeepingProofShare("https://tunnel.example" + path, false, {
    copy: () => {
      copied += 1;
    },
  });
  assert(fallback === "copied" && copied === 1, "unsupported share copies once");
  const failedNative = await executeHousekeepingProofShare("https://tunnel.example" + path, false, {
    share: async () => {
      throw new Error("fail");
    },
    copy: () => {
      copied += 1;
    },
  });
  assert(failedNative === "copied" && copied === 2, "failed share copies once");
  const ignored = await executeHousekeepingProofShare("https://tunnel.example" + path, true, {
    copy: () => {
      copied += 1;
    },
  });
  assert(ignored === "ignored" && copied === 2, "duplicate share prevented");

  assert(HOUSEKEEPING_PROOF_HOST_COPY.title.en === "Secure cleaner link", "title en");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.generate.es === "Crear enlace seguro para limpieza", "generate es");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.unauthorized.en === "Host sign-in is required.", "401 en");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.forbidden.es === "No puedes crear un enlace para esta estadía.", "403 es");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.empty.en === "No eligible stays right now.", "empty en");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.unavailable.es === "No se puede crear el enlace temporalmente.", "unavailable es");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.photosReceived.en === "Photos received", "photos received en");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.photosReceived.es === "Fotos recibidas", "photos received es");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.uploadedPhotos.en === "Uploaded photos", "uploaded photos en");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.uploadedPhotos.es === "Fotos cargadas", "uploaded photos es");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.reviewDecision.en === "Review decision", "review decision en");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.reviewDecision.es === "Decisión de revisión", "review decision es");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.review.es === "Revisar fotos seguras", "review es");
  const photoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  assert(housekeepingProofHostPhotoQuery("res-1", "post_checkout") === "reservationId=res-1&stage=post_checkout", "photo query exact keys");
  assert(housekeepingProofHostPhotoBytesPath(photoId) === `/api/housekeeping/proof-photos/${photoId}`, "bytes path is same-origin");
  assert(housekeepingProofHostPhotoBytesPath("nope") === "", "invalid photo id has no path");
  assert(
    parseHousekeepingProofPhotoStatusPayload({
      ok: true,
      photoCount: 2,
      latestReceivedAt: "2026-09-03T15:00:00.000Z",
      reviewable: true,
      canIssueLink: false,
    })?.photoCount === 2,
    "status payload parses",
  );
  assert(
    parseHousekeepingProofPhotoStatusPayload({
      ok: true,
      photoCount: 2,
      latestReceivedAt: "2026-09-03T15:00:00.000Z",
      reviewable: true,
    }) === null,
    "status without canIssueLink rejected",
  );
  assert(
    parseHousekeepingProofPhotoStatusPayload({
      ok: true,
      photoCount: 1,
      latestReceivedAt: null,
      reviewable: true,
      canIssueLink: true,
      task_id: "x",
    }) === null,
    "status extra keys rejected",
  );
  assert(
    parseHousekeepingProofPhotoListPayload({
      ok: true,
      photos: [{ id: photoId, receivedAt: "2026-09-03T15:00:00.000Z", storage_path: "x" }],
    }) === null,
    "list storage_path rejected",
  );
  assert(formatHousekeepingProofReceivedAt("not-a-date") === "", "invalid received at");

  assert(HOUSEKEEPING_PROOF_HOST_PHOTO_REVIEW_PATH === "/api/housekeeping/proof-photos/review", "review path");
  const reviewBody = housekeepingProofHostReviewBody("res-1", "post_checkout", "approve");
  assert(JSON.stringify(reviewBody) === JSON.stringify({ reservationId: "res-1", stage: "post_checkout", decision: "approve" }), "review body exact");
  assert(Object.keys(reviewBody).join(",") === "reservationId,stage,decision", "review body keys only");
  assert(!("propertyId" in reviewBody) && !("reviewedBy" in reviewBody), "review body omits propertyId and reviewedBy");
  assert(
    JSON.stringify(housekeepingProofHostReviewBody("res-1", "ready_for_checkin", "needs_attention")) ===
      JSON.stringify({ reservationId: "res-1", stage: "ready_for_checkin", decision: "needs_attention" }),
    "needs_attention body exact",
  );

  const approved = parseHousekeepingProofReviewPayload({
    ok: true,
    status: "approved",
    reviewedPhotoCount: 2,
    idempotent: false,
  });
  assert(approved?.status === "approved" && approved.reviewedPhotoCount === 2 && approved.idempotent === false, "parser accepts approved");
  const needsAttention = parseHousekeepingProofReviewPayload({
    ok: true,
    status: "needs_attention",
    reviewedPhotoCount: 0,
    idempotent: true,
  });
  assert(
    needsAttention?.status === "needs_attention" && needsAttention.reviewedPhotoCount === 0 && needsAttention.idempotent === true,
    "parser accepts needs_attention",
  );
  assert(
    parseHousekeepingProofReviewPayload({
      ok: true,
      status: "approved",
      reviewedPhotoCount: 1,
      idempotent: false,
      extra: true,
    }) === null,
    "parser rejects extra keys",
  );
  assert(
    parseHousekeepingProofReviewPayload({
      ok: true,
      status: "approved",
      reviewedPhotoCount: 1,
    }) === null,
    "parser rejects missing keys",
  );
  assert(
    parseHousekeepingProofReviewPayload({
      ok: true,
      status: "closed",
      reviewedPhotoCount: 1,
      idempotent: false,
    }) === null,
    "parser rejects bad status",
  );
  assert(
    parseHousekeepingProofReviewPayload({
      ok: true,
      status: "approved",
      reviewedPhotoCount: -1,
      idempotent: false,
    }) === null,
    "parser rejects negative count",
  );
  assert(
    parseHousekeepingProofReviewPayload({
      ok: true,
      status: "approved",
      reviewedPhotoCount: 1.5,
      idempotent: false,
    }) === null,
    "parser rejects non-integer count",
  );
  assert(
    parseHousekeepingProofReviewPayload({
      ok: true,
      status: "approved",
      reviewedPhotoCount: 1,
      idempotent: "true",
    }) === null,
    "parser rejects non-boolean idempotent",
  );

  const reviewReady = {
    loadState: "ready" as const,
    reservationId: "res-1",
    stage: "post_checkout",
    reviewable: true,
    photoCount: 1,
    generating: false,
    reviewing: false,
    galleryLoading: false,
    statusLoading: false,
  };
  assert(canStartHousekeepingProofReview(reviewReady), "ready review allowed");
  assert(canStartHousekeepingProofReview({ ...reviewReady, loadState: "loading" }) === false, "canStart rejects not ready");
  assert(canStartHousekeepingProofReview({ ...reviewReady, reservationId: "" }) === false, "canStart rejects no reservation");
  assert(canStartHousekeepingProofReview({ ...reviewReady, stage: "" }) === false, "canStart rejects no stage");
  assert(canStartHousekeepingProofReview({ ...reviewReady, reviewable: false }) === false, "canStart rejects not reviewable");
  assert(canStartHousekeepingProofReview({ ...reviewReady, photoCount: 0 }) === false, "canStart rejects no photos");
  assert(canStartHousekeepingProofReview({ ...reviewReady, generating: true }) === false, "canStart rejects generating");
  assert(canStartHousekeepingProofReview({ ...reviewReady, reviewing: true }) === false, "canStart rejects reviewing");
  assert(canStartHousekeepingProofReview({ ...reviewReady, galleryLoading: true }) === false, "canStart rejects gallery loading");
  assert(canStartHousekeepingProofReview({ ...reviewReady, statusLoading: true }) === false, "canStart rejects status loading");

  assert(HOUSEKEEPING_PROOF_HOST_COPY.approve.en === "Approve photos", "approve en");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.approve.es === "Aprobar fotos", "approve es");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.needsAttention.en === "Needs attention", "needs attention en");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.needsAttention.es === "Necesita atención", "needs attention es");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.approving.en === "Approving…", "approving en");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.approving.es === "Aprobando…", "approving es");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.savingReview.en === "Saving…", "saving en");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.savingReview.es === "Guardando…", "saving es");
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.approveConfirm.en ===
      "This will approve all currently pending photos for this stay and stage. This cannot be undone for this batch. Continue?",
    "approve confirm en",
  );
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.approveConfirm.es ===
      "Esto aprobará todas las fotos pendientes de esta estadía y etapa. Esta decisión no se puede deshacer para este lote. ¿Continuar?",
    "approve confirm es",
  );
  assert(HOUSEKEEPING_PROOF_HOST_COPY.reviewApproved.en === "Photos approved.", "success approve en");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.reviewApproved.es === "Fotos aprobadas.", "success approve es");
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.reviewNeedsAttention.en === "Attention requested. The cleaner can submit new photos.",
    "success needs attention en",
  );
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.reviewNeedsAttention.es ===
      "Atención solicitada. El personal de limpieza puede enviar fotos nuevas.",
    "success needs attention es",
  );
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.awaitingFinish.en.includes("Finish and send"),
    "awaiting finish English mentions Finish",
  );
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.awaitingFinish.es.includes("Terminar y enviar"),
    "awaiting finish Spanish mentions Terminar",
  );
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.submissionReceived.en.includes("Cleaner submission received"),
    "submission received en",
  );
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.submissionReceived.es.includes("Envío de limpieza recibido"),
    "submission received es",
  );
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.generateSubmittedBlocked.en.includes("waiting for your review"),
    "generate blocked after submit en",
  );
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.generateCancelled.en.includes("cancelled"),
    "generate cancel notice en",
  );
  assert(HOUSEKEEPING_PROOF_HOST_COPY.reviewForbidden.en === "You cannot review this stay.", "review 403 en");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.reviewForbidden.es === "No puedes revisar esta estadía.", "review 403 es");
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.reviewUnavailable.en === "Secure photos are temporarily unavailable.",
    "gallery unavailable copy unchanged",
  );
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.reviewSaveFailed.en === "We couldn’t save this review. Please try again.",
    "review failure en",
  );
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.reviewSaveFailed.es === "No pudimos guardar esta revisión. Inténtalo de nuevo.",
    "review failure es",
  );
  assert(HOUSEKEEPING_PROOF_HOST_COPY.generate.en === "Generate secure cleaner link", "link generate copy unchanged");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.unauthorized.en === "Host sign-in is required.", "unauthorized copy unchanged");
}

const isDirectRun = process.argv[1]?.includes("housekeeping-proof-host.test");
if (isDirectRun) {
  runHousekeepingProofHostTests()
    .then(() => {
      console.log("housekeeping-proof-host tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "housekeeping-proof-host tests failed");
      process.exitCode = 1;
    });
}
