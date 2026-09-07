import { GUEST_STAY_SERVICE_CATEGORIES } from "@/lib/guest-stay-services";
import {
  isValidStayTokenFormat,
  validateGuestStayToken,
  type StayErrorCode,
  type StayTokenStore,
} from "@/lib/guest-stay-token";

/** Server-only module. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("guest-stay-chat is server-only");
}

export const GUEST_STAY_CHAT_ENGINE = "secure-policy" as const;
export const GUEST_STAY_CHAT_MAX_MESSAGE = 500;
export const GUEST_STAY_CHAT_MAX_REPLY = 700;
export const GUEST_STAY_CHAT_MAX_BODY_BYTES = 4096;
export const GUEST_STAY_CHAT_RATE_MAX = 20;
export const GUEST_STAY_CHAT_RATE_WINDOW_MS = 60_000;

export type GuestStayChatLang = "en" | "es";

export type GuestStayChatFacts = {
  propertyName: string;
  city: string;
  checkIn: string;
  checkInTime: string;
  checkOut: string;
  checkOutTime: string;
  status: "active";
};

export type GuestStayChatIntent =
  | "private"
  | "emergency"
  | "greeting"
  | "check-in"
  | "checkout"
  | "status"
  | "transportation"
  | "food-delivery"
  | "groceries"
  | "dining"
  | "tours"
  | "rental-cars"
  | "maps-local-guide"
  | "luggage"
  | "baby-gear"
  | "help";

const ALLOWED_BODY_KEYS = new Set(["token", "message", "preferredLang"]);

const ES_CHARS = /[áéíóúñü¿¡]/i;
/** Accent-optional Spanish markers for ordinary Guest Stay phrases (incl. check-in/private). */
const ES_WORDS =
  /\b(hola|buenas|gracias|por favor|ayuda|entrada|salida|estancia|activo|activa|transporte|comida|entrega|supermercado|reservas|restaurantes|tours|atracciones|alquiler|autos|mapas|gu[ií]a|equipaje|beb[eé]|emergencia|auxilio|clave|contrase[nñ]a|direcci[oó]n|c[oó]digos?|hora|puedo|cuando|entrar|llegar|llegada|cual|necesito|dime|donde|est[aá]|mi)\b/i;

/** Clear English markers — loanword-only utterances like bare `check-in` stay ambiguous. */
const EN_CLEAR_WORDS =
  /\b(hello|hi|hey|what|when|where|how|why|which|who|please|thanks|thank|the|your|is|are|can|could|would|should|time|entry|access|door|gate|password|passcode|code|help|status|checkout|arrive|arrival)\b/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Map common Unicode hyphens/dashes (and soft hyphen) to ASCII `-` so `check-in` matches. */
const UNICODE_HYPHEN_CHARS = /[\u2010\u2011\u2013\u2014\u2212\u00AD]/g;

function normalize(text: string) {
  return text.normalize("NFC").toLowerCase().replace(UNICODE_HYPHEN_CHARS, "-");
}

function hasAny(haystack: string, needles: readonly string[]) {
  return needles.some((needle) => haystack.includes(needle));
}

