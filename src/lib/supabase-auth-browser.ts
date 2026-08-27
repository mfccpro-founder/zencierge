import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase-config";

type BrowserClient = ReturnType<typeof createBrowserClient>;

const globalForAuth = globalThis as typeof globalThis & {
  __zenciergeAuthBrowser?: BrowserClient;
};

/** One GoTrueClient in the browser. New instances per component spam "Multiple GoTrueClient" and race auth. */
export function createAuthBrowserClient() {
  if (typeof window === "undefined") {
    return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  if (!globalForAuth.__zenciergeAuthBrowser) {
    globalForAuth.__zenciergeAuthBrowser = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return globalForAuth.__zenciergeAuthBrowser;
}
