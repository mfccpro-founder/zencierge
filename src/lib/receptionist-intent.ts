import type { Property } from "@/lib/dashboard-data";
import { detectReplyLang, type LanguageMode, type ReplyLang } from "@/lib/human-voice";

export type GuestIntent =
  | "emergency"
  | "connection_check"
  | "grocery"
  | "pharmacy"
  | "restaurant"
  | "hospital"
  | "gas"
  | "nearby"
  | "greeting"
  | "wifi"
  | "parking"
  | "door"
  | "access"
  | "checkin"
  | "trash"
  | "rules"
  | "open";

export type NearbyPlaceKind = "pharmacy" | "grocery" | "restaurant" | "hospital" | "gas" | "nearby";

const STOPWORDS = new Set([
  "what",
  "whats",
  "where",
  "wheres",
  "when",
  "which",
  "with",
  "from",
  "this",
  "that",
  "have",
  "there",
  "here",
  "please",
  "could",
  "would",
  "about",
  "your",
  "the",
  "and",
  "for",
  "you",
  "can",
  "how",
  "does",
  "guest",
  "automatically",
  "detect",
  "language",
  "spanish",
  "english",
  "answer",
  "only",
  "message",
  "never",
  "reply",
  "other",
]);

export function extractGuestUtterance(question: string): string {
  const marker = "\n\nGuest: ";
  const idx = question.lastIndexOf(marker);
  if (idx !== -1) return question.slice(idx + marker.length).trim();
  const guestIdx = question.indexOf("Guest: ");
  if (guestIdx !== -1) return question.slice(guestIdx + 7).trim();
  return question.trim();
}

