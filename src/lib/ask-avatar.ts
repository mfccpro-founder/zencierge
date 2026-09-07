import type { Property } from "@/lib/dashboard-data";
import type { AvatarChatTurn } from "@/lib/avatar-prompt";
import { detectUtteranceLang, type LanguageMode, type ReplyLang } from "@/lib/human-voice";
import {
  detectGuestIntent,
  extractGuestUtterance,
  isAccessSecretIntent,
  isNearbyPlaceIntent,
  type NearbyPlaceKind,
} from "@/lib/receptionist-intent";
import { answerGuestQuestion, connectionCheckReply, type HoursMode } from "@/lib/receptionist-replies";
import { publicApiUrl } from "@/lib/public-app-url";
import { formatHostGuideSpeech, type LocalGuidePublicResult } from "@/lib/local-guide-shared";

export type ConciergeLiveResult = {
  name: string;
  mapsUri: string;
};

export type ConciergeReply = {
  displayText: string;
  spokenText: string;
  source: "assistant" | "host" | "google" | "fallback";
  hostResults?: LocalGuidePublicResult[];
  liveResults?: ConciergeLiveResult[];
};

export type { LocalGuidePublicResult };

export const GOOGLE_NEARBY_SPOKEN = {
  en: "I found nearby options and displayed them on your screen.",
  es: "Encontré opciones cercanas y las puse en tu pantalla.",
} as const;

export function conciergeSpokenText(reply: ConciergeReply) {
  return reply.spokenText;
}

export function asConciergeReply(text: string, source: ConciergeReply["source"] = "assistant"): ConciergeReply {
  const trimmed = text.trim();
  return { displayText: trimmed, spokenText: trimmed, source };
}

async function fetchNearbyBundle(input: {
  propertyId: string;
  kind: NearbyPlaceKind;
  language: ReplyLang;
  signal?: AbortSignal;
}): Promise<
  | { source: "host"; hostResults: LocalGuidePublicResult[] }
  | { source: "google"; liveResults: ConciergeLiveResult[] }
  | null
> {
  try {
    const response = await fetch(publicApiUrl("/api/places/nearby"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: input.signal,
      body: JSON.stringify({
        propertyId: input.propertyId,
        kind: input.kind,
        language: input.language,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      source?: string;
      hostResults?: LocalGuidePublicResult[];
      results?: Array<{ name?: string; mapsUri?: string }>;
    };
    if (data.source === "host" && Array.isArray(data.hostResults) && data.hostResults.length) {
      const hostResults = data.hostResults.slice(0, 3).flatMap((row) => {
        const businessName = typeof row?.businessName === "string" ? row.businessName.trim() : "";
        if (!businessName) return [];
        return [
          {
            ...row,
            businessName,
            source: "host" as const,
            websiteOrMapsLink: typeof row.websiteOrMapsLink === "string" ? row.websiteOrMapsLink : "",
          },
        ];
      });
      if (hostResults.length) return { source: "host", hostResults };
    }
    const rows = Array.isArray(data.results) ? data.results : [];
    const liveResults: ConciergeLiveResult[] = [];
    for (const row of rows) {
      const name = typeof row?.name === "string" ? row.name.trim().slice(0, 80) : "";
      const mapsUri = typeof row?.mapsUri === "string" ? row.mapsUri.trim() : "";
      if (!name || !mapsUri.startsWith("https://")) continue;
      liveResults.push({ name, mapsUri: mapsUri.slice(0, 500) });
      if (liveResults.length >= 3) break;
    }
    if (liveResults.length) return { source: "google", liveResults };
    return null;
  } catch {
    return null;
  }
}

export async function askAvatarReply(options: {
  question: string;
  property: Property;
  properties: Property[];
  language: LanguageMode;
  lastUserLang?: ReplyLang;
  hours?: HoursMode;
  emergencyNumber?: string;
  openaiKey?: string;
  history?: AvatarChatTurn[];
  signal?: AbortSignal;
}): Promise<ConciergeReply> {
  const guestText = extractGuestUtterance(options.question);
  const intent = detectGuestIntent(guestText);
  const replyLang: ReplyLang =
    options.lastUserLang === "es" || options.lastUserLang === "en"
      ? options.lastUserLang
      : guestText
        ? detectUtteranceLang(guestText)
        : "en";

  if (intent === "connection_check") {
    const spokenLang = guestText ? detectUtteranceLang(guestText) : replyLang;
    return asConciergeReply(connectionCheckReply(spokenLang), "assistant");
  }

  if (isNearbyPlaceIntent(intent)) {
    const nearby = await fetchNearbyBundle({
      propertyId: options.property.id,
      kind: intent,
      language: replyLang,
      signal: options.signal,
    });
    if (nearby?.source === "host") {
      const spoken = formatHostGuideSpeech(nearby.hostResults, replyLang);
      if (spoken) {
        return {
          displayText: spoken,
          spokenText: spoken,
          source: "host",
          hostResults: nearby.hostResults,
        };
      }
    }
    if (nearby?.source === "google") {
      const spoken = GOOGLE_NEARBY_SPOKEN[replyLang];
      return {
        displayText: spoken,
        spokenText: spoken,
        source: "google",
        liveResults: nearby.liveResults,
      };
    }
    return asConciergeReply(
      answerGuestQuestion({
        question: guestText,
        properties: options.properties,
        fallback: options.property,
        language: options.lastUserLang ?? options.language,
        hours: options.hours,
        emergencyNumber: options.emergencyNumber,
      }),
      "fallback",
    );
  }

  if (isAccessSecretIntent(intent)) {
    return asConciergeReply(
      answerGuestQuestion({
        question: guestText,
        properties: options.properties,
        fallback: options.property,
        language: options.lastUserLang ?? options.language,
        hours: options.hours,
        emergencyNumber: options.emergencyNumber,
      }),
    );
  }

  const TIMEOUT_MS = 5000;
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort);

  try {
    const response = await fetch(publicApiUrl("/api/avatar"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        question: guestText,
        language: options.language,
        lastUserLang: options.lastUserLang,
        hours: options.hours,
        emergencyNumber: options.emergencyNumber,
        openaiKey: options.openaiKey || undefined,
        history: options.history ?? [],
        property: options.property,
        propertyId: options.property.id,
      }),
    });
    if (response.ok) {
      const data = (await response.json()) as { reply?: string };
      if (data.reply?.trim()) return asConciergeReply(data.reply.trim());
    }
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    if (timedOut) {
      console.error("[avatar] LLM timed out after 10s, using local rules reply");
    } else {
      console.error("[avatar] client request failed, using local reply", cause);
    }
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }

  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  return asConciergeReply(
    answerGuestQuestion({
      question: guestText,
      properties: options.properties,
      fallback: options.property,
      language: options.lastUserLang ?? options.language,
      hours: options.hours,
      emergencyNumber: options.emergencyNumber,
    }),
  );
}
