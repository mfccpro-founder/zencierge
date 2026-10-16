import type { User } from "@supabase/supabase-js";
import { isPrivatePilotHost } from "@/lib/private-pilot-safety";

export function adminEmailAllowlist() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

const IN_PROCESS_AUTH_PROVIDERS = new Set(["pending_signup", "dev"]);

/**
 * Founder gate. The role comes only from server-owned app_metadata.
 * user_metadata is ignored because the signed-in user can edit it.
 * Pending-signup and dev-host cookies build a User in process, so they
 * cannot satisfy this check even when their email is on ADMIN_EMAILS.
 * Callers must pass the user returned by supabase.auth.getUser().
 */
export function isSuperAdmin(user: User | null | undefined) {
  if (!user) return false;
  if (isPrivatePilotHost(user.id)) return false;
  const provider = typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "";
  if (IN_PROCESS_AUTH_PROVIDERS.has(provider)) return false;

  const role = String(user.app_metadata?.role ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (role === "SUPER_ADMIN" || role === "SUPERADMIN" || role === "ADMIN") return true;

  const email = user.email?.trim().toLowerCase() ?? "";
  return Boolean(email) && adminEmailAllowlist().includes(email);
}
