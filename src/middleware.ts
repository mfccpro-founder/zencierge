import { type NextRequest, NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/admin-auth";
import { updateAuthSession } from "@/lib/supabase-auth-session";

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

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

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

  const { user, supabaseResponse } = await updateAuthSession(request);

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
    return NextResponse.redirect(login);
  }

  if (isFounderSurface && user && !isSuperAdmin(user)) {
    const hostHome = request.nextUrl.clone();
    hostHome.pathname = "/dashboard";
    hostHome.search = "";
    return NextResponse.redirect(hostHome);
  }

  if (isAuthPage && user) {
    const dest = request.nextUrl.clone();
    dest.pathname = safeNextPath(request.nextUrl.searchParams.get("next"));
    dest.search = "";
    return NextResponse.redirect(dest);
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
    "/verify/:path*",
    "/dashboard/:path*",
    "/admin",
    "/admin/:path*",
    "/backoffice",
    "/backoffice/:path*",
    "/login",
    "/signup",
  ],
};
