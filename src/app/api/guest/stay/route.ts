import "server-only";

import { NextRequest } from "next/server";
import {
  createSupabaseStayTokenStore,
  guestStayAdminClient,
  stayJson,
  validateGuestStayToken,
} from "@/lib/guest-stay-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const rateHits = new Map<string, number[]>();

function clientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "local";
}

function rateLimited(key: string) {
  const now = Date.now();
  const recent = (rateHits.get(key) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
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
    const result = await validateGuestStayToken({
      body,
      store: createSupabaseStayTokenStore(admin),
    });
    return stayJson(result.body, result.status);
  } catch {
    return stayJson({ error: "unavailable" }, 503);
  }
}
