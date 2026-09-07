import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fallbackRuntimeOriginFromRequest } from "../app/api/runtime-origin/route";
import type { Reservation } from "./dashboard-data";
import {
  GUEST_STAY_PATH_PREFIX,
  GUEST_STAY_SHELL_COPY,
  HOST_QR_COPY,
  LEGACY_GUEST_LINK_COPY,
  LIVE_RESERVATION_STAY_COLUMNS,
  buildSecureGuestUrl,
  canStartGuestShare,
  canStartStayLinkGenerate,
  eligibleHostQrStays,
  executeHostGuestShare,
  guestShellLooksPrivate,
  hostGuestSharePayload,
  hostQrStayPayloadHasForbiddenFields,
  hostQrStaysPayload,
  hostStayLinksGetGate,
  hostQrVisibleCopy,
  isShareAbortError,
  mapLiveReservationToHostQrStay,
  parseHostQrStaysResponse,
  selectableStayReservations,
  shouldConfirmStayLinkReplace,
  stayLinkRequestBody,
  stayLinksEligiblePath,
  visibleCopyLooksPrivate,
} from "./guest-stay-qr";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const reservations: Reservation[] = [
  {
    id: "res-current",
    propertyId: "prop-a",
    guest: "Hidden Guest",
    phone: "+1 555 0100",
    platform: "Airbnb",
    checkIn: "2026-09-10",
    checkOut: "2026-09-14",
    checkInTime: "3:00 PM",
    checkOutTime: "11:00 AM",
    accessCode: "9999#",
    aiNotes: "",
    nights: 4,
    status: "upcoming",
  },
  {
    id: "res-old",
    propertyId: "prop-a",
    guest: "Past Guest",
    phone: "+1 555 0101",
    platform: "Airbnb",
    checkIn: "2026-08-01",
    checkOut: "2026-08-04",
    checkInTime: "3:00 PM",
    checkOutTime: "11:00 AM",
    accessCode: "1111#",
    aiNotes: "",
    nights: 3,
    status: "departed",
  },
  {
    id: "res-other",
    propertyId: "prop-b",
    guest: "Other",
    phone: "+1 555 0102",
    platform: "Airbnb",
    checkIn: "2026-09-10",
    checkOut: "2026-09-12",
    checkInTime: "3:00 PM",
    checkOutTime: "11:00 AM",
    accessCode: "2222#",
    aiNotes: "",
    nights: 2,
    status: "upcoming",
  },
];

