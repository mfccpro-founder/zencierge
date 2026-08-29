import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnvIssue } from "@/lib/supabase-config";
import { hasDevHostCookie, mockDevHostUser } from "@/lib/dev-host-session";
import { hostUserFromPending, parsePendingHostCookie, PENDING_HOST_COOKIE } from "@/lib/pending-signup";

export async function createSupabaseRouteClient() {
  const cookieStore = await cookies();
  return createServerClient(
    supabaseEnvIssue() ? "https://placeholder.supabase.co" : SUPABASE_URL,
    supabaseEnvIssue() ? "placeholder-anon-key" : SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Route handlers may run in a context where cookies are read-only.
          }
        },
      },
    },
  );
}

export async function requireHostUser() {
  const cookieStore = await cookies();
  const pending = parsePendingHostCookie(cookieStore.get(PENDING_HOST_COOKIE)?.value);
  if (pending) {
    const supabase = await createSupabaseRouteClient();
    return { user: hostUserFromPending(pending), supabase, error: null };
  }
  if (hasDevHostCookie(cookieStore)) {
    const supabase = await createSupabaseRouteClient();
    return { user: mockDevHostUser(), supabase, error: null };
  }

  const supabase = await createSupabaseRouteClient();
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { user: null, supabase, error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    return { user, supabase, error: null };
  } catch {
    return { user: null, supabase, error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
}