function hasWord(haystack: string, word: string) {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(word)}(?:$|[^\\p{L}\\p{N}])`, "iu").test(haystack);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAnyWord(haystack: string, words: readonly string[]) {
  return words.some((word) => hasWord(haystack, word));
}

/** Credential tokens that must never lose to check-in/arrival when paired with access context. */
const PRIVATE_CREDENTIAL_MARKERS = [
  "clave",
  "claves",
  "llave",
  "llaves",
  "password",
  "passwd",
  "passcode",
  "pin",
  "contraseña",
  "contrasena",
  "código",
  "codigo",
  "code",
] as const;

/** Access/door context that, with a credential marker, means private Access — not check-in time. */
const PRIVATE_ACCESS_CONTEXT_MARKERS = [
  "entrada",
  "acceso",
  "puerta",
  "portón",
  "porton",
  "gate",
  "lockbox",
  "wifi",
  "door",
  "entrance",
  "entry",
  "alarm",
  "alarma",
  "entrar",
] as const;

/**
 * "clave/código/password/PIN + entrada/acceso/puerta/…" is private/security,
 * even when the same utterance also contains check-in words like "entrada".
 */
export function guestStayHasPrivateAccessCredentialCombo(message: string) {
  const q = normalize(message);
  if (hasAny(q, ["caja de llaves"])) return true;
  const hasCredential =
    hasAnyWord(q, PRIVATE_CREDENTIAL_MARKERS) ||
    hasAny(q, ["contraseña", "contrasena", "código", "codigo", "pass code"]);
  const hasAccessContext =
    hasAnyWord(q, PRIVATE_ACCESS_CONTEXT_MARKERS) ||
    hasAny(q, ["lock box", "wi-fi", "wi fi"]);
  return hasCredential && hasAccessContext;
}

export function parseGuestStayChatBody(
  body: unknown,
): { token: string; message: string; preferredLang?: GuestStayChatLang } | { error: "invalid" } {
  if (!isPlainObject(body)) return { error: "invalid" };
  const keys = Object.keys(body);
  if (keys.length < 2 || keys.length > 3) return { error: "invalid" };
  if (keys.some((key) => !ALLOWED_BODY_KEYS.has(key))) return { error: "invalid" };
  if (!("token" in body) || !("message" in body)) return { error: "invalid" };
  if (keys.length === 3 && !("preferredLang" in body)) return { error: "invalid" };

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!isValidStayTokenFormat(token)) return { error: "invalid" };
  if (message.length < 1 || message.length > GUEST_STAY_CHAT_MAX_MESSAGE) return { error: "invalid" };

  let preferredLang: GuestStayChatLang | undefined;
  if ("preferredLang" in body) {
    if (body.preferredLang !== "en" && body.preferredLang !== "es") return { error: "invalid" };
    preferredLang = body.preferredLang;
  }

  return preferredLang ? { token, message, preferredLang } : { token, message };
}

/** True when the message has clear Spanish markers (accents optional). */
export function guestStayChatLooksClearlySpanish(message: string) {
  const text = normalize(message);
  return ES_CHARS.test(text) || ES_WORDS.test(text);
}

/**
 * True when the message has clear English markers.
 * Bare loanwords like `check-in` alone are NOT clearly English (ambiguous → preferredLang).
 */
export function guestStayChatLooksClearlyEnglish(message: string) {
  const text = normalize(message);
  if (EN_CLEAR_WORDS.test(text)) return true;
  // "my" alone is weak; require it with another English cue already covered above,
  // or common English check-in framing without Spanish markers.
  if (hasWord(text, "my") && hasAny(text, ["check-in", "checkin", "check in", "check-out", "checkout", "check out"])) {
    return true;
  }
  return false;
}

/**
 * Deterministic Guest Stay language policy (typed chat + future server-STT transcripts).
 * 1) Clearly Spanish → es (overrides EN preference)
 * 2) Clearly English → en (overrides ES preference)
 * 3) Ambiguous → preferredLang
 * 4) Ambiguous + no preference → en
 */
export function resolveGuestStayChatLang(
  message: string,
  preferredLang?: GuestStayChatLang | null,
): GuestStayChatLang {
  if (guestStayChatLooksClearlySpanish(message)) return "es";
  if (guestStayChatLooksClearlyEnglish(message)) return "en";
  if (preferredLang === "en" || preferredLang === "es") return preferredLang;
  return "en";
}

/** @deprecated Prefer {@link resolveGuestStayChatLang}; kept as message-only detection. */
export function detectGuestStayChatLang(message: string): GuestStayChatLang {
  return resolveGuestStayChatLang(message);
}

export function detectGuestStayChatIntent(message: string): GuestStayChatIntent {
  const q = normalize(message);

  // Precedence: credential + access/entrada beats check-in/arrival.
  if (guestStayHasPrivateAccessCredentialCombo(q)) {
    return "private";
  }

  if (
    hasAny(q, [
      "wifi",
      "wi-fi",
      "wi fi",
      "wifi password",
      "wi-fi password",
      "password",
      "passwd",
      "passcode",
      "pass code",
      "code password",
      "entry password",
      "access password",
      "door password",
      "gate password",
      "pin code",
      "keypad code",
      "key code",
      "contraseña",
      "contrasena",
      "contraseña de entrada",
      "contrasena de entrada",
      "contraseña de acceso",
      "contrasena de acceso",
      "clave wifi",
      "clave de entrada",
      "clave de acceso",
      "mi password",
      "mi clave",
      "codigo password",
      "código password",
      "codigo pin",
      "código pin",
      "entry code",
      "entrance code",
      "access code",
      "door code",
      "gate code",
      "lockbox code",
      "alarm code",
      "security code",
      "lockbox",
      "codigo de entrada",
      "código de entrada",
      "codigo de acceso",
      "código de acceso",
      "codigo de la puerta",
      "código de la puerta",
      "codigo del porton",
      "código del portón",
      "codigo del portón",
      "código del porton",
      "codigo de lockbox",
      "código de lockbox",
      "caja de llaves",
      "codigo de alarma",
      "código de alarma",
      "codigo de",
      "código de",
      "codigo del",
      "código del",
      "exact location",
      "house manual",
      "host phone",
      "host email",
      "guest name",
      "reservation id",
      "confirmation number",
      "booking id",
      "stay id",
      "property id",
      "credit card",
      "debit card",
      "cvv",
    ]) ||
    hasAnyWord(q, [
      "network",
      "alarm",
      "pin",
      "clave",
      "passcode",
      "address",
      "street",
      "ubicación",
      "ubicacion",
      "dirección",
      "direccion",
      "gps",
      "tarjeta",
      "payment",
      "pago",
      "ssn",
    ])
  ) {
    return "private";
  }

  if (
    hasAnyWord(q, [
      "911",
      "emergency",
      "emergencia",
      "auxilio",
      "ambulance",
      "ambulancia",
      "fire",
      "fuego",
      "police",
      "policía",
      "policia",
    ])
  ) {
    return "emergency";
  }

  if (hasAny(q, ["doordash", "uber eats", "ubereats", "food delivery", "entrega de comida"]) || hasWord(q, "delivery")) {
    return "food-delivery";
  }
  if (hasAnyWord(q, ["uber", "lyft", "ride", "taxi", "transporte", "transportation"])) return "transportation";
  if (hasAnyWord(q, ["instacart", "grocery", "groceries", "supermercado"])) return "groceries";
  if (hasAny(q, ["opentable", "resy", "dining", "restaurant reservation", "reservas de restaurantes"])) return "dining";
  if (hasAnyWord(q, ["tour", "tours", "attraction", "atracciones"]) || hasAny(q, ["big bus"])) return "tours";
  if (hasAny(q, ["rental car", "rental cars", "alquiler de autos"]) || hasAnyWord(q, ["enterprise", "hertz"])) {
    return "rental-cars";
  }
  if (hasAny(q, ["google maps", "local guide", "guía local", "guia local"]) || hasAnyWord(q, ["mapas"])) {
    return "maps-local-guide";
  }
  if (hasAnyWord(q, ["luggage", "bounce", "equipaje"])) return "luggage";
  if (hasAny(q, ["babyquip", "artículos para bebés", "articulos para bebes"]) || hasAnyWord(q, ["baby", "bebé", "bebe"])) {
    return "baby-gear";
  }

  if (hasAny(q, ["check-out", "checkout", "check out"]) || hasWord(q, "salida")) return "checkout";
  if (
    hasAny(q, ["check-in", "checkin", "check in"]) ||
    hasAnyWord(q, ["entrada", "llegada", "entrar", "llegar", "arrive", "arrival"])
  ) {
    return "check-in";
  }
  if (hasAny(q, ["active stay", "estancia activa"]) || hasAnyWord(q, ["status", "estado"])) return "status";
  if (hasAnyWord(q, ["hello", "hi", "hey", "hola", "buenas"])) return "greeting";
  if (hasAny(q, ["what can you"]) || hasAnyWord(q, ["help", "ayuda"])) return "help";
  return "help";
}

function stayLabel(facts: GuestStayChatFacts, lang: GuestStayChatLang) {
  const name = facts.propertyName.trim();
  if (name) return name;
  return lang === "es" ? "tu estancia" : "your stay";
}

function withTime(date: string, time: string) {
  const t = time.trim();
  return t ? `${date} · ${t}` : date;
}

function categoryLabels(id: (typeof GUEST_STAY_SERVICE_CATEGORIES)[number]["id"]) {
  const row = GUEST_STAY_SERVICE_CATEGORIES.find((category) => category.id === id);
  return row?.label ?? { en: "", es: "" };
}

function serviceReply(
  lang: GuestStayChatLang,
  id: (typeof GUEST_STAY_SERVICE_CATEGORIES)[number]["id"],
  providers: string,
) {
  const label = categoryLabels(id);
  if (lang === "es") {
    return `Usa la tarjeta ${label.es} más abajo para ${providers}. Este chat no incluye enlaces externos.`;
  }
  return `Use the ${label.en} card below for ${providers}. This chat does not include external links.`;
}

export function guestStayChatReply(
  intent: GuestStayChatIntent,
  lang: GuestStayChatLang,
  facts: GuestStayChatFacts,
): string {
  const stay = stayLabel(facts, lang);
  const city = facts.city.trim();
  const cityBit = city ? (lang === "es" ? ` en ${city}` : ` in ${city}`) : "";
  const checkIn = withTime(facts.checkIn, facts.checkInTime);
  const checkOut = withTime(facts.checkOut, facts.checkOutTime);

  const raw = (() => {
    switch (intent) {
      case "private":
        return lang === "es"
          ? "Por seguridad, no puedo dar códigos de entrada o acceso por voz ni por chat. Usa la sección segura de Acceso en tu Guest Stay."
          : "For security, I can't provide entry or access codes through voice or chat. Please use the secure Access section in your Guest Stay.";
      case "emergency":
        return lang === "es"
          ? "Si es una emergencia inmediata, llama al 911."
          : "If this is an immediate emergency, call 911.";
      case "greeting":
        return lang === "es"
          ? `Hola, soy Isabela. Tu estancia ${stay}${cityBit} está activa. Pregunta por la entrada, la salida, el estado, o las tarjetas de servicio más abajo.`
          : `Hi, I am Isabela. Your stay ${stay}${cityBit} is active. Ask about check-in, checkout, status, or the service cards below.`;
      case "check-in":
        return lang === "es"
          ? `La entrada de ${stay} es ${checkIn}.`
          : `Check-in for ${stay} is ${checkIn}.`;
      case "checkout":
        return lang === "es"
          ? `La salida de ${stay} es ${checkOut}.`
          : `Checkout for ${stay} is ${checkOut}.`;
      case "status":
        return lang === "es"
          ? `El estado de ${stay} es activo.`
          : `The status of ${stay} is active.`;
      case "transportation":
        return serviceReply(lang, "transportation", lang === "es" ? "Uber y Lyft" : "Uber and Lyft");
      case "food-delivery":
        return serviceReply(lang, "food-delivery", lang === "es" ? "DoorDash y Uber Eats" : "DoorDash and Uber Eats");
      case "groceries":
        return serviceReply(lang, "groceries", "Instacart");
      case "dining":
        return serviceReply(lang, "dining", lang === "es" ? "OpenTable y Resy" : "OpenTable and Resy");
      case "tours":
        return serviceReply(lang, "tours", "Big Bus Tours");
      case "rental-cars":
        return serviceReply(lang, "rental-cars", lang === "es" ? "Enterprise y Hertz" : "Enterprise and Hertz");
      case "maps-local-guide":
        return serviceReply(lang, "maps-local-guide", "Google Maps");
      case "luggage":
        return serviceReply(lang, "luggage", "Bounce");
      case "baby-gear":
        return serviceReply(lang, "baby-gear", "BabyQuip");
      default:
        return lang === "es"
          ? "Puedo ayudar con la entrada, la salida, el estado activo, o las tarjetas de transporte, comida, supermercado, reservas, tours, autos, mapas, equipaje y artículos para bebés."
          : "I can help with check-in, checkout, active stay status, or the transportation, food delivery, groceries, dining, tours, rental cars, maps, luggage, and baby gear cards.";
    }
  })();

  return sanitizeGuestStayChatReply(raw);
}

export function sanitizeGuestStayChatReply(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim().slice(0, GUEST_STAY_CHAT_MAX_REPLY);
  return trimmed;
}

function factsFromValidatedStay(body: Record<string, unknown>): GuestStayChatFacts | null {
  if (body.status !== "active") return null;
  const propertyName = body.propertyName;
  const city = body.city;
  const checkIn = body.checkIn;
  const checkInTime = body.checkInTime;
  const checkOut = body.checkOut;
  const checkOutTime = body.checkOutTime;
  if (
    typeof propertyName !== "string" ||
    typeof city !== "string" ||
    typeof checkIn !== "string" ||
    typeof checkInTime !== "string" ||
    typeof checkOut !== "string" ||
    typeof checkOutTime !== "string"
  ) {
    return null;
  }
  return { propertyName, city, checkIn, checkInTime, checkOut, checkOutTime, status: "active" };
}

export function guestStayChatSuccessBody(reply: string, lang: GuestStayChatLang) {
  return {
    reply: sanitizeGuestStayChatReply(reply),
    lang,
    engine: GUEST_STAY_CHAT_ENGINE,
  };
}

export async function handleGuestStayChat(input: {
  body: unknown;
  store: StayTokenStore;
  now?: Date;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = parseGuestStayChatBody(input.body);
  if ("error" in parsed) return { status: 400, body: { error: parsed.error } };

  const validated = await validateGuestStayToken({
    body: { token: parsed.token },
    store: input.store,
    now: input.now,
  });
  if (validated.status !== 200 || validated.body.error) {
    const error = (validated.body.error as StayErrorCode | undefined) ?? "invalid";
    return { status: validated.status, body: { error } };
  }

  const facts = factsFromValidatedStay(validated.body);
  if (!facts) return { status: 503, body: { error: "unavailable" } };

  const lang = resolveGuestStayChatLang(parsed.message, parsed.preferredLang);
  const intent = detectGuestStayChatIntent(parsed.message);
  const reply = guestStayChatReply(intent, lang, facts);
  return { status: 200, body: guestStayChatSuccessBody(reply, lang) };
}

export function guestStayChatReplyLooksUnsafe(reply: string) {
  return (
    /https?:|www\.|<\w|<\/|markdown|\[[^\]]+\]\(/i.test(reply) ||
    /\$\d/.test(reply) ||
    /\b(?!911\b)\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(reply) ||
    /wifi password|door code|gate code|house manual|lockbox/i.test(reply) ||
    /[A-Za-z0-9_-]{43,}/.test(reply)
  );
}
