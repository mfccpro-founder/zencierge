import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Temporary DEV-only sink for guest STT instrumentation.
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

  // eslint-disable-next-line no-console -- temporary DEV STT probe only
  console.info("[guest-listen-debug]", body);
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
