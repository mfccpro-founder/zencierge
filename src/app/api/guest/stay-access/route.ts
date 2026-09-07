import "server-only";

import { NextRequest } from "next/server";
import {
  createGuestStayAccessRateLimiter,
  createSupabaseStayAccessStore,
  guestStayAccessJson,
  handleGuestStayAccess,
} from "@/lib/guest-stay-access";
import { createSupabaseStayTokenStore, guestStayAdminClient } from "@/lib/guest-stay-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ipLimiter = createGuestStayAccessRateLimiter();
const tokenLimiter = createGuestStayAccessRateLimiter();

function clientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "local";
}

export async function POST(request: NextRequest) {
  const lengthHeader = request.headers.get("content-length");
  const contentLength = lengthHeader ? Number(lengthHeader) : null;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return guestStayAccessJson({ error: "invalid" }, 400);
  }

  const admin = guestStayAdminClient();
  if (!admin) return guestStayAccessJson({ error: "unavailable" }, 503);

  try {
    const result = await handleGuestStayAccess({
      body,
      contentLength,
      ipKey: clientKey(request),
      tokenStore: createSupabaseStayTokenStore(admin),
      accessStore: createSupabaseStayAccessStore(admin),
      ipLimiter,
      tokenLimiter,
    });
    return guestStayAccessJson(result.body, result.status);
  } catch {
    return guestStayAccessJson({ error: "unavailable" }, 503);
  }
}
