import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  encodePendingHostCookie,
  PENDING_HOST_COOKIE,
  type PendingSignup,
} from "@/lib/pending-signup";
import { parsePlanId } from "@/lib/zencierge-plans";

export const dynamic = "force-dynamic";

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function POST(request: Request) {
  let body: { fullName?: string; email?: string; planId?: string };
  try {
    body = (await request.json()) as { fullName?: string; email?: string; planId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName = body.fullName?.trim() ?? "";
  const email = body.email?.trim() ?? "";
  const planId = parsePlanId(body.planId);
  if (!fullName || !email.includes("@") || !planId) {
    return NextResponse.json({ error: "Name, email, and plan are required" }, { status: 400 });
  }

  const payload: PendingSignup = { fullName, email, planId };
  const store = await cookies();
  store.set(PENDING_HOST_COOKIE, encodePendingHostCookie(payload), cookieOptions(60 * 60 * 24 * 7));
  return NextResponse.json({ ok: true, email, fullName, planId });
}

export async function DELETE() {
  const store = await cookies();
  store.set(PENDING_HOST_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
  return NextResponse.json({ ok: true });
}
