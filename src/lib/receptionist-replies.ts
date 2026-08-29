import type { Property, PropertyCity } from "@/lib/dashboard-data";
import type { LanguageMode, ReplyLang } from "@/lib/human-voice";
import {
  detectGuestIntent,
  groceryFromHandbook,
  localPlaceHint,
  normalizeGuestText,
  relevantHandbookSnippet,
  replyLangFor,
} from "@/lib/receptionist-intent";

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
  const lang: ReplyLang = replyLangFor(question, language);
  const property = matchProperty(question, listings, fallback);
  const night = nightNote(hours, lang);
  const name = property.name;
  const intent = detectGuestIntent(question);

  if (intent === "emergency") {
    if (lang === "es") {
      return `Ay, lo siento mucho. Eso sí hay que atenderlo ya. Voy a transferirte con el anfitrión, al ${emergencyNumber}. Por favor, no fuerces la cerradura, ni toques tuberías.${night}`;
    }
    return `I'm really sorry you're dealing with that. I'm connecting you to the host, at ${emergencyNumber}, now. Please don't force the lock, or touch any plumbing.${night}`;
  }

  if (intent === "grocery") {
    const grocery = groceryFromHandbook(property, lang);
    if (lang === "es") return `${grocery}${night}`;
    return `${grocery}${night}`;
  }

  if (intent === "pharmacy") {
    const passage = relevantHandbookSnippet(question, property.handbook);
    const hint = passage || localPlaceHint(property, "pharmacy", lang);
    return `${hint}${night}`;
  }

  const normalizedQuestion = question.trim();
  if (/^\s*(gracias|thank you|thanks|thx)\b/i.test(normalizedQuestion)) {
    return lang === "es"
      ? `De nada, aquí estoy para lo que necesites.${night}`
      : `You're welcome, I'm here whenever you need.${night}`;
  }

  const cue = detectRestaurantCue(normalizedQuestion);
  const isFollowUp = isShortFollowUpQuestion(normalizedQuestion);
  const hasRestaurantCtx = hasRestaurantContext(history);
  if (cue || (isFollowUp && hasRestaurantCtx)) {
    const priorCue = detectRestaurantCue(lastAssistantContent(history));
    return `${restaurantRecommendationReply(property, cue ?? priorCue ?? "casual", lang)}${night}`;
  }
  if (isFollowUp) {
    return lang === "es"
      ? `¿Sobre qué seguimos? Dime "restaurante", "playa", "casual", "italiano", "mariscos" o "desayuno", o pregunta por el Wi-Fi, el estacionamiento o el código de la puerta. Dime cuál de ellas y te ayudo enseguida.${night}`
      : `What would you like next? Say "restaurant", "beach", "casual", "italian", "seafood", or "breakfast", or ask about Wi-Fi, parking, or the door code, and I'll help right away.${night}`;
  }

  if (intent === "restaurant") {
    const cue = detectRestaurantCue(question);
    return `${restaurantRecommendationReply(property, cue ?? "casual", lang)}${night}`;
  }

  if (intent === "nearby") {
    return `${localPlaceHint(property, "nearby", lang)}${night}`;
  }

  if (intent === "greeting") {
    if (lang === "es") {
      return `Hola. Soy Elena, tu conserje en ${name}, ${property.address}, ${property.city}. Dime qué necesitas.${night}`;
    }
    return `Hi. I'm Elena, your concierge at ${name}, ${property.address}, ${property.city}. What do you need?${night}`;
  }

  if (intent === "wifi") {
    if (lang === "es") {
      return `Claro. En ${name}, la red Wi-Fi es ${property.wifiNetwork}. Y la contraseña es ${property.wifiPassword}.${night}`;
    }
    return `Sure. At ${name}, the Wi-Fi network is ${property.wifiNetwork}. And the password is ${property.wifiPassword}.${night}`;
  }

  if (intent === "parking") {
    const gate =
      property.gateCode && property.gateCode !== "—"
        ? lang === "es"
          ? ` El código del portón es ${property.gateCode}.`
          : ` The gate code is ${property.gateCode}.`
        : "";
    if (lang === "es") return `En ${name}, el estacionamiento es: ${property.parking}.${gate}${night}`;
    return `At ${name}, parking is: ${property.parking}.${gate}${night}`;
  }

  if (intent === "door") {
    if (lang === "es") {
      return `El código de acceso de ${name} es ${property.doorCode}. Es ${property.smartlock}.${night}`;
    }
    return `The access code for ${name} is ${property.doorCode}. That's the ${property.smartlock}.${night}`;
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
    const snippet = relevantHandbookSnippet(question, property.handbook);
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
    const snippet =
      relevantHandbookSnippet(question, property.handbook) ||
      relevantHandbookSnippet("quiet hours silencio reglas", property.handbook);
    if (lang === "es") {
      return snippet
        ? `Sobre las reglas de ${name}. ${snippet}${night}`
        : `Si me dices si es ruido, basura o visitas, te leo la regla del handbook.${night}`;
    }
    return snippet
      ? `House rules at ${name}. ${snippet}${night}`
      : `Tell me if it's noise, trash, or guests and I'll read the handbook rule.${night}`;
  }

  const snippet = relevantHandbookSnippet(question, property.handbook);
  if (snippet) {
    if (lang === "es") {
      return `Esto es lo más cercano en el handbook de ${name}. ${snippet}${night}`;
    }
    return `Here's the closest match in the ${name} handbook. ${snippet}${night}`;
  }

  if (lang === "es") {
    return `No tengo ese detalle exacto en el handbook de ${name}. Estás en ${property.address}, ${property.city}. Dime qué buscas — por ejemplo una farmacia, un súper o un restaurante — y te oriento desde ahí.${night}`;
  }
  return `I don't have that exact note in the ${name} handbook. You're at ${property.address}, ${property.city}. Tell me what you need — a pharmacy, grocery, or restaurant — and I'll point you from there.${night}`;
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