export function normalizeGuestText(text: string) {
  return text
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[¿?¡!.,;:()'"“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasWholeWord(haystack: string, needle: string) {
  const h = normalizeGuestText(haystack);
  const n = normalizeGuestText(needle);
  if (!n) return false;
  if (n.includes(" ")) return h.includes(n);
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(n)}(?:$|[^a-z0-9])`).test(h);
}

function padded(text: string) {
  return ` ${text} `;
}

function hasAnyWhole(haystack: string, needles: string[]) {
  return needles.some((needle) => hasWholeWord(haystack, needle));
}

const GROCERY_HINTS = [
  "supermercado",
  "supermarket",
  "grocery",
  "groceries",
  "publix",
  "tienda",
  "tiendas",
  "alimentos",
  "whole foods",
  "trader joe",
  "walmart",
];

const PHARMACY_HINTS = [
  "farmacia",
  "pharmacy",
  "cvs",
  "walgreens",
  "medicamento",
  "medicina",
  "prescription",
  "drugstore",
];

const RESTAURANT_HINTS = [
  "restaurante",
  "restaurant",
  "cenar",
  "almorzar",
  "dinner",
  "lunch",
  "comida",
];

const HOSPITAL_HINTS = ["hospital", "er", "emergency room", "urgent care", "clinica", "clinic"];

const GAS_HINTS = ["gas station", "gasolinera", "petrol", "fuel", "gasolin"];

const NEARBY_HINTS = ["cerca", "cercano", "nearby", "around here", "aqui cerca", "walking distance"];

const WIFI_HINTS = [
  "wifi",
  "wi-fi",
  "wi fi",
  "internet",
  "clave de internet",
  "clave wifi",
  "clave del wifi",
  "nombre de red",
];

const DOOR_HINTS = [
  "codigo de la puerta",
  "codigo puerta",
  "door code",
  "smartlock",
  "keypad",
  "cerradura",
  "llave",
];

const ACCESS_HINTS = [
  "lockbox",
  "alarm code",
  "alarm",
  "gate code",
  "codigo del porton",
  "password",
  "contrasena",
  "access code",
  "codigo de acceso",
];

const PARKING_HINTS = ["estacionamiento", "estacionar", "parking", "parquear", "aparcar", "garage"];

const CHECKIN_HINTS = [
  "check in",
  "check-in",
  "checkin",
  "check out",
  "checkout",
  "horario de entrada",
  "horario de salida",
  "late checkout",
];

/** Also used by the Elena system prompt to pull trash rules out of the handbook. */
export const TRASH_HINTS = [
  "basura",
  "trash",
  "garbage",
  "recicl",
  "recycle",
  "recycling",
  "compactor",
  "chute",
  "pickup",
  "recoleccion",
];

const RULES_HINTS = ["reglas", "regla de la casa", "silencio", "quiet hours", "fiesta", "ruido", "house rules"];

const EMERGENCY_HINTS = ["fuga", "inundacion", "leak", "flood", "lockout", "cerradura rota", "water leak"];

/** Full-utterance connection checks only — not substring matches. */
const CONNECTION_CHECK_PHRASES = new Set([
  "can you hear me",
  "do you hear me",
  "are you able to hear me",
  "are you there",
  "me escuchas",
  "me puedes escuchar",
  "puedes escucharme",
  "puedes oirme",
  "me oyes",
  "estas ahi",
]);

export function isConnectionCheckUtterance(raw: string): boolean {
  let q = normalizeGuestText(extractGuestUtterance(raw));
  q = q.replace(/^(hello|hi|hey|hola)\s+/, "");
  q = q.replace(/\s+(please|por favor)$/, "");
  return CONNECTION_CHECK_PHRASES.has(q);
}

export function detectGuestIntent(raw: string): GuestIntent {
  const q = normalizeGuestText(extractGuestUtterance(raw));
  const blob = padded(q);

  if (isConnectionCheckUtterance(raw)) return "connection_check";
  if (hasAnyWhole(q, EMERGENCY_HINTS)) return "emergency";
  if (hasAnyWhole(q, PHARMACY_HINTS)) return "pharmacy";
  if (hasAnyWhole(q, HOSPITAL_HINTS)) return "hospital";
  if (hasAnyWhole(q, GAS_HINTS) || q.includes("gas station")) return "gas";
  if (hasAnyWhole(q, GROCERY_HINTS)) return "grocery";
  if (hasAnyWhole(q, RESTAURANT_HINTS) || /\b(restaurant|restaurante)\b/.test(q)) return "restaurant";
  if (hasAnyWhole(q, NEARBY_HINTS)) return "nearby";

  if (hasAnyWhole(q, ACCESS_HINTS) || /\b(wifi|wi-fi|internet).*\b(password|contrasena|clave)\b/.test(q)) {
    if (hasAnyWhole(q, WIFI_HINTS) || q.includes("wifi") || q.includes("wi fi") || q.includes("internet")) return "wifi";
    if (hasAnyWhole(q, DOOR_HINTS) || q.includes("door") || q.includes("puerta")) return "door";
    return "access";
  }

  const wantsDoorClave =
    q.includes("clave") &&
    (q.includes("puerta") || q.includes("entrar") || q.includes("cerradura") || q.includes("acceso"));
  if (wantsDoorClave) return "door";

  if (hasAnyWhole(q, WIFI_HINTS) || blob.includes(" red ")) return "wifi";
  if (hasAnyWhole(q, PARKING_HINTS) || q.includes("estacion")) return "parking";
  if (hasAnyWhole(q, DOOR_HINTS) || q.includes("door code")) return "door";
  if (
    hasAnyWhole(q, CHECKIN_HINTS) ||
    q.includes("check-out") ||
    q.includes("check-in") ||
    q.includes("entrada") ||
    q.includes("salida")
  ) {
    if (q.includes("supermercado") || q.includes("tienda")) return "grocery";
    return "checkin";
  }
  if (hasAnyWhole(q, TRASH_HINTS)) return "trash";
  if (hasAnyWhole(q, RULES_HINTS)) return "rules";
  if (/^(hola|hello|hi|hey|buenas|buenos dias|good morning|good evening)(\s.*)?$/.test(q) && q.split(" ").length <= 4) {
    return "greeting";
  }
  return "open";
}

export function isNearbyPlaceIntent(intent: GuestIntent): intent is NearbyPlaceKind {
  return (
    intent === "pharmacy" ||
    intent === "grocery" ||
    intent === "restaurant" ||
    intent === "hospital" ||
    intent === "gas" ||
    intent === "nearby"
  );
}

export function isAccessSecretIntent(intent: GuestIntent) {
  return intent === "wifi" || intent === "door" || intent === "access";
}

export function containsAccessSecret(text: string) {
  const n = normalizeGuestText(text);
  if (
    /\b(password|passwd|contrasena|wifi password|door code|gate code|lockbox|alarm code|access code|codigo de acceso|codigo de la puerta|clave wifi|clave del wifi)\b/.test(
      n,
    )
  ) {
    return true;
  }
  if (/\b\d{3,6}\s*#/.test(text)) return true;
  return false;
}

export function extractHandbookPassages(handbook: string, needles: string[]) {
  const text = handbook.trim();
  if (!text) return "";
  const parts = text.split(/(?<=[.!?])\s+/);
  const hits = parts.filter((part) => {
    if (containsAccessSecret(part)) return false;
    return needles.some((needle) => hasWholeWord(part, needle));
  });
  return hits.slice(0, 1).join(" ").trim();
}

export function localPlaceHint(property: Property, kind: NearbyPlaceKind, lang: ReplyLang) {
  const city = property.city;
  const place =
    kind === "pharmacy"
      ? lang === "es"
        ? "farmacia"
        : "pharmacy"
      : kind === "grocery"
        ? lang === "es"
          ? "supermercado"
          : "grocery"
        : kind === "restaurant"
          ? lang === "es"
            ? "restaurante"
            : "restaurant"
          : kind === "hospital"
            ? lang === "es"
              ? "hospital o urgencias"
              : "hospital or urgent care"
            : kind === "gas"
              ? lang === "es"
                ? "gasolinera"
                : "gas station"
              : lang === "es"
                ? "sitio cercano"
                : "nearby place";

  if (lang === "es") {
    return `Aun no tengo busqueda en vivo de lugares cercanos para ${place} en ${city}. Abre Maps en ${city} para ver opciones actuales; no puedo nombrar un negocio concreto ni una distancia.`;
  }
  return `I don't have live nearby-place lookup yet for a ${place} in ${city}. Open Maps in ${city} for current options; I can't name a specific business or distance from here.`;
}

export function relevantHandbookSnippet(question: string, handbook: string) {
  const guest = extractGuestUtterance(question);
  const qWords = normalizeGuestText(guest)
    .split(" ")
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
  if (!qWords.length || !handbook.trim()) return "";
  const passage = extractHandbookPassages(handbook, qWords);
  if (!passage || containsAccessSecret(passage)) return "";
  return passage;
}

export function replyLangFor(question: string, mode: LanguageMode): ReplyLang {
  return detectReplyLang(extractGuestUtterance(question), mode);
}

export function accessVerificationReply(lang: ReplyLang) {
  if (lang === "es") {
    return "Puedo compartir claves y contrasenas solo despues de verificar la reserva. Esta llamada de estudio no esta verificada, asi que no puedo dar ese dato.";
  }
  return "I can share access codes and passwords only after your reservation is verified. This studio call isn't verified, so I can't give that value.";
}
