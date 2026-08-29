import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { allowDevHostSession, DEV_HOST_COOKIE } from "@/lib/dev-host-session";

export const dynamic = "force-dynamic";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}

export async function POST() {
  if (!allowDevHostSession()) {
    return NextResponse.json({ error: "Local host preview is disabled in production." }, { status: 403 });
  }
  const store = await cookies();
  store.set(DEV_HOST_COOKIE, "1", cookieOptions());
  return NextResponse.json({ ok: true, preview: true });
}

export async function DELETE() {
  const store = await cookies();
  store.set(DEV_HOST_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return NextResponse.json({ ok: true });
}
