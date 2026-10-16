import { type NextRequest, NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/admin-auth";
import { updateAuthSession } from "@/lib/supabase-auth-session";
import {
  privatePilotBlockedPath,
  privatePilotHostAuthorized,
  privatePilotSafeMode,
} from "@/lib/private-pilot-safety";
import { privatePilotDemoAccessGranted } from "@/lib/private-pilot-entitlement";

function staysOnPublicSurface(path: string) {
  return (
    path === "/" ||
    path === "/signup" ||
    path.startsWith("/api/checkout") ||
    path.startsWith("/api/payments/square") ||
    path.startsWith("/guest") ||
    path.startsWith("/housekeeping") ||
    path.startsWith("/verify")
  );
}

function safeNextPath(value: string | null) {
  if (!value) return "/dashboard";
  if (
    value.startsWith("/admin") ||
    value.startsWith("/backoffice") ||
    value.startsWith("/dashboard")
  ) {
    return value;
  }
  return "/dashboard";
}

function redirectWithAuthCookies(url: URL, authResponse: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of authResponse.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (privatePilotSafeMode() && privatePilotBlockedPath(path)) {
    return NextResponse.json(
      { error: "Unavailable in the private pilot environment" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Guest pages are public. Skip Supabase auth here so a hung getUser()
  // cannot freeze /guest/[id] on mobile or through a tunnel.
  if (path.startsWith("/guest") || path.startsWith("/housekeeping")) {
    const response = NextResponse.next({ request });
    if (path.startsWith("/guest") || path.startsWith("/housekeeping/p")) {
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
    }
    return response;
  }

  const { user, supabase, supabaseResponse } = await updateAuthSession(request);

  // Landing and Square checkout must never be sent to /dashboard.
  if (staysOnPublicSurface(path)) {
    return supabaseResponse;
  }

  const isFounderSurface = path.startsWith("/admin") || path.startsWith("/backoffice");
  const isHostApp = path.startsWith("/dashboard") || isFounderSurface;
  const isAuthPage = path === "/login";

  if (isHostApp && !user) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", path);
    return redirectWithAuthCookies(login, supabaseResponse);
  }

  if (isHostApp && user && !privatePilotHostAuthorized(user.id)) {
    return NextResponse.json(
      { error: "This account is not authorized for the private pilot" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (isHostApp && user && privatePilotSafeMode()) {
    if (!supabase) {
      return NextResponse.json(
        { error: "Private demo entitlement could not be verified" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const { data: subscription, error } = await supabase
      .from("host_subscriptions")
      .select("plan_id, complimentary_ends_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: "Private demo entitlement could not be verified" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!privatePilotDemoAccessGranted({
      planId: subscription?.plan_id,
      complimentaryEndsAt: subscription?.complimentary_ends_at,
    })) {
      return NextResponse.json(
        { error: "Private demo access has ended" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  if (isFounderSurface && user && !isSuperAdmin(user)) {
    const hostHome = request.nextUrl.clone();
    hostHome.pathname = "/dashboard";
    hostHome.search = "";
    return redirectWithAuthCookies(hostHome, supabaseResponse);
  }

  if (isAuthPage && user) {
    const dest = request.nextUrl.clone();
    dest.pathname = safeNextPath(request.nextUrl.searchParams.get("next"));
    dest.search = "";
    return redirectWithAuthCookies(dest, supabaseResponse);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/",
    "/api/checkout",
    "/api/checkout/:path*",
    "/api/payments/square/:path*",
    "/guest",
    "/guest/:path*",
    "/housekeeping",
    "/housekeeping/:path*",
    "/api/housekeeping/reports",
    "/api/housekeeping/upload",
    "/verify/:path*",
    "/dashboard/:path*",
    "/admin",
    "/admin/:path*",
    "/backoffice",
    "/backoffice/:path*",
    "/login",
    "/signup",
    "/api/dev/stripe-sandbox/:path*",
    "/api/webhooks/square",
    "/api/webhooks/subscriptions",
    "/api/inbound",
    "/api/auth/pending-host",
    "/api/auth/dev-session",
    "/api/admin/:path*",
    "/api/backoffice/:path*",
    "/api/finance/:path*",
    "/centro",
  ],
};
