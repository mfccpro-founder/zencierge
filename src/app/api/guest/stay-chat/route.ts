import "server-only";

import { NextRequest } from "next/server";
import {
  GUEST_STAY_CHAT_MAX_BODY_BYTES,
  GUEST_STAY_CHAT_RATE_MAX,
  GUEST_STAY_CHAT_RATE_WINDOW_MS,
  handleGuestStayChat,
} from "@/lib/guest-stay-chat";
import {
  createSupabaseStayTokenStore,
  guestStayAdminClient,
  stayJson,
} from "@/lib/guest-stay-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateHits = new Map<string, number[]>();

function clientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "local";
}

function rateLimited(key: string) {
  const now = Date.now();
  const recent = (rateHits.get(key) ?? []).filter((at) => now - at < GUEST_STAY_CHAT_RATE_WINDOW_MS);
  if (recent.length >= GUEST_STAY_CHAT_RATE_MAX) {
    rateHits.set(key, recent);
    return true;
  }
  recent.push(now);
  rateHits.set(key, recent);
  if (rateHits.size > 500) {
    const oldest = rateHits.keys().next().value;
    if (oldest) rateHits.delete(oldest);
  }
  return false;
}

export async function POST(request: NextRequest) {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader) {
    const size = Number(lengthHeader);
    if (!Number.isFinite(size) || size > GUEST_STAY_CHAT_MAX_BODY_BYTES) {
      return stayJson({ error: "invalid" }, 400);
    }
  }

  if (rateLimited(clientKey(request))) {
    return stayJson({ error: "unavailable" }, 429);
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
    const result = await handleGuestStayChat({
      body,
      store: createSupabaseStayTokenStore(admin),
    });
    return stayJson(result.body, result.status);
  } catch {
    return stayJson({ error: "unavailable" }, 503);
  }
}
