import type { Property } from "@/lib/dashboard-data";
import type { AvatarChatTurn } from "@/lib/avatar-prompt";
import type { LanguageMode } from "@/lib/human-voice";
import { answerGuestQuestion, type HoursMode } from "@/lib/receptionist-replies";

export async function askAvatarReply(options: {
  question: string;
  property: Property;
  properties: Property[];
  language: LanguageMode;
  hours?: HoursMode;
  emergencyNumber?: string;
  openaiKey?: string;
  history?: AvatarChatTurn[];
  signal?: AbortSignal;
}) {
  try {
    const response = await fetch("/api/avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: options.signal,
      body: JSON.stringify({
        question: options.question,
        language: "es",
        hours: options.hours,
        emergencyNumber: options.emergencyNumber,
        openaiKey: options.openaiKey || undefined,
        history: options.history ?? [],
        property: options.property,
      }),
    });
    if (response.ok) {
      const data = (await response.json()) as { reply?: string };
      if (data.reply?.trim()) return data.reply.trim();
    }
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    console.error("[avatar] client request failed, using local reply", cause);
  }

  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  return answerGuestQuestion({
    question: options.question,
    properties: options.properties,
    fallback: options.property,
    language: options.language,
    hours: options.hours,
    emergencyNumber: options.emergencyNumber,
  });
}
