import type { Property } from "@/lib/dashboard-data";
import type { LanguageMode, ReplyLang } from "@/lib/human-voice";
import {
  accessVerificationReply,
  detectGuestIntent,
  extractGuestUtterance,
  isAccessSecretIntent,
  isNearbyPlaceIntent,
  localPlaceHint,
  normalizeGuestText,
  relevantHandbookSnippet,
  replyLangFor,
  type NearbyPlaceKind,
} from "@/lib/receptionist-intent";

export const CONNECTION_CHECK_REPLY = {
  en: "Yes, I can hear you. How can I help?",
  es: "Sí, puedo escucharte. ¿Cómo puedo ayudarte?",
} as const;

export function connectionCheckReply(lang: ReplyLang) {
  return lang === "es" ? CONNECTION_CHECK_REPLY.es : CONNECTION_CHECK_REPLY.en;
}

export type HoursMode = "always" | "night";

export const HOST_EMERGENCY_NUMBER = "+1 (954) 275-3544";

function matchProperty(question: string, listings: Property[], fallback: Property): Property {
  const lower = question.toLowerCase();
  const hit = listings.find(
    (property) =>
      lower.includes(property.name.toLowerCase()) ||
      lower.includes(property.city.toLowerCase()) ||
      (property.city === "Miami Beach" && lower.includes("miami")) ||
      (property.city === "Fort Lauderdale" &&
        (lower.includes("lauderdale") || lower.includes("fort lauderdale"))),
  );
  return hit ?? fallback;
}

function nightNote(hours: HoursMode, lang: ReplyLang) {
  if (hours !== "night") return "";
  return lang === "es"
    ? " Por cierto, estás en la línea nocturna. Aquí estoy, con calma, a cualquier hora."
    : " And just so you know, this is the overnight line. I'm here, unhurried, whenever you need me.";
}

export type RestaurantCue = "casual" | "beach" | "seafood" | "italian" | "breakfast";

export type ChatHistoryTurn = { role: "user" | "assistant"; content: string };

/**
 * Short follow-up reply ("si", "no", "casual", "playa", "italiano", ...) that
 * needs prior-context (short-term) memory to answer meaningfully.
 */
export function isShortFollowUpQuestion(question: string): boolean {
  const q = normalizeGuestText(question);
  if (!q) return false;
  const words = q.split(" ").filter(Boolean);
  if (words.length > 5) return false;
  const followUps = [
    "casual", "relajado", "playa", "beach", "italiano", "italian", "mariscos", "seafood",
    "desayuno", "breakfast", "si", "sí", "no", "yes", "ok", "dale", "listo", "mas", "más",
    "otro", "otros", "cuenta", "cuentame", "suena", "perfecto",
  ];
  return words.some((word) => followUps.includes(word)) || q === "si" || q === "no";
}

/** Most recent assistant reply — the topic being discussed — for short-memory follow-ups. */
export function lastAssistantContent(history: ChatHistoryTurn[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === "assistant") return history[index].content;
  }
  return "";
}

