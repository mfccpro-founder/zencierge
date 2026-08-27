import { NextRequest, NextResponse } from "next/server";
import { requireHostUser } from "@/lib/supabase-route";
import { parsePlanId } from "@/lib/zencierge-plans";

export async function GET(request: NextRequest) {
  const planId = parsePlanId(request.nextUrl.searchParams.get("plan"));
  const login = new URL("/login", request.url);
  login.searchParams.set("next", "/dashboard");

  const auth = await requireHostUser();
  if (!auth.user) {
    return NextResponse.redirect(login);
  }

  const plan = planId ?? parsePlanId(auth.user.user_metadata?.pending_plan) ?? "starter";
  await auth.supabase.auth.updateUser({
    data: {
      plan,
      pending_plan: null,
      pending_billing: null,
    },
  });

  const dashboard = new URL("/dashboard", request.url);
  dashboard.searchParams.set("checkout", "success");
  dashboard.searchParams.set("plan", plan);
  return NextResponse.redirect(dashboard);
}
