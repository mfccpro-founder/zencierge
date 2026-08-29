import type { Property } from "@/lib/dashboard-data";
import type { AvatarChatTurn } from "@/lib/avatar-prompt";
import type { LanguageMode, ReplyLang } from "@/lib/human-voice";
import { answerGuestQuestion, type HoursMode } from "@/lib/receptionist-replies";

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
}) {
  // Hard 5s timeout so the guest sees a local rules reply instead of waiting on TTS+LLM.
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
    const response = await fetch("/api/avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        question: options.question,
        language: options.language,
        // Language of the latest guest message only — the server turns this
        // into a SYSTEM OVERRIDE so prior English turns never anchor replies.
        lastUserLang: options.lastUserLang,
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

  return answerGuestQuestion({
    question: options.question,
    properties: options.properties,
    fallback: options.property,
    language: options.lastUserLang ?? options.language,
    hours: options.hours,
    emergencyNumber: options.emergencyNumber,
  });
}
