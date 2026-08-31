type MetaUser = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
} | null | undefined;

function flag(user: MetaUser, key: string) {
  const meta = { ...(user?.app_metadata ?? {}), ...(user?.user_metadata ?? {}) };
  const raw = meta[key];
  return raw === true || raw === "1" || raw === "true";
}

export function hasLifetimeVipAccess(user: MetaUser) {
  if (!user) return false;
  if (flag(user, "lifetime_vip") || flag(user, "founder_vip")) return true;
  const email = user.email?.toLowerCase() ?? "";
  const allow = (process.env.LIFETIME_VIP_EMAILS ?? process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email && allow.includes(email));
}
