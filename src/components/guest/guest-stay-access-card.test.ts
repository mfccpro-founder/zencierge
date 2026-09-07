import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GUEST_STAY_ACCESS_COPY,
  GUEST_STAY_ACCESS_MAX_FIELD_CHARS,
  GUEST_STAY_ACCESS_PATH,
  GUEST_STAY_ACCESS_POLL_MS,
  GUEST_STAY_ACCESS_SECRET_MASK,
  applyGuestStayAccessOutcome,
  classifyGuestStayAccessFailure,
  classifyGuestStayAccessResponse,
  guestStayAccessAllEmpty,
  guestStayAccessReadyChanged,
  guestStayAccessRequestBody,
  guestStayAccessSafeMessage,
  guestStayAccessShouldKeepLastGood,
  guestStayAccessShouldPoll,
  guestStayAccessVisibleRows,
  parseGuestStayAccessSuccess,
  type GuestStayAccessUi,
} from "./guest-stay-access-card";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const readyFields = {
  wifiNetwork: "GuestNet",
  wifiPassword: "pass-word",
  doorCode: "1234",
};

const readyPayload = {
  ok: true,
  status: "ready" as const,
  ...readyFields,
};

const pendingPayload = { ok: true, status: "pending" as const };

const readyUi = (): GuestStayAccessUi => ({
  view: "ready",
  fields: { ...readyFields },
  showPassword: true,
  showDoor: true,
  hadValid: true,
});

