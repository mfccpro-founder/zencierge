import { createClient } from "@supabase/supabase-js";
import { hasSupabaseEnv, isValidSupabaseAnonKey, isValidSupabaseUrl, logSupabaseClientEnv, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase-config";

const url = isValidSupabaseUrl() ? SUPABASE_URL : "https://placeholder.supabase.co";
const key = isValidSupabaseAnonKey() ? SUPABASE_ANON_KEY : "placeholder-anon-key";

logSupabaseClientEnv("src/lib/supabase.ts");

if (!hasSupabaseEnv()) {
  console.error(
    "[supabase] Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in the repo-root .env.local",
  );
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

export function getSupabase() {
  return supabase;
}

export function createSupabaseClient() {
  return supabase;
}
