import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase-route";
import { SUPABASE_URL, supabaseEnvIssue } from "@/lib/supabase-config";
import {
  buildTrialMetadata,
  isPaidSubscriptionStatus,
  isTrialWindowOpen,
  parsePlanId,
} from "@/lib/zencierge-plans";

export const dynamic = "force-dynamic";

function projectRef() {
  try {
    return new URL(SUPABASE_URL).hostname.replace(/\.supabase\.co$/i, "");
  } catch {
    return "invalid";
  }
}

export async function POST(request: Request) {
  if (supabaseEnvIssue()) {
    return NextResponse.json({ error: "Supabase Auth is unavailable." }, { status: 503 });
  }

  let body: { email?: unknown; password?: unknown; planId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const requestedPlan = typeof body.planId === "string" ? parsePlanId(body.planId) : null;
  if (process.env.NODE_ENV === "development") {
    console.info("[auth:password-login] request", {
      projectRef: projectRef(),
      emailPresent: email.length > 0,
      emailLength: email.length,
      passwordPresent: password.length > 0,
      passwordLength: password.length,
      requestedPlanValid: requestedPlan !== null,
    });
  }
  if (!email.includes("@") || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const supabase = await createSupabaseRouteClient();
  let authResult: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
  try {
    authResult = await supabase.auth.signInWithPassword({ email, password });
  } catch (cause) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[auth:password-login] transport-failure", {
        projectRef: projectRef(),
        errorType: cause instanceof Error ? cause.name : "unknown",
      });
    }
    return NextResponse.json(
      { error: "Authentication service could not be reached.", code: "auth_transport_error" },
      { status: 502 },
    );
  }
  const { data, error } = authResult;
  if (error) {
    const authError = error as { code?: unknown; name?: unknown; status?: unknown };
    const code = typeof authError.code === "string" ? authError.code : "unknown";
    const status = typeof authError.status === "number" ? authError.status : 0;
    if (process.env.NODE_ENV === "development") {
      console.warn("[auth:password-login] rejected", {
        projectRef: projectRef(),
        code,
        status,
        errorType: typeof authError.name === "string" ? authError.name : "unknown",
      });
    }
    if (code === "invalid_credentials") {
      return NextResponse.json({ error: "Invalid email or password.", code: "invalid_credentials" }, { status: 401 });
    }
    if (code === "email_not_confirmed") {
      return NextResponse.json(
        { error: "Email confirmation is required.", code: "email_not_confirmed" },
        { status: 403 },
      );
    }
    const responseStatus = status === 429 ? 429 : status === 0 ? 502 : 400;
    return NextResponse.json(
      {
        error: status === 429
          ? "Too many authentication attempts. Try again later."
          : "Authentication service rejected the request.",
        code: status === 429 ? "auth_rate_limited" : "auth_service_error",
      },
      { status: responseStatus },
    );
  }
  if (!data.user || !data.session) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[auth:password-login] incomplete", { projectRef: projectRef() });
    }
    return NextResponse.json(
      { error: "Authentication succeeded without establishing a session.", code: "session_missing" },
      { status: 502 },
    );
  }

  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const paid = isPaidSubscriptionStatus(String(meta.subscription_status ?? ""));
  if (!paid && !isTrialWindowOpen(meta.trial_ends_at) && !meta.trial_ends_at) {
    await supabase.auth.updateUser({
      data: buildTrialMetadata(parsePlanId(meta.plan) ?? requestedPlan ?? "pro", {
        full_name: meta.full_name,
        first_name: meta.first_name,
      }),
    });
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