export function runGuestStayAccessCardTests() {
  const root = join(process.cwd(), "src");
  const cardSource = readFileSync(join(root, "components/guest/guest-stay-access-card.tsx"), "utf8");
  const shellSource = readFileSync(join(root, "components/guest/guest-stay-shell.tsx"), "utf8");
  const shellTestSource = readFileSync(join(root, "components/guest/guest-stay-shell.test.ts"), "utf8");
  const elenaSource = readFileSync(join(root, "components/guest/guest-elena-text-card.tsx"), "utf8");
  const chatSource = readFileSync(join(root, "lib/guest-stay-chat.ts"), "utf8");
  const ttsSource = readFileSync(join(root, "lib/guest-stay-tts.ts"), "utf8");
  const stayRoute = readFileSync(join(root, "app/api/guest/stay/route.ts"), "utf8");
  const accessLib = readFileSync(join(root, "lib/guest-stay-access.ts"), "utf8");
  const accessRoute = readFileSync(join(root, "app/api/guest/stay-access/route.ts"), "utf8");
  const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");

  assert(GUEST_STAY_ACCESS_PATH === "/api/guest/stay-access", "access path");
  assert(GUEST_STAY_ACCESS_POLL_MS === 60_000, "poll interval is 60 seconds");
  assert(GUEST_STAY_ACCESS_MAX_FIELD_CHARS === 128, "field max is 128");
  assert(Object.keys(guestStayAccessRequestBody("sample")).join(",") === "token", "body is token only");
  assert(guestStayAccessRequestBody("sample").token === "sample", "body token value");

  const pending = parseGuestStayAccessSuccess(pendingPayload);
  assert(pending?.status === "pending", "pending parser accepts exact payload");
  const readyParsed = parseGuestStayAccessSuccess(readyPayload);
  assert(readyParsed?.status === "ready", "ready parser accepts exact payload");
  if (readyParsed?.status !== "ready") throw new Error("ready parser");
  assert(readyParsed.fields.wifiNetwork === readyFields.wifiNetwork, "ready maps wifi network");
  assert(readyParsed.fields.wifiPassword === readyFields.wifiPassword, "ready maps wifi password");
  assert(readyParsed.fields.doorCode === readyFields.doorCode, "ready maps door code");

  assert(parseGuestStayAccessSuccess({ ok: true, status: "pending", extra: true }) === null, "pending extra key rejected");
  assert(parseGuestStayAccessSuccess({ ok: true }) === null, "pending missing status rejected");
  assert(parseGuestStayAccessSuccess({ status: "pending" }) === null, "pending missing ok rejected");
  assert(parseGuestStayAccessSuccess({ ok: true, status: "ready" }) === null, "ready missing fields rejected");
  assert(parseGuestStayAccessSuccess({ ...readyPayload, extra: "x" }) === null, "ready extra key rejected");
  assert(parseGuestStayAccessSuccess({ ...readyPayload, wifiNetwork: 1 }) === null, "ready wrong type rejected");
  assert(
    parseGuestStayAccessSuccess({ ...readyPayload, wifiPassword: "x".repeat(129) }) === null,
    "overlength password rejected",
  );
  assert(
    parseGuestStayAccessSuccess({ ...readyPayload, doorCode: "x".repeat(129) }) === null,
    "overlength door rejected",
  );
  assert(
    parseGuestStayAccessSuccess({ ...readyPayload, wifiNetwork: "x".repeat(129) }) === null,
    "overlength network rejected",
  );
  assert(parseGuestStayAccessSuccess({ ...readyPayload, wifiNetwork: "x".repeat(128) })?.status === "ready", "128 chars accepted");
  assert(parseGuestStayAccessSuccess({ ok: true, status: "active", ...readyFields }) === null, "wrong status rejected");

  const classifiedPending = classifyGuestStayAccessResponse({
    httpStatus: 200,
    payload: pendingPayload,
    hadValid: false,
  });
  assert(classifiedPending.type === "pending", "200 pending classified");
  const classifiedReady = classifyGuestStayAccessResponse({
    httpStatus: 200,
    payload: readyPayload,
    hadValid: false,
  });
  assert(classifiedReady.type === "ready", "200 ready classified");

  function assertTerminalUnavailable(httpStatus: number, payload: unknown, message: string) {
    const outcome = classifyGuestStayAccessResponse({ httpStatus, payload, hadValid: true });
    assert(outcome.type === "terminal" && outcome.state === "unavailable", message);
  }

  assertTerminalUnavailable(200, null, "malformed 200 with hadValid is unavailable");
  assertTerminalUnavailable(200, { ...readyPayload, extra: true }, "extra-key 200 with hadValid is unavailable");
  assertTerminalUnavailable(200, { ok: true, status: "ready" }, "missing-key 200 with hadValid is unavailable");
  assertTerminalUnavailable(200, { ...readyPayload, wifiNetwork: 1 }, "wrong-type 200 with hadValid is unavailable");
  assertTerminalUnavailable(200, { ...readyPayload, wifiPassword: "x".repeat(129) }, "overlength 200 with hadValid is unavailable");
  assertTerminalUnavailable(204, pendingPayload, "malformed 2xx 204 with hadValid is unavailable");

  const unknown4xx = classifyGuestStayAccessResponse({
    httpStatus: 418,
    payload: { error: "unsupported" },
    hadValid: true,
  });
  assert(unknown4xx.type === "terminal" && unknown4xx.state === "unavailable", "non-allowlisted 4xx with hadValid is unavailable");
  assertTerminalUnavailable(400, [], "malformed 4xx body with hadValid is unavailable");
  assertTerminalUnavailable(404, { message: "nope" }, "non-allowlisted 4xx body with hadValid is unavailable");

  const invalid = classifyGuestStayAccessResponse({ httpStatus: 404, payload: { error: "invalid" }, hadValid: true });
  const expired = classifyGuestStayAccessResponse({ httpStatus: 410, payload: { error: "expired" }, hadValid: true });
  const revoked = classifyGuestStayAccessResponse({ httpStatus: 410, payload: { error: "revoked" }, hadValid: true });
  const unavailable409 = classifyGuestStayAccessResponse({
    httpStatus: 409,
    payload: { error: "unavailable" },
    hadValid: true,
  });
  assert(invalid.type === "terminal" && invalid.state === "invalid", "invalid remains terminal");
  assert(expired.type === "terminal" && expired.state === "expired", "expired remains terminal");
  assert(revoked.type === "terminal" && revoked.state === "revoked", "revoked remains terminal");
  assert(unavailable409.type === "terminal" && unavailable409.state === "unavailable", "409 unavailable remains terminal");
  assert(classifyGuestStayAccessResponse({ httpStatus: 429, payload: { error: "unavailable" }, hadValid: true }).type === "keep", "429 keeps last valid");
  assert(classifyGuestStayAccessResponse({ httpStatus: 500, payload: { error: "unavailable" }, hadValid: true }).type === "keep", "500 keeps last valid");
  assert(classifyGuestStayAccessResponse({ httpStatus: 503, payload: { error: "unavailable" }, hadValid: true }).type === "keep", "503 keeps last valid");
  assert(classifyGuestStayAccessResponse({ httpStatus: 503, payload: { error: "unavailable" }, hadValid: false }).type === "terminal", "first-load 503 is unavailable");
  assert(classifyGuestStayAccessFailure(true).type === "keep", "network after valid keeps UI");
  assert(classifyGuestStayAccessFailure(false).type === "terminal", "first-load network is unavailable");
  assert(guestStayAccessShouldKeepLastGood(429) && guestStayAccessShouldKeepLastGood(500), "keep-last helper");
  assert(!guestStayAccessShouldKeepLastGood(409) && !guestStayAccessShouldKeepLastGood(410), "explicit errors are not keep-last");

  const pendingUi = applyGuestStayAccessOutcome(
    { view: "loading", fields: null, showPassword: false, showDoor: false, hadValid: false },
    { type: "pending" },
  );
  assert(pendingUi.view === "pending" && pendingUi.fields === null, "pending clears fields");
  assert(!pendingUi.showPassword && !pendingUi.showDoor, "pending has no reveal");
  assert(guestStayAccessShouldPoll("pending") && guestStayAccessShouldPoll("ready"), "polls pending and ready");
  assert(!guestStayAccessShouldPoll("loading") && !guestStayAccessShouldPoll("invalid") && !guestStayAccessShouldPoll("expired"), "no poll on terminal");

  const appliedReady = applyGuestStayAccessOutcome(pendingUi, classifiedReady);
  assert(appliedReady.view === "ready" && appliedReady.fields?.wifiNetwork === readyFields.wifiNetwork, "ready stores fields");
  assert(!appliedReady.showPassword && !appliedReady.showDoor, "ready starts masked");

  const remasked = applyGuestStayAccessOutcome(readyUi(), {
    type: "ready",
    fields: { ...readyFields, wifiPassword: "other" },
  });
  assert(!remasked.showPassword && !remasked.showDoor, "changed ready values re-mask");
  assert(guestStayAccessReadyChanged(readyFields, { ...readyFields, doorCode: "9999" }), "door change detected");
  const sameReady = applyGuestStayAccessOutcome(readyUi(), { type: "ready", fields: { ...readyFields } });
  assert(sameReady.showPassword && sameReady.showDoor, "unchanged ready keeps reveal");

  const cleared = applyGuestStayAccessOutcome(readyUi(), { type: "terminal", state: "expired" });
  assert(cleared.fields === null && !cleared.showPassword && !cleared.showDoor, "terminal clears secrets and reveal");
  assert(cleared.view === "expired" && !cleared.hadValid, "expired is terminal");
  const malformedClear = applyGuestStayAccessOutcome(
    readyUi(),
    classifyGuestStayAccessResponse({
      httpStatus: 200,
      payload: { ...readyPayload, extra: true },
      hadValid: true,
    }),
  );
  assert(malformedClear.view === "unavailable", "malformed success applies unavailable");
  assert(malformedClear.fields === null, "malformed success clears all access fields");
  assert(!malformedClear.showPassword && !malformedClear.showDoor, "malformed success resets both reveal states");
  assert(!malformedClear.hadValid, "malformed success is not kept as valid");
  const kept = applyGuestStayAccessOutcome(readyUi(), { type: "keep" });
  assert(kept.fields?.wifiPassword === readyFields.wifiPassword && kept.showPassword, "transient failure keeps last valid UI");

  assert(guestStayAccessVisibleRows(readyFields).join(",") === "wifiNetwork,wifiPassword,doorCode", "all rows visible when filled");
  assert(guestStayAccessVisibleRows({ wifiNetwork: "", wifiPassword: "x", doorCode: "" }).join(",") === "wifiPassword", "empty rows omitted");
  assert(guestStayAccessAllEmpty({ wifiNetwork: "", wifiPassword: "", doorCode: "" }), "all-empty detected");
  assert(!guestStayAccessAllEmpty(readyFields), "filled is not empty");

  assert(GUEST_STAY_ACCESS_COPY.pendingEn === "Available at check-in.", "pending English");
  assert(GUEST_STAY_ACCESS_COPY.pendingEs === "Disponible a partir de la entrada.", "pending Spanish");
  assert(GUEST_STAY_ACCESS_COPY.titleEn === "Access" && GUEST_STAY_ACCESS_COPY.titleEs === "Acceso", "card title");
  assert(GUEST_STAY_ACCESS_COPY.wifiNetworkEn === "Wi-Fi network" && GUEST_STAY_ACCESS_COPY.wifiNetworkEs === "Red Wi-Fi", "wifi network labels");
  assert(GUEST_STAY_ACCESS_COPY.wifiPasswordEn === "Wi-Fi password" && GUEST_STAY_ACCESS_COPY.wifiPasswordEs === "Contraseña Wi-Fi", "wifi password labels");
  assert(GUEST_STAY_ACCESS_COPY.doorEn === "Door code" && GUEST_STAY_ACCESS_COPY.doorEs === "Código de puerta", "door labels");
  assert(GUEST_STAY_ACCESS_COPY.showEn === "Show" && GUEST_STAY_ACCESS_COPY.showEs === "Mostrar", "show labels");
  assert(GUEST_STAY_ACCESS_COPY.hideEn === "Hide" && GUEST_STAY_ACCESS_COPY.hideEs === "Ocultar", "hide labels");
  assert(GUEST_STAY_ACCESS_COPY.copyEn === "Copy" && GUEST_STAY_ACCESS_COPY.copyEs === "Copiar", "copy labels");
  assert(GUEST_STAY_ACCESS_COPY.copiedEn === "Copied." && GUEST_STAY_ACCESS_COPY.copiedEs === "Copiado.", "copied notice");
  assert(GUEST_STAY_ACCESS_COPY.copyFailEn === "Unable to copy." && GUEST_STAY_ACCESS_COPY.copyFailEs === "No se pudo copiar.", "copy fail notice");
  assert(GUEST_STAY_ACCESS_COPY.emptyEn === "Access details are not available yet.", "empty English");
  assert(GUEST_STAY_ACCESS_COPY.emptyEs === "Los datos de acceso todavía no están disponibles.", "empty Spanish");
  assert(guestStayAccessSafeMessage("invalid")?.en === "Access link is invalid.", "invalid English");
  assert(guestStayAccessSafeMessage("invalid")?.es === "El enlace de acceso no es válido.", "invalid Spanish");
  assert(guestStayAccessSafeMessage("revoked")?.en === "This guest link was replaced. Ask your host for a new link.", "revoked English");
  assert(guestStayAccessSafeMessage("revoked")?.es === "Este enlace fue reemplazado. Pídele un enlace nuevo a tu anfitrión.", "revoked Spanish");
  assert(guestStayAccessSafeMessage("expired")?.en === "Access for this stay has expired.", "expired English");
  assert(guestStayAccessSafeMessage("expired")?.es === "El acceso para esta estadía ha vencido.", "expired Spanish");
  assert(guestStayAccessSafeMessage("unavailable")?.en === "Access details are temporarily unavailable.", "unavailable English");
  assert(guestStayAccessSafeMessage("unavailable")?.es === "Los datos de acceso no están disponibles temporalmente.", "unavailable Spanish");

  assert(cardSource.includes("if (input.httpStatus === 200)"), "only HTTP 200 may apply pending/ready");
  assert(cardSource.includes("if (input.httpStatus >= 200 && input.httpStatus < 300)"), "malformed 2xx is terminal unavailable");
  assert(cardSource.includes('method: "POST"'), "POST method");
  assert(cardSource.includes("GUEST_STAY_ACCESS_PATH"), "posts to stay-access");
  assert(cardSource.includes("JSON.stringify(guestStayAccessRequestBody(token))"), "token is JSON body only");
  assert(cardSource.includes('cache: "no-store"'), "cache no-store");
  assert(cardSource.includes('referrerPolicy: "no-referrer"'), "referrerPolicy no-referrer");
  assert(cardSource.includes('referrer: "no-referrer"'), "referrer no-referrer");
  assert(cardSource.includes("AbortController"), "AbortController used");
  assert(cardSource.includes("accessGen"), "generation counter");
  assert(cardSource.includes("accessAbort"), "dedicated abort ref");
  assert(cardSource.includes("accessInFlight"), "in-flight guard");
  assert(cardSource.includes("if (accessInFlight.current) return"), "no overlapping requests");
  assert(cardSource.includes("window.setInterval"), "interval polling");
  assert(cardSource.includes("GUEST_STAY_ACCESS_POLL_MS"), "60s poll constant");
  assert(cardSource.includes("document.hidden"), "skips hidden polls");
  assert(cardSource.includes('document.addEventListener("visibilitychange"'), "visibility listener");
  assert(cardSource.includes('document.removeEventListener("visibilitychange"'), "visibility cleanup");
  assert(cardSource.includes("window.clearInterval(timer)"), "clears interval");
  assert(cardSource.includes("controller.abort()") || cardSource.includes("accessAbort.current?.abort()"), "aborts on cleanup");
  assert(cardSource.includes("generation !== accessGen.current"), "ignores stale responses");
  assert(cardSource.includes('type="button"'), "buttons are type button");
  assert(cardSource.includes("min-h-11"), "44px min target");
  assert(cardSource.includes("focus-visible:ring-2"), "focus styles");
  assert(cardSource.includes('aria-live="polite"'), "polite live region");
  assert(cardSource.includes("aria-pressed={showPassword}"), "password reveal aria-pressed");
  assert(cardSource.includes("aria-pressed={showDoor}"), "door reveal aria-pressed");
  assert(cardSource.includes("GUEST_STAY_ACCESS_SECRET_MASK"), "secrets masked by default");
  assert(cardSource.includes('id="guest-stay-access"'), "Access section has focus target id");
  assert(cardSource.includes("tabIndex={-1}"), "Access section is focusable for quick-action scroll");
  assert(cardSource.includes("{fields.wifiNetwork}"), "wifi network visible");
  assert(!cardSource.includes('type="password"'), "no password inputs");
  assert(!cardSource.includes("window.alert"), "no window.alert");
  assert(cardSource.includes('setNotice("copied")') && cardSource.includes('setNotice("copy-fail")'), "clipboard notices");
  assert(!cardSource.includes("setNotice(value)") && !cardSource.includes("alert("), "copied value is not placed in notices");
  assert(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(cardSource), "no browser storage");
  assert(!/console\.(log|info|debug|error|warn)/.test(cardSource), "no console logging");
  assert(!cardSource.includes("searchParams") && !cardSource.includes("URLSearchParams"), "no query string token");
  assert(!cardSource.includes("role=\"dialog\"") && !cardSource.includes("showModal"), "no modal");
  assert(!/qrcode|QRCode|window\.print|speechSynthesis|speechSynthesis/.test(cardSource), "no QR print speech");
  assert(!cardSource.includes("GuestElenaTextCard"), "does not import Elena");
  assert(!cardSource.includes("guest-stay-chat") && !cardSource.includes("guest-stay-tts"), "does not import chat/TTS");
  assert(!cardSource.includes("guest-stay-access.ts") && !cardSource.includes("@/lib/guest-stay-access"), "does not import server access module");
  assert(!elenaSource.includes("guest-stay-access-card") && !elenaSource.includes("wifiPassword") && !elenaSource.includes("doorCode"), "Elena has no access card or secrets");
  assert(!chatSource.includes("guest-stay-access") && !ttsSource.includes("guest-stay-access"), "chat/TTS have no access module");
  assert(!elenaSource.includes("GUEST_STAY_ACCESS"), "Elena has no access constants");

  assert(shellSource.includes("<GuestStayAccessCard key={token} token={token} />"), "shell mounts access card with token only");
  const wrapStart = shellSource.indexOf("<GuestStayElenaBoundary>");
  const wrapClose = "</GuestStayElenaBoundary>";
  const wrapEnd = shellSource.indexOf(wrapClose) + wrapClose.length;
  const wrap = shellSource.slice(wrapStart, wrapEnd);
  const beforeWrap = shellSource.slice(0, wrapStart);
  assert(beforeWrap.includes("<GuestStayAccessCard key={token} token={token} />"), "access card is before Elena");
  assert(!wrap.includes("GuestStayAccessCard"), "access card is outside Elena boundary");
  assert(wrap.includes("<GuestElenaTextCard token={token} />"), "Elena still receives only token");
  assert(!wrap.includes("wifiNetwork") && !wrap.includes("wifiPassword") && !wrap.includes("doorCode"), "Elena props have no access fields");
  assert(!shellSource.includes("wifiNetwork=") && !shellSource.includes("wifiPassword=") && !shellSource.includes("doorCode="), "shell does not pass access fields");
  const inactive = shellSource.slice(shellSource.indexOf("{GUEST_STAY_GENERIC_HEADING}"));
  assert(!inactive.includes("GuestStayAccessCard"), "access card is not in the inactive branch");
  assert(shellSource.includes('JSON.stringify({ token })'), "main stay POST body unchanged");
  assert(shellSource.includes('publicApiUrl("/api/guest/stay")'), "main stay path unchanged");
  assert(!stayRoute.includes("wifiNetwork"), "stay API route not widened");
  assert(accessLib.includes("GUEST_STAY_ACCESS_PROPERTY_COLUMNS"), "backend access lib unchanged presence");
  assert(accessRoute.includes("handleGuestStayAccess"), "stay-access route unchanged presence");
  assert(!packageJson.includes("guest-stay-access-card"), "package.json unchanged by this UI");
  assert(!cardSource.includes("host-nav") && !cardSource.includes("useRouter"), "no navigation surface");
  assert(GUEST_STAY_ACCESS_SECRET_MASK === "••••••••", "fixed mask does not echo secret length");

  const noticeBlock = cardSource.slice(cardSource.indexOf("aria-live="));
  assert(!noticeBlock.includes("fields.wifiPassword") && !noticeBlock.includes("fields.doorCode"), "live region does not echo secrets");
  assert(shellTestSource.includes("runGuestStayShellTests"), "shell tests remain");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-access-card.test");
if (isDirectRun) {
  try {
    runGuestStayAccessCardTests();
    console.log("guest-stay-access-card tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "guest-stay-access-card tests failed");
    process.exitCode = 1;
  }
}
