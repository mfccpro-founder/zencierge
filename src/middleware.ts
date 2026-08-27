import { type NextRequest, NextResponse } from "next/server";
import { updateAuthSession } from "@/lib/supabase-auth-session";

export async function middleware(request: NextRequest) {
  const { user, supabaseResponse } = await updateAuthSession(request);
  const path = request.nextUrl.pathname;
  const isDashboard = path.startsWith("/dashboard");
  const isAuthPage = path === "/login" || path === "/signup";

  if (isDashboard && !user) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }

  if (isAuthPage && user) {
    const dashboard = request.nextUrl.clone();
    dashboard.pathname = "/dashboard";
    dashboard.search = "";
    return NextResponse.redirect(dashboard);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};
