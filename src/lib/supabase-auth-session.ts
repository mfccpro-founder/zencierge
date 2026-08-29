import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnvIssue } from "@/lib/supabase-config";
import { hasDevHostCookie, mockDevHostUser } from "@/lib/dev-host-session";
import { hostUserFromPending, parsePendingHostCookie, PENDING_HOST_COOKIE } from "@/lib/pending-signup";

export async function updateAuthSession(request: NextRequest) {
  const supabaseResponse = NextResponse.next({ request });

  const pending = parsePendingHostCookie(request.cookies.get(PENDING_HOST_COOKIE)?.value);
  if (pending) {
    return { user: hostUserFromPending(pending), supabaseResponse };
  }

  if (hasDevHostCookie(request.cookies)) {
    return { user: mockDevHostUser(), supabaseResponse };
  }

  if (supabaseEnvIssue()) {
    return { user: null, supabaseResponse };
  }

  try {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    return { user, supabaseResponse };
  } catch {
    return { user: null, supabaseResponse };
  }
}
