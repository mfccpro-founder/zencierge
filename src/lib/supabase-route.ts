import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnvIssue } from "@/lib/supabase-config";
import { hasDevHostCookie, mockDevHostUser } from "@/lib/dev-host-session";
import { hostUserFromPending, parsePendingHostCookie, PENDING_HOST_COOKIE } from "@/lib/pending-signup";
import { privatePilotHostAuthorized, privatePilotSafeMode } from "@/lib/private-pilot-safety";
import { privatePilotDemoAccessGranted } from "@/lib/private-pilot-entitlement";

export type HostAuthSource = "supabase-auth" | "dev-fallback";
export type HostAuthBranch = "pending" | "dev-host-cookie" | "supabase-get-user";
export type HostAuthFailure =
  | "missing-session-cookie"
  | "get-user-rejected"
  | "get-user-network";

function privatePilotDenied() {
  return Response.json(
    { error: "This account is not authorized for the private pilot" },
    { status: 403 },
  );
}

async function privatePilotAccessError(supabase: SupabaseClient, userId: string) {
  if (!privatePilotSafeMode()) return null;
  const { data, error } = await supabase
    .from("host_subscriptions")
    .select("plan_id, complimentary_ends_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return Response.json({ error: "Service unavailable" }, { status: 503 });
  if (!privatePilotDemoAccessGranted({
    planId: data?.plan_id,
    complimentaryEndsAt: data?.complimentary_ends_at,
  })) {
    return Response.json({ error: "Private demo access has ended" }, { status: 403 });
  }
  return null;
}

function hasSupabaseAuthCookies(cookiesToInspect: { name: string }[]) {
  return cookiesToInspect.some((cookie) => cookie.name.includes("-auth-token"));
}

function authFailureFrom(cause: unknown): HostAuthFailure {
  const error = cause as { name?: unknown; status?: unknown } | null;
  return error?.name === "AuthRetryableFetchError" || error?.status === 0
    ? "get-user-network"
    : "get-user-rejected";
}

function logAuthFailure(failure: HostAuthFailure, authCookieCount: number) {
  if (process.env.NODE_ENV !== "development") return;
  console.warn("[auth:getUser]", {
    failure,
    authCookiesPresent: authCookieCount > 0,
    authCookieCount,
  });
}

/** Provenance from the branch that produced the host, not from UUID shape. */
export function hostAuthSourceFromBranch(branch: "pending" | "dev-host-cookie" | "supabase-get-user"): HostAuthSource {
  return branch === "supabase-get-user" ? "supabase-auth" : "dev-fallback";
}

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

export async function requireHostAuthContext() {
  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();
  const authCookieCount = allCookies.filter((cookie) =>
    cookie.name.includes("-auth-token"),
  ).length;
  const pending = parsePendingHostCookie(cookieStore.get(PENDING_HOST_COOKIE)?.value);
  if (pending) {
    const supabase = await createSupabaseRouteClient();
    const user = hostUserFromPending(pending);
    if (!privatePilotHostAuthorized(user.id)) {
      return {
        user: null,
        supabase,
        error: privatePilotDenied(),
        source: null,
        authBranch: null,
        authFailure: null,
      };
    }
    const pilotAccessError = await privatePilotAccessError(supabase, user.id);
    if (pilotAccessError) {
      return {
        user: null,
        supabase,
        error: pilotAccessError,
        source: null,
        authBranch: null,
        authFailure: null,
      };
    }
    return {
      user,
      supabase,
      error: null,
      source: hostAuthSourceFromBranch("pending"),
      authBranch: "pending" as const,
      authFailure: null,
    };
  }
  if (supabaseEnvIssue() && hasDevHostCookie(cookieStore)) {
    const supabase = await createSupabaseRouteClient();
    const user = mockDevHostUser();
    if (!privatePilotHostAuthorized(user.id)) {
      return {
        user: null,
        supabase,
        error: privatePilotDenied(),
        source: null,
        authBranch: null,
        authFailure: null,
      };
    }
    const pilotAccessError = await privatePilotAccessError(supabase, user.id);
    if (pilotAccessError) {
      return {
        user: null,
        supabase,
        error: pilotAccessError,
        source: null,
        authBranch: null,
        authFailure: null,
      };
    }
    return {
      user,
      supabase,
      error: null,
      source: hostAuthSourceFromBranch("dev-host-cookie"),
      authBranch: "dev-host-cookie" as const,
      authFailure: null,
    };
  }

  const supabase = await createSupabaseRouteClient();
  try {
    const {
      data: { user },
      error: getUserError,
    } = await supabase.auth.getUser();
    if (getUserError) {
      const failure = hasSupabaseAuthCookies(allCookies)
        ? authFailureFrom(getUserError)
        : "missing-session-cookie";
      logAuthFailure(failure, authCookieCount);
      return {
        user: null,
        supabase,
        error: Response.json({ error: "Unauthorized" }, { status: 401 }),
        source: null,
        authBranch: null,
        authFailure: failure,
      };
    }
    if (!user) {
      const failure: HostAuthFailure = authCookieCount > 0
        ? "get-user-rejected"
        : "missing-session-cookie";
      logAuthFailure(failure, authCookieCount);
      return {
        user: null,
        supabase,
        error: Response.json({ error: "Unauthorized" }, { status: 401 }),
        source: null,
        authBranch: null,
        authFailure: failure,
      };
    }
    if (!privatePilotHostAuthorized(user.id)) {
      return {
        user: null,
        supabase,
        error: privatePilotDenied(),
        source: null,
        authBranch: null,
        authFailure: null,
      };
    }
    const pilotAccessError = await privatePilotAccessError(supabase, user.id);
    if (pilotAccessError) {
      return {
        user: null,
        supabase,
        error: pilotAccessError,
        source: null,
        authBranch: null,
        authFailure: null,
      };
    }
    return {
      user,
      supabase,
      error: null,
      source: hostAuthSourceFromBranch("supabase-get-user"),
      authBranch: "supabase-get-user" as const,
      authFailure: null,
    };
  } catch (cause) {
    const failure = authCookieCount > 0
      ? authFailureFrom(cause)
      : "missing-session-cookie";
    logAuthFailure(failure, authCookieCount);
    return {
      user: null,
      supabase,
      error: Response.json({ error: "Unauthorized" }, { status: 401 }),
      source: null,
      authBranch: null,
      authFailure: failure,
    };
  }
}

/** Existing callers keep { user, supabase, error }. `source` is additive. */
export async function requireHostUser() {
  return requireHostAuthContext();
}
