import { FEMALE_ELEVENLABS_VOICE_ID, FEMALE_OPENAI_VOICE } from "@/lib/human-voice";

type TtsBody = {
  provider?: "elevenlabs" | "openai" | "auto";
  apiKey?: string;
  text?: string;
  voice?: string;
  voiceProfile?: string;
  speed?: number;
  stability?: number;
};

export async function POST(request: Request) {
  let body: TtsBody;
  try {
    body = (await request.json()) as TtsBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = body.text?.trim() ?? "";
  if (!text || text.length > 4000) {
    return Response.json({ error: "Text is required" }, { status: 400 });
  }

  const elevenKey =
    (body.provider !== "openai" ? body.apiKey?.trim() : "") || process.env.ELEVENLABS_API_KEY || "";
  const openaiKey =
    (body.provider === "openai" ? body.apiKey?.trim() : "") ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_TTS_API_KEY ||
    "";

  const requested =
    body.voice === "nova"
      ? "openai"
      : body.provider === "openai"
        ? "openai"
        : body.provider === "elevenlabs"
          ? "elevenlabs"
          : "auto";

  try {
    const stability = clamp((body.stability ?? 48) / 100, 0.28, 0.62);
    const openaiVoice =
      body.voice === "alloy" ? FEMALE_OPENAI_VOICE : body.voice === "nova" ? "nova" : FEMALE_OPENAI_VOICE;
    const elevenVoiceId = FEMALE_ELEVENLABS_VOICE_ID;

    if (requested === "auto") {
      if (elevenKey) {
        try {
          return mpeg(await fetchElevenLabsTts(elevenKey, text, elevenVoiceId, stability));
        } catch (cause) {
          console.error("[tts] ElevenLabs failed in auto mode, trying OpenAI", cause);
        }
      }
      if (openaiKey) {
        try {
          return mpeg(await fetchOpenAiTts(openaiKey, text, openaiVoice));
        } catch (cause) {
          console.error("[tts] OpenAI failed in auto mode (quota, network, or format)", cause);
        }
      }
      return Response.json({ error: "Studio TTS unavailable" }, { status: 502 });
    }

    const apiKey = requested === "openai" ? openaiKey : elevenKey;
    if (!apiKey) {
      return Response.json({ error: "Missing API key" }, { status: 401 });
    }

    if (requested === "openai") {
      try {
        return mpeg(await fetchOpenAiTts(apiKey, text, openaiVoice));
      } catch (cause) {
        console.error("[tts] OpenAI TTS failed (quota, network, or format)", cause);
        throw cause;
      }
    }

    try {
      return mpeg(await fetchElevenLabsTts(apiKey, text, elevenVoiceId, stability));
    } catch (cause) {
      console.error("[tts] ElevenLabs TTS failed", cause);
      throw cause;
    }
  } catch (cause) {
    console.error("[tts] Studio TTS failed", cause);
    return Response.json({ error: "Studio TTS failed" }, { status: 502 });
  }
}

function mpeg(audio: ArrayBuffer) {
  return new Response(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.byteLength),
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes",
    },
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function fetchOpenAiTts(apiKey: string, text: string, voice: typeof FEMALE_OPENAI_VOICE) {
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1-hd",
        voice,
        input: text,
        response_format: "mp3",
        speed: 1,
      }),
    });
    if (response.ok) return response.arrayBuffer();
    const detail = (await response.text()).slice(0, 400);
    console.error("[tts] OpenAI rejected", {
      model: "tts-1-hd",
      voice,
      status: response.status,
      detail,
    });
  } catch (cause) {
    console.error("[tts] OpenAI network error", "tts-1-hd", cause);
  }

  throw new Error("OpenAI TTS failed");
}

async function fetchElevenLabsTts(apiKey: string, text: string, voiceId: string, stability: number) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability,
          similarity_boost: 0.72,
          style: 0.42,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    console.error("[tts] ElevenLabs rejected", { status: response.status, detail });
    throw new Error("ElevenLabs TTS failed");
  }

  return response.arrayBuffer();
}
