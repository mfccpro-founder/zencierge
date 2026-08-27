import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const VOICES = new Set(["nova", "shimmer", "coral", "sage"]);

/** Lazily create the client only when a key exists so the route never throws at module scope (build/collect time). */
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
        { error: "Falta OPENAI_API_KEY en variables de entorno" },
        { status: 500 },
      );
    }

    const body = (await req.json()) as {
      text?: string;
      voice?: string;
      voiceProfile?: string;
    };
    const text = body.text || "Hola, ¿en qué te puedo ayudar?";
    const requested =
      body.voice ?? (body.voiceProfile === "sarah" ? "shimmer" : "nova");
    const voice = VOICES.has(requested) ? requested : "nova";

    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice as "nova" | "shimmer" | "coral" | "sage",
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error al generar audio";
    const isKeyIssue = /api key|credentials|unauthorized|401/i.test(message);
    console.error(
      `[tts] OpenAI TTS falló (${isKeyIssue ? "falta/inválida OPENAI_API_KEY" : "error de red o de la API de OpenAI"}):`,
      message,
      error,
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
