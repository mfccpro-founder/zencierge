import { createClient } from "@supabase/supabase-js";
import { isValidSupabaseServiceRoleKey, isValidSupabaseUrl, SUPABASE_URL } from "@/lib/supabase-config";

export function getSupabaseServiceRoleKey() {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
}

export function tryCreateSupabaseAdminClient() {
  const key = getSupabaseServiceRoleKey();
  if (!isValidSupabaseUrl() || !isValidSupabaseServiceRoleKey(key)) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createSupabaseAdminClient() {
  const client = tryCreateSupabaseAdminClient();
  if (!client) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set. Webhooks cannot write host_subscriptions.");
  }
  return client;
}
