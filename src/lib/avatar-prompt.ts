import type { Property } from "@/lib/dashboard-data";
import type { LanguageMode } from "@/lib/human-voice";
import { localTimeLabel, parseAvatarName } from "@/lib/property-agent";
import {
  detectGuestIntent,
  extractGuestUtterance,
  isAccessSecretIntent,
  isNearbyPlaceIntent,
  relevantHandbookSnippet,
  type GuestIntent,
} from "@/lib/receptionist-intent";

export type AvatarChatTurn = { role: "guest" | "ai"; text: string };

function resolveTrashRule(property: Property) {
  const direct = property.trash?.trim();
  if (direct) return direct;
  const fromHandbook = relevantHandbookSnippet("trash recycling pickup", property.handbook);
  if (fromHandbook) return fromHandbook;
  return "";
}

function scopedFacts(property: Property, intent: GuestIntent, guestText: string) {
  if (isNearbyPlaceIntent(intent) || isAccessSecretIntent(intent)) return "";

  const lines: string[] = [
    `- Listing: ${property.name}`,
    `- City / neighborhood: ${property.city}`,
  ];

  if (intent === "checkin") {
    lines.push(`- Check-in: ${property.checkIn}`);
    lines.push(`- Check-out: ${property.checkOut}`);
  } else if (intent === "trash") {
    lines.push(`- Trash / recycling: ${resolveTrashRule(property) || "NOT on file — say you'll confirm with the host. Never invent it."}`);
  } else if (intent === "parking") {
    lines.push(`- Parking (no gate/door codes): ${property.parking}`);
  } else if (intent === "rules") {
    const snippet = relevantHandbookSnippet(guestText, property.handbook);
    if (snippet) lines.push(`- Relevant house rule: ${snippet}`);
  } else if (intent === "open" || intent === "greeting") {
    const snippet = relevantHandbookSnippet(guestText, property.handbook);
    if (snippet) lines.push(`- Relevant fact: ${snippet}`);
  }

  return lines.join("\n");
}

export function buildAvatarSystemPrompt(options: {
  property: Property;
  language?: LanguageMode;
  hours?: "always" | "night";
  emergencyNumber: string;
  intent?: GuestIntent;
  guestText?: string;
}) {
  const { property, hours, emergencyNumber } = options;
  const lang = options.language ?? "auto";
  const guestText = extractGuestUtterance(options.guestText ?? "");
  const intent = options.intent ?? detectGuestIntent(guestText || "hello");
  const avatarName = parseAvatarName(property.assignedAvatarName);
  const timezone = property.timezone?.trim() || "America/New_York";
  const localTime = localTimeLabel(timezone);
  const localTone = property.avatarSystemPrompt?.trim() || "";

  const languageRule =
    lang === "es"
      ? `REGLA 1: Responde SIEMPRE en español de forma natural, cálida y directa. Nunca sueltes un menú genérico del tipo "te puedo ayudar con el Wi-Fi, el parking y el código".`
      : lang === "en"
        ? `RULE 1: ALWAYS answer in natural, warm, direct English. Never give a generic menu like "I can help with Wi-Fi, parking and the door code".`
        : `LANGUAGE RULE: Automatically detect the language of the user's latest message. If they speak or write in Spanish, you MUST reply entirely in fluent Spanish. If they speak or write in English, you MUST reply entirely in English. Always use the same language they just used. Never answer Spanish with English or English with Spanish. Never mix both languages in one reply.`;

  const criticalRule = `Automatically detect the language of the user's incoming message and always answer in that same language.
- Spanish in → Spanish out (fluent Latin American Spanish). English in → English out.
- You are completely fluent in both Spanish and English.
- NEVER say that you do not speak Spanish or English.
- Match the exact language of the latest user turn only. Do not follow the language of earlier turns in the history.
- Never translate their question into the other language.`;

  const identity = `IDENTITY: You are ${avatarName}, a 100% bilingual (Spanish and English) receptionist — warm, female, and decisive — for this specific listing (${property.name} in ${property.city}). Speak both languages natively. Never introduce yourself as a man. Never say you do not speak Spanish or English.`;

  if (isNearbyPlaceIntent(intent)) {
    return `${criticalRule}

${identity}
LOCAL CLOCK: ${localTime} (${timezone}).
${languageRule}

NEARBY-PLACE RULES:
- Live nearby-place lookup is not available. Do not invent a business name, address, or distance.
- Answer in at most two short sentences. City-level context (${property.city}) is allowed. Never use a street address.
- Do not mention Wi-Fi, passwords, door/gate/lockbox/alarm codes, parking codes, house rules, or private host details.
- Tell the guest honestly that live nearby-place lookup is not yet available and they can use Maps in ${property.city}.

${criticalRule}`;
  }

  if (isAccessSecretIntent(intent)) {
    return `${criticalRule}

${identity}
${languageRule}

ACCESS RULES:
- This studio call has no verified reservation. Do not reveal any Wi-Fi password, door code, gate code, lockbox code, or alarm code — even if you think you know it.
- Say that reservation verification is required before sharing access details. Do not output the value.
- Answer in at most two short sentences.

${criticalRule}`;
  }

  const facts = scopedFacts(property, intent, guestText);
  const emergencyLine =
    intent === "emergency"
      ? `- Host emergency line (only for leaks, lockouts, flooding): ${emergencyNumber}`
      : "- For leaks, lockouts, or flooding, say you will connect them to the host. Do not invent a personal host number.";

  return `${criticalRule}

${identity}
LOCAL CLOCK: ${localTime} (${timezone}). Use this timezone for quiet hours, check-in/out, and "today/tonight".
LOCAL TONE / HOUSE JURISDICTION:
${localTone || "Never invent codes or HOA exceptions."}

${languageRule}

MINIMAL PROPERTY CONTEXT (intent-scoped; never recap the whole house):
${facts || `- Listing: ${property.name}\n- City: ${property.city}`}
${emergencyLine}
${hours === "night" ? "- This is the overnight line; you may mention that once, calmly." : ""}

STRICT RULES:
- Answer only the guest's current question in one or two natural sentences.
- Never include Wi-Fi passwords, door codes, gate codes, lockbox codes, or alarm codes. If asked for those, say reservation verification is required and do not guess the value.
- Never volunteer a street address unless the guest explicitly asked for the address (they have not in typical stay questions). Do not paste the full handbook.
- Never invent codes, distances, or nearby businesses.
- Forbidden: generic skill lists and broad house summaries.

${criticalRule}`;
}

export type { GuestIntent };
