import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DEV-only sink for mobile MediaRecorder → Blob instrumentation.
 * iPhone events POST here so they appear in the local `npm run dev` terminal.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = { error: "invalid-json" };
  }

  console.info("[guest-mobile-stt]", body);
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
