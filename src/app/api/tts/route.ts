import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

const VOICES = new Set(["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"]);

export async function GET() {
  return NextResponse.json({ status: "ok", message: "TTS API online" });
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Falta OPENAI_API_KEY en variables de entorno" },
        { status: 500 },
      );
    }

    const body = (await req.json()) as { text?: string; voice?: string };
    const text = body.text || "Hola, ¿en qué te puedo ayudar?";
    const voice = VOICES.has(body.voice ?? "") ? body.voice! : "nova";

    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice,
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error al generar audio";
    console.error("Error en /api/tts:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
