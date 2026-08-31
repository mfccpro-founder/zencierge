import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICES = new Set(["nova", "shimmer", "coral", "sage", "marin", "ballad"]);

/** Warm concierge delivery for gpt-4o-mini-tts (ignored by tts-1 / tts-1-hd). */
const HOSPITALITY_VOICE_INSTRUCTIONS =
  "Speak as Elena, a warm boutique-stay concierge. Sound conversational and human, with a slight smile and natural ups and downs in pitch. Unhurried but not slow. Friendly hospitality energy — never robotic, monotone, clipped, or overly formal. Pause briefly at commas. If the text is Spanish, speak clear, friendly Latin American Spanish in the same warm tone.";

function createOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

export async function GET() {
  return NextResponse.json({ status: "ok", message: "TTS API online" });
}

export async function POST(req: NextRequest) {
  try {
    const openai = createOpenAI();
    if (!openai) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing in environment variables" },
        { status: 500 },
      );
    }

    const body = (await req.json()) as {
      text?: string;
      voice?: string;
      voiceProfile?: string;
      speed?: number;
      language?: string;
    };
    const text = (body.text || "Hi, I'm Elena. How can I help you today?").slice(0, 4096);
    const requested =
      body.voice ?? (body.voiceProfile === "sarah" || body.voiceProfile === "austin" ? "shimmer" : "coral");
    const voice = VOICES.has(requested) ? requested : "coral";
    const speed = Number.isFinite(body.speed)
      ? Math.min(Math.max(body.speed as number, 0.75), 1.15)
      : 0.96;
    const language = body.language === "es" ? "es" : "en";

    const mp3 = await synthesizeSpeech(openai, { text, voice, speed });
    const buffer = Buffer.from(await mp3.arrayBuffer());

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
        "X-Reply-Language": language,
        "X-Tts-Voice": voice,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not generate speech audio";
    const isKeyIssue = /api key|credentials|unauthorized|401/i.test(message);
    console.error(
      `[tts] OpenAI TTS failed (${isKeyIssue ? "missing or invalid OPENAI_API_KEY" : "network or OpenAI API error"}):`,
      message,
      error,
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function synthesizeSpeech(
  openai: OpenAI,
  input: { text: string; voice: string; speed: number },
) {
  try {
    return await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: input.voice,
      input: input.text,
      speed: input.speed,
      instructions: HOSPITALITY_VOICE_INSTRUCTIONS,
      response_format: "mp3",
    });
  } catch (cause) {
    console.warn("[tts] gpt-4o-mini-tts unavailable, falling back to tts-1-hd", cause);
    return openai.audio.speech.create({
      model: "tts-1-hd",
      voice: input.voice,
      input: input.text,
      speed: input.speed,
      response_format: "mp3",
    });
  }
}
