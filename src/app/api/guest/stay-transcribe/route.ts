import "server-only";

import { NextRequest } from "next/server";
import {
  GUEST_STAY_TRANSCRIBE_MAX_BYTES,
  createGuestStayTranscribeProvider,
  createGuestStayTranscribeRateLimiter,
  guestStayTranscribeProviderConfigured,
  handleGuestStayTranscribe,
} from "@/lib/guest-stay-transcribe";
import {
  createSupabaseStayTokenStore,
  guestStayAdminClient,
  stayJson,
} from "@/lib/guest-stay-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ipLimiter = createGuestStayTranscribeRateLimiter();
const tokenLimiter = createGuestStayTranscribeRateLimiter();
const transcribe = createGuestStayTranscribeProvider();

function clientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "local";
}

export async function POST(request: NextRequest) {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader) {
    const size = Number(lengthHeader);
    if (!Number.isFinite(size) || size > GUEST_STAY_TRANSCRIBE_MAX_BYTES + 64_000) {
      return stayJson({ error: "invalid" }, 400);
    }
  }

  const admin = guestStayAdminClient();
  if (!admin) return stayJson({ error: "unavailable" }, 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return stayJson({ error: "invalid" }, 400);
  }

  const token = form.get("token");
  const audio = form.get("file") ?? form.get("audio");
  if (!(audio instanceof Blob)) {
    return stayJson({ error: "invalid" }, 400);
  }

  let audioBytes: Uint8Array;
  try {
    audioBytes = new Uint8Array(await audio.arrayBuffer());
  } catch {
    return stayJson({ error: "invalid" }, 400);
  }

  try {
    const result = await handleGuestStayTranscribe({
      token,
      audioBytes,
      mimeType: audio.type || null,
      filename: audio instanceof File ? audio.name : null,
      store: createSupabaseStayTokenStore(admin),
      providerReady: guestStayTranscribeProviderConfigured,
      transcribe,
      ipLimiter,
      tokenLimiter,
      ipKey: clientKey(request),
      signal: request.signal,
    });
    if (result.kind === "ok") {
      return stayJson({ transcript: result.transcript }, result.status);
    }
    return stayJson(result.body, result.status);
  } catch {
    return stayJson({ error: "unavailable" }, 503);
  }
}
