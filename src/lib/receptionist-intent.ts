import type { Property } from "@/lib/dashboard-data";
import type { LanguageMode, ReplyLang } from "@/lib/human-voice";

export type GuestIntent =
  | "emergency"
  | "grocery"
  | "wifi"
  | "parking"
  | "door"
  | "checkin"
  | "rules"
  | "open";

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

function padded(text: string) {
  return ` ${text} `;
}

function hasAny(haystack: string, needles: string[]) {
  const hay = normalizeGuestText(haystack);
  return needles.some((needle) => hay.includes(normalizeGuestText(needle)));
}

const GROCERY_HINTS = [
  "supermercado",
  "supermarket",
  "grocery",
  "groceries",
  "publix",
  "tienda",
  "tiendas",
  "comprar",
  "compras",
  "comida",
  "alimentos",
  "whole foods",
  "trader joe",
  "market",
];

const WIFI_HINTS = [
  "wifi",
  "wi-fi",
  "wi fi",
  "internet",
  "contrasena",
  "password",
  "clave de internet",
  "clave wifi",
  "clave del wifi",
  "nombre de red",
  "network",
];

const DOOR_HINTS = [
  "codigo de la puerta",
  "codigo puerta",
  "door code",
  "smartlock",
  "keypad",
  "cerradura",
  "entrar",
  "acceso",
  "llave",
  "puerta",
  "codigo",
];

const PARKING_HINTS = ["estacionamiento", "estacionar", "parking", "parquear", "aparcar", "garage", "porton", "gate code"];

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

const RULES_HINTS = ["reglas", "regla de la casa", "silencio", "quiet hours", "fiesta", "ruido", "basura", "house rules"];

const EMERGENCY_HINTS = ["fuga", "inundacion", "leak", "flood", "lockout", "cerradura rota", "water leak"];

export function detectGuestIntent(raw: string): GuestIntent {
  const q = normalizeGuestText(raw);
  const blob = padded(q);

  if (hasAny(q, EMERGENCY_HINTS)) return "emergency";
  if (GROCERY_HINTS.some((hint) => q.includes(hint))) return "grocery";

  const wantsDoorClave =
    q.includes("clave") && (q.includes("puerta") || q.includes("entrar") || q.includes("cerradura") || q.includes("acceso"));
  if (wantsDoorClave) return "door";

  if (WIFI_HINTS.some((hint) => q.includes(hint)) || blob.includes(" red ") || q.includes("clave")) return "wifi";
  if (PARKING_HINTS.some((hint) => q.includes(hint)) || q.includes("estacion")) return "parking";
  if (DOOR_HINTS.some((hint) => q.includes(hint))) return "door";
  if (CHECKIN_HINTS.some((hint) => q.includes(hint)) || q.includes("entrada") || q.includes("salida")) {
    if (q.includes("supermercado") || q.includes("tienda")) return "grocery";
    return "checkin";
  }
  if (RULES_HINTS.some((hint) => q.includes(hint))) return "rules";
  return "open";
}

export function extractHandbookPassages(handbook: string, needles: string[]) {
  const text = handbook.trim();
  if (!text) return "";
  const parts = text.split(/(?<=[.!?])\s+/);
  const hits = parts.filter((part) => {
    const n = normalizeGuestText(part);
    return needles.some((needle) => n.includes(normalizeGuestText(needle)));
  });
  return hits.join(" ").trim();
}

const GROCERY_HANDBOOK_NEEDLES = [
  "grocery",
  "publix",
  "supermarket",
  "tienda",
  "collins",
  "walk",
  "camin",
  "store",
  "market",
  "food",
  "minuto",
];

export function groceryFromHandbook(property: Property, lang: ReplyLang) {
  const passage = extractHandbookPassages(property.handbook, GROCERY_HANDBOOK_NEEDLES);
  if (passage) return passage;
  if (lang === "es") {
    return "El supermercado más cercano es Publix, ubicado a 3 minutos caminando por Collins Ave.";
  }
  return "The nearest grocery is Publix, a 3-minute walk on Collins Ave.";
}

export function relevantHandbookSnippet(question: string, handbook: string) {
  const qWords = normalizeGuestText(question)
    .split(" ")
    .filter((word) => word.length >= 4);
  if (!qWords.length || !handbook.trim()) return "";
  return extractHandbookPassages(handbook, qWords);
}

export function replyLangFor(question: string, mode: LanguageMode): ReplyLang {
  if (mode === "en") return "en";
  if (mode === "es") return "es";
  const q = normalizeGuestText(question);
  if (
    /[¿¡]/.test(question) ||
    /\b(cual|donde|estaciono|clave|puerta|gracias|bano|fuga|hola|ayuda|supermercado|tienda|comida)\b/.test(q)
  ) {
    return "es";
  }
  return "en";
}
