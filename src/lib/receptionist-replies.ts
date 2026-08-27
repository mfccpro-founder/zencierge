import type { Property } from "@/lib/dashboard-data";
import type { LanguageMode, ReplyLang } from "@/lib/human-voice";
import {
  detectGuestIntent,
  groceryFromHandbook,
  localPlaceHint,
  relevantHandbookSnippet,
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

export function answerGuestQuestion({
  question,
  properties: listings,
  fallback,
  language: _language,
  hours = "always",
  emergencyNumber = HOST_EMERGENCY_NUMBER,
}: {
  question: string;
  properties: Property[];
  fallback: Property;
  language: LanguageMode;
  hours?: HoursMode;
  emergencyNumber?: string;
}) {
  const lang: ReplyLang = "es";
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

  if (intent === "restaurant") {
    const passage = relevantHandbookSnippet(question, property.handbook);
    const hint = passage || localPlaceHint(property, "restaurant", lang);
    return `${hint}${night}`;
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
