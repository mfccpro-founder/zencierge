/**
 * Supabase public credentials. Prefer `.env.local` at the repo root:
 * NEXT_PUBLIC_SUPABASE_URL
 * NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
function sanitizeEnv(value: string) {
  return value.replace(/^\uFEFF/, "").trim().replace(/^["']|["']$/g, "");
}

export const SUPABASE_URL = sanitizeEnv(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
);

export const SUPABASE_ANON_KEY = sanitizeEnv(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
);

export function hasSupabaseEnv() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function isValidSupabaseUrl(url = SUPABASE_URL) {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url);
}

export function isValidSupabaseAnonKey(key = SUPABASE_ANON_KEY) {
  const parts = key.split(".");
  return key.startsWith("eyJ") && parts.length === 3 && parts.every((part) => part.length > 8);
}

export function supabaseEnvIssue(): string | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local. Restart npm run dev after saving.";
  }
  if (!isValidSupabaseUrl()) {
    return "NEXT_PUBLIC_SUPABASE_URL must look like https://your-project.supabase.co";
  }
  if (!isValidSupabaseAnonKey()) {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY is not a valid JWT (it must start with eyJ). Copy the anon/public key from Supabase → Project Settings → API.";
  }
  return null;
}

export function logSupabaseClientEnv(source: string) {
  if (process.env.NODE_ENV === "production") return;
  const issue = supabaseEnvIssue();
  const ref = SUPABASE_URL.replace(/^https:\/\//i, "").replace(/\.supabase\.co\/?$/i, "");
  console.info(`[supabase:${source}]`, {
    loaded: !issue,
    project: ref || "(empty)",
    urlOk: isValidSupabaseUrl(),
    anonJwtOk: isValidSupabaseAnonKey(),
    issue: issue ?? "ok",
  });
}

export function describeAuthFailure(cause: unknown): string {
  const configured = supabaseEnvIssue();
  if (configured) return configured;

  const message = cause instanceof Error ? cause.message : String(cause);
  const lower = message.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("fetch")
  ) {
    return "Network error: the browser could not reach Supabase. Confirm the project is not paused, the URL is correct, and you are online.";
  }
  if (
    lower.includes("invalid login") ||
    lower.includes("invalid credentials") ||
    lower.includes("invalid_grant") ||
    lower.includes("email not confirmed")
  ) {
    if (lower.includes("email not confirmed")) {
      return "This email is registered but not confirmed. Check your inbox (or disable email confirmations in Supabase Auth).";
    }
    return "Invalid email or password.";
  }
  if (lower.includes("jwt") || lower.includes("api key") || lower.includes("apikey") || lower.includes("invalid api")) {
    return "Supabase rejected the API key. Copy a fresh anon key from Project Settings → API and restart the dev server.";
  }
  if (
    lower.includes("user already registered") ||
    lower.includes("already been registered")
  ) {
    return "This email already has an account. Sign in instead.";
  }
  if (lower.includes("password") && (lower.includes("short") || lower.includes("6"))) {
    return "Password must be at least 6 characters.";
  }
  if (lower.includes("signup is disabled") || lower.includes("signups not allowed")) {
    return "New host sign-ups are currently disabled. Contact support or use an existing account.";
  }
  return message || "Sign-in failed.";
}
