import type { User } from "@supabase/supabase-js";

export const DEV_HOST_COOKIE = "zencierge_dev_host";

export function allowDevHostSession() {
  return process.env.NODE_ENV !== "production";
}

export function mockDevHostUser(): User {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "dev@localhost",
    email_confirmed_at: now,
    phone: "",
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "dev", providers: ["dev"] },
    user_metadata: {
      full_name: "Javier",
      first_name: "Javier",
      plan: "pro",
      subscription_status: "trial",
      trial_started_at: now,
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    },
    identities: [],
    created_at: now,
    updated_at: now,
    is_anonymous: false,
  } as User;
}

export function hasDevHostCookie(cookies: { get(name: string): { value: string } | undefined }) {
  return allowDevHostSession() && cookies.get(DEV_HOST_COOKIE)?.value === "1";
}

export function shouldFallbackToDevHost(cause: unknown) {
  if (!allowDevHostSession()) return false;
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  const lower = message.toLowerCase();
  return (
    lower.includes("api key") ||
    lower.includes("apikey") ||
    lower.includes("jwt") ||
    lower.includes("invalid api") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("missing next_public_supabase") ||
    lower.includes("not a valid jwt") ||
    lower.includes("must look like https://")
  );
}