export async function runGuestStayQrTests() {
  const today = "2026-09-11";
  const selectable = selectableStayReservations(reservations, "prop-a", today);
  assert(selectable.length === 1 && selectable[0]?.id === "res-current", "reservation selection required");
  assert(!selectable.some((row) => row.status === "departed"), "departed stays excluded");

  const liveToday = "2026-09-01";
  const liveRows = [
    {
      id: "qr-test-stay-20260901",
      property_id: "prop-a",
      check_in: "2026-09-01",
      check_out: "2026-09-03",
      status: "upcoming",
      guest_name: "omit-me",
      payout: 0,
      notes: "omit-me",
    },
    {
      id: "res-other-property",
      property_id: "prop-b",
      check_in: "2026-09-01",
      check_out: "2026-09-03",
      status: "upcoming",
    },
    {
      id: "res-departed",
      property_id: "prop-a",
      check_in: "2026-08-01",
      check_out: "2026-08-04",
      status: "departed",
    },
    {
      id: "res-canceled",
      property_id: "prop-a",
      check_in: "2026-09-01",
      check_out: "2026-09-10",
      status: "canceled",
    },
    {
      id: "res-expired",
      property_id: "prop-a",
      check_in: "2026-08-20",
      check_out: "2026-08-31",
      status: "upcoming",
    },
  ];
  const mapped = mapLiveReservationToHostQrStay(liveRows[0], "prop-a", liveToday);
  assert(mapped?.id === "qr-test-stay-20260901", "live-column row maps");
  assert(mapped?.checkIn === "2026-09-01" && mapped.checkOut === "2026-09-03" && mapped.status === "upcoming", "mapped dates and status");
  const mappedJson = JSON.stringify(mapped);
  assert(!mappedJson.includes("guest_name") && !mappedJson.includes("payout") && !mappedJson.includes("notes") && !mappedJson.includes("omit-me"), "mapped stay omits forbidden fields");
  const eligible = eligibleHostQrStays(liveRows, "prop-a", liveToday);
  assert(eligible.length === 1 && eligible[0]?.id === "qr-test-stay-20260901", "synthetic upcoming stay included for matching property");
  assert(eligibleHostQrStays(liveRows, "prop-b", liveToday).every((row) => row.id !== "qr-test-stay-20260901"), "property mismatch excluded");
  assert(!eligible.some((row) => row.id === "res-departed" || row.id === "res-canceled" || row.id === "res-expired"), "departed/canceled/expired excluded");
  const payload = hostQrStaysPayload(eligible);
  assert(Object.keys(payload).join() === "stays", "payload root is stays");
  assert(Object.keys(payload.stays[0] ?? {}).sort().join() === "checkIn,checkOut,id,status", "GET stay keys only");
  assert(!hostQrStayPayloadHasForbiddenFields(payload), "payload has no forbidden fields");
  assert(hostStayLinksGetGate(null)?.status === 401, "GET returns 401 without host authentication");
  assert(hostStayLinksGetGate("host-1") === null, "authenticated host passes GET gate");
  const parsed = parseHostQrStaysResponse(payload);
  assert(parsed?.length === 1 && parsed[0]?.id === "qr-test-stay-20260901", "client parser accepts allowlisted stays");
  assert(LIVE_RESERVATION_STAY_COLUMNS === "id, property_id, check_in, check_out, status", "live field mask");
  assert(stayLinksEligiblePath("prop-a") === "/api/guest/stay-links?propertyId=prop-a", "eligible GET path");

  assert(!canStartStayLinkGenerate(false, null) && !canStartStayLinkGenerate(false, ""), "generate requires reservation");
  assert(!canStartStayLinkGenerate(true, "res-current"), "duplicate generation blocked while busy");
  assert(canStartStayLinkGenerate(false, "res-current"), "generate allowed when idle");
  assert(shouldConfirmStayLinkReplace(true) && !shouldConfirmStayLinkReplace(false), "replacement confirmation");

  const body = stayLinkRequestBody("res-current");
  assert(Object.keys(body).join() === "reservationId" && body.reservationId === "res-current", "request body is reservationId only");

  const url = buildSecureGuestUrl("https://example.trycloudflare.com", `${GUEST_STAY_PATH_PREFIX}abc`);
  assert(url === "https://example.trycloudflare.com/guest/s/abc", "generated URL uses /guest/s/");
  assert(buildSecureGuestUrl("https://x", "/guest/prop-1") === "", "property URL is not encoded");
  const loopbackGuest = buildSecureGuestUrl("http://localhost:3000", `${GUEST_STAY_PATH_PREFIX}abc`);
  assert(loopbackGuest.startsWith("http://localhost:3000/guest/s/"), "localhost dashboard QR keeps the loopback origin");
  assert(!/^http:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(loopbackGuest), "loopback QR is not rewritten to private LAN HTTP");

  const firstShareUrl = buildSecureGuestUrl("https://example.trycloudflare.com", `${GUEST_STAY_PATH_PREFIX}first`);
  const nextShareUrl = buildSecureGuestUrl("https://example.trycloudflare.com", `${GUEST_STAY_PATH_PREFIX}next`);
  assert(firstShareUrl !== nextShareUrl, "regenerated path produces a different derived URL");
  assert(!canStartGuestShare("", false), "no URL means share is unavailable");
  assert(canStartGuestShare(nextShareUrl, false) && !canStartGuestShare(nextShareUrl, true), "share is blocked while an attempt is active");
  const emptyShareCalls: string[] = [];
  const emptyCopyCalls: string[] = [];
  const emptyOutcome = await executeHostGuestShare("", false, {
    share: async (data) => {
      emptyShareCalls.push(data.url);
    },
    copy: () => {
      emptyCopyCalls.push("copy");
    },
  });
  assert(emptyOutcome === "ignored" && emptyShareCalls.length === 0 && emptyCopyCalls.length === 0, "no URL means no share call");

  const sharePayload = hostGuestSharePayload(nextShareUrl);
  assert(sharePayload.url === nextShareUrl, "native share receives exactly the current guestUrl");
  assert(Object.keys(sharePayload).sort().join() === "text,title,url", "share payload is title, text, and url only");
  assert(sharePayload.title === HOST_QR_COPY.shareTitle && sharePayload.text === HOST_QR_COPY.shareText, "share title and text are generic bilingual copy");
  assert(!/@|\b555\b|wifi|door code|access code|check-in|checkIn|phone|email/i.test(`${sharePayload.title} ${sharePayload.text}`), "share copy has no guest contact or stay secrets");
  assert(hostGuestSharePayload(firstShareUrl).url === firstShareUrl, "share target follows the currently derived URL");
  assert(hostGuestSharePayload(nextShareUrl).url === nextShareUrl, "regenerated QR uses only the new URL");

  let nativeShareCount = 0;
  let seenShareUrl = "";
  const nativeOutcome = await executeHostGuestShare(nextShareUrl, false, {
    share: async (data) => {
      nativeShareCount += 1;
      seenShareUrl = data.url;
    },
    copy: () => {
      throw new Error("copy must not run on native share");
    },
  });
  assert(nativeOutcome === "shared" && nativeShareCount === 1 && seenShareUrl === nextShareUrl, "native share is called once with the current URL");

  let fallbackCopyCount = 0;
  const fallbackOutcome = await executeHostGuestShare(nextShareUrl, false, {
    copy: () => {
      fallbackCopyCount += 1;
    },
  });
  assert(fallbackOutcome === "copied" && fallbackCopyCount === 1, "unsupported share uses existing Copy fallback once");

  let abortCopyCount = 0;
  let abortShareCount = 0;
  const abortOutcome = await executeHostGuestShare(nextShareUrl, false, {
    share: async () => {
      abortShareCount += 1;
      const error = new Error("Share canceled");
      error.name = "AbortError";
      throw error;
    },
    copy: () => {
      abortCopyCount += 1;
    },
  });
  assert(isShareAbortError({ name: "AbortError" }), "AbortError is recognized");
  assert(abortOutcome === "cancelled" && abortShareCount === 1 && abortCopyCount === 0, "AbortError does not copy and does not show an error");

  let genericCopyCount = 0;
  const genericOutcome = await executeHostGuestShare(nextShareUrl, false, {
    share: async () => {
      throw new Error("share failed");
    },
    copy: () => {
      genericCopyCount += 1;
    },
  });
  assert(genericOutcome === "copied" && genericCopyCount === 1, "generic share failures fall back to Copy once");

  let busyShareCount = 0;
  const busyOutcome = await executeHostGuestShare(nextShareUrl, true, {
    share: async () => {
      busyShareCount += 1;
    },
    copy: () => {
      busyShareCount += 1;
    },
  });
  assert(busyOutcome === "ignored" && busyShareCount === 0, "duplicate clicks while sharing are ignored");

  assert(HOST_QR_COPY.sendToGuest.includes("Send to guest") && HOST_QR_COPY.sendToGuest.includes("Enviar al huésped"), "bilingual send button copy");
  assert(
    HOST_QR_COPY.copiedShareFallback.includes("WhatsApp") &&
      HOST_QR_COPY.copiedShareFallback.includes("Messages") &&
      HOST_QR_COPY.copiedShareFallback.includes("Enlace copiado"),
    "fallback confirms paste into WhatsApp, Messages, or email",
  );
  assert(!/wa\.me|sms:|mailto:/i.test(`${HOST_QR_COPY.sendToGuest}${HOST_QR_COPY.shareTitle}${HOST_QR_COPY.shareText}${HOST_QR_COPY.copiedShareFallback}`), "share copy has no WhatsApp/sms/mailto URLs");

  const loopbackFallback = fallbackRuntimeOriginFromRequest({ protocol: "http", hostname: "localhost", port: "3000" });
  assert(loopbackFallback.hostname === "localhost", "loopback request without env/tunnel remains loopback");
  assert(!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(loopbackFallback.hostname), "loopback is not replaced with a private LAN address");
  const ipv4Loopback = fallbackRuntimeOriginFromRequest({ protocol: "http", hostname: "127.0.0.1", port: "3000" });
  assert(ipv4Loopback.hostname === "127.0.0.1", "127.0.0.1 stays 127.0.0.1");
  const ipv6Loopback = fallbackRuntimeOriginFromRequest({ protocol: "http", hostname: "::1", port: "3000" });
  assert(ipv6Loopback.hostname === "::1", "::1 stays ::1");
  const otherHost = fallbackRuntimeOriginFromRequest({ protocol: "https", hostname: "guest.example", port: "443" });
  assert(otherHost.hostname === "guest.example" && otherHost.origin.startsWith("https://guest.example"), "non-loopback request preserves its request origin");

  const printCopy = hostQrVisibleCopy({
    propertyName: "Bayview Loft",
    city: "Miami Beach",
    checkIn: "2026-09-10",
    checkOut: "2026-09-14",
    guestUrl: "https://example.com/guest/s/opaque",
  });
  assert(printCopy.includes("Bayview Loft") && printCopy.includes("Miami Beach"), "print shows name and city");
  assert(printCopy.includes(HOST_QR_COPY.scan) && printCopy.includes(HOST_QR_COPY.expires), "scan and expiry copy");
  assert(!visibleCopyLooksPrivate(printCopy), "QR/print copy has no forbidden fields");
  assert(!/wifi|password|door|gate|handbook|555|Hidden Guest/i.test(printCopy), "print omits access, wifi, guest identity");

  const shell = [
    GUEST_STAY_SHELL_COPY.en.activeHint,
    GUEST_STAY_SHELL_COPY.es.activeHint,
    GUEST_STAY_SHELL_COPY.en.invalid,
    GUEST_STAY_SHELL_COPY.en.expired,
    GUEST_STAY_SHELL_COPY.en.revoked,
    GUEST_STAY_SHELL_COPY.en.unavailable,
    GUEST_STAY_SHELL_COPY.en.emergency,
    "Bayview Loft",
    "Miami Beach",
    "2026-09-10",
    "2026-09-14",
    "active",
  ].join(" ");
  assert(!guestShellLooksPrivate(shell), "safe shell has no address, wifi, codes, handbook, phone, or guest data");
  assert(!/\btoken\b/i.test(shell), "safe stay copy has no token label");

  assert(LEGACY_GUEST_LINK_COPY.en.includes("no longer valid"), "legacy English");
  assert(LEGACY_GUEST_LINK_COPY.es.toLowerCase().includes("válido") || LEGACY_GUEST_LINK_COPY.es.includes("valido"), "legacy Spanish");
  const legacyBlob = `${LEGACY_GUEST_LINK_COPY.en} ${LEGACY_GUEST_LINK_COPY.es}`;
  assert(!guestShellLooksPrivate(legacyBlob), "legacy route exposes no property data");

  const root = join(process.cwd(), "src");
  const qrSource = readFileSync(join(root, "components/dashboard/guest-qr-card.tsx"), "utf8");
  assert(!qrSource.includes('type="url"'), "no editable property URL");
  assert(qrSource.includes("HOST_QR_COPY.generate"), "generate button");
  assert(qrSource.includes("HOST_QR_COPY.sendToGuest"), "send-to-guest button");
  assert(qrSource.includes("executeHostGuestShare"), "share uses the shared host helper");
  assert(qrSource.includes("canStartGuestShare"), "share is gated on a valid URL");
  assert(qrSource.includes("navigator.share"), "native share is used when supported");
  assert(qrSource.includes("AbortError") || qrSource.includes("isShareAbortError") || qrSource.includes("executeHostGuestShare"), "AbortError is handled by the share helper");
  assert(qrSource.includes("setPath(\"\")"), "property or reservation change clears the path");
  assert(qrSource.includes("setShareHint(\"\")"), "property or reservation change clears share confirmation");
  assert(qrSource.includes("min-h-11"), "send button meets the 44px touch target");
  assert(!/wa\.me|sms:|mailto:/i.test(qrSource), "QR card has no WhatsApp/sms/mailto URLs");
  assert(!/contacts|guestPhone|guestEmail|assignedPhoneNumber/.test(qrSource), "QR card does not access guest contacts");
  assert(!/sessionStorage|document\.cookie|data-guest-url|data-url=/.test(qrSource), "guest URL is not persisted or placed on data attributes");
  assert(!/console\.(log|info|debug|error|warn)\(.*guestUrl/.test(qrSource), "guest URL is not logged");
  assert(!qrSource.includes("localStorage"), "raw token is not stored in localStorage");
  assert(!qrSource.includes("reservations"), "public client store is not the QR reservation source");
  assert(qrSource.includes("stayLinksEligiblePath"), "QR card fetches protected stay-links GET");
  assert(qrSource.includes("AbortController"), "stale property fetches are aborted");
  assert(!/wifiPassword|doorCode|gateCode|assignedPhoneNumber|handbook|guest_name/.test(qrSource), "QR card source omits private listing fields");

  const voiceSource = readFileSync(join(root, "components/dashboard/voice-concierge-view.tsx"), "utf8");
  assert(!/GuestQrCard[^>]*reservations/.test(voiceSource), "Voice view does not pass listings reservations to QR");

  const stayLinksRoute = readFileSync(join(root, "app/api/guest/stay-links/route.ts"), "utf8");
  assert(stayLinksRoute.includes("export async function GET"), "stay-links GET exists");
  const getHandler = stayLinksRoute.slice(stayLinksRoute.indexOf("export async function GET"));
  const postHandler = stayLinksRoute.slice(stayLinksRoute.indexOf("export async function POST"));
  assert(getHandler.includes("logStayLinksGetFailure"), "GET logs sanitized failures");
  assert(!postHandler.includes("logStayLinksGetFailure"), "POST behavior is unchanged");
  assert(getHandler.includes("requireHostAuthContext"), "GET is host-authenticated");
  assert(postHandler.includes("requireHostAuthContext"), "POST uses host auth context");
  assert(postHandler.includes("hostAuthSource"), "POST passes auth provenance into token issue");
  assert(postHandler.includes("auth.user?.id"), "POST rate-limit and issue still use original user id");
  assert(getHandler.includes("listEligibleQrStaysForProperty"), "GET loads eligible stays server-side");
  assert(getHandler.includes("listOwnedPropertyIds"), "GET uses proven owned property ids");
  assert(!stayLinksRoute.includes("fetchListings"), "stay-links does not treat all listings as owned");
  assert(postHandler.includes("stayLinksPostOwnershipGate"), "POST checks reservation ownership");
  assert(
    postHandler.indexOf("stayLinksPostOwnershipGate") < postHandler.indexOf("issueGuestStayLink"),
    "POST ownership gate runs before token issue",
  );
  assert(getHandler.includes("ownership-unavailable") && postHandler.includes("ownership-unowned"), "ownership log branches are used");
  assert(!/guest_name|payout|\bnotes\b/.test(stayLinksRoute), "stay-links route does not select forbidden reservation fields");

  const tokenSource = readFileSync(join(root, "lib/guest-stay-token.ts"), "utf8");
  assert(tokenSource.includes("LIVE_RESERVATION_STAY_COLUMNS"), "token lookup uses live column mask");
  assert(!tokenSource.includes("check_in_time, check_out_time"), "token reservation select omits reservation time columns");

  const shellSource = readFileSync(join(root, "components/guest/guest-stay-shell.tsx"), "utf8");
  const elenaCardSource = readFileSync(join(root, "components/guest/guest-elena-text-card.tsx"), "utf8");
  const elenaBoundarySource = readFileSync(join(root, "components/guest/guest-stay-elena-boundary.tsx"), "utf8");
  const servicesUiSource = readFileSync(join(root, "components/guest/guest-stay-services.tsx"), "utf8");
  const servicesLibSource = readFileSync(join(root, "lib/guest-stay-services.ts"), "utf8");
  const chatLibSource = readFileSync(join(root, "lib/guest-stay-chat.ts"), "utf8");
  const chatRouteSource = readFileSync(join(root, "app/api/guest/stay-chat/route.ts"), "utf8");
  const ttsLibSource = readFileSync(join(root, "lib/guest-stay-tts.ts"), "utf8");
  const ttsRouteSource = readFileSync(join(root, "app/api/guest/stay-tts/route.ts"), "utf8");
  const speechSource = readFileSync(join(root, "lib/guest-stay-speech.ts"), "utf8");
  const listenSource = readFileSync(join(root, "lib/guest-stay-listen.ts"), "utf8");
  const phase2a = `${shellSource}\n${elenaCardSource}\n${elenaBoundarySource}\n${servicesUiSource}\n${servicesLibSource}\n${chatLibSource}\n${chatRouteSource}\n${speechSource}\n${listenSource}`;
  const stayTts = `${ttsLibSource}\n${ttsRouteSource}`;
  assert(shellSource.includes("/api/guest/stay"), "validates through stay API");
  assert(shellSource.includes("interpretGuestStayShellPayload"), "active stay uses a typed response guard");
  assert(!shellSource.includes("!payload.propertyName"), "empty propertyName is not treated as invalid");
  const welcomeLibSource = readFileSync(join(root, "lib/guest-stay-welcome.ts"), "utf8");
  const welcomeRouteSource = readFileSync(join(root, "app/api/guest/stay-welcome-tts/route.ts"), "utf8");
  assert(welcomeRouteSource.includes("handleGuestStayWelcomeTts"), "welcome TTS route uses the secure helper");
  assert(welcomeLibSource.includes("parseGuestStayWelcomeBody"), "welcome TTS uses token+lang only");
  assert(welcomeLibSource.includes("validateGuestStayToken"), "welcome TTS uses the same stay token");
  assert(welcomeLibSource.includes("guestStayMpegLooksValid"), "welcome TTS validates MPEG");
  assert(welcomeLibSource.includes("GUEST_STAY_WELCOME_TTS_TIMEOUT_MS = 8_000"), "welcome TTS timeout is 8 seconds");
  assert(!welcomeLibSource.includes("handleGuestStayChat"), "welcome TTS does not call stay-chat");
  assert(!/console\.(log|info|debug|error|warn)/.test(`${welcomeLibSource}\n${welcomeRouteSource}`), "welcome TTS does not log");
  assert(elenaCardSource.includes("GUEST_STAY_WELCOME_COPY.hearEn"), "active Elena card shows Hear welcome");
  assert(elenaCardSource.includes("guestStayWelcomeRequestBody(token, lang)"), "welcome token stays in POST JSON");
  assert(shellSource.includes("GuestElenaTextCard token={token}"), "safe Elena chat is mounted after active");
  assert(shellSource.includes("guestStayShowsConciergeExtras(state, stay)"), "Elena is gated on an active stay");
  const inactiveShell = shellSource.slice(shellSource.indexOf(") : ("));
  assert(!inactiveShell.includes("Hear welcome"), "inactive/invalid/expired/revoked shell has no welcome button");
  assert(!inactiveShell.includes("GuestElenaTextCard"), "inactive shell does not mount Elena");
  assert(shellSource.includes("<GuestStayElenaBoundary>"), "Elena is isolated by a stay-safe boundary");
  assert(!shellSource.includes("GuestSafeBoundary"), "legacy GuestSafeBoundary is not used on the stay shell");
  assert(!elenaBoundarySource.includes("GuestSafeBoundary"), "stay Elena boundary does not reuse the host-style boundary");
  assert(!/useListings|ListingsProvider|chargeback|dashboard-data/.test(elenaBoundarySource), "Elena boundary has no host/private imports");
  assert(elenaBoundarySource.includes("Isabela is temporarily unavailable. You can still use the services below."), "Isabela fallback English");
  assert(elenaBoundarySource.includes("Isabela no está disponible temporalmente. Todavía puedes usar los servicios de abajo."), "Isabela fallback Spanish");
  const elenaWrap = shellSource.slice(
    shellSource.indexOf("<GuestStayElenaBoundary>"),
    shellSource.indexOf("</GuestStayElenaBoundary>") + "</GuestStayElenaBoundary>".length,
  );
  assert(elenaWrap.includes("GuestElenaTextCard"), "boundary wraps Elena only");
  assert(!elenaWrap.includes("GuestStayServices") && !elenaWrap.includes("tel:911"), "services and 911 are outside the Elena boundary");
  assert(shellSource.includes("GuestStayServices"), "service registry is mounted after active");
  assert(elenaCardSource.includes("Isabela · Receptionist"), "safe Isabela English label allowed");
  assert(elenaCardSource.includes("Isabela · Recepcionista"), "safe Isabela Spanish label allowed");
  assert(servicesLibSource.includes("maps-local-guide"), "local guide category text is allowed in the registry");
  assert(elenaCardSource.includes("/api/guest/stay-chat"), "Elena text chat uses stay-chat");
  assert(elenaCardSource.includes("GUEST_STAY_AUDIO_PATH") || elenaCardSource.includes("/api/guest/stay-tts"), "Elena card requests stay-tts after chat");
  assert(elenaCardSource.includes("guestStayChatRequestBody(token, message, listenLangRef.current)"), "stay-tts uses the same token+message+preferredLang body helper");
  assert(chatRouteSource.includes("handleGuestStayChat"), "stay-chat validates through the secure policy helper");
  assert(!chatRouteSource.includes("handleGuestStayTts"), "stay-chat route is unchanged");
  assert(chatLibSource.includes("guestStayChatSuccessBody"), "stay-chat success helper remains");
  assert(ttsRouteSource.includes("handleGuestStayTts"), "stay TTS route uses the secure helper");
  assert(ttsLibSource.includes("parseGuestStayChatBody"), "stay TTS uses the stay-chat body contract");
  assert(ttsLibSource.includes("guestStayMpegLooksValid"), "stay TTS validates MPEG before audio/mpeg");
  assert(ttsLibSource.includes("GUEST_STAY_TTS_TIMEOUT_MS = 8_000"), "stay TTS guest timeout is 8 seconds");
  const audioLibSource = readFileSync(join(root, "lib/guest-stay-audio.ts"), "utf8");
  assert(!/\btoken\b/.test(audioLibSource), "audio helper has no token");
  assert(!/human-voice|\/api\/tts\b|MediaRecorder|getUserMedia|ElenaVoiceWidget|localStorage/.test(audioLibSource), "audio helper rejects host TTS and recording APIs");
  assert(audioLibSource.includes("GUEST_STAY_AUDIO_PATH"), "audio helper posts to stay-tts");
  assert(!/\/api\/tts\b|human-voice|ElenaVoiceWidget|useListings|localStorage|\bProperty\b/.test(stayTts), "stay TTS has no host TTS, listings, Property, or storage imports");
  assert(!/wifiPassword|doorCode|gateCode|handbook|assignedPhoneNumber/.test(stayTts), "stay TTS has no Phase 3 access fields");
  assert(!/console\.(log|info|debug|error|warn)/.test(stayTts), "stay TTS does not log");
  assert(!/ElenaVoiceWidget|ElenaGuestIsland|GuestPortal|GuestGate/.test(phase2a), "no legacy guest/Elena widgets");
  assert(!/useListings|guestStayFallback|ElenaVoiceWidget/.test(phase2a), "no listings fallback");
  assert(!/\/api\/chat(?!-)|\/api\/avatar|\/api\/transcribe|\/api\/tts(?![\w-])/.test(phase2a), "no chat/voice/host-tts/transcribe routes");
  assert(speechSource.includes("speechSynthesis"), "guest stay speech uses the browser speechSynthesis API");
  assert(!/getUserMedia|MediaRecorder|\bVAD\b|\bPCM\b/.test(speechSource), "guest stay speech does not use mic capture");
  assert(!/getUserMedia|MediaRecorder|\/api\/transcribe|human-voice|ElenaVoiceWidget|ElenaTalkControls/.test(listenSource), "guest stay listen is browser recognition only");
  assert(!/\btoken\b/.test(listenSource), "listen helper has no token");
  assert(elenaCardSource.includes("GUEST_STAY_LISTEN_COPY.tapEn"), "Tap to talk is on the Elena card");
  assert(shellSource.includes("tel:911"), "911 remains on the stay shell");
  assert(shellSource.includes("GuestStayServices"), "service cards remain on the stay shell");
  assert(!/\/api\/places|\/api\/local-guide/.test(phase2a), "no Places or Local Guide API calls");
  assert(!/wifiPassword|doorCode|gateCode|handbook|assignedPhoneNumber/.test(phase2a), "no Wi-Fi, access codes, handbook, or phones");
  assert(!/\bProperty\b/.test(phase2a), "no Property payloads");
  assert(!/href=\{?.*token|searchParams|location\.href/.test(phase2a), "token is not placed on href/query");
  assert(servicesUiSource.includes('target="_self"'), "external links open in the same tab");
  assert(!servicesUiSource.includes('target="_blank"'), "service cards do not use a new tab");
  assert(servicesUiSource.includes("GUEST_STAY_EXTERNAL_LINK_REL"), "external links use the shared rel helper");
  assert(servicesLibSource.includes("noopener noreferrer"), "registry rel is noopener noreferrer");
  assert(servicesUiSource.includes("GUEST_STAY_EXTERNAL_REFERRER_POLICY"), "external links use the shared referrer policy");
  assert(servicesLibSource.includes('"no-referrer"') || servicesLibSource.includes("'no-referrer'"), "registry referrer policy is no-referrer");
  assert(!elenaCardSource.includes("dangerouslySetInnerHTML"), "Elena chat is plain text");
  assert(!/localStorage|sessionStorage/.test(elenaCardSource), "Elena chat is not persisted");

  const legacyPage = readFileSync(join(root, "app/guest/[id]/page.tsx"), "utf8");
  assert(!/guestStayFallback|GuestPortal|dashboard-data/.test(legacyPage), "legacy page loads no property information");
  assert(legacyPage.includes("LegacyGuestLink"), "legacy page uses static copy");

  const securePage = readFileSync(join(root, "app/guest/s/[token]/page.tsx"), "utf8");
  assert(securePage.includes("GuestStayShell"), "secure route mounts safe shell");
  assert(securePage.includes("no-referrer"), "no-referrer metadata");

  const runtimeOriginSource = readFileSync(join(root, "app/api/runtime-origin/route.ts"), "utf8");
  const runtimeGet = runtimeOriginSource.slice(runtimeOriginSource.indexOf("export async function GET"));
  const middlewareSource = readFileSync(join(root, "middleware.ts"), "utf8");
  const publicUrlSource = readFileSync(join(root, "lib/public-app-url.ts"), "utf8");
  assert(!runtimeOriginSource.includes("preferredLanIpv4"), "runtime origin does not rewrite to LAN IPv4");
  assert(runtimeGet.indexOf("configuredSecureOrigin") < runtimeGet.indexOf("readDevTunnelOrigin"), "configured origin still wins");
  assert(runtimeGet.indexOf("readDevTunnelOrigin") < runtimeGet.indexOf("fallbackRuntimeOriginFromRequest"), "HTTPS tunnel still wins over the request host");
  assert(runtimeGet.includes("fallbackRuntimeOriginFromRequest"), "missing env/tunnel keeps the request origin");
  assert(!/NextResponse\.redirect|permanentRedirect|rewrite\(/.test(runtimeOriginSource), "runtime origin does not redirect or rewrite");
  const guestMw = middlewareSource.slice(middlewareSource.indexOf('path.startsWith("/guest")'), middlewareSource.indexOf("const { user"));
  assert(guestMw.includes("NextResponse.next"), "guest middleware still performs no redirect");
  assert(!guestMw.includes("NextResponse.redirect"), "guest middleware does not redirect");
  assert(publicUrlSource.includes("resolveReachableAppOrigin"), "QR origin helper remains");
  assert(qrSource.includes("resolveReachableAppOrigin"), "Guest QR uses the resolved origin");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-qr.test");
if (isDirectRun) {
  void runGuestStayQrTests()
    .then(() => {
      console.log("guest-stay-qr tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "guest-stay-qr tests failed");
      process.exitCode = 1;
    });
}
