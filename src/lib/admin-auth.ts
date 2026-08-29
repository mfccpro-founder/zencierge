import type { User } from "@supabase/supabase-js";

export function adminEmailAllowlist() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdmin(user: User | null | undefined) {
  if (!user) return false;
  const meta = { ...user.app_metadata, ...user.user_metadata };
  const role = String(meta.role ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  if (role === "SUPER_ADMIN" || role === "SUPERADMIN" || role === "ADMIN") return true;
  const raw = String(user.user_metadata?.role ?? "").toLowerCase();
  if (raw === "superadmin" || raw === "admin") return true;
  const email = user.email?.toLowerCase() ?? "";
  return Boolean(email) && adminEmailAllowlist().includes(email);
}
