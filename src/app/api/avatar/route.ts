import type { Property } from "@/lib/dashboard-data";
import { buildAvatarSystemPrompt, type AvatarChatTurn } from "@/lib/avatar-prompt";
import type { LanguageMode, ReplyLang } from "@/lib/human-voice";

type AvatarBody = {
  question?: string;
  language?: LanguageMode;
  lastUserLang?: ReplyLang;
  hours?: "always" | "night";
  emergencyNumber?: string;
  openaiKey?: string;
  history?: AvatarChatTurn[];
  property?: Property;
};

export async function POST(request: Request) {
  let body: AvatarBody;
  try {
    body = (await request.json()) as AvatarBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const question = body.question?.trim() ?? "";
  const property = body.property;
  if (!question || !property?.name || !property.city) {
    return Response.json({ error: "question and property are required" }, { status: 400 });
  }

  const emergencyNumber = body.emergencyNumber?.trim() || "+1 (954) 275-3544";
  const system = buildAvatarSystemPrompt({
    property,
    language: body.language ?? "auto",
    hours: body.hours,
    emergencyNumber,
  });

  // The client may prefix the question with mirror instructions — extract the
  // raw guest text so the LLM receives a clean message plus an explicit
  // language flag (never a rigid language template).
  const guestText = extractGuestText(question);
  const forcedLang = body.language === "es" || body.language === "en" ? body.language : null;
  // Priority: forced mode > client's per-utterance detection > server detection.
  // This is the language of the LATEST message only, never the session's.
  const guestLang = forcedLang ?? body.lastUserLang ?? detectGuestLang(guestText);
  // SYSTEM OVERRIDE as the first directive of the message: breaks the history
  // inertia that kept Elena replying in English after an English first turn.
  const langOverride =
    guestLang === "es"
      ? "[SYSTEM OVERRIDE: The user's current message is in SPANISH. You MUST respond 100% in Spanish. Do NOT use English. Never say you do not speak Spanish.]"
      : "[SYSTEM OVERRIDE: The user's current message is in ENGLISH. You MUST respond 100% in English. Do NOT use Spanish.]";
  const userContent = `${langOverride}\n\nGuest: ${guestText}`;

  const openaiKey = body.openaiKey?.trim() || process.env.OPENAI_API_KEY || process.env.OPENAI_TTS_API_KEY || "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY || "";

  try {
    if (anthropicKey) {
      try {
        const reply = await fetchClaudeReply(anthropicKey, system, userContent, body.history ?? []);
        return Response.json({ reply, engine: "claude" });
      } catch (cause) {
        console.error("[avatar] Claude failed, trying OpenAI", cause);
      }
    }
    if (openaiKey) {
      const reply = await fetchOpenAiReply(openaiKey, system, userContent, body.history ?? []);
      return Response.json({ reply, engine: "openai" });
    }
    return Response.json({ error: "No LLM key" }, { status: 401 });
  } catch (cause) {
    console.error("[avatar] LLM failed", cause);
    return Response.json({ error: "Avatar LLM failed" }, { status: 502 });
  }
}

/** Strips any client-side mirror instruction so only the guest text reaches the LLM. */
function extractGuestText(question: string) {
  const marker = "\n\nGuest: ";
  const idx = question.lastIndexOf(marker);
  if (idx !== -1) return question.slice(idx + marker.length).trim();
  const guestIdx = question.indexOf("Guest: ");
  if (guestIdx !== -1) return question.slice(guestIdx + 7).trim();
  return question.trim();
}

/** Spanish is the base language: English needs clear keyword evidence. */
function detectGuestLang(text: string): "es" | "en" {
  const t = text.toLowerCase();
  const hasSpanishMarks = /[áéíóúüñ¿¡]/.test(text);
  const esHits =
    t.match(
      /\b(el|la|los|las|un|una|unos|unas|y|o|de|del|qué|que|dónde|donde|cómo|como|está|están|hola|gracias|necesito|quiero|cerca|restaurante|comida|cenar|almorzar|desayuno|ayuda|puedo|favor|baño|clave|hay|para|con|por|playa|buenas|días|noches|tarde|cuál|tengo|soy|estoy|buscando)\b/g,
    )?.length ?? 0;
  const enHits =
    t.match(
      /\b(i|i'm|im|you|we|the|a|an|is|are|was|need|want|where|what|how|hello|hi|hey|please|thanks|thank|restaurant|near|nearby|close|recommend|wifi|password|door|code|help|can|could|would|my|me|looking|food|eat|hungry|dinner|lunch|breakfast|pharmacy|store|beach|check-in|checkout|towels|pool|parking|tonight|good)\b/g,
    )?.length ?? 0;
  if (hasSpanishMarks || esHits > 0) return "es";
  if (enHits > 0) return "en";
  return "es";
}

function chatTurns(history: AvatarChatTurn[]) {
  return history.slice(-8).flatMap((turn) => {
    const content = turn.text.trim();
    if (!content) return [];
    return [{ role: turn.role === "guest" ? ("user" as const) : ("assistant" as const), content }];
  });
}

async function fetchOpenAiReply(
  apiKey: string,
  system: string,
  question: string,
  history: AvatarChatTurn[],
) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.45,
      max_tokens: 280,
      messages: [
        { role: "system", content: system },
        ...chatTurns(history),
        // question already carries the explicit language flag + guest text.
        { role: "user", content: question },
      ],
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    console.error("[avatar] OpenAI chat rejected", response.status, detail);
    throw new Error("OpenAI chat failed");
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const reply = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!reply) throw new Error("Empty OpenAI reply");
  return reply;
}

async function fetchClaudeReply(
  apiKey: string,
  system: string,
  question: string,
  history: AvatarChatTurn[],
) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 280,
      temperature: 0.45,
      system,
      messages: [
        ...chatTurns(history),
        // question already carries the explicit language flag + guest text.
        { role: "user", content: question },
      ],
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    console.error("[avatar] Claude rejected", response.status, detail);
    throw new Error("Claude failed");
  }
  const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
  const reply = data.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join(" ").trim() ?? "";
  if (!reply) throw new Error("Empty Claude reply");
  return reply;
}
