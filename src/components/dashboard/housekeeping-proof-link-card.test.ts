import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOUSEKEEPING_PROOF_HOST_COPY } from "../../lib/housekeeping-proof-host";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function runHousekeepingProofLinkCardTests() {
  const here = dirname(fileURLToPath(import.meta.url));
  const card = readFileSync(join(here, "housekeeping-proof-link-card.tsx"), "utf8");
  const ops = readFileSync(join(here, "housekeeping-ops-view.tsx"), "utf8");
  const nav = readFileSync(join(here, "../../lib/host-nav.ts"), "utf8");
  const combined = `${card}\n${ops}`;

  assert(ops.includes("HousekeepingProofLinkCard"), "card is mounted");
  assert(ops.indexOf("<HousekeepingProofLinkCard") < ops.indexOf("<HousekeepingPanel"), "card mounts above the live board");
  assert(ops.includes('active === "inspections"'), "inspections tab still exists");
  const tabIds = [...ops.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);
  assert(tabIds.join(",") === "inspections,reports,supplies,team", "no fifth tab");
  assert(!nav.includes("housekeeping-proof") && !nav.includes("proof-link"), "no new host-nav item");

  assert(card.includes("HOUSEKEEPING_PROOF_HOST_OPTIONS_PATH"), "loads options");
  assert(card.includes('method: "GET"'), "options GET");
  assert(card.includes('cache: "no-store"'), "cache no-store");
  assert(card.includes('credentials: "same-origin"'), "same-origin credentials");
  assert(card.includes('referrerPolicy: "no-referrer"'), "referrer no-referrer");
  assert(card.includes("controller.abort()"), "options abort on unmount");
  assert(card.includes("generation !== optionsGen.current"), "stale options ignored");
  assert(card.includes("parseHousekeepingProofOptionsPayload"), "options allowlist parser");
  assert(card.includes("reservationsForHousekeepingProofProperty"), "reservations filtered by property");
  assert(card.includes("pickHousekeepingProofStage"), "eligible stage enforced");
  assert(card.includes("housekeepingProofHostIssueBody(effectiveReservationId, effectiveStage)"), "issue body is reservationId+stage");
  assert(card.includes('method: "POST"'), "issue POST");
  assert(card.includes('"Content-Type": "application/json"'), "JSON content type");
  assert(card.includes("generatingRef.current"), "duplicate generate blocked");
  assert(card.includes("clearHeldLink"), "selector change clears/aborts link");
  assert(card.includes("parseHousekeepingProofIssuePayload"), "strict issue parse");
  assert(card.includes("isValidHousekeepingProofRelativePath") || card.includes("parseHousekeepingProofIssuePayload"), "path validated");
  assert(card.includes("resolveReachableAppOrigin()"), "runtime origin helper");
  assert(!/resolveReachableAppOrigin\([^)]*path/.test(card), "origin helper receives no path");
  assert(!card.includes("/api/runtime-origin?"), "origin request has no query token");
  assert(card.includes("shouldConfirmHousekeepingProofReplace"), "replacement confirm");
  assert(card.includes("window.confirm"), "confirm dialog");
  assert(card.includes("previousPath"), "failed replacement preserves held path");
  assert(card.includes("pathRef.current = parsed.path"), "success stores new path");
  assert(card.includes("executeHousekeepingProofShare"), "native share helper");
  assert(card.includes("navigator.share"), "user-gesture share");
  assert(card.includes("copyHeldUrl"), "copy uses held URL");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_PHOTO_STATUS_PATH"), "polls photo status");
  assert(card.includes("housekeepingProofHostPhotoPollIntervalMs"), "adaptive poll interval helper");
  assert(card.includes("housekeepingProofHostPhotoPollIntervalMs(photoCount)"), "poll interval follows photoCount");
  assert(card.includes("void loadStatus();"), "immediate first status fetch");
  assert(card.includes('window.addEventListener("focus", onFocus)'), "focus triggers status refresh");
  assert(card.includes('window.removeEventListener("focus", onFocus)'), "focus listener removed on cleanup");
  assert(card.includes("visibilitychange"), "page-focus refresh");
  assert(card.includes("document.hidden"), "skips hidden polls");
  assert(card.includes("statusInFlight.current"), "no overlapping status requests");
  assert(card.includes("statusGen.current"), "stale status ignored");
  assert(card.includes("statusAbort.current?.abort()"), "status abort on unmount/selection");
  assert(card.includes("window.clearInterval(timer)"), "clears poll timer on unmount/selection");
  assert(
    card.includes("[loadState, effectiveReservationId, effectiveStage, statusEpoch, photoCount]"),
    "poll restarts when selection or photoCount changes",
  );
  assert(!card.includes("HOUSEKEEPING_PROOF_HOST_PHOTO_POLL_MS)"), "card does not hardcode 20s interval alone");
  assert(card.includes("galleryAbort.current?.abort()"), "gallery abort on selection/unmount");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_COPY.photosReceived.en"), "photos received copy");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_PHOTO_LIST_PATH"), "review fetches allowlisted list");
  assert(card.includes("housekeepingProofHostPhotoBytesPath(photo.id)"), "gallery uses proxy helper");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_COPY.uploadedPhotos"), "uploaded photos section label");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_COPY.reviewDecision"), "review decision section label");
  assert(card.includes("border-2 border-sky-300 bg-sky-50"), "decision section has strong contrast");
  assert(card.includes("text-base font-bold text-slate-900"), "decision heading is larger bold");
  assert(card.includes("w-full border-b border-sky-200 pb-3"), "decision heading is full-width separated");
  assert(card.includes("mt-5 w-full space-y-4"), "decision section has strong spacing");
  assert(card.includes("flex w-full flex-col gap-2 sm:flex-row"), "decision buttons stay in same group");
  assert(card.includes("disabled={!reviewActionsEnabled}"), "decision buttons stay actually disabled via reviewActionsEnabled");
  assert(card.includes("statusLoading: false"), "statusLoading forced false for review gate and onDecide");
  assert(!card.includes("statusLoading: statusLoading || statusInFlight.current"), "onDecide does not block on status poll in-flight");
  assert(!card.includes("statusLoading,"), "statusLoading React state does not enter reviewActionGate");
  assert(card.includes("reviewActionsVisuallyMuted = !reviewActionsEnabled"), "visual mute mirrors real blockers only");
  assert(card.includes('reviewActionsVisuallyMuted ? " disabled:opacity-40" : ""'), "opacity only when visually muted");
  assert(!/animate-|transition|shimmer|pulse/.test(card), "no animation or transition on decision buttons");
  // Poll must not disable decision buttons: gate ignores statusLoading / statusInFlight.
  const onDecideIdx = card.indexOf("async function onDecide");
  const reviewGateIdx = card.indexOf("const reviewActionGate");
  assert(onDecideIdx > -1 && reviewGateIdx > onDecideIdx, "onDecide precedes reviewActionGate");
  const onDecideBlock = card.slice(onDecideIdx, reviewGateIdx);
  assert(onDecideBlock.includes("statusLoading: false"), "onDecide passes statusLoading false into canStart");
  assert(!onDecideBlock.includes("statusLoading: statusLoading || statusInFlight.current"), "onDecide gate does not OR statusInFlight into statusLoading");
  assert(onDecideBlock.includes("statusAbort.current?.abort()"), "decision click aborts active status request");
  assert(onDecideBlock.includes("statusGen.current += 1"), "decision click invalidates status generation");
  assert(onDecideBlock.includes("statusInFlight.current = false"), "decision click clears status in-flight ownership");
  assert(
    onDecideBlock.indexOf("statusLoading: false") < onDecideBlock.indexOf("statusAbort.current?.abort()") &&
      onDecideBlock.indexOf("canStartHousekeepingProofReview(reviewInput)") < onDecideBlock.indexOf("statusAbort.current?.abort()"),
    "canStart runs before poll abort; poll flags never gate the click",
  );
  assert(onDecideBlock.includes("reviewing || reviewingRef.current"), "double-submit uses reviewing + reviewingRef");
  assert(onDecideBlock.includes("reviewGen.current"), "review generation guard in onDecide");
  assert(onDecideBlock.includes("reviewingRef.current = true"), "claims review in-flight before POST");
  const approveClick = card.indexOf('onClick={() => void onDecide("approve")}');
  const needsClick = card.indexOf('onClick={() => void onDecide("needs_attention")}');
  assert(approveClick > -1 && needsClick > approveClick, "approve and needs attention share the same onDecide");
  assert(
    card.slice(approveClick - 120, approveClick).includes("disabled={!reviewActionsEnabled}") &&
      card.slice(needsClick - 120, needsClick).includes("disabled={!reviewActionsEnabled}"),
    "Approve and Needs attention use identical disabled gating",
  );
  assert(card.includes("reviewable,"), "not-reviewable/non-submitted remains a real gate");
  assert(card.includes("photoCount,"), "zero photos remains a real gate");
  assert(card.includes("galleryLoading,"), "gallery loading remains a real gate");
  assert(card.includes("generating: busy"), "generate/workflow busy remains a real gate");
  assert(card.includes("reviewing,"), "review-in-progress remains a real gate");
  // Stale status cannot overwrite post-decision: poll skips while reviewing + generation checks.
  assert(card.includes("if (reviewingRef.current) return"), "poll skips while reviewing");
  assert(card.includes("if (generation !== statusGen.current || reviewingRef.current) return"), "stale status response ignored after invalidate/review");
  assert(card.includes("generation !== statusGen.current"), "status generation guards apply updates");
  assert(card.includes("<img"), "in-card images");
  assert(card.includes("grid grid-cols-1"), "one photo uses one column");
  assert(card.includes("grid grid-cols-2 gap-2"), "multiple photos use two columns");
  assert(!card.includes("grid-cols-4") && !card.includes("sm:grid-cols-4"), "never four columns");
  assert(card.includes("object-contain"), "object-contain preserves the frame");
  assert(!card.includes("object-cover"), "gallery never uses object-cover");
  assert(card.includes("w-full") && card.includes("h-auto"), "full width and natural height");
  assert(card.includes("max-h-[70vh] sm:max-h-[32rem]"), "responsive max height");
  assert(card.includes("col-span-full w-full"), "expanded/single photo spans gallery width");
  assert(card.includes("aria-expanded={expanded}"), "accessible expanded state");
  assert(card.includes("aria-label="), "accessible toggle label");
  assert(card.includes('setExpandedPhotoKey("")'), "expanded state clears");
  assert(card.includes("parsed.some((row) => row.id === current)"), "stale expanded key cleared after list refresh");
  assert(!card.includes("window.open") && !card.includes("createPortal"), "no window.open or portal");
  assert(!card.includes("createPortal") && !card.includes("role=\"dialog\""), "no modal");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_PHOTO_REVIEW_PATH"), "review POST path");
  assert(card.includes("housekeepingProofHostReviewBody(reservationId, stage, decision)"), "review body uses helper");
  assert(!card.includes("reviewedBy"), "no reviewedBy");
  assert(!card.includes("housekeeping-panel"), "no housekeeping-panel import");
  assert(!card.includes("decision: \"approved\""), "does not send approved as decision");
  assert(card.includes('onClick={() => void onDecide("approve")}'), "approve action");
  assert(card.includes('onClick={() => void onDecide("needs_attention")}'), "needs attention action");
  assert(
    card.indexOf("HOUSEKEEPING_PROOF_HOST_COPY.uploadedPhotos") > -1 &&
      card.indexOf("galleryPhotos.map") > card.indexOf("HOUSEKEEPING_PROOF_HOST_COPY.uploadedPhotos") &&
      card.indexOf("HOUSEKEEPING_PROOF_HOST_COPY.reviewDecision") > card.indexOf("galleryPhotos.map") &&
      card.indexOf('onClick={() => void onDecide("approve")}') > card.indexOf("HOUSEKEEPING_PROOF_HOST_COPY.reviewDecision") &&
      card.indexOf('onClick={() => void onDecide("needs_attention")}') > card.indexOf('onClick={() => void onDecide("approve")}') &&
      card.lastIndexOf("setGalleryOpen(false)") > card.indexOf('onClick={() => void onDecide("needs_attention")}'),
    "gallery then decision then close hierarchy",
  );
  assert(!/per-photo|photoDecision|approvePhoto|rejectPhoto/.test(card), "no per-photo decision state");
  const confirmCount = [...card.matchAll(/window\.confirm/g)].length;
  assert(confirmCount === 2, "confirm only for replace and approve");
  assert(card.includes("decision === \"approve\""), "confirm gated to approve");
  assert(
    card.indexOf("HOUSEKEEPING_PROOF_HOST_COPY.approveConfirm") > -1 &&
      card.indexOf("fetch(HOUSEKEEPING_PROOF_HOST_PHOTO_REVIEW_PATH") >
        card.indexOf("HOUSEKEEPING_PROOF_HOST_COPY.approveConfirm"),
    "cancelled approve returns before fetch",
  );
  assert(!card.includes("needsAttentionConfirm"), "needs attention has no confirmation copy");
  assert(card.includes('type="button"'), "buttons are type button");
  assert(card.includes("reviewActionsVisible"), "review buttons gated by pending photos");
  assert(card.includes("photoCount > 0"), "buttons require pending photos");
  assert(card.includes("awaitingFinish"), "waiting state before Finish");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_COPY.awaitingFinish"), "awaiting finish copy");
  assert(card.includes("submissionReceived"), "submitted state banner");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_COPY.submissionReceived"), "submission received copy");
  assert(card.includes("setReviewable(parsed.reviewable)"), "status reviewable retained");
  assert(card.includes("setCanIssueLink(parsed.canIssueLink)"), "status canIssueLink retained");
  assert(card.includes("canIssueLink,"), "generate gate receives canIssueLink");
  assert(card.includes('setNotice("generateCancelled")'), "cancelled replace reports clearly");
  assert(card.includes('setNotice("generateSubmittedBlocked")'), "submitted conflict reports clearly");
  assert(card.includes('err === "submitted"'), "maps server submitted conflict");
  assert(card.includes("pathRef.current = previousPath"), "failed generate restores previous path");
  assert(card.includes("urlRef.current = previousUrl"), "failed generate restores previous url");
  assert(card.includes("reviewActionsVisuallyMuted"), "no-blink visual mute preserved");
  assert(card.includes("statusLoading: false"), "poll loading does not fade or disable decision buttons");
  assert(card.includes("controlsLocked"), "review loading disables competing actions");
  assert(card.includes("reviewAbort"), "dedicated review AbortController");
  assert(card.includes("reviewGen.current"), "review generation guard");
  assert(card.includes("reviewingRef.current"), "review in-flight guard");
  assert(card.includes("if (reviewingRef.current) return") || card.includes("reviewing || reviewingRef.current"), "rapid re-entry blocked before second POST");
  assert(card.includes("reviewAbort.current?.abort()"), "new review aborts prior in-flight review");
  assert(card.includes("const gen = reviewGen.current + 1"), "single review generation claim per decision");
  assert(card.includes("gen !== reviewGen.current"), "stale review response ignored");
  assert(card.includes("statusEpoch"), "status poll restart after review");
  assert(!card.includes("optionsEpoch"), "approve must not refresh options and hide stay selectors");
  assert(!card.includes("setOptionsEpoch"), "no optionsEpoch bump after review");
  assert(card.includes("if (reviewingRef.current) return"), "poll skips while reviewing");
  assert(card.includes("setGalleryOpen(false)"), "success closes gallery");
  assert(card.includes("setGalleryPhotos([])"), "success clears pending gallery photos");
  assert(card.includes("setExpandedPhotoKey(\"\")"), "success clears expanded photo");
  assert(card.includes("setPhotoCount(0)"), "success clears pending count until refresh");
  assert(card.includes('parsed.status === "approved"'), "approve success branch");
  assert(card.includes('setNotice("reviewApproved")'), "approve success notice");
  assert(card.includes('setNotice("reviewNeedsAttention")'), "needs attention success notice");
  assert(card.includes("setCanIssueLink(false)"), "approved task keeps Generate unavailable");
  assert(card.includes('loadState === "ready"') || card.includes('shellVisible'), "selectors stay in ready/empty UI");
  assert(card.includes('loadState === "ready" || loadState === "empty"'), "empty reload still shows control shell");
  assert(card.includes("shellVisible"), "stable control shell flag");
  assert(card.includes("noEligibleStays"), "empty eligible-stays gate");
  assert(card.includes("disabled={!generateEnabled || noEligibleStays}"), "Generate stays visible but disabled with no eligible stays");
  assert(card.includes("disabled={controlsLocked || noEligibleStays || !properties.length}"), "Property stays visible when empty");
  assert(card.includes("disabled={controlsLocked || noEligibleStays || !stays.length}"), "Stay stays visible when empty");
  assert(card.includes("disabled={controlsLocked || noEligibleStays || !selectedStay}"), "Stage stays visible when empty");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_COPY.empty.en"), "empty placeholder/copy used in shell");
  assert(card.includes("Property / Propiedad"), "property selector remains in card");
  assert(card.includes("Stay / Estadía"), "stay selector remains in card");
  assert(card.includes("Stage / Etapa"), "stage selector remains in card");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_COPY.generate.en") || card.includes("HOUSEKEEPING_PROOF_HOST_COPY.generate"), "Generate label remains rendered");
  assert(card.includes("setCanIssueLink(false)"), "approved task keeps Generate unavailable");
  assert(!card.includes("setOptionsEpoch"), "no optionsEpoch bump after review");
  assert(card.includes('setLoadState(parsed.reservations.length ? "ready" : "empty")'), "refresh maps zero reservations to empty without hiding shell");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_COPY.reviewNeedsAttention"), "needs attention success copy");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_COPY.reviewForbidden"), "403 review copy");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_COPY.reviewSaveFailed"), "generic review failure copy");
  assert(!card.includes("payload.error") && !card.includes(".error}"), "no server error text");
  assert(!/router\.(push|replace)|TabsTrigger|createPortal/.test(card), "no new nav/tab/modal/route");
  assert(!/createBrowserClient|Realtime|channel\(/.test(card), "no browser supabase realtime");
  assert(card.includes("HOUSEKEEPING_PROOF_HOST_COPY.title.en"), "bilingual title");
  assert(card.includes("{property.name}"), "property name displayed");
  assert(card.includes("stay.checkIn") && card.includes("stay.checkOut") && card.includes("stay.status"), "stay dates and status displayed");
  assert(!card.includes("{path}") && !card.includes("{url}") && !card.includes("urlRef.current}"), "path/url not rendered");
  assert(!card.includes("stay.guest") && !card.includes("property.city"), "no guest or city fields rendered");

  assert(!/localStorage|sessionStorage|document\.cookie/.test(combined), "no browser storage");
  assert(!/console\.(log|info|debug|error|warn)/.test(combined), "no console");
  assert(!/data-[A-Za-z-]+=/.test(card), "no data attributes");
  assert(!/wa\.me|sms:|mailto:/.test(combined), "no auto-send protocols");
  assert(!/GuestQrCard|guest-stay-qr|issueGuestStayLink|validateGuestStayToken|GUEST_STAY_PATH|stay-links/.test(combined), "no guest QR/token reuse");
  assert(!/fetchListings|createBrowserClient|getPublicUrl|createSignedUrl/.test(combined), "no listings or public storage");
  assert(!combined.includes("/housekeeping/upload"), "no legacy upload");
  assert(!/location\.href\s*=|router\.(push|replace)|URLSearchParams/.test(card), "no navigation or query builder");
  assert(HOUSEKEEPING_PROOF_HOST_COPY.copied.en === "Link copied. Paste it into WhatsApp, Messages, or email.", "copy success en");
  assert(
    HOUSEKEEPING_PROOF_HOST_COPY.replace.es ===
      "Crear un enlace nuevo reemplaza el enlace anterior de limpieza para esta estadía y etapa. ¿Continuar?",
    "replace es",
  );
}

const isDirectRun = process.argv[1]?.includes("housekeeping-proof-link-card.test");
if (isDirectRun) {
  try {
    runHousekeepingProofLinkCardTests();
    console.log("housekeeping-proof-link-card tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "housekeeping-proof-link-card tests failed");
    process.exitCode = 1;
  }
}
