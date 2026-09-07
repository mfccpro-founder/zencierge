import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GUEST_ELENA_TEXT_COPY,
  GUEST_STAY_CHAT_VISIBLE_LIMIT,
  canStartGuestStayChatSend,
  guestStayChatRequestBody,
  visibleGuestStayChatMessages,
} from "./guest-elena-text-card";
import { GUEST_STAY_ELENA_BOUNDARY_COPY } from "./guest-stay-elena-boundary";
import {
  GUEST_STAY_GENERIC_HEADING,
  guestStayDisplayHeading,
  guestStayShowsConciergeExtras,
  interpretGuestStayShellPayload,
} from "./guest-stay-shell";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const publicActiveFields = {
  propertyName: "Palm Court",
  city: "Miami",
  checkIn: "2026-09-01",
  checkInTime: "15:00",
  checkOut: "2026-09-04",
  checkOutTime: "11:00",
  status: "active" as const,
};

export function runGuestStayShellTests() {
  const emptyName = interpretGuestStayShellPayload(true, {
    ...publicActiveFields,
    propertyName: "",
    city: "",
  });
  assert(emptyName.state === "active", "200 active with empty propertyName is active");
  assert(emptyName.stay?.propertyName === "", "empty propertyName is kept as an empty string");
  assert(
    guestStayDisplayHeading(emptyName.stay?.propertyName ?? "") === GUEST_STAY_GENERIC_HEADING,
    "empty propertyName uses the existing generic heading",
  );
  assert(guestStayShowsConciergeExtras(emptyName.state, emptyName.stay), "active empty name still shows Elena/services");

  const named = interpretGuestStayShellPayload(true, publicActiveFields);
  assert(named.state === "active", "200 active with public strings is active");
  assert(named.stay?.propertyName === "Palm Court", "named stay keeps propertyName");
  assert(named.stay?.city === "Miami", "named stay keeps city");
  assert(named.stay?.checkIn === "2026-09-01", "active stay keeps check-in");
  assert(named.stay?.checkOut === "2026-09-04", "active stay keeps checkout");
  assert(named.stay?.status === "active", "active stay keeps status");
  assert(guestStayDisplayHeading(named.stay?.propertyName ?? "") === "Palm Court", "named heading is unchanged");
  assert(guestStayShowsConciergeExtras(named.state, named.stay), "Elena/services render only after active guard");

  assert(interpretGuestStayShellPayload(true, { status: "active" }).state === "invalid", "malformed 200 missing fields is invalid");
  assert(
    interpretGuestStayShellPayload(true, { ...publicActiveFields, checkIn: 1 }).state === "invalid",
    "malformed 200 wrong field type is invalid",
  );
  assert(interpretGuestStayShellPayload(true, null).state === "invalid", "malformed 200 null JSON is invalid");
  assert(interpretGuestStayShellPayload(true, []).state === "invalid", "malformed 200 array JSON is invalid");

  const invalid = interpretGuestStayShellPayload(false, { error: "invalid" });
  const expired = interpretGuestStayShellPayload(false, { error: "expired" });
  const revoked = interpretGuestStayShellPayload(false, { error: "revoked" });
  const unavailable = interpretGuestStayShellPayload(false, { error: "unavailable" });
  assert(invalid.state === "invalid", "404 invalid is invalid");
  assert(expired.state === "expired", "410 expired stays expired");
  assert(revoked.state === "revoked", "410 revoked stays revoked");
  assert(unavailable.state === "unavailable", "unavailable stays unavailable");
  assert(!guestStayShowsConciergeExtras("loading", null), "no services while loading");
  assert(!guestStayShowsConciergeExtras(invalid.state, invalid.stay), "no services for invalid");
  assert(!guestStayShowsConciergeExtras(expired.state, expired.stay), "no services for expired");
  assert(!guestStayShowsConciergeExtras(revoked.state, revoked.stay), "no services for revoked");
  assert(!guestStayShowsConciergeExtras(unavailable.state, unavailable.stay), "no services for unavailable");

  assert(GUEST_ELENA_TEXT_COPY.titleEn.includes("Isabela"), "Isabela English title");
  assert(GUEST_ELENA_TEXT_COPY.titleEs.includes("Isabela"), "Isabela Spanish title");
  assert(GUEST_ELENA_TEXT_COPY.titleEn.includes("Receptionist"), "Elena English title");
  assert(GUEST_ELENA_TEXT_COPY.titleEs.includes("Recepcionista"), "Elena Spanish title");
  assert(GUEST_ELENA_TEXT_COPY.subtitleEn === "Text concierge", "text concierge status");
  assert(!/ready/i.test(`${GUEST_ELENA_TEXT_COPY.subtitleEn} ${GUEST_ELENA_TEXT_COPY.subtitleEs}`), "does not claim Ready");

  const request = guestStayChatRequestBody("sample-token", "Hello");
  assert(Object.keys(request).sort().join(",") === "message,token", "request body is token + message only");
  assert(GUEST_STAY_CHAT_VISIBLE_LIMIT === 8, "visible transcript cap");
  assert(visibleGuestStayChatMessages([1, 2, 3, 4, 5, 6, 7, 8, 9]).join(",") === "2,3,4,5,6,7,8,9", "keeps eight messages");
  assert(!canStartGuestStayChatSend({ sending: true, message: "Hello" }), "overlapping sends blocked");
  assert(canStartGuestStayChatSend({ sending: false, message: "Hello" }), "idle send allowed");

  const shellSource = readFileSync(join(process.cwd(), "src/components/guest/guest-stay-shell.tsx"), "utf8");
  const elenaSource = readFileSync(join(process.cwd(), "src/components/guest/guest-elena-text-card.tsx"), "utf8");
  const wrapStart = shellSource.indexOf("<GuestStayElenaBoundary>");
  const wrapClose = "</GuestStayElenaBoundary>";
  const wrapEnd = shellSource.indexOf(wrapClose) + wrapClose.length;
  assert(wrapStart !== -1 && wrapEnd > wrapStart, "Elena is wrapped in GuestStayElenaBoundary");
  const wrap = shellSource.slice(wrapStart, wrapEnd);
  const beforeWrap = shellSource.slice(0, wrapStart);
  const afterWrap = shellSource.slice(wrapEnd);
  assert(wrap.includes("<GuestElenaTextCard token={token} />"), "active shell passes token to Elena");
  assert(beforeWrap.includes("<GuestStayAccessCard key={token} token={token} />"), "access card renders before Elena");
  assert(!wrap.includes("GuestStayAccessCard"), "access card stays outside the Elena boundary");
  assert(!wrap.includes("wifiNetwork") && !wrap.includes("wifiPassword") && !wrap.includes("doorCode"), "Elena does not receive access fields");
  assert(!shellSource.includes("wifiNetwork=") && !shellSource.includes("wifiPassword=") && !shellSource.includes("doorCode="), "shell does not pass access field props");
  assert(shellSource.includes('JSON.stringify({ token })'), "stay validate body is still token only");
  assert(shellSource.includes('publicApiUrl("/api/guest/stay")'), "stay validate path unchanged");
  assert(!wrap.includes("GuestStayServices"), "services stay outside the Elena boundary");
  assert(!wrap.includes("tel:911"), "911 stays outside the Elena boundary");
  assert(!wrap.includes("guestStayDisplayHeading"), "heading stays outside the Elena boundary");
  assert(!wrap.includes("stay.city"), "city stays outside the Elena boundary");
  assert(!wrap.includes("stay.checkIn"), "check-in stays outside the Elena boundary");
  assert(!wrap.includes("stay.checkOut"), "checkout stays outside the Elena boundary");
  assert(!wrap.includes("activeHint"), "stay hints stay outside the Elena boundary");
  assert(beforeWrap.includes("guestStayDisplayHeading"), "heading renders before Elena");
  assert(beforeWrap.includes("stay.city") && beforeWrap.includes("stay.checkIn") && beforeWrap.includes("stay.checkOut"), "stay details render before Elena");
  assert(beforeWrap.includes("en.activeHint"), "stay hints render before Elena");
  assert(afterWrap.includes("<GuestStayServices />"), "active shell mounts services after Elena");
  assert(afterWrap.includes("tel:911"), "911 remains after Elena");
  assert(shellSource.includes("<GuestStayServices />"), "active shell mounts services");
  const inactive = shellSource.slice(shellSource.indexOf("{GUEST_STAY_GENERIC_HEADING}"));
  assert(!inactive.includes("GuestElenaTextCard"), "Elena card is not in the inactive branch");
  assert(!inactive.includes("GuestStayElenaBoundary"), "Elena boundary is not in the inactive branch");
  assert(!inactive.includes("GuestStayServices"), "services are not in the inactive branch");
  assert(!inactive.includes("GuestStayAccessCard"), "access card is not in the inactive branch");
  assert(
    GUEST_STAY_ELENA_BOUNDARY_COPY.en === "Isabela is temporarily unavailable. You can still use the services below.",
    "English Elena fallback copy",
  );
  assert(
    GUEST_STAY_ELENA_BOUNDARY_COPY.es === "Isabela no está disponible temporalmente. Todavía puedes usar los servicios de abajo.",
    "Spanish Elena fallback copy",
  );
  assert(elenaSource.includes("guestStayChatRequestBody(token, message, listenLangRef.current)"), "chat POST uses token + message + preferredLang helper");
  assert(elenaSource.includes("/api/guest/stay-chat"), "Elena posts to stay-chat");
  assert(!/localStorage|sessionStorage|document\.cookie|console\.(log|info|debug|error)/.test(elenaSource), "token is not stored or logged");
  assert(!/href=.*token|searchParams/.test(elenaSource), "token is not placed on links or query");
  assert(!elenaSource.includes("dangerouslySetInnerHTML"), "plain text only");
  assert(!/\/api\/chat(?!-)|\/api\/avatar|\/api\/transcribe|\/api\/tts|\/api\/places|\/api\/local-guide/.test(elenaSource), "no unsafe legacy routes");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-shell.test");
if (isDirectRun) {
  try {
    runGuestStayShellTests();
    console.log("guest-stay-shell tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "guest-stay-shell tests failed");
    process.exitCode = 1;
  }
}