function restaurantRecommendationReply(property: Property, cue: RestaurantCue, lang: ReplyLang): string {
  const zone = RESTAURANT_RECS[property.city] ?? RESTAURANT_RECS["Miami Beach"];
  const pick = zone[cue];
  const esHead = {
    casual: "para algo casual de la zona",
    beach: "para comer frente a la playa",
    seafood: "para mariscos",
    italian: "para italiano",
    breakfast: "para desayuno",
  }[cue];
  const enHead = {
    casual: "for something casual nearby",
    beach: "for beachfront dining",
    seafood: "for seafood",
    italian: "for Italian",
    breakfast: "for breakfast",
  }[cue];
  if (lang === "es") {
    return `Claro, ${esHead}: ${pick.es} Si prefieres otra casual, dime "casual", "playa", "italiano", "mariscos" o "desayuno".`;
  }
  return `Sure, ${enHead}: ${pick.en} If you'd like a different feel, say "casual", "beach", "italian", "seafood", or "breakfast".`;
}

type RestaurantPick = { es: string; en: string };

/** Concrete local picks per property zone (casual + beachfront/oceanfront splits). */
const RESTAURANT_RECS: Record<PropertyCity, Record<RestaurantCue, RestaurantPick>> = {
  "Miami Beach": {
    casual: { es: "La Sandwicherie (sándwiches 24 h) y Bodega Taquería (tacos) están a unas cuadras por Collins y Ocean.", en: "La Sandwicherie (24h sandwiches) and Bodega Taquería (tacos) are a few blocks away by Collins and Ocean." },
    beach: { es: "The Clevelander en Ocean Drive tiene mesas casi sobre la arena; Nikki Beach es lounge frente al mar.", en: "The Clevelander on Ocean Drive has tables by the sand; Nikki Beach is an oceanfront lounge." },
    seafood: { es: "Joe's Stone Crab en Washington Ave es el clásico de mariscos; reserva con tiempo su cangrejo de piedra.", en: "Joe's Stone Crab on Washington Ave is the seafood classic; book ahead for its stone crab." },
    italian: { es: "Macaluso's en Ocean Drive sirve pizza y pasta italiana a pasos de la playa.", en: "Macaluso's on Ocean Drive serves Italian pizza and pasta steps from the beach." },
    breakfast: { es: "Front Porch Café en Ocean & 14th es el desayuno clásico: huevos y pancakes desde temprano.", en: "Front Porch Café at Ocean & 14th is the classic breakfast: eggs and pancakes from early." },
  },
  Brickell: {
    casual: { es: "Los tacos mexicanos y las cazuelas de Brickell City Centre son casuales y quedan muy cerca.", en: "Mexican tacos and small plates at Brickell City Centre are casual and close." },
    beach: { es: "No hay playa caminando en Brickell, pero los restaurantes del río Miami tienen terraza con vista a los yates.", en: "No walkable beach in Brickell, but the Miami River spots have yacht-view terraces." },
    seafood: { es: "El ceviche y los mariscos peruanos de CVI.CHE quedan cerca del centro financiero.", en: "CVI.CHE does Peruvian ceviche and seafood by the financial district." },
    italian: { es: "Pasta y pizza italiana en las trattorias de Brickell City Centre; opciones ítalo-japonesas cerca del río.", en: "Fresh pasta and pizza at Brickell City Centre's Italian trattorias, or Italo-Japanese fusion near the river." },
    breakfast: { es: "Pura Vida en Brickell es el desayuno práctico: bowls, café y sándwiches.", en: "Pura Vida in Brickell is the practical breakfast: bowls, coffee, and sandwiches." },
  },
  "Fort Lauderdale": {
    casual: { es: "Tacos y brunch casual en Las Olas son la opción local cerca de la playa.", en: "Tacos and casual brunch on Las Olas are the local pick by the beach." },
    beach: { es: "Casablanca Café on the Beach está directamente sobre la arena en Fort Lauderdale Beach.", en: "Casablanca Café on the Beach sits right on the sand at Fort Lauderdale Beach." },
    seafood: { es: "Coconuts, sobre el Intracoastal, es el clásico de mariscos y pescado fresco.", en: "Coconuts, on the Intracoastal, is the seafood-and-fresh-fish classic." },
    italian: { es: "Louie Bossi en Las Olas hace pasta fresca y pizza, con terraza.", en: "Louie Bossi on Las Olas does fresh pasta and pizza on a terrace." },
    breakfast: { es: "The Floridian en Las Olas desayuna todo el día — un clásico local.", en: "The Floridian on Las Olas serves breakfast all day — a local classic." },
  },
  "Sunny Isles": {
    casual: { es: "En Collins Ave hay pizzerías y cafés casuales muy cerca de la playa.", en: "Collins Ave has casual pizzerias and cafés right by the beach." },
    beach: { es: "Los restaurantes de los hoteles de Collins Ave tienen terraza frente al mar; pide mesa con vista.", en: "Collins Ave hotel restaurants have oceanfront terraces — ask for a view." },
    seafood: { es: "La barra de mariscos frente al mar en el Beach House Hotel es buena para pescado fresco.", en: "The oceanfront seafood bar at the Beach House Hotel is good for fresh fish." },
    italian: { es: "Trattorias italian en Collins Ave con pizza napolitana a pasos de la arena.", en: "Collins Ave Italian trattorias dish up Neapolitan pizza steps from the sand." },
    breakfast: { es: "Los buffets de desayuno de los hoteles de playa son la opción clásica frente al mar.", en: "The beach hotels' breakfast buffets are the classic oceanfront pick." },
  },
};
