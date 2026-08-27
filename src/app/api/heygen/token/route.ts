import {
  HEYGEN_FEMALE_AVATAR_ID,
  HEYGEN_FEMALE_VOICE_ID,
  HEYGEN_LANGUAGE,
} from "@/lib/heygen-config";

export async function POST() {
  const apiKey = process.env.HEYGEN_API_KEY?.trim() || process.env.HEYGEN_ACCESS_TOKEN?.trim() || "";
  if (!apiKey) {
    return Response.json({ error: "HEYGEN_API_KEY missing" }, { status: 401 });
  }

  const response = await fetch("https://api.heygen.com/v1/streaming.create_token", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    data?: { token?: string };
    token?: string;
    error?: string;
  };

  const token = payload.data?.token || payload.token;
  if (!response.ok || !token) {
    console.error("[heygen] create_token failed", response.status, payload);
    return Response.json({ error: "HeyGen token failed" }, { status: 502 });
  }

  return Response.json({
    token,
    language: HEYGEN_LANGUAGE,
    avatarName: process.env.HEYGEN_AVATAR_ID?.trim() || HEYGEN_FEMALE_AVATAR_ID,
    voice: {
      voice_id: process.env.HEYGEN_VOICE_ID?.trim() || HEYGEN_FEMALE_VOICE_ID,
      rate: 1.0,
    },
  });
}
