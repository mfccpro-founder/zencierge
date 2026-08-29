import type { Property } from "@/lib/dashboard-data";
import { detectReplyLang, type LanguageMode, type ReplyLang } from "@/lib/human-voice";

export type GuestIntent =
  | "emergency"
  | "grocery"
  | "pharmacy"
  | "restaurant"
  | "nearby"
  | "greeting"
  | "wifi"
  | "parking"
  | "door"
  | "checkin"
  | "trash"
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
  "comer",
  "cenar",
  "almorzar",
  "desayunar",
  "dinner",
  "lunch",
  "breakfast",
  "comida",
  "cafe",
  "café",
  "bar",
  "casual",
  "playa",
  "beach",
  "mariscos",
  "seafood",
  "italiano",
  "italian",
  "pizza",
  "pasta",
  "desayuno",
  "brunch",
  "tacos",
];

const NEARBY_HINTS = ["cerca", "cercano", "nearby", "around here", "aqui cerca", "aquí cerca", "walking distance"];

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

export function detectGuestIntent(raw: string): GuestIntent {
  const q = normalizeGuestText(raw);
  const blob = padded(q);

  if (hasAny(q, EMERGENCY_HINTS)) return "emergency";
  if (PHARMACY_HINTS.some((hint) => q.includes(hint))) return "pharmacy";
  if (GROCERY_HINTS.some((hint) => q.includes(hint))) return "grocery";
  if (RESTAURANT_HINTS.some((hint) => q.includes(hint))) return "restaurant";
  if (NEARBY_HINTS.some((hint) => q.includes(hint))) return "nearby";

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
  if (TRASH_HINTS.some((hint) => q.includes(hint))) return "trash";
  if (RULES_HINTS.some((hint) => q.includes(hint))) return "rules";
  if (/^(hola|hello|hi|hey|buenas|buenos dias|good morning|good evening)(\s.*)?$/.test(q) && q.split(" ").length <= 4) {
    return "greeting";
  }
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
  return localPlaceHint(property, "grocery", lang);
}

export function localPlaceHint(
  property: Property,
  kind: "grocery" | "pharmacy" | "restaurant" | "nearby",
  lang: ReplyLang,
) {
  const where = `${property.address}, ${property.city}`;
  if (kind === "pharmacy") {
    return lang === "es"
      ? `Desde ${where} busca un CVS o Walgreens en Maps. En ${property.city} suele haber uno a pocos minutos a pie o en auto corto.`
      : `From ${where}, search Maps for a CVS or Walgreens. In ${property.city} there is usually one a short walk or a few minutes' drive.`;
  }
  if (kind === "restaurant") {
    return lang === "es"
      ? `Estás en ${where}. Abre Maps y busca restaurantes cerca. En ${property.city} hay varias opciones a poca distancia; dime si quieres algo casual, playa o más formal.`
      : `You're at ${where}. Open Maps for restaurants nearby. ${property.city} has plenty within a short walk or drive. Tell me if you want casual, beachy, or nicer.`;
  }
  if (kind === "nearby") {
    return lang === "es"
      ? `La propiedad está en ${where}. Dime si buscas farmacia, supermercado o restaurante y te oriento desde esa dirección.`
      : `The listing is at ${where}. Tell me if you need a pharmacy, grocery, or restaurant and I'll point you from that address.`;
  }
  if (property.city === "Miami Beach" || property.city === "Sunny Isles") {
    return lang === "es"
      ? `Cerca de ${where} lo más práctico es un Publix sobre Collins Ave. Ábrelo en Maps desde esa dirección; suele ser un tramo corto a pie o en auto.`
      : `Near ${where}, Publix on Collins Ave is the practical grocery. Open Maps from that address; it's usually a short walk or drive.`;
  }
  if (property.city === "Brickell") {
    return lang === "es"
      ? `Desde ${where} el Publix de Brickell queda a pocos minutos. Búscalo en Maps; también hay mercados en Brickell City Centre.`
      : `From ${where}, Publix in Brickell is a few minutes away on Maps. Brickell City Centre also has markets.`;
  }
  return lang === "es"
    ? `Desde ${where} busca un Publix o un supermercado en Maps; en Fort Lauderdale suele haber uno a pocos minutos en auto.`
    : `From ${where}, search Maps for Publix or a grocery; in Fort Lauderdale it's usually a short drive.`;
}

export function relevantHandbookSnippet(question: string, handbook: string) {
  const qWords = normalizeGuestText(question)
    .split(" ")
    .filter((word) => word.length >= 4);
  if (!qWords.length || !handbook.trim()) return "";
  return extractHandbookPassages(handbook, qWords);
}

export function replyLangFor(question: string, mode: LanguageMode): ReplyLang {
  return detectReplyLang(question, mode);
}
