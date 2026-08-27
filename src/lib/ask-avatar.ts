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
}) {
  try {
    const response = await fetch("/api/avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: options.question,
        language: options.language,
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
    console.error("[avatar] client request failed, using local reply", cause);
  }

  return answerGuestQuestion({
    question: options.question,
    properties: options.properties,
    fallback: options.property,
    language: options.language,
    hours: options.hours,
    emergencyNumber: options.emergencyNumber,
  });
}
