import { adminEmailAllowlist } from "@/lib/admin-auth";
import type { HostAuthSource } from "@/lib/supabase-route";

export type FounderBillingAuthUser = {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
};

function normalizeEmail(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeServerRole(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function isFounderBillingServerRole(value: unknown) {
  const role = normalizeServerRole(value);
  return role === "SUPER_ADMIN" || role === "SUPERADMIN";
}

/**
 * Strict authorization for Founder Billing operations.
 *
 * Requires a real Supabase-authenticated session and trusts only server-owned
 * app_metadata or the ADMIN_EMAILS server allowlist. user_metadata is never
 * consulted because authenticated users can update their own user metadata.
 */
export function isFounderBillingOperator(input: {
  user: FounderBillingAuthUser | null | undefined;
  source: HostAuthSource | null | undefined;
  adminEmails?: readonly string[];
}) {
  if (!input.user || input.source !== "supabase-auth") return false;

  if (isFounderBillingServerRole(input.user.app_metadata?.role)) {
    return true;
  }

  const email = normalizeEmail(input.user.email);
  if (!email) return false;

  const allowlist = input.adminEmails ?? adminEmailAllowlist();
  return allowlist.some((entry) => normalizeEmail(entry) === email);
}