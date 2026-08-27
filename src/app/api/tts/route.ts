import { VOICE_PROFILES, type VoiceProfileId } from "@/lib/human-voice";

type TtsBody = {
  provider?: "elevenlabs" | "openai" | "auto";
  apiKey?: string;
  text?: string;
  voiceProfile?: VoiceProfileId;
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

  const profile =
    VOICE_PROFILES.find((item) => item.id === body.voiceProfile) ?? VOICE_PROFILES[0];
  const elevenKey =
    (body.provider !== "openai" ? body.apiKey?.trim() : "") || process.env.ELEVENLABS_API_KEY || "";
  const openaiKey =
    (body.provider === "openai" ? body.apiKey?.trim() : "") ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_TTS_API_KEY ||
    "";

  const requested = body.provider === "openai" ? "openai" : body.provider === "elevenlabs" ? "elevenlabs" : "auto";

  try {
    const speed = clamp(body.speed ?? 1, 0.85, 1.2);
    const stability = clamp((body.stability ?? 48) / 100, 0.28, 0.62);

    if (requested === "auto") {
      if (elevenKey) {
        try {
          return mpeg(await fetchElevenLabsTts(elevenKey, text, profile.elevenLabsVoiceId, stability));
        } catch (cause) {
          console.error("[tts] ElevenLabs failed in auto mode, trying OpenAI", cause);
        }
      }
      if (openaiKey) {
        try {
          return mpeg(await fetchOpenAiTts(openaiKey, text, profile.openaiVoice, speed));
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
        return mpeg(await fetchOpenAiTts(apiKey, text, profile.openaiVoice, speed));
      } catch (cause) {
        console.error("[tts] OpenAI TTS failed (quota, network, or format)", cause);
        throw cause;
      }
    }

    try {
      return mpeg(await fetchElevenLabsTts(apiKey, text, profile.elevenLabsVoiceId, stability));
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
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function fetchOpenAiTts(apiKey: string, text: string, voice: string, speed: number) {
  const attempts = [
    {
      model: "gpt-4o-mini-tts",
      body: {
        model: "gpt-4o-mini-tts",
        voice,
        input: text,
        response_format: "mp3",
        speed,
      },
    },
    {
      model: "tts-1-hd",
      body: {
        model: "tts-1-hd",
        voice,
        input: text,
        response_format: "mp3",
        speed,
      },
    },
  ];

  for (const attempt of attempts) {
    try {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(attempt.body),
      });
      if (response.ok) return response.arrayBuffer();
      const detail = (await response.text()).slice(0, 400);
      console.error("[tts] OpenAI rejected", {
        model: attempt.model,
        status: response.status,
        detail,
      });
    } catch (cause) {
      console.error("[tts] OpenAI network error", attempt.model, cause);
    }
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
