import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectGuestStayChatIntent,
  detectGuestStayChatLang,
  guestStayChatReply,
  guestStayChatReplyLooksUnsafe,
  guestStayChatSuccessBody,
  handleGuestStayChat,
  parseGuestStayChatBody,
  resolveGuestStayChatLang,
  sanitizeGuestStayChatReply,
  type GuestStayChatFacts,
} from "./guest-stay-chat";
import {
  createMemoryStayTokenStore,
  generateStayToken,
  hashStayToken,
  issueGuestStayLink,
  type StayPropertyRecord,
  type StayReservationRecord,
} from "./guest-stay-token";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const property: StayPropertyRecord = {
  id: "prop-chat-1",
  name: "Palm Court",
  city: "Miami",
  timezone: "UTC",
};

const reservation: StayReservationRecord = {
  id: "res-chat-1",
  property_id: "prop-chat-1",
  check_in: "2026-09-10",
  check_in_time: "3:00 PM",
  check_out: "2026-09-14",
  check_out_time: "11:00 AM",
  status: "upcoming",
};

const facts: GuestStayChatFacts = {
  propertyName: "Palm Court",
  city: "Miami",
  checkIn: "2026-09-10",
  checkInTime: "3:00 PM",
  checkOut: "2026-09-14",
  checkOutTime: "11:00 AM",
  status: "active",
};

const now = new Date("2026-09-11T12:00:00.000Z");

function seedStore() {
  return createMemoryStayTokenStore({
    reservations: [reservation],
    properties: [property],
  });
}

async function issueRawToken() {
  const store = seedStore();
  const issued = await issueGuestStayLink({
    userId: "00000000-0000-4000-8000-000000000001",
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store,
    now,
  });
  assert(issued.status === 200 && typeof issued.body.token === "string", "chat tests need an issued stay token");
  return { store, token: issued.body.token as string };
}

function assertSafeReply(reply: string, message: string) {
  assert(reply.length > 0 && reply.length <= 700, `${message}: length`);
  assert(!guestStayChatReplyLooksUnsafe(reply), `${message}: unsafe content`);
  assert(!/https?:|www\./i.test(reply), `${message}: no urls`);
  assert(!/\$/.test(reply), `${message}: no dollar amounts`);
  assert(!/</.test(reply), `${message}: no html`);
  assert(!/\b(?!911\b)\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(reply), `${message}: no extra phones`);
}