export function answerGuestQuestion({
  question,
  properties: listings,
  fallback,
  language,
  hours = "always",
  emergencyNumber = HOST_EMERGENCY_NUMBER,
  history = [],
}: {
  question: string;
  properties: Property[];
  fallback: Property;
  language: LanguageMode;
  hours?: HoursMode;
  emergencyNumber?: string;
  history?: ChatHistoryTurn[];
}) {
  const guestText = extractGuestUtterance(question);
  const lang: ReplyLang = replyLangFor(guestText, language);
  const property = matchProperty(guestText, listings, fallback);
  const night = nightNote(hours, lang);
  const name = property.name;
  const agent = property.assignedAvatarName?.trim() || "Elena";
  const intent = detectGuestIntent(guestText);

  if (intent === "connection_check") {
    return connectionCheckReply(lang);
  }

  if (isNearbyPlaceIntent(intent)) {
    return `${localPlaceHint(property, intent as NearbyPlaceKind, lang)}${night}`;
  }

  if (isAccessSecretIntent(intent)) {
    return `${accessVerificationReply(lang)}${night}`;
  }

  if (intent === "emergency") {
    if (lang === "es") {
      return `Ay, lo siento mucho. Eso sí hay que atenderlo ya. Voy a transferirte con el anfitrión, al ${emergencyNumber}. Por favor, no fuerces la cerradura, ni toques tuberías.${night}`;
    }
    return `I'm really sorry you're dealing with that. I'm connecting you to the host, at ${emergencyNumber}, now. Please don't force the lock, or touch any plumbing.${night}`;
  }

  const normalizedQuestion = guestText.trim();
  if (/^\s*(gracias|thank you|thanks|thx)\b/i.test(normalizedQuestion)) {
    return lang === "es"
      ? `De nada, aquí estoy para lo que necesites.${night}`
      : `You're welcome, I'm here whenever you need.${night}`;
  }

  const cue = detectRestaurantCue(normalizedQuestion);
  const isFollowUp = isShortFollowUpQuestion(normalizedQuestion);
  const hasRestaurantCtx = hasRestaurantContext(history);
  if (cue || (isFollowUp && hasRestaurantCtx)) {
    return `${localPlaceHint(property, "restaurant", lang)}${night}`;
  }
  if (isFollowUp) {
    return lang === "es"
      ? `Claro. ¿Qué detalle quieres que confirme?${night}`
      : `Of course. What detail would you like me to confirm?${night}`;
  }

  if (intent === "greeting") {
    const ongoingConversation = history.some((turn) => turn.content.trim().length > 0);
    if (lang === "es") {
      return ongoingConversation
        ? `Hola de nuevo. ¿Cómo te ayudo?${night}`
        : `Hola. Soy ${agent}, tu conserje en ${name}. ¿Cómo te ayudo?${night}`;
    }
    return ongoingConversation
      ? `Hi again. How can I help?${night}`
      : `Hi. I'm ${agent}, your concierge at ${name}. How can I help?${night}`;
  }

  if (intent === "parking") {
    if (lang === "es") return `En ${name}, el estacionamiento es: ${property.parking}.${night}`;
    return `At ${name}, parking is: ${property.parking}.${night}`;
  }

  if (intent === "checkin") {
    if (lang === "es") {
      return `En ${name}, el check-in es ${property.checkIn}. Y el check-out, ${property.checkOut}.${night}`;
    }
    return `At ${name}, check-in is ${property.checkIn}. And check-out, ${property.checkOut}.${night}`;
  }

  if (intent === "trash") {
    const trash = property.trash.trim();
    if (trash) {
      if (lang === "es") return `Sobre la basura en ${name}: ${trash}.${night}`;
      return `For trash at ${name}: ${trash}.${night}`;
    }
    const snippet = relevantHandbookSnippet(guestText, property.handbook);
    if (snippet) {
      if (lang === "es") return `Sobre la basura en ${name}. ${snippet}${night}`;
      return `About trash at ${name}. ${snippet}${night}`;
    }
    if (lang === "es") {
      return `No tengo el día de recogida en el handbook de ${name}. Pregunto al anfitrión y te confirmo.${night}`;
    }
    return `I don't have the pickup day in the ${name} handbook. I'll check with the host and confirm.${night}`;
  }

  if (intent === "rules") {
    const snippet = relevantHandbookSnippet(guestText, property.handbook);
    if (lang === "es") {
      return snippet
        ? `Sobre las reglas de ${name}. ${snippet}${night}`
        : `Si me dices si es ruido, basura o visitas, te leo la regla del handbook.${night}`;
    }
    return snippet
      ? `House rules at ${name}. ${snippet}${night}`
      : `Tell me if it's noise, trash, or guests and I'll read the handbook rule.${night}`;
  }

  const snippet = relevantHandbookSnippet(guestText, property.handbook);
  if (snippet) {
    if (lang === "es") {
      return `Esto es lo más cercano en el handbook de ${name}. ${snippet}${night}`;
    }
    return `Here's the closest match in the ${name} handbook. ${snippet}${night}`;
  }

  if (lang === "es") {
    return `No tengo ese detalle exacto para ${name}. Dime qué necesitas y lo confirmo con el anfitrión.${night}`;
  }
  return `I don't have that exact detail for ${name}. Tell me what you need and I'll confirm it with the host.${night}`;
}

function detectRestaurantCue(question: string): RestaurantCue | undefined {
  const q = normalizeGuestText(question);
  if (/\b(desayuno|desayunar|breakfast|brunch|pancakes?|huevos|eggs)\b/.test(q)) return "breakfast";
  if (/\b(playa|beach|frente al mar|oceanfront|vista al mar|\bmar\b)/.test(q)) return "beach";
  if (/\b(mariscos|seafood|pescado|ceviche|cangrejo|crab|langosta|lobster|shrimp)\b/.test(q)) return "seafood";
  if (/\b(italiano|italian|pizza|pasta|trattoria|napolitano)\b/.test(q)) return "italian";
  if (/\b(casual|relajado|informal|tacos|burger|hamburguesa|comida|rapido|sencillo)\b/.test(q)) return "casual";
  return undefined;
}

function hasRestaurantContext(history: ChatHistoryTurn[]): boolean {
  const prior = lastAssistantContent(history);
  if (!prior) return false;
  return /\b(restaurante|restaurant)\b/i.test(prior) || Boolean(detectRestaurantCue(prior));
}
