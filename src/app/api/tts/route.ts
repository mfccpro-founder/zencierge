import { NextRequest, NextResponse } from "next/server";
import { recordAiUsageEvent, safeRecordAiUsageEvent } from "@/lib/ai-usage";
import { requireHostAuthContext } from "@/lib/supabase-route";
import {
  AdvancedAudioTtsError,
  OPENAI_STREAM_TTS_MODEL,
  hostTtsInputText,
  streamElenaSpeech,
} from "@/lib/tts-synthesize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function optionalHostUserId(): Promise<string | null> {
  try {
    const auth = await requireHostAuthContext();
    const id = auth.user?.id?.trim() ?? "";
    return UUID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "TTS API online",
    defaultEngine: "openai-tts-stream",
    defaultVoice: "coral",
    model: OPENAI_STREAM_TTS_MODEL,
    format: "pcm-24kHz-s16le-mono",
    note: "POST streams PCM as it is generated. The browser plays chunks immediately.",
  });
}

export async function POST(req: NextRequest) {
  let inputCharacters = 0;
  const hostId = await optionalHostUserId();

  try {
    const body = (await req.json()) as {
      text?: string;
      voice?: string;
      voiceProfile?: string;
      speed?: number;
      language?: string;
      provider?: "auto" | "elevenlabs" | "openai" | "openai-audio";
      apiKey?: string;
    };

    const rawText = body.text || "Hi, I'm Elena. How can I help you today?";
    const text = hostTtsInputText(rawText);
    inputCharacters = text.length;
    const requested =
      body.voice ?? (body.voiceProfile === "sarah" || body.voiceProfile === "austin" ? "shimmer" : "coral");

    const result = await streamElenaSpeech({
      text,
      voice: requested,
      language: body.language === "es" || body.language === "en" ? body.language : "auto",
      speed: body.speed,
      openaiApiKey: body.provider === "elevenlabs" ? undefined : body.apiKey?.trim(),
    });

    await safeRecordAiUsageEvent(recordAiUsageEvent, {
      host_id: hostId,
      property_id: null,
      reservation_id: null,
      source: "host_tts",
      provider: "openai",
      model: result.model,
      operation: "tts",
      status: "success",
      input_characters: inputCharacters,
      calculated_cost_cents: null,
    });

    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        "X-Reply-Language": result.language,
        "X-Tts-Voice": result.voice,
        "X-Tts-Engine": result.engine,
        "X-Tts-Model": result.model,
        "X-Tts-Stream": "1",
        "X-Tts-Sample-Rate": String(result.sampleRate),
      },
    });
  } catch (error: unknown) {
    const advanced = error instanceof AdvancedAudioTtsError ? error : null;
    const message = error instanceof Error ? error.message : "Could not generate speech audio";
    const isKeyIssue = /api key|credentials|unauthorized|401|missing-key|OPENAI_API_KEY/i.test(message);
    console.error(
      `[tts] Streaming TTS failed (${isKeyIssue ? "missing or invalid API key" : "provider error"}):`,
      message,
    );

    await safeRecordAiUsageEvent(recordAiUsageEvent, {
      host_id: hostId,
      property_id: null,
      reservation_id: null,
      source: "host_tts",
      provider: "openai",
      model: OPENAI_STREAM_TTS_MODEL,
      operation: "tts",
      status: "failed",
      input_characters: inputCharacters > 0 ? inputCharacters : null,
      calculated_cost_cents: null,
    });

    return NextResponse.json(
      {
        error: message,
        code: advanced?.code ?? "ADVANCED_AUDIO_FAILED",
        engine: null,
        voice: advanced?.voice ?? "coral",
        attempted: advanced?.attempted ?? [OPENAI_STREAM_TTS_MODEL],
        stream: false,
      },
      { status: isKeyIssue ? 503 : 502 },
    );
  }
}
