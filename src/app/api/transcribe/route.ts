import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function createOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function whisperFilename(audio: Blob): string {
  if (audio instanceof File && /\.(m4a|mp4|webm|mp3|wav|ogg|aac)$/i.test(audio.name)) {
    return audio.name;
  }
  const t = (audio.type || "").toLowerCase();
  if (t.includes("mp4")) return "audio.mp4";
  if (t.includes("aac") || t.includes("m4a")) return "audio.m4a";
  if (t.includes("mpeg") || t.includes("mp3")) return "audio.mp3";
  if (t.includes("wav")) return "audio.wav";
  if (t.includes("ogg")) return "audio.ogg";
  return "audio.webm";
}

export async function POST(req: NextRequest) {
  try {
    const openai = createOpenAI();
    if (!openai) {
      console.error("[transcribe] missing OPENAI_API_KEY");
      return NextResponse.json({ error: "Falta OPENAI_API_KEY", code: "NO_API_KEY" }, { status: 500 });
    }

    const form = await req.formData();
    const audio = form.get("file") ?? form.get("audio");
    if (!(audio instanceof Blob) || audio.size < 200) {
      console.error("[transcribe] audio required", {
        type: typeof audio,
        size: audio instanceof Blob ? audio.size : 0,
      });
      return NextResponse.json({ error: "audio required", code: "AUDIO_REQUIRED" }, { status: 400 });
    }

    const name =
      audio instanceof File && audio.name ? audio.name : whisperFilename(audio);
    const file = await toFile(audio, name || "recording.mp4");
    const result = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
      temperature: 0,
      prompt: "Guest audio inquiry at vacation rental property in English or Spanish.",
    });
    return NextResponse.json({ text: result.text?.trim() ?? "" });
  } catch (cause) {
    const err = cause as { status?: number; code?: string; message?: string; name?: string };
    const message = cause instanceof Error ? cause.message : "transcribe failed";
    console.error("[transcribe] failed", {
      name: err?.name ?? (cause instanceof Error ? cause.name : typeof cause),
      message,
      code: err?.code,
      status: err?.status,
      cause,
    });
    // OpenAI auth errors: surface a clear, actionable message instead of a generic 502.
    if (err?.status === 401 || err?.code === "invalid_api_key") {
      return NextResponse.json(
        {
          error: "OpenAI rejected the API key (401 invalid_api_key). Update OPENAI_API_KEY in .env.local and restart the dev server.",
          code: "INVALID_OPENAI_KEY",
          status: 401,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: message, code: err?.code ?? "TRANSCRIBE_FAILED", status: err?.status ?? 502 },
      { status: 502 },
    );
  }
}
