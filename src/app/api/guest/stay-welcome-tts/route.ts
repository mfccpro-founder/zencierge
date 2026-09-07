import "server-only";

import { NextRequest } from "next/server";
import { lookupPropertyHostIdForUsage, recordAiUsageEvent } from "@/lib/ai-usage";
import {
  GUEST_STAY_WELCOME_TTS_MAX_BODY_BYTES,
  GUEST_STAY_WELCOME_TTS_RATE_MAX,
  GUEST_STAY_WELCOME_TTS_RATE_WINDOW_MS,
  createGuestStayWelcomeTtsRateLimiter,
  createGuestStayWelcomeTtsSynthesize,
  guestStayWelcomeTtsHttpResponse,
  guestStayWelcomeTtsProviderConfigured,
  handleGuestStayWelcomeTts,
} from "@/lib/guest-stay-welcome";
import {
  createSupabaseStayTokenStore,
  guestStayAdminClient,
  stayJson,
} from "@/lib/guest-stay-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ipLimiter = createGuestStayWelcomeTtsRateLimiter(
  GUEST_STAY_WELCOME_TTS_RATE_MAX,
  GUEST_STAY_WELCOME_TTS_RATE_WINDOW_MS,
);
const tokenLimiter = createGuestStayWelcomeTtsRateLimiter(
  GUEST_STAY_WELCOME_TTS_RATE_MAX,
  GUEST_STAY_WELCOME_TTS_RATE_WINDOW_MS,
);
const synthesize = createGuestStayWelcomeTtsSynthesize();

function clientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "local";
}

export async function POST(request: NextRequest) {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader) {
    const size = Number(lengthHeader);
    if (!Number.isFinite(size) || size > GUEST_STAY_WELCOME_TTS_MAX_BODY_BYTES) {
      return stayJson({ error: "invalid" }, 400);
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return stayJson({ error: "invalid" }, 400);
  }

  const admin = guestStayAdminClient();
  if (!admin) return stayJson({ error: "unavailable" }, 503);

  try {
    const result = await handleGuestStayWelcomeTts({
      body,
      contentLength: lengthHeader ? Number(lengthHeader) : null,
      ipKey: clientKey(request),
      store: createSupabaseStayTokenStore(admin),
      ipLimiter,
      tokenLimiter,
      providerReady: guestStayWelcomeTtsProviderConfigured,
      synthesize,
      recordUsage: recordAiUsageEvent,
      resolveHostId: (propertyId) => lookupPropertyHostIdForUsage(admin, propertyId),
    });
    return guestStayWelcomeTtsHttpResponse(result);
  } catch {
    return stayJson({ error: "unavailable" }, 503);
  }
}
