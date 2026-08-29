import type { User } from "@supabase/supabase-js";
import { parsePlanId, type ZenciergePlanId } from "@/lib/zencierge-plans";

export const PENDING_SIGNUP_KEY = "zencierge_pending_signup";
export const PENDING_HOST_COOKIE = "zencierge_pending_host";

export type PendingSignup = {
  fullName: string;
  email: string;
  planId: ZenciergePlanId;
};

export function savePendingSignup(payload: PendingSignup) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify(payload));
}

export function clearPendingSignup() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PENDING_SIGNUP_KEY);
}

export function readPendingSignup(): PendingSignup | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_SIGNUP_KEY);
    if (!raw) return null;
    return normalizePendingSignup(JSON.parse(raw) as Partial<PendingSignup>);
  } catch {
    return null;
  }
}

export function encodePendingHostCookie(payload: PendingSignup) {
  return encodeURIComponent(JSON.stringify(payload));
}

export function parsePendingHostCookie(value: string | undefined | null): PendingSignup | null {
  if (!value) return null;
  try {
    return normalizePendingSignup(JSON.parse(decodeURIComponent(value)) as Partial<PendingSignup>);
  } catch {
    return null;
  }
}

export function hasPendingHostCookie(cookies: { get(name: string): { value: string } | undefined }) {
  return Boolean(parsePendingHostCookie(cookies.get(PENDING_HOST_COOKIE)?.value));
}

export function hostUserFromPending(payload: PendingSignup): User {
  const now = new Date().toISOString();
  const fullName = payload.fullName.trim();
  const firstName = fullName.split(/\s+/)[0] || "Host";
  return {
    id: uuidFromEmail(payload.email),
    aud: "authenticated",
    role: "authenticated",
    email: payload.email.trim().toLowerCase(),
    email_confirmed_at: now,
    phone: "",
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "pending_signup", providers: ["pending_signup"] },
    user_metadata: {
      full_name: fullName,
      first_name: firstName,
      plan: payload.planId,
      pending_plan: payload.planId,
      subscription_status: "pending_checkout",
    },
    identities: [],
    created_at: now,
    updated_at: now,
    is_anonymous: false,
  } as User;
}

export function isDevPreviewUser(user: { email?: string | null } | null | undefined) {
  return (user?.email ?? "").toLowerCase() === "dev@localhost";
}

function normalizePendingSignup(raw: Partial<PendingSignup>): PendingSignup | null {
  const fullName = typeof raw.fullName === "string" ? raw.fullName.trim() : "";
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  const planId = parsePlanId(raw.planId);
  if (!fullName || !email.includes("@") || !planId) return null;
  return { fullName, email, planId };
}

function uuidFromEmail(email: string) {
  let hash = 0;
  for (const char of email.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const hex = hash.toString(16).padStart(12, "0").slice(-12);
  return `aaaaaaaa-bbbb-4ccc-8ddd-${hex}`;
}
