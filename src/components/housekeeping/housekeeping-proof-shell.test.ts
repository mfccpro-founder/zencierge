import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOUSEKEEPING_PROOF_CLIENT_PHOTO_MAX_BYTES,
  HOUSEKEEPING_PROOF_SHELL_COPY,
  HOUSEKEEPING_PROOF_SHELL_STATUS_POLL_MS,
  HOUSEKEEPING_PROOF_SUBMIT_PATH,
  HOUSEKEEPING_PROOF_UPLOAD_PATH,
  HOUSEKEEPING_PROOF_VALIDATE_PATH,
  canStartHousekeepingProofPhotoUpload,
  canStartHousekeepingProofSubmit,
  formatHousekeepingProofDueAt,
  housekeepingProofClientPhotoIssue,
  housekeepingProofPhotoFormData,
  housekeepingProofRequestBody,
  housekeepingProofShellShouldKeepLastGood,
  housekeepingProofShellShouldPoll,
  housekeepingProofShowsFinish,
  housekeepingProofShowsPhotoCapture,
  housekeepingProofShowsTask,
  interpretHousekeepingProofShellPayload,
  interpretHousekeepingProofSubmitPayload,
  interpretHousekeepingProofUploadPayload,
} from "./housekeeping-proof-shell";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const publicTask = {
  ok: true,
  propertyName: "Bayview Loft",
  city: "Miami Beach",
  stage: "post_checkout" as const,
  dueAt: "2026-09-14T11:00:00.000Z",
  status: "open" as const,
  hasPendingPhotos: false,
};

