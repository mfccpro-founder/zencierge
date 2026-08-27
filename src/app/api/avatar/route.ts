import type { Property } from "@/lib/dashboard-data";
import { buildAvatarSystemPrompt, type AvatarChatTurn } from "@/lib/avatar-prompt";
import type { LanguageMode } from "@/lib/human-voice";

type AvatarBody = {
  question?: string;
  language?: LanguageMode;
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

  const openaiKey = body.openaiKey?.trim() || process.env.OPENAI_API_KEY || process.env.OPENAI_TTS_API_KEY || "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY || "";

  try {
    if (anthropicKey) {
      try {
        const reply = await fetchClaudeReply(anthropicKey, system, question, body.history ?? []);
        return Response.json({ reply, engine: "claude" });
      } catch (cause) {
        console.error("[avatar] Claude failed, trying OpenAI", cause);
      }
    }
    if (openaiKey) {
      const reply = await fetchOpenAiReply(openaiKey, system, question, body.history ?? []);
      return Response.json({ reply, engine: "openai" });
    }
    return Response.json({ error: "No LLM key" }, { status: 401 });
  } catch (cause) {
    console.error("[avatar] LLM failed", cause);
    return Response.json({ error: "Avatar LLM failed" }, { status: 502 });
  }
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
        { role: "user", content: `Responde en español, de forma directa, a esto:\n${question}` },
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
        { role: "user", content: `Responde en español, de forma directa, a esto:\n${question}` },
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