export async function runGuestStayChatTests() {
  const sample = generateStayToken();
  assert("error" in parseGuestStayChatBody({ token: sample }), "message required");
  assert("error" in parseGuestStayChatBody({ message: "Hello" }), "token required");
  assert("error" in parseGuestStayChatBody({ token: sample, message: "Hello", extra: true }), "extra keys rejected");
  assert("error" in parseGuestStayChatBody({ token: sample, message: "" }), "empty message rejected");
  assert("error" in parseGuestStayChatBody({ token: sample, message: "a".repeat(501) }), "overlong message rejected");
  assert("error" in parseGuestStayChatBody({ token: sample, message: "Hello", preferredLang: "fr" }), "invalid preferredLang rejected");
  assert("error" in parseGuestStayChatBody({ token: sample, message: "Hello", preferredLang: true }), "non-string preferredLang rejected");
  const parsedPreferred = parseGuestStayChatBody({ token: sample, message: " check-in ", preferredLang: "es" });
  assert(
    !("error" in parsedPreferred) &&
      parsedPreferred.message === "check-in" &&
      parsedPreferred.preferredLang === "es",
    "optional preferredLang en/es accepted",
  );
  const parsed = parseGuestStayChatBody({ token: sample, message: " Hello " });
  assert(!("error" in parsed) && parsed.message === "Hello" && parsed.token === sample && !("preferredLang" in parsed), "exact token and trimmed message");

  let lookups = 0;
  const issued = await issueRawToken();
  const originalFind = issued.store.findByHash.bind(issued.store);
  issued.store.findByHash = async (tokenHash) => {
    lookups += 1;
    return originalFind(tokenHash);
  };
  const greeted = await handleGuestStayChat({
    body: { token: issued.token, message: "Hello" },
    store: issued.store,
    now,
  });
  assert(lookups >= 1, "token is validated before a reply");
  assert(greeted.status === 200, "active token can chat");
  assert(Object.keys(greeted.body).sort().join(",") === "engine,lang,reply", "success allowlist");
  assert(greeted.body.engine === "secure-policy" && greeted.body.lang === "en", "engine and English lang");
  assert(typeof greeted.body.reply === "string", "reply is a string");
  assertSafeReply(String(greeted.body.reply), "greeting");
  assert(!JSON.stringify(greeted.body).includes("stayId"), "success omits stayId");
  assert(!String(greeted.body.reply).includes(issued.token), "reply does not echo token");

  const missing = await handleGuestStayChat({
    body: { token: generateStayToken(), message: "Hello" },
    store: seedStore(),
    now,
  });
  assert(missing.status === 404 && missing.body.error === "invalid" && !("reply" in missing.body), "unknown token is invalid");

  const expiredStore = seedStore();
  const expiredToken = generateStayToken();
  expiredStore.tokens.push({
    id: "expired-row",
    token_hash: hashStayToken(expiredToken),
    reservation_id: reservation.id,
    property_id: property.id,
    expires_at: "2026-09-01T00:00:00.000Z",
    revoked_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    created_by: null,
  });
  const expired = await handleGuestStayChat({
    body: { token: expiredToken, message: "Hello" },
    store: expiredStore,
    now,
  });
  assert(expired.status === 410 && expired.body.error === "expired" && !("reply" in expired.body), "expired is unchanged");

  const revokedStore = seedStore();
  const revokedToken = generateStayToken();
  revokedStore.tokens.push({
    id: "revoked-row",
    token_hash: hashStayToken(revokedToken),
    reservation_id: reservation.id,
    property_id: property.id,
    expires_at: "2026-09-14T15:00:00.000Z",
    revoked_at: "2026-09-11T00:00:00.000Z",
    created_at: "2026-09-01T00:00:00.000Z",
    created_by: null,
  });
  const revoked = await handleGuestStayChat({
    body: { token: revokedToken, message: "Hello" },
    store: revokedStore,
    now,
  });
  assert(revoked.status === 410 && revoked.body.error === "revoked" && !("reply" in revoked.body), "revoked is unchanged");

  const canceledStore = createMemoryStayTokenStore({
    reservations: [{ ...reservation, status: "canceled" }],
    properties: [property],
  });
  const canceledToken = generateStayToken();
  canceledStore.tokens.push({
    id: "canceled-row",
    token_hash: hashStayToken(canceledToken),
    reservation_id: reservation.id,
    property_id: property.id,
    expires_at: "2026-09-14T15:00:00.000Z",
    revoked_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    created_by: null,
  });
  const canceledChat = await handleGuestStayChat({
    body: { token: canceledToken, message: "Hello" },
    store: canceledStore,
    now,
  });
  assert(canceledChat.body.error === "unavailable" && !("reply" in canceledChat.body), "canceled stay is unavailable");

  assert(detectGuestStayChatLang("Hello, when is check-in?") === "en", "English detection");
  assert(detectGuestStayChatLang("Hola, ¿cuándo es la entrada?") === "es", "Spanish accent detection");
  assert(detectGuestStayChatLang("gracias por la ayuda") === "es", "Spanish word detection");

  const intents: Array<[string, ReturnType<typeof detectGuestStayChatIntent>]> = [
    ["Hello there", "greeting"],
    ["When is check-in?", "check-in"],
    ["When is checkout?", "checkout"],
    ["What is the stay status?", "status"],
    ["I need transportation", "transportation"],
    ["I need food delivery", "food-delivery"],
    ["Where are groceries?", "groceries"],
    ["I need dining reservations", "dining"],
    ["Looking for tours", "tours"],
    ["I need rental cars", "rental-cars"],
    ["Open the local guide", "maps-local-guide"],
    ["I need luggage storage", "luggage"],
    ["I need baby gear", "baby-gear"],
    ["This is an emergency", "emergency"],
    ["What is the wifi password?", "private"],
    ["Read the house manual", "private"],
    ["Where can I find my entry code?", "private"],
    ["What is the entrance code?", "private"],
    ["What is the access code?", "private"],
    ["What is the door code?", "private"],
    ["What is the gate code?", "private"],
    ["What is the lockbox code?", "private"],
    ["What is the alarm code?", "private"],
    ["What is the security code?", "private"],
    ["¿Cuál es el código de entrada?", "private"],
    ["Necesito el código de acceso", "private"],
    ["Dime el código de la puerta", "private"],
    ["Cuál es el código del portón", "private"],
    ["Código de lockbox por favor", "private"],
    ["Dónde está la caja de llaves", "private"],
    ["Cuál es el código de alarma", "private"],
    ["Where is my code password?", "private"],
    ["What is my password?", "private"],
    ["What is my passcode?", "private"],
    ["Where is my PIN?", "private"],
    ["Where can I find my password?", "private"],
    ["Cuál es mi password?", "private"],
    ["Dónde está mi clave?", "private"],
    ["What is my pass code?", "private"],
    ["What is the keypad code?", "private"],
    ["What is the key code?", "private"],
    ["What is the entry password?", "private"],
    ["What is the Wi-Fi password?", "private"],
    ["Necesito la clave de entrada", "private"],
    ["¿Cuál es la clave de entrada?", "private"],
    ["¿Dónde está mi código de entrada?", "private"],
    ["¿Cuál es mi password de entrada?", "private"],
    ["¿A qué hora es la entrada?", "check-in"],
    ["¿A qué hora puedo entrar?", "check-in"],
    ["Cuál es la contraseña de acceso", "private"],
    ["Dime el código PIN", "private"],
    ["Cuál es el código password", "private"],
  ];
  for (const [message, intent] of intents) {
    assert(detectGuestStayChatIntent(message) === intent, `intent ${intent} for ${JSON.stringify(message)}`);
    const lang = detectGuestStayChatLang(message);
    const reply = guestStayChatReply(intent, lang, facts);
    assertSafeReply(reply, intent);
  }

  const spanishPrivateOverCheckIn = [
    "¿Cuál es la clave de entrada?",
    "¿Dónde está mi código de entrada?",
    "¿Cuál es mi password de entrada?",
    "Necesito la llave de entrada",
  ] as const;
  for (const phrase of spanishPrivateOverCheckIn) {
    assert(
      detectGuestStayChatIntent(phrase) === "private",
      `credential+entrada stays private (not check-in) for ${JSON.stringify(phrase)}`,
    );
    const reply = guestStayChatReply("private", "es", facts);
    assert(/por seguridad/i.test(reply) && /secci[oó]n segura de acceso/i.test(reply), `safe Access refusal for ${JSON.stringify(phrase)}`);
    assert(!/3:00\s*PM/i.test(reply) && !/\b\d{4,}\b/.test(reply), `no check-in time or code leak for ${JSON.stringify(phrase)}`);
  }
  assert(detectGuestStayChatIntent("¿A qué hora es la entrada?") === "check-in", "entrada alone remains check-in");
  assert(detectGuestStayChatIntent("¿A qué hora puedo entrar?") === "check-in", "entrar time question is check-in");
  assert(
    detectGuestStayChatIntent("When is check-in?") === "check-in" &&
      detectGuestStayChatIntent("What is the door code?") === "private",
    "English check-in vs private precedence preserved",
  );

  const checkInRouting: Array<[string, ReturnType<typeof detectGuestStayChatIntent>]> = [
    ["What time is my check-in?", "check-in"],
    [`What time is my check\u2011in?`, "check-in"],
    [`When is check\u2013in?`, "check-in"],
    ["When can I arrive?", "check-in"],
    ["What time can I arrive?", "check-in"],
    ["¿A qué hora es mi check-in?", "check-in"],
    ["¿A qué hora puedo llegar?", "check-in"],
    ["¿Cuándo es mi llegada?", "check-in"],
    ["What is my entry code?", "private"],
    ["What is my access code?", "private"],
    ["¿Cuál es mi clave de entrada?", "private"],
    ["¿Dónde está mi código de acceso?", "private"],
  ];
  for (const [message, intent] of checkInRouting) {
    assert(
      detectGuestStayChatIntent(message) === intent,
      `check-in routing ${intent} for ${JSON.stringify(message)}`,
    );
  }
  assert(
    guestStayChatReply("check-in", "en", facts).includes("3:00 PM"),
    "check-in reply still includes stay check-in time",
  );

  const clearlySpanish = [
    "Hola Isabela",
    "A que hora puedo entrar",
    "Cuando es la llegada",
    "Cual es mi clave de entrada",
  ] as const;
  const clearlyEnglish = [
    "Hello Isabela",
    "What time is my check-in?",
    "What is my entry code?",
  ] as const;
  const ambiguous = ["check-in", "Check-In", "checkin"] as const;

  for (const preferred of ["en", "es"] as const) {
    for (const phrase of clearlySpanish) {
      const lang = resolveGuestStayChatLang(phrase, preferred);
      assert(lang === "es", `clear Spanish → es (preferred=${preferred}) for ${JSON.stringify(phrase)}`);
      const intent = detectGuestStayChatIntent(phrase);
      const reply = guestStayChatReply(intent, lang, facts);
      assertSafeReply(reply, phrase);
      assert(/[áéíóúñü¿¡]|entrada|Hola|clave|llegada|puedo/i.test(reply) || /Por seguridad/i.test(reply), `Spanish reply for ${JSON.stringify(phrase)}`);
      assert(!/^Hi, I am Isabela|^Check-in for |^For security, I can't/i.test(reply), `not English reply for ${JSON.stringify(phrase)}`);
    }
    for (const phrase of clearlyEnglish) {
      const lang = resolveGuestStayChatLang(phrase, preferred);
      assert(lang === "en", `clear English → en (preferred=${preferred}) for ${JSON.stringify(phrase)}`);
      const intent = detectGuestStayChatIntent(phrase);
      const reply = guestStayChatReply(intent, lang, facts);
      assertSafeReply(reply, phrase);
      assert(/Hi, I am Isabela|Check-in for |For security, I can't/i.test(reply), `English reply for ${JSON.stringify(phrase)}`);
    }
    for (const phrase of ambiguous) {
      const lang = resolveGuestStayChatLang(phrase, preferred);
      assert(lang === preferred, `ambiguous → preferredLang=${preferred} for ${JSON.stringify(phrase)}`);
      assert(detectGuestStayChatIntent(phrase) === "check-in", `ambiguous check-in intent for ${JSON.stringify(phrase)}`);
    }
  }
  assert(resolveGuestStayChatLang("check-in") === "en", "ambiguous without preferredLang defaults to en");
  assert(detectGuestStayChatIntent("Cual es mi clave de entrada") === "private", "accentless clave de entrada stays private");
  assert(detectGuestStayChatIntent("A que hora puedo entrar") === "check-in", "accentless entrar stays check-in");
  assert(detectGuestStayChatIntent("Cuando es la llegada") === "check-in", "accentless llegada stays check-in");

  const issuedLang = await issueRawToken();
  for (const preferred of ["en", "es"] as const) {
    const amb = await handleGuestStayChat({
      body: { token: issuedLang.token, message: "check-in", preferredLang: preferred },
      store: issuedLang.store,
      now,
    });
    assert(amb.status === 200 && amb.body.lang === preferred, `API ambiguous uses preferredLang=${preferred}`);
    assert(typeof amb.body.reply === "string", "ambiguous reply is a string");
    assertSafeReply(String(amb.body.reply), `ambiguous preferred=${preferred}`);
    assert(/3:00\s*PM/i.test(String(amb.body.reply)), "ambiguous check-in still returns time");
    assert(!/\b\d{5,}\b/.test(String(amb.body.reply).replace(/2026-09-10/g, "")), "ambiguous reply invents no credential codes");

    const esMsg = await handleGuestStayChat({
      body: { token: issuedLang.token, message: "A que hora puedo entrar", preferredLang: preferred },
      store: issuedLang.store,
      now,
    });
    assert(esMsg.status === 200 && esMsg.body.lang === "es", `API clear Spanish overrides preferred=${preferred}`);
    assert(String(esMsg.body.reply).includes("entrada") && String(esMsg.body.reply).includes("3:00 PM"), "Spanish check-in time");

    const enMsg = await handleGuestStayChat({
      body: { token: issuedLang.token, message: "What time is my check-in?", preferredLang: preferred },
      store: issuedLang.store,
      now,
    });
    assert(enMsg.status === 200 && enMsg.body.lang === "en", `API clear English overrides preferred=${preferred}`);
    assert(String(enMsg.body.reply).includes("Check-in") && String(enMsg.body.reply).includes("3:00 PM"), "English check-in time");

    const privateEs = await handleGuestStayChat({
      body: { token: issuedLang.token, message: "Cual es mi clave de entrada", preferredLang: preferred },
      store: issuedLang.store,
      now,
    });
    assert(privateEs.status === 200 && privateEs.body.lang === "es", "accentless private stays Spanish");
    assert(/Por seguridad/i.test(String(privateEs.body.reply)), "private Spanish refusal");
    assert(!/\b\d{4,}\b/.test(String(privateEs.body.reply)), "private does not reveal credentials");

    const privateEn = await handleGuestStayChat({
      body: { token: issuedLang.token, message: "What is my entry code?", preferredLang: preferred },
      store: issuedLang.store,
      now,
    });
    assert(privateEn.status === 200 && privateEn.body.lang === "en", "English entry code stays English");
    assert(/For security/i.test(String(privateEn.body.reply)), "private English refusal");
    assert(!/\b\d{4,}\b/.test(String(privateEn.body.reply)), "entry code does not reveal credentials");
  }

  const passwordPhrases = [
    "Where is my code password?",
    "What is my password?",
    "Where is my PIN?",
    "Cuál es mi password?",
    "Dónde está mi clave?",
  ] as const;
  for (const phrase of passwordPhrases) {
    assert(detectGuestStayChatIntent(phrase) === "private", `password-family private for ${JSON.stringify(phrase)}`);
    const lang = detectGuestStayChatLang(phrase);
    const reply = guestStayChatReply("private", lang, facts);
    assertSafeReply(reply, phrase);
    if (lang === "es") {
      assert(/sección segura de acceso/i.test(reply), `ES Access redirect for ${JSON.stringify(phrase)}`);
    } else {
      assert(/secure access section/i.test(reply), `EN Access redirect for ${JSON.stringify(phrase)}`);
    }
  }

  const esPrivate = guestStayChatReply("private", "es", facts);
  const enPrivate = guestStayChatReply("private", "en", facts);
  assert(/por seguridad/i.test(esPrivate) && /sección segura de acceso/i.test(esPrivate), "Spanish private directs to Access");
  assert(/for security/i.test(enPrivate) && /secure access section/i.test(enPrivate), "English private directs to Access");
  assert(!/\b\d{4,}\b/.test(enPrivate) && !/\b\d{4,}\b/.test(esPrivate), "private reply never invents a code value");
  assertSafeReply(esPrivate, "es private");
  assertSafeReply(enPrivate, "en private");

  const entryCodeReply = guestStayChatReply(
    detectGuestStayChatIntent("Where can I find my entry code?"),
    detectGuestStayChatLang("Where can I find my entry code?"),
    facts,
  );
  assert(/secure access section/i.test(entryCodeReply), "entry code uses Access-section private reply");
  assertSafeReply(entryCodeReply, "entry code private");

  const emergency = guestStayChatReply("emergency", "en", facts);
  assert(emergency.includes("911"), "emergency mentions 911");
  assert(!/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(emergency.replace("911", "")), "emergency is 911 only");

  const esCheckIn = guestStayChatReply("check-in", "es", facts);
  assert(esCheckIn.includes("entrada"), "Spanish check-in");
  assert(!esCheckIn.includes("Check-in"), "Spanish check-in is not mixed with English labels");

  assert(sanitizeGuestStayChatReply("a".repeat(800)).length === 700, "reply length cap");
  const success = guestStayChatSuccessBody("ok", "en");
  assert(Object.keys(success).sort().join(",") === "engine,lang,reply", "success helper allowlist");

  const chatSource = readFileSync(join(process.cwd(), "src/lib/guest-stay-chat.ts"), "utf8");
  const routeSource = readFileSync(join(process.cwd(), "src/app/api/guest/stay-chat/route.ts"), "utf8");
  assert(!/openai|anthropic|claude|fetch\(/i.test(chatSource), "policy module has no external/LLM calls");
  assert(!/openai|anthropic|claude/.test(routeSource), "route has no LLM clients");
  assert(!/console\.(log|info|debug|error|warn)/.test(`${chatSource}\n${routeSource}`), "no chat logging");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-chat.test");
if (isDirectRun) {
  runGuestStayChatTests()
    .then(() => {
      console.log("guest-stay-chat tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "guest-stay-chat tests failed");
      process.exitCode = 1;
    });
}