export function runHousekeepingProofShellTests() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "../..");
  const shellSource = readFileSync(join(here, "housekeeping-proof-shell.tsx"), "utf8");
  const pageSource = readFileSync(join(root, "app/housekeeping/p/[token]/page.tsx"), "utf8");
  const middlewareSource = readFileSync(join(root, "middleware.ts"), "utf8");

  assert(HOUSEKEEPING_PROOF_VALIDATE_PATH === "/api/housekeeping/proof", "validate path");
  assert(HOUSEKEEPING_PROOF_UPLOAD_PATH === "/api/housekeeping/proof/upload", "upload path");
  assert(HOUSEKEEPING_PROOF_SUBMIT_PATH === "/api/housekeeping/proof/submit", "submit path");
  assert(Object.keys(housekeepingProofRequestBody("sample")).join(",") === "token", "JSON body is token only");
  assert(shellSource.includes('method: "POST"'), "uses POST");
  assert(shellSource.includes("HOUSEKEEPING_PROOF_VALIDATE_PATH"), "posts to proof API");
  assert(shellSource.includes("HOUSEKEEPING_PROOF_SUBMIT_PATH"), "posts finish to submit API");
  assert(shellSource.includes("JSON.stringify(housekeepingProofRequestBody(token))"), "token is JSON body only");
  assert(shellSource.includes('"Content-Type": "application/json"'), "JSON content type");
  assert(shellSource.includes('"Cache-Control": "no-store"'), "fetch is no-store");
  assert(shellSource.includes('cache: "no-store"'), "cache mode no-store");
  assert(shellSource.includes('referrer: "no-referrer"'), "fetch no-referrer");
  assert(shellSource.includes("AbortController"), "validation fetch is abortable");
  assert(shellSource.includes("controller.abort()"), "unmount aborts fetch");
  assert(shellSource.includes("if (cancelled) return"), "stale responses are dropped");
  assert(shellSource.includes("signal: controller.signal"), "abort signal is attached");

  const open = interpretHousekeepingProofShellPayload(true, publicTask);
  assert(open.state === "open" && open.task?.propertyName === "Bayview Loft", "open task maps");
  assert(open.task?.city === "Miami Beach", "city maps");
  assert(open.task?.stage === "post_checkout", "stage maps");
  assert(open.task?.hasPendingPhotos === false, "hasPendingPhotos maps false");
  assert(housekeepingProofShowsTask(open.state, open.task), "open task is visible");
  assert(housekeepingProofShowsPhotoCapture(open.state, open.task), "open shows photo capture");
  assert(!housekeepingProofShowsFinish(open.state, open.task, false), "finish hidden without pending or session upload");
  assert(housekeepingProofShowsFinish(open.state, open.task, true), "finish visible after session upload");
  assert(
    housekeepingProofShowsFinish(open.state, { ...open.task!, hasPendingPhotos: true }, false),
    "finish visible from server hasPendingPhotos after reload",
  );

  const submitted = interpretHousekeepingProofShellPayload(true, { ...publicTask, status: "submitted", hasPendingPhotos: true });
  const attention = interpretHousekeepingProofShellPayload(true, { ...publicTask, status: "needs_attention" });
  const checkin = interpretHousekeepingProofShellPayload(true, { ...publicTask, stage: "ready_for_checkin" });
  assert(submitted.state === "submitted", "submitted maps");
  assert(attention.state === "needs_attention", "needs_attention maps");
  assert(checkin.task?.stage === "ready_for_checkin", "ready_for_checkin maps");
  assert(housekeepingProofShowsPhotoCapture(attention.state, attention.task), "needs_attention shows photo capture");
  assert(!housekeepingProofShowsPhotoCapture(submitted.state, submitted.task), "submitted hides photo capture");
  assert(!housekeepingProofShowsFinish(attention.state, attention.task, false), "needs_attention without pending hides finish");
  assert(
    housekeepingProofShowsFinish(attention.state, { ...attention.task!, hasPendingPhotos: true }, false),
    "needs_attention with new pending shows finish",
  );
  assert(!housekeepingProofShowsPhotoCapture("loading", null), "loading hides photo capture");
  assert(!housekeepingProofShowsPhotoCapture("invalid", null), "invalid hides photo capture");
  assert(!housekeepingProofShowsPhotoCapture("expired", null), "expired hides photo capture");
  assert(!housekeepingProofShowsPhotoCapture("revoked", null), "revoked hides photo capture");
  assert(!housekeepingProofShowsPhotoCapture("unavailable", null), "unavailable hides photo capture");
  assert(!housekeepingProofShowsPhotoCapture("approved", null), "approved hides photo capture");
  assert(!housekeepingProofShowsTask("approved", null), "approved has no task view");

  const approvedOk = interpretHousekeepingProofShellPayload(true, { ok: true, status: "approved" });
  assert(approvedOk.state === "approved" && approvedOk.task === null, "approved parser accepts exact ok,status");
  assert(
    interpretHousekeepingProofShellPayload(true, { ok: true, status: "approved", propertyName: "Bayview Loft" }).state === "invalid",
    "approved extra keys are rejected",
  );
  assert(interpretHousekeepingProofShellPayload(true, { ok: true, status: "approved", city: "Miami Beach" }).state === "invalid", "approved city extra key rejected");
  assert(interpretHousekeepingProofShellPayload(true, { status: "approved" }).state === "invalid", "approved missing ok is rejected");
  assert(interpretHousekeepingProofShellPayload(false, { error: "invalid" }).state === "invalid", "invalid error");
  assert(interpretHousekeepingProofShellPayload(false, { error: "expired" }).state === "expired", "expired error");
  assert(interpretHousekeepingProofShellPayload(false, { error: "revoked" }).state === "revoked", "revoked error");
  assert(interpretHousekeepingProofShellPayload(false, { error: "unavailable" }).state === "unavailable", "unavailable error");
  assert(interpretHousekeepingProofShellPayload(true, { ok: true }).state === "invalid", "malformed success is invalid");
  assert(interpretHousekeepingProofShellPayload(true, { ...publicTask, stage: "during_stay" }).state === "invalid", "unknown stage is invalid");
  assert(interpretHousekeepingProofShellPayload(true, { ...publicTask, status: "closed" }).state === "invalid", "closed is not a public portal");
  assert(interpretHousekeepingProofShellPayload(true, { ...publicTask, reservationId: "res-1" }).state === "invalid", "extra private keys rejected");
  assert(interpretHousekeepingProofShellPayload(true, { ...publicTask, hasPendingPhotos: "yes" }).state === "invalid", "non-boolean hasPendingPhotos rejected");
  assert(canStartHousekeepingProofSubmit({ uploading: false, submitting: false, showFinish: true }), "submit can start");
  assert(!canStartHousekeepingProofSubmit({ uploading: true, submitting: false, showFinish: true }), "submit blocked while uploading");
  assert(!canStartHousekeepingProofSubmit({ uploading: false, submitting: true, showFinish: true }), "submit blocked while submitting");
  assert(interpretHousekeepingProofSubmitPayload(200, { ok: true, status: "submitted", idempotent: false }) === "success", "submit success");
  assert(interpretHousekeepingProofSubmitPayload(200, { ok: true, status: "submitted", idempotent: false, extra: 1 }) === "unavailable", "submit extra keys rejected");
  assert(interpretHousekeepingProofSubmitPayload(410, { error: "expired" }) === "expired", "submit expired");
  assert(interpretHousekeepingProofSubmitPayload(409, { error: "unavailable" }) === "unavailable", "submit unavailable");

  assert(HOUSEKEEPING_PROOF_SHELL_COPY.loading.en === "Loading" && HOUSEKEEPING_PROOF_SHELL_COPY.loading.es === "Cargando", "loading copy");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.status.open.en === "Open" && HOUSEKEEPING_PROOF_SHELL_COPY.status.open.es === "Abierta", "open copy");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.status.submitted.en === "Submitted" && HOUSEKEEPING_PROOF_SHELL_COPY.status.submitted.es === "Enviada", "submitted copy");
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.status.needs_attention.en === "Needs attention" &&
      HOUSEKEEPING_PROOF_SHELL_COPY.status.needs_attention.es === "Necesita atención",
    "needs attention copy",
  );
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.invalid.en === "Invalid link" && HOUSEKEEPING_PROOF_SHELL_COPY.invalid.es === "Enlace inválido", "invalid copy");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.expired.en === "Expired link" && HOUSEKEEPING_PROOF_SHELL_COPY.expired.es === "Enlace vencido", "expired copy");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.revoked.en === "Revoked link" && HOUSEKEEPING_PROOF_SHELL_COPY.revoked.es === "Enlace revocado", "revoked copy");
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.unavailable.en === "Temporarily unavailable" &&
      HOUSEKEEPING_PROOF_SHELL_COPY.unavailable.es === "Temporalmente no disponible",
    "unavailable copy",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.approved.en === "Photos approved. No further uploads are needed.",
    "approved English copy",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.approved.es === "Fotos aprobadas. No se necesitan más fotos.",
    "approved Spanish copy",
  );
  assert(housekeepingProofShellShouldPoll("open") && housekeepingProofShellShouldPoll("submitted") && housekeepingProofShellShouldPoll("needs_attention"), "polls while assignment is active");
  assert(
    !housekeepingProofShellShouldPoll("approved") &&
      !housekeepingProofShellShouldPoll("unavailable") &&
      !housekeepingProofShellShouldPoll("invalid") &&
      !housekeepingProofShellShouldPoll("expired") &&
      !housekeepingProofShellShouldPoll("revoked") &&
      !housekeepingProofShellShouldPoll("loading"),
    "terminal states stop polling",
  );
  assert(HOUSEKEEPING_PROOF_SHELL_STATUS_POLL_MS === 20_000, "poll interval is 20 seconds");
  assert(60_000 / HOUSEKEEPING_PROOF_SHELL_STATUS_POLL_MS <= 20, "20s poll stays under validate rate max");
  assert(housekeepingProofShellShouldKeepLastGood(503) && housekeepingProofShellShouldKeepLastGood(429), "poll 5xx/429 keep last good UI");
  assert(!housekeepingProofShellShouldKeepLastGood(409) && !housekeepingProofShellShouldKeepLastGood(200), "closed 409 is applied");
  assert(shellSource.includes("window.setInterval"), "uses interval polling");
  assert(shellSource.includes("HOUSEKEEPING_PROOF_SHELL_STATUS_POLL_MS"), "interval uses 20s constant");
  assert(shellSource.includes("document.hidden"), "skips polls while hidden");
  assert(shellSource.includes('document.addEventListener("visibilitychange"'), "listens for visibility");
  assert(shellSource.includes("document.removeEventListener(\"visibilitychange\""), "removes visibility listener");
  assert(shellSource.includes("window.clearInterval(timer)"), "clears poll timer on unmount");
  assert(shellSource.includes("validateAbort"), "dedicated validation AbortController");
  assert(shellSource.includes("validateGen"), "generation guards stale validation");
  assert(shellSource.includes("validateInFlight.current"), "no overlapping validation");
  assert(shellSource.includes("uploadingRef.current"), "polls do not start or apply during upload");
  assert(shellSource.includes("housekeepingProofShellShouldKeepLastGood(response.status)"), "poll 5xx keeps last good page");
  assert(shellSource.includes("const enterApprovedState = useCallback"), "approved transition is explicit");
  assert(shellSource.includes("enterApprovedState()"), "approved payload enters approved state");
  assert(shellSource.includes("uploadAbortRef.current?.abort()"), "approved transition aborts in-flight upload");
  assert(shellSource.includes("resetFile()"), "approved transition clears file and preview");
  assert(shellSource.includes('setState("approved")'), "approved is a dedicated terminal state");
  assert(shellSource.includes("HOUSEKEEPING_PROOF_SHELL_COPY.approved"), "approved copy is rendered");
  assert(!shellSource.includes("role=\"dialog\"") && !shellSource.includes("showModal"), "no modal on approved");
  assert(!shellSource.includes("useRouter") && !shellSource.includes("router.push"), "no navigation changes");
  assert(!shellSource.includes("housekeeping-proof-link-card") && !shellSource.includes("GuestQrCard"), "no D3 host-card changes");
  assert(!shellSource.includes("createChannel") && !shellSource.includes("realtime"), "no Realtime");
  assert(!/\bpropertyId\b/.test(shellSource) && !/\breviewedBy\b/.test(shellSource), "no propertyId or reviewedBy sent");
  assert((shellSource.match(/HOUSEKEEPING_PROOF_VALIDATE_PATH/g) ?? []).length >= 2, "status refresh reuses proof POST path");
  assert(!shellSource.includes("/api/housekeeping/proof-photos"), "does not add another proof API");
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.stage.post_checkout.en === "Post-checkout inspection" &&
      HOUSEKEEPING_PROOF_SHELL_COPY.stage.post_checkout.es === "Inspección después de la salida",
    "post-checkout labels",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.stage.ready_for_checkin.en === "Ready for check-in" &&
      HOUSEKEEPING_PROOF_SHELL_COPY.stage.ready_for_checkin.es === "Preparación para la llegada",
    "ready for check-in labels",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.photoGuide.en === "Take clear photos of the bedroom, bathroom, kitchen, and living area.",
    "photo guide English",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.photoGuide.es === "Toma fotos claras del dormitorio, baño, cocina y sala.",
    "photo guide Spanish",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.photoPrivacy.en === "Photos are private and visible only to the authorized host.",
    "privacy English",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.photoPrivacy.es === "Las fotos son privadas y solo puede verlas el anfitrión autorizado.",
    "privacy Spanish",
  );
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.takePhoto.en === "Take or choose photo", "take English");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.takePhoto.es === "Tomar o elegir foto", "take Spanish");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.upload.en === "Upload securely", "upload English");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.upload.es === "Enviar de forma segura", "upload Spanish");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.uploading.en === "Uploading…", "uploading English");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.uploading.es === "Enviando…", "uploading Spanish");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.uploaded.en === "Photo uploaded securely.", "uploaded English");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.uploaded.es === "Foto enviada de forma segura.", "uploaded Spanish");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.takeAnother.en === "Take another photo", "another English");
  assert(HOUSEKEEPING_PROOF_SHELL_COPY.takeAnother.es === "Tomar otra foto", "another Spanish");
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.uploadInvalid.en === "Photo not accepted. Check the file or request a new link.",
    "invalid upload English",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.uploadExpired.en === "This link has expired. Ask the host for a new link.",
    "expired upload English",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.uploadRevoked.en === "This link was replaced. Ask the host for a new link.",
    "revoked upload English",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.uploadUnavailable.en === "Photo upload is temporarily unavailable. Try again later.",
    "unavailable upload English",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.uploadInvalid.es === "Foto no aceptada. Revisa el archivo o solicita un enlace nuevo.",
    "invalid upload Spanish",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.uploadExpired.es === "Este enlace venció. Solicita uno nuevo al anfitrión.",
    "expired upload Spanish",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.uploadRevoked.es === "Este enlace fue reemplazado. Solicita uno nuevo al anfitrión.",
    "revoked upload Spanish",
  );
  assert(
    HOUSEKEEPING_PROOF_SHELL_COPY.uploadUnavailable.es ===
      "El envío de fotos no está disponible temporalmente. Intenta más tarde.",
    "unavailable upload Spanish",
  );
  assert(shellSource.includes("HOUSEKEEPING_PROOF_SHELL_COPY.stage[task.stage]"), "stage labels render from allowlist");
  assert(shellSource.includes("HOUSEKEEPING_PROOF_SHELL_COPY.status[task.status]"), "status labels render from allowlist");
  assert(formatHousekeepingProofDueAt("not-a-date") === null, "invalid due time is omitted");
  assert(typeof formatHousekeepingProofDueAt(publicTask.dueAt) === "string", "valid due time formats");
  assert(shellSource.includes("dueLabel ?"), "due time renders only when present");

  assert(shellSource.includes('type="file"'), "file input present");
  assert(shellSource.includes('accept="image/jpeg,image/png,image/webp"'), "accept jpeg png webp");
  assert(shellSource.includes('capture="environment"'), "rear camera capture");
  assert(shellSource.includes("housekeepingProofShowsPhotoCapture"), "photo controls are gated");
  assert(shellSource.includes("fileInputRef.current?.click()"), "camera opens from a deliberate click");
  assert(!shellSource.includes("getUserMedia"), "no persistent camera permission request");
  assert(shellSource.includes("onClick={() => void onUpload()}"), "upload is a deliberate second action");
  assert(!shellSource.includes("onPickFile") || !/onChange=\{[^}]*onUpload/.test(shellSource), "selection does not upload immediately");

  const dummy = new File([new Uint8Array([1, 2, 3])], "secret-name.jpg", { type: "image/jpeg" });
  const form = housekeepingProofPhotoFormData("sample-token", dummy);
  assert([...form.keys()].sort().join(",") === "photo,token", "FormData keys are token and photo only");
  assert(housekeepingProofClientPhotoIssue(dummy) === null, "jpeg precheck passes");
  assert(housekeepingProofClientPhotoIssue(new File([], "x.jpg", { type: "image/jpeg" })) === "empty", "empty file rejected before fetch");
  assert(
    housekeepingProofClientPhotoIssue(new File([new Uint8Array(HOUSEKEEPING_PROOF_CLIENT_PHOTO_MAX_BYTES + 1)], "x.jpg", { type: "image/jpeg" })) ===
      "oversized",
    "oversized file rejected before fetch",
  );
  assert(housekeepingProofClientPhotoIssue(new File([new Uint8Array([1])], "x.gif", { type: "image/gif" })) === "type", "disallowed MIME rejected before fetch");
  assert(!canStartHousekeepingProofPhotoUpload({ uploading: true, file: dummy }), "duplicate upload click prevented");
  assert(canStartHousekeepingProofPhotoUpload({ uploading: false, file: dummy }), "idle upload allowed");
  assert(!canStartHousekeepingProofPhotoUpload({ uploading: false, file: null }), "upload requires a selected file");

  assert(interpretHousekeepingProofUploadPayload(200, { ok: true }) === "success", "upload success");
  assert(interpretHousekeepingProofUploadPayload(400, { error: "invalid" }) === "invalid", "upload invalid");
  assert(interpretHousekeepingProofUploadPayload(410, { error: "expired" }) === "expired", "upload expired");
  assert(interpretHousekeepingProofUploadPayload(410, { error: "revoked" }) === "revoked", "upload revoked");
  assert(interpretHousekeepingProofUploadPayload(429, { error: "unavailable" }) === "unavailable", "upload 429");
  assert(interpretHousekeepingProofUploadPayload(503, null) === "unavailable", "network-style failure");

  const uploadFn = shellSource.slice(shellSource.indexOf("async function onUpload()"));
  const uploadInit = uploadFn.slice(0, uploadFn.indexOf("async function onFinish()"));
  assert(uploadInit.includes('cache: "no-store"'), "upload cache no-store");
  assert(uploadInit.includes('credentials: "omit"'), "upload credentials omit");
  assert(uploadInit.includes('referrerPolicy: "no-referrer"'), "upload referrer no-referrer");
  assert(!uploadInit.includes("Content-Type"), "browser sets multipart boundary");
  assert(uploadInit.includes("housekeepingProofPhotoFormData(token, selected)"), "upload body is token+photo FormData");
  assert(shellSource.includes("uploadAbortRef.current?.abort()"), "in-flight upload is aborted");
  assert(shellSource.includes("gen !== selectionGen.current"), "stale upload responses are dropped");
  assert(shellSource.includes("resetFile()"), "successful upload clears the File");
  assert(shellSource.includes("setNotice(\"success\")"), "success notice after upload");
  assert(shellSource.includes("setSessionHadUpload(true)"), "successful upload unlocks finish for session");
  assert(shellSource.includes("async function onFinish()"), "finish handler present");
  assert(shellSource.includes("HOUSEKEEPING_PROOF_SUBMIT_PATH"), "finish posts to submit path");
  assert(shellSource.includes("interpretHousekeepingProofSubmitPayload"), "finish interprets submit payload");
  assert(shellSource.includes("enterSubmittedState(task)"), "finish enters submitted state");
  assert(shellSource.includes("gen !== submitGen.current"), "stale submit responses dropped");
  assert(!uploadInit.includes("fileInputRef.current?.click()"), "success does not reopen the camera");
  assert(!/setTimeout/.test(shellSource) && !/\bretry\b/i.test(shellSource), "no automatic retry");
  assert(shellSource.includes('setState(outcome)') && shellSource.includes('outcome === "expired"'), "expired upload removes capture by leaving the task");
  assert(shellSource.includes("setTask(null)"), "expired/revoked drop assignment controls");
  assert(shellSource.includes("setNotice(outcome === \"invalid\" ? \"invalid\" : \"unavailable\")"), "ordinary failure keeps assignment and shows a safe notice");
  assert(shellSource.includes("revokeObjectURL"), "preview URLs are revoked");
  assert(shellSource.includes("HOUSEKEEPING_PROOF_SHELL_COPY.previewAlt"), "preview uses generic alt text");
  assert(!shellSource.includes("selected.name") && !shellSource.includes("file.name"), "filename is not rendered");
  assert(!shellSource.includes("lastModified") && !shellSource.includes("exif"), "file metadata is not rendered");
  assert(shellSource.includes("min-h-11"), "touch targets are at least 44px");

  assert(pageSource.includes("HousekeepingProofShell"), "page mounts the shell");
  assert(pageSource.includes("robots: { index: false, follow: false }"), "noindex/nofollow");
  assert(pageSource.includes('referrer: "no-referrer"'), "page no-referrer");
  assert(pageSource.includes('dynamic = "force-dynamic"'), "page is dynamic");
  assert(middlewareSource.includes('path.startsWith("/housekeeping/p")'), "middleware protects the proof path");
  const proofMw = middlewareSource.slice(middlewareSource.indexOf('path.startsWith("/housekeeping/p")'));
  assert(proofMw.includes('"Cache-Control", "no-store"'), "middleware no-store");
  assert(proofMw.includes('"Referrer-Policy", "no-referrer"'), "middleware no-referrer");

  const combined = `${shellSource}\n${pageSource}`;
  assert(!/localStorage|sessionStorage|document\.cookie/.test(combined), "no cookie or storage use");
  assert(!/console\.(log|info|debug|error|warn)/.test(combined), "no console output");
  assert(!/searchParams|location\.href|URLSearchParams/.test(combined), "token is not placed on a query string");
  assert(!/data-[A-Za-z-]+=/.test(combined), "no data attributes");
  assert(!combined.includes("pathname"), "pathname is not logged or rendered");
  assert(shellSource.includes("Finish and send") && shellSource.includes("Terminar y enviar"), "finish bilingual labels");
  assert(shellSource.includes("Photos sent successfully. You may close this page."), "submitted success English");
  assert(shellSource.includes("Fotos enviadas correctamente. Puedes cerrar esta página."), "submitted success Spanish");
  assert(shellSource.includes("enterSubmittedState"), "explicit submitted transition");
  assert(shellSource.includes("setSessionHadUpload(true)"), "session upload unlocks finish");
  assert(shellSource.includes("hasPendingPhotos"), "server pending truth restores finish");
  assert(shellSource.includes("aria-busy={submitting}"), "submit busy state");
  assert(!/Start Job|Finish Job|review_status/.test(combined), "no legacy job or review fields");
  assert(!/createBrowserClient|createClient\(/.test(combined), "no Supabase browser client");
  assert(!/getPublicUrl|createSignedUrl/.test(combined), "no public or signed URL");
  assert(!combined.includes("/housekeeping/upload"), "does not reuse legacy upload");
  assert(!/\/guest\/s\/|issueGuestStayLink|validateGuestStayToken|GuestStayShell/.test(combined), "no guest-stay reuse");
  assert(!/https?:\/\/|gtag|analytics|googletagmanager|facebook\.net/.test(combined), "no external URLs or trackers");
  assert(!combined.includes("reservationId") && !combined.includes("propertyId"), "ids are not rendered");
  assert(!/wifi|lockbox|handbook|accessCode|guestName|payment/i.test(combined), "no private listing fields");
  assert(!/openai|vision|analyzePhoto|ai vision/i.test(combined), "no AI vision");
  assert(shellSource.includes('aria-live="polite"'), "status region is announced");
  assert(shellSource.includes("overflow-x-hidden"), "no horizontal scrolling");
  assert(shellSource.includes("from-[#071833]"), "navy mobile background");
  assert(shellSource.includes("text-cyan-300/90"), "turquoise accent");
}

const isDirectRun = process.argv[1]?.includes("housekeeping-proof-shell.test");
if (isDirectRun) {
  try {
    runHousekeepingProofShellTests();
    console.log("housekeeping-proof-shell tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "housekeeping-proof-shell tests failed");
    process.exitCode = 1;
  }
}
