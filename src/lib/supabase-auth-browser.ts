import { createBrowserClient } from "@supabase/ssr";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  logSupabaseClientEnv,
  supabaseEnvIssue,
} from "@/lib/supabase-config";
import { allowDevHostSession, mockDevHostUser } from "@/lib/dev-host-session";
import { hostUserFromPending, readPendingSignup } from "@/lib/pending-signup";

type BrowserClient = ReturnType<typeof createBrowserClient>;

const globalForAuth = globalThis as typeof globalThis & {
  __zenciergeAuthBrowser?: BrowserClient;
};

function createDevBrowserStub(): BrowserClient {
  const pendingUser = () => {
    const pending = readPendingSignup();
    return pending ? hostUserFromPending(pending) : mockDevHostUser();
  };
  return {
    auth: {
      getUser: async () => ({ data: { user: pendingUser() }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {}, id: "dev", callback: () => undefined } },
      }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: { message: "Supabase is not configured. Use local preview.", name: "AuthApiError", status: 401 },
      }),
      signUp: async () => ({
        data: { user: null, session: null },
        error: { message: "Supabase is not configured. Use local preview.", name: "AuthApiError", status: 401 },
      }),
      updateUser: async () => ({ data: { user: pendingUser() }, error: null }),
    },
  } as unknown as BrowserClient;
}

/** One GoTrueClient in the browser. New instances per component spam "Multiple GoTrueClient" and race auth. */
export function createAuthBrowserClient() {
  logSupabaseClientEnv("createAuthBrowserClient");
  const issue = supabaseEnvIssue();
  if (issue) {
    if (allowDevHostSession()) return createDevBrowserStub();
    throw new Error(issue);
  }
  if (typeof window === "undefined") {
    return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  if (!globalForAuth.__zenciergeAuthBrowser) {
    globalForAuth.__zenciergeAuthBrowser = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return globalForAuth.__zenciergeAuthBrowser;
}
