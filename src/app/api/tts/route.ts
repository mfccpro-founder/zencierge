import { VOICE_PROFILES, type VoiceProfileId } from "@/lib/human-voice";

type TtsBody = {
  provider?: "elevenlabs" | "openai";
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
  const provider = body.provider === "openai" ? "openai" : "elevenlabs";
  const apiKey =
    body.apiKey?.trim() ||
    (provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ELEVENLABS_API_KEY) ||
    "";

  if (!apiKey) {
    return Response.json({ error: "Missing API key" }, { status: 401 });
  }

  const speed = clamp(body.speed ?? 1.05, 0.9, 1.3);
  const stability = clamp((body.stability ?? 70) / 100, 0.2, 0.9);

  try {
    if (provider === "openai") {
      const audio = await fetchOpenAiTts(apiKey, text, profile.openaiVoice, speed);
      return new Response(audio, {
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
      });
    }

    const audio = await fetchElevenLabsTts(
      apiKey,
      text,
      profile.elevenLabsVoiceId,
      stability,
    );
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Studio TTS failed" }, { status: 502 });
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function fetchOpenAiTts(
  apiKey: string,
  text: string,
  voice: string,
  speed: number,
) {
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
      speed,
    }),
  });

  if (!response.ok) {
    throw new Error("OpenAI TTS failed");
  }

  return response.arrayBuffer();
}

async function fetchElevenLabsTts(
  apiKey: string,
  text: string,
  voiceId: string,
  stability: number,
) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
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
          similarity_boost: 0.78,
          style: 0.32,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error("ElevenLabs TTS failed");
  }

  return response.arrayBuffer();
}
